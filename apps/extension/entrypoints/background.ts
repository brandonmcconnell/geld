import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { defineBackground } from 'wxt/utils/define-background';
import { parseUnifiedDiff } from '@geld/core';
import { completeChat, evaluateJev, listModels, TYPESAFE_API } from '@geld/review';
import { handleAccountMessage, startAccountSync } from '../src/lib/account-service';
import { actionIconPaths } from '../src/lib/action-icon';
import { checkCatalog, startCatalogUpdates } from '../src/lib/catalog';
import { syncEnterpriseHosts } from '../src/lib/enterprise';
import { hasGatewayPermission } from '../src/lib/ai-gateway';
import { settingsItem } from '../src/lib/storage';
import { diagnosticSubject, recordDiagnostic } from '../src/lib/diagnostics';
import type { FetchDiffResponse, FetchDiffTextResponse, FetchFileResponse, TabState, ToggleHiddenMessage } from '../src/lib/messages';
import type { EnsureContentResponse } from '../src/lib/messages';
import {
  isAccountActionMessage,
  isAiCompleteRequest,
  isAiEvaluateRequest,
  isAiModelsRequest,
  isCatalogCheckMessage,
  isColorSchemeMessage,
  isEnsureContentMessage,
  isFetchDiffRequest,
  isFetchDiffTextRequest,
  isFetchFileRequest,
  isClearDiffCacheMessage,
  isTabStateMessage,
} from '../src/lib/messages';
import type { DiffPriority } from '../src/lib/messages';
import { ensureContentScript, hostOf, tabsOnHosts } from '../src/lib/inject';
import { grantedHosts } from '../src/lib/enterprise';
import { looksLikeHtml } from '../src/lib/http';

/** Refuse to parse diffs larger than this; GitHub's UI is unusable there anyway. */
const MAX_DIFF_BYTES = 20 * 1024 * 1024;
/** Repository config files (`.github/geld.yml`, `.gitattributes`) are read up to this much. */
const MAX_FILE_BYTES = 256 * 1024;

const BUILT_IN_HOSTS = ['github.com', 'patch-diff.githubusercontent.com'];

/** github.com, its diff host, and any Enterprise servers the user configured. */
async function allowedHosts(): Promise<Set<string>> {
  const settings = await settingsItem.getValue();
  return new Set([...BUILT_IN_HOSTS, ...settings.enterpriseHosts]);
}

/** Parsed diffs are reused across tabs/pages for a while (PR lists re-request them often). */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { readonly response: FetchDiffResponse; readonly at: number }>();

/*
 * GitHub's `.diff` endpoint rate-limits by burst: measured, it serves some
 * 45–48 requests in quick succession (less when the address was recently
 * blocked) and then answers 429 to everything for a minute or more, with no
 * Retry-After. Two list pages are enough to trip it,
 * after which every row and every pull request page opened stays blank until
 * the block lifts — and a page of rows retrying together trips it again. So
 * requests are paced under that threshold (they wait for a slot rather than
 * fail), and a 429 backs off for longer each time it repeats. The throttle
 * state is persisted: this worker is stopped after ~30s idle, and forgetting
 * a block mid-way would only get it extended.
 */
const DIFF_BUDGET = 30;
const DIFF_WINDOW_MS = 60 * 1000;
/*
 * Slots only the page's own subject may take (`priority: 'page'`): the header
 * of the pull request or commit being read, a commit the reader hovers. A
 * page of list rows and the refreshes of stale rows behind it stop at the
 * rest, so opening a pull request after browsing a list never waits out the
 * window behind rows the reader has scrolled past. Measured: a list page is
 * 25 rows; the reserve is what a couple of pull requests opened in a row need.
 */
