import { browser } from 'wxt/browser';
import { installErrorCapture } from '../../src/lib/error-capture';
import { loadFolderHandle, saveFolderHandle } from '../../src/nightly/handle-store';
import { isNightlyInstallResult } from '../../src/nightly/messages';
import type { NightlyCheckMessage, NightlyInstallMessage } from '../../src/nightly/messages';
import { buildOf, compareVersions } from '../../src/nightly/release';
import { CHECK_INTERVALS, nightlyFolderItem, nightlyPrefsItem, nightlyStatusItem } from '../../src/nightly/state';
import type { NightlyFolder, NightlyPrefs, NightlyStatus } from '../../src/nightly/state';
import { folderIsOurs, folderPermission } from '../../src/nightly/writers';

installErrorCapture('options');

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id}`);
  return element;
}

const installed = byId('installed', HTMLSpanElement);
const latestLine = byId('latest', HTMLSpanElement);
const checked = byId('checked', HTMLParagraphElement);
const lastInstall = byId('last-install', HTMLParagraphElement);
const errorLine = byId('error', HTMLParagraphElement);
const installButton = byId('install', HTMLButtonElement);
const checkButton = byId('check', HTMLButtonElement);
const notes = byId('notes', HTMLAnchorElement);
const folderLine = byId('folder', HTMLParagraphElement);
const folderHelp = byId('folder-help', HTMLParagraphElement);
const connectButton = byId('connect', HTMLButtonElement);
const autoSwitch = byId('auto', HTMLButtonElement);
const autoHelp = byId('auto-help', HTMLParagraphElement);
const intervalSelect = byId('interval', HTMLSelectElement);

const version = browser.runtime.getManifest().version;
let localError: string | null = null;
let busy = false;

function label(v: string): string {
  const build = buildOf(v);
  return build === null ? v : `build ${build}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Number.isNaN(seconds)) return '';
  if (Math.abs(seconds) < 60) return relative.format(Math.round(seconds), 'second');
  if (Math.abs(seconds) < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

function intervalLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} minutes` : minutes === 60 ? 'hour' : `${minutes / 60} hours`;
}

function render(status: NightlyStatus, folder: NightlyFolder | null, prefs: NightlyPrefs): void {
  installed.textContent = `Geld Nightly ${version}`;
  const latest = status.latest;
  const newer = latest !== null && compareVersions(latest.version, version) > 0;
  latestLine.textContent = latest === null ? '' : newer ? `· build ${latest.build} is ready` : '· up to date';
  checked.textContent = status.checkedAt === null ? 'Not checked yet.' : `Checked ${ago(status.checkedAt)}.`;

  const install = status.lastInstall;
  lastInstall.hidden = install === null || install.to !== version;
  if (install !== null) lastInstall.textContent = `Updated from ${label(install.from)} ${ago(install.at)}.`;

  const error = localError ?? status.installError ?? status.checkError;
  errorLine.hidden = error === null;
  errorLine.textContent = error ?? '';

  const installing = status.installing !== null;
  installButton.hidden = !newer && !installing;
  installButton.disabled = installing || busy;
  installButton.textContent = installing ? `Installing build ${buildOf(status.installing ?? '') ?? ''}…` : latest === null ? '' : `Install build ${latest.build}`;
  checkButton.disabled = busy || installing;
  notes.hidden = latest === null || !newer;
  if (latest !== null) notes.href = latest.htmlUrl;

  folderLine.textContent = folder === null ? 'No folder connected.' : folder.downloads === true ? `Downloads/${folder.name}` : folder.name;
  folderHelp.textContent =
    folder === null
      ? 'Pick the unzipped folder you loaded with Load unpacked.'
      : folder.downloads === true
        ? 'This folder is in your download folder, so Geld can install builds on its own.'
        : 'When Chrome asks to let Geld edit files, choose Allow on every visit. Installs then run on their own, even after Chrome restarts. With Allow this time, each install asks again.';
  connectButton.textContent = folder === null ? 'Connect folder' : 'Connect another folder';
  connectButton.disabled = busy;

  autoSwitch.setAttribute('aria-checked', String(prefs.auto));
  autoHelp.textContent = 'Geld installs a new build when it finds one and reloads. Open GitHub tabs pick it up on their own. When Geld cannot write to its folder without asking, the toolbar icon shows ↑ instead.';
  if (intervalSelect.options.length === 0) {
    for (const minutes of CHECK_INTERVALS) intervalSelect.append(new Option(intervalLabel(minutes), String(minutes)));
  }
  intervalSelect.value = String(prefs.intervalMinutes);
}

async function refresh(): Promise<void> {
  render(await nightlyStatusItem.getValue(), await nightlyFolderItem.getValue(), await nightlyPrefsItem.getValue());
}

async function withBusy(run: () => Promise<void>): Promise<void> {
  busy = true;
  localError = null;
  await refresh();
  try {
    await run();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) localError = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    await refresh();
  }
}

/** Asks for the folder, then proves it is the one Geld runs from before keeping it. */
async function connectFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (window.showDirectoryPicker === undefined) throw new Error('This browser cannot give Geld access to a folder.');
  const handle = await window.showDirectoryPicker({ id: 'geld-nightly', mode: 'readwrite' });
  if (!(await folderIsOurs(handle))) {
    localError = `${handle.name} is not the folder Geld runs from. Pick the folder you chose in Load unpacked.`;
    return null;
  }
  await saveFolderHandle(handle);
  await nightlyFolderItem.setValue({ name: handle.name, downloads: null, connectedAt: new Date().toISOString() });
  return handle;
}

async function install(): Promise<void> {
  let folder = await nightlyFolderItem.getValue();
  let handle = folder === null ? null : await loadFolderHandle();
  if (folder === null || handle === null) {
    handle = await connectFolder();
    folder = await nightlyFolderItem.getValue();
    if (handle === null || folder === null) return;
  }
  // Declined, the background can still write through the downloads API when the folder is in Downloads.
  if ((await folderPermission(handle)) !== 'granted') await handle.requestPermission?.({ mode: 'readwrite' });
  const request: NightlyInstallMessage = { type: 'geld:nightly-install' };
  const result: unknown = await browser.runtime.sendMessage(request);
  if (!isNightlyInstallResult(result)) localError = 'Geld did not answer. Try again.';
  else if (!result.ok) localError = result.reason;
}

installButton.addEventListener('click', () => void withBusy(install));
connectButton.addEventListener('click', () => void withBusy(async () => void (await connectFolder())));
checkButton.addEventListener('click', () =>
  void withBusy(async () => {
    const request: NightlyCheckMessage = { type: 'geld:nightly-check' };
    await browser.runtime.sendMessage(request);
  }),
);
autoSwitch.addEventListener('click', () =>
  void nightlyPrefsItem.getValue().then((prefs) => nightlyPrefsItem.setValue({ ...prefs, auto: !prefs.auto })),
);
intervalSelect.addEventListener('change', () => {
  const minutes = CHECK_INTERVALS.find((value) => String(value) === intervalSelect.value);
  if (minutes !== undefined) void nightlyPrefsItem.getValue().then((prefs) => nightlyPrefsItem.setValue({ ...prefs, intervalMinutes: minutes }));
});

nightlyStatusItem.watch(() => void refresh());
nightlyFolderItem.watch(() => void refresh());
nightlyPrefsItem.watch(() => void refresh());
setInterval(() => void refresh(), 30_000);
void refresh();
