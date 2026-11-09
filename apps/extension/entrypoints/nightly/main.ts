import { browser } from 'wxt/browser';
import { installErrorCapture } from '../../src/lib/error-capture';
import { loadFolderHandle, saveFolderHandle } from '../../src/nightly/handle-store';
import { isNightlyInstallResult } from '../../src/nightly/messages';
import type { NightlyCheckMessage, NightlyInstallMessage, NightlyRollbackMessage } from '../../src/nightly/messages';
import { mountNightlyPanel } from '../../src/nightly/panel';
import { nightlyFolderItem } from '../../src/nightly/state';
import type { NightlyFolder } from '../../src/nightly/state';
import type { NightlyAction } from '../../src/nightly/view';
import { folderIsOurs, folderPermission, readInstallRecord } from '../../src/nightly/writers';

installErrorCapture('options');

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id}`);
  return element;
}

const panel = byId('panel', HTMLDivElement);
const folderLine = byId('folder', HTMLParagraphElement);
const folderHelp = byId('folder-help', HTMLParagraphElement);
const folderError = byId('folder-error', HTMLParagraphElement);
const connectButton = byId('connect', HTMLButtonElement);

/** Asks for the folder, then proves it is the one Geld runs from before keeping it. */
async function connectFolder(): Promise<FileSystemDirectoryHandle> {
  if (window.showDirectoryPicker === undefined) throw new Error('This browser cannot give Geld access to a folder.');
  const handle = await window.showDirectoryPicker({ id: 'geld-nightly', mode: 'readwrite' });
  if (!(await folderIsOurs(handle))) throw new Error(`${handle.name} is not the folder Geld runs from. Pick the folder you chose in Load unpacked.`);
  await saveFolderHandle(handle);
  await nightlyFolderItem.setValue({ name: handle.name, downloads: null, connectedAt: new Date().toISOString() });
  return handle;
}

/** The click that asked is what lets Chrome show its prompt, so access is asked for here before the background writes. */
async function ensureAccess(): Promise<void> {
  const folder = await nightlyFolderItem.getValue();
  const handle = folder === null ? null : await loadFolderHandle();
  // A folder the installer connected in Downloads has no handle and needs none: the background writes it through the downloads API.
  if (folder !== null && handle === null && folder.downloads !== false) return;
  if (handle === null) {
    await connectFolder();
    return;
  }
  // Declined, the background can still write through the downloads API when the folder is in Downloads.
  if ((await folderPermission(handle)) !== 'granted') await handle.requestPermission?.({ mode: 'readwrite' });
}

async function act(kind: NightlyAction): Promise<string | null> {
  if (kind === 'connect') {
    await connectFolder();
    return null;
  }
  if (kind === 'check') {
    const request: NightlyCheckMessage = { type: 'geld:nightly-check' };
    await browser.runtime.sendMessage(request);
    return null;
  }
  await ensureAccess();
  const request: NightlyInstallMessage | NightlyRollbackMessage = { type: kind === 'install' || kind === 'retry' ? 'geld:nightly-install' : 'geld:nightly-rollback' };
  const result: unknown = await browser.runtime.sendMessage(request);
  if (!isNightlyInstallResult(result)) return 'Geld did not answer. Try again.';
  return result.ok ? null : result.reason;
}

let installedIn: string | null = null;

function renderFolder(folder: NightlyFolder | null): void {
  folderLine.textContent = folder === null ? 'No folder connected.' : folder.downloads === true ? `Downloads/${folder.name}` : folder.name;
  folderHelp.textContent =
    folder === null
      ? installedIn === null
        ? 'Pick the unzipped folder you loaded with Load unpacked.'
        : `The installer put Geld in ${installedIn}. Pick that folder.`
      : folder.downloads === true
        ? 'This folder is in your download folder, so Geld can install builds on its own.'
        : 'When Chrome asks to let Geld edit files, choose Allow on every visit. Installs then run on their own, even after Chrome restarts. With Allow this time, each install asks again.';
  connectButton.textContent = folder === null ? 'Connect folder' : 'Connect another folder';
}

connectButton.addEventListener('click', () => {
  folderError.hidden = true;
  connectButton.disabled = true;
  void connectFolder()
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      folderError.textContent = error instanceof Error ? error.message : String(error);
      folderError.hidden = false;
    })
    .finally(() => {
      connectButton.disabled = false;
    });
});

mountNightlyPanel(panel, act);
nightlyFolderItem.watch(renderFolder);
void readInstallRecord().then(async (record) => {
  installedIn = record?.folder ?? null;
  renderFolder(await nightlyFolderItem.getValue());
});