const PAGE_RESERVE = 8;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const RATE_LIMIT_COOLDOWN_MAX_MS = 15 * 60 * 1000;
/*
 * The diff host also answers 503 (occasionally 502/504) in waves — measured
 * from the worker: seven of eight concurrent requests one minute, ten of ten
 * fine the next, well under the budget above. That is GitHub being busy
 * rather than blocking us, so the rows get a short pause, not a strike. A
 * wave is one pause however many answers arrive during it (four concurrent
 * 503s used to double it four times in 100 ms, into a minute), the pause
 * grows only when the next wave follows the pause, and any success ends it.
 * The page's own subject is not held by it (see `fetchDiff`).
 */
const BUSY_COOLDOWN_MS = 8 * 1000;
const BUSY_COOLDOWN_MAX_MS = 60 * 1000;

interface Throttle {
  /** Unix ms of recent request starts, oldest first. */
  readonly sent: number[];
  readonly cooldownUntil: number;
  /** Consecutive rate-limit answers; each doubles the next cooldown. */
  readonly strikes: number;
  /** Consecutive 5xx answers; each doubles the next busy pause (absent in older stored state). */
  readonly busy?: number;
  /** Whether the current cooldown is a block (`rate-limited`) or a pause (`busy`). */
  readonly cooldownReason?: 'rate-limited' | 'busy';
}

const throttleItem = storage.defineItem<Throttle>('local:diffThrottle', { fallback: { sent: [], cooldownUntil: 0, strikes: 0 } });
let throttle: Throttle | null = null;
let throttleLoading: Promise<Throttle> | null = null;

async function loadThrottle(): Promise<Throttle> {
  if (throttle !== null) return throttle;
  throttleLoading ??= throttleItem.getValue().then((value) => {
    throttle = {
      sent: Array.isArray(value.sent) ? value.sent.filter((t): t is number => typeof t === 'number') : [],
      cooldownUntil: value.cooldownUntil,
      strikes: value.strikes,
      ...(typeof value.busy === 'number' ? { busy: value.busy } : {}),
      ...(value.cooldownReason === 'busy' || value.cooldownReason === 'rate-limited' ? { cooldownReason: value.cooldownReason } : {}),
    };
    return throttle;
  });
  return throttleLoading;
}

/** Storage writes are gathered: a list page claims a dozen slots within a second, and the worker reads from memory anyway. */
const THROTTLE_WRITE_DELAY_MS = 250;
let throttleWrite: ReturnType<typeof setTimeout> | null = null;

function saveThrottle(next: Throttle): void {
  throttle = next;
  // The stored copy only matters to the next worker, which starts well after this timer fires (the worker is kept
  // for ~30 s of idleness), so the latest state is written once per burst rather than once per claim.
  throttleWrite ??= setTimeout(() => {
    throttleWrite = null;
    if (throttle !== null) void throttleItem.setValue(throttle).catch(() => undefined);
  }, THROTTLE_WRITE_DELAY_MS);
}

/**
 * Claim a slot in the sliding window, or say how long until one frees up.
 * The wait happens in the page, not here: a worker sleeping in a timer is
 * idle to Chrome, which stops it after ~30 s and closes every message port
 * still waiting on it — the rows then failed with "message port closed" and,
 * after a few such failures, gave up until the page was reloaded.
 */
async function takeTurn(priority: DiffPriority): Promise<{ readonly wait: number; readonly stamp: number }> {
  const current = await loadThrottle();
  const now = Date.now();
  const sent = current.sent.filter((t) => now - t < DIFF_WINDOW_MS);
  const allowed = priority === 'page' ? DIFF_BUDGET : DIFF_BUDGET - PAGE_RESERVE;
  if (sent.length < allowed) {
    saveThrottle({ ...current, sent: [...sent, now] });
    return { wait: 0, stamp: now };
  }
  // The slot frees when the request that would bring the count under the line leaves the window.
  const blocking = sent[sent.length - allowed] ?? now;
  return { wait: Math.max(50, blocking + DIFF_WINDOW_MS - now + 50), stamp: 0 };
}

/**
 * Give a slot back: the answer never came from the diff host (github.com
 * served its sign-in or SSO page, an error page), so it spent nothing of
 * that host's tolerance. Without this a lapsed SSO session cost a page of
 * rows the whole budget, and after signing in again every row waited out
 * the window ("queued 32s").
 */
