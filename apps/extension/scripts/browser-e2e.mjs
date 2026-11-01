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
  'bitbucket-list': ['bitbucket-list-counts'],
  'bitbucket-comment': ['bitbucket-comment-digest'],
  'bitbucket-commit': ['bitbucket-commit-counts'],
  'gitlab-lists': ['gitlab-project-mr-list', 'gitlab-group-mr-list'],
  'gitlab-diff': ['gitlab-mixed', 'gitlab-all-tests'],
  'gitlab-review': ['gitlab-overview-digest'],
  'gitlab-bot': ['gitlab-bot-digest'],
  'gitlab-binary': ['gitlab-binary-counts'],
  'gitlab-references': ['gitlab-commit-link-counts', 'gitlab-native-commit-reference', 'gitlab-commit-counts'],
  github: ['github-regression'],
  'cross-provider-settings': ['cross-provider-settings'],
};
const focus = process.env.GELD_BROWSER_FOCUS ?? 'regression';
const GL_MIXED = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123';
const GL_OVERVIEW = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
const GL_BOT = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
const GL_BOT_HEAD = '5da09f9e31ad0d59c6f804a71380992955d1040f';
const GL_BOT_LOGIN = 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b';
const GL_BOT_NOTE_IDS = ['3381334808', '3381334872', '3381334884', '3384406925'];
const GL_COMMIT_SHA = 'db314bf4bb01ddcca61c32bc212e86bb82287f33';
const GL_COMMIT = `https://gitlab.com/gitlab-org/gitlab/-/commit/${GL_COMMIT_SHA}`;
const GL_COMMITS = `${GL_OVERVIEW}/commits`;
const GL_BINARY = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/162842/diffs?diff_id=1093051604';
const GL_BINARY_PATH = 'doc/tutorials/observability/img/django_metrics.png';
const GL_TESTS = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265';
const GH_FILES = 'https://github.com/wxt-dev/wxt/pull/2544/files';
const BB_PR = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
const BB_PR27_DIFF_FIXTURE = {
  url: BB_PR,
  all: { files: 5, additions: 46, deletions: 29 },
  selectedFile: { path: 'pipe/pipe.py', files: 1, additions: 5, deletions: 1 },
  provenance: { kind: 'prior_installed_public_fixture', run: 'https://github.com/brandonmcconnell/geld/actions/runs/41337759558', case: 'bitbucket-diff', basis: 'Actual installed complete5/+46−29, shared pattern filter4/+41−28 and restoration. This list slice does not repeat a native PR diff acquisition.' },
};
const GL_LIST_QUERY = new URLSearchParams({ state: 'all', search: 'issueMoveList' });
const GL_PROJECT_LIST = `https://gitlab.com/gitlab-org/gitlab/-/merge_requests?${GL_LIST_QUERY}`;
// The native Open tab uses STATUS_OPEN='opened'; the all-state group search times out upstream.
const GL_GROUP_LIST = `https://gitlab.com/groups/gitlab-org/-/merge_requests?${new URLSearchParams({ state: 'opened', search: 'issueMoveList' })}`;
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
    catch (error) { signal?.throwIfAborted();if (closedTarget(error) || errorText(error).includes('Native GitLab list unavailable:')) throw error;lastError = errorText(error); }
    await pause(1000, signal);
  }
  throw new Error(`${label} timed out. Last value: ${JSON.stringify(last)}${lastError === undefined ? '' : `; ${lastError}`}`);
}
async function pollStable(read, accepts, label, ms = WAIT_MS, signature = () => null) {
  let since = null; let previous; let samples = 0;
  const result = await poll(async () => {
    const value = await read(); const key = signature(value); const valid = accepts(value);
    if (!valid || key !== previous) { since = null; samples = 0; }
    previous = key;
    if (valid) { since ??= Date.now(); samples += 1; }
    return { value, valid, samples, stableMs: since === null ? 0 : Date.now() - since };
  }, (sample) => sample.valid && sample.samples >= 2 && sample.stableMs >= 200, label, ms);
  return { ...result.value, stability: { samples: result.samples, stableMs: result.stableMs, minimumMs: 200 } };
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
    const held = (name === 'cross-provider-settings' ? ['gitlab', 'github'] : [provider]).find((site) => (cooldowns.get(site) ?? 0) > Date.now());
    const cooldown = cooldowns.get(held);
    if (held !== undefined && cooldown !== undefined) {
      item.cooldownProvider = held;
      item.rateLimitedUntil = new Date(cooldown).toISOString();
      item.navigationSuppressedByCooldown = true;
      throw new Error(`Provider rate limited until ${item.rateLimitedUntil}; no navigation attempted`);
    }
    currentCaseAbort = abort;
    if (name === 'bitbucket-list-counts') {
      listSettings = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
      await patchSettings({ showListStats: false });
      item.listSourcePreparation = 'List stats disabled through real shared settings before native navigation; enable on the actual multi-row list and demand only PR27 through explicit intent.';
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
    if (name === 'gitlab-bot-digest') observeGitLabBotFixture(page, item);
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
async function crossSettingsDom(page, provider) {
  return page.evaluate((site) => {
    const numeric = (node, absentIsZero = false) => { if (node === null) return absentIsZero ? 0 : null; const value = node.textContent?.replace(/[,\s]/g, '').match(/\d+/)?.[0]; return value === undefined ? null : Number(value); };
    const native = (node) => node.closest('[data-geld-ui]') === null;
    let headers; let files; let headerIdentity;
    if (site === 'gitlab') {
      const groups = [...document.querySelectorAll('.diff-stats.inline-parallel-buttons .diff-stats-contents')].filter(native);
      headers = groups.map((root) => ({ files: numeric(root.querySelector(':scope > .diff-stats-group > span')), additions: numeric(root.querySelector('[data-testid="js-file-addition-line"]'), true), deletions: numeric(root.querySelector('[data-testid="js-file-deletion-line"]'), true) }));
      files = [...document.querySelectorAll('diff-file[data-file-data], .diff-file[data-file-data]')].filter(native).map((root) => {
        let data = null; try { data = JSON.parse(root.getAttribute('data-file-data') ?? 'null'); } catch { /* Incomplete native metadata fails below. */ }
        return { path: data?.new_path ?? data?.old_path ?? null, id: root.id, anchor: null, head: data?.diff_refs?.head_sha ?? null, hidden: root.getAttribute('data-geld-provider-hidden') };
      });
      const tab = document.querySelector('[data-testid="diffs-tab"]');
      headerIdentity = { id: tab?.id ?? null, testid: tab?.getAttribute('data-testid') ?? null, href: tab?.querySelector('a[href]')?.getAttribute('href') ?? null };
    } else {
      // These literal legacy hooks and file identities were observed on this exact public fixture in installed run41340321024.
      const stats = document.getElementById('diffstat'); const counter = document.getElementById('files_tab_counter');
      headers = stats === null || counter === null ? [] : [{ files: numeric(counter), additions: numeric(stats.querySelector('.color-fg-success')), deletions: numeric(stats.querySelector('.color-fg-danger')) }];
      files = [...document.querySelectorAll('.file-header[data-path][data-anchor]')].filter(native).map((header) => {
        const root = header.closest('.file[id]');
        return { path: header.getAttribute('data-path'), id: root?.id ?? null, anchor: header.getAttribute('data-anchor'), head: null, hidden: root?.getAttribute('data-geld') ?? null };
      });
      headerIdentity = { id: stats?.id ?? null, counterId: counter?.id ?? null, href: counter?.closest('a[href]')?.getAttribute('href') ?? null, repository: document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')?.getAttribute('content') ?? null };
    }
    return { provider: site, url: location.href, hidden: document.hidden, headers, headerIdentity, files: files.sort((a, b) => String(a.path).localeCompare(String(b.path))) };
  }, provider);
}

async function verifyCrossProviderSettings(gitlab, item) {
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key] ?? {}, SETTINGS_KEY);
  const readSettings = () => options.evaluate(async (key) => {
    const value = (await chrome.storage.sync.get(key))[key] ?? {};
    return { storageArea: 'chrome.storage.sync', storageKey: key, extensionId: chrome.runtime.id, enabled: value.enabled, categoryPatterns: value.categoryPatterns ?? {}, categories: value.categories, aiEnabled: value.aiEnabled, autoViewed: value.autoViewed };
  }, SETTINGS_KEY);
  const equal = (actual, expected) => actual !== null && actual !== undefined && ['files', 'additions', 'deletions'].every((key) => actual[key] === expected[key]);
  const evidence = { mechanism: 'One real installed options target writes one chrome.storage.sync settings key for two actual public tabs in the same browser profile.', scope: 'Same-profile cross-site settings; not cross-device synchronization.', storageArea: 'chrome.storage.sync', storageKey: SETTINGS_KEY, extensionId, stages: [], github: { console: [], pageErrors: [], requestFailures: [], sourceFailures: [] } };
  item.sharedSettings = evidence;
  let github; let closing = false;
  try {
    assert.equal(original.enabled, true, 'The shared-settings slice must start with the ordinary enabled fresh-profile settings');
    assert.equal(original.aiEnabled, false); assert.deepEqual(original.autoViewed, {});
    await patchSettings({ enabled: false });
    github = await browser.newPage();
    await github.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    // This auxiliary page is part of this case: its failures and cooldowns cannot become an unobserved helper pass.
    const abort = currentCaseAbort;
    github.on('close', () => { if (!closing && !abort.signal.aborted) abort.abort(new Error('Cross-provider GitHub page closed before acceptance')); });
    github.on('console', (message) => { if (evidence.github.console.length < 100) evidence.github.console.push({ type: message.type(), text: message.text().slice(0, 2000) }); });
    github.on('pageerror', (error) => { if (evidence.github.pageErrors.length < 100) evidence.github.pageErrors.push(errorText(error)); });
    github.on('requestfailed', (request) => { if (evidence.github.requestFailures.length < 100) evidence.github.requestFailures.push({ url: safeUrl(request.url()), method: request.method(), error: request.failure()?.errorText }); });
    github.on('response', (response) => {
      const provider = providerOf(response.url()); const headers = response.headers();
      if (provider === null) return;
      const quota = quotaHeaders(headers);
      if (Object.keys(quota).length > 0) { evidence.github.quotaObservations ??= []; if (evidence.github.quotaObservations.length < 60) evidence.github.quotaObservations.push({ url: safeUrl(response.url()), status: response.status(), observedAt: new Date().toISOString(), headers: quota }); }
      if (response.status() < 400) return;
      const failure = { url: safeUrl(response.url()), status: response.status(), retryAfter: headers['retry-after'] ?? null, quotaHeaders: quotaHeaders(headers), observedAt: new Date().toISOString(), expectedAnonymousRestriction: response.status() === 401 || response.status() === 403 };
      if (evidence.github.sourceFailures.length < 100) evidence.github.sourceFailures.push(failure);
      if (response.status() === 429) {
        const until = Date.now() + retryAfter(headers['retry-after'], provider); cooldowns.set(provider, Math.max(cooldowns.get(provider) ?? 0, until));
        item.rateLimitedUntil = new Date(cooldowns.get(provider)).toISOString(); item.holdReason = 'provider_http429'; item.cooldownProvider = provider;
        if (!abort.signal.aborted) abort.abort(new Error(`Cross-provider source HTTP429 until ${item.rateLimitedUntil}`));
        void github.close().catch(() => undefined);
      }
    });
    await github.bringToFront();
    const response = await github.goto(GH_FILES, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    currentCaseAbort.signal.throwIfAborted();
    evidence.github.navigation = { status: response?.status() ?? null, finalUrl: safeUrl(github.url()) };
    assert.equal(response?.status(), 200, 'The actual GitHub counterpart did not load');
    evidence.github.auth = await authObservation(github, 'github');
    evidence.gitlabAuth = await authObservation(gitlab, 'gitlab');
    const tabs = [{ provider: 'gitlab', page: gitlab, repo: 'gitlab-org/gitlab' }, { provider: 'github', page: github, repo: 'wxt-dev/wxt' }];
    evidence.tabs = await options.evaluate(async (urls) => {
      const tabs = await chrome.tabs.query({});
      return urls.map((url) => { const tab = tabs.find((value) => value.url === url); return { url, tabId: tab?.id ?? null, windowId: tab?.windowId ?? null }; });
    }, tabs.map((tab) => tab.page.url()));
    assert.ok(evidence.tabs.every((tab) => Number.isInteger(tab.tabId) && Number.isInteger(tab.windowId)), 'Both provider pages must be actual installed-profile Chrome tabs');
    assert.notEqual(evidence.tabs[0].tabId, evidence.tabs[1].tabId);
    assert.equal(evidence.tabs[0].windowId, evidence.tabs[1].windowId);
    const activate = async (tab) => { await tab.page.bringToFront(); await poll(() => tab.page.evaluate(() => document.hidden), (hidden) => hidden === false, `Actual ${tab.provider} foreground activation`); };
    const captureRequired = async (tab, stage) => { const files = await capture(tab.page, `cross-settings-${tab.provider}-${stage}`); assert.equal(typeof files.screenshot, 'string', 'A closed counterpart cannot supply required per-tab artifact proof'); return files; };
    const identity = (dom) => { const url = new URL(dom.url); url.hash = ''; return { provider: dom.provider, url: url.href, headerIdentity: dom.headerIdentity }; };
    const sameSource = (dom, oracle) => {
      assert.deepEqual(identity(dom), identity(oracle), 'Shared setting changed a native review/header identity');
      for (const file of oracle.files) {
        const current = dom.files.find((candidate) => candidate.path === file.path);
        assert.ok(current, `Original native file disappeared: ${file.path}`);
        assert.deepEqual({ id: current.id, anchor: current.anchor, head: current.head }, { id: file.id, anchor: file.anchor, head: file.head }, 'Shared setting changed native file IDs or selected source');
      }
    };
    const stage = async (label, mode) => {
      const sample = { label, settings: await readSettings(), tabs: [] }; evidence.stages.push(sample);
      assert.equal(sample.settings.extensionId, extensionId); assert.equal(sample.settings.aiEnabled, false); assert.deepEqual(sample.settings.autoViewed, {});
      for (const tab of tabs) {
        await activate(tab);
        const state = mode === 'disabled'
          ? await poll(() => tabState(tab.page), (value) => value.allowed === false && value.hasDiff === false, `${tab.provider} actual shared master disable`)
          : await poll(() => tabState(tab.page), (value) => value.repo === tab.repo && value.hasDiff === true && equal(value.all, tab.oracle.headers[0]) && (mode === 'all' ? value.hiddenCount === value.all.files && equal(value.visible, { files: 0, additions: 0, deletions: 0 }) && value.categories.some((category) => category.id === 'tests' && category.count === value.all.files) : mode === 'baseline' ? value.hiddenCount > 0 && value.visible?.files > 0 && value.visible.files < value.all.files : equal(value.visible, tab.baseline.state.visible) && value.hiddenCount === tab.baseline.state.hiddenCount), `${tab.provider} complete source and shared ${label} totals`);
        const expected = mode === 'disabled' ? tab.oracle.headers[0] : state.visible;
        const dom = await pollStable(() => crossSettingsDom(tab.page, tab.provider), (value) => !value.hidden && value.headers.length > 0 && value.headers.every((header) => equal(header, expected)) && (mode !== 'disabled' || value.files.every((file) => file.hidden === null)) && (mode !== 'all' || value.files.every((file) => file.hidden !== null)), `${tab.provider} native header and file response to ${label}`, WAIT_MS, (value) => JSON.stringify([value.headers, value.files.map((file) => [file.id, file.hidden])]));
        sameSource(dom, tab.oracle);
        if (tab.provider === 'gitlab' && mode !== 'disabled') assert.equal(state.repository?.provider, 'gitlab');
        const entry = { provider: tab.provider, state, dom }; sample.tabs.push(entry);
        entry.artifacts = await captureRequired(tab, label);
        const afterCapture = await crossSettingsDom(tab.page, tab.provider);
        assert.ok(afterCapture.headers.every((header) => equal(header, expected)), 'Required screenshot capture changed native header totals'); sameSource(afterCapture, tab.oracle);
        if (mode === 'baseline') tab.baseline = entry;
      }
      assert.deepEqual(await readSettings(), sample.settings, 'One provider visit changed the shared settings key');
      return sample;
    };
    for (const tab of tabs) {
      await activate(tab);
      await poll(() => tabState(tab.page), (value) => value.allowed === false && value.hasDiff === false, `${tab.provider} disabled before independent native oracle`);
      tab.oracle = await poll(() => crossSettingsDom(tab.page, tab.provider), (dom) => !dom.hidden && dom.headers.length > 0 && dom.headers.every((row) => row.files > 0 && Number.isInteger(row.additions) && Number.isInteger(row.deletions)) && dom.files.length > 0 && dom.files.every((file) => typeof file.path === 'string' && typeof file.id === 'string' && file.id !== '' && file.hidden === null), `${tab.provider} independent untouched native header oracle`);
      assert.ok(tab.oracle.headers.every((header) => equal(header, tab.oracle.headers[0])), 'Untouched native headers disagree');
      if (tab.provider === 'github') assert.equal(tab.oracle.headerIdentity.repository, tab.repo);
      tab.oracleArtifacts = await captureRequired(tab, 'native-oracle');
    }
    evidence.nativeOracles = tabs.map((tab) => ({ provider: tab.provider, basis: 'Actual provider-rendered header text with shared master disabled; never derived from extension tabState.all.', dom: tab.oracle, artifacts: tab.oracleArtifacts }));
    await patchSettings({ enabled: true });
    await stage('baseline', 'baseline');
    await patchSettings({ categoryPatterns: { ...original.categoryPatterns, tests: ['**/*'] } });
    evidence.globalPatternChange = await readSettings();
    assert.deepEqual(evidence.globalPatternChange.categoryPatterns.tests, ['**/*']);
    assert.deepEqual(evidence.globalPatternChange.categories, original.categories, 'All-hidden classification must come from one global pattern update');
    await stage('one-global-pattern-all-hidden', 'all');
    await patchSettings({ categoryPatterns: original.categoryPatterns ?? {} });
    await stage('patterns-restored', 'restored');
    await patchSettings({ enabled: false });
    await stage('master-disabled-native', 'disabled');
    await patchSettings({ enabled: true });
    await stage('master-reenabled', 'restored');
    evidence.verified = 'One global pattern update in actual chrome.storage.sync drives both independently identified public providers to all-hidden zero totals and native zero headers. Original patterns, master disable/native full counts and reenable restore both sites while preserving native source IDs. Same profile only, no Bitbucket case or authenticated write.';
    return {};
  } catch (error) {
    evidence.failure = errorText(error);
    if (github !== undefined && !github.isClosed() && !currentCaseAbort.signal.aborted) {
      try { evidence.github.failureArtifacts = await capture(github, 'cross-settings-github-failed'); }
      catch (captureError) { evidence.github.captureError = errorText(captureError); }
    }
    throw error;
  }
  finally {
    const errors = [];
    try {
      evidence.cleanupSettings = await options.evaluate(async (key, before) => {
        const current = (await chrome.storage.sync.get(key))[key] ?? {};
        for (const field of ['enabled', 'categoryPatterns']) { if (Object.hasOwn(before, field)) current[field] = before[field]; else delete current[field]; }
        await chrome.storage.sync.set({ [key]: current });
        const after = (await chrome.storage.sync.get(key))[key];
        return { restored: ['enabled', 'categoryPatterns'].every((field) => Object.hasOwn(before, field) === Object.hasOwn(after, field) && JSON.stringify(before[field]) === JSON.stringify(after[field])) };
      }, SETTINGS_KEY, original);
      assert.equal(evidence.cleanupSettings.restored, true, 'Shared settings cleanup did not restore the original fields');
    } catch (error) { errors.push(error); }
    closing = true;
    if (github !== undefined && !github.isClosed()) { try { await github.close(); } catch (error) { if (!closedTarget(error)) errors.push(error); } }
    if (!gitlab.isClosed()) { try { await gitlab.bringToFront(); } catch (error) { if (!closedTarget(error)) errors.push(error); } }
    if (errors.length > 0) { evidence.cleanupErrors = errors.map(errorText); throw new AggregateError(errors, 'Cross-provider settings cleanup failed'); }
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
  await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }));
  const clickTarget = await poll(() => page.$eval(selector, (button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { unobstructed: hit !== null && button.contains(hit), top: rect.top, bottom: rect.bottom, hitTag: hit?.tagName ?? null };
  }), (value) => value.unobstructed, 'Native toggle center is visible below sticky navigation', 5000);
  await page.evaluate((selector) => {
    globalThis.__geldTrustedToggleClick?.cleanup();
    let listener;
    let timeout;
    const cleanup = () => { clearTimeout(timeout);document.removeEventListener('click', listener, true); };
    const pending = new Promise((resolve, reject) => {
      listener = (event) => {
        const button = event.target instanceof Element ? event.target.closest(selector) : null;
        if (button === null) return;
        cleanup();
        resolve({ trusted: event.isTrusted, label: button.textContent.trim(), expanded: button.getAttribute('aria-expanded'), phase: 'document capture before native state changes' });
      };
      timeout = setTimeout(() => { cleanup();reject(new Error('Trusted hidden-file toggle click was not observed')); }, 5000);
      document.addEventListener('click', listener, true);
    });
    globalThis.__geldTrustedToggleClick = { pending, cleanup };
  }, selector);
  try {
    await page.click(selector);
    const event = await page.evaluate(() => globalThis.__geldTrustedToggleClick.pending);
    assert.equal(event.trusted, true, 'Hidden-file toggle must receive a real trusted browser click');
    return { before, clickTarget, event };
  } finally {
    if (!page.isClosed()) await page.evaluate(() => { globalThis.__geldTrustedToggleClick?.cleanup();delete globalThis.__geldTrustedToggleClick; });
  }
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
async function installedHover(page, selector, interaction, artifactName, anchorSelector, { preserveNativeCard = false } = {}) {
  if (!preserveNativeCard) {
    await page.keyboard.press('Escape');
    await page.mouse.move(1, 1);
  }
  let keyboardNavigation;
  if (interaction === 'keyboard') {
    const previous = await page.evaluate((target) => {
      const anchor = [...document.querySelectorAll(target)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
      const order = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((node) => node.tabIndex >= 0 && !node.disabled && node.closest('[inert]') === null && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
      const at = order.indexOf(anchor);
      const describe = (node) => node == null ? null : { tag: node.tagName, id: node.id, testid: node.getAttribute('data-testid'), href: node.getAttribute('href'), tabindex: node.getAttribute('tabindex'), label: node.getAttribute('aria-label'), text: node.textContent.trim().slice(0, 120) };
      if (at < 0) return { started: false, reason: 'Requested count host is not sequentially keyboard focusable', target: describe(anchor) };
      for (let index = at - 1; index >= Math.max(0, at - 12); index -= 1) {
        const prior = order[index];
        prior.focus();
        if (document.activeElement === prior) return { started: true, target: describe(anchor), previous: describe(prior), direction: 'Tab' };
      }
      for (let index = at + 1; index < Math.min(order.length, at + 13); index += 1) {
        const next = order[index];
        next.focus();
        if (document.activeElement === next) return { started: true, target: describe(anchor), previous: describe(next), direction: 'Shift+Tab' };
      }
      return { started: false, reason: 'No neighboring control accepted real browser focus', target: describe(anchor) };
    }, selector);
    assert.equal(previous.started, true, `A real neighboring keyboard control is required: ${JSON.stringify(previous)}`);
    keyboardNavigation = { ...previous, stops: [] };
    for (let index = 0; index < 12; index += 1) {
      if (previous.direction === 'Shift+Tab') {
        await page.keyboard.down('Shift');
        try { await page.keyboard.press('Tab'); }
        finally { await page.keyboard.up('Shift'); }
      } else await page.keyboard.press('Tab');
      const stop = await page.evaluate((target) => {
        const node = document.activeElement;
        return { target: [...document.querySelectorAll(target)].some((value) => value === node), tag: node?.tagName, id: node?.id, href: node?.getAttribute('href'), testid: node?.getAttribute('data-testid'), label: node?.getAttribute('aria-label'), text: node?.textContent.trim().slice(0, 120) };
      }, selector);
      keyboardNavigation.stops.push(stop);
      if (stop.target) break;
    }
    assert.equal(keyboardNavigation.stops.at(-1)?.target, true, `Real Tab traversal did not reach the count owner: ${JSON.stringify(keyboardNavigation)}`);
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
  return { ...snapshot, interaction, ...(keyboardNavigation === undefined ? {} : { keyboardNavigation }), screenshot: `${artifactName}.png`, escapeDismissed: true };
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
      root: root == null ? null : { id: root.id, data: root.getAttribute('data-file-data'), display: getComputedStyle(root).display, hiddenMode: root.getAttribute('data-geld-provider-hidden'), rendered: root.querySelector('article[data-qa="branch-diff-file"]') !== null,
        expanded: content != null && content.closest('[aria-hidden="true"]') === null && getComputedStyle(content).display !== 'none', codeLines: root.querySelectorAll('[data-qa="code-line"]').length } };
  }, path, provider);
  const initial = await poll(read, (value) => value.headers.length >= 2 && /^Essential/.test(value.headers[0].text) && value.headers[0].expanded === 'true' && value.headers.at(-1).expanded === 'false' && value.root?.display === 'none', 'Essential starts expanded and Tests starts collapsed');
  await page.focus('.geld-provider-category-header');
  await page.keyboard.press('End');
  const endFocused = await read();
  assert.match(endFocused.focusedHeader ?? '', /^Tests/, 'Real End key did not focus the Tests category');
  await page.keyboard.press('Enter');
  const testsOpen = (value) => value.headers.length >= 2 && value.headers.filter((header) => header.expanded === 'true').length === 1 && value.headers[0].expanded === 'false' && value.headers.at(-1).expanded === 'true' && value.root !== null && value.root.display !== 'none' && value.clone !== null;
  const opened = await pollStable(read, testsOpen, 'Real Enter keeps only Tests open across multiple controller refresh cycles');
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
  result.openedAfterCapture = await read();
  assert.ok(testsOpen(result.openedAfterCapture), 'Tests category/body choice changed during actual screenshot/DOM capture');
  assert.equal(result.openedAfterCapture.root.id, opened.root.id, 'Category capture replaced the native file identity');
  assert.equal(result.openedAfterCapture.root.data, opened.root.data, 'Category capture changed the native file source');
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
  result.closedAfterCapture = await read();
  assert.equal(result.closedAfterCapture.headers[0]?.expanded, 'true', 'Essential choice changed during capture');
  assert.equal(result.closedAfterCapture.headers.at(-1)?.expanded, 'false', 'Tests reopened during Essential capture');
  assert.equal(result.closedAfterCapture.root?.display, 'none', 'Categorized native file became visible during Essential capture');
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
    if (row == null) {
      const emptyState = document.querySelector('[data-testid="issuable-empty-state"]');
      if (emptyState?.textContent.includes('Too many results to display')) throw new Error('Native GitLab list unavailable: Too many results to display. Required MR266334 row/counts remain unverified.');
      return null;
    }
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

function assertGitLabCommitBreakdown(value) {
  const expected = [
    { label: 'Essential', files: '1 file', additions: '+2', deletions: '−0' },
    { label: 'Tests', files: '1 file', additions: '+10', deletions: '−0' },
    { label: 'Total', files: '2 files', additions: '+12', deletions: '−0' },
  ];
  for (const row of expected) assert.deepEqual(value.rows.find((item) => item.label === row.label), row, 'Immutable commit breakdown must describe its own two-file diff, not the full MR');
}

async function gitLabCommitPresentation(page) {
  const dom = await gitLabDom(page);
  const source = await page.evaluate(() => ({
    sha: document.querySelector('[data-testid="commit-sha-content"]')?.textContent.trim(),
    files: [...document.querySelectorAll('diff-file[data-file-data]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => {
      const data = JSON.parse(node.getAttribute('data-file-data'));
      return { id: node.id, path: data.new_path, display: getComputedStyle(node).display, hidden: node.getAttribute('data-geld-provider-hidden'), links: [...node.querySelectorAll('a[href]')].filter((link) => link.closest('[data-geld-ui]') === null).map((link) => link.getAttribute('href')) };
    }),
  }));
  return { ...dom, ...source };
}

async function gitLabCommitCounts(page) {
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  const all = { files: 2, additions: 12, deletions: 0 };
  const visible = { files: 1, additions: 2, deletions: 0 };
  const classifiedPath = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
  const headerHas = (value, totals) => value.headers.some((header) => Object.keys(totals).every((key) => header[key] === totals[key]));
  const fingerprint = (value) => value.files.map(({ id, path, links }) => ({ id, path, links }));
  try {
    const state = await waitTotals(page, all, visible, 1);
    assert.equal(state.onDiffPage, true);
    const filtered = await poll(() => gitLabCommitPresentation(page), (value) => value.sha === GL_COMMIT_SHA.slice(0, 8) && value.files.length === 2 && headerHas(value, visible) && value.files.some((file) => file.path === classifiedPath && file.display === 'none'), 'Native immutable commit header and actual test file are filtered');
    const headerHints = await headerHintsEvidence(page, '1 test', '[data-testid="js-file-addition-line"]', 'gitlab-commit-header');
    const pointer = await installedHover(page, '[data-testid="js-file-addition-line"]', 'pointer', 'gitlab-commit-pointer');
    const keyboard = headerHints.keyboard;
    for (const value of [pointer, keyboard]) assertGitLabCommitBreakdown(value);
    assert.equal(pointer.text, keyboard.text);
    const filteredArtifacts = await capture(page, 'gitlab-commit-filtered');
    await patchSettings({ categories: { ...original.categories, tests: false } });
    const categoryOff = await waitTotals(page, all, all, 0);
    const categoryOffDom = await poll(() => gitLabCommitPresentation(page), (value) => headerHas(value, all) && value.files.every((file) => file.hidden === null && file.display !== 'none'), 'Actual tests setting restores the complete native commit');
    assert.deepEqual(fingerprint(categoryOffDom), fingerprint(filtered), 'Category setting changed native commit file IDs or source links');
    await patchSettings({ categories: { ...original.categories, tests: true } });
    const categoryRestored = await waitTotals(page, all, visible, 1);
    await poll(() => gitLabCommitPresentation(page), (value) => headerHas(value, visible) && value.files.some((file) => file.path === classifiedPath && file.display === 'none'), 'Reenabling the shared test category filters the actual commit again');
    await patchSettings({ enabled: false });
    await poll(() => tabState(page), (value) => value.hasDiff === false && value.allowed === false, 'Master disable releases the immutable commit');
    const disabled = await poll(() => gitLabCommitPresentation(page), (value) => headerHas(value, all) && value.hidden.length === 0 && value.files.every((file) => file.display !== 'none'), 'Master disable restores original native commit counts and file visibility');
    assert.deepEqual(fingerprint(disabled), fingerprint(filtered), 'Master disable changed native commit file IDs or source links');
    const disabledArtifacts = await capture(page, 'gitlab-commit-disabled');
    await patchSettings({ enabled: true });
    const reenabled = await waitTotals(page, all, visible, 1);
    return { state, filtered, headerHints, pointer, keyboard, filteredArtifacts, categoryOff, categoryOffDom, categoryRestored, disabled, disabledArtifacts, reenabled, nativeReferenceCards: { status: 'not_evaluated', reason: 'Commit-row link and native count-host popovers are Geld breakdowns. Provider reference cards are separate discovery.' } };
  } finally { await patchSettings({ enabled: original.enabled ?? true, categories: original.categories }); }
}

async function gitLabBinaryPresentation(page) {
  return page.evaluate((path) => {
    const native = (node) => node !== null && node.closest('[data-geld-ui]') === null;
    const bounds = (node) => { if (node === null) return null;const rect = node.getBoundingClientRect();return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
    const tab = document.querySelector('[data-testid="diffs-tab"]');
    const badge = tab?.querySelector('.js-changes-tab-count');
    const actions = document.querySelector('.merge-request-tabs-container > .merge-request-tabs-actions');
    const root = [...document.querySelectorAll('diff-file[data-file-data]')].find((node) => native(node) && JSON.parse(node.getAttribute('data-file-data')).new_path === path);
    const viewport = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
    const clip = { ...viewport };
    const scrollers = [];
    for (let parent = root?.parentElement; parent !== null && parent !== undefined; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (!/^(auto|scroll|overlay)$/.test(style.overflowY || style.overflow) || parent.scrollHeight <= parent.clientHeight + 1) continue;
      const rect = parent.getBoundingClientRect();
      clip.left = Math.max(clip.left, rect.left); clip.right = Math.min(clip.right, rect.right);
      clip.top = Math.max(clip.top, rect.top); clip.bottom = Math.min(clip.bottom, rect.bottom);
      scrollers.push({ tag: parent.tagName, className: parent.className, bounds: bounds(parent), scrollTop: parent.scrollTop });
    }
    const painted = (node) => {
      const rect = bounds(node);
      if (rect === null) return { bounds: null, visibleBounds: null, painted: false };
      const visibleBounds = { left: Math.max(clip.left, rect.left), right: Math.min(clip.right, rect.right), top: Math.max(clip.top, rect.top), bottom: Math.min(clip.bottom, rect.bottom) };
      const positive = visibleBounds.right - visibleBounds.left > 1 && visibleBounds.bottom - visibleBounds.top > 1;
      const hit = positive ? document.elementFromPoint((visibleBounds.left + visibleBounds.right) / 2, (visibleBounds.top + visibleBounds.bottom) / 2) : null;
      const presentedNode = node.tagName === 'IMG' ? node.parentElement : node;
      return { bounds: rect, visibleBounds, painted: positive && hit !== null && presentedNode?.contains(hit) === true };
    };
    const sidebarHost = document.querySelector('[data-testid="file-tree-container"]');
    const sidebarElement = (node) => {
      if (node === null) return null;
      const rect = bounds(node); const style = getComputedStyle(node); const clipped = { ...viewport }; const ancestors = [];
      for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
        const css = getComputedStyle(parent); const box = bounds(parent);
        const clipsX = /^(auto|scroll|overlay|hidden|clip)$/.test(css.overflowX || css.overflow);
        const clipsY = /^(auto|scroll|overlay|hidden|clip)$/.test(css.overflowY || css.overflow);
        if (clipsX) { clipped.left = Math.max(clipped.left, box.left); clipped.right = Math.min(clipped.right, box.right); }
        if (clipsY) { clipped.top = Math.max(clipped.top, box.top); clipped.bottom = Math.min(clipped.bottom, box.bottom); }
        if (clipsX || clipsY || parent.scrollTop !== 0 || parent.scrollLeft !== 0) ancestors.push({ tag: parent.tagName, className: parent.className,
          bounds: box, display: css.display, position: css.position, overflowX: css.overflowX, overflowY: css.overflowY,
          scrollTop: parent.scrollTop, scrollLeft: parent.scrollLeft, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight,
          clientWidth: parent.clientWidth, scrollWidth: parent.scrollWidth, clipsX, clipsY });
      }
      const visibleBounds = { left: Math.max(clipped.left, rect.left), right: Math.min(clipped.right, rect.right), top: Math.max(clipped.top, rect.top), bottom: Math.min(clipped.bottom, rect.bottom) };
      const positive = rect.width > 0 && rect.height > 0 && visibleBounds.right - visibleBounds.left > 1 && visibleBounds.bottom - visibleBounds.top > 1;
      const hit = positive ? document.elementFromPoint((visibleBounds.left + visibleBounds.right) / 2, (visibleBounds.top + visibleBounds.bottom) / 2) : null;
      return { tag: node.tagName, id: node.id, className: node.className, bounds: rect, clip: clipped, visibleBounds, ancestors,
        style: { display: style.display, visibility: style.visibility, opacity: style.opacity, position: style.position, overflowX: style.overflowX,
          overflowY: style.overflowY, maxBlockSize: style.maxBlockSize, fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight },
        hit: hit === null ? null : { tag: hit.tagName, id: hit.id, className: hit.getAttribute('class'), owned: hit.closest('[data-geld-ui]') !== null },
        painted: positive && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) > 0 && hit !== null && node.contains(hit) };
    };
    const selectedSidebarItem = [...sidebarHost?.querySelectorAll('.geld-provider-category[data-active="true"] [data-geld-category-path]') ?? []].find((node) => node.getAttribute('data-geld-category-path') === path);
    const selectedSidebarRow = selectedSidebarItem?.querySelector('.geld-provider-category-native-row') ?? null;
    const selectedSidebarControl = selectedSidebarRow?.matches('a,button') ? selectedSidebarRow : selectedSidebarRow?.querySelector('a,button') ?? null;
    const sidebar = sidebarHost === null ? null : {
      host: { ...sidebarElement(sidebarHost), categoryMarker: sidebarHost.getAttribute('data-geld-provider-category-host'), sizedMarker: sidebarHost.getAttribute('data-geld-provider-tree-sized'), inlineStyle: sidebarHost.getAttribute('style') },
      headers: [...sidebarHost.querySelectorAll('.geld-provider-category-header')].map((button) => ({ ...sidebarElement(button), text: button.textContent, expanded: button.getAttribute('aria-expanded') })),
      selectedFile: selectedSidebarControl === null ? null : { ...sidebarElement(selectedSidebarControl), path: selectedSidebarItem.getAttribute('data-geld-category-path'), label: selectedSidebarControl.getAttribute('aria-label'), current: selectedSidebarControl.getAttribute('aria-current') },
      nativeBodies: [...sidebarHost.querySelectorAll('nav.mr-tree-list')].filter(native).map((node) => ({ ...sidebarElement(node), marker: node.getAttribute('data-geld-provider-category-body') })),
    };
    return { badge: badge?.textContent.trim(), badgeGid: badge?.getAttribute('data-gid'), tabId: tab?.id, href: tab?.querySelector('a')?.getAttribute('href'),
      categories: [...document.querySelectorAll('.geld-provider-category-header')].map((button) => ({ text: button.textContent, expanded: button.getAttribute('aria-expanded') })),
      viewport, clip, scrollers, sidebar,
      stats: [...document.querySelectorAll('.diff-stats.inline-parallel-buttons .diff-stats-contents')].filter(native).map((node) => ({ text: node.textContent.trim(), lineCounters: [...node.querySelectorAll('[data-testid="js-file-addition-line"], [data-testid="js-file-deletion-line"]')].map((count) => count.textContent.trim()), html: node.outerHTML.slice(0, 3000) })),
      actions: actions === null ? null : { native: native(actions), bounds: bounds(actions), html: actions.outerHTML.slice(0, 7000), children: [...actions.children].filter(native).map((node) => ({ id: node.id, testid: node.getAttribute('data-testid') })) },
      file: root === undefined ? null : { id: root.id, path: JSON.parse(root.getAttribute('data-file-data')).new_path, data: root.getAttribute('data-file-data'), display: getComputedStyle(root).display, hidden: root.getAttribute('data-geld-provider-hidden'),
        bounds: bounds(root), bodyOpen: root.querySelector('details[data-file-body]')?.open === true,
        header: painted(root.querySelector('[data-testid="rd-diff-file-header"]')),
        images: [...root.querySelectorAll('img')].filter(native).map((image) => ({ src: image.getAttribute('src'), alt: image.getAttribute('alt'), complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, ...painted(image) })),
        text: root.textContent.replace(/\s+/g, ' ').trim().slice(-800) },
      nativeControls: [...document.querySelectorAll('.merge-request-tabs-container a[href], .merge-request-tabs-actions button')].filter(native).map((node) => ({ id: node.id, href: node.getAttribute('href'), testid: node.getAttribute('data-testid'), label: node.getAttribute('aria-label') })),
    };
  }, GL_BINARY_PATH);
}

function assertGitLabBinaryBreakdown(value, filtered) {
  const expected = [
    { label: 'Essential', files: filtered ? '10 files' : '11 files', additions: '+0', deletions: '−0' },
    { label: 'Tests', files: filtered ? '1 file' : '0 files', additions: '+0', deletions: '−0' },
    { label: 'Total', files: '11 files', additions: '+0', deletions: '−0' },
  ];
  for (const row of expected) assert.deepEqual(value.rows.find((item) => item.label === row.label), row, 'Binary-only breakdown must retain real file counts with zero changed text lines');
}

async function gitLabBinaryCounts(page, item) {
  const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
  const all = { files: 11, additions: 0, deletions: 0 };
  const visible = { files: 10, additions: 0, deletions: 0 };
  try {
    await patchSettings({ enabled: false });
    await poll(() => tabState(page), (value) => value.hasDiff === false && value.allowed === false, 'Native binary-only page baseline before Geld classification');
    item.nativeBaseline = await poll(() => gitLabBinaryPresentation(page), (value) => value.badge === '11' && value.badgeGid === 'gid://gitlab/MergeRequest/321472212' && value.file !== null && value.file.hidden === null, 'Genuine eleven-file native Changes badge and observed PNG wrapper');
    item.nativeBaselineArtifacts = await capture(page, 'gitlab-binary-native-baseline');
    assert.ok(item.nativeBaseline.stats.every((stats) => stats.lineCounters.length === 0), 'The binary-only native header must have no changed text-line counters');
    const hintHost = item.nativeBaseline.stats.length > 0 ? '.diff-stats.inline-parallel-buttons .diff-stats-contents > .diff-stats-group > span' : '.geld-provider-header-hidden-count';
    item.nativeHeaderVariant = item.nativeBaseline.stats.length > 0 ? 'Hydrated native file-only statistics, without line counters' : 'Native action-area fallback, without a statistics wrapper';
    if (item.nativeBaseline.stats.length === 0) assert.equal(item.nativeBaseline.actions?.native, true, 'Actual neutral native action-area fallback host is unavailable');
    await patchSettings({ enabled: true });
    item.baselineState = await waitTotals(page, all, all, 0);
    item.baselineHeaderHints = await headerHintsEvidence(page, '0 tests', hintHost, 'gitlab-binary-baseline');
    for (const value of [item.baselineHeaderHints.pointer, item.baselineHeaderHints.keyboard]) assertGitLabBinaryBreakdown(value, false);
    await patchSettings({ categoryPatterns: { ...original.categoryPatterns, tests: [GL_BINARY_PATH] } });
    item.filteredState = await waitTotals(page, all, visible, 1);
    item.filtered = await poll(() => gitLabBinaryPresentation(page), (value) => value.badge === '10' && value.file?.display === 'none' && value.file.hidden === 'closed', 'Exact observed PNG is categorized through real shared settings and native Changes badge reaches10');
    item.filteredHeaderHints = await headerHintsEvidence(page, '1 test', hintHost, 'gitlab-binary-filtered');
    for (const value of [item.filteredHeaderHints.pointer, item.filteredHeaderHints.keyboard]) assertGitLabBinaryBreakdown(value, true);
    item.categoryInteraction = await categoryInteraction(page, GL_BINARY_PATH, 'gitlab', 'gitlab-binary-category', false);
    await page.focus('.geld-provider-category-header');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const fileSelector = `[data-geld-category-path=${JSON.stringify(GL_BINARY_PATH)}] .geld-provider-category-native-row`;
    const handle = await page.evaluateHandle((selector) => {
      const row = document.querySelector(selector);
      return row?.matches('a,button') ? row : row?.querySelector('a,button') ?? null;
    }, fileSelector);
    const clone = handle.asElement();
    assert.ok(clone !== null, 'Actual binary file category control is unavailable');
    await clone.click();
    await discardHandle(handle);
    const revealedVisible = (value) => value.categories.length === 2 && value.categories[0].expanded === 'false' && value.categories[1].expanded === 'true'
      && value.badge === '10' && value.file?.hidden === 'open' && value.file.display !== 'none' && value.file.bodyOpen === true
      && value.file.header.painted && value.file.images.some((image) => image.src !== null && image.complete && image.naturalWidth > 0 && image.painted)
      && value.sidebar?.headers.length === 2 && value.sidebar.headers.every((header) => header.painted)
      && value.sidebar.headers[0].expanded === 'false' && value.sidebar.headers[1].expanded === 'true' && value.sidebar.selectedFile?.painted === true && value.sidebar.selectedFile.current === 'true'
      && value.sidebar.nativeBodies.length > 0 && value.sidebar.nativeBodies.every((body) => body.marker === 'native' && body.style.display === 'none');
    const revealPosition = (value) => JSON.stringify([value.categories, value.file?.id, value.file?.header.bounds, value.file?.images.map((image) => image.visibleBounds),
      value.sidebar?.headers.map((header) => header.bounds), value.sidebar?.selectedFile?.bounds, value.sidebar?.nativeBodies.map((body) => [body.marker, body.style.display])]);
    try {
      item.revealed = await pollStable(async () => {
        const value = await gitLabBinaryPresentation(page); item.revealVisibilityLastProbe = value; return value;
      }, revealedVisible, 'Selected PNG plus owned Tests header/file row stay simultaneously painted while native tree body stays hidden', 25_000, revealPosition);
    } catch (error) {
      item.revealFailureViewportArtifacts = { screenshot: 'gitlab-binary-reveal-unsettled-viewport.png', fullPage: false, captureBeyondViewport: false, status: 'diagnostic_only_no_feature_pass' };
      try {
        await page.screenshot({ path: resolve(artifacts, item.revealFailureViewportArtifacts.screenshot), fullPage: false, captureBeyondViewport: false });
        item.revealFailureAfterViewportProbe = await gitLabBinaryPresentation(page);
      } catch (captureError) { item.revealFailureViewportArtifacts.captureError = errorText(captureError); }
      throw error;
    }
    assert.equal(item.revealed.file.id, item.nativeBaseline.file.id);
    assert.equal(item.revealed.file.data, item.nativeBaseline.file.data, 'Native binary source identity changed on category reveal');
    for (const image of item.nativeBaseline.file.images) assert.ok(item.revealed.file.images.some((value) => value.src === image.src && value.alt === image.alt), 'Category reveal lost an already mounted native source image');
    item.revealCaptureStages = [{ stage: 'settled-before-viewport-capture', observedAt: new Date().toISOString(), value: item.revealed }];
    item.revealedViewportArtifacts = { screenshot: 'gitlab-binary-image-revealed-viewport.png', fullPage: false, captureBeyondViewport: false };
    await page.screenshot({ path: resolve(artifacts, item.revealedViewportArtifacts.screenshot), fullPage: false, captureBeyondViewport: false });
    item.revealedAfterViewportCapture = await gitLabBinaryPresentation(page);
    item.revealCaptureStages.push({ stage: 'immediately-after-viewport-capture', observedAt: new Date().toISOString(), value: item.revealedAfterViewportCapture });
    assert.ok(revealedVisible(item.revealedAfterViewportCapture), 'Viewport capture changed simultaneous owned sidebar/selected-image painting or exposed the native tree');
    assert.equal(item.revealedAfterViewportCapture.file.id, item.nativeBaseline.file.id);
    assert.equal(item.revealedAfterViewportCapture.file.data, item.nativeBaseline.file.data);
    item.revealedBeforeFullPageCapture = await gitLabBinaryPresentation(page);
    item.revealCaptureStages.push({ stage: 'immediately-before-full-page-capture', observedAt: new Date().toISOString(), value: item.revealedBeforeFullPageCapture });
    assert.ok(revealedVisible(item.revealedBeforeFullPageCapture), 'Owned sidebar or selected image lost painting before full-page capture');
    item.revealedArtifacts = { ...await capture(page, 'gitlab-binary-image-revealed'), fullPage: true };
    item.revealedAfterCapture = await gitLabBinaryPresentation(page);
    item.revealCaptureStages.push({ stage: 'immediately-after-full-page-capture', observedAt: new Date().toISOString(), value: item.revealedAfterCapture });
    assert.ok(revealedVisible(item.revealedAfterCapture), 'Full-page capture changed simultaneous owned sidebar/selected-image painting or exposed the native tree');
    assert.equal(item.revealedAfterCapture.file.id, item.nativeBaseline.file.id);
    assert.equal(item.revealedAfterCapture.file.data, item.nativeBaseline.file.data);
    assert.deepEqual(item.revealedAfterCapture.file.images.map(({ src, alt }) => ({ src, alt })), item.revealed.file.images.map(({ src, alt }) => ({ src, alt })), 'Capture changed native image source identities');
    for (const key of ['left', 'right', 'top', 'bottom']) assert.ok(Math.abs(item.revealedAfterCapture.file.header.bounds[key] - item.revealed.file.header.bounds[key]) <= 2, `Selected PNG header moved during capture: ${key}`);
    await patchSettings({ enabled: false });
    await poll(() => tabState(page), (value) => value.hasDiff === false && value.allowed === false, 'Master disable releases binary-only source ownership');
    item.disabled = await poll(() => gitLabBinaryPresentation(page), (value) => value.badge === '11' && value.file?.hidden === null && value.file?.display !== 'none', 'Master disable restores actual binary Changes badge and source wrapper');
    for (const control of item.nativeBaseline.nativeControls) assert.ok(item.disabled.nativeControls.some((value) => JSON.stringify(value) === JSON.stringify(control)), 'Binary header processing lost a native ID, link or review control');
    await patchSettings({ enabled: true, categoryPatterns: original.categoryPatterns ?? {} });
    item.restoredState = await waitTotals(page, all, all, 0);
    item.restored = await poll(() => gitLabBinaryPresentation(page), (value) => value.badge === '11' && value.file?.hidden === null && value.file?.display !== 'none', 'Removing the actual pattern restores the native eleven-file binary review');
    item.restoredHeaderHints = await headerHintsEvidence(page, '0 tests', hintHost, 'gitlab-binary-restored', false);
    for (const control of item.nativeBaseline.nativeControls) assert.ok(item.restored.nativeControls.some((value) => JSON.stringify(value) === JSON.stringify(control)), 'Pattern restoration lost a native header control');
    item.featureParity = 'partial';
    return { status: 'passed', verified: 'Real eleven-file PNG-only source retains zero text-line totals while exact shared classification adjusts the native Changes badge11→10, actual native file-only header hint pointer/Tab/Escape breakdowns agree, native category image reveal retains source identity, and disable/pattern removal restore native controls/counts. No synthetic zero-line header widgets are inserted.' };
  } finally { await patchSettings({ enabled: original.enabled ?? true, categoryPatterns: original.categoryPatterns ?? {} }); }
}

function observeGitLabBotFixture(page, item) {
  const evidence = { metadata: [], metadataResponses: [], discussions: [], errors: [], providerMutations: [], aiRequests: [] };
  item.nativeBotFixture = evidence;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/\/(?:chat\/completions|responses|completions)\/?$/.test(url.pathname) && providerOf(url.href) === null) evidence.aiRequests.push(safeUrl(url.href));
    if (providerOf(url.href) !== 'gitlab' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const mutation = url.pathname === '/api/graphql' ? /\bmutation\b/.test(request.postData() ?? '') : /\/(?:notes|discussions|draft_notes|approve|unapprove|reviews|merge)(?:\/|$)/.test(url.pathname);
    if (mutation) evidence.providerMutations.push({ method: request.method(), url: safeUrl(url.href) });
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== 'https://gitlab.com') return;
    const metadata = decodeURIComponent(url.pathname) === '/api/v4/projects/whitebox-aero/whitebox/merge_requests/272';
    const discussions = url.pathname === '/whitebox-aero/whitebox/-/merge_requests/272/discussions.json';
    if (!metadata && !discussions) return;
    if (metadata && evidence.metadataResponses.length < 12) evidence.metadataResponses.push({ url: safeUrl(url.href), status: response.status(), fromCache: response.fromCache() });
    if (response.status() !== 200) return;
    void response.json().then((value) => {
      if (metadata) {
        if (evidence.metadata.length < 12) evidence.metadata.push({ url: safeUrl(url.href), iid: value.iid, state: value.state, sha: value.sha, diffHead: value.diff_refs?.head_sha, webUrl: value.web_url });
      } else if (Array.isArray(value) && evidence.discussions.length < 12) {
        const selected = value.flatMap((thread) => (thread.notes ?? []).filter((note) => GL_BOT_NOTE_IDS.includes(String(note.id))).map((note) => {
          const body = typeof note.note === 'string' ? note.note : '';
          return { id: String(note.id), discussionId: thread.id, system: note.system, author: { id: String(note.author?.id), username: note.author?.username, bot: note.author?.bot, userType: note.author?.user_type }, url: note.noteable_note_url,
            resolved: thread.resolved, active: thread.active, path: thread.position?.new_path ?? thread.position?.old_path ?? thread.diff_file?.new_path ?? thread.diff_file?.old_path, line: thread.position?.new_line ?? thread.position?.old_line,
            createdAt: note.created_at, updatedAt: note.updated_at, bodySha256: createHash('sha256').update(body).digest('hex'),
            summaryHeading: body.includes('<h3>Greptile Summary</h3>'), confidenceFive: body.includes('<h3>Confidence Score: 5/5</h3>'), safeToMerge: body.includes('Safe to merge'),
            reviewedCommit: /Last reviewed commit:[\s\S]*?\]\(https:\/\/gitlab\.com\/whitebox-aero\/whitebox\/-\/commit\/([a-f0-9]{40})\)/.exec(body)?.[1] ?? null };
        }));
        evidence.discussions.push({ url: safeUrl(url.href), discussionCount: value.length, noteCount: value.reduce((sum, thread) => sum + (thread.notes?.length ?? 0), 0), nextCursor: response.headers()['x-next-page-cursor']?.trim() || null, selected });
      }
    }).catch((error) => { if (evidence.errors.length < 10) evidence.errors.push(errorText(error)); });
  });
}

