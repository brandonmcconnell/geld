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
const BITBUCKET_ANONYMOUS_COOLDOWN_MS = 62 * 60 * 1000; // Documented rolling-hour quota, plus a conservative two-minute margin.
const FOCUSED_CASES = {
  regression: ['gitlab-mixed', 'gitlab-all-tests', 'gitlab-overview-digest', 'github-regression', 'bitbucket-diff'],
  'bitbucket-diff': ['bitbucket-diff'],
  'bitbucket-list': ['bitbucket-diff', 'bitbucket-list-counts'],
  'bitbucket-comment': ['bitbucket-comment-digest'],
  'bitbucket-commit': ['bitbucket-commit-counts'],
  'gitlab-lists': ['gitlab-project-mr-list', 'gitlab-group-mr-list'],
  'gitlab-diff': ['gitlab-mixed', 'gitlab-all-tests'],
  'gitlab-review': ['gitlab-overview-digest'],
  github: ['github-regression'],
};
const focus = process.env.GELD_BROWSER_FOCUS ?? 'regression';
const GL_MIXED = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123';
const GL_OVERVIEW = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
const GL_TESTS = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265';
const GH_FILES = 'https://github.com/wxt-dev/wxt/pull/2544/files';
const BB_PR = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
const GL_LIST_QUERY = new URLSearchParams({ state: 'all', search: 'issueMoveList' });
const GL_PROJECT_LIST = `https://gitlab.com/gitlab-org/gitlab/-/merge_requests?${GL_LIST_QUERY}`;
const GL_GROUP_LIST = `https://gitlab.com/groups/gitlab-org/-/merge_requests?${GL_LIST_QUERY}`;
const BB_PR_LIST = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED';
const BB_COMMENT_PR = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
const BB_COMMIT = 'https://bitbucket.org/atlassian/bitbucket-upload-file/commits/9777bca47119';
const report = {
  schema: 1, startedAt: new Date().toISOString(), mode: 'actual installed unpacked extension on live anonymous public pages',
  parity: 'incomplete', executablePath, extensionPath, artifacts,
  auth: { freshTemporaryBrowserProfile: true, credentialsProvided: false, authenticatedProviderWrites: false },
  limitations: ['Bitbucket routing and native surface discovery do not establish feature parity.', 'No authenticated review, Viewed, merge or AI-gateway operation is exercised.', 'Computed style probes describe the tested viewport/theme only. Discovery cases report observations or explicit unavailability, never a feature pass.'],
  installation: null, cases: [], infrastructureErrors: [],
  focus, quotaPolicy: { source: 'https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/', anonymousRequestsPerRollingHour: 60, conservativeObservedRequestBudget: 40, broadDiscoveryDefault: false },
};
const cooldowns = new Map();
const capturedNativeResources = new Set();
let browser;
let options;
let extensionId;
let currentCaseAbort;
let bitbucketApiRequests = 0;
const bitbucketRequestTimes = [];

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
function retryAfter(value, provider) {
  const fallback = provider === 'bitbucket' ? BITBUCKET_ANONYMOUS_COOLDOWN_MS : 60_000;
  if (value === undefined || value === null || value.trim() === '') return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : fallback;
}
function quotaHeaders(headers) {
  const allowed = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-resource', 'x-ratelimit-nearlimit', 'x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset', 'x-rate-limit-resource', 'x-rate-limit-nearlimit'];
  return Object.fromEntries(allowed.filter((key) => typeof headers[key] === 'string').map((key) => [key, headers[key].slice(0, 200)]));
}
function bitbucketApi(value) {
  try { const url = new URL(value);return (url.hostname === 'api.bitbucket.org' && url.pathname.startsWith('/2.0/')) || (url.hostname === 'bitbucket.org' && url.pathname.startsWith('/!api/2.0/')); }
  catch { return false; }
}
async function saveReport() {
  report.finishedAt = new Date().toISOString();
  report.cooldowns = Object.fromEntries([...cooldowns].map(([provider, until]) => [provider, new Date(until).toISOString()]));
  report.bitbucketAnonymousRequestTimes = bitbucketRequestTimes.filter((at) => at > Date.now() - 60 * 60 * 1000).map((at) => new Date(at).toISOString());
  report.coverage = { focus, completeParity: false, passed: report.cases.filter((item) => item.status === 'passed').map((item) => item.name), notSelected: report.cases.filter((item) => item.status === 'not_selected').map((item) => item.name), failed: report.cases.filter((item) => item.status === 'failed').map((item) => item.name) };
  const failed = report.infrastructureErrors.length > 0 || report.cases.some((item) => item.status === 'failed');
  report.status = failed ? 'failed' : 'completed_with_unsupported_features';
  await writeFile(resolve(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
async function inheritCooldowns() {
  const path = process.env.GELD_BROWSER_PREVIOUS_REPORT;
  if (path === undefined || path === '') return;
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') { report.previousEvidence = { path, status: 'absent_first_run' }; return; }
    throw error;
  }
  const previous = JSON.parse(raw);
  assert.ok(previous?.schema === 1 && Array.isArray(previous.cases), 'Previous trusted browser report has an invalid schema');
  if (previous.bitbucketAnonymousRequestTimes !== undefined) {
    assert.ok(Array.isArray(previous.bitbucketAnonymousRequestTimes) && previous.bitbucketAnonymousRequestTimes.length <= 1000, 'Previous anonymous request budget metadata is malformed');
    for (const value of previous.bitbucketAnonymousRequestTimes) {
      const at = typeof value === 'string' ? Date.parse(value) : NaN;
      assert.ok(Number.isFinite(at) && new Date(at).toISOString() === value && at <= Date.now() + 60_000, 'Previous anonymous request time is malformed');
      if (at > Date.now() - 60 * 60 * 1000) bitbucketRequestTimes.push(at);
    }
    bitbucketRequestTimes.sort((left, right) => left - right);
  }
  const inherit = (provider, value) => {
    assert.ok(['github', 'gitlab', 'bitbucket'].includes(provider), 'Previous cooldown has an unknown provider');
    assert.equal(typeof value, 'string', 'Previous cooldown deadline must be an ISO timestamp');
    const until = Date.parse(value);
    assert.ok(Number.isFinite(until) && new Date(until).toISOString() === value, 'Previous cooldown deadline is malformed');
    // Reject implausible metadata without shortening a server deadline or navigating around it.
    assert.ok(until <= Date.now() + 366 * 24 * 60 * 60 * 1000, 'Previous cooldown exceeds one year; verification must stop for investigation');
    if (until > Date.now()) cooldowns.set(provider, Math.max(cooldowns.get(provider) ?? 0, until));
  };
  if (previous.cooldowns !== undefined) {
    assert.ok(previous.cooldowns !== null && typeof previous.cooldowns === 'object' && !Array.isArray(previous.cooldowns), 'Previous cooldown map is malformed');
    for (const [provider, until] of Object.entries(previous.cooldowns)) inherit(provider, until);
  }
  for (const item of previous.cases) {
    if (item.rateLimitedUntil !== undefined) inherit(providerOf(item.url), item.rateLimitedUntil);
    // Earlier harness versions used a one-minute fallback. Carry the real anonymous quota window forward instead.
    if (providerOf(item.url) === 'bitbucket' && item.sourceFailures?.some((failure) => failure.status === 429 && (failure.retryAfter === null || failure.retryAfter === undefined))) {
      const at = Date.parse(item.finishedAt ?? item.startedAt);
      assert.ok(Number.isFinite(at), 'Previous anonymous Bitbucket429 has no valid observation time');
      inherit('bitbucket', new Date(at + BITBUCKET_ANONYMOUS_COOLDOWN_MS).toISOString());
    }
  }
  if (bitbucketRequestTimes.length >= report.quotaPolicy.conservativeObservedRequestBudget) inherit('bitbucket', new Date(bitbucketRequestTimes.at(-1) + BITBUCKET_ANONYMOUS_COOLDOWN_MS).toISOString());
  report.previousEvidence = { path, status: 'parsed_json_only', startedAt: previous.startedAt ?? null, inheritedAnonymousRequestsWithinRollingHour: bitbucketRequestTimes.length, inheritedCooldowns: Object.fromEntries([...cooldowns].map(([provider, until]) => [provider, new Date(until).toISOString()])) };
}
function closedTarget(error) { return /Target closed|Target\.closeTarget|Session closed|Connection closed|targetgone|No target with given id/i.test(errorText(error)); }
async function discardHandle(handle) {
  try { await handle.dispose(); }
  catch (error) { if (!closedTarget(error)) throw error; }
}
async function caseOperation(operation, signal = currentCaseAbort?.signal) {
  if (signal === undefined) return operation;
  signal.throwIfAborted();
  let interrupted;
  const stopped = new Promise((_, reject) => { interrupted = () => reject(signal.reason);signal.addEventListener('abort', interrupted, { once: true }); });
  try { return await Promise.race([operation, stopped]); }
  finally { signal.removeEventListener('abort', interrupted); }
}
async function pause(ms, signal = currentCaseAbort?.signal) {
  signal?.throwIfAborted();
  let timer;
  try { await caseOperation(new Promise((done) => { timer = setTimeout(done, ms); }), signal); }
  finally { clearTimeout(timer); }
}
async function poll(read, accepts, label, ms = WAIT_MS) {
  const expires = Date.now() + ms;
  let last;
  let lastError;
  const signal = currentCaseAbort?.signal;
  while (Date.now() < expires) {
    signal?.throwIfAborted();
    try { last = await caseOperation(Promise.resolve().then(read), signal); if (accepts(last)) return last; }
    catch (error) { signal?.throwIfAborted();if (closedTarget(error)) throw error;lastError = errorText(error); }
    await pause(1000, signal);
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
async function runCase(name, url, body, discovery = false) {
  const item = { name, url, startedAt: new Date().toISOString(), status: 'running', ...(discovery ? { purpose: 'Read-only native surface discovery. No feature parity assertion.' } : {}), console: [], pageErrors: [], requestFailures: [], sourceFailures: [] };
  report.cases.push(item);
  let page;
  let listSettings;
  const abort = new AbortController();
  try {
    if (focus !== 'all' && !(FOCUSED_CASES[focus] ?? []).includes(name)) {
      item.status = 'not_selected';
      item.reason = `Budget-aware ${focus} slice does not select this case. No navigation or feature pass.`;
      return;
    }
    const provider = providerOf(url);
    const cooldown = cooldowns.get(provider);
    if (cooldown !== undefined && cooldown > Date.now()) {
      item.rateLimitedUntil = new Date(cooldown).toISOString();
      item.navigationSuppressedByCooldown = true;
      throw new Error(`Provider rate limited until ${item.rateLimitedUntil}; no navigation attempted`);
    }
    currentCaseAbort = abort;
    if (name === 'bitbucket-list-counts') {
      listSettings = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
      await patchSettings({ showListStats: false });
      item.listSourcePreparation = 'List stats disabled through real shared settings before native navigation; enable only after native list search returns the single fixture.';
    }
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.bringToFront();
    page.on('close', () => { if (!abort.signal.aborted) abort.abort(new Error('Browser case page closed; polling stopped immediately')); });
    page.on('request', (request) => {
      if (!bitbucketApi(request.url())) return;
      bitbucketApiRequests += 1;
      const now = Date.now();
      while (bitbucketRequestTimes[0] <= now - 60 * 60 * 1000) bitbucketRequestTimes.shift();
      bitbucketRequestTimes.push(now);
      item.observedBitbucketApiRequests = (item.observedBitbucketApiRequests ?? 0) + 1;
      report.observedBitbucketApiRequests = bitbucketApiRequests;
      report.observedAnonymousRequestsWithinRollingHour = bitbucketRequestTimes.length;
      if (bitbucketRequestTimes.length >= report.quotaPolicy.conservativeObservedRequestBudget && !abort.signal.aborted) {
        const until = Date.now() + BITBUCKET_ANONYMOUS_COOLDOWN_MS;
        cooldowns.set('bitbucket', Math.max(cooldowns.get('bitbucket') ?? 0, until));
        item.rateLimitedUntil = new Date(cooldowns.get('bitbucket')).toISOString();
        item.holdReason = 'conservative_anonymous_api_budget';
        abort.abort(new Error('Conservative anonymous Bitbucket API request budget reached; demand stopped before continuing the verification slice'));
        void page.close().catch(() => undefined);
      }
    });
    page.on('console', (message) => { if (item.console.length < 100) item.console.push({ type: message.type(), text: message.text().slice(0, 2000) }); });
    page.on('pageerror', (error) => { if (item.pageErrors.length < 100) item.pageErrors.push(errorText(error)); });
    page.on('requestfailed', (request) => {
      if (item.requestFailures.length < 100) item.requestFailures.push({ url: safeUrl(request.url()), method: request.method(), error: request.failure()?.errorText });
    });
    page.on('response', (response) => {
      const headers = response.headers();
      const quota = quotaHeaders(headers);
      if (providerOf(response.url()) !== null && Object.keys(quota).length > 0) {
        item.quotaObservations ??= [];
        if (item.quotaObservations.length < 60) item.quotaObservations.push({ url: safeUrl(response.url()), status: response.status(), observedAt: new Date().toISOString(), headers: quota });
      }
      if (response.status() < 400) return;
      const resourceProvider = providerOf(response.url());
      const failure = { url: safeUrl(response.url()), status: response.status(), retryAfter: headers['retry-after'] ?? null, quotaHeaders: quota, observedAt: new Date().toISOString(), expectedAnonymousRestriction: response.status() === 401 || response.status() === 403 };
      if (item.sourceFailures.length < 100) item.sourceFailures.push(failure);
      if (response.status() === 429 && resourceProvider !== null) {
        const until = Date.now() + retryAfter(headers['retry-after'], resourceProvider);
        cooldowns.set(resourceProvider, Math.max(cooldowns.get(resourceProvider) ?? 0, until));
        item.rateLimitedUntil = new Date(cooldowns.get(resourceProvider)).toISOString();
        item.holdReason = 'provider_http429';
        if (!abort.signal.aborted) abort.abort(new Error(`Provider HTTP429 cooldown until ${item.rateLimitedUntil}; polling stopped immediately`));
        // Stop this tab's demand immediately; later scenarios honor the provider cooldown.
        void page.close().catch(() => undefined);
      }
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    abort.signal.throwIfAborted();
    item.navigation = { status: response?.status() ?? null, finalUrl: safeUrl(page.url()) };
    assert.equal(response?.status(), 200, 'Public fixture navigation did not return HTTP200');
    const result = await body(page, item);
    Object.assign(item, result);
    item.auth = await authObservation(page, provider);
    item.artifacts = await capture(page, name);
    item.status = result?.status ?? (discovery ? 'discovery' : 'passed');
  } catch (error) {
    item.status = discovery ? item.rateLimitedUntil === undefined ? 'unavailable' : 'rate_limited' : 'failed';
    item.error = errorText(error);
    if (item.rateLimitedUntil !== undefined) {
      item.interruptedError = item.error;
      item.error = `${item.holdReason === 'conservative_anonymous_api_budget' ? 'Conservative anonymous API budget hold' : item.navigationSuppressedByCooldown ? 'Inherited provider cooldown' : 'Provider HTTP429 cooldown'} until ${item.rateLimitedUntil}. Native demand stopped and no retry was attempted.`;
    }
    if (page !== undefined && !page.isClosed()) {
      try { item.artifacts = await capture(page, `${name}-failed`); } catch (captureError) { item.captureError = errorText(captureError); }
    }
  } finally {
    currentCaseAbort = undefined;
    if (listSettings !== undefined) await patchSettings({ showListStats: listSettings.showListStats ?? true });
    item.finishedAt = new Date().toISOString();
    if (page !== undefined && !page.isClosed()) {
      try { await page.close(); }
      catch (error) {
        item.cleanupObservation = errorText(error);
        if (!closedTarget(error)) { item.status = 'failed';item.cleanupError = errorText(error); }
      }
    }
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
async function trustedHiddenToggle(page, expectedLabel, selector = '.geld-provider-toggle') {
  const before = await page.$eval(selector, (node) => ({ label: node.textContent.trim(), expanded: node.getAttribute('aria-expanded') }));
  assert.match(before.label, expectedLabel);
  const [event] = await Promise.all([
    page.evaluate((selector) => new Promise((resolve, reject) => {
      const button = document.querySelector(selector);
      if (button === null) { reject(new Error('Owned hidden-file toggle missing'));return; }
      const timeout = setTimeout(() => reject(new Error('Trusted hidden-file toggle click was not observed')), 5000);
      button.addEventListener('click', (event) => { clearTimeout(timeout);resolve({ trusted: event.isTrusted, label: button.textContent.trim(), expanded: button.getAttribute('aria-expanded') }); }, { once: true });
    }), selector),
    page.click(selector),
  ]);
  assert.equal(event.trusted, true, 'Hidden-file toggle must receive a real trusted browser click');
  return { before, event };
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

async function countA11y(page) {
  return page.evaluate(() => ({
    additions: document.querySelector('[data-testid="js-file-addition-line"]')?.closest('[aria-label]')?.getAttribute('aria-label'),
    changes: document.querySelector('[data-testid="diffs-tab"] > a')?.textContent.trim(),
    ownedDescriptions: document.querySelectorAll('[aria-describedby~="geld-provider-count-tooltip"]').length,
  }));
}
async function installedHover(page, selector, interaction, artifactName, anchorSelector) {
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  if (interaction === 'keyboard') {
    const previous = await page.evaluate((target) => {
      const anchor = [...document.querySelectorAll(target)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
      const order = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((node) => node.tabIndex >= 0 && !node.disabled && node.closest('[inert]') === null && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
      const at = order.indexOf(anchor);
      const prior = at > 0 ? order[at - 1] : null;
      prior?.focus();
      return prior !== null && prior !== undefined;
    }, selector);
    assert.equal(previous, true, 'Native previous control needed for real Tab-key traversal is missing');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate((target) => [...document.querySelectorAll(target)].some((node) => node === document.activeElement), selector), true, 'Real Tab did not focus the native count host');
  } else {
    const handle = await page.evaluateHandle((target) => [...document.querySelectorAll(target)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden') ?? null, selector);
    const control = handle.asElement();
    assert.ok(control !== null, 'Visible count hover host is missing');
    await control.hover();
    await discardHandle(handle);
  }
  const snapshot = await poll(() => page.evaluate((target, anchorSelector) => {
    const host = [...document.querySelectorAll(target)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
    const tip = document.querySelector('#geld-provider-count-tooltip[role="tooltip"]');
    if (tip === null || tip.hidden || getComputedStyle(tip).display === 'none') return null;
    const style = getComputedStyle(tip);
    const bounds = tip.getBoundingClientRect();
    const anchor = anchorSelector === undefined ? null : [...document.querySelectorAll(anchorSelector)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
    const anchorRect = anchor?.getBoundingClientRect();
    return { text: tip.textContent.replace(/\s+/g, ' ').trim(), fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color, background: style.backgroundColor, filter: style.filter,
      anchor: anchorRect === undefined ? null : { left: anchorRect.left, right: anchorRect.right, top: anchorRect.top, bottom: anchorRect.bottom }, caret: Number.parseFloat(style.getPropertyValue('--geld-provider-hover-caret')), placement: tip.getAttribute('data-placement'),
      rows: [...tip.querySelectorAll('.geld-provider-hover__row')].map((row) => ({ label: row.querySelector('.geld-provider-hover__label')?.textContent, files: row.querySelector('.geld-provider-hover__files')?.textContent, additions: row.querySelector('.geld-provider-hover__add')?.textContent, deletions: row.querySelector('.geld-provider-hover__del')?.textContent })),
      described: [...document.querySelectorAll('[aria-describedby~="geld-provider-count-tooltip"]')].some((owner) => owner === host || host?.contains(owner)),
      bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }, viewport: { width: innerWidth, height: innerHeight } };
  }, selector, anchorSelector), (value) => value !== null && value.described && /Essential/.test(value.text) && /Tests/.test(value.text) && /Total/.test(value.text), 'Installed native count hover breakdown and accessible owner', 12_000);
  assert.ok(snapshot.bounds.left >= 0 && snapshot.bounds.right <= snapshot.viewport.width + 1 && snapshot.bounds.top >= 0 && snapshot.bounds.bottom <= snapshot.viewport.height + 1, 'Count tooltip escapes the tested viewport');
  if (anchorSelector !== undefined) {
    assert.ok(snapshot.anchor !== null && Number.isFinite(snapshot.caret), 'Header group hover must expose its real owned hint anchor and caret');
    const center = (snapshot.anchor.left + snapshot.anchor.right) / 2;
    const reachable = Math.max(snapshot.bounds.left + 12, Math.min(center, snapshot.bounds.right - 12));
    assert.ok(Math.abs(snapshot.bounds.left + snapshot.caret - reachable) <= 1, 'Native group tooltip caret does not point at its owned category hint');
    const gap = snapshot.placement === 'below' ? snapshot.bounds.top - snapshot.anchor.bottom : snapshot.anchor.top - snapshot.bounds.bottom;
    assert.ok(Math.abs(gap - 8) <= 1, 'Header tooltip is positioned against its category hint rather than the native group');
  }
  await page.screenshot({ path: resolve(artifacts, `${artifactName}.png`) });
  await page.keyboard.press('Escape');
  await poll(() => page.evaluate(() => { const tip = document.querySelector('#geld-provider-count-tooltip'); return tip === null || tip.hidden || getComputedStyle(tip).display === 'none'; }), (value) => value, 'Escape dismisses installed hover', 5000);
  return { ...snapshot, interaction, screenshot: `${artifactName}.png`, escapeDismissed: true };
}

async function headerHintsEvidence(page, expectedLabel, groupSelector, name, interactions = true) {
  const hintSelector = '.geld-provider-header-hidden-count';
  const read = () => page.evaluate((selector) => {
    const hints = [...document.querySelectorAll(selector)].filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
    return { hints: hints.map((node) => {
      let nativeKeyboard = null;
      for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) if (parent.hasAttribute('data-geld-hover-bound') && parent.tabIndex >= 0 && parent.closest('[data-geld-ui]') === null) { nativeKeyboard = parent;break; }
      const style = getComputedStyle(node);const parent = getComputedStyle(node.parentElement);
      return { text: node.textContent.trim(), role: node.getAttribute('role'), aria: node.getAttribute('aria-label'), tabIndex: node.tabIndex, nativeKeyboardAncestor: nativeKeyboard !== null,
        forbiddenAncestor: node.closest('[aria-hidden="true"],[hidden],[inert],.badge,.gl-badge,[data-component="Label"],[role="tab"],[role="tablist"]') !== null,
        font: { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight }, nativeParentFont: { family: parent.fontFamily, size: parent.fontSize, lineHeight: parent.lineHeight } };
    }), nativeIds: [...document.querySelectorAll('[data-testid="diffs-tab"],#file-tree,#pull-request-tabs-1,[role="region"][aria-label="Diff"] > div > div[id^="chg-"]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => ({ id: node.id, testid: node.getAttribute('data-testid'), href: node.getAttribute('href') })) };
  }, hintSelector);
  const measurement = await poll(read, (value) => value.hints.length > 0 && value.hints.every((hint) => hint.text === expectedLabel), 'Visible category-aware header hint agrees with actual classification');
  for (const hint of measurement.hints) {
    assert.equal(hint.forbiddenAncestor, false, 'Category hint is hidden from accessibility or nested inside native badge/tab content');
    assert.equal(hint.role, 'note');assert.equal(hint.aria, `${expectedLabel} hidden`);
    assert.equal(hint.tabIndex, hint.nativeKeyboardAncestor ? -1 : 0, 'Hint must add a keyboard stop only when its native group has none');
    assert.deepEqual(hint.font, hint.nativeParentFont, 'Header hint does not inherit the native header typography');
  }
  if (!interactions) return measurement;
  const pointer = await installedHover(page, groupSelector, 'pointer', `${name}-group-pointer`, hintSelector);
  const keyboardSelector = measurement.hints[0].nativeKeyboardAncestor ? groupSelector : hintSelector;
  const keyboard = await installedHover(page, keyboardSelector, 'keyboard', `${name}-hint-keyboard`, hintSelector);
  assert.equal(pointer.text, keyboard.text, 'Native group and correctly selected keyboard hint/group totals disagree');
  return { ...measurement, pointer, keyboard, keyboardSelector };
}

async function browserZoom(page, factor) {
  const result = await options.evaluate(async (url, factor) => {
    const tab = (await chrome.tabs.query({})).find((value) => value.url === url);
    if (tab?.id === undefined) throw new Error('Real Chrome tab missing for zoom');
    const previous = await chrome.tabs.getZoom(tab.id);
    await chrome.tabs.setZoom(tab.id, factor);
    return { tabId: tab.id, previous, actual: await chrome.tabs.getZoom(tab.id), mechanism: 'chrome.tabs.setZoom and chrome.tabs.getZoom on the installed browser tab' };
  }, page.url(), factor);
  assert.equal(result.actual, factor, 'Chrome did not apply the requested real browser zoom');
  return result;
}

async function responsiveHover(page, selector, name, expectedText) {
  const viewport = page.viewport();
  let zoom;
  try {
    await page.setViewport({ ...viewport, width: 1000 });
    zoom = await browserZoom(page, 2);
    await pause(350);
    await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), selector);
    const native = await page.evaluate((selector) => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      const available = rect !== undefined && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight && getComputedStyle(node).visibility !== 'hidden' && node.closest('[aria-hidden="true"], [inert]') === null;
      return { available, width: innerWidth, height: innerHeight, devicePixelRatio, selector, nativeTreeVisible: [...document.querySelectorAll('[data-testid="file-tree-container"], #file-tree')].some((tree) => tree.getBoundingClientRect().width > 0 && tree.getBoundingClientRect().height > 0) };
    }, selector);
    let chosen = selector;
    if (!native.available && page.url().startsWith('https://bitbucket.org/')) chosen = 'a#pull-request-tabs-1[role="tab"]';
    await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), chosen);
    const available = await page.evaluate((selector) => { const node = document.querySelector(selector); const rect = node?.getBoundingClientRect(); return rect !== undefined && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight && getComputedStyle(node).visibility !== 'hidden'; }, chosen);
    if (!available) return { status: 'unavailable', zoom, native, reason: 'The provider hides the verified count control at this responsive width. No replacement control was invented.', artifacts: await capture(page, `${name}-unavailable`) };
    const hover = await installedHover(page, chosen, 'keyboard', `${name}-keyboard-hover`);
    if (expectedText !== undefined) assert.equal(hover.text, expectedText, 'Normal and actual200% zoom keyboard breakdown totals diverge');
    return { status: 'passed', zoom, native, fallback: chosen === selector ? null : { reason: 'Native Lines updated host is hidden/offscreen in the responsive provider layout', selector: chosen }, hover, artifacts: await capture(page, name) };
  } finally {
    await browserZoom(page, 1);
    if (viewport !== null) await page.setViewport(viewport);
  }
}

async function reducedMotionProbe(page, provider) {
  const nativeSelector = provider === 'gitlab' ? 'button[aria-label="Expand all files"]' : '[data-qa="pr-header-actions-drop-down-menu-styles"] button';
  const sample = () => page.evaluate((nativeSelector) => {
    const read = (node) => node === null ? null : { transition: getComputedStyle(node).transition, duration: getComputedStyle(node).transitionDuration };
    return { native: read(document.querySelector(nativeSelector)), owned: read(document.querySelector('.geld-provider-toggle')) };
  }, nativeSelector);
  const before = await sample();
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await pause(150);
    const reduced = await sample();
    assert.ok(reduced.native !== null && reduced.owned !== null, 'Native/owned buttons are required for reduced motion comparison');
    assert.equal(reduced.owned.transition, reduced.native.transition, 'Native and owned reduced-motion button transitions differ');
    return { mechanism: 'prefers-reduced-motion browser emulation only', before, reduced };
  } finally { await page.emulateMediaFeatures([]); }
}

async function captureNativeBitbucketResources(page) {
  const observations = await page.evaluate(() => [
    ...[...document.querySelectorAll('link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]')].map((node) => ({ url: node.href, basis: 'Native modulepreload/script-preload element' })),
    ...[...document.querySelectorAll('script[src]')].map((node) => ({ url: node.src, basis: 'Native script element src' })),
    ...performance.getEntriesByType('resource').map((entry) => ({ url: entry.name, basis: 'Actual browser ResourceTiming entry', initiatorType: entry.initiatorType })),
  ]);
  const observed = [...new Set(observations.map((entry) => entry.url))];
  const resources = [];
  for (const component of ['action-single-app', 'overview-panel']) {
    const observedUrl = observed.find((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net' && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && new RegExp(`^/assets/repo-pull-request-${component}\\.[A-Za-z0-9_-]+\\.js$`).test(url.pathname);
      } catch { return false; }
    });
    if (observedUrl === undefined || capturedNativeResources.has(component)) continue;
    capturedNativeResources.add(component);
    try {
      const result = await page.evaluate(async (url) => {
        const limit = 2 * 1024 * 1024;
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 15_000);
        try {
          const response = await fetch(url, { method: 'GET', credentials: 'omit', signal: abort.signal });
          const mime = response.headers.get('content-type') ?? '';
          if (!response.ok || response.url !== url || !/^(?:application|text)\/(?:javascript|ecmascript)(?:;|$)/i.test(mime)) { await response.body?.cancel(); return { status: response.status, mime, unavailable: 'Response status, final URL or JavaScript MIME did not match the observed resource.' }; }
          if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); return { status: response.status, mime, unavailable: 'Native resource exceeds the2MiB capture limit.' }; }
          const reader = response.body?.getReader();
          if (reader === undefined) return { status: response.status, mime, unavailable: 'Native response has no readable body.' };
          const chunks = []; let total = 0;
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            total += next.value.byteLength;
            if (total > limit) { await reader.cancel(); return { status: response.status, mime, unavailable: 'Native resource exceeds the2MiB capture limit.' }; }
            chunks.push(next.value);
          }
          const bytes = new Uint8Array(total); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          let binary = '';
          for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
          return { status: response.status, mime, bytes: total, base64: btoa(binary) };
        } catch (error) { return { status: null, unavailable: error instanceof Error ? error.message : String(error) }; }
        finally { clearTimeout(timer); }
      }, observedUrl);
      if (result.base64 === undefined) { resources.push({ component, url: observedUrl, ...result }); continue; }
      const bytes = Buffer.from(result.base64, 'base64');
      assert.ok(bytes.length <= 2 * 1024 * 1024);
      const file = new URL(observedUrl).pathname.split('/').at(-1).replace(/\.js$/, '.native.js');
      await writeFile(resolve(artifacts, file), bytes);
      resources.push({ component, url: observedUrl, status: result.status, mime: result.mime, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), file, executed: false,
        observations: observations.filter((entry) => entry.url === observedUrl), basis: 'Exact URL observed in a native preload/script element or actual browser ResourceTiming entry. Bounded credential-free browser GET only.' });
    } catch (error) { resources.push({ component, url: observedUrl, unavailable: errorText(error) }); }
  }
  return { observedComponents: observed.filter((value) => /repo-pull-request-(?:action-single-app|overview-panel)\./.test(value)), captures: resources, limit: 'At most two observed component resources,2MiB each. No source maps or downloaded script execution.' };
}
async function bitbucketNativeStyles(page) {
  return page.evaluate(() => {
    const sample = (selector, pseudo, chosen) => {
      const node = chosen ?? document.querySelector(selector);
      if (node === null) return null;
      const style = getComputedStyle(node, pseudo);
      const keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'boxShadow', 'outline', 'height', 'paddingInlineStart', 'paddingInlineEnd', 'transitionDuration'];
      return { selector, pseudo: pseudo ?? null, tag: node.tagName, text: node.textContent.trim().slice(0, 80), ...Object.fromEntries(keys.map((key) => [key, style[key]])) };
    };
    const stateText = [...document.querySelectorAll('[data-qa="pr-branches-and-state-styles"] span')].find((node) => node.children.length === 0 && node.textContent.trim() === 'Merged');
    const root = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries([...root].filter((name) => name.startsWith('--ds-')).map((name) => [name, root.getPropertyValue(name).trim()]));
    return { scope: 'Computed native Bitbucket styles in actual installed browser. This sample does not assert extension feature parity. No inferred values or hashed selectors.', theme: document.documentElement.getAttribute('data-theme'), colorMode: document.documentElement.getAttribute('data-color-mode'), viewport: { width: innerWidth, height: innerHeight }, tokens,
      stateText: stateText === undefined ? null : sample('[data-qa="pr-branches-and-state-styles"]', undefined, stateText), stateLozenge: stateText === undefined ? null : sample('[data-qa="pr-branches-and-state-styles"]', undefined, stateText.parentElement?.parentElement), body: sample('body'), moreActions: sample('[data-qa="pr-header-actions-drop-down-menu-styles"] button'), moreActionsBorder: sample('[data-qa="pr-header-actions-drop-down-menu-styles"] button', '::after'),
      author: sample('[data-qa="pr-header-author"]'), activity: sample('[data-qa="pull-request-overview-activity-content"]'), time: sample('main time'), article: sample('article[data-qa="branch-diff-file"]'), header: sample('[data-qa="bk-file__header"]'), path: sample('h2[data-qa="bk-filepath"]'), code: sample('[data-qa="code-line"]'), line: sample('[data-qa="code-line-permalink"]') };
  });
}

async function bitbucketDom(page) {
  return page.evaluate(() => {
    const number = (node) => {
      const text = node?.textContent.trim().replace(/,/g, '') ?? '';
      return /^[+−-]?\d+$/.test(text) ? Math.abs(Number(text.replace('−', '-'))) : null;
    };
    const tab = document.querySelector('a#pull-request-tabs-1[role="tab"]');
    const files = tab?.querySelector(':scope > div > span > span');
    const heading = [...document.querySelectorAll('#file-tree h5')].find((node) => node.textContent.trim() === 'Lines updated');
    const leaves = [...heading?.parentElement?.parentElement?.querySelectorAll('span') ?? []].filter((node) => node.children.length === 0);
    return { files: number(files), additions: number(leaves.find((node) => /^\+\s*[\d,]+$/.test(node.textContent.trim()))), deletions: number(leaves.find((node) => /^[-−]\s*[\d,]+$/.test(node.textContent.trim()))),
      hidden: [...document.querySelectorAll('[data-geld-provider-hidden]')].map((node) => ({ path: node.querySelector(':scope > div[id^="chg-"]')?.id.slice(4) ?? null, mode: node.getAttribute('data-geld-provider-hidden'), display: getComputedStyle(node).display })),
      nativeFiles: document.querySelectorAll('[role="region"][aria-label="Diff"] > div > div[id^="chg-"]').length,
      renderedFiles: document.querySelectorAll('article[data-qa="branch-diff-file"]').length, placeholders: document.querySelectorAll('pre[data-testid="pr-diff-placeholder-wrapper"]').length };
  });
}

async function bitbucketFiltering(page, item) {
  const all = { files: 5, additions: 46, deletions: 29 };
  item.baseline = await waitTotals(page, all, all, 0);
  item.baselineDom = await poll(() => bitbucketDom(page), (value) => value.files === all.files && value.additions === all.additions && value.deletions === all.deletions && value.hidden.length === 0, 'Actual native Bitbucket baseline counts');
  const summarySelector = '#file-tree :has(> .geld-provider-accessible-counts)';
  item.baselineHeaderHints = await headerHintsEvidence(page, '0 tests', summarySelector, 'bitbucket-baseline', false);
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  try {
    await patchSettings({ categoryPatterns: { ...original.categoryPatterns, tests: ['pipe/pipe.py'] } });
    item.filtered = await poll(() => tabState(page), (state) => state.hasDiff === true && state.all?.files === 5 && state.all.additions === 46 && state.all.deletions === 29 && state.visible?.files === 4 && state.hiddenCount === 1 && state.categories.some((category) => category.id === 'tests' && category.paths.includes('pipe/pipe.py')), 'Actual shared pattern setting hides one complete Bitbucket file');
    const visible = item.filtered.visible;
    item.derivedHidden = { path: 'pipe/pipe.py', files: all.files - visible.files, additions: all.additions - visible.additions, deletions: all.deletions - visible.deletions, basis: 'Actual complete adapter result minus actual visible totals, not a guessed fixture count' };
    assert.ok(item.derivedHidden.additions + item.derivedHidden.deletions > 0, 'The selected file did not remove any changed lines');
    item.filteredDom = await poll(() => bitbucketDom(page), (value) => value.files === visible.files && value.additions === visible.additions && value.deletions === visible.deletions && value.hidden.some((file) => file.path === 'pipe/pipe.py' && file.mode === 'closed' && file.display === 'none'), 'Native Bitbucket file count/line totals and actual hidden file wrapper');
    item.filteredHeaderHints = await headerHintsEvidence(page, '1 test', summarySelector, 'bitbucket-filtered');
    assert.deepEqual(item.filteredHeaderHints.nativeIds, item.baselineHeaderHints.nativeIds, 'Category hint update changed native header/file anchor IDs');
    item.filteredArtifacts = await capture(page, 'bitbucket-pattern-filtered');
    item.categoryInteraction = await categoryInteraction(page, 'pipe/pipe.py', 'bitbucket', 'bitbucket-category', true);
    item.spokenFiltered = await poll(() => page.$eval(`${summarySelector} > .geld-provider-accessible-counts`, (node) => node.textContent), (text) => text.includes(`${visible.files} files changed`) && text.includes(`Added ${visible.additions} lines`) && text.includes(`Removed ${visible.deletions} lines`), 'Native Bitbucket screen reader totals follow actual filtering');
    item.keyboardStatsHover = await installedHover(page, summarySelector, 'keyboard', 'bitbucket-stats-keyboard-hover');
    item.zoom200 = await responsiveHover(page, summarySelector, 'bitbucket-zoom200', item.keyboardStatsHover.text);
    assert.equal(await page.$eval(`${summarySelector} > .geld-provider-accessible-counts`, (node) => node.textContent), item.spokenFiltered, 'Bitbucket zoom changed the accessible filtered totals');
    item.reducedMotion = await reducedMotionProbe(page, 'bitbucket');
    const light = await bitbucketNativeStyles(page);
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      await pause(350);
      const dark = await bitbucketNativeStyles(page);
      const changed = dark.colorMode !== light.colorMode || dark.body?.color !== light.body?.color || dark.body?.backgroundColor !== light.body?.backgroundColor || dark.moreActions?.color !== light.moreActions?.color || dark.moreActions?.backgroundColor !== light.moreActions?.backgroundColor;
      item.osDarkPreference = { mechanism: 'OS prefers-color-scheme emulation only; no native class or CSS injection', nativeThemeChanged: changed, status: changed ? 'native_scheme_observed' : 'site_did_not_select_dark_theme', before: light, measurement: dark };
      if (changed) item.osDarkPreference.artifacts = await capture(page, 'bitbucket-os-dark');
    } finally { await page.emulateMediaFeatures([]); }
  } finally {
    await patchSettings({ categoryPatterns: original.categoryPatterns ?? {} });
  }
  item.restored = await waitTotals(page, all, all, 0);
  item.restoredDom = await poll(() => bitbucketDom(page), (value) => value.files === all.files && value.additions === all.additions && value.deletions === all.deletions && value.hidden.length === 0, 'Native Bitbucket counts and hiding attributes restored after pattern removal');
  item.restoredHeaderHints = await headerHintsEvidence(page, '0 tests', summarySelector, 'bitbucket-restored', false);
  assert.deepEqual(item.restoredHeaderHints.nativeIds, item.baselineHeaderHints.nativeIds);
}

async function categoryInteraction(page, path, provider, name, reveal) {
  const read = () => page.evaluate((path, provider) => {
    const headers = [...document.querySelectorAll('.geld-provider-category-header')];
    const active = document.querySelector('.geld-provider-category[data-active="true"]');
    const item = [...active?.querySelectorAll('[data-geld-category-path]') ?? []].find((node) => node.getAttribute('data-geld-category-path') === path);
    const copy = item?.querySelector('.geld-provider-category-native-row');
    const copiedControl = copy?.matches('a,button') ? copy : copy?.querySelector('a,button');
    const source = [...document.querySelectorAll(provider === 'gitlab' ? 'a[data-testid="file-row"][data-file-row]' : '#file-tree a[href^="#chg-"]')].find((node) => {
      if (node.closest('[data-geld-ui]') !== null) return false;
      const url = new URL(node.href);
      return provider === 'gitlab' ? url.searchParams.get('file_path') === path : decodeURIComponent(url.hash.slice(1)) === `chg-${path}`;
    });
    const nativeRow = provider === 'gitlab' ? source?.closest('[data-testid="file-row-container"]') ?? source : source;
    const root = provider === 'gitlab'
      ? [...document.querySelectorAll('diff-file[data-file-data]')].find((node) => { try { return JSON.parse(node.getAttribute('data-file-data')).new_path === path; } catch { return false; } })
      : document.getElementById(`chg-${path}`)?.parentElement;
    const styles = (node) => {
      if (node == null) return null;
      const style = getComputedStyle(node);
      return { tag: node.tagName, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color };
    };
    const marks = (node) => [...node?.querySelectorAll('svg,img,[data-testid="file-unresolved-threads-count"]') ?? []].map((mark) => ({ tag: mark.tagName, hook: mark.getAttribute('data-testid'), label: mark.getAttribute('aria-label'), use: mark.querySelector('use')?.getAttribute('href') ?? null, color: getComputedStyle(mark).color, fill: getComputedStyle(mark).fill }));
    const content = root?.querySelector('[data-testid="file-content"][data-qa="bk-file__content"]');
    const firstRow = active?.querySelector('[data-geld-category-path] .geld-provider-category-native-row');
    const firstControl = firstRow?.matches('a,button') ? firstRow : firstRow?.querySelector('a,button');
    const bounds = (node) => {
      if (node == null) return null;
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility };
    };
    return { headers: headers.map((header) => ({ text: header.textContent, expanded: header.getAttribute('aria-expanded') })),
      layout: { firstFile: bounds(firstControl), panel: bounds(active?.closest('.geld-provider-categories')), content: bounds(active?.querySelector('.geld-provider-category-content')), treeHost: bounds(active?.closest('[data-geld-provider-category-host]')), viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } },
      focusedHeader: document.activeElement?.classList.contains('geld-provider-category-header') ? document.activeElement.textContent : null,
      clone: copy == null ? null : { ariaLabel: copiedControl?.getAttribute('aria-label'), hasNativePresentation: !copy.classList.contains('geld-provider-file'), style: styles(copiedControl), marks: marks(copy) },
      source: source === undefined ? null : { style: styles(source), marks: marks(nativeRow) },
      root: root == null ? null : { display: getComputedStyle(root).display, hiddenMode: root.getAttribute('data-geld-provider-hidden'), rendered: root.querySelector('article[data-qa="branch-diff-file"]') !== null,
        expanded: content != null && content.closest('[aria-hidden="true"]') === null && getComputedStyle(content).display !== 'none', codeLines: root.querySelectorAll('[data-qa="code-line"]').length } };
  }, path, provider);
  const initial = await poll(read, (value) => value.headers.length >= 2 && /^Essential/.test(value.headers[0].text) && value.headers[0].expanded === 'true' && value.headers.at(-1).expanded === 'false' && value.root?.display === 'none', 'Essential starts expanded and Tests starts collapsed');
  await page.focus('.geld-provider-category-header');
  await page.keyboard.press('End');
  const endFocused = await read();
  assert.match(endFocused.focusedHeader ?? '', /^Tests/, 'Real End key did not focus the Tests category');
  await page.keyboard.press('Enter');
  const opened = await poll(read, (value) => value.headers.filter((header) => header.expanded === 'true').length === 1 && value.headers.at(-1).expanded === 'true' && value.root !== null && value.root.display !== 'none' && value.clone !== null, 'Real Enter opens only Tests and shows its native file wrapper');
  assert.ok(opened.clone.ariaLabel?.includes(path), 'Cloned category file lost its full-path accessible label');
  assert.equal(opened.clone.hasNativePresentation, true, 'Category row fell back instead of cloning an available native presentation');
  const { firstFile, panel, content, viewport } = opened.layout;
  assert.ok(firstFile !== null && panel !== null && content !== null, 'Opened category needs actual first-file and owned-panel layout bounds');
  assert.ok(firstFile.width > 0 && firstFile.height > 0 && firstFile.display !== 'none' && firstFile.visibility !== 'hidden', 'Opened category first file is not rendered');
  assert.ok(firstFile.left >= -1 && firstFile.right <= viewport.width + 1 && firstFile.top >= -1 && firstFile.bottom <= viewport.height + 1, `Opened ${provider} first file is clipped outside the viewport before any scrolling or file click: ${JSON.stringify(opened.layout)}`);
  for (const [label, container] of [['owned panel', panel], ['active content', content]]) {
    assert.ok(firstFile.left >= container.left - 1 && firstFile.right <= container.right + 1 && firstFile.top >= container.top - 1 && firstFile.bottom <= container.bottom + 1, `Opened ${provider} first file is outside its ${label}: ${JSON.stringify(opened.layout)}`);
  }
  assert.ok(opened.source !== null && opened.clone.style !== null, 'Native source and cloned control samples are required');
  if (opened.source.style.tag === opened.clone.style.tag) {
    for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color']) assert.equal(opened.clone.style[key], opened.source.style[key], `Cloned ${provider} native file ${key} diverges`);
  }
  assert.ok(opened.clone.marks.length >= opened.source.marks.length, 'Cloned native row lost status or annotation visuals');
  const result = { path, interaction: 'Real Puppeteer End then Enter keyboard events', initial, endFocused, opened, openedArtifacts: await capture(page, `${name}-open`) };
  if (reveal) {
    result.beforeReveal = await read();
    const controlHandle = await page.evaluateHandle((path) => {
      const item = [...document.querySelectorAll('.geld-provider-category[data-active="true"] [data-geld-category-path]')].find((node) => node.getAttribute('data-geld-category-path') === path);
      const row = item?.querySelector('.geld-provider-category-native-row');
      return row?.matches('a,button') ? row : row?.querySelector('a,button') ?? null;
    }, path);
    const control = controlHandle.asElement();
    assert.ok(control !== null, 'Actual cloned native file control is missing');
    await control.click();
    result.afterReveal = await poll(read, (value) => value.root?.display !== 'none' && value.root?.rendered === true && value.root?.expanded === true && value.root?.codeLines > 0, 'Real cloned Bitbucket file click hydrates and expands its native diff', 20_000);
    result.revealObservation = result.beforeReveal.root?.rendered ? 'Native file was already hydrated before the click; expanded code is verified.' : 'Native placeholder became a rendered expanded diff with real code after the click.';
    result.revealedArtifacts = await capture(page, `${name}-revealed`);
    await discardHandle(controlHandle);
  }
  await page.focus('.geld-provider-category-header[aria-expanded="true"]');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  result.closed = await poll(read, (value) => value.headers.filter((header) => header.expanded === 'true').length === 1 && value.headers[0].expanded === 'true' && value.root?.display === 'none', 'Returning to Essential hides the categorized native file again');
  result.closedArtifacts = await capture(page, `${name}-essential`);
  return result;
}

