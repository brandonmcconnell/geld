#!/usr/bin/env node
/** Live installed-extension smoke. Run only where unpacked extensions are permitted by policy. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = resolve(extensionRoot, '.output/chrome-mv3');
const artifacts = resolve(process.env.GELD_BROWSER_ARTIFACTS ?? 'artifacts/browser-e2e');
const executablePath = process.env.GELD_BROWSER_EXECUTABLE ?? '/usr/bin/google-chrome-stable';
const SETTINGS_KEY = 'settings'; // @geld/core SETTINGS_STORAGE_KEY = sync:settings; Chrome area's key omits sync:.
const WAIT_MS = 90_000;
const GL_MIXED = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123';
const GL_TESTS = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265';
const GH_FILES = 'https://github.com/wxt-dev/wxt/pull/2544/files';
const BB_PR = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
const report = {
  schema: 1, startedAt: new Date().toISOString(), mode: 'actual installed unpacked extension on live anonymous public pages',
  parity: 'incomplete', executablePath, extensionPath, artifacts,
  auth: { freshTemporaryBrowserProfile: true, credentialsProvided: false, authenticatedProviderWrites: false },
  limitations: ['Bitbucket extension DOM/review adapter is inactive: routing checks do not establish Bitbucket feature parity.', 'No authenticated review, Viewed, merge or AI-gateway operation is exercised.', 'Computed style probes describe the tested viewport/theme only.'],
  installation: null, cases: [], infrastructureErrors: [],
};
const cooldowns = new Map();
let browser;
let options;
let extensionId;

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) if (/token|secret|password|authorization|signature|nonce|key/i.test(key)) url.searchParams.set(key, '[redacted]');
    return url.href;
  } catch { return String(value).slice(0, 1000); }
}
function errorText(error) { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
function providerOf(value) {
  try {
    const host = new URL(value).hostname;
    if (host === 'gitlab.com') return 'gitlab';
    if (host === 'bitbucket.org' || host === 'api.bitbucket.org') return 'bitbucket';
    if (host === 'github.com' || host === 'api.github.com' || host.endsWith('.githubusercontent.com')) return 'github';
  } catch { /* A non-network URL. */ }
  return null;
}
function retryAfter(value) {
  if (value === undefined) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 60_000;
}
async function saveReport() {
  report.finishedAt = new Date().toISOString();
  const failed = report.infrastructureErrors.length > 0 || report.cases.some((item) => item.status === 'failed');
  report.status = failed ? 'failed' : 'completed_with_unsupported_features';
  await writeFile(resolve(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
async function pause(ms) { await new Promise((done) => setTimeout(done, ms)); }
async function poll(read, accepts, label, ms = WAIT_MS) {
  const expires = Date.now() + ms;
  let last;
  let lastError;
  while (Date.now() < expires) {
    try { last = await read(); if (accepts(last)) return last; }
    catch (error) { lastError = errorText(error); }
    await pause(1000);
  }
  throw new Error(`${label} timed out. Last value: ${JSON.stringify(last)}${lastError === undefined ? '' : `; ${lastError}`}`);
}
async function patchSettings(patch) {
  return options.evaluate(async (key, changes) => {
    const previous = (await chrome.storage.sync.get(key))[key] ?? {};
    const next = { ...previous, ...changes };
    await chrome.storage.sync.set({ [key]: next });
    const saved = (await chrome.storage.sync.get(key))[key];
    return { enabled: saved.enabled, categories: saved.categories, hideWhitespace: saved.hideWhitespace, aiEnabled: saved.aiEnabled };
  }, SETTINGS_KEY, patch);
}
async function tabState(page) {
  const url = page.url();
  const reply = await options.evaluate(async (expectedUrl) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === expectedUrl);
    if (tab?.id === undefined) return { error: `No real Chrome tab for ${expectedUrl}` };
    try {
      const state = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'geld:get-tab-state' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Content-script message timed out')), 3000)),
      ]);
      return { tabId: tab.id, state };
    } catch (error) { return { tabId: tab.id, error: error instanceof Error ? error.message : String(error) }; }
  }, url);
  if (reply.error !== undefined || reply.state === undefined) throw new Error(`Real tabs.sendMessage failed: ${reply.error ?? 'no state'}`);
  return reply.state;
}
async function authObservation(page, provider) {
  const observed = await page.evaluate((site) => {
    let signedIn = false;
    if (site === 'github') signedIn = document.body.classList.contains('logged-in');
    if (site === 'gitlab') {
      let current = null;
      try { current = JSON.parse(document.querySelector('#js-vue-mr-discussions')?.getAttribute('data-current-user-data') ?? 'null'); } catch { /* No native identity. */ }
      signedIn = current?.id != null || document.querySelector('.js-mr-title-actions[data-is-signed-in="true"]') !== null;
    }
    const signInLinks = [...document.querySelectorAll('a[href]')].filter((item) => /sign[ -]?in|log[ -]?in/i.test(item.textContent ?? '')).slice(0, 5).map((item) => ({ text: item.textContent.trim(), href: item.getAttribute('href') }));
    return { signedIn, signInLinks, basis: site === 'bitbucket' ? 'Fresh temporary Chrome profile; no credentials supplied. Native sign-in links recorded where rendered.' : 'Fresh temporary profile and native signed-in identity markers.' };
  }, provider);
  assert.equal(observed.signedIn, false, 'Smoke browser unexpectedly has an authenticated native identity');
  return observed;
}
async function capture(page, name) {
  if (page.isClosed()) return { unavailable: 'Page closed after rate limit or navigation failure' };
  const files = { screenshot: `${name}.png`, dom: `${name}.html`, accessibility: `${name}.accessibility.json` };
  await page.screenshot({ path: resolve(artifacts, files.screenshot), fullPage: true });
  const html = await page.evaluate(() => {
    const copy = document.documentElement.cloneNode(true);
    for (const script of copy.querySelectorAll('script')) script.remove();
    for (const item of copy.querySelectorAll('[nonce]')) item.removeAttribute('nonce');
    for (const item of copy.querySelectorAll('meta[name*="csrf"], meta[name*="token"]')) item.setAttribute('content', '[redacted]');
    for (const item of copy.querySelectorAll('input[name]')) if (/token|secret|password|csrf/i.test(item.getAttribute('name') ?? '')) item.setAttribute('value', '[redacted]');
    return `<!doctype html>\n${copy.outerHTML}`;
  });
  await writeFile(resolve(artifacts, files.dom), html);
  await writeFile(resolve(artifacts, files.accessibility), `${JSON.stringify(await page.accessibility.snapshot({ interestingOnly: false }), null, 2)}\n`);
  return files;
}
async function runCase(name, url, body) {
  const item = { name, url, startedAt: new Date().toISOString(), status: 'running', console: [], pageErrors: [], requestFailures: [], sourceFailures: [] };
  report.cases.push(item);
  let page;
  try {
    const provider = providerOf(url);
    const cooldown = cooldowns.get(provider);
    if (cooldown !== undefined && cooldown > Date.now()) throw new Error(`Provider rate limited until ${new Date(cooldown).toISOString()}; no navigation attempted`);
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.bringToFront();
    page.on('console', (message) => { if (item.console.length < 100) item.console.push({ type: message.type(), text: message.text().slice(0, 2000) }); });
    page.on('pageerror', (error) => { if (item.pageErrors.length < 100) item.pageErrors.push(errorText(error)); });
    page.on('requestfailed', (request) => {
      if (item.requestFailures.length < 100) item.requestFailures.push({ url: safeUrl(request.url()), method: request.method(), error: request.failure()?.errorText });
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const resourceProvider = providerOf(response.url());
      const failure = { url: safeUrl(response.url()), status: response.status(), retryAfter: response.headers()['retry-after'] ?? null, expectedAnonymousRestriction: response.status() === 401 || response.status() === 403 };
      if (item.sourceFailures.length < 100) item.sourceFailures.push(failure);
      if (response.status() === 429 && resourceProvider !== null) {
        const until = Date.now() + retryAfter(response.headers()['retry-after']);
        cooldowns.set(resourceProvider, Math.max(cooldowns.get(resourceProvider) ?? 0, until));
        item.rateLimitedUntil = new Date(until).toISOString();
        // Stop this tab's demand immediately; later scenarios honor the provider cooldown.
        void page.close().catch(() => undefined);
      }
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    item.navigation = { status: response?.status() ?? null, finalUrl: safeUrl(page.url()) };
    assert.equal(response?.status(), 200, 'Public fixture navigation did not return HTTP200');
    const result = await body(page, item);
    Object.assign(item, result);
    item.auth = await authObservation(page, provider);
    item.artifacts = await capture(page, name);
    item.status = result?.status ?? 'passed';
  } catch (error) {
    item.status = 'failed'; item.error = errorText(error);
    if (page !== undefined && !page.isClosed()) {
      try { item.artifacts = await capture(page, `${name}-failed`); } catch (captureError) { item.captureError = errorText(captureError); }
    }
  } finally {
    item.finishedAt = new Date().toISOString();
    if (page !== undefined && !page.isClosed()) await page.close();
    await saveReport();
    console.log(`${item.status.toUpperCase()}: ${name}${item.error === undefined ? '' : ` — ${item.error}`}`);
  }
}
async function gitLabDom(page) {
  return page.evaluate(() => {
    const numeric = (node, absentIsZero = false) => { if (node === null) return absentIsZero ? 0 : null; const match = node.textContent?.replace(/[,\s]/g, '').match(/\d+/); return match === undefined || match === null ? null : Number(match[0]); };
    const headers = [...document.querySelectorAll('.diff-stats.inline-parallel-buttons .diff-stats-contents')].map((root) => ({
      additions: numeric(root.querySelector('[data-testid="js-file-addition-line"]'), true),
      deletions: numeric(root.querySelector('[data-testid="js-file-deletion-line"]'), true),
      files: numeric(root.querySelector(':scope > .diff-stats-group > span')),
    }));
    const hidden = [...document.querySelectorAll('[data-geld-provider-hidden]')].map((root) => ({ value: root.getAttribute('data-geld-provider-hidden'), display: getComputedStyle(root).display, file: root.getAttribute('data-file-data') }));
    return { headers, hidden, inlineHidden: document.querySelectorAll('[data-geld-provider-inline]').length, ownUi: document.querySelectorAll('.geld-provider-hidden').length };
  });
}
async function waitTotals(page, all, visible, hiddenCount) {
  const equal = (actual, expected) => actual != null && ['files', 'additions', 'deletions'].every((key) => actual[key] === expected[key]);
  return poll(() => tabState(page), (state) => state.hasDiff === true && equal(state.all, all) && equal(state.visible, visible) && state.hiddenCount === hiddenCount, 'Installed extension exact complete tab-state totals');
}
async function themeProbe(page) {
  return page.evaluate(() => {
    const probe = (selector) => {
      const node = document.querySelector(selector);
      if (node === null) return null;
      const style = getComputedStyle(node);
      return { selector, tag: node.tagName, font: style.font, color: style.color, background: style.backgroundColor, border: style.border, radius: style.borderRadius, shadow: style.boxShadow, filter: style.filter, outline: style.outline, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height };
    };
    return { viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio }, htmlTheme: document.documentElement.getAttribute('data-theme'), colorMode: document.documentElement.getAttribute('data-color-mode'), darkPreference: matchMedia('(prefers-color-scheme: dark)').matches, owned: probe('.geld-provider-toggle'), native: probe('button[aria-label="Expand all files"]') };
  });
}

await mkdir(artifacts, { recursive: true });
try {
  const manifestText = await readFile(resolve(extensionPath, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  try { report.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: extensionRoot, encoding: 'utf8' }).trim(); } catch { report.gitHead = null; }
  report.manifest = { sha256: createHash('sha256').update(manifestText).digest('hex'), version: manifest.version, manifestVersion: manifest.manifest_version };
  browser = await puppeteer.launch({ executablePath, headless: true, enableExtensions: true, pipe: true, args: ['--enable-unsafe-extension-debugging', '--no-sandbox'] });
  report.browserVersion = await browser.version();
  report.browserUserAgent = await browser.userAgent();
  extensionId = await browser.installExtension(extensionPath);
  assert.match(extensionId, /^[a-p]{32}$/, 'Chrome did not return an extension ID');
  const base = `chrome-extension://${extensionId}/`;
  const worker = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().startsWith(base), { timeout: 15_000 });
  options = await browser.newPage();
  await options.goto(`${base}${manifest.options_ui?.page ?? 'options.html'}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  const installed = await options.evaluate(() => ({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest(), storageAvailable: typeof chrome.storage?.sync?.get === 'function' }));
  assert.equal(installed.id, extensionId);
  assert.equal(installed.manifest.version, manifest.version);
  assert.equal(installed.storageAvailable, true);
  report.installation = { extensionId, serviceWorker: worker.url(), optionsUrl: options.url(), verifiedActualChromeStorage: true, installedManifestVersion: installed.manifest.version };
  report.settings = await patchSettings({ enabled: true, categories: { tests: true }, groupHidden: true, expandedByDefault: false, hideCommentLines: false, testOutline: false, hideLargeDiffs: false, hideWhitespace: false, repoRules: [], hiddenAuthors: [], repoConfigs: 'never', aiEnabled: false, autoViewed: {}, autoUpdatePatterns: false });

  await runCase('gitlab-mixed', GL_MIXED, async (page, item) => {
    item.enabledState = await waitTotals(page, { files: 3, additions: 36, deletions: 0 }, { files: 2, additions: 4, deletions: 0 }, 1);
    const enabled = await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 2 && row.additions === 4 && row.deletions === 0) && value.hidden.some((row) => row.value === 'closed' && row.display === 'none'), 'Actual native header rewrite and hidden file DOM');
    item.enabledDom = enabled;
    item.theme = await themeProbe(page);
    await patchSettings({ enabled: false });
    item.disabledState = await poll(() => tabState(page), (state) => state.hasDiff === false && state.allowed === false, 'Real sync master toggle disable');
    item.disabledDom = await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 3 && row.additions === 36 && row.deletions === 0) && value.hidden.length === 0 && value.inlineHidden === 0 && value.ownUi === 0, 'Native count restoration and owned hide-attribute removal');
    item.disabledArtifacts = await capture(page, 'gitlab-mixed-disabled');
    await patchSettings({ enabled: true });
    item.reenabledState = await waitTotals(page, { files: 3, additions: 36, deletions: 0 }, { files: 2, additions: 4, deletions: 0 }, 1);
    await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 2 && row.additions === 4) && value.hidden.some((row) => row.display === 'none'), 'Reenabled installed native UI');
    return {};
  });
  // A failed assertion while disabled must not invalidate the following independent fixture.
  await patchSettings({ enabled: true });
  await runCase('gitlab-all-tests', GL_TESTS, async (page, item) => {
    item.state = await waitTotals(page, { files: 1, additions: 4, deletions: 1 }, { files: 0, additions: 0, deletions: 0 }, 1);
    item.dom = await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 0 && row.additions === 0 && row.deletions === 0) && value.hidden.some((row) => row.display === 'none'), 'All-test native zero essential counts and hidden DOM');
    return {};
  });
  await runCase('github-regression', GH_FILES, async (page, item) => {
    item.state = await poll(() => tabState(page), (state) => state.hasDiff === true && state.all !== null && state.visible !== null && state.hiddenCount > 0 && state.categories.some((category) => category.id === 'tests' && category.count > 0), 'Installed GitHub public fixture classification');
    item.dom = await page.evaluate(() => ({ hidden: document.querySelectorAll('[data-geld="hidden"]').length, totalGeldEntries: document.querySelectorAll('[data-geld]').length }));
    assert.ok(item.dom.hidden > 0, 'GitHub reports hidden tests but no actual hidden diff entry exists');
    return {};
  });
  for (const [name, url] of [['bitbucket-overview', BB_PR], ['bitbucket-diff', `${BB_PR}/diff`]]) {
    await runCase(name, url, async (page, item) => {
      await page.waitForFunction(() => document.body.innerText.includes('BCAT-6005') && document.body.innerText.includes('Support API token') && document.body.innerText.includes('Merged'), { timeout: WAIT_MS });
      if (name === 'bitbucket-diff') await page.waitForFunction(() => document.body.innerText.includes('README.md') && document.body.innerText.includes('pipe/pipe.py'), { timeout: WAIT_MS });
      item.state = await poll(() => tabState(page), (state) => state.repository?.provider === 'bitbucket' && state.repository.path === 'atlassian/bitbucket-upload-file' && state.hasDiff === false, 'Installed Bitbucket routing response');
      assert.equal(item.state.onDiffPage, name === 'bitbucket-diff');
      item.featureParity = 'unsupported';
      return { status: 'unsupported', reason: 'Actual extension responds on native public Bitbucket page, but its DOM/digest adapter is inactive. Native accessibility/DOM capture and routing are evidence only; no Bitbucket feature parity pass.' };
    });
  }
} catch (error) {
  report.infrastructureErrors.push(errorText(error));
  console.error(`INSTALLED EXTENSION INFRASTRUCTURE FAILURE: ${errorText(error)}`);
} finally {
  if (browser !== undefined) await browser.close().catch((error) => report.infrastructureErrors.push(errorText(error)));
  await saveReport();
}
const failed = report.status === 'failed';
console.log(`Installed extension smoke: ${report.status}. Bitbucket feature parity remains UNSUPPORTED. Report: ${resolve(artifacts, 'report.json')}`);
process.exitCode = failed ? 1 : 0;
