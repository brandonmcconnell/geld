import { browser } from 'wxt/browser';
import type { GetTabStateMessage } from './messages';
import { isTabState } from './messages';

/**
 * Browsers only inject content scripts into pages loaded *after* an extension
 * is installed or updated; a GitHub tab that was already open has no Geld in
 * it until it is reloaded. These helpers put the script there on demand: on
 * install/update for every open GitHub tab, when a tab is activated, and when
 * the popup finds nobody to talk to.
 */

const CONTENT_JS = '/content-scripts/github.js';
const CONTENT_CSS = '/content-scripts/github.css';

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

async function inject(tabId: number): Promise<void> {
  if (import.meta.env.MANIFEST_VERSION === 3) {
    await browser.scripting.insertCSS({ target: { tabId }, files: [CONTENT_CSS] });
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_JS] });
    return;
  }
  const tabs = legacyTabs();
  if (tabs === null) throw new Error('No script injection API available.');
  await tabs.insertCSS(tabId, { file: CONTENT_CSS, runAt: 'document_start' });
  await tabs.executeScript(tabId, { file: CONTENT_JS, runAt: 'document_start' });
}

/**
 * Make sure Geld runs in `tabId` (a tab on a host we are allowed on). Returns
 * `true` when the script had to be injected. Failures (restricted pages,
 * discarded tabs, missing permission) are swallowed: there is nothing useful
 * to do about them here.
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await hasContentScript(tabId)) return false;
  try {
    await inject(tabId);
    return true;
  } catch {
    return false;
  }
}

/** Every open tab on the given hosts, for install/update time. */
export async function tabsOnHosts(hosts: readonly string[]): Promise<number[]> {
  if (hosts.length === 0) return [];
  try {
    const tabs = await browser.tabs.query({ url: hosts.map((host) => `https://${host}/*`) });
    return tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);
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