async function refundTurn(stamp: number): Promise<void> {
  if (stamp === 0) return;
  const current = await loadThrottle();
  const index = current.sent.indexOf(stamp);
  if (index === -1) return;
  saveThrottle({ ...current, sent: [...current.sent.slice(0, index), ...current.sent.slice(index + 1)] });
}

const DIFF_HOST = 'patch-diff.githubusercontent.com';

/**
 * GitHub's own pages served in a diff's place: the sign-in wall, an
 * organisation's SSO prompt ("Sign in to Mintlify"), the two-factor or
 * device-verification interstitials. Recognised by their titles so they
 * read as "signed out" (the fix is signing in) rather than "not a diff".
 */
function looksLikeSignInPage(html: string): boolean {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  return /sign in|single sign-on|\bSSO\b|two-factor|verify your|confirm access|login/i.test(title) || /<form[^>]+action="\/(?:session|sessions|login|orgs\/[^"/]+\/sso)/i.test(html);
}

/** A 429/403 arrived: block for longer each time it repeats, or for what GitHub asks. */
async function recordRateLimit(retryAfterHeader: string | null, answer: { readonly status: number; readonly host: string }): Promise<number> {
  const current = await loadThrottle();
  const strikes = current.strikes + 1;
  const asked = Number.parseInt(retryAfterHeader ?? '', 10);
  const cooldown = Number.isFinite(asked) && asked > 0 ? asked * 1000 : Math.min(RATE_LIMIT_COOLDOWN_MS * 2 ** (strikes - 1), RATE_LIMIT_COOLDOWN_MAX_MS);
  saveThrottle({ ...current, strikes, cooldownUntil: Date.now() + cooldown, cooldownReason: 'rate-limited' });
  recordDiagnostic({ kind: 'rate-limit', cooldownMs: cooldown, strikes, status: answer.status, host: answer.host });
  return cooldown;
}

/** A 5xx arrived: pause briefly, longer when the waves follow one another, or for what GitHub asks. */
async function recordBusy(retryAfterHeader: string | null, answer: { readonly status: number; readonly host: string }): Promise<number> {
  const current = await loadThrottle();
  const now = Date.now();
  // Another answer from the wave a pause is already running for: the same pause, not a longer one.
  if (current.cooldownUntil > now) return current.cooldownUntil - now;
  const busy = (current.busy ?? 0) + 1;
  const asked = Number.parseInt(retryAfterHeader ?? '', 10);
  const cooldown = Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1000, BUSY_COOLDOWN_MAX_MS) : Math.min(BUSY_COOLDOWN_MS * 2 ** (busy - 1), BUSY_COOLDOWN_MAX_MS);
  saveThrottle({ ...current, busy, cooldownUntil: now + cooldown, cooldownReason: 'busy' });
  recordDiagnostic({ kind: 'busy', cooldownMs: cooldown, strikes: busy, status: answer.status, host: answer.host });
  return cooldown;
}

/** A diff arrived: the strikes are over, and a busy pause with it (GitHub is answering again). A rate-limit block runs its course. */
async function recordSuccess(): Promise<void> {
  const current = await loadThrottle();
  const pausing = current.cooldownReason === 'busy' && current.cooldownUntil > Date.now();
  if (current.strikes !== 0 || (current.busy ?? 0) !== 0 || pausing) saveThrottle({ ...current, strikes: 0, busy: 0, ...(pausing ? { cooldownUntil: 0 } : {}) });
}

function readCache(url: string): FetchDiffResponse | null {
  const hit = cache.get(url);
  if (hit === undefined) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit.response;
}

function writeCache(url: string, response: FetchDiffResponse): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { response, at: Date.now() });
}

/*
 * The raw text of the last few diffs fetched, for the Review tab (it needs
 * hunks and lines, which the parsed response drops). A handful of entries
 * under a byte cap: a text request for the page's own diff usually follows
 * the header's parsed request within seconds, so it is served from here
 * without a second trip to the diff host.
 */
