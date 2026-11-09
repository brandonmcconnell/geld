import { browser } from 'wxt/browser';
import { reportError } from '../lib/error-capture';
import { buildProblem } from './build-check';
import { loadBackup, loadFolderHandle, saveBackup } from './handle-store';
import type { BuildBackup } from './handle-store';
import { isNightlyCheckMessage, isNightlyInstallMessage, isNightlyManageMessage, isNightlyRollbackMessage } from './messages';
import { manageUrl } from './conflicts';
import type { NightlyInstallResult } from './messages';
import type { NightlyBrowser } from './release';
import { compareVersions, LATEST_RELEASE_PAGE, LATEST_RELEASE_URL, parseRelease, tagFromReleaseUrl } from './release';
import { BACKGROUND_CHECK_MINUTES, navigationDue, needsDetails } from './schedule';
import { startPauseWatch } from './pause';
import { nightlyConflictItem, nightlyFolderItem, nightlyPrefsItem, nightlyStatusItem, nightlyTabCountsItem } from './state';
import type { NightlyFailure, NightlyStatus, UpdateMode } from './state';
import { unzip } from './unzip';
import type { ZipEntry } from './unzip';
import { copyRunningBuild, downloadsReach, downloadsTarget, folderIsOurs, folderPermission, folderTarget } from './writers';
import type { BuildTarget } from './writers';

/** Background side of nightly builds: looks for a newer release, marks the toolbar icon, installs and rolls back. */

const ALARM = 'geld:nightly-check';
const BADGE_COLOR = '#1a7f37';
const FAILED_COLOR = '#cf222e';
/** Mirrors the hidden-file badge in background.ts, which hands a nightly build's tab badges to `showTabBadge`. */
const COUNT_COLOR = '#59636e';
/** The reply goes out before the reload, which closes every page that asked for it. */
const RELOAD_DELAY_MS = 300;

type Failed = Extract<NightlyInstallResult, { ok: false }>;

/** The build's own browser, fixed when it was built: Edge's nightly updates from the Edge zip. */
function nightlyBrowser(): NightlyBrowser {
  return import.meta.env.BROWSER === 'edge' ? 'edge' : 'chrome';
}

export function installedVersion(): string {
  return browser.runtime.getManifest().version;
}

export function isNewer(status: NightlyStatus): boolean {
  return status.latest !== null && compareVersions(status.latest.version, installedVersion()) > 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let writes: Promise<unknown> | null = null;

/** Writes one after another: a look and an install finishing together must not each write back what the other replaced. */
function patchStatus(patch: Partial<NightlyStatus>): Promise<NightlyStatus> {
  const run = (writes ?? Promise.resolve()).then(async () => {
    const next = { ...(await nightlyStatusItem.getValue()), ...patch };
    await nightlyStatusItem.setValue(next);
    return next;
  });
  writes = run.catch(() => undefined);
  return run;
}

type Mark = '' | '↑' | '!' | 'OFF';
let mark: Mark = '';

function markOf(status: NightlyStatus, paused: boolean): Mark {
  return paused ? 'OFF' : status.failure?.broken === true ? '!' : isNewer(status) ? '↑' : '';
}

/**
 * A tab's own badge (its hidden-file count) hides the global one, so on GitHub, where the reader is, the
 * mark rides on the count: "3↑". The count's colour stays unless there is a mark.
 */
async function paintTab(tabId: number, count: number): Promise<void> {
  const text = mark === 'OFF' ? mark : `${count > 0 ? count : ''}${mark}`;
  await browser.action.setBadgeText({ tabId, text }).catch(() => undefined);
  if (text === '') return;
  await browser.action.setBadgeBackgroundColor({ tabId, color: mark === '' ? COUNT_COLOR : mark === '↑' ? BADGE_COLOR : FAILED_COLOR }).catch(() => undefined);
  await browser.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => undefined);
}

export function showTabBadge(tabId: number, count: number): void {
  void paintTab(tabId, count);
  void nightlyTabCountsItem.getValue().then((counts) => (counts[String(tabId)] === count ? undefined : nightlyTabCountsItem.setValue({ ...counts, [String(tabId)]: count })));
}