async function botSettings() {
  return options.evaluate(async (key) => {
    const settings = (await chrome.storage.sync.get(key))[key];
    return { trustedReviewAccounts: settings?.trustedReviewAccounts ?? [], trustedSummaryPublishers: settings?.trustedSummaryPublishers ?? [], aiEnabled: settings?.aiEnabled };
  }, SETTINGS_KEY);
}

async function clickReviewButton(page, selector, label) {
  const handle = await page.evaluateHandle((selector, label) => [...document.querySelectorAll(selector)].find((button) => button instanceof HTMLButtonElement && !button.disabled && button.textContent.trim() === label) ?? null, selector, label);
  const button = handle.asElement();
  assert.ok(button !== null, `Missing actual ${label} button in ${selector}`);
  try {
    await button.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await button.click();
    return { label, input: 'Real Puppeteer pointer click on the observed control' };
  } finally { await discardHandle(handle); }
}

async function gitLabBotDigest(page) {
  return page.evaluate((ids) => {
    const panel = document.querySelector('.geld-provider-review');
    if (panel === null) return null;
    const format = (body) => body === null ? null : { text: body.textContent.replace(/\s+/g, ' ').trim(), headings: [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((node) => ({ tag: node.tagName, text: node.textContent.trim() })), tables: body.querySelectorAll('table').length, disclosures: body.querySelectorAll('details').length, codeBlocks: body.querySelectorAll('pre').length, links: [...body.querySelectorAll('a[href]')].map((link) => link.href), badges: [...body.querySelectorAll('img[src*="greptile-static-assets"]')].map((image) => ({ src: image.getAttribute('src'), alt: image.getAttribute('alt') })) };
    const sources = ids.map((id) => {
      const anchor = `note_${id}`;
      const source = panel.querySelector(`[data-geld-source="${anchor}"]`);
      const nativeCandidate = document.getElementById(anchor);
      const native = nativeCandidate?.matches('[data-testid="noteable-note-container"]') && nativeCandidate.closest('[data-geld-ui]') === null ? nativeCandidate : null;
      const header = native?.querySelector('.note-header a.author-name-link[data-user-id]');
      return { id, anchor, exists: source !== null, links: [...source?.querySelectorAll(':scope > .geld-provider-review__byline > a[href]') ?? []].map((link) => link.href), body: format(source?.querySelector(':scope > .geld-provider-review__body') ?? null),
        native: native === null ? null : { id: native.id, authorId: header?.getAttribute('data-user-id') ?? null, username: header?.getAttribute('data-username') ?? null, body: format(native.querySelector('.note-body .note-text')) } };
    });
    const items = [...panel.querySelectorAll('[data-geld-item]')].map((item) => ({ id: item.getAttribute('data-geld-item'), state: item.getAttribute('data-state'), metadata: item.querySelector(':scope > summary')?.textContent.replace(/\s+/g, ' ').trim(), sources: [...item.querySelectorAll('[data-geld-source]')].map((source) => source.getAttribute('data-geld-source')).filter((anchor) => ids.some((id) => anchor === `note_${id}`)) })).filter((item) => item.sources.length > 0);
    const bots = [...panel.querySelectorAll('[data-geld-review-bot]')].map((bot) => ({ id: bot.getAttribute('data-geld-review-bot'), state: bot.getAttribute('data-state'), text: bot.textContent.replace(/\s+/g, ' ').trim(), links: [...bot.querySelectorAll('a[href]')].map((link) => link.href) }));
    let selectedHead = null;
    try {
      const app = JSON.parse(document.querySelector('[data-rapid-diffs][data-app-data]')?.getAttribute('data-app-data') ?? 'null');
      const selected = app?.versions?.source_versions?.filter((version) => version.selected === true && version.latest === true) ?? [];
      if (app?.mr_path === '/whitebox-aero/whitebox/-/merge_requests/272' && String(app?.iid) === '272' && selected.length === 1) selectedHead = selected[0].head_sha;
    } catch { /* The independently observed native metadata remains required. */ }
    return { state: panel.getAttribute('data-state'), sources, items, bots, selectedHead, aiRunControls: panel.querySelectorAll('[data-geld-ai-run]').length,
      checks: [...panel.querySelectorAll('.geld-provider-review__check')].map((row) => ({ state: row.getAttribute('data-state'), text: row.textContent.replace(/\s+/g, ' ').trim() })), unavailable: [...panel.querySelectorAll('.geld-provider-review__unavailable')].map((node) => node.textContent.trim()) };
  }, GL_BOT_NOTE_IDS);
}

function assertGitLabBotSources(value, baseline) {
  assert.ok(value !== null && ['ready', 'partial'].includes(value.state));
  assert.equal(value.aiRunControls, 0, 'Bot verification must leave AI off');
  assert.equal(value.selectedHead, GL_BOT_HEAD, 'The native selected latest version must match the exact observed current head');
  for (const source of value.sources) {
    assert.equal(source.exists, true, `Actual fetched source ${source.anchor} disappeared`);
    assert.ok(source.links.includes(`${GL_BOT}#${source.anchor}`), `Source ${source.anchor} lost its original permalink`);
    if (source.native !== null) { assert.equal(source.native.authorId, '37628862');assert.equal(source.native.username, GL_BOT_LOGIN); }
    if (baseline !== undefined) {
      const previous = baseline.sources.find((candidate) => candidate.id === source.id);
      assert.deepEqual(source.body, previous?.body, 'Account trust changed original source text or formatting');
      assert.deepEqual(source.native, previous?.native, 'Account trust changed an observed native source identity/body');
    }
  }
  const summary = value.sources.find((source) => source.id === '3381334808');
  assert.ok(summary?.body?.headings.some((heading) => heading.text === 'Greptile Summary'), 'Actual native Greptile heading was not preserved');
  assert.ok(summary.body.headings.some((heading) => heading.text === 'Confidence Score: 5/5'), 'Actual native confidence heading was not preserved');
  assert.ok(summary.body.tables > 0 && summary.body.disclosures > 0, 'Actual native summary table/disclosure formatting was not preserved');
  if (baseline !== undefined) assert.deepEqual(value.checks, baseline.checks, 'Reviewer identity changed native CI facts');
}

async function verifyGitLabBot(page, item) {
  const captured = await poll(() => item.nativeBotFixture, (value) => value.metadata.length >= 1 && value.discussions.some((page) => page.discussionCount === 36 && page.noteCount === 40 && page.selected.length === 4 && page.nextCursor === null), 'Actual native current MR metadata and complete bot discussion sources');
  for (const metadata of captured.metadata) {
    assert.equal(String(metadata.iid), '272');assert.equal(metadata.sha, GL_BOT_HEAD);assert.equal(metadata.diffHead, GL_BOT_HEAD);assert.equal(metadata.state, 'merged');assert.equal(metadata.webUrl, GL_BOT);
  }
  const discussionPage = captured.discussions.find((page) => page.selected.length === 4 && page.nextCursor === null);
  assert.equal(discussionPage.discussionCount, 36);assert.equal(discussionPage.noteCount, 40);
  for (const source of discussionPage.selected) {
    assert.equal(source.author.id, '37628862');assert.equal(source.author.username, GL_BOT_LOGIN);assert.equal(source.author.bot, true);assert.equal(source.author.userType, 'project_bot');assert.equal(source.system, false);assert.equal(source.url, `${GL_BOT}#note_${source.id}`);
  }
  const summary = discussionPage.selected.find((source) => source.id === '3381334808');
  assert.ok(summary?.summaryHeading && summary.confidenceFive && summary.safeToMerge);assert.equal(summary.reviewedCommit, GL_BOT_HEAD, 'The actual summary must name this full reviewed commit');
  for (const source of discussionPage.selected.filter((source) => source.id !== '3381334808')) {
    assert.equal(source.resolved, true);
    assert.equal(source.active, source.id === '3384406925');
    assert.equal(source.path, source.id === '3384406925' ? 'backend/poetry.lock' : 'backend/pyproject.toml');
    assert.equal(source.line, source.id === '3384406925' ? 3739 : 56);
  }
  const initialSettings = await botSettings();
  assert.deepEqual(initialSettings.trustedReviewAccounts, [], 'Fresh fixture must not preload reviewer trust');
  assert.equal(initialSettings.aiEnabled, false);
  const before = await poll(() => gitLabBotDigest(page), (value) => value !== null && ['ready', 'partial'].includes(value.state) && value.selectedHead === GL_BOT_HEAD && value.sources.every((source) => source.exists && source.body !== null), 'Installed untrusted native bot source digest with the exact selected latest head');
  assertGitLabBotSources(before);assert.deepEqual(before.bots, [], 'Vendor-shaped content must not automatically create a bot verdict');
  item.beforeTrust = before;
  item.headVerification = { metadataBodyObservations: captured.metadata.length, nativeSelectedHead: before.selectedHead, summaryReviewedCommit: summary.reviewedCommit, basis: 'Exact native metadata, actual latest selected native version and hydrated installed digest. No second HTTP200 observation is inferred.' };
  const identity = '.geld-provider-review [data-geld-source="note_3381334808"] .geld-provider-reviewer-identity';
  const openedSummaries = await openReviewAncestors(page, `${identity} .geld-provider-reviewer-identity__choices button`);
  const observedIdentity = await page.$eval(identity, (element) => ({ summary: element.querySelector(':scope > summary')?.textContent, metadata: element.querySelector('dl')?.textContent, open: element.open }));
  assert.equal(observedIdentity.summary, 'Identify reviewer');assert.equal(observedIdentity.open, true);assert.ok(observedIdentity.metadata?.includes('37628862') && observedIdentity.metadata.includes(GL_BOT_LOGIN) && observedIdentity.metadata.includes('gitlab.com/whitebox-aero/whitebox'));
  const serviceClick = await clickReviewButton(page, `${identity} .geld-provider-reviewer-identity__choices button`, 'Greptile');
  assert.deepEqual((await botSettings()).trustedReviewAccounts, [], 'Service selection must require a separate Trust confirmation');
  const confirmation = await page.$eval(`${identity} .geld-provider-reviewer-identity__confirmation`, (element) => ({ visible: !element.hidden, question: element.querySelector('p')?.textContent }));
  assert.equal(confirmation.visible, true);assert.ok(confirmation.question?.includes(GL_BOT_LOGIN) && confirmation.question.includes('Greptile'));
  const trustClick = await clickReviewButton(page, `${identity} .geld-provider-reviewer-identity__confirmation button`, 'Trust');
  const binding = 'gitlab.com/whitebox-aero/whitebox greptile 37628862';
  item.savedTrust = await poll(botSettings, (value) => value.trustedReviewAccounts.length === 1 && value.trustedReviewAccounts[0] === binding, 'Actual chrome.storage.sync exact repository and durable account binding after real UI trust');
  assert.deepEqual(item.savedTrust.trustedSummaryPublishers, initialSettings.trustedSummaryPublishers, 'Reviewer trust must not authorize CI publishers');
  const trusted = await poll(() => gitLabBotDigest(page), (value) => value?.bots.some((bot) => bot.id === 'greptile' && bot.state === 'clean' && bot.text.includes('Confidence score: 5/5')), 'Installed source-derived clean Greptile score after explicit trust');
  assertGitLabBotSources(trusted, before);
  assert.equal(trusted.bots.length, 1);assert.ok(trusted.bots[0].text.includes(GL_BOT_LOGIN) && trusted.bots[0].text.includes('No findings'));assert.ok(trusted.bots[0].links.includes(`${GL_BOT}#note_3381334808`));
  const findings = trusted.items.filter((item) => item.sources.some((anchor) => anchor !== 'note_3381334808'));
  assert.equal(findings.length, 2, 'Three historical resolved finding comments must remain two clustered items');
  assert.deepEqual(findings.map((item) => [...item.sources].sort()).sort(), [['note_3381334872', 'note_3381334884'], ['note_3384406925']]);
  for (const finding of findings) { assert.equal(finding.state, 'resolved');assert.ok(finding.metadata?.includes(finding.sources.includes('note_3384406925') ? 'backend/poetry.lock:3739' : 'backend/pyproject.toml:56')); }
  item.trusted = trusted;item.identityInteraction = { openedSummaries, observedIdentity, serviceClick, confirmation, trustClick };item.trustedArtifacts = await capture(page, 'gitlab-bot-trusted');
  await options.bringToFront();
  await poll(() => options.$eval('#trusted-review-accounts', (area) => area.value), (value) => value.trim() === binding, 'Actual options editor observes the new explicit binding');
  await options.click('#trusted-review-accounts');await options.keyboard.down('Control');await options.keyboard.press('KeyA');await options.keyboard.up('Control');await options.keyboard.press('Backspace');
  const saveHandle = await options.evaluateHandle(() => document.querySelector('#trusted-review-accounts')?.parentElement?.querySelector('button') ?? null);
  const saveButton = saveHandle.asElement();assert.ok(saveButton !== null, 'Missing actual trusted-account Save control');
  try {
    assert.equal(await saveButton.evaluate((element) => element.textContent), 'Save trusted accounts');
    await saveButton.evaluate((element) => element.scrollIntoView({ block: 'center' }));await saveButton.click();
    item.withdrawalClick = { label: 'Save trusted accounts', input: 'Real Puppeteer pointer click in the exact account setting block' };
  } finally { await discardHandle(saveHandle); }
  item.withdrawnSettings = await poll(botSettings, (value) => value.trustedReviewAccounts.length === 0, 'Real options Save withdraws trust from actual Chrome sync storage');
  assert.deepEqual(item.withdrawnSettings.trustedSummaryPublishers, initialSettings.trustedSummaryPublishers);assert.equal(item.withdrawnSettings.aiEnabled, false);
  await page.bringToFront();
  const withdrawn = await poll(() => gitLabBotDigest(page), (value) => value !== null && value.bots.length === 0 && value.sources.every((source) => source.exists), 'Trust withdrawal removes the registry verdict while preserving every original comment');
  assertGitLabBotSources(withdrawn, before);item.afterWithdrawal = withdrawn;
  assert.equal(await page.$eval(`${identity} > summary`, (element) => element.textContent), 'Identify reviewer', 'Removing trust must restore explicit identification for the same native source');
  assert.deepEqual(captured.providerMutations, [], 'Bot verification must never post, resolve, approve or trigger a provider mutation');assert.deepEqual(captured.aiRequests, [], 'AI remains off');
  assert.ok(captured.metadata.every((metadata) => metadata.sha === GL_BOT_HEAD && metadata.diffHead === GL_BOT_HEAD), 'Native head changed during explicit trust verification');
  item.state = await tabState(page);assert.equal(item.state.repository?.path, 'whitebox-aero/whitebox');assert.equal(item.state.repository.provider, 'gitlab');
  return { featureParity: 'partial', verified: 'Actual installed explicit account trust and withdrawal, native-source clean score, historical resolved item/source preservation. CI warnings remain native and no authenticated provider write is exercised.' };
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
  const fixture = BB_PR27_DIFF_FIXTURE;
  const selector = 'tr[data-qa="pull-request-row"]:has(a[data-qa="pull-request-row-link"][href="/atlassian/bitbucket-upload-file/pull-requests/27"]) .geld-provider-list-counts';
  const requests = [];
  const request = (request) => {
    if (!bitbucketApi(request.url())) return;
    const url = new URL(request.url());
    const initiator = request.initiator?.();
    const frames = [];let stack = initiator?.stack;
    for (let level = 0; stack != null && level < 8; level += 1) { frames.push(...(stack.callFrames ?? []).map((frame) => frame.url));stack = stack.parent; }
    const reviewId = /\/pullrequests\/([1-9]\d*)(?:\/|$)/.exec(url.pathname)?.[1] ?? url.searchParams.get('from_pullrequest_id');
    requests.push({ url: safeUrl(url.href), method: request.method(), reviewId, countResource: /\/(?:diff|diffstat)(?:\/|$)/.test(url.pathname), extensionInitiator: frames.some((frame) => frame.startsWith(`chrome-extension://${extensionId}/`)) });
  };
  const passive = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr[data-qa="pull-request-row"]')];
    const reviewPaths = [...new Set(rows.flatMap((row) => [...row.querySelectorAll('a[data-qa="pull-request-row-link"]')].map((link) => new URL(link.href).pathname)))];
    const otherChips = rows.filter((row) => ![...row.querySelectorAll('a[data-qa="pull-request-row-link"]')].some((link) => new URL(link.href).pathname === '/atlassian/bitbucket-upload-file/pull-requests/27')).flatMap((row) => [...row.querySelectorAll('.geld-provider-list-counts')].filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0).map((node) => node.textContent.trim()));
    return { reviewPaths, nativeRowCount: rows.length, otherChips, searchValue: document.querySelector('#search-pull-requests-input')?.value ?? null, url: location.href, chips: document.querySelectorAll('.geld-provider-list-counts').length };
  });
  const assertPassive = async () => {
    const state = await passive();
    assert.ok(state.otherChips.length > 0, 'This native list must retain other cold rows to verify anonymous passive behavior');
    assert.ok(state.otherChips.every((text) => text === 'Hover to count changes'), `Unrequested anonymous list rows started counting: ${JSON.stringify(state.otherChips)}`);
    assert.deepEqual(requests.filter((item) => (item.extensionInitiator || item.countResource) && item.reviewId !== null && item.reviewId !== '27'), [], 'A cold anonymous row requested Geld counts without explicit intent');
    assert.deepEqual(requests.filter((item) => item.countResource && item.reviewId === null), [], 'An unattributed diff request prevents proving bounded PR27-only counts');
    return state;
  };
  page.on('request', request);
  try {
    const nativeList = await poll(passive, (value) => value.reviewPaths.includes('/atlassian/bitbucket-upload-file/pull-requests/27') && value.reviewPaths.length > 1 && value.chips === 0, 'Actual multi-row native Bitbucket list loads while list counts remain disabled');
    const nativeFilter = { status: 'not_used', reason: 'Native anonymous search updated its input and query URL but did not narrow the25rows in installed run41337759558. That provider behavior is not a Geld feature pass.', evidence: 'https://github.com/brandonmcconnell/geld/actions/runs/41337759558', observedSearchValue: nativeList.searchValue };
    await patchSettings({ showListStats: true });
    const targetLabel = () => page.evaluate((selector) => [...document.querySelectorAll(selector)].find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)?.textContent.replace(/\s+/g, ' ').trim() ?? null, selector);
    const coldLabel = await poll(targetLabel, (value) => value !== null && value !== '', 'Visible native-row chip is available for actual anonymous pointer intent');
    await poll(passive, (value) => value.otherChips.length > 0, 'Other actual native list rows expose passive anonymous chips');
    const passiveBeforeIntent = await assertPassive();
    const beforeIntentLabel = await targetLabel();
    if (focus === 'bitbucket-list') {
      assert.equal(coldLabel, 'Hover to count changes', 'Isolated list verification must start with a cold source');
      assert.equal(beforeIntentLabel, 'Hover to count changes', 'The isolated target must stay cold until real pointer intent');
    }
    const sourceDemand = { mode: beforeIntentLabel === 'Hover to count changes' ? 'cold_before_intent' : /\b0 tests?\b/.test(beforeIntentLabel ?? '') && beforeIntentLabel.includes('+46') && beforeIntentLabel.includes('−29') ? 'warm_cache_before_intent' : 'noncold_all_before_intent', initialLabel: coldLabel, beforeIntentLabel, coldRequired: focus === 'bitbucket-list' };
    if (sourceDemand.mode !== 'cold_before_intent') assert.equal(focus, 'all', 'Only the all slice may observe a prewarmed or pending target source');
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
    const expectedTotal = { label: 'Total', files: `${fixture.all.files} files`, additions: `+${fixture.all.additions}`, deletions: `−${fixture.all.deletions}` };
    for (const hover of [pointer, keyboard]) {
      assert.deepEqual(hover.rows.find((row) => row.label === 'Essential'), { ...expectedTotal, label: 'Essential' });
      assert.deepEqual(hover.rows.find((row) => row.label === 'Tests'), { label: 'Tests', files: '0 files', additions: '+0', deletions: '−0' });
      assert.deepEqual(hover.rows.find((row) => row.label === 'Total'), expectedTotal);
    }
    assert.equal(pointer.text, keyboard.text);
    const proof = fixture.selectedFile;
    const visible = { files: fixture.all.files - proof.files, additions: fixture.all.additions - proof.additions, deletions: fixture.all.deletions - proof.deletions };
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
    const passiveAfterCounts = await assertPassive();
    await patchSettings({ showListStats: false });
    const statsOff = await poll(read, (value) => value !== null && value.text === null && value.display !== 'none', 'Real list-stat disable removes the tested chip while retaining its native row');
    await poll(passive, (value) => value.chips === 0, 'Real list-stat disable removes all owned list chips');
    assert.deepEqual(statsOff.nativeIds, initial.nativeIds);assert.deepEqual(statsOff.nativeLinks, initial.nativeLinks);
    await patchSettings({ showListStats: true });
    const statsRestored = await poll(read, (value) => value !== null && value.text === initial.text, 'Real list-stat enable restores the exact PR27 counts');
    assert.deepEqual(statsRestored.nativeIds, initial.nativeIds);assert.deepEqual(statsRestored.nativeLinks, initial.nativeLinks);
    await poll(passive, (value) => value.otherChips.length > 0, 'Other native rows restore their cold chips');
    const passiveAfterRestore = await assertPassive();
    return { selection: 'Actual native multi-row list is retained without search dependency or DOM hiding. Only PR27 receives explicit count intent; other anonymous chips remain cold.', nativeList, nativeFilter, coldLabel, sourceDemand, passiveBeforeIntent, initial, pointer, keyboard, priorInstalledFixture: fixture, visible, filtered, filteredHover, restored, passiveAfterCounts, statsOff, statsRestored, passiveAfterRestore,
      requestEvidence: { requests, extension: requests.filter((item) => item.extensionInitiator), nativeOrUnattributed: requests.filter((item) => !item.extensionInitiator), basis: 'Actual browser request initiator stacks identify extension frames when supplied; diff/diffstat immutable comparisons additionally retain from_pullrequest_id. Known native deployment400 responses are not count failures.' },
      nativeFingerprint: createHash('sha256').update(JSON.stringify({ ids: initial.nativeIds, links: initial.nativeLinks })).digest('hex') };
  } finally { page.off('request', request); }
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
      avatar: { native: sample(nativeAvatar), owned: sample(byline?.querySelector(':scope > [data-geld-author-avatar-slot] > img[data-geld-author-avatar]')) },
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
  await runCase('gitlab-bot-digest', GL_BOT, verifyGitLabBot);
  await runCase('cross-provider-settings', GL_MIXED, verifyCrossProviderSettings);
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

  await runCase('gitlab-binary-counts', GL_BINARY, async (page, item) => gitLabBinaryCounts(page, item));

  await runCase('gitlab-commit-link-counts', GL_COMMITS, async (page, item) => {
    const selector = `#commits #commit-db314bf4 a.commit-row-message[href="/gitlab-org/gitlab/-/merge_requests/266334/diffs?commit_id=${GL_COMMIT_SHA}"]`;
    item.nativeLink = await poll(() => page.evaluate((selector) => {
      const link = document.querySelector(selector);
      if (link === null || link.closest('[data-geld-ui]') !== null || link.getBoundingClientRect().height === 0) return null;
      link.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      return { href: link.href, text: link.textContent.trim(), rowId: link.closest('li.commit')?.id, classes: link.className, owned: link.closest('[data-geld-ui]') !== null, tab: document.querySelector('[data-testid="commits-tab"] > a')?.getAttribute('aria-current') };
    }, selector), (value) => value !== null, 'Genuine visible native Commits-tab link for the immutable selected commit');
    assert.equal(item.nativeLink.rowId, 'commit-db314bf4');
    assert.equal(item.nativeLink.tab, 'page');
    assert.equal(item.nativeLink.owned, false);
    item.pointer = await installedHover(page, selector, 'pointer', 'gitlab-commit-link-pointer');
    item.keyboard = await installedHover(page, selector, 'keyboard', 'gitlab-commit-link-keyboard');
    for (const value of [item.pointer, item.keyboard]) assertGitLabCommitBreakdown(value);
    assert.equal(item.pointer.text, item.keyboard.text);
    item.nativeReferenceCards = { status: 'not_evaluated', reason: 'This real native commit-row title targets the provider selected-commit diff. Native GFM/reference cards are separate discovery, not asserted from the Geld tooltip.' };
    item.featureParity = 'partial';
    return { status: 'passed', verified: 'A genuine native MR Commits-tab link shows its own immutable two-file/+12−0 breakdown through trusted pointer and real Tab interactions, with viewport/accessible ownership and Escape assertions. It does not reuse the MR three-file/+36 totals.' };
  });
  await runCase('gitlab-native-commit-reference', GL_OVERVIEW, async (page, item) => {
    const original = await options.evaluate(async (key) => (await chrome.storage.sync.get(key))[key], SETTINGS_KEY);
    const selector = `#note_4135599303 a.gfm-commit[data-reference-type="commit"][href="${GL_COMMIT}"]`;
    try {
      await patchSettings({ compactTimeline: 'off' });
      item.nativeLink = await poll(() => page.evaluate((selector) => {
        const link = document.querySelector(selector);
        if (link === null || link.closest('[data-geld-ui]') !== null || link.getBoundingClientRect().height === 0) return null;
        link.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        return { href: link.href, text: link.textContent.trim(), noteId: link.closest('[data-testid="noteable-note-container"]')?.id, referenceType: link.getAttribute('data-reference-type'), commit: link.getAttribute('data-commit'), owned: link.closest('[data-geld-ui]') !== null };
      }, selector), (value) => value !== null, 'Actual original note commit reference after the real compactTimeline off setting');
      assert.equal(item.nativeLink.commit, GL_COMMIT_SHA);
      assert.equal(item.nativeLink.owned, false);
      await page.hover(selector);
      await pause(1200);
      item.nativeReferenceCards = await page.evaluate((selector) => {
        const link = document.querySelector(selector);
        const describedBy = (link?.getAttribute('aria-describedby') ?? '').split(/\s+/);
        const cards = [...document.querySelectorAll('.gl-popover, [data-testid="commit-popover"]')].filter((node) => node.closest('[data-geld-ui]') === null && node.getBoundingClientRect().height > 0).map((node) => ({
          id: node.id, role: node.getAttribute('role'), described: describedBy.includes(node.id), text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 1500),
          links: [...node.querySelectorAll('a[href]')].map((anchor) => ({ href: anchor.href, testid: anchor.getAttribute('data-testid') })), nativeCounts: [...node.querySelectorAll('[data-testid="diff-stats-additions"], [data-testid="diff-stats-deletions"]')].map((count) => ({ testid: count.getAttribute('data-testid'), text: count.textContent })),
        }));
        return { status: cards.length === 0 ? 'not_observed' : 'discovery', cards, assertion: 'Native cards are recorded independently; their presence is not a Geld count-hover pass.' };
      }, selector);
      item.nativeReferenceArtifacts = await capture(page, 'gitlab-native-commit-reference-observation');
      const openCard = async ({ reopen = true } = {}) => {
        let movedAway;
        if (reopen) {
          await page.mouse.move(1, 1);
          movedAway = await poll(() => page.evaluate((selector, commitUrl) => {
            const link = document.querySelector(selector);
            const cards = [...document.querySelectorAll('.gl-popover[role="tooltip"]')].filter((node) => node.querySelector('[data-testid="commit-title-link"]')?.href === commitUrl && node.querySelector('[data-testid="commit-sha-link"]')?.href === commitUrl);
            return { href: link?.href, commit: link?.getAttribute('data-commit'), hovered: link?.matches(':hover'), describedBy: link?.getAttribute('aria-describedby'),
              cards: cards.map((node) => ({ id: node.id, display: getComputedStyle(node).display, height: node.getBoundingClientRect().height })) };
          }, selector, GL_COMMIT), (value) => value.hovered === false && value.cards.every((card) => card.display === 'none' || card.height === 0), 'Genuine pointer exit closes the native commit card before reentry', 8000);
          assert.equal(movedAway.href, GL_COMMIT);
          assert.equal(movedAway.commit, GL_COMMIT_SHA);
          await page.$eval(selector, (link) => link.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }));
          await page.hover(selector);
        }
        const opened = await poll(() => page.evaluate((selector, commitUrl) => {
          const link = document.querySelector(selector);
          const owners = (link?.getAttribute('aria-describedby') ?? '').split(/\s+/);
          const card = [...document.querySelectorAll('.gl-popover[role="tooltip"]')].find((node) => owners.includes(node.id) && node.getBoundingClientRect().height > 0 && node.querySelector('[data-testid="commit-title-link"]')?.href === commitUrl && node.querySelector('[data-testid="commit-sha-link"]')?.href === commitUrl);
          const chip = card?.querySelector('.geld-provider-list-counts');
          if (card === undefined || chip === null || chip === undefined || chip.getBoundingClientRect().height === 0) return null;
          return { id: card.id, role: card.getAttribute('role'), describedBy: link.getAttribute('aria-describedby'), title: card.querySelector('[data-testid="commit-title-link"]').textContent.trim(), author: card.querySelector('[data-testid="commit-author-name"]')?.textContent.trim(),
            links: [...card.querySelectorAll('[data-testid="commit-title-link"], [data-testid="commit-sha-link"]')].map((anchor) => ({ href: anchor.href, testid: anchor.getAttribute('data-testid') })),
            chip: { text: chip.textContent.replace(/\s+/g, ' ').trim(), tabindex: chip.getAttribute('tabindex'), title: chip.getAttribute('title') } };
        }, selector, GL_COMMIT), (value) => value !== null && /\b1 test\b/.test(value.chip.text) && value.chip.text.includes('+2') && value.chip.text.includes('−0'), 'Actual ARIA-associated native commit card contains its exact source-specific Geld chip', 12_000);
        return { ...opened, reentry: { mechanism: reopen ? 'Real pointer move away, observed native close, source-preserving scroll and genuine original-link hover' : 'Existing visible native card, without resetting its lifetime', ...(movedAway === undefined ? {} : { movedAway }) } };
      };
      item.nativeCardPointer = await openCard();
      const pointerChip = `[id=${JSON.stringify(item.nativeCardPointer.id)}] .geld-provider-list-counts`;
      item.pointer = await installedHover(page, pointerChip, 'pointer', 'gitlab-native-commit-reference-pointer', undefined, { preserveNativeCard: true });
      let previousEscapeState;
      item.pointerVisit = { url: page.url(), source: item.nativeLink, card: item.nativeCardPointer, escapeDismissed: item.pointer.escapeDismissed,
        afterEscape: await poll(() => page.evaluate((selector, id) => {
          const link = document.querySelector(selector);
          const card = document.getElementById(id);
          return { href: link?.href, commit: link?.getAttribute('data-commit'), mounted: link?.getAttribute('data-popover-mounted'), describedBy: link?.getAttribute('aria-describedby'),
            card: card === null ? null : { id: card.id, display: getComputedStyle(card).display, visible: card.getBoundingClientRect().height > 0 && getComputedStyle(card).visibility !== 'hidden' } };
        }, selector, item.nativeCardPointer.id), (value) => {
          const state = JSON.stringify(value);
          const settled = state === previousEscapeState;
          previousEscapeState = state;
          return settled;
        }, 'Native card lifetime settles after the trusted Escape before choosing a keyboard visit', 6000) };
      assert.equal(item.pointerVisit.afterEscape.href, GL_COMMIT);
      assert.equal(item.pointerVisit.afterEscape.commit, GL_COMMIT_SHA);
      if (item.pointerVisit.afterEscape.card?.visible === true) {
        item.keyboardVisit = { mode: 'same visible native card', url: page.url(), source: item.nativeLink };
        item.nativeCardKeyboard = await openCard({ reopen: false });
      } else {
        const response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
        item.keyboardVisit = { mode: 'separate native visit after pointer Escape closed the provider card', navigation: { status: response?.status() ?? null, finalUrl: safeUrl(page.url()) } };
        assert.equal(response?.status(), 200, 'Independent keyboard visit must load the same public MR');
        assert.equal(page.url(), GL_OVERVIEW, 'Independent keyboard visit changed the native source fixture');
        item.keyboardVisit.source = await poll(() => page.evaluate((selector) => {
          const link = document.querySelector(selector);
          if (link === null || link.closest('[data-geld-ui]') !== null || link.getBoundingClientRect().height === 0 || link.getAttribute('data-popover-listener-added') !== 'true') return null;
          return { href: link.href, text: link.textContent.trim(), noteId: link.closest('[data-testid="noteable-note-container"]')?.id, referenceType: link.getAttribute('data-reference-type'), commit: link.getAttribute('data-commit'), owned: link.closest('[data-geld-ui]') !== null };
        }, selector), (value) => value !== null, 'Same original native commit reference on the independent keyboard visit');
        assert.deepEqual(item.keyboardVisit.source, item.nativeLink, 'Independent keyboard visit changed original native source identity');
        item.nativeCardKeyboard = await openCard();
      }
      assert.deepEqual(item.nativeCardKeyboard.links, item.nativeCardPointer.links, 'Count interaction changed native commit card source links');
      assert.equal(item.nativeCardKeyboard.title, item.nativeCardPointer.title);
      assert.equal(item.nativeCardKeyboard.author, item.nativeCardPointer.author);
      assert.equal(item.nativeCardKeyboard.chip.tabindex, '0', 'Observed native-card count chip must remain keyboard accessible');
      const keyboardChip = `[id=${JSON.stringify(item.nativeCardKeyboard.id)}] .geld-provider-list-counts`;
      item.keyboard = await installedHover(page, keyboardChip, 'keyboard', 'gitlab-native-commit-reference-keyboard', undefined, { preserveNativeCard: true });
      for (const value of [item.pointer, item.keyboard]) assertGitLabCommitBreakdown(value);
      assert.equal(item.pointer.text, item.keyboard.text);
      item.featureParity = 'partial';
      return { status: 'passed', verified: 'The genuine native commit card chip supports exact pointer and real Tab breakdowns with viewport/accessible ownership and Escape checks. If native Escape closes its mounted card, the keyboard assertion uses a separately reported reload of the same source fixture. Original source identity, native card title/author and canonical links agree across visits. No competing tooltip is required on the original link.' };
    } finally { await patchSettings({ compactTimeline: original.compactTimeline ?? 'compact' }); }
  });
  await runCase('gitlab-commit-counts', GL_COMMIT, async (page, item) => {
    item.commitCounts = await gitLabCommitCounts(page);
    item.featureParity = 'partial';
    return { status: 'passed', verified: 'The actual immutable standalone GitLab commit filters2/+12−0 to1/+2−0, hides its real test file, and restores native counts/visibility through actual category and master settings with source IDs/links retained.' };
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