const TEXT_CACHE_MAX_ENTRIES = 6;
const TEXT_CACHE_MAX_BYTES = 24 * 1024 * 1024;
const textCache = new Map<string, { readonly text: string; readonly at: number }>();

function writeTextCache(url: string, text: string): void {
  textCache.delete(url);
  textCache.set(url, { text, at: Date.now() });
  let bytes = 0;
  for (const entry of textCache.values()) bytes += entry.text.length;
  while (textCache.size > TEXT_CACHE_MAX_ENTRIES || (bytes > TEXT_CACHE_MAX_BYTES && textCache.size > 1)) {
    const oldest = textCache.keys().next().value;
    if (oldest === undefined) break;
    bytes -= textCache.get(oldest)?.text.length ?? 0;
    textCache.delete(oldest);
  }
}

function readTextCache(url: string): string | null {
  const hit = textCache.get(url);
  if (hit === undefined) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    textCache.delete(url);
    return null;
  }
  return hit.text;
}

/** The page's own diff as text: the text cache first, else one `page` fetch (which fills it). */
async function fetchDiffText(url: string): Promise<FetchDiffTextResponse> {
  const cached = readTextCache(url);
  if (cached !== null) return { ok: true, text: cached };
  // A parsed answer in memory does not help here: it has no text, and the entry would stop the fetch below.
  cache.delete(url);
  const result = await fetchDiff(url, 'page');
  if (!result.ok) return { ok: false, reason: result.reason, ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }) };
  const text = readTextCache(url);
  return text === null ? { ok: false, reason: 'no-text' } : { ok: true, text };
}

/**
 * `https://github.com/<owner>/<repo>/pull/<n>.diff` redirects to
 * `patch-diff.githubusercontent.com`, which does not send CORS headers. Content
 * scripts therefore cannot fetch it, but the background script can thanks to
 * the extension's host permissions. Cookies are included so private
 * repositories work for signed-in users.
 */