async function showBadge(status: NightlyStatus): Promise<void> {
  const ready = isNewer(status) ? status.latest : null;
  const paused = (await nightlyConflictItem.getValue()) !== null;
  const next = markOf(status, paused);
  const changed = next !== mark;
  mark = next;
  await browser.action.setBadgeText({ text: mark }).catch(() => undefined);
  if (mark !== '') await browser.action.setBadgeBackgroundColor({ color: mark === '↑' ? BADGE_COLOR : FAILED_COLOR }).catch(() => undefined);
  const title =
    mark === 'OFF' ? 'Geld Nightly · paused while another Geld is on' : mark === '!' ? 'Geld Nightly · an update failed' : ready === null ? 'Geld Nightly' : `Geld Nightly · build ${ready.build} is ready`;
  await browser.action.setTitle({ title }).catch(() => undefined);
  if (!changed) return;
  for (const [tabId, count] of Object.entries(await nightlyTabCountsItem.getValue())) void paintTab(Number(tabId), count);
}

async function mode(): Promise<UpdateMode> {
  return (await nightlyPrefsItem.getValue()).mode;
}

/** Automatic leaves alone a build the reader rolled back from, and one whose write already broke off. */
function installsOnItsOwn(status: NightlyStatus): boolean {
  const latest = status.latest;
  if (latest === null || !isNewer(status) || status.installing !== null || latest.version === status.skipped) return false;
  const failure = status.failure;
  return failure === null || failure.version !== latest.version || (failure.restored !== true && failure.broken !== true);
}

/** The tag the latest-release redirect lands on: one cheap request to the website, not the rate-limited API. */
async function latestTag(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_RELEASE_PAGE, { method: 'HEAD', cache: 'no-store', credentials: 'omit' });
    return response.ok ? tagFromReleaseUrl(response.url) : null;
  } catch {
    return null;
  }
}

async function releaseDetails(before: NightlyStatus, checkedAt: string, tag: string | null): Promise<NightlyStatus> {
  const asked = { askedTag: tag, askedAt: checkedAt };
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (before.etag !== null && before.latest !== null) headers['If-None-Match'] = before.etag;
    const response = await fetch(LATEST_RELEASE_URL, { headers, cache: 'no-store' });
    if (response.status === 304) return await patchStatus({ ...asked, checkedAt, checkError: null });
    if (response.status === 403 || response.status === 429) return await patchStatus({ ...asked, checkedAt, checkError: 'GitHub is limiting requests. Geld checks again later.' });
    if (!response.ok) return await patchStatus({ ...asked, checkedAt, checkError: `GitHub answered ${response.status}.` });
    const latest = parseRelease(await response.json(), nightlyBrowser());
    return await patchStatus({
      ...asked,
      checkedAt,
      latest,
      etag: response.headers.get('etag'),
      checkError: latest === null ? 'The latest release has no nightly build.' : null,
    });
  } catch (error) {
    return await patchStatus({ ...asked, checkedAt, checkError: `Could not reach GitHub: ${message(error)}` });
  }
}

async function look(): Promise<NightlyStatus> {
  const checkedAt = new Date().toISOString();
  const tag = await latestTag();
  const before = await nightlyStatusItem.getValue();
  const status = tag !== null && !needsDetails(before, tag, Date.now())
    ? await patchStatus({ checkedAt, checkError: null })
    : await releaseDetails(before, checkedAt, tag);
  await showBadge(status);
  if ((await mode()) === 'automatic' && installsOnItsOwn(status)) void installLatest(false);
  return status;
}

let looking: Promise<NightlyStatus> | null = null;
let lastLookAt: number | null = null;

/**
 * All of Geld's tabs share this one worker, so the first look to find a build is the one that acts on it: a
 * look under way is joined rather than repeated, and an install under way (`once`) is never started twice.
 */
export function checkForUpdate(): Promise<NightlyStatus> {
  lastLookAt = Date.now();
  looking ??= look().finally(() => {
    looking = null;
  });
  return looking;
}

