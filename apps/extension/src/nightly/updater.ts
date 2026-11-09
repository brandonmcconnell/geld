import { browser } from 'wxt/browser';
import { reportError } from '../lib/error-capture';
import { buildProblem } from './build-check';
import { loadBackup, loadFolderHandle, saveBackup } from './handle-store';
import type { BuildBackup } from './handle-store';
import { isNightlyCheckMessage, isNightlyInstallMessage, isNightlyRollbackMessage } from './messages';
import type { NightlyInstallResult } from './messages';
import { compareVersions, LATEST_RELEASE_URL, parseRelease } from './release';
import { AUTOMATIC_CHECK_MS, MANUAL_CHECK_MS, nightlyFolderItem, nightlyPrefsItem, nightlyStatusItem } from './state';
import type { NightlyFailure, NightlyStatus, UpdateMode } from './state';
import { unzip } from './unzip';
import type { ZipEntry } from './unzip';
import { copyRunningBuild, downloadsReach, downloadsTarget, folderIsOurs, folderPermission, folderTarget } from './writers';
import type { BuildTarget } from './writers';

/** Background side of nightly builds: looks for a newer release, marks the toolbar icon, installs and rolls back. */

const ALARM = 'geld:nightly-check';
const BADGE_COLOR = '#1a7f37';
/** The reply goes out before the reload, which closes every page that asked for it. */
const RELOAD_DELAY_MS = 300;

type Failed = Extract<NightlyInstallResult, { ok: false }>;

export function installedVersion(): string {
  return browser.runtime.getManifest().version;
}

export function isNewer(status: NightlyStatus): boolean {
  return status.latest !== null && compareVersions(status.latest.version, installedVersion()) > 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function patchStatus(patch: Partial<NightlyStatus>): Promise<NightlyStatus> {
  const next = { ...(await nightlyStatusItem.getValue()), ...patch };
  await nightlyStatusItem.setValue(next);
  return next;
}

async function showBadge(status: NightlyStatus): Promise<void> {
  const ready = isNewer(status) ? status.latest : null;
  const failed = status.failure?.broken === true;
  await browser.action.setBadgeText({ text: failed ? '!' : ready === null ? '' : '↑' }).catch(() => undefined);
  if (ready !== null || failed) await browser.action.setBadgeBackgroundColor({ color: failed ? '#cf222e' : BADGE_COLOR }).catch(() => undefined);
  const title = failed ? 'Geld Nightly · an update failed' : ready === null ? 'Geld Nightly' : `Geld Nightly · build ${ready.build} is ready`;
  await browser.action.setTitle({ title }).catch(() => undefined);
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

export async function checkForUpdate(): Promise<NightlyStatus> {
  const before = await nightlyStatusItem.getValue();
  const checkedAt = new Date().toISOString();
  let status: NightlyStatus;
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (before.etag !== null && before.latest !== null) headers['If-None-Match'] = before.etag;
    const response = await fetch(LATEST_RELEASE_URL, { headers, cache: 'no-store' });
    if (response.status === 304) status = await patchStatus({ checkedAt, checkError: null });
    else if (response.status === 403 || response.status === 429) status = await patchStatus({ checkedAt, checkError: 'GitHub is limiting requests. Geld checks again later.' });
    else if (!response.ok) status = await patchStatus({ checkedAt, checkError: `GitHub answered ${response.status}.` });
    else {
      const latest = parseRelease(await response.json());
      status = await patchStatus({
        checkedAt,
        latest,
        etag: response.headers.get('etag'),
        checkError: latest === null ? 'The latest release has no nightly build.' : null,
      });
    }
  } catch (error) {
    status = await patchStatus({ checkedAt, checkError: `Could not reach GitHub: ${message(error)}` });
  }
  await showBadge(status);
  if ((await mode()) === 'automatic' && installsOnItsOwn(status)) void installLatest(false);
  return status;
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

function isDue(status: NightlyStatus, everyMs: number): boolean {
  return status.checkedAt === null || Date.now() - new Date(status.checkedAt).getTime() >= everyMs;
}

/** In Automatic, any GitHub page that finishes loading looks for a build once half an hour has passed since the last look. */
async function onGitHubLoad(): Promise<void> {
  if ((await mode()) !== 'automatic') return;
  if (isDue(await nightlyStatusItem.getValue(), AUTOMATIC_CHECK_MS)) await checkForUpdate();
}

async function scheduleChecks(): Promise<void> {
  const minutes = ((await mode()) === 'automatic' ? AUTOMATIC_CHECK_MS : MANUAL_CHECK_MS) / 60_000;
  if ((await browser.alarms.get(ALARM))?.periodInMinutes === minutes) return;
  await browser.alarms.create(ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
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
    if (change.status === 'complete' && isGitHub(tab.url)) void onGitHubLoad();
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
    if (isNightlyRollbackMessage(request)) {
      void rollBack().then(sendResponse);
      return true;
    }
    return undefined;
  });
  const onLaunch = (): void => {
    void patchStatus({ installing: null }).then(() => checkForUpdate());
  };
  browser.runtime.onStartup.addListener(onLaunch);
  browser.runtime.onInstalled.addListener(onLaunch);
  nightlyPrefsItem.watch(() => {
    void scheduleChecks();
    void checkForUpdate();
  });
  void scheduleChecks();
  void nightlyStatusItem.getValue().then(showBadge);
}