async function fetchDiff(url: string, priority: DiffPriority): Promise<FetchDiffResponse> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'https:' || !(await allowedHosts()).has(parsed.hostname) || !parsed.pathname.endsWith('.diff')) {
    return { ok: false, reason: 'disallowed-url' };
  }

  const subject = diagnosticSubject(parsed.toString()) ?? undefined;
  const cached = readCache(parsed.toString());
  if (cached !== null) {
    recordDiagnostic({ kind: 'fetch', subject, outcome: cached.ok ? 'memory-hit' : `memory-hit:${cached.reason}` });
    return cached;
  }
  // A diff this worker already found too large stays too large (a pull request's `.diff` URL serves its current
  // head, so it is asked again only on a new push, and a page revisited within the session asks again anyway):
  // answer from memory rather than download the limit again on every pass. Session storage outlives the worker.
  if (await knownTooLarge(parsed.toString())) {
    recordDiagnostic({ kind: 'fetch', subject, outcome: 'memory-hit:too-large' });
    return { ok: false, reason: 'too-large' };
  }
  const state = await loadThrottle();
  // A rate-limit block holds for everyone. A busy pause (GitHub answered 5xx to a burst of rows) holds the rows;
  // the page's own subject is one request and goes through as the probe, and a 5xx to it only extends the pause.
  if (Date.now() < state.cooldownUntil && !(priority === 'page' && state.cooldownReason === 'busy')) {
    const reason = state.cooldownReason ?? 'rate-limited';
    recordDiagnostic({ kind: 'fetch', subject, outcome: reason, cooldownMs: state.cooldownUntil - Date.now(), strikes: reason === 'busy' ? (state.busy ?? 0) : state.strikes });
    return { ok: false, reason, retryAfterMs: state.cooldownUntil - Date.now() };
  }
  const turn = await takeTurn(priority);
  if (turn.wait > 0) {
    recordDiagnostic({ kind: 'fetch', subject, outcome: 'queued', ms: turn.wait, budgetUsed: (throttle?.sent ?? []).length });
    return { ok: false, reason: 'queued', retryAfterMs: turn.wait };
  }
  const started = Date.now();
  /** Whether the diff host answered at all; an answer from elsewhere gives its slot back. */
  let servedByDiffHost = false;

  let result: FetchDiffResponse;
  try {
    const response = await fetch(parsed.toString(), {
      credentials: 'include',
      // Only a diff will do: a number that is an issue redirects to an HTML
      // page, which this turns into a 406 instead of an "empty diff".
      headers: { Accept: 'text/plain' },
      redirect: 'follow',
    });
    const answer = { status: response.status, host: new URL(response.url).hostname };
    servedByDiffHost = answer.host === DIFF_HOST || !parsed.hostname.endsWith('github.com');
    if (response.status === 429 || response.status === 403) {
      const retryAfterMs = await recordRateLimit(response.headers.get('retry-after'), answer);
      result = { ok: false, reason: 'rate-limited', retryAfterMs };
    } else if (response.status === 502 || response.status === 503 || response.status === 504) {
      const retryAfterMs = await recordBusy(response.headers.get('retry-after'), answer);
      result = { ok: false, reason: 'busy', retryAfterMs };
    } else if (response.redirected && /^\/(login|sessions?|sso|orgs\/[^/]+\/sso)\b/.test(new URL(response.url).pathname)) {
      // A private repository while signed out (or with an SSO session that
      // lapsed): GitHub answers 200 with its login page. Parsed as a diff
      // that is "no files", which used to be cached and shown as 0 +0 −0.
      result = { ok: false, reason: 'signed-out' };
    } else if (!response.ok) {
      result = { ok: false, reason: `http-${response.status}` };
    } else {
      const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
      if (declared > MAX_DIFF_BYTES) {
        result = { ok: false, reason: 'too-large' };
      } else {
        const text = await readWithLimit(response, MAX_DIFF_BYTES);
        if (looksLikeHtml(response.headers.get('content-type'), text)) {
          // Not a diff at all: GitHub's sign-in or SSO page (signing in fixes it), else an interstitial or an
          // error page served as 200.
          result = { ok: false, reason: looksLikeSignInPage(text) ? 'signed-out' : 'not-a-diff' };
        } else {
          result = { ok: true, files: parseUnifiedDiff(text) };
          writeTextCache(parsed.toString(), text);
          await recordSuccess();
        }
      }
    }
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : 'fetch-failed' };
  }
  // A page github.com served in the diff's place (signed out, an SSO prompt, an interstitial) never reached the
  // diff host: the slot goes back, so signing in and reloading gets fresh answers at once.
  if (!result.ok && !servedByDiffHost && (result.reason === 'signed-out' || result.reason === 'not-a-diff')) await refundTurn(turn.stamp);
  recordDiagnostic({
    kind: 'fetch',
    subject,
    outcome: result.ok ? 'ok' : result.reason,
    ms: Date.now() - started,
    budgetUsed: (throttle?.sent ?? []).length,
    ...(result.ok ? { files: result.files.length } : {}),
  });
  // Only successful and definitive failures are cached; transient network
  // errors retry, and so do sign-in problems — signing in fixes them. A 404
  // is what a private repository answers to a signed-out browser (its diff
  // as much as its pages), so it is not held either: signed in, the next
  // request must succeed at once.
  if (result.ok || result.reason === 'too-large' || (result.reason.startsWith('http-4') && result.reason !== 'http-404')) {
    writeCache(parsed.toString(), result);
  }
  if (!result.ok && result.reason === 'too-large') await rememberTooLarge(parsed.toString());
  return result;
}

/** Diff URLs this session found too large, with when: a pull request's `.diff` is its head's, asked again after a push. */
const tooLargeItem = storage.defineItem<Record<string, number>>('session:diffTooLarge', { fallback: {} });
const TOO_LARGE_TTL_MS = 60 * 60 * 1000;

