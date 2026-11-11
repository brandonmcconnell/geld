import { browser } from 'wxt/browser';
import { reportError } from '../lib/error-capture';
import { loadBackup, loadFolderHandle, saveBackup } from './handle-store';
import type { BuildBackup } from './handle-store';
import { isNightlyCheckMessage, isNightlyInstallMessage, isNightlyManageMessage, isNightlyRollbackMessage } from './messages';
import { manageUrl } from './conflicts';
import type { NightlyInstallResult } from './messages';
import { buildOf, buildProblem, claimLock, compareVersions, LATEST_RELEASE_PAGE, LATEST_RELEASE_URL, manifestTextOf, parseChecksum, parseRelease, releaseLock, tagFromReleaseUrl } from '@geld/core/nightly';
import type { NightlyBrowser, NightlyRelease, ZipEntry } from '@geld/core/nightly';
import { BACKGROUND_CHECK_MINUTES, limitedUntil, navigationDue, needsDetails } from './schedule';
import { startPauseWatch } from './pause';
import { nightlyCelebratedItem, nightlyConflictItem, nightlyFolderItem, nightlyPrefsItem, nightlyProfileTokenItem, nightlyStatusItem, readNightlyStatus, nightlyTabCountsItem } from './state';
import type { NightlyFailure, NightlyInstall, NightlyStatus, NightlyWrite, UpdateMode } from './state';
import { decode, sha256Hex, unzip } from './unzip';
import { BUSY, folderLock, readInstallRecord, copyRunningBuild, downloadsReach, downloadsTarget, folderIsOurs, folderPermission, folderTarget, versionOnDisk } from './writers';
import type { BuildTarget } from './writers';
import { NO_BADGE, showIconBadge } from './icon-badge';
import type { IconBadge } from './icon-badge';

/** Background side of nightly builds: looks for a newer release, marks the toolbar icon, installs and rolls back. */

const ALARM = 'geld:nightly-check';
const FAILED_COLOR = '#cf222e';
/** Mirrors the hidden-file badge in background.ts, which hands a nightly build's tab badges to `showTabBadge`. */
const COUNT_COLOR = '#59636e';
/** The reply goes out before the reload, which closes every page that asked for it. */
const RELOAD_DELAY_MS = 300;
/** The download's part of the progress ring; writing the files into the folder is the rest. */
const DOWNLOAD_SHARE = 0.7;
/** How long the check stands on the icon once an update is in. */
const DONE_MS = 3000;
/** The reload after an install starts the next worker within a second or two: an install older than this was not just now. */
const JUST_INSTALLED_MS = 30_000;

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
    const next = { ...(await readNightlyStatus()), ...patch };
    await nightlyStatusItem.setValue(next);
    return next;
  });
  writes = run.catch(() => undefined);
  return run;
}

/** A new build, an update under way and one just done are drawn into the icon (`iconBadgeOf`), so the text badge keeps the tab's count. */
type Mark = '' | '!' | 'OFF';
let mark: Mark = '';
/** The share of the update under way, null while none is. */
let progress: number | null = null;
let done = false;

function markOf(status: NightlyStatus, paused: boolean): Mark {
  return paused ? 'OFF' : status.failure?.broken === true || status.writing !== null ? '!' : '';
}

function iconBadgeOf(status: NightlyStatus, paused: boolean): IconBadge {
  if (paused) return NO_BADGE;
  if (status.installing !== null) return { kind: 'progress', share: progress ?? 0 };
  if (done) return { kind: 'done' };
  if (markOf(status, paused) !== '') return NO_BADGE;
  return isNewer(status) ? { kind: 'available' } : NO_BADGE;
}

function showProgress(share: number): void {
  progress = share;
  showIconBadge({ kind: 'progress', share });
}

/**
 * A tab's own badge (its hidden-file count) hides the global one, so on GitHub, where the reader is, the
 * mark rides on the count. The count's colour stays unless there is a mark.
 */
async function paintTab(tabId: number, count: number): Promise<void> {
  const text = mark === 'OFF' ? mark : `${count > 0 ? count : ''}${mark}`;
  await browser.action.setBadgeText({ tabId, text }).catch(() => undefined);
  if (text === '') return;
  await browser.action.setBadgeBackgroundColor({ tabId, color: mark === '' ? COUNT_COLOR : FAILED_COLOR }).catch(() => undefined);
  await browser.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => undefined);
}