async function nativeSurface(page) {
  return page.evaluate(() => {
    const visible = (node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const sample = (node) => {
      const style = getComputedStyle(node);
      return { tag: node.tagName, attributes: Object.fromEntries([...node.attributes].filter((attr) => /^(?:data-qa|data-testid|data-test-id|data-reference-type|data-project-path|data-iid|role|id|aria-label|aria-expanded|aria-selected|href)$/.test(attr.name)).map((attr) => [attr.name, attr.value])),
        text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
        style: Object.fromEntries(['fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'color', 'backgroundColor', 'border', 'borderRadius', 'boxShadow', 'filter', 'outline', 'padding'].map((key) => [key, style[key]])) };
    };
    const links = [...document.querySelectorAll('a[href]')].flatMap((link) => {
      if (!visible(link)) return [];
      try {
        const url = new URL(link.href);
        if (url.origin !== location.origin || url.username !== '' || url.password !== '') return [];
        const review = location.hostname === 'gitlab.com' ? /\/-\/merge_requests\/[1-9]\d*(?:\/|$)/.test(url.pathname) : /\/pull-requests\/[1-9]\d*(?:\/|$)/.test(url.pathname);
        const commit = /\/-\/commit\/[0-9a-f]{7,64}$/i.test(url.pathname) || /\/commits\/[0-9a-f]{7,64}$/i.test(url.pathname);
        if (!review && !commit) return [];
        return [{ href: url.href, kind: commit ? 'commit' : 'review', text: link.textContent.trim().slice(0, 160), referenceType: link.getAttribute('data-reference-type'), projectPath: link.getAttribute('data-project-path'), iid: link.getAttribute('data-iid') }];
      } catch { return []; }
    }).slice(0, 60);
    return { title: document.title, bodyExcerpt: document.body.innerText.slice(0, 3000), links,
      hooks: [...document.querySelectorAll('[data-qa], [data-testid], [data-test-id], [role="tab"], [role="tree"], [role="treeitem"]')].filter(visible).slice(0, 100).map(sample),
      nativeComments: [...document.querySelectorAll('[id^="comment-"], [id^="comment_"], a[href*="#comment-"]')].filter(visible).slice(0, 20).map(sample),
      nativeTimes: [...document.querySelectorAll('time')].filter(visible).slice(0, 12).map((node) => ({ datetime: node.getAttribute('datetime'), title: node.getAttribute('title'), text: node.textContent, style: sample(node).style })),
      ownedCounts: { list: document.querySelectorAll('.geld-provider-list-counts').length, panels: document.querySelectorAll('.geld-provider-review').length, hover: document.querySelectorAll('#geld-provider-count-tooltip').length },
      listRows: [...document.querySelectorAll('.merge-request, [data-testid="issuable-container"], [role="row"]')].filter(visible).slice(0, 25).map(sample),
      theme: { selection: document.documentElement.getAttribute('data-theme'), mode: document.documentElement.getAttribute('data-color-mode'), body: sample(document.body).style } };
  });
}

async function nativeLinkHover(page, kind, artifactName) {
  const selector = kind === 'merge_request' ? 'a[data-reference-type="merge_request"]' : 'a[data-reference-type="commit"], a.gfm-commit';
  const handles = await page.$$(selector);
  let chosen;
  for (const handle of handles) {
    const eligible = await handle.evaluate((node) => node.closest('[data-geld-ui], .geld-provider-review') === null && node.getBoundingClientRect().height > 0);
    if (eligible) { chosen = handle; break; }
  }
  if (chosen === undefined) return { status: 'unavailable', reason: `No visible native ${kind} reference link was observed`, selector };
  const trigger = await chosen.evaluate((node) => ({ href: node.href, text: node.textContent.trim(), attributes: Object.fromEntries([...node.attributes].filter((attr) => /^data-(reference-type|project-path|iid|commit|project)$/.test(attr.name)).map((attr) => [attr.name, attr.value])) }));
  try {
    await page.keyboard.press('Escape');
    await page.mouse.move(1, 1);
    await chosen.scrollIntoView();
    await chosen.hover();
    const observation = await poll(() => page.evaluate((type) => {
      const visible = (node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
      const overlays = [...document.querySelectorAll('.gl-popover, .popover, [data-testid="commit-popover"], [role="tooltip"]')].filter(visible).map((node) => {
        const style = getComputedStyle(node);
        return { id: node.id, className: node.className, role: node.getAttribute('role'), owned: node.closest('[data-geld-ui], #geld-provider-count-tooltip') !== null,
          kind: node.querySelector('.mr-popover') !== null ? 'merge_request' : node.matches('[data-testid="commit-popover"]') || node.querySelector('[data-testid="commit-title-link"], [data-testid="commit-sha-link"]') !== null ? 'commit' : 'other',
          text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 3000), links: [...node.querySelectorAll('a[href]')].slice(0, 12).map((link) => ({ href: link.href, text: link.textContent.trim() })),
          styles: Object.fromEntries(['fontFamily', 'fontSize', 'lineHeight', 'color', 'backgroundColor', 'border', 'borderRadius', 'filter', 'boxShadow'].map((key) => [key, style[key]])),
          nativeCounts: [...node.querySelectorAll('[data-testid="diff-stats-additions"], [data-testid="diff-stats-deletions"]')].map((count) => ({ hook: count.getAttribute('data-testid'), text: count.textContent })) };
      });
      return { requestedKind: type, overlays, owners: [...document.querySelectorAll('[aria-describedby]')].filter((node) => visible(node) && overlays.some((overlay) => overlay.id !== '' && (node.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(overlay.id))).slice(0, 8).map((node) => ({ tag: node.tagName, href: node.getAttribute('href'), describedBy: node.getAttribute('aria-describedby') })) };
    }, kind), (value) => value.overlays.some((overlay) => !overlay.owned && overlay.kind === kind), 'Observed native provider reference card', 8000);
    return { status: 'discovery', trigger, ...observation, artifacts: await capture(page, artifactName) };
  } catch (error) {
    return { status: 'unavailable', trigger, reason: errorText(error), artifacts: page.isClosed() ? null : await capture(page, `${artifactName}-unavailable`) };
  } finally {
    if (!page.isClosed()) { await page.keyboard.press('Escape'); await page.mouse.move(1, 1); }
    for (const handle of handles) await discardHandle(handle);
  }
}

async function publicJson(page, url) {
  return page.evaluate(async (target) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await fetch(target, { method: 'GET', credentials: 'omit', signal: abort.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) return { status: response.status, retryAfter: response.headers.get('retry-after'), body: null };
      return { status: response.status, body: await response.json() };
    } catch (error) { return { status: null, body: null, error: error instanceof Error ? error.message : String(error) }; }
    finally { clearTimeout(timer); }
  }, url);
}

function bitbucketReviewUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://bitbucket.org' && url.username === '' && url.password === '' && /^\/[^/]+\/[^/]+\/pull-requests\/[1-9]\d*\/?$/.test(url.pathname) ? `${url.origin}${url.pathname}` : null;
  } catch { return null; }
}

async function unavailableDiscovery(name, reason, extra = {}) {
  report.cases.push({ name, purpose: 'Read-only native surface discovery. No feature parity assertion.', status: focus === 'all' ? 'unavailable' : 'not_selected', reason: focus === 'all' ? reason : `Broad discovery excluded from budget-aware ${focus} slice. No request or feature pass.`, ...extra, finishedAt: new Date().toISOString() });
  await saveReport();
}

async function gitLabListCounts(page, name) {
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  const read = () => page.evaluate(() => {
    const title = [...document.querySelectorAll('a[data-testid="issuable-title-link"][href]')].find((link) => new URL(link.href).pathname.replace(/\/$/, '') === '/gitlab-org/gitlab/-/merge_requests/266334');
    const row = title?.closest('li.merge-request[data-testid="issuable-container"], li.merge-request[data-testid="issuable-item-wrapper"]');
    if (row == null) return null;
    const chip = row.querySelector('.geld-provider-list-counts');
    return { id: row.id, author: row.querySelector('[data-testid="issuable-author"]')?.getAttribute('data-username'), hidden: row.hidden, authorHidden: row.hasAttribute('data-geld-provider-author-hidden'), display: getComputedStyle(row).display,
      chip: chip === null ? null : { text: chip.textContent.replace(/\s+/g, ' ').trim(), title: chip.getAttribute('title'), tabindex: chip.getAttribute('tabindex') },
      nativeIds: [row, ...row.querySelectorAll('[id]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => node.id),
      nativeLinks: [...row.querySelectorAll('a[href]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => ({ href: node.getAttribute('href'), testid: node.getAttribute('data-testid'), label: node.getAttribute('aria-label') })) };
  });
  const settled = (value) => value !== null && value.hidden === false && value.authorHidden === false && value.display !== 'none' && value.chip !== null && /\b1 test\b/.test(value.chip.text) && value.chip.text.includes('+4') && value.chip.text.includes('−0') && !/Counting|unavailable/.test(value.chip.text);
  try {
    await patchSettings({ showListStats: true, hiddenAuthors: [] });
    const initial = await poll(read, settled, 'Known GitLab MR266334 same-row chip settles at1 test and+4−0');
    assert.ok(initial.id !== '' && typeof initial.author === 'string' && initial.author !== '', 'Native list row ID and author login must be observed');
    const selector = `[id=${JSON.stringify(initial.id)}] .geld-provider-list-counts`;
    const pointer = await installedHover(page, selector, 'pointer', `${name}-pointer-hover`);
    const keyboard = await installedHover(page, selector, 'keyboard', `${name}-keyboard-hover`);
    const expected = [
      { label: 'Essential', files: '2 files', additions: '+4', deletions: '−0' },
      { label: 'Tests', files: '1 file', additions: '+32', deletions: '−0' },
      { label: 'Total', files: '3 files', additions: '+36', deletions: '−0' },
    ];
    for (const value of [pointer, keyboard]) {
      for (const row of expected) assert.deepEqual(value.rows.find((item) => item.label === row.label), row, 'Actual list breakdown differs from the verified complete MR diff');
    }
    assert.equal(pointer.text, keyboard.text, 'Pointer and real Tab-key list breakdowns disagree');
    await patchSettings({ showListStats: false });
    const statsOff = await poll(read, (value) => value !== null && value.chip === null && value.display !== 'none', 'Real showListStats storage toggle removes the same-row chip');
    assert.deepEqual(statsOff.nativeIds, initial.nativeIds, 'List toggle changed native row IDs');
    assert.deepEqual(statsOff.nativeLinks, initial.nativeLinks, 'List toggle changed native title/status links');
    await patchSettings({ showListStats: true });
    const statsRestored = await poll(read, settled, 'Real showListStats restoration restores the settled same-row chip');
    await patchSettings({ hiddenAuthors: [initial.author] });
    const authorHidden = await poll(read, (value) => value !== null && value.authorHidden === true && value.display === 'none' && value.chip === null, 'Observed native author rule visually hides the actual list row with its owned attribute');
    assert.equal(authorHidden.hidden, initial.hidden, 'Author filtering changed the provider-owned hidden property');
    assert.deepEqual(authorHidden.nativeIds, initial.nativeIds, 'Author filtering removed native row IDs');
    assert.deepEqual(authorHidden.nativeLinks, initial.nativeLinks, 'Author filtering changed native status/title links');
    await patchSettings({ hiddenAuthors: [] });
    const authorRestored = await poll(read, settled, 'Removing the author rule restores the native row and settled chip');
    assert.equal(authorRestored.hidden, initial.hidden, 'Author restoration changed the provider-owned hidden property');
    assert.deepEqual(authorRestored.nativeIds, initial.nativeIds, 'Author restoration changed native row IDs');
    assert.deepEqual(authorRestored.nativeLinks, initial.nativeLinks, 'Author restoration changed native title/status links');
    return { initial, pointer, keyboard, statsOff, statsRestored, authorHidden, authorRestored, ruleBasis: 'Native selected row data-username, not a guessed author login' };
  } finally { await patchSettings({ showListStats: original.showListStats ?? true, hiddenAuthors: original.hiddenAuthors ?? [] }); }
}

async function openReviewAncestors(page, selector) {
  let clicks = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const handle = await page.evaluateHandle((selector) => {
      const target = document.querySelector(selector);
      const closed = [];
      for (let node = target?.parentElement; node != null; node = node.parentElement) if (node instanceof HTMLDetailsElement && !node.open) closed.push(node);
      return closed.at(-1)?.querySelector(':scope > summary') ?? null;
    }, selector);
    const summary = handle.asElement();
    if (summary === null) { await discardHandle(handle); return clicks; }
    await summary.click();
    await discardHandle(handle);
    clicks += 1;
  }
  throw new Error('Review disclosure nesting did not settle after real summary clicks');
}

async function localReviewedStorage() {
  return options.evaluate(async () => ({ local: (await chrome.storage.local.get('providerReviewedItems')).providerReviewedItems ?? {}, synchronized: Object.hasOwn(await chrome.storage.sync.get('providerReviewedItems'), 'providerReviewedItems') }));
}

function assertReviewedStorage(value, itemId, reviewKey, headSha) {
  assert.equal(value.synchronized, false, 'Device review marks leaked into synchronized settings');
  let selected = null;
  for (const [bucket, record] of Object.entries(value.local)) {
    assert.deepEqual(Object.keys(record).sort(), ['headSha', 'items', 'reviewKey', 'updatedAt'], 'Local review storage retained unexpected source fields');
    assert.equal(bucket, JSON.stringify([record.reviewKey, record.headSha]), 'Local review storage key does not match its actual review/head');
    assert.match(record.headSha, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    assert.ok(Number.isFinite(record.updatedAt) && record.updatedAt > 0);
    for (const [id, fingerprint] of Object.entries(record.items)) {
      assert.match(id, /^[a-zA-Z0-9_-]{1,180}$/);
      assert.match(fingerprint, /^[a-f0-9]{64}$/, 'Local review record contains source text instead of a SHA256 fingerprint');
    }
    if (record.reviewKey === reviewKey && record.headSha === headSha && Object.hasOwn(record.items, itemId)) selected = record;
  }
  return selected;
}

async function localReviewedFlag(page, recordFragment) {
  const initial = await poll(() => page.evaluate(() => {
    for (const button of document.querySelectorAll('.geld-provider-review [data-geld-local-reviewed]')) {
      const source = [...button.closest('[data-geld-item]')?.querySelectorAll('[data-geld-source]') ?? []].find((source) => {
        const byline = source.querySelector(':scope > .geld-provider-review__byline');
        const native = document.getElementById(source.getAttribute('data-geld-source'));
        return byline !== null && ![...byline.children].some((node) => node.textContent.trim() === 'Automated account') && native?.querySelector('.note-header a.author-name-link[data-user-id]') !== null && native != null;
      });
      if (source !== undefined) return { id: button.getAttribute('data-geld-local-reviewed'), humanAnchor: source.getAttribute('data-geld-source'), pressed: button.getAttribute('aria-pressed'), disabled: button.disabled };
    }
    return null;
  }), (value) => value !== null && value.id !== '' && value.pressed === 'false' && !value.disabled, 'First installed local-review control becomes available');
  const itemId = initial.id;
  const selector = `.geld-provider-review [data-geld-local-reviewed=${JSON.stringify(itemId)}]`;
  const observe = () => page.evaluate((itemId) => {
    const panel = document.querySelector('.geld-provider-review');
    const button = [...panel?.querySelectorAll('[data-geld-local-reviewed]') ?? []].find((node) => node.getAttribute('data-geld-local-reviewed') === itemId);
    const item = button?.closest('[data-geld-item]');
    if (panel === null || button === undefined || item === null || item === undefined) return null;
    let headSha = null;
    let headEvidence = null;
    try {
      const app = JSON.parse(document.querySelector('[data-rapid-diffs][data-app-data]')?.getAttribute('data-app-data') ?? 'null');
      const review = /^(.*\/-\/merge_requests\/([1-9]\d*))\/?$/.exec(location.pathname);
      const selected = app?.versions?.source_versions?.filter((version) => version.selected === true && version.latest === true) ?? [];
      if (review !== null && app?.mr_path === review[1] && String(app?.iid) === review[2] && selected.length === 1) {
        headSha = selected[0].head_sha;
        headEvidence = { mrPath: app.mr_path, iid: app.iid, versionId: selected[0].id, selected: selected[0].selected, latest: selected[0].latest };
      }
    } catch { /* Native Rapid Diffs data may still be hydrating. */ }
    const anchors = [...item.querySelectorAll('[data-geld-source]')].map((node) => node.getAttribute('data-geld-source'));
    const sources = anchors.map((anchor) => {
      const source = document.getElementById(anchor);
      const thread = source?.closest('[data-testid="discussion-content"][data-discussion-id]');
      return { anchor, nativeId: source?.id ?? null, discussionId: thread?.getAttribute('data-discussion-id') ?? null, resolved: thread?.getAttribute('data-discussion-resolved') ?? null, resolvable: thread?.getAttribute('data-discussion-resolvable') ?? null };
    });
    const rows = (selector) => [...panel.querySelectorAll(selector)].map((node) => ({ id: node.getAttribute('data-geld-review-bot'), state: node.getAttribute('data-state'), text: node.textContent.replace(/\s+/g, ' ').trim(), links: [...node.querySelectorAll('a[href]')].map((link) => link.href) }));
    return { itemId, headSha, headEvidence, pressed: button.getAttribute('aria-pressed'), disabled: button.disabled, buttonText: button.textContent,
      localStatus: item.getAttribute('data-state'), statusText: item.querySelector('.geld-provider-review__item-state')?.textContent,
      group: item.closest('[data-geld-review-group]')?.getAttribute('data-geld-review-group'), notice: item.querySelector('[data-geld-local-review-notice]')?.textContent ?? null,
      sourceLinks: [...item.querySelectorAll('[data-geld-source] .geld-provider-review__byline > a[href]')].map((link) => link.href), nativeSources: sources, checks: rows('.geld-provider-review__check'), bots: rows('[data-geld-review-bot]'), aiRunControls: panel.querySelectorAll('[data-geld-ai-run]').length };
  }, itemId);
  const original = await poll(observe, (value) => value !== null && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.headSha) && value.sourceLinks.length > 0 && value.nativeSources.some((source) => source.nativeId !== null) && !value.disabled, 'Local mark has an actual native source head, original source and canonical links');
  assert.equal(original.aiRunControls, 0, 'Local flag smoke must not expose an AI run');
  assert.ok(['open', 'needs-reply', 'addressed'].includes(original.localStatus), 'First native item must be an actionable local review item');
  const url = new URL(page.url());
  const match = /^(.*)\/-\/merge_requests\/([1-9]\d*)/.exec(url.pathname);
  assert.ok(match !== null);
  const reviewKey = `gitlab@${url.origin}:${encodeURIComponent(match[1].slice(1))}!${match[2]}`;
  const beforeStorage = await localReviewedStorage();
  assert.equal(assertReviewedStorage(beforeStorage, itemId, reviewKey, original.headSha), null, 'Fresh browser unexpectedly has a current local mark');
  const mutations = [];
  const request = (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) || providerOf(request.url()) !== 'gitlab') return;
    const url = new URL(request.url());
    const mutation = url.pathname === '/api/graphql' ? /\bmutation\b/.test(request.postData() ?? '') : /\/(?:notes|discussions|draft_notes|approve|unapprove|reviews|merge)(?:\/|$)/.test(url.pathname);
    if (mutation) mutations.push({ method: request.method(), url: safeUrl(request.url()) });
  };
  const unchanged = (value) => {
    assert.equal(value.headSha, original.headSha, 'Native review head changed during local flag verification');
    assert.deepEqual(value.sourceLinks, original.sourceLinks, 'Local mark changed original comment links');
    for (const source of original.nativeSources.filter((source) => source.nativeId !== null)) assert.deepEqual(value.nativeSources.find((candidate) => candidate.anchor === source.anchor), source, 'Local mark changed an observed native thread status or identity');
    assert.deepEqual(value.checks, original.checks, 'Local mark changed native CI results');
    assert.deepEqual(value.bots, original.bots, 'Local mark changed a bot verdict');
    assert.equal(value.aiRunControls, 0);
  };
  page.on('request', request);
  try {
    const openedSummaries = await openReviewAncestors(page, selector);
    await page.click(selector);
    const marked = await poll(observe, (value) => value !== null && value.pressed === 'true' && !value.disabled && value.group === 'done' && value.notice?.includes(`Native status: ${original.statusText}.`), 'Real local mark moves the item to Reviewed on this device while retaining native status');
    unchanged(marked);
    const stored = await localReviewedStorage();
    assert.ok(assertReviewedStorage(stored, itemId, reviewKey, original.headSha) !== null, 'Actual chrome.storage.local did not persist the current mark');
    const markedArtifacts = await capture(page, 'gitlab-local-reviewed-marked');
    const nativeFragment = await nativeFragmentEvidence(page, initial.humanAnchor, () => observe().then(unchanged), recordFragment);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    const reloaded = await poll(observe, (value) => value !== null && value.pressed === 'true' && !value.disabled && value.group === 'done', 'Actual page reload rehydrates the exact item/head mark through the installed storage service');
    unchanged(reloaded);
    const reopenedSummaries = await openReviewAncestors(page, selector);
    await page.click(selector);
    const undone = await poll(observe, (value) => value !== null && value.pressed === 'false' && !value.disabled && value.notice === null && value.localStatus === original.localStatus, 'Real Undo removes only the local review mark');
    unchanged(undone);
    const afterStorage = await poll(localReviewedStorage, (value) => assertReviewedStorage(value, itemId, reviewKey, original.headSha) === null, 'Actual local storage removes the undone flag');
    assert.deepEqual(mutations, [], 'Local reviewed flag attempted a native provider mutation');
    return { itemId, reviewKey, sourceHead: original.headSha, openedSummaries, original, marked, stored, markedArtifacts, nativeFragment, reloaded, reopenedSummaries, undone, afterStorage, providerMutations: mutations, undoneArtifacts: await capture(page, 'gitlab-local-reviewed-undone'), storageScope: 'Actual chrome.storage.local metadata and SHA256 fingerprints only, absent from chrome.storage.sync' };
  } finally { page.off('request', request); }
}

async function nativeFragmentEvidence(page, anchor, assertSourcesUnchanged, record = () => undefined) {
  assert.match(anchor, /^note_[1-9]\d*$/, 'Fragment evidence requires an actual native human source anchor');
  const previousUrl = page.url();
  const settings = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  const controlSelector = `.geld-provider-original:has(+ [id="${anchor}"]) button`;
  const read = () => page.evaluate((anchor) => {
    const root = document.getElementById(anchor);
    if (root === null) return null;
    const button = root.previousElementSibling?.matches('.geld-provider-original') ? root.previousElementSibling.querySelector('button') : null;
    const rect = root.getBoundingClientRect();const style = getComputedStyle(root);
    return { nativeId: root.id, name: root.querySelector('[data-testid="author-name"]')?.textContent.trim() ?? null, body: root.querySelector('.note-body .note-text')?.textContent.trim() ?? null,
      nativePermalinks: [...root.querySelectorAll('a[href]')].filter((node) => node.getAttribute('href') === `#${anchor}`).map((node) => node.getAttribute('href')),
      hidden: root.getAttribute('hidden'), owner: root.getAttribute('data-geld-provider-native-find'), oldHiddenFlag: root.hasAttribute('data-geld-provider-compact-hidden'),
      box: { height: rect.height, display: style.display, contentVisibility: style.contentVisibility, marginTop: style.marginTop, marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTop: style.borderTopWidth, borderBottom: style.borderBottomWidth },
      control: button === null ? null : { label: button.textContent.trim(), expanded: button.getAttribute('aria-expanded') }, hash: location.hash };
  }, anchor);
  const evidence = { kind: 'Actual same-page fragment navigation; browser Ctrl+F is not exercised', capability: null, before: await read() };
  record(evidence);
  assert.ok(evidence.before !== null, 'Actual human original must be present before native-fragment verification');
  const preserved = (value) => {
    assert.equal(value.nativeId, evidence.before.nativeId);
    assert.equal(value.body, evidence.before.body, 'Fragment/compaction changed native source text');
    assert.equal(value.name, evidence.before.name);
    assert.deepEqual(value.nativePermalinks, evidence.before.nativePermalinks);
  };
  try {
    evidence.capability = await page.evaluate((anchor) => {
      const probe = document.createElement('div');probe.setAttribute('hidden', 'until-found');
      const events = [];
      const capture = (event) => { const target = event.target instanceof Element ? event.target : null;events.push({ type: event.type, trusted: event.isTrusted, target: target?.id ?? null, targetContainsAnchor: target?.contains(document.getElementById(anchor)) ?? false, url: location.href }); };
      document.addEventListener('beforematch', capture, true);window.addEventListener('hashchange', capture, true);
      globalThis.__geldNativeFragmentEvidence = { events, cleanup: () => { document.removeEventListener('beforematch', capture, true);window.removeEventListener('hashchange', capture, true); } };
      return { untilFoundIDL: Reflect.get(probe, 'hidden'), beforematchProperty: 'onbeforematch' in probe };
    }, anchor);
    assert.equal(evidence.capability.untilFoundIDL, 'until-found');assert.equal(evidence.capability.beforematchProperty, true);
    await patchSettings({ compactTimeline: 'minimal' });
    evidence.folded = await poll(read, (value) => value !== null && value.hidden === 'until-found' && value.owner === 'folded' && value.control?.label === 'Show original conversation entry' && value.control.expanded === 'false', 'Reviewed human native original folds with real until-found and truthful Show control');
    preserved(evidence.folded);assert.equal(evidence.folded.oldHiddenFlag, false);
    assert.ok(evidence.folded.box.height <= 0.5 && evidence.folded.box.display !== 'none' && evidence.folded.box.contentVisibility === 'hidden', 'Folded original must retain browser-searchable display with a zero CSS box');
    for (const key of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'borderTop', 'borderBottom']) assert.equal(evidence.folded.box[key], '0px');
    await assertSourcesUnchanged();
    evidence.foldedArtifacts = await capture(page, 'gitlab-native-original-folded');
    await page.evaluate((anchor) => { location.hash = anchor; }, anchor);
    evidence.revealed = await poll(read, (value) => value !== null && value.hidden === null && value.owner === null && value.box.height > 0 && value.control?.label === 'Hide original conversation entry' && value.control.expanded === 'true' && decodeURIComponent(value.hash.slice(1)) === anchor, 'Actual browser fragment navigation reveals the native original and updates Hide control');
    preserved(evidence.revealed);await assertSourcesUnchanged();
    evidence.events = await page.evaluate(() => globalThis.__geldNativeFragmentEvidence.events);
    evidence.trustedBeforematch = evidence.events.some((event) => event.type === 'beforematch' && event.trusted && (event.target === anchor || event.targetContainsAnchor));
    assert.ok(evidence.events.some((event) => event.type === 'hashchange' && event.trusted), 'Actual browser fragment navigation must emit its native hashchange event');
    evidence.revealMechanism = evidence.trustedBeforematch ? 'Browser-generated trusted beforematch during actual fragment navigation; Ctrl+F remains untested' : 'Actual browser fragment/hashchange fallback; no trusted beforematch or Ctrl+F claim';
    evidence.revealedArtifacts = await capture(page, 'gitlab-native-original-fragment-revealed');
    evidence.hideClick = await trustedHiddenToggle(page, /^Hide original conversation entry$/, controlSelector);
    evidence.manuallyFolded = await poll(read, (value) => value !== null && value.hidden === 'until-found' && value.owner === 'folded' && value.control?.label === 'Show original conversation entry', 'Trusted Hide keeps the original folded despite its unchanged current fragment');
    await options.bringToFront();await poll(() => page.evaluate(() => document.hidden), Boolean, 'Actual native-original review tab becomes hidden');
    await page.bringToFront();await poll(() => page.evaluate(() => document.hidden), (value) => value === false, 'Actual native-original review tab returns visible');
    evidence.reapplied = await poll(read, (value) => value !== null && value.hidden === 'until-found' && value.owner === 'folded' && value.control?.expanded === 'false' && value.hash === evidence.manuallyFolded.hash, 'Explicit original Hide survives real visibility reapply with unchanged fragment');
    preserved(evidence.reapplied);await assertSourcesUnchanged();
    return evidence;
  } finally {
    await patchSettings({ compactTimeline: settings.compactTimeline ?? 'compact' });
    if (!page.isClosed()) await page.evaluate((url) => {
      globalThis.__geldNativeFragmentEvidence?.cleanup();delete globalThis.__geldNativeFragmentEvidence;
      history.replaceState(history.state, '', url);
    }, previousUrl);
  }
}

async function bitbucketListCounts(page) {
  const selector = 'tr[data-qa="pull-request-row"]:has(a[data-qa="pull-request-row-link"][href="/atlassian/bitbucket-upload-file/pull-requests/27"]) .geld-provider-list-counts';
  await page.waitForSelector('#search-pull-requests-input', { visible: true, timeout: WAIT_MS });
  await page.type('#search-pull-requests-input', 'BCAT-6005', { delay: 10 });
  const nativeFilter = await poll(() => page.evaluate(() => ({
    value: document.querySelector('#search-pull-requests-input')?.value ?? null,
    reviewPaths: [...new Set([...document.querySelectorAll('tr[data-qa="pull-request-row"] a[data-qa="pull-request-row-link"]')].map((link) => new URL(link.href).pathname))],
    url: location.href,
    chips: document.querySelectorAll('.geld-provider-list-counts').length,
  })), (value) => value.value === 'BCAT-6005' && value.reviewPaths.length === 1 && value.reviewPaths[0] === '/atlassian/bitbucket-upload-file/pull-requests/27' && value.chips === 0, 'Actual native Bitbucket search narrows to PR27 before any extension list counts are enabled');
  await patchSettings({ showListStats: true });
  const coldLabel = await poll(() => page.evaluate((selector) => [...document.querySelectorAll(selector)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)?.textContent ?? null, selector), (value) => value !== null, 'Visible native-row chip is available for actual anonymous pointer intent');
  // Real pointer intent is required for a cold anonymous list row; native list search alone does not request source diffs.
  const intent = await page.evaluateHandle((selector) => [...document.querySelectorAll(selector)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0), selector);
  assert.ok(intent.asElement() !== null);
  await intent.asElement().hover();
  await discardHandle(intent);
  const read = () => page.evaluate(() => {
    const title = [...document.querySelectorAll('a[data-qa="pull-request-row-link"]')].find((node) => new URL(node.href).pathname === '/atlassian/bitbucket-upload-file/pull-requests/27' && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
    const row = title?.closest('tr[data-qa="pull-request-row"]');
    if (row == null) return null;
    const chip = title.parentElement?.querySelector('.geld-provider-list-counts');
    return { text: chip?.textContent.replace(/\s+/g, ' ').trim() ?? null, title: chip?.getAttribute('title') ?? null,
      nativeIds: [row, ...row.querySelectorAll('[id]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => node.id).filter(Boolean),
      nativeLinks: [...row.querySelectorAll('a[href]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => ({ href: node.getAttribute('href'), qa: node.getAttribute('data-qa') })), rowHidden: row.hidden, display: getComputedStyle(row).display };
  });
  const initial = await poll(read, (value) => value !== null && /\b0 tests?\b/.test(value.text ?? '') && value.text.includes('+46') && value.text.includes('−29') && !/Counting|unavailable/.test(value.text), 'Visible native Bitbucket PR27 row settles at zero tests and+46−29');
  const pointer = await installedHover(page, selector, 'pointer', 'bitbucket-list-pointer-hover');
  const keyboard = await installedHover(page, selector, 'keyboard', 'bitbucket-list-keyboard-hover');
  const expectedTotal = { label: 'Total', files: '5 files', additions: '+46', deletions: '−29' };
  for (const hover of [pointer, keyboard]) {
    assert.deepEqual(hover.rows.find((row) => row.label === 'Essential'), { ...expectedTotal, label: 'Essential' });
    assert.deepEqual(hover.rows.find((row) => row.label === 'Tests'), { label: 'Tests', files: '0 files', additions: '+0', deletions: '−0' });
    assert.deepEqual(hover.rows.find((row) => row.label === 'Total'), expectedTotal);
  }
  assert.equal(pointer.text, keyboard.text);
  const proof = report.cases.find((item) => item.name === 'bitbucket-diff')?.derivedHidden;
  assert.ok(proof?.path === 'pipe/pipe.py' && proof.files === 1 && Number.isFinite(proof.additions) && Number.isFinite(proof.deletions), 'Required PR27 diff must establish actual selected-file totals before its list cross-check');
  const visible = { files: 4, additions: 46 - proof.additions, deletions: 29 - proof.deletions };
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  let filtered;
  let filteredHover;
  try {
    await patchSettings({ categoryPatterns: { ...original.categoryPatterns, tests: ['pipe/pipe.py'] } });
    filtered = await poll(read, (value) => value !== null && /\b1 test\b/.test(value.text ?? '') && value.text.includes(`+${visible.additions}`) && value.text.includes(`−${visible.deletions}`), 'Shared custom pattern updates the actual same-row Bitbucket chip');
    filteredHover = await installedHover(page, selector, 'keyboard', 'bitbucket-list-filtered-hover');
    assert.deepEqual(filteredHover.rows.find((row) => row.label === 'Essential'), { label: 'Essential', files: '4 files', additions: `+${visible.additions}`, deletions: `−${visible.deletions}` });
    assert.deepEqual(filteredHover.rows.find((row) => row.label === 'Tests'), { label: 'Tests', files: '1 file', additions: `+${proof.additions}`, deletions: `−${proof.deletions}` });
    assert.deepEqual(filteredHover.rows.find((row) => row.label === 'Total'), expectedTotal);
    assert.deepEqual(filtered.nativeIds, initial.nativeIds);assert.deepEqual(filtered.nativeLinks, initial.nativeLinks);
  } finally { await patchSettings({ categoryPatterns: original.categoryPatterns ?? {} }); }
  const restored = await poll(read, (value) => value !== null && value.text === initial.text, 'Removing the shared custom pattern restores native Bitbucket list counts');
  assert.deepEqual(restored.nativeIds, initial.nativeIds);assert.deepEqual(restored.nativeLinks, initial.nativeLinks);
  return { selection: 'Real native #search-pull-requests-input search narrows to PR27 while shared list stats are disabled; only then are counts enabled and actual pointer intent applied. No invented query parameter or other-row DOM hiding.', nativeFilter, coldLabel, initial, pointer, keyboard, runtimeDiffProof: proof, visible, filtered, filteredHover, restored,
    nativeFingerprint: createHash('sha256').update(JSON.stringify({ ids: initial.nativeIds, links: initial.nativeLinks })).digest('hex') };
}

async function authorPresentationProbe(page, provider, anchor) {
  const selector = `.geld-provider-review [data-geld-source="${anchor}"]`;
  const openedSummaries = await openReviewAncestors(page, selector);
  const measurement = await page.evaluate((provider, anchor) => {
    const native = document.getElementById(anchor);
    const source = [...document.querySelectorAll('.geld-provider-review [data-geld-source]')].find((node) => node.getAttribute('data-geld-source') === anchor);
    const byline = source?.querySelector(':scope > .geld-provider-review__byline');
    const nativeHeader = provider === 'gitlab' ? native?.querySelector(':scope > .timeline-entry-inner > .timeline-content > .note-header') : native?.querySelector('[data-testid="comment-header"]');
    const nativeNameRoot = provider === 'gitlab' ? nativeHeader?.querySelector('[data-testid="author-name"]') : nativeHeader?.querySelector(':scope > span:first-child');
    const displayName = nativeNameRoot?.textContent.trim() ?? null;
    const nativeName = provider === 'bitbucket' && nativeNameRoot != null ? [...nativeNameRoot.querySelectorAll('span')].find((node) => node.children.length === 0 && node.textContent.trim() === displayName) ?? nativeNameRoot : nativeNameRoot;
    const nativeAlias = provider === 'gitlab' ? nativeHeader?.querySelector('.author-username-link .note-headline-light') : null;
    const alias = nativeAlias?.textContent.trim() ?? null;
    const nativeProfile = provider === 'gitlab' ? nativeHeader?.querySelector('a.author-name-link[data-user-id][data-username]') : null;
    const nativeAvatar = provider === 'gitlab' ? native?.querySelector(':scope > .timeline-entry-inner > .timeline-avatar > a.gl-avatar-link[data-user-id] > img.gl-avatar') : native?.querySelector(':scope > div:first-child img[data-vc="avatar-image"]');
    const nativeBadges = provider === 'gitlab' ? [...nativeHeader?.querySelectorAll(':scope > .note-actions > .gl-badge') ?? []] : [];
    const sample = (node) => {
      if (node == null) return null;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'width', 'height', 'borderRadius', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxShadow'];
      return { tag: node.tagName, text: node.textContent.trim(), presented: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', style: Object.fromEntries(keys.map((key) => [key, style[key]])), rect: { width: rect.width, height: rect.height }, src: node instanceof HTMLImageElement ? node.src : null };
    };
    const ownBadges = [...byline?.querySelectorAll(':scope > [data-geld-author-badge]') ?? []];
    return { provider, anchor, nativeExists: native !== null, sourceExists: source !== undefined, displayName, alias,
      theme: { native: document.documentElement.getAttribute('data-theme'), colorMode: document.documentElement.getAttribute('data-color-mode'), darkPreference: matchMedia('(prefers-color-scheme: dark)').matches },
      name: { native: sample(nativeName), owned: sample(byline?.querySelector(':scope > [data-geld-author-profile] > strong, :scope > strong')) },
      aliasPair: { native: sample(nativeAlias), owned: sample([...byline?.querySelectorAll(':scope > .geld-provider-review__muted') ?? []].find((node) => node.textContent.trim() === alias)) },
      profile: { native: nativeProfile?.href ?? null, owned: byline?.querySelector(':scope > [data-geld-author-profile]')?.href ?? null },
      avatar: { native: sample(nativeAvatar), owned: sample(byline?.querySelector(':scope > [data-geld-author-avatar]')) },
      badges: nativeBadges.map((badge) => { const label = badge.querySelector(':scope > .gl-badge-content')?.textContent.trim() ?? badge.textContent.trim();const own = ownBadges.find((node) => node.textContent.trim() === label);return { label, native: sample(badge), nativeText: sample(badge.querySelector(':scope > .gl-badge-content') ?? badge), owned: sample(own) }; }),
      uncoveredNative: provider === 'bitbucket' ? ['No native profile URL, alias or role badge is presented by this captured public Bitbucket author header.'] : [],
    };
  }, provider, anchor);
  return { ...measurement, openedSummaries, ...compareAuthorPresentation(measurement) };
}

function compareAuthorPresentation(value) {
  const mismatches = [];
  const uncovered = [...value.uncoveredNative];
  const covered = [];
  const equal = (label, actual, expected) => { if (actual !== expected) mismatches.push({ label, native: expected, owned: actual }); };
  const typography = ['fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'color'];
  const pair = (label, native, owned, keys, text = true) => {
    if (native === null || !native.presented) { uncovered.push(`${label}: native element absent or not presented at this viewport`);return false; }
    covered.push(label);
    if (owned === null || !owned.presented) { mismatches.push({ label, native: 'presented', owned: 'absent or not presented' });return false; }
    if (text) equal(`${label}.text`, owned.text, native.text);
    for (const key of keys) equal(`${label}.${key}`, owned.style[key], native.style[key]);
    return true;
  };
  pair('author name', value.name.native, value.name.owned, typography);
  pair('author alias', value.aliasPair.native, value.aliasPair.owned, typography);
  if (value.profile.native !== null) { covered.push('author profile permalink');equal('author profile permalink', value.profile.owned, value.profile.native); }
  else uncovered.push('author profile permalink: native URL unavailable');
  if (pair('author avatar', value.avatar.native, value.avatar.owned, ['width', 'height', 'borderRadius'], false)) {
    equal('author avatar.rect.width', value.avatar.owned.rect.width, value.avatar.native.rect.width);
    equal('author avatar.rect.height', value.avatar.owned.rect.height, value.avatar.native.rect.height);
    equal('author avatar.src', value.avatar.owned.src, value.avatar.native.src);
  }
  for (const badge of value.badges) {
    if (!pair(`author badge ${badge.label}`, badge.native, badge.owned, ['backgroundColor', 'borderRadius', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxShadow'])) continue;
    pair(`author badge ${badge.label} text`, badge.nativeText, badge.owned, typography);
    equal(`author badge ${badge.label}.rect.width`, badge.owned.rect.width, badge.native.rect.width);
    equal(`author badge ${badge.label}.rect.height`, badge.owned.rect.height, badge.native.rect.height);
  }
  if (value.badges.length === 0) uncovered.push('author role badges: no native badges observed');
  return { covered, uncovered, mismatches };
}

async function authorThemeEvidence(page, provider, anchor) {
  const baseline = await authorPresentationProbe(page, provider, anchor);
  const evidence = { baseline, darkPreferenceProbe: null };
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await pause(300);
    const dark = await authorPresentationProbe(page, provider, anchor);
    const colors = (sample) => sample == null ? null : ['color', 'backgroundColor', 'borderTopColor', 'boxShadow'].map((key) => sample.style[key]);
    const nativeSignature = (value) => JSON.stringify([colors(value.name.native), colors(value.aliasPair.native), colors(value.avatar.native), value.badges.map((badge) => [colors(badge.native), colors(badge.nativeText)])]);
    const changed = nativeSignature(baseline) !== nativeSignature(dark);
    evidence.darkPreferenceProbe = { mechanism: 'OS prefers-color-scheme emulation on the same loaded page only; no manual theme class, CSS injection or extra API request', nativeThemeChanged: changed, status: changed ? 'native_scheme_observed' : 'site_did_not_select_dark_theme', measurement: dark };
    if (changed) evidence.darkPreferenceProbe.artifacts = await capture(page, `${provider}-author-os-dark`);
  } finally { await page.emulateMediaFeatures([]); }
  return evidence;
}

function assertAuthorThemeEvidence(evidence) {
  assert.deepEqual(evidence.baseline.mismatches, [], 'Captured native/owned author presentation differs');
  if (evidence.darkPreferenceProbe.nativeThemeChanged) assert.deepEqual(evidence.darkPreferenceProbe.measurement.mismatches, [], 'Captured native/owned author presentation differs under the actual native dark preference');
}

async function bitbucketCommentDigest(page) {
  const read = () => page.evaluate(() => {
    const native = document.querySelector('#comment-471253038[data-testid="comment"]');
    const nativeBody = native?.querySelector('[data-testid="comment-content"] .ak-renderer-document');
    const originalLink = native?.querySelector('[data-testid="comment-header"] a[href]');
    const panel = document.querySelector('.geld-provider-review');
    const source = panel?.querySelector('[data-geld-source="comment-471253038"]');
    const body = source?.querySelector('.geld-provider-review__body .ak-renderer-document');
    const item = source?.closest('[data-geld-item]');
    const activity = native?.closest('[data-qa="pull-request-overview-activity-content"]');
    const header = activity?.querySelector('[data-qa="bk-file__header"][data-testid="file-header"]');
    let authenticated = null;
    try { authenticated = JSON.parse(document.querySelector('meta#bb-bootstrap[data-current-user]')?.getAttribute('data-current-user') ?? 'null')?.isAuthenticated ?? null; } catch { /* Recorded as unavailable. */ }
    const dangerous = body == null ? null : [...body.querySelectorAll('*')].some((node) => /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|BUTTON|INPUT|SELECT|TEXTAREA|SVG)$/.test(node.tagName) || [...node.attributes].some((attribute) => attribute.name.startsWith('on') || ['style', 'contenteditable', 'id'].includes(attribute.name)));
    return { authenticated, panelState: panel?.getAttribute('data-state') ?? null, nativeId: native?.id ?? null,
      nativeBody: nativeBody?.textContent.trim() ?? null, renderedBody: body?.textContent.trim() ?? null, renderedSanitized: dangerous === false,
      originalLink: originalLink?.href ?? null, sourceLinks: [...source?.querySelectorAll('.geld-provider-review__byline > a[href]') ?? []].map((link) => link.href),
      nativeOutdated: [...header?.querySelectorAll('span') ?? []].some((node) => node.children.length === 0 && node.textContent.trim() === 'Outdated'),
      nativePath: header?.querySelector('[data-qa="bk-filepath"]')?.textContent ?? null, itemState: item?.getAttribute('data-state') ?? null,
      sourceActions: [...source?.querySelectorAll('.geld-provider-review__source-actions button') ?? []].map((button) => button.textContent.trim()),
      quickActions: [...document.querySelectorAll('.geld-provider-actions button')].map((button) => button.textContent.trim()), aiControls: panel?.querySelectorAll('[data-geld-ai-run]').length ?? 0 };
  });
  const original = await poll(read, (value) => ['ready', 'partial'].includes(value.panelState) && value.nativeId !== null && value.nativeOutdated && value.itemState === 'outdated' && value.renderedBody !== null, 'Installed PR22 digest keeps the actual native comment and outdated state');
  assert.equal(original.authenticated, false, 'Native bootstrap must explicitly establish anonymous Bitbucket access');
  assert.match(original.nativeBody, /Internal maintenance: Update tests to access token auth\./);
  assert.equal(original.renderedBody, original.nativeBody, 'Sanitized digest text differs from the actual native comment');
  assert.equal(original.renderedSanitized, true);
  assert.equal(new URL(original.originalLink).hash, '#comment-471253038', 'Native comment timestamp must retain the actual source anchor');
  const permalink = `${BB_COMMENT_PR}/_/diff#comment-471253038`;
  assert.ok(original.sourceLinks.includes(permalink), 'Digest must preserve the actual API original permalink, including its native /_/diff alias');
  assert.equal(original.nativePath, '.changes/next-release/patch-20240213112019723332.json');
  assert.ok(original.sourceActions.includes('Show conversation'), 'Anonymous read-only native conversation navigation is missing');
  assert.equal(original.sourceActions.some((label) => /^(Reply|Resolve thread|Resolve|Reopen)/i.test(label)), false, 'Anonymous digest exposed a native write relay');
  assert.deepEqual(original.quickActions, []);assert.equal(original.aiControls, 0);
  return { ...original, permalink, nativeFingerprint: createHash('sha256').update(JSON.stringify({ id: original.nativeId, body: original.nativeBody, link: original.originalLink, path: original.nativePath, outdated: original.nativeOutdated })).digest('hex'),
    writeVerification: 'Native bootstrap explicitly anonymous. Owned Reply/Resolve/Reopen and global quick actions are absent; no provider write controls are activated.' };
}

async function bitbucketCommitCounts(page) {
  const read = () => page.evaluate(() => ({
    heading: [...document.querySelectorAll('[role="region"][aria-label="Diff"] > div > div > h2')].find((node) => /^[\d,]+ files?$/.test(node.textContent.trim()))?.textContent.trim() ?? null,
    badge: document.querySelector('[data-testid="sidebar-tab-files"][role="tab"] > span > div > span > span')?.textContent.trim() ?? null,
    file: document.getElementById('chg-pipe/pipe.py')?.parentElement == null ? null : { id: document.getElementById('chg-pipe/pipe.py').id, display: getComputedStyle(document.getElementById('chg-pipe/pipe.py').parentElement).display, hidden: document.getElementById('chg-pipe/pipe.py').parentElement.getAttribute('data-geld-provider-hidden'), path: document.getElementById('chg-pipe/pipe.py').parentElement.querySelector('[data-qa="bk-filepath"]')?.textContent ?? null },
    nativeLinks: [...document.querySelectorAll('[role="region"][aria-label="Diff"] a[href]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => node.getAttribute('href')) }));
  const all = { files: 1, additions: 2, deletions: 0 };
  const baseline = await waitTotals(page, all, all, 0);
  const native = await poll(read, (value) => value.heading === '1 file' && value.badge === '1' && value.file?.path === 'pipe/pipe.py', 'Actual standalone commit heading and sidebar Files badge');
  const headerGroup = '[role="region"][aria-label="Diff"] > div > div > h2';
  const baselineHeaderHints = await headerHintsEvidence(page, '0 tests', headerGroup, 'bitbucket-commit-baseline', false);
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  let filtered;
  let hidden;
  let hiddenArtifacts;
  let autoOpened;
  let hideClick;
  let showClick;
  let filteredHeaderHints;
  try {
    await patchSettings({ categoryPatterns: { ...original.categoryPatterns, tests: ['pipe/pipe.py'] } });
    filtered = await waitTotals(page, all, { files: 0, additions: 0, deletions: 0 }, 1);
    assert.equal(filtered.expanded, true, 'A commit categorized entirely as hidden must auto-expand its real source file');
    filteredHeaderHints = await headerHintsEvidence(page, '1 test', headerGroup, 'bitbucket-commit-filtered');
    assert.deepEqual(filteredHeaderHints.nativeIds, baselineHeaderHints.nativeIds);
    autoOpened = await poll(read, (value) => value.heading === '0 files' && value.badge === '0' && value.file?.display !== 'none' && value.file?.hidden === 'open', 'Actual all-categorized commit keeps zero essential counts while opening its sole file');
    hideClick = await trustedHiddenToggle(page, /^Hide/);
    await poll(() => tabState(page), (value) => value.expanded === false && value.visible?.files === 0 && value.hiddenCount === 1, 'Trusted Hide collapses the all-categorized commit with matching real tab state');
    hidden = await poll(read, (value) => value.heading === '0 files' && value.badge === '0' && value.file?.display === 'none' && value.file.hidden === 'closed', 'Real Hide closes the sole commit file without changing zero essential counts');
    assert.equal(hidden.file.id, native.file.id);assert.deepEqual(hidden.nativeLinks, native.nativeLinks);
    hiddenArtifacts = await capture(page, 'bitbucket-commit-filtered');
    showClick = await trustedHiddenToggle(page, /^Show/);
    await poll(() => tabState(page), (value) => value.expanded === true && value.visible?.files === 0 && value.hiddenCount === 1, 'Trusted Show reopens the all-categorized commit with matching tab state');
    await poll(read, (value) => value.file?.display !== 'none' && value.file?.hidden === 'open' && value.heading === '0 files' && value.badge === '0', 'Real Show reopens the actual commit file while essential counts remain zero');
  } finally { await patchSettings({ categoryPatterns: original.categoryPatterns ?? {} }); }
  const restoredState = await waitTotals(page, all, all, 0);
  const restored = await poll(read, (value) => value.heading === '1 file' && value.badge === '1' && value.file?.display !== 'none' && value.file?.hidden === null, 'Actual commit file counts and sole-file visibility restore');
  assert.equal(restored.file.id, native.file.id);assert.deepEqual(restored.nativeLinks, native.nativeLinks);
  const restoredHeaderHints = await headerHintsEvidence(page, '0 tests', headerGroup, 'bitbucket-commit-restored', false);
  assert.deepEqual(restoredHeaderHints.nativeIds, baselineHeaderHints.nativeIds);
  return { baseline, native, baselineHeaderHints, filtered, filteredHeaderHints, autoOpened, hideClick, hidden, hiddenArtifacts, showClick, restoredState, restored, restoredHeaderHints, nativeFingerprint: createHash('sha256').update(JSON.stringify({ id: native.file.id, path: native.file.path, links: native.nativeLinks })).digest('hex'), nativeLineTotals: 'No native added/deleted header summary is present. Only actual runtime totals and native file-count surfaces are asserted.' };
}

await mkdir(artifacts, { recursive: true });
try {
  assert.ok(focus === 'all' || Object.hasOwn(FOCUSED_CASES, focus), `Unknown browser verification focus: ${focus}`);
  await inheritCooldowns();
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
  console.log(`INSTALLED: ${extensionId}, ${report.browserVersion}, service worker ${worker.url()}`);
  report.installation = { extensionId, serviceWorker: worker.url(), optionsUrl: options.url(), verifiedActualChromeStorage: true, installedManifestVersion: installed.manifest.version };
  report.settings = await patchSettings({ enabled: true, categories: { tests: true }, groupHidden: true, expandedByDefault: false, hideCommentLines: false, testOutline: false, hideLargeDiffs: false, hideWhitespace: false, repoRules: [], hiddenAuthors: [], repoConfigs: 'never', aiEnabled: false, autoViewed: {}, autoUpdatePatterns: false });

  await runCase('gitlab-mixed', GL_MIXED, async (page, item) => {
    item.enabledState = await waitTotals(page, { files: 3, additions: 36, deletions: 0 }, { files: 2, additions: 4, deletions: 0 }, 1);
    const enabled = await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 2 && row.additions === 4 && row.deletions === 0) && value.hidden.some((row) => row.value === 'closed' && row.display === 'none'), 'Actual native header rewrite and hidden file DOM');
    item.enabledDom = enabled;
    item.headerHints = await headerHintsEvidence(page, '1 test', '[data-testid="js-file-addition-line"]', 'gitlab-mixed-header');
    const categorizedPath = item.enabledState.categories.find((category) => category.id === 'tests')?.paths[0];
    assert.ok(typeof categorizedPath === 'string', 'Mixed GitLab fixture needs a real categorized path');
    item.categoryInteraction = await categoryInteraction(page, categorizedPath, 'gitlab', 'gitlab-category', false);
    item.theme = await themeProbe(page);
    item.spokenEnabled = await countA11y(page);
    assert.match(item.spokenEnabled.additions ?? '', /\b4\b/, 'Spoken additions must match the rewritten4 visible lines');
    item.hoverAdditions = await installedHover(page, '[data-testid="js-file-addition-line"]', 'pointer', 'gitlab-additions-hover');
    item.hoverChangesPointer = await installedHover(page, '[data-testid="diffs-tab"] > a', 'pointer', 'gitlab-changes-pointer-hover');
    item.hoverChangesKeyboard = await installedHover(page, '[data-testid="diffs-tab"] > a', 'keyboard', 'gitlab-changes-keyboard-hover');
    assert.equal(item.hoverChangesPointer.text, item.hoverAdditions.text, 'Native additions and Changes tooltip totals disagree');
    assert.equal(item.hoverChangesKeyboard.text, item.hoverAdditions.text, 'Keyboard and pointer breakdowns disagree');
    item.zoom200 = await responsiveHover(page, '[data-testid="diffs-tab"] > a', 'gitlab-zoom200', item.hoverChangesKeyboard.text);
    assert.equal((await countA11y(page)).additions, item.spokenEnabled.additions, 'GitLab zoom changed the accessible visible addition count');
    item.reducedMotion = await reducedMotionProbe(page, 'gitlab');
    await patchSettings({ enabled: false });
    item.disabledState = await poll(() => tabState(page), (state) => state.hasDiff === false && state.allowed === false, 'Real sync master toggle disable');
    item.disabledDom = await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 3 && row.additions === 36 && row.deletions === 0) && value.hidden.length === 0 && value.inlineHidden === 0 && value.ownUi === 0, 'Native count restoration and owned hide-attribute removal');
    item.spokenDisabled = await poll(() => countA11y(page), (value) => /\b36\b/.test(value.additions ?? '') && value.ownedDescriptions === 0, 'Native spoken count and hover ownership restored on real storage disable');
    item.disabledArtifacts = await capture(page, 'gitlab-mixed-disabled');
    await patchSettings({ enabled: true });
    item.reenabledState = await waitTotals(page, { files: 3, additions: 36, deletions: 0 }, { files: 2, additions: 4, deletions: 0 }, 1);
    await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 2 && row.additions === 4) && value.hidden.some((row) => row.display === 'none'), 'Reenabled installed native UI');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await pause(300);
    const emulated = await themeProbe(page);
    const nativeChanged = emulated.native?.background !== item.theme.native?.background || emulated.native?.color !== item.theme.native?.color;
    item.darkPreferenceProbe = { mechanism: 'OS prefers-color-scheme emulation only; no manual native theme class or CSS injection', nativeThemeChanged: nativeChanged, status: nativeChanged ? 'native_scheme_observed' : 'site_did_not_select_dark_theme', measurement: emulated };
    if (nativeChanged) {
      assert.equal(emulated.owned?.color, emulated.native?.color, 'Owned/native text color diverges after native OS scheme change');
      assert.equal(emulated.owned?.background, emulated.native?.background, 'Owned/native button backgrounds diverge after native OS scheme change');
      item.darkPreferenceProbe.artifacts = await capture(page, 'gitlab-os-dark');
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    return {};
  });
  // A failed assertion while disabled must not invalidate the following independent fixture.
  await patchSettings({ enabled: true });
  await runCase('gitlab-all-tests', GL_TESTS, async (page, item) => {
    item.state = await waitTotals(page, { files: 1, additions: 4, deletions: 1 }, { files: 0, additions: 0, deletions: 0 }, 1);
    assert.equal(item.state.expanded, true, 'All-test source must auto-expand with zero essential counts');
    const zero = (value) => value.headers.some((row) => row.files === 0 && row.additions === 0 && row.deletions === 0);
    item.dom = await poll(() => gitLabDom(page), (value) => zero(value) && value.hidden.some((row) => row.value === 'open' && row.display !== 'none'), 'All-test native file starts visible/open while essential counts stay zero');
    item.hideClick = await trustedHiddenToggle(page, /^Hide/);
    item.collapsedState = await poll(() => tabState(page), (value) => value.expanded === false && value.visible?.files === 0 && value.visible.additions === 0 && value.visible.deletions === 0 && value.hiddenCount === 1, 'Trusted Hide produces matching collapsed real tab state');
    item.collapsedDom = await poll(() => gitLabDom(page), (value) => zero(value) && value.hidden.some((row) => row.value === 'closed' && row.display === 'none'), 'Trusted Hide closes the actual all-test diff');
    await options.bringToFront();
    await poll(() => page.evaluate(() => document.hidden), Boolean, 'Actual Chrome tab becomes hidden before its visibility reapply');
    await page.bringToFront();
    await poll(() => page.evaluate(() => document.hidden), (value) => value === false, 'Actual Chrome tab becomes visible and triggers the controller reapply');
    item.reappliedState = await poll(() => tabState(page), (value) => value.expanded === false && value.visible?.files === 0 && value.hiddenCount === 1, 'Manual all-test collapse survives actual visibility-triggered reapply');
    item.reappliedDom = await poll(() => gitLabDom(page), (value) => zero(value) && value.hidden.some((row) => row.value === 'closed' && row.display === 'none'), 'Actual all-test file stays closed after reapply');
    item.reapplyMechanism = 'Real options-tab activation followed by real review-tab activation; native document visibilitychange re-applies the controller without changing settings or synthesizing a provider event.';
    item.showClick = await trustedHiddenToggle(page, /^Show/);
    item.reopenedState = await poll(() => tabState(page), (value) => value.expanded === true && value.visible?.files === 0 && value.hiddenCount === 1, 'Trusted Show produces matching reopened real tab state');
    item.reopenedDom = await poll(() => gitLabDom(page), (value) => zero(value) && value.hidden.some((row) => row.value === 'open' && row.display !== 'none'), 'Trusted Show reopens the actual all-test file with zero essential counts');
    return {};
  });
  await runCase('gitlab-overview-digest', GL_OVERVIEW, async (page, item) => {
    item.digest = await poll(() => page.evaluate(() => {
      const panel = document.querySelector('.geld-provider-review');
      if (panel === null) return null;
      return { state: panel.getAttribute('data-state'), title: panel.querySelector('h2')?.textContent, reviews: panel.querySelector('[data-geld-review-key="reviewers"] summary')?.textContent,
        checks: panel.querySelector('[data-geld-review-key="checks"] summary')?.textContent, items: panel.querySelectorAll('[data-geld-item]').length,
        sources: panel.querySelectorAll('[data-geld-source]').length, reviewerRows: panel.querySelectorAll('.geld-provider-review__standing').length, checkRows: panel.querySelectorAll('.geld-provider-review__check').length, activity: panel.querySelectorAll('.geld-provider-review__event').length,
        unavailable: [...panel.querySelectorAll('.geld-provider-review__unavailable')].map((node) => node.textContent),
        sourceLinks: [...panel.querySelectorAll('[data-geld-source] a[href]')].slice(0, 8).map((link) => link.href),
        aiRunControls: panel.querySelectorAll('[data-geld-ai-run]').length };
    }), (value) => value !== null && ['ready', 'partial'].includes(value.state) && /Reviews/.test(value.reviews ?? '') && /CI checks/.test(value.checks ?? '') && value.items > 0 && value.sources > 0 && value.reviewerRows > 0 && value.checkRows > 0 && value.activity > 0, 'Installed public MR digest with real source items, review/CI rows and activity');
    assert.equal(item.digest.aiRunControls, 0, 'AI is disabled in this signed-out smoke');
    item.state = await tabState(page);
    assert.equal(item.state.repository?.provider, 'gitlab');
    assert.equal(item.state.onDiffPage, false);
    item.authorPresentation = await authorThemeEvidence(page, 'gitlab', 'note_4118584957');
    assertAuthorThemeEvidence(item.authorPresentation);
    item.localReviewed = await localReviewedFlag(page, (evidence) => { item.nativeFragment = evidence; });
    return {};
  });
  await runCase('github-regression', GH_FILES, async (page, item) => {
    item.state = await poll(() => tabState(page), (state) => state.hasDiff === true && state.all !== null && state.visible !== null && state.hiddenCount > 0 && state.categories.some((category) => category.id === 'tests' && category.count > 0), 'Installed GitHub public fixture classification');
    item.dom = await page.evaluate(() => ({ hidden: document.querySelectorAll('[data-geld="hidden"]').length, totalGeldEntries: document.querySelectorAll('[data-geld]').length }));
    assert.ok(item.dom.hidden > 0, 'GitHub reports hidden tests but no actual hidden diff entry exists');
    return {};
  });
  let bitbucketCommit = null;
  for (const [name, url] of [['bitbucket-overview', BB_PR], ['bitbucket-diff', `${BB_PR}/diff`]]) {
    await runCase(name, url, async (page, item) => {
      await page.waitForFunction(() => document.body.innerText.includes('BCAT-6005') && document.body.innerText.includes('Support API token') && document.body.innerText.includes('Merged'), { timeout: WAIT_MS });
      if (name === 'bitbucket-diff') await page.waitForFunction(() => document.body.innerText.includes('README.md') && document.body.innerText.includes('pipe/pipe.py'), { timeout: WAIT_MS });
      item.state = await poll(() => tabState(page), (state) => state.repository?.provider === 'bitbucket' && state.repository.path === 'atlassian/bitbucket-upload-file' && typeof state.hasDiff === 'boolean', 'Installed Bitbucket routing response');
      assert.equal(item.state.onDiffPage, name === 'bitbucket-diff');
      if (name === 'bitbucket-diff') {
        await bitbucketFiltering(page, item);
        assert.equal(item.restored.hasDiff, true, 'Bitbucket diff adapter did not activate');
      } else {
        item.digest = await poll(() => page.evaluate(() => {
          const panel = document.querySelector('.geld-provider-review');
          return panel === null ? null : { state: panel.getAttribute('data-state'), title: panel.querySelector('h2')?.textContent, activity: panel.querySelectorAll('.geld-provider-review__event').length, sourceComments: panel.querySelectorAll('[data-geld-source]').length, unavailable: [...panel.querySelectorAll('.geld-provider-review__unavailable')].map((node) => node.textContent) };
        }), (value) => value !== null && ['ready', 'partial'].includes(value.state) && value.activity > 0, 'Installed public Bitbucket digest with real activity');
      }
      const surfaceLinks = (await nativeSurface(page)).links;
      bitbucketCommit ??= surfaceLinks.find((link) => link.kind === 'commit')?.href ?? null;
      item.nativeStyles = await bitbucketNativeStyles(page);
      item.nativeComponentResources = await captureNativeBitbucketResources(page);
      assert.ok(Object.keys(item.nativeStyles.tokens).length > 0, 'No computed native --ds tokens were captured');
      assert.ok(item.nativeStyles.moreActions !== null, 'Stable native More actions button sample missing');
      if (name === 'bitbucket-diff') assert.ok(item.nativeStyles.article !== null && item.nativeStyles.header !== null && item.nativeStyles.code !== null, 'Stable native diff computed samples missing');
      await page.hover('[data-qa="pr-header-actions-drop-down-menu-styles"] button');
      await pause(250);
      const hovered = await bitbucketNativeStyles(page);
      item.nativeButtonHover = { button: hovered.moreActions, border: hovered.moreActionsBorder };
      await page.mouse.move(1, 1);
      await page.focus('[data-qa="pr-header-actions-drop-down-menu-styles"] button');
      const focused = await bitbucketNativeStyles(page);
      item.nativeButtonFocus = { mechanism: 'Programmatic native focus, not menu activation', button: focused.moreActions, border: focused.moreActionsBorder };
      item.featureParity = 'partial';
      return { status: 'passed', verified: name === 'bitbucket-diff' ? 'Installed complete diff counts, real synchronized pattern filtering, actual native file hiding/count rewrite, and restoration on this public fixture.' : 'Installed digest exposes real public activity in ready/partial state. This fixture does not verify comment threads or authenticated actions.' };
    });
  }

  await runCase('bitbucket-list-counts', BB_PR_LIST, async (page, item) => {
    item.listCounts = await bitbucketListCounts(page);
    item.state = await tabState(page);
    item.featureParity = 'partial';
    return { status: 'passed', verified: 'The actual visible native PR27 row settles at complete counts. Pointer and real Tab breakdowns plus shared custom-pattern filtering/restoration preserve native IDs and links.' };
  });
  await runCase('bitbucket-comment-digest', BB_COMMENT_PR, async (page, item) => {
    item.commentDigest = await bitbucketCommentDigest(page);
    item.authorPresentation = await authorThemeEvidence(page, 'bitbucket', 'comment-471253038');
    assertAuthorThemeEvidence(item.authorPresentation);
    item.state = await tabState(page);
    item.featureParity = 'partial';
    return { status: 'passed', verified: 'Actual public native comment471253038 is safely rendered with its original source permalink and native outdated state. Anonymous write controls remain unavailable; no provider write is attempted.' };
  });
  await runCase('bitbucket-commit-counts', BB_COMMIT, async (page, item) => {
    item.commitCounts = await bitbucketCommitCounts(page);
    item.state = await tabState(page);
    item.featureParity = 'partial';
    return { status: 'passed', verified: 'The actual standalone commit has one file and two added lines in runtime state. Its native file heading and badge reach zero under a real synchronized custom rule, hide the actual file, and restore with native IDs/links preserved.' };
  });

  for (const [name, url] of [['gitlab-project-mr-list', GL_PROJECT_LIST], ['gitlab-group-mr-list', GL_GROUP_LIST]]) {
    await runCase(name, url, async (page, item) => {
      item.listCounts = await gitLabListCounts(page, name);
      item.surface = await nativeSurface(page);
      item.state = await tabState(page);
      item.featureParity = 'partial';
      return { status: 'passed', verified: 'Narrowed native MR list settles on verified complete counts. Pointer/real Tab breakdowns, settings-driven chip removal/restoration and observed-author row hiding/restoration preserve native IDs/status links.' };
    });
  }
  await runCase('gitlab-native-reference-cards-discovery', GL_OVERVIEW, async (page, item) => {
    try { await page.waitForFunction(() => document.querySelector('a[data-reference-type="merge_request"], a[data-reference-type="commit"]') !== null, { timeout: 15_000 }); }
    catch (error) { item.nativeReadiness = errorText(error); }
    item.surface = await nativeSurface(page);
    item.mergeRequestCard = await nativeLinkHover(page, 'merge_request', 'gitlab-native-mr-card');
    item.commitCard = await nativeLinkHover(page, 'commit', 'gitlab-native-commit-card');
    item.featureParity = 'not_evaluated';
    return { status: 'discovery', reason: 'Native reference links and cards are observed separately from Geld count hover assertions. Missing native cards remain explicitly unavailable.' };
  }, true);

  let bitbucketCandidates = [];
  await runCase('bitbucket-pr-list-discovery', BB_PR_LIST, async (page, item) => {
    try { await page.waitForFunction(() => [...document.querySelectorAll('a[href]')].some((link) => /\/pull-requests\/[1-9]\d*\/?$/.test(new URL(link.href).pathname)), { timeout: 15_000 }); }
    catch (error) { item.nativeReadiness = errorText(error); }
    item.surface = await nativeSurface(page);
    bitbucketCandidates = [...new Set(item.surface.links.filter((link) => link.kind === 'review').map((link) => bitbucketReviewUrl(link.href)).filter((url) => url !== null))].map((url) => ({ url, basis: 'Actual native public PR list link', commentCount: null }));
    bitbucketCommit ??= item.surface.links.find((link) => link.kind === 'commit')?.href ?? null;
    const apiUrl = 'https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/pullrequests?state=MERGED&pagelen=30';
    const listing = await publicJson(page, apiUrl);
    const values = Array.isArray(listing.body?.values) ? listing.body.values : [];
    item.publicListing = { url: apiUrl, status: listing.status, error: listing.error ?? null, next: typeof listing.body?.next === 'string' ? safeUrl(listing.body.next) : null,
      candidates: values.map((value) => ({ id: value.id, url: bitbucketReviewUrl(value.links?.html?.href), title: typeof value.title === 'string' ? value.title : null, commentCount: typeof value.comment_count === 'number' ? value.comment_count : null })) };
    const commented = item.publicListing.candidates.filter((value) => value.url !== null && value.commentCount > 0);
    if (commented.length > 0) bitbucketCandidates = commented.map((value) => ({ ...value, basis: 'Actual public API PR with positive comment_count' }));
    if (bitbucketCommit === null) {
      for (const value of values) {
        const candidate = value.source?.commit?.links?.html?.href;
        if (typeof candidate === 'string' && /^https:\/\/bitbucket\.org\/[^/]+\/[^/]+\/commits\/[0-9a-f]{7,64}$/i.test(candidate)) { bitbucketCommit = candidate; break; }
      }
    }
    item.featureParity = 'not_evaluated';
    return { status: 'discovery', reason: 'Native PR list plus bounded public GET listing discovery. A positive comment_count is a fixture candidate, not a verified native discussion.' };
  }, true);

  let observedCommentFixture = false;
  for (const [index, candidate] of bitbucketCandidates.slice(0, 3).entries()) {
    await runCase(`bitbucket-public-comments-discovery-${index + 1}`, candidate.url, async (page, item) => {
      const native = new URL(candidate.url);
      const parts = native.pathname.split('/');
      const commentsUrl = `https://api.bitbucket.org/2.0/repositories/${parts[1]}/${parts[2]}/pullrequests/${parts[4]}/comments?pagelen=20`;
      const response = await publicJson(page, commentsUrl);
      const values = Array.isArray(response.body?.values) ? response.body.values : [];
      const comments = values.filter((value) => value.deleted !== true && typeof value.content?.raw === 'string' && value.content.raw.trim() !== '');
      item.fixture = candidate;
      item.publicComments = { url: commentsUrl, status: response.status, error: response.error ?? null, next: typeof response.body?.next === 'string' ? safeUrl(response.body.next) : null,
        values: comments.slice(0, 10).map((value) => ({ id: value.id, parentId: value.parent?.id ?? null, authorId: value.user?.uuid ?? null, author: value.user?.display_name ?? null, createdOn: value.created_on ?? null, bodyExcerpt: value.content.raw.slice(0, 500), url: typeof value.links?.html?.href === 'string' ? safeUrl(value.links.html.href) : null })) };
      try { await page.waitForFunction(() => document.querySelector('[data-qa="pull-request-activity"], [id^="comment-"], a[href*="#comment-"]') !== null, { timeout: 15_000 }); }
      catch (error) { item.nativeReadiness = errorText(error); }
      await pause(2000);
      item.surface = await nativeSurface(page);
      item.nativeStyles = await bitbucketNativeStyles(page);
      item.featureParity = 'not_evaluated';
      observedCommentFixture = comments.length > 0;
      if (bitbucketCommit === null) bitbucketCommit = item.surface.links.find((link) => link.kind === 'commit')?.href ?? null;
      return { status: comments.length > 0 ? 'discovery' : 'unavailable', reason: comments.length > 0 ? 'Public API confirms original nondeleted comments. Native DOM/accessibility evidence is captured separately; digest and comment actions are not asserted.' : 'No original nondeleted comment was confirmed in this bounded candidate capture.' };
    }, true);
    if (observedCommentFixture) break;
  }
  if (!observedCommentFixture) await unavailableDiscovery('bitbucket-comment-fixture-discovery', 'No comment-bearing PR was confirmed from the bounded native/public listing candidates.', { candidates: bitbucketCandidates.slice(0, 3) });
  if (bitbucketCommit !== null) {
    await runCase('bitbucket-native-commit-discovery', bitbucketCommit, async (page, item) => {
      try { await page.waitForFunction(() => document.querySelector('article[data-qa="branch-diff-file"], [data-qa="bk-file__header"], [data-qa="code-line"]') !== null, { timeout: 15_000 }); }
      catch (error) { item.nativeReadiness = errorText(error); }
      item.surface = await nativeSurface(page);
      item.nativeStyles = await bitbucketNativeStyles(page);
      item.state = await tabState(page);
      item.featureParity = 'not_evaluated';
      return { status: 'discovery', reason: 'Actual native commit link discovered from a public PR/list response. Captures commit header, files and counts without claiming commit adapter parity.' };
    }, true);
  } else await unavailableDiscovery('bitbucket-native-commit-discovery', 'No native/public-response commit URL was observed. No commit URL or SHA was invented.');
} catch (error) {
  report.infrastructureErrors.push(errorText(error));
  console.error(`INSTALLED EXTENSION INFRASTRUCTURE FAILURE: ${errorText(error)}`);
} finally {
  if (browser !== undefined) await browser.close().catch((error) => report.infrastructureErrors.push(errorText(error)));
  await saveReport();
}
const failed = report.status === 'failed';
console.log(`Installed extension smoke: ${report.status}. Native discovery is not a feature parity pass. Report: ${resolve(artifacts, 'report.json')}`);
process.exitCode = failed ? 1 : 0;