async function knownTooLarge(url: string): Promise<boolean> {
  const known = await tooLargeItem.getValue();
  const at = known[url];
  return at !== undefined && Date.now() - at < TOO_LARGE_TTL_MS;
}

async function rememberTooLarge(url: string): Promise<void> {
  const known = await tooLargeItem.getValue();
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(known).filter(([, at]) => now - at < TOO_LARGE_TTL_MS));
  await tooLargeItem.setValue({ ...kept, [url]: now });
}

/** Public raw files on github.com: `raw.githubusercontent.com/owner/repo/HEAD/path`. */
const PUBLIC_RAW_HOST = 'raw.githubusercontent.com';
const PUBLIC_RAW_PATH = /^\/[^/]+\/[^/]+\/HEAD\/.+/;
/** An Enterprise server serves raw files itself: `https://host/owner/repo/raw/HEAD/path`. */
const ENTERPRISE_RAW_PATH = /^\/[^/]+\/[^/]+\/raw\/HEAD\/.+/;

/**
 * One repository file for the content script's repo-config lookup (an
 * organisation's `.github` repository, which GitHub requires to be public).
 * Done here so the common outcome — no such file — is a 404 in this worker's
 * console, not in every pull request's.
 *
 * On github.com the file is read from raw.githubusercontent.com *without*
 * credentials: this worker has no host permission there, so the browser
 * applies CORS, and the host's `Access-Control-Allow-Origin: *` is only
 * accepted for an uncredentialed request (that is also why github.com's own
 * `/raw/` redirect cannot be followed from here). Enterprise hosts are
 * granted, serve raw files on the same origin, and get the session cookie.
 */
async function fetchFile(url: string): Promise<FetchFileResponse> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  const publicRaw = parsed.hostname === PUBLIC_RAW_HOST && PUBLIC_RAW_PATH.test(parsed.pathname);
  const enterpriseRaw =
    parsed.hostname !== 'github.com' && (await allowedHosts()).has(parsed.hostname) && ENTERPRISE_RAW_PATH.test(parsed.pathname);
  if (parsed.protocol !== 'https:' || (!publicRaw && !enterpriseRaw)) return { ok: false, reason: 'disallowed-url' };
  try {
    const response = await fetch(parsed.toString(), { credentials: publicRaw ? 'omit' : 'include', cache: 'no-store', redirect: 'follow' });
    if (response.status === 404) return { ok: true, text: null };
    if (!response.ok) return { ok: false, reason: `http-${response.status}` };
    const body = await response.text();
    // A 200 that is really a GitHub page (SSO interstitial, sign-in wall,
    // unavailable repository) is not a config file.
    if (looksLikeHtml(response.headers.get('content-type'), body)) return { ok: false, reason: 'html' };
    return { ok: true, text: body.length > MAX_FILE_BYTES ? body.slice(0, MAX_FILE_BYTES) : body };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'fetch-failed' };
  }
}

async function readWithLimit(response: Response, limit: number): Promise<string> {
  if (response.body === null) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new Error('too-large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Toolbar icon theming. Chrome/Edge MV3 service workers have no `matchMedia`,
 * so an offscreen document (reason MATCH_MEDIA) watches the colour scheme and
 * reports back; we then swap between the black and white marks. Firefox uses
 * `theme_icons` from the manifest and Safari tints template icons itself, so
 * neither needs this.
 */
const USES_OFFSCREEN_THEME_PROBE = import.meta.env.MANIFEST_VERSION === 3 && (import.meta.env.CHROME || import.meta.env.EDGE);

let offscreenCreation: Promise<void> | null = null;

async function ensureThemeProbe(): Promise<void> {
  if (!USES_OFFSCREEN_THEME_PROBE) return;
  if (offscreenCreation !== null) return offscreenCreation;
  offscreenCreation = (async () => {
    try {
      const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (contexts.length > 0) return;
      await browser.offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: ['MATCH_MEDIA'],
        justification: 'Detect the light/dark colour scheme to pick a legible toolbar icon.',
      });
    } catch {
      // Already exists or unsupported; the manifest's default icon stays in place.
    } finally {
      offscreenCreation = null;
    }
  })();
  return offscreenCreation;
}

