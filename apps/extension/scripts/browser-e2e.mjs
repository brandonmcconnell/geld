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
const GL_OVERVIEW = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
const GL_TESTS = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265';
const GH_FILES = 'https://github.com/wxt-dev/wxt/pull/2544/files';
const BB_PR = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
const GL_LIST_QUERY = new URLSearchParams({ state: 'all', search: 'Return an error when issueMoveList cannot move the issue' });
const GL_PROJECT_LIST = `https://gitlab.com/gitlab-org/gitlab/-/merge_requests?${GL_LIST_QUERY}`;
const GL_GROUP_LIST = `https://gitlab.com/groups/gitlab-org/-/merge_requests?${GL_LIST_QUERY}`;
const BB_PR_LIST = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED';
const report = {
  schema: 1, startedAt: new Date().toISOString(), mode: 'actual installed unpacked extension on live anonymous public pages',
  parity: 'incomplete', executablePath, extensionPath, artifacts,
  auth: { freshTemporaryBrowserProfile: true, credentialsProvided: false, authenticatedProviderWrites: false },
  limitations: ['Bitbucket routing and native surface discovery do not establish feature parity.', 'No authenticated review, Viewed, merge or AI-gateway operation is exercised.', 'Computed style probes describe the tested viewport/theme only. Discovery cases report observations or explicit unavailability, never a feature pass.'],
  installation: null, cases: [], infrastructureErrors: [],
};
const cooldowns = new Map();
const capturedNativeResources = new Set();
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
async function runCase(name, url, body, discovery = false) {
  const item = { name, url, startedAt: new Date().toISOString(), status: 'running', ...(discovery ? { purpose: 'Read-only native surface discovery. No feature parity assertion.' } : {}), console: [], pageErrors: [], requestFailures: [], sourceFailures: [] };
  report.cases.push(item);
  let page;
  try {
    const provider = providerOf(url);
    const cooldown = cooldowns.get(provider);
    if (cooldown !== undefined && cooldown > Date.now()) {
      item.rateLimitedUntil = new Date(cooldown).toISOString();
      throw new Error(`Provider rate limited until ${item.rateLimitedUntil}; no navigation attempted`);
    }
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
    item.status = result?.status ?? (discovery ? 'discovery' : 'passed');
  } catch (error) {
    item.status = discovery ? item.rateLimitedUntil === undefined ? 'unavailable' : 'rate_limited' : 'failed';
    item.error = errorText(error);
    if (item.rateLimitedUntil !== undefined) {
      item.interruptedError = item.error;
      item.error = `Provider HTTP429 cooldown until ${item.rateLimitedUntil}. Native demand stopped and no retry was attempted.`;
    }
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

async function countA11y(page) {
  return page.evaluate(() => ({
    additions: document.querySelector('[data-testid="js-file-addition-line"]')?.closest('[aria-label]')?.getAttribute('aria-label'),
    changes: document.querySelector('[data-testid="diffs-tab"] > a')?.textContent.trim(),
    ownedDescriptions: document.querySelectorAll('[aria-describedby~="geld-provider-count-tooltip"]').length,
  }));
}
async function installedHover(page, selector, interaction, artifactName) {
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  if (interaction === 'keyboard') {
    const previous = await page.evaluate((target) => {
      const anchor = document.querySelector(target);
      const order = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((node) => node.tabIndex >= 0 && !node.disabled && node.closest('[inert]') === null && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
      const at = order.indexOf(anchor);
      const prior = at > 0 ? order[at - 1] : null;
      prior?.focus();
      return prior !== null && prior !== undefined;
    }, selector);
    assert.equal(previous, true, 'Native previous control needed for real Tab-key traversal is missing');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate((target) => document.activeElement === document.querySelector(target), selector), true, 'Real Tab did not focus the native count host');
  } else await page.hover(selector);
  const snapshot = await poll(() => page.evaluate((target) => {
    const host = document.querySelector(target);
    const tip = document.querySelector('#geld-provider-count-tooltip[role="tooltip"]');
    if (tip === null || tip.hidden || getComputedStyle(tip).display === 'none') return null;
    const style = getComputedStyle(tip);
    const bounds = tip.getBoundingClientRect();
    return { text: tip.textContent.replace(/\s+/g, ' ').trim(), fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color, background: style.backgroundColor, filter: style.filter,
      rows: [...tip.querySelectorAll('.geld-provider-hover__row')].map((row) => ({ label: row.querySelector('.geld-provider-hover__label')?.textContent, files: row.querySelector('.geld-provider-hover__files')?.textContent, additions: row.querySelector('.geld-provider-hover__add')?.textContent, deletions: row.querySelector('.geld-provider-hover__del')?.textContent })),
      described: [...document.querySelectorAll('[aria-describedby~="geld-provider-count-tooltip"]')].some((owner) => owner === host || host?.contains(owner)),
      bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }, viewport: { width: innerWidth, height: innerHeight } };
  }, selector), (value) => value !== null && value.described && /Essential/.test(value.text) && /Tests/.test(value.text) && /Total/.test(value.text), 'Installed native count hover breakdown and accessible owner', 12_000);
  assert.ok(snapshot.bounds.left >= 0 && snapshot.bounds.right <= snapshot.viewport.width + 1 && snapshot.bounds.top >= 0 && snapshot.bounds.bottom <= snapshot.viewport.height + 1, 'Count tooltip escapes the tested viewport');
  await page.screenshot({ path: resolve(artifacts, `${artifactName}.png`) });
  await page.keyboard.press('Escape');
  await poll(() => page.evaluate(() => { const tip = document.querySelector('#geld-provider-count-tooltip'); return tip === null || tip.hidden || getComputedStyle(tip).display === 'none'; }), (value) => value, 'Escape dismisses installed hover', 5000);
  return { ...snapshot, interaction, screenshot: `${artifactName}.png`, escapeDismissed: true };
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
  const observed = await page.evaluate(() => [...document.querySelectorAll('link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]')].map((node) => node.href));
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
      resources.push({ component, url: observedUrl, status: result.status, mime: result.mime, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), file, executed: false, basis: 'Exact modulepreload/script-preload URL observed on the native public page. Bounded credential-free browser GET only.' });
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
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  try {
    await patchSettings({ categoryPatterns: { ...original.categoryPatterns, tests: ['pipe/pipe.py'] } });
    item.filtered = await poll(() => tabState(page), (state) => state.hasDiff === true && state.all?.files === 5 && state.all.additions === 46 && state.all.deletions === 29 && state.visible?.files === 4 && state.hiddenCount === 1 && state.categories.some((category) => category.id === 'tests' && category.paths.includes('pipe/pipe.py')), 'Actual shared pattern setting hides one complete Bitbucket file');
    const visible = item.filtered.visible;
    item.derivedHidden = { path: 'pipe/pipe.py', files: all.files - visible.files, additions: all.additions - visible.additions, deletions: all.deletions - visible.deletions, basis: 'Actual complete adapter result minus actual visible totals, not a guessed fixture count' };
    assert.ok(item.derivedHidden.additions + item.derivedHidden.deletions > 0, 'The selected file did not remove any changed lines');
    item.filteredDom = await poll(() => bitbucketDom(page), (value) => value.files === visible.files && value.additions === visible.additions && value.deletions === visible.deletions && value.hidden.some((file) => file.path === 'pipe/pipe.py' && file.mode === 'closed' && file.display === 'none'), 'Native Bitbucket file count/line totals and actual hidden file wrapper');
    item.filteredArtifacts = await capture(page, 'bitbucket-pattern-filtered');
    item.categoryInteraction = await categoryInteraction(page, 'pipe/pipe.py', 'bitbucket', 'bitbucket-category', true);
    const summarySelector = '#file-tree :has(> .geld-provider-accessible-counts)';
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
    return { headers: headers.map((header) => ({ text: header.textContent, expanded: header.getAttribute('aria-expanded') })),
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
    await controlHandle.dispose();
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
    for (const handle of handles) await handle.dispose();
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
  report.cases.push({ name, purpose: 'Read-only native surface discovery. No feature parity assertion.', status: 'unavailable', reason, ...extra, finishedAt: new Date().toISOString() });
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
  console.log(`INSTALLED: ${extensionId}, ${report.browserVersion}, service worker ${worker.url()}`);
  report.installation = { extensionId, serviceWorker: worker.url(), optionsUrl: options.url(), verifiedActualChromeStorage: true, installedManifestVersion: installed.manifest.version };
  report.settings = await patchSettings({ enabled: true, categories: { tests: true }, groupHidden: true, expandedByDefault: false, hideCommentLines: false, testOutline: false, hideLargeDiffs: false, hideWhitespace: false, repoRules: [], hiddenAuthors: [], repoConfigs: 'never', aiEnabled: false, autoViewed: {}, autoUpdatePatterns: false });

  await runCase('gitlab-mixed', GL_MIXED, async (page, item) => {
    item.enabledState = await waitTotals(page, { files: 3, additions: 36, deletions: 0 }, { files: 2, additions: 4, deletions: 0 }, 1);
    const enabled = await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 2 && row.additions === 4 && row.deletions === 0) && value.hidden.some((row) => row.value === 'closed' && row.display === 'none'), 'Actual native header rewrite and hidden file DOM');
    item.enabledDom = enabled;
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
    item.dom = await poll(() => gitLabDom(page), (value) => value.headers.some((row) => row.files === 0 && row.additions === 0 && row.deletions === 0) && value.hidden.some((row) => row.display === 'none'), 'All-test native zero essential counts and hidden DOM');
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
