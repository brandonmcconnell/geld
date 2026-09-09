import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { parseUnifiedDiff } from '@geld/core';
import { handleAccountMessage, startAccountSync } from '../src/lib/account-service';
import { actionIconPaths } from '../src/lib/action-icon';
import { checkCatalog, startCatalogUpdates } from '../src/lib/catalog';
import { syncEnterpriseHosts } from '../src/lib/enterprise';
import { settingsItem } from '../src/lib/storage';
import type { FetchDiffResponse, TabState, ToggleHiddenMessage } from '../src/lib/messages';
import type { EnsureContentResponse } from '../src/lib/messages';
import { isAccountActionMessage, isCatalogCheckMessage, isColorSchemeMessage, isEnsureContentMessage, isFetchDiffRequest, isTabStateMessage } from '../src/lib/messages';
import { ensureContentScript, hostOf, tabsOnHosts } from '../src/lib/inject';
import { grantedHosts } from '../src/lib/enterprise';

/** Refuse to parse diffs larger than this; GitHub's UI is unusable there anyway. */
const MAX_DIFF_BYTES = 20 * 1024 * 1024;

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

/** After a 429/403 we pause all diff fetching for this long. */
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
let cooldownUntil = 0;

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
  if (Date.now() < cooldownUntil) return { ok: false, reason: 'rate-limited' };

  let result: FetchDiffResponse;
  try {
    const response = await fetch(parsed.toString(), {
      credentials: 'include',
      headers: { Accept: 'text/plain' },
      redirect: 'follow',
    });
    if (response.status === 429 || response.status === 403) {
      // GitHub's abuse detection kicked in; stop asking for a while.
      cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      result = { ok: false, reason: 'rate-limited' };
    } else if (!response.ok) {
      result = { ok: false, reason: `http-${response.status}` };
    } else {
      const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
      if (declared > MAX_DIFF_BYTES) {
        result = { ok: false, reason: 'too-large' };
      } else {
        const text = await readWithLimit(response, MAX_DIFF_BYTES);
        result = { ok: true, files: parseUnifiedDiff(text) };
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
