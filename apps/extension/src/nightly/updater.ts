import { browser } from 'wxt/browser';
import { buildProblem } from './build-check';
import { loadFolderHandle } from './handle-store';
import { isNightlyCheckMessage, isNightlyInstallMessage } from './messages';
import type { NightlyInstallResult } from './messages';
import { compareVersions, LATEST_RELEASE_URL, parseRelease } from './release';
import { nightlyFolderItem, nightlyPrefsItem, nightlyStatusItem } from './state';
import type { InstallMethod, NightlyStatus } from './state';
import { unzip } from './unzip';
import { downloadsReach, folderIsOurs, folderPermission, writeToFolder, writeWithDownloads } from './writers';

/** Background side of nightly builds: checks the latest release, marks the toolbar icon, installs. */

const ALARM = 'geld:nightly-check';
const BADGE_COLOR = '#1a7f37';
/** The install's reply goes out before the reload, which closes every page that asked for it. */
const RELOAD_DELAY_MS = 300;

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
  await browser.action.setBadgeText({ text: ready === null ? '' : '↑' }).catch(() => undefined);
  if (ready !== null) await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => undefined);
  const title = ready === null ? 'Geld Nightly' : `Geld Nightly · build ${ready.build} is ready`;
  await browser.action.setTitle({ title }).catch(() => undefined);
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
  if (isNewer(status) && status.installing === null && (await nightlyPrefsItem.getValue()).auto) void installLatest();
  return status;
}

type Method =
  | { readonly kind: 'folder'; readonly handle: FileSystemDirectoryHandle }
  | { readonly kind: 'downloads'; readonly folder: string };

/**
 * Folder access comes first: it also removes files a new build dropped, and once the reader chose
 * "Allow on every visit" Chrome keeps it with no Geld page open, across reloads and restarts.
 */
async function installMethod(): Promise<Method | Exclude<NightlyInstallResult, { ok: true }>> {
  const folder = await nightlyFolderItem.getValue();
  const handle = folder === null ? null : await loadFolderHandle().catch(() => null);
  if (folder === null || handle === null) return { ok: false, reason: 'Connect the folder Geld runs from first.', need: 'folder' };
  if ((await folderPermission(handle)) === 'granted') return { kind: 'folder', handle };
  let downloads = folder.downloads;
  if (downloads === null) {
    downloads = await downloadsReach(folder.name);
    await nightlyFolderItem.setValue({ ...folder, downloads });
  }
  if (downloads) return { kind: 'downloads', folder: folder.name };
  return { ok: false, reason: 'Geld needs your OK to write to its folder.', need: 'permission' };
}

let running: Promise<NightlyInstallResult> | null = null;

export function installLatest(): Promise<NightlyInstallResult> {
  running ??= install().finally(() => {
    running = null;
  });
  return running;
}

async function install(): Promise<NightlyInstallResult> {
  const status = await nightlyStatusItem.getValue();
  const latest = status.latest;
  if (latest === null || !isNewer(status)) return { ok: false, reason: 'Geld is up to date.' };
  const method = await installMethod();
  if ('ok' in method) return method;
  await patchStatus({ installing: latest.version, installError: null });
  try {
    const response = await fetch(latest.assetUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`The download failed (${response.status}).`);
    const entries = await unzip(new Uint8Array(await response.arrayBuffer()));
    const problem = buildProblem(entries, latest.version);
    if (problem !== null) throw new Error(problem);
    const via: InstallMethod = method.kind;
    if (method.kind === 'folder') {
      if (!(await folderIsOurs(method.handle))) throw new Error('The connected folder is not the one Geld runs from. Connect it again.');
      await writeToFolder(method.handle, entries);
    } else {
      if (!(await downloadsReach(method.folder))) throw new Error('Geld can no longer reach its folder in Downloads. Connect it again.');
      await writeWithDownloads(method.folder, entries);
    }
    await patchStatus({
      installing: null,
      installError: null,
      lastInstall: { from: installedVersion(), to: latest.version, at: new Date().toISOString(), method: via },
    });
    setTimeout(() => browser.runtime.reload(), RELOAD_DELAY_MS);
    return { ok: true, version: latest.version };
  } catch (error) {
    await patchStatus({ installing: null, installError: message(error) });
    return { ok: false, reason: message(error) };
  }
}

async function scheduleChecks(): Promise<void> {
  const { intervalMinutes } = await nightlyPrefsItem.getValue();
  const existing = await browser.alarms.get(ALARM);
  if (existing?.periodInMinutes === intervalMinutes) return;
  await browser.alarms.create(ALARM, { periodInMinutes: intervalMinutes, delayInMinutes: intervalMinutes });
}

export function startNightly(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void checkForUpdate();
  });
  browser.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
    if (isNightlyCheckMessage(request)) {
      void checkForUpdate().then(sendResponse);
      return true;
    }
    if (isNightlyInstallMessage(request)) {
      void installLatest().then(sendResponse);
      return true;
    }
    return undefined;
  });
  const onLaunch = (): void => {
    void patchStatus({ installing: null }).then(() => checkForUpdate());
  };
  browser.runtime.onStartup.addListener(onLaunch);
  browser.runtime.onInstalled.addListener(onLaunch);
  nightlyPrefsItem.watch(() => void scheduleChecks());
  void scheduleChecks();
  void nightlyStatusItem.getValue().then(showBadge);
}

