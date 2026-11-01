import { browser } from 'wxt/browser';
import { providerForHost } from '@geld/core';
import type { ProviderId } from '@geld/core';
import { recordDiagnostic, tabSubject } from './diagnostics';
import type { GetTabStateMessage } from './messages';
import { isTabState } from './messages';

/**
 * Browsers only inject content scripts into pages loaded *after* an extension
 * is installed or updated; a provider tab that was already open has no Geld in
 * it until it is reloaded. These helpers put the script there on demand: on
 * install/update for every open supported tab, when a tab is activated, and when
 * the popup finds nobody to talk to.
 */

/** The page-world half of quick view (entrypoints/portal.content.ts); optional where MAIN-world injection is unsupported. */
const PORTAL_JS = '/content-scripts/portal.js';

export function contentScriptFiles(provider: ProviderId): { readonly js: `/content-scripts/${ProviderId}.js`; readonly css: `/content-scripts/${ProviderId}.css` } {
  return { js: `/content-scripts/${provider}.js`, css: `/content-scripts/${provider}.css` };
}

/** Is the content script already running in this tab? */
export async function hasContentScript(tabId: number): Promise<boolean> {
  const message: GetTabStateMessage = { type: 'geld:get-tab-state' };
  try {
    const response: unknown = await browser.tabs.sendMessage(tabId, message);
    return isTabState(response);
  } catch {
    return false;
  }
}

/** MV2 (Firefox) script injection APIs; not present in the MV3 typings. */
interface LegacyTabs {
  insertCSS(tabId: number, details: { file: string; runAt: 'document_start' }): Promise<unknown>;
  executeScript(tabId: number, details: { file: string; runAt: 'document_start' }): Promise<unknown>;
}

function legacyTabs(): LegacyTabs | null {
  const insertCSS: unknown = Reflect.get(browser.tabs, 'insertCSS');
  const executeScript: unknown = Reflect.get(browser.tabs, 'executeScript');
  if (typeof insertCSS !== 'function' || typeof executeScript !== 'function') return null;
  return {
    insertCSS: (tabId, details) => Promise.resolve(insertCSS.call(browser.tabs, tabId, details)),
    executeScript: (tabId, details) => Promise.resolve(executeScript.call(browser.tabs, tabId, details)),
  };
}

export async function injectContentScript(tabId: number, provider: ProviderId, manifestVersion: number = import.meta.env.MANIFEST_VERSION): Promise<void> {
  const files = contentScriptFiles(provider);
  if (manifestVersion === 3) {
    await browser.scripting.insertCSS({ target: { tabId }, files: [files.css] });
    await browser.scripting.executeScript({ target: { tabId }, files: [files.js] });
    if (provider === 'github') {
      try {
        await browser.scripting.executeScript({ target: { tabId }, files: [PORTAL_JS], world: 'MAIN' });
      } catch {
        // No MAIN-world injection here (older Firefox): quick view still works, React's own controls inside it do not.
      }
    }
    return;
  }
  const tabs = legacyTabs();
  if (tabs === null) throw new Error('No script injection API available.');
  await tabs.insertCSS(tabId, { file: files.css, runAt: 'document_start' });
  await tabs.executeScript(tabId, { file: files.js, runAt: 'document_start' });
}

/**
 * Make sure Geld runs in `tabId` (a tab on a host we are allowed on). Returns
 * `true` when the script had to be injected. Failures (restricted pages,
 * discarded tabs, missing permission) are swallowed: there is nothing useful
 * to do about them here.
 */
export async function ensureContentScript(tabId: number, why: { readonly reason: 'install' | 'activated' | 'popup'; readonly url?: string | undefined; readonly provider?: ProviderId }): Promise<boolean> {
  const subject = why.url === undefined ? undefined : tabSubject(why.url);
  let provider = why.provider;
  if (why.url !== undefined) {
    try {
      const url = new URL(why.url);
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
      const knownProvider = providerForHost(url.hostname);
      if (knownProvider !== null && provider !== undefined && provider !== knownProvider) return false;
      provider ??= knownProvider ?? undefined;
    } catch {
      return false;
    }
  }
  if (provider === undefined) return false;
  if (await hasContentScript(tabId)) {
    recordDiagnostic({ kind: 'inject', subject, outcome: 'present', reason: why.reason });
    return false;
  }
  try {
    await injectContentScript(tabId, provider);
    recordDiagnostic({ kind: 'inject', subject, outcome: 'injected', reason: why.reason });
    return true;
  } catch {
    recordDiagnostic({ kind: 'inject', subject, outcome: 'failed', reason: why.reason });
    return false;
  }
}

/**
 * Every *loaded* tab on the given hosts, for install/update time. Tabs the
 * browser has discarded to save memory are left alone: they have no page to
 * inject into, and they get a fresh content script when they reload on
 * activation. Someone with many GitHub tabs parked should not have an
 * extension update touch each of them.
 */
export async function tabsOnHosts(hosts: readonly string[]): Promise<ReadonlyArray<{ readonly id: number; readonly url: string | undefined }>> {
  if (hosts.length === 0) return [];
  try {
    const tabs = await browser.tabs.query({ url: hosts.map((host) => `https://${host}/*`), discarded: false });
    return tabs.filter((tab) => tab.status !== 'unloaded').flatMap((tab) => (tab.id === undefined ? [] : [{ id: tab.id, url: tab.url }]));
  } catch {
    return [];
  }
}

/** Hostname of a tab URL when it is one of ours, else `null`. */
export function hostOf(url: string | undefined, hosts: ReadonlySet<string>): string | null {
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && hosts.has(parsed.hostname) ? parsed.hostname : null;
  } catch {
    return null;
  }
}