function applyToolbarIcon(dark: boolean): void {
  void browser.action.setIcon({ path: actionIconPaths(dark ? 'white' : 'black') }).catch(() => undefined);
}

/** The subset of the action API we use, shared by MV3 `action` and MV2 `browserAction`. */
interface BadgeApi {
  setBadgeText(details: { tabId: number; text: string }): Promise<void> | void;
  setBadgeBackgroundColor(details: { tabId: number; color: string }): Promise<void> | void;
  setBadgeTextColor?(details: { tabId: number; color: string }): Promise<void> | void;
}

function badgeApi(): BadgeApi | undefined {
  return import.meta.env.MANIFEST_VERSION === 3 ? browser.action : browser.browserAction;
}

function swallow(result: Promise<void> | void): void {
  if (result instanceof Promise) result.catch(() => undefined);
}

/** Show the hidden-file count for a tab on the toolbar icon. */
function updateBadge(tabId: number, state: TabState): void {
  const api = badgeApi();
  if (api === undefined) return;
  const text = state.hiddenCount > 0 ? String(state.hiddenCount) : '';
  swallow(api.setBadgeText({ tabId, text }));
  if (text !== '') {
    swallow(api.setBadgeBackgroundColor({ tabId, color: '#59636e' }));
    swallow(api.setBadgeTextColor?.({ tabId, color: '#ffffff' }));
  }
}

/** Hosts the content script may run on: github.com plus granted Enterprise hosts. */
async function contentHosts(): Promise<Set<string>> {
  const settings = await settingsItem.getValue();
  return new Set(['github.com', ...(await grantedHosts(settings.enterpriseHosts))]);
}

/**
 * Put Geld into a tab that should have it but does not (installed/updated
 * while open, etc.). A tab still loading is left alone: the browser injects
 * the declared content script with the document, and a copy injected here
 * on top of it would only make the first one retire (github.content/index.ts).
 */
async function ensureTab(tab: { readonly id?: number | undefined; readonly url?: string | undefined; readonly status?: string | undefined }, reason: 'activated' | 'popup'): Promise<EnsureContentResponse> {
  if (tab.id === undefined || tab.status === 'loading' || hostOf(tab.url, await contentHosts()) === null) return { injected: false };
  return { injected: await ensureContentScript(tab.id, { reason, url: tab.url }) };
}

/** Keyboard shortcut: ask the active GitHub tab to toggle its hidden files. */
async function toggleHiddenInActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const message: ToggleHiddenMessage = { type: 'geld:toggle-hidden' };
  await browser.tabs.sendMessage(tab.id, message).catch(() => undefined);
}