/**
 * Folder access comes first: it also removes files a new build dropped, and once the reader chose
 * "Allow on every visit" Chrome keeps it with no Geld page open, across reloads and restarts.
 */
async function installTarget(): Promise<BuildTarget | Failed> {
  const folder = await nightlyFolderItem.getValue();
  const handle = folder === null ? null : await loadFolderHandle().catch(() => null);
  if (folder === null || handle === null) return { ok: false, reason: 'Connect the folder Geld runs from first.', need: 'folder' };
  if ((await folderPermission(handle)) === 'granted') {
    if (!(await folderIsOurs(handle))) return { ok: false, reason: 'The connected folder is not the one Geld runs from. Connect it again.', need: 'folder' };
    return folderTarget(handle);
  }
  let downloads = folder.downloads;
  if (downloads === null) {
    downloads = await downloadsReach(folder.name);
    await nightlyFolderItem.setValue({ ...folder, downloads });
  } else if (downloads && !(await downloadsReach(folder.name))) {
    return { ok: false, reason: 'Geld can no longer reach its folder in Downloads. Connect it again.', need: 'folder' };
  }
  if (downloads) return downloadsTarget(folder.name);
  return { ok: false, reason: 'Geld needs your OK to write to its folder.', need: 'permission' };
}

async function fail(failure: NightlyFailure): Promise<Failed> {
  await patchStatus({ installing: null, failure });
  await showBadge(await nightlyStatusItem.getValue());
  const stage = failure.broken === true ? 'broken' : failure.restored === true ? 'restored' : 'before writing';
  reportError('background:nightly-update', new Error(`Update to ${failure.version} failed (${stage}): ${failure.reason}`));
  return { ok: false, reason: failure.reason };
}