let countWrites: Promise<unknown> | null = null;

/** Tabs update their counts together (a browser start restores many), so each change reads and writes in turn. */
function patchTabCounts(change: (counts: Readonly<Record<string, number>>) => Readonly<Record<string, number>> | null): void {
  const run = (countWrites ?? Promise.resolve()).then(async () => {
    const next = change(await nightlyTabCountsItem.getValue());
    if (next !== null) await nightlyTabCountsItem.setValue(next);
  });
  countWrites = run.catch(() => undefined);
}

export function showTabBadge(tabId: number, count: number): void {
  void paintTab(tabId, count);
  patchTabCounts((counts) => (counts[String(tabId)] === count ? null : { ...counts, [String(tabId)]: count }));
}

function titleOf(status: NightlyStatus, ready: NightlyRelease | null): string {
  if (mark === 'OFF') return 'Geld Nightly · paused while another Geld is on';
  if (status.installing !== null) return `Geld Nightly · installing build ${buildOf(status.installing) ?? status.installing}`;
  if (done) return 'Geld Nightly · updated';
  if (mark === '!') return 'Geld Nightly · an update failed';
  return ready === null ? 'Geld Nightly' : `Geld Nightly · build ${ready.build} is ready`;
}

async function showBadge(status: NightlyStatus): Promise<void> {
  const ready = isNewer(status) ? status.latest : null;
  const paused = (await nightlyConflictItem.getValue()) !== null;
  const next = markOf(status, paused);
  const changed = next !== mark;
  mark = next;
  showIconBadge(iconBadgeOf(status, paused));
  await browser.action.setBadgeText({ text: mark }).catch(() => undefined);
  if (mark !== '') await browser.action.setBadgeBackgroundColor({ color: FAILED_COLOR }).catch(() => undefined);
  await browser.action.setTitle({ title: titleOf(status, ready) }).catch(() => undefined);
  if (!changed) return;
  for (const [tabId, count] of Object.entries(await nightlyTabCountsItem.getValue())) void paintTab(Number(tabId), count);
}

async function mode(): Promise<UpdateMode> {
  return (await nightlyPrefsItem.getValue()).mode;
}

/** What the usage statistics say about this build: its Update setting, and how it came to be running `version` when it wrote that build itself. */
export async function nightlyUsage(version: string): Promise<{ readonly mode: UpdateMode; readonly install: NightlyInstall | null }> {
  const install = (await readNightlyStatus()).lastInstall;
  return { mode: await mode(), install: install?.to === version ? install : null };
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
    if (response.status === 304) return await patchStatus({ ...asked, checkedAt, checkError: null, limitedUntil: null });
    if (response.status === 403 || response.status === 429) {
      const until = limitedUntil(response.headers.get('retry-after'), response.headers.get('x-ratelimit-reset'), Date.now());
      return await patchStatus({ ...asked, checkedAt, limitedUntil: new Date(until).toISOString(), checkError: 'GitHub is limiting requests. Geld checks again later.' });
    }
    if (!response.ok) return await patchStatus({ ...asked, checkedAt, checkError: `GitHub answered ${response.status}.` });
    const latest = parseRelease(await response.json(), nightlyBrowser());
    return await patchStatus({
      ...asked,
      checkedAt,
      latest,
      etag: response.headers.get('etag'),
      limitedUntil: null,
      checkError: latest === null ? 'The latest release has no nightly build.' : null,
    });
  } catch (error) {
    return await patchStatus({ ...asked, checkedAt, checkError: `Could not reach GitHub: ${message(error)}` });
  }
}