export default defineBackground(() => {
  // Each start is a previous stop: a run of these around failing fetches says the worker is being killed mid-request.
  recordDiagnostic({ kind: 'worker-start' });
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isColorSchemeMessage(message)) {
      applyToolbarIcon(message.dark);
      return undefined;
    }
    if (isClearDiffCacheMessage(message)) {
      cache.clear();
      textCache.clear();
      recordDiagnostic({ kind: 'cache-clear' });
      sendResponse(true);
      return undefined;
    }
    if (isTabStateMessage(message)) {
      if (sender.tab?.id !== undefined) updateBadge(sender.tab.id, message.state);
      return undefined;
    }
    if (isAccountActionMessage(message)) {
      void handleAccountMessage(message).then(sendResponse);
      return true;
    }
    if (isCatalogCheckMessage(message)) {
      void checkCatalog(true).then(sendResponse);
      return true;
    }
    if (isEnsureContentMessage(message)) {
      void browser.tabs
        .get(message.tabId)
        .then((tab) => ensureTab(tab, 'popup'))
        .catch((): EnsureContentResponse => ({ injected: false }))
        .then(sendResponse);
      return true;
    }
    if (isFetchFileRequest(message)) {
      void fetchFile(message.url).then(sendResponse);
      return true;
    }
    if (isFetchDiffTextRequest(message)) {
      void fetchDiffText(message.url).then(sendResponse);
      return true;
    }
    if (isAiModelsRequest(message)) {
      void (async () => {
        const denied = await hasGatewayPermission(message.baseUrl);
        if (denied !== null) return { ok: false as const, reason: denied };
        if (message.apiKey.trim() === '') return { ok: false as const, reason: 'No API key.' };
        return listModels(fetch, message.baseUrl, message.apiKey);
      })().then(sendResponse);
      return true;
    }
    if (isAiEvaluateRequest(message)) {
      void (async () => {
        const denied = await hasGatewayPermission(message.baseUrl);
        if (denied !== null) return { ok: false as const, reason: denied };
        if (message.apiKey.trim() === '') return { ok: false as const, reason: message.baseUrl === TYPESAFE_API ? 'No TypeSafe key.' : 'No API key.' };
        return evaluateJev({ fetch, baseUrl: message.baseUrl, apiKey: message.apiKey, request: message.request, timeoutMs: 20_000 });
      })().then(sendResponse);
      return true;
    }
    if (isAiCompleteRequest(message)) {
      void (async () => {
        const denied = await hasGatewayPermission(message.baseUrl);
        if (denied !== null) return { ok: false as const, reason: denied };
        if (message.apiKey.trim() === '') return { ok: false as const, reason: 'No API key.' };
        if (message.model.trim() === '') return { ok: false as const, reason: 'No model selected.' };
        return completeChat({
          fetch,
          baseUrl: message.baseUrl,
          apiKey: message.apiKey,
          model: message.model,
          messages: message.messages,
          ...(message.jsonSchema === undefined ? {} : { jsonSchema: message.jsonSchema }),
          ...(message.schemaName === undefined ? {} : { schemaName: message.schemaName }),
        });
      })().then(sendResponse);
      return true;
    }
    if (!isFetchDiffRequest(message)) return undefined;
    void fetchDiff(message.url, message.priority ?? 'background').then(sendResponse);
    // Returning true keeps the message channel open for the async response.
    return true;
  });

  browser.commands?.onCommand.addListener((command) => {
    if (command === 'toggle-hidden') void toggleHiddenInActiveTab();
  });

  // GitHub Enterprise Server hosts: register on startup and whenever they change.
  const syncHosts = (): void => {
    void settingsItem
      .getValue()
      .then((settings) => syncEnterpriseHosts(settings.enterpriseHosts))
      .catch(() => undefined);
  };
  browser.runtime.onInstalled.addListener(syncHosts);
  browser.runtime.onStartup.addListener(syncHosts);
  settingsItem.watch((settings) => void syncEnterpriseHosts(settings.enterpriseHosts).catch(() => undefined));
  syncHosts();

  // Tabs that were open before an install/update have no content script yet.
  browser.runtime.onInstalled.addListener(() => {
    void contentHosts().then(async (hosts) => {
      for (const tab of await tabsOnHosts([...hosts])) void ensureContentScript(tab.id, { reason: 'install', url: tab.url });
    });
  });
  // Switching to a GitHub tab that somehow lacks Geld (e.g. reinstalled while it was open).
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs
      .get(tabId)
      .then((tab) => ensureTab(tab, 'activated'))
      .catch(() => undefined);
  });

  // GitHub account: keep settings in the user's secret gist when signed in.
  startAccountSync();

  // Pattern catalog: fetch the signed catalog/patterns.json from the repository
  // daily so patterns can improve without a store release.
  startCatalogUpdates();

  if (USES_OFFSCREEN_THEME_PROBE) {
    browser.runtime.onInstalled.addListener(() => void ensureThemeProbe());
    browser.runtime.onStartup.addListener(() => void ensureThemeProbe());
    void ensureThemeProbe();
  }
});