async function downloadBuild(url: string, version: string): Promise<ZipEntry[]> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The download failed (${response.status}).`);
  const entries = await unzip(new Uint8Array(await response.arrayBuffer()));
  const problem = buildProblem(entries, version);
  if (problem !== null) throw new Error(problem);
  return entries;
}

/**
 * Writes `next` over the running build. A write that breaks off writes `previous` back; a write of
 * `previous` that breaks off too leaves both half there, which the backup in IndexedDB can still repair.
 */
async function replace(target: BuildTarget, next: readonly ZipEntry[], previous: BuildBackup, version: string): Promise<NightlyFailure | null> {
  try {
    await target.write(next, previous.files.map((file) => file.path));
    return null;
  } catch (error) {
    const failure = { version, stillOn: previous.version, reason: message(error), at: new Date().toISOString() };
    try {
      await target.write(previous.files, next.map((entry) => entry.path));
      return { ...failure, restored: true };
    } catch {
      return { ...failure, broken: true };
    }
  }
}

function reloadSoon(): void {
  setTimeout(() => browser.runtime.reload(), RELOAD_DELAY_MS);
}

let running: Promise<NightlyInstallResult> | null = null;

function once(run: () => Promise<NightlyInstallResult>): Promise<NightlyInstallResult> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

/** `explicit`: the reader asked, so a build they rolled back from, or whose write broke off, is tried again. */
export function installLatest(explicit: boolean): Promise<NightlyInstallResult> {
  return once(() => install(explicit));
}

export function rollBack(): Promise<NightlyInstallResult> {
  return once(restorePrevious);
}

async function install(explicit: boolean): Promise<NightlyInstallResult> {
  const status = await nightlyStatusItem.getValue();
  const latest = status.latest;
  const current = installedVersion();
  if (latest === null || !isNewer(status)) return { ok: false, reason: 'Geld is up to date.' };
  if (!explicit && !installsOnItsOwn(status)) return { ok: false, reason: 'Waiting for a newer build.' };
  const target = await installTarget();
  if ('ok' in target) return target;
  await patchStatus({ installing: latest.version, failure: null });
  let entries: ZipEntry[];
  let previous: BuildBackup;
  try {
    entries = await downloadBuild(latest.assetUrl, latest.version);
    // After a write that could not be undone the folder is half one build, half the other: the backup is the whole old one.
    const kept = status.failure?.broken === true ? await loadBackup() : null;
    previous = kept ?? (await copyRunningBuild(current));
    if (kept === null) await saveBackup(previous);
  } catch (error) {
    return fail({ version: latest.version, stillOn: current, reason: message(error), at: new Date().toISOString() });
  }
  const failure = await replace(target, entries, previous, latest.version);
  if (failure !== null) return fail(failure);
  await patchStatus({
    installing: null,
    failure: null,
    skipped: explicit ? null : status.skipped,
    backup: previous.version,
    lastInstall: { from: current, to: latest.version, at: new Date().toISOString(), method: target.method },
  });
  reloadSoon();
  return { ok: true, version: latest.version };
}

async function restorePrevious(): Promise<NightlyInstallResult> {
  const status = await nightlyStatusItem.getValue();
  const backup = await loadBackup();
  if (backup === null) return { ok: false, reason: 'There is no earlier build to go back to.' };
  const target = await installTarget();
  if ('ok' in target) return target;
  const current = installedVersion();
  const repairing = status.failure?.broken === true;
  await patchStatus({ installing: backup.version });
  // Repairing, the folder's own files are half written, so there is nothing whole to fall back on.
  const undo = repairing ? backup : await copyRunningBuild(current).catch(() => backup);
  const failure = await replace(target, backup.files, undo, backup.version);
  if (failure !== null) return fail(failure);
  await patchStatus({
    installing: null,
    failure: null,
    skipped: repairing ? status.skipped : current,
    backup: null,
    lastInstall: { from: current, to: backup.version, at: new Date().toISOString(), method: target.method, rollback: true },
  });
  reloadSoon();
  return { ok: true, version: backup.version };
}

/** Every GitHub page load and in-page navigation looks, in the background, so the page never waits on it. */
function onGitHubNavigation(): void {
  if (navigationDue(lastLookAt, Date.now())) void checkForUpdate();
}

async function scheduleChecks(): Promise<void> {
  if ((await browser.alarms.get(ALARM))?.periodInMinutes === BACKGROUND_CHECK_MINUTES) return;
  await browser.alarms.create(ALARM, { periodInMinutes: BACKGROUND_CHECK_MINUTES, delayInMinutes: BACKGROUND_CHECK_MINUTES });
}

function isGitHub(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    return new URL(url).hostname === 'github.com';
  } catch {
    return false;
  }
}

export function startNightly(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void checkForUpdate();
  });
  browser.tabs.onUpdated.addListener((_tabId, change, tab) => {
    // `url` alone is an in-page navigation (GitHub's history.pushState), `complete` a load.
    if ((change.status === 'complete' || change.url !== undefined) && isGitHub(change.url ?? tab.url)) onGitHubNavigation();
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void nightlyTabCountsItem.getValue().then((counts) => {
      if (!(String(tabId) in counts)) return undefined;
      const { [String(tabId)]: _closed, ...rest } = counts;
      return nightlyTabCountsItem.setValue(rest);
    });
  });
  browser.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
    if (isNightlyCheckMessage(request)) {
      void checkForUpdate().then(sendResponse);
      return true;
    }
    if (isNightlyInstallMessage(request)) {
      void installLatest(true).then(sendResponse);
      return true;
    }
    if (isNightlyManageMessage(request)) {
      void nightlyConflictItem.getValue().then((conflict) => (conflict === null ? undefined : browser.tabs.create({ url: manageUrl(conflict.id) })));
      return undefined;
    }
    if (isNightlyRollbackMessage(request)) {
      void rollBack().then(sendResponse);
      return true;
    }
    return undefined;
  });
  browser.runtime.onStartup.addListener(() => void checkForUpdate());
  browser.runtime.onInstalled.addListener(() => void checkForUpdate());
  nightlyPrefsItem.watch(() => void checkForUpdate());
  // This worker has only just started, so no install of its own is under way: one marked is left from a worker Chrome stopped mid-install.
  void patchStatus({ installing: null }).then(showBadge);
  void scheduleChecks();
  startPauseWatch();
  nightlyConflictItem.watch(() => void nightlyStatusItem.getValue().then(showBadge));
}
