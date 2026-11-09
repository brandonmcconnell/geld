import { browser } from 'wxt/browser';
import { grantedHosts, syncEnterpriseHosts } from '../lib/enterprise';
import { reportError } from '../lib/error-capture';
import { ensureContentScript, tabsOnHosts } from '../lib/inject';
import { settingsItem } from '../lib/storage';
import { grantedProviderHosts, isOptionalProviderScript, syncOptionalProviders } from '../lib/provider-access';
import { CONTENT_SCRIPTS_FILE, conflictFor, parseDeclaredScripts, sameConflict } from './conflicts';
import type { DeclaredScript } from './conflicts';
import { nightlyConflictItem } from './state';

/**
 * A nightly build declares no content scripts in its manifest (wxt.config.ts): a copy that merely started on
 * a page would announce itself (`geld:takeover`) and push Geld Stable's copy out. Instead the background
 * registers the same scripts only while no other Geld is on, and takes them away the moment one is.
 */

const ID_PREFIX = 'geld-nightly-run-';
/** entrypoints/conflict.content: while paused, it marks Geld Stable's bar with the conflict and nothing else. */
const CONFLICT_ID = 'geld-nightly-conflict';
const CONFLICT_JS = 'content-scripts/conflict.js';
const CONFLICT_CSS = 'content-scripts/conflict.css';
async function declared(): Promise<DeclaredScript[]> {
  const response = await fetch(new URL(`/${CONTENT_SCRIPTS_FILE}`, globalThis.location.origin), { cache: 'no-store' });
  const scripts = response.ok ? parseDeclaredScripts(await response.json()) : null;
  if (scripts === null) throw new Error(`${CONTENT_SCRIPTS_FILE} is missing or unreadable`);
  return scripts;
}

async function registered(): Promise<{ readonly run: string[]; readonly conflict: boolean; readonly providers: boolean }> {
  const ids = (await browser.scripting.getRegisteredContentScripts()).map((script) => script.id);
  return { run: ids.filter((id) => id.startsWith(ID_PREFIX)), conflict: ids.includes(CONFLICT_ID), providers: ids.some(isOptionalProviderScript) };
}

async function contentHosts(): Promise<string[]> {
  return ['github.com', ...(await grantedHosts((await settingsItem.getValue()).enterpriseHosts)), ...(await grantedProviderHosts())];
}

/** Registered for later pages and put into the open ones, which loaded while Geld Nightly still ran. */
async function showConflict(): Promise<void> {
  const hosts = await contentHosts();
  await browser.scripting.registerContentScripts([
    { id: CONFLICT_ID, matches: hosts.map((host) => `https://${host}/*`), js: [CONFLICT_JS], css: [CONFLICT_CSS], runAt: 'document_idle', persistAcrossSessions: true },
  ]);
  for (const tab of await tabsOnHosts(hosts)) {
    await browser.scripting.insertCSS({ target: { tabId: tab.id }, files: [`/${CONFLICT_CSS}`] }).catch(() => undefined);
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/conflict.js'] }).catch(() => undefined);
  }
}

async function register(): Promise<void> {
  const scripts = await declared();
  await browser.scripting.registerContentScripts(
    scripts.map((script, index) => ({
      id: `${ID_PREFIX}${index}`,
      matches: [...script.matches],
      js: [...script.js],
      ...(script.css.length > 0 ? { css: [...script.css] } : {}),
      runAt: script.runAt,
      world: script.world,
      allFrames: script.allFrames,
      persistAcrossSessions: true,
    })),
  );
}

async function syncHosts(): Promise<void> {
  await Promise.all([syncEnterpriseHosts((await settingsItem.getValue()).enterpriseHosts), syncOptionalProviders()]);
}

/** Puts Geld into the granted provider tabs that were open while it was paused. */
async function injectOpenTabs(): Promise<void> {
  for (const tab of await tabsOnHosts(await contentHosts())) void ensureContentScript(tab.id, { reason: 'install', url: tab.url });
}

async function evaluate(): Promise<void> {
  const extensions = await browser.management.getAll();
  const conflict = conflictFor(
    browser.runtime.id,
    extensions.map((extension) => ({ id: extension.id, name: extension.name, enabled: extension.enabled, type: extension.type, homepageUrl: extension.homepageUrl })),
  );
  if (!sameConflict(await nightlyConflictItem.getValue(), conflict)) await nightlyConflictItem.setValue(conflict);
  const now = await registered();
  if (conflict !== null) {
    if (now.run.length > 0 || now.providers) {
      // Unregistered before anything else can fail, so Geld never stays registered beside Geld Stable.
      if (now.run.length > 0) await browser.scripting.unregisterContentScripts({ ids: now.run });
      await syncHosts().catch((error: unknown) => reportError('background:nightly-pause', error));
      // The copies already running in open tabs retire when their extension reloads (`ctx.onInvalidated`), and with
      // the scripts unregistered first the reloaded worker finds none and does not reload again.
      browser.runtime.reload();
      return;
    }
    await syncHosts();
    if (!now.conflict) await showConflict();
    return;
  }
  // The notes in open tabs take themselves away when they see the conflict end (`nightlyConflictItem`).
  if (now.conflict) await browser.scripting.unregisterContentScripts({ ids: [CONFLICT_ID] });
  if (now.run.length > 0) return;
  await register();
  await syncHosts();
  await injectOpenTabs();
}

let queue: Promise<void> | null = null;
const RETRY_MS = 5_000;
const RETRIES = 3;

/** A failed evaluation is reported and tried again, so a conflict never waits for the next extension event. */
function reevaluate(attempt = 0): void {
  queue = (queue ?? Promise.resolve()).then(evaluate).catch((error: unknown) => {
    reportError('background:nightly-pause', error);
    if (attempt < RETRIES) setTimeout(() => reevaluate(attempt + 1), RETRY_MS);
  });
}

export function startPauseWatch(): void {
  browser.management.onEnabled.addListener(() => reevaluate());
  browser.management.onDisabled.addListener(() => reevaluate());
  browser.management.onInstalled.addListener(() => reevaluate());
  browser.management.onUninstalled.addListener(() => reevaluate());
  reevaluate();
}