async function look(): Promise<NightlyStatus> {
  const checkedAt = new Date().toISOString();
  const tag = await latestTag();
  const before = await readNightlyStatus();
  const status = needsDetails(before, tag, Date.now())
    ? await releaseDetails(before, checkedAt, tag)
    : await patchStatus({ checkedAt, checkError: tag === null || before.limitedUntil !== null ? (before.checkError ?? 'Could not reach GitHub. Geld checks again later.') : null });
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

async function installTarget(): Promise<BuildTarget | Failed> {
  try {
    return await findTarget();
  } catch (error) {
    return { ok: false, reason: `Geld could not use its folder: ${message(error)}`, need: 'folder' };
  }
}

/**
 * Folder access comes first: it also removes files a new build dropped, and once the reader chose
 * "Allow on every visit" Chrome keeps it with no Geld page open, across reloads and restarts.
 */
async function findTarget(): Promise<BuildTarget | Failed> {
  const folder = await nightlyFolderItem.getValue();
  if (folder === null) return { ok: false, reason: 'Connect the folder Geld runs from first.', need: 'folder' };
  // A folder the installer connected (adoptInstallerFolder) has no handle: the downloads route is its only way in.
  const handle = await loadFolderHandle().catch(() => null);
  if (handle !== null && (await folderPermission(handle)) === 'granted') {
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
  if (handle === null) return { ok: false, reason: 'Connect the folder Geld runs from first.', need: 'folder' };
  return { ok: false, reason: 'Geld needs your OK to write to its folder.', need: 'permission' };
}

/** While a write is unfinished (`writing`), every failure is a broken folder that only the saved copy repairs. */
async function fail(reported: NightlyFailure): Promise<Failed> {
  const writing = (await readNightlyStatus()).writing;
  const { restored: _restored, ...unrestored } = reported;
  const failure: NightlyFailure = writing === null ? reported : { ...unrestored, stillOn: writing.whole, broken: true };
  progress = null;
  await patchStatus({ installing: null, failure });
  await showBadge(await readNightlyStatus());
  const stage = failure.broken === true ? 'broken' : failure.restored === true ? 'restored' : 'before writing';
  reportError('background:nightly-update', new Error(`Update to ${failure.version} failed (${stage}): ${failure.reason}`));
  return { ok: false, reason: failure.reason };
}

/** The release names the zip's size, so the download's share is known even when the redirect's answer has no length. */
async function readBody(response: Response, size: number, onShare: (share: number) => void): Promise<Uint8Array> {
  const total = size > 0 ? size : Number(response.headers.get('content-length'));
  const reader = response.body?.getReader();
  if (reader === undefined || !(total > 0)) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    chunks.push(chunk.value);
    received += chunk.value.length;
    onShare(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** The zip is opened only once its SHA-256 matches the one CI published beside it. */
async function downloadBuild(release: NightlyRelease, onShare: (share: number) => void): Promise<ZipEntry[]> {
  const [zip, sums] = await Promise.all([fetch(release.assetUrl, { cache: 'no-store' }), fetch(release.checksumUrl, { cache: 'no-store' })]);
  if (!zip.ok) throw new Error(`The download failed (${zip.status}).`);
  const expected = sums.ok ? parseChecksum(await sums.text(), release.assetName) : null;
  if (expected === null) throw new Error('The release has no checksum for this build.');
  const bytes = await readBody(zip, release.size, onShare);
  if ((await sha256Hex(bytes)) !== expected) throw new Error('The download does not match its checksum.');
  const entries = await unzip(bytes);
  const problem = buildProblem(entries.map((entry) => entry.path), manifestTextOf(entries, decode), release.version);
  if (problem !== null) throw new Error(problem);
  return entries;
}

/**
 * Writes `next` over the running build. A write that breaks off writes `previous` back; a write of
 * `previous` that breaks off too leaves both half there, which the backup in IndexedDB (`whole`) can still repair.
 * `owned` names the files already in the folder that are Geld's. The write is recorded before it begins and
 * cleared only once the folder holds one whole build, so a worker stopped midway leaves the record behind.
 */
async function replace(
  target: BuildTarget,
  next: readonly ZipEntry[],
  previous: BuildBackup,
  whole: string,
  owned: readonly string[],
  version: string,
  onShare: (share: number) => void,
): Promise<NightlyFailure | null> {
  const at = new Date().toISOString();
  const nextPaths = next.map((entry) => entry.path);
  const paths = [...new Set([...owned, ...nextPaths, ...previous.files.map((file) => file.path)])].sort();
  const writing: NightlyWrite = { version, whole, paths };
  await patchStatus({ writing });
  try {
    await target.write(next, owned, (written, total) => onShare(written / total));
    await patchStatus({ writing: null });
    return null;
  } catch (error) {
    const failure = { version, stillOn: previous.version, reason: message(error), at };
    try {
      await target.write(previous.files, [...new Set([...owned, ...nextPaths])]);
      await patchStatus({ writing: null });
      return { ...failure, restored: true };
    } catch {
      return { ...failure, stillOn: whole, broken: true };
    }
  }
}

/**
 * Everything that reads or writes the folder, from the version on disk and the backup copy to the write and its
 * undo, runs under the folder's lock, so another profile's update never lands in the middle of it.
 */
async function underLock(target: BuildTarget, refused: NightlyFailure, run: () => Promise<NightlyInstallResult>): Promise<NightlyInstallResult> {
  const lock = folderLock(target);
  const token = await nightlyProfileTokenItem.getValue();
  if (!(await claimLock(lock, token))) return fail(refused);
  try {
    return await run();
  } finally {
    await releaseLock(lock, token).catch(() => undefined);
  }
}

/** Another profile that loads the same folder may have written this build already: it needs only a reload. */
async function sharedInstall(from: string, to: string, trigger: UpdateMode): Promise<NightlyInstallResult> {
  await patchStatus({ installing: null, failure: null, writing: null, lastInstall: { from, to, at: new Date().toISOString(), method: 'shared', trigger } });
  reloadSoon();
  return { ok: true, version: to };
}

/** The reload resets the icon, so the next worker draws the check again for its full time (`showJustInstalled`). */
function reloadSoon(): void {
  progress = null;
  done = true;
  showIconBadge({ kind: 'done' });
  setTimeout(() => browser.runtime.reload(), RELOAD_DELAY_MS);
}

let running: Promise<NightlyInstallResult> | null = null;

function once(run: () => Promise<NightlyInstallResult>): Promise<NightlyInstallResult> {
  running ??= run()
    .catch(async (error: unknown): Promise<NightlyInstallResult> => {
      progress = null;
      await patchStatus({ installing: null })
        .then(showBadge)
        .catch(() => undefined);
      reportError('background:nightly-update', error);
      return { ok: false, reason: message(error) };
    })
    .finally(() => {
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
  const status = await readNightlyStatus();
  const latest = status.latest;
  const current = installedVersion();
  if (latest === null || !isNewer(status)) return { ok: false, reason: 'Geld is up to date.' };
  if (!explicit && !installsOnItsOwn(status)) return { ok: false, reason: 'Waiting for a newer build.' };
  const trigger: UpdateMode = explicit ? 'manual' : 'automatic';
  // The manifest is written last, so a folder already naming this build holds all of it: no lock or target needed.
  if ((await versionOnDisk()) === latest.version) return sharedInstall(current, latest.version, trigger);
  const target = await installTarget();
  if ('ok' in target) return target;
  progress = 0;
  await showBadge(await patchStatus({ installing: latest.version, failure: null }));
  const failed = (reason: string): NightlyFailure => ({ version: latest.version, stillOn: current, reason, at: new Date().toISOString() });
  let entries: ZipEntry[];
  try {
    entries = await downloadBuild(latest, (share) => showProgress(share * DOWNLOAD_SHARE));
  } catch (error) {
    return fail(failed(message(error)));
  }
  return underLock(target, failed(BUSY), async () => {
    if ((await versionOnDisk()) === latest.version) return sharedInstall(current, latest.version, trigger);
    let previous: BuildBackup;
    try {
      // After a write that did not end whole the folder is half one build, half the other: the backup is the whole old one.
      const kept = status.writing === null ? null : await loadBackup();
      if (status.writing !== null && kept === null) throw new Error(`The saved copy of build ${status.writing.whole} is missing. Unzip the latest nightly build over the folder by hand.`);
      previous = kept ?? (await copyRunningBuild(current));
      if (kept === null) await saveBackup(previous);
    } catch (error) {
      return fail(failed(message(error)));
    }
    const owned = status.writing?.paths ?? previous.files.map((file) => file.path);
    const failure = await replace(target, entries, previous, previous.version, owned, latest.version, (share) => showProgress(DOWNLOAD_SHARE + share * (1 - DOWNLOAD_SHARE)));
    if (failure !== null) return fail(failure);
    await patchStatus({
      installing: null,
      failure: null,
      skipped: explicit ? null : status.skipped,
      backup: previous.version,
      lastInstall: { from: current, to: latest.version, at: new Date().toISOString(), method: target.method, trigger },
    });
    reloadSoon();
    return { ok: true, version: latest.version };
  });
}

async function restorePrevious(): Promise<NightlyInstallResult> {
  const status = await readNightlyStatus();
  const backup = await loadBackup();
  if (backup === null) return { ok: false, reason: 'There is no earlier build to go back to.' };
  const target = await installTarget();
  if ('ok' in target) return target;
  const current = installedVersion();
  const repairing = status.writing !== null;
  progress = 0;
  await showBadge(await patchStatus({ installing: backup.version }));
  return underLock(target, { version: backup.version, stillOn: current, reason: BUSY, at: new Date().toISOString() }, async () => {
    // Repairing, the folder's own files are half written, so there is nothing whole to fall back on.
    const undo = repairing ? backup : await copyRunningBuild(current).catch(() => backup);
    const owned = status.writing?.paths ?? undo.files.map((file) => file.path);
    const failure = await replace(target, backup.files, undo, backup.version, owned, backup.version, showProgress);
    if (failure !== null) return fail(failure);
    await patchStatus({
      installing: null,
      failure: null,
      // A repair leaves the build whose write broke the folder alone, as a failure that was undone would.
      skipped: repairing ? (status.writing?.version ?? status.skipped) : current,
      backup: null,
      lastInstall: { from: current, to: backup.version, at: new Date().toISOString(), method: target.method, rollback: true, trigger: 'manual' },
    });
    reloadSoon();
    return { ok: true, version: backup.version };
  });
}

/** A write left unfinished by a worker Chrome stopped is a broken folder, offered for repair from the saved copy. */
async function settleInterrupted(): Promise<NightlyStatus> {
  const status = await readNightlyStatus();
  const writing = status.writing;
  if (writing === null || status.failure?.broken === true) return patchStatus({ installing: null });
  const failure: NightlyFailure = { version: writing.version, stillOn: writing.whole, reason: `Geld stopped while it was writing build ${buildOf(writing.version) ?? writing.version}.`, at: new Date().toISOString(), broken: true };
  reportError('background:nightly-update', new Error(`Update to ${writing.version} failed (interrupted)`));
  return patchStatus({ installing: null, failure });
}

/** The first worker of a build Geld just wrote shows the check, once: session storage starts empty after the reload. */
async function showJustInstalled(status: NightlyStatus): Promise<void> {
  const install = status.lastInstall;
  if (install === null || install.to !== installedVersion() || !(Date.now() - Date.parse(install.at) < JUST_INSTALLED_MS)) return;
  if ((await nightlyCelebratedItem.getValue()) === install.at) return;
  await nightlyCelebratedItem.setValue(install.at);
  done = true;
  setTimeout(() => {
    done = false;
    void readNightlyStatus().then(showBadge);
  }, DONE_MS);
}

/**
 * A folder the installer put directly in the profile's download folder can be written through the downloads
 * API, which needs no picker, so it is connected from the installer's record. Anywhere else Chrome's folder
 * picker is the only way in, and the panel names the folder to pick.
 */
async function adoptInstallerFolder(): Promise<void> {
  if ((await nightlyFolderItem.getValue()) !== null) return;
  const record = await readInstallRecord();
  if (record?.downloadsName === null || record?.downloadsName === undefined) return;
  await nightlyFolderItem.setValue({ name: record.downloadsName, downloads: null, connectedAt: new Date().toISOString() });
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
    patchTabCounts((counts) => {
      if (!(String(tabId) in counts)) return null;
      const { [String(tabId)]: _closed, ...rest } = counts;
      return rest;
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
  void settleInterrupted().then(async (status) => {
    await showJustInstalled(status).catch(() => undefined);
    await showBadge(status);
  });
  void adoptInstallerFolder();
  void scheduleChecks();
  startPauseWatch();
  nightlyConflictItem.watch(() => void readNightlyStatus().then(showBadge));
}
