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
import type { FetchDiffResponse, FetchFileResponse, TabState, ToggleHiddenMessage } from '../src/lib/messages';
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
  isFetchFileRequest,
  isTabStateMessage,
} from '../src/lib/messages';
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
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const RATE_LIMIT_COOLDOWN_MAX_MS = 15 * 60 * 1000;

interface Throttle {
  /** Unix ms of recent request starts, oldest first. */
  readonly sent: number[];
  readonly cooldownUntil: number;
  /** Consecutive rate-limit answers; each doubles the next cooldown. */
  readonly strikes: number;
}

const throttleItem = storage.defineItem<Throttle>('local:diffThrottle', { fallback: { sent: [], cooldownUntil: 0, strikes: 0 } });
let throttle: Throttle | null = null;
let throttleLoading: Promise<Throttle> | null = null;

async function loadThrottle(): Promise<Throttle> {
  if (throttle !== null) return throttle;
  throttleLoading ??= throttleItem.getValue().then((value) => {
    throttle = { sent: Array.isArray(value.sent) ? value.sent.filter((t): t is number => typeof t === 'number') : [], cooldownUntil: value.cooldownUntil, strikes: value.strikes };
    return throttle;
  });
  return throttleLoading;
}

function saveThrottle(next: Throttle): void {
  throttle = next;
  void throttleItem.setValue(next).catch(() => undefined);
}

/** Wait for a slot in the sliding window, then claim it. */
async function takeTurn(): Promise<void> {
  for (;;) {
    const current = await loadThrottle();
    const now = Date.now();
    const sent = current.sent.filter((t) => now - t < DIFF_WINDOW_MS);
    if (sent.length < DIFF_BUDGET) {
      saveThrottle({ ...current, sent: [...sent, now] });
      return;
    }
    const oldest = sent[0] ?? now;
    await new Promise((resolve) => setTimeout(resolve, oldest + DIFF_WINDOW_MS - now + 50));
  }
}

/** A 429/403 arrived: block for longer each time it repeats, or for what GitHub asks. */
async function recordRateLimit(retryAfterHeader: string | null): Promise<number> {
  const current = await loadThrottle();
  const strikes = current.strikes + 1;
  const asked = Number.parseInt(retryAfterHeader ?? '', 10);
  const cooldown = Number.isFinite(asked) && asked > 0 ? asked * 1000 : Math.min(RATE_LIMIT_COOLDOWN_MS * 2 ** (strikes - 1), RATE_LIMIT_COOLDOWN_MAX_MS);
  saveThrottle({ ...current, strikes, cooldownUntil: Date.now() + cooldown });
  return cooldown;
}

async function recordSuccess(): Promise<void> {
  const current = await loadThrottle();
  if (current.strikes !== 0) saveThrottle({ ...current, strikes: 0 });
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

/**
 * `https://github.com/<owner>/<repo>/pull/<n>.diff` redirects to
 * `patch-diff.githubusercontent.com`, which does not send CORS headers. Content
 * scripts therefore cannot fetch it, but the background script can thanks to
 * the extension's host permissions. Cookies are included so private
 * repositories work for signed-in users.
 */
async function fetchDiff(url: string): Promise<FetchDiffResponse> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'https:' || !(await allowedHosts()).has(parsed.hostname) || !parsed.pathname.endsWith('.diff')) {
    return { ok: false, reason: 'disallowed-url' };
  }

  const cached = readCache(parsed.toString());
  if (cached !== null) return cached;
  const state = await loadThrottle();
  if (Date.now() < state.cooldownUntil) return { ok: false, reason: 'rate-limited', retryAfterMs: state.cooldownUntil - Date.now() };
  await takeTurn();

  let result: FetchDiffResponse;
  try {
    const response = await fetch(parsed.toString(), {
      credentials: 'include',
      // Only a diff will do: a number that is an issue redirects to an HTML
      // page, which this turns into a 406 instead of an "empty diff".
      headers: { Accept: 'text/plain' },
      redirect: 'follow',
    });
    if (response.status === 429 || response.status === 403) {
      const retryAfterMs = await recordRateLimit(response.headers.get('retry-after'));
      result = { ok: false, reason: 'rate-limited', retryAfterMs };
    } else if (!response.ok) {
      result = { ok: false, reason: `http-${response.status}` };
    } else {
      const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
      if (declared > MAX_DIFF_BYTES) {
        result = { ok: false, reason: 'too-large' };
      } else {
        const text = await readWithLimit(response, MAX_DIFF_BYTES);
        result = { ok: true, files: parseUnifiedDiff(text) };
        await recordSuccess();
      }
    }
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : 'fetch-failed' };
  }
  // Only successful and definitive failures are cached; transient network errors retry.
  if (result.ok || result.reason === 'too-large' || result.reason.startsWith('http-4')) {
    writeCache(parsed.toString(), result);
  }
  return result;
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

/** Put Geld into a tab that should have it but does not (installed/updated while open, etc.). */
async function ensureTab(tabId: number, url: string | undefined): Promise<EnsureContentResponse> {
  if (hostOf(url, await contentHosts()) === null) return { injected: false };
  return { injected: await ensureContentScript(tabId) };
}

/** Keyboard shortcut: ask the active GitHub tab to toggle its hidden files. */
async function toggleHiddenInActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const message: ToggleHiddenMessage = { type: 'geld:toggle-hidden' };
  await browser.tabs.sendMessage(tab.id, message).catch(() => undefined);
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isColorSchemeMessage(message)) {
      applyToolbarIcon(message.dark);
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
        .then((tab) => ensureTab(message.tabId, tab.url))
        .catch((): EnsureContentResponse => ({ injected: false }))
        .then(sendResponse);
      return true;
    }
    if (isFetchFileRequest(message)) {
      void fetchFile(message.url).then(sendResponse);
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
    void fetchDiff(message.url).then(sendResponse);
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
      for (const tabId of await tabsOnHosts([...hosts])) void ensureContentScript(tabId);
    });
  });
  // Switching to a GitHub tab that somehow lacks Geld (e.g. reinstalled while it was open).
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs
      .get(tabId)
      .then((tab) => ensureTab(tabId, tab.url))
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
