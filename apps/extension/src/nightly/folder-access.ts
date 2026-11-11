import type { NightlyFolder } from './state';

/** Brave keeps the folder picker (File System Access) behind a flag, off by default (Brave 1.x, Nov 2026). */
export const BRAVE_FOLDER_FLAG = 'brave://flags/#file-system-access-api';

/**
 * What to do when the browser has no folder picker: a way to turn it on where there is one, else the Downloads
 * install. That install is a second unpacked copy with its own id, and two copies pause one of them, so the
 * old copy has to go once the new one is loaded.
 */
export function folderAccessMissing(isBrave: boolean): string {
  const downloads =
    'Or run npx geld-nightly@latest --downloads to install in your Downloads folder, where Geld updates without folder access. Load that folder, then remove this copy on the extensions page. Export your settings first to keep them.';
  return isBrave
    ? `Brave turns off folder access. Open ${BRAVE_FOLDER_FLAG}, set it to Enabled, relaunch Brave and connect again. ${downloads}`
    : `This browser cannot give Geld access to a folder. ${downloads}`;
}

export interface FolderPage {
  readonly folder: NightlyFolder | null;
  /** The folder the installer recorded, to name when none is connected yet. */
  readonly installedIn: string | null;
  readonly hasPicker: boolean;
  readonly isBrave: boolean;
}

/** The help under the folder line, said before any click, including when Connect folder cannot work here. */
export function folderHelp({ folder, installedIn, hasPicker, isBrave }: FolderPage): string {
  const missing = hasPicker ? null : folderAccessMissing(isBrave);
  if (folder === null) {
    if (missing !== null) return missing;
    return installedIn === null ? 'Pick the unzipped folder you loaded with Load unpacked.' : `The installer put Geld in ${installedIn}. Pick that folder.`;
  }
  if (folder.downloads === true) return 'This folder is in your download folder, so Geld can install builds on its own.';
  const allow =
    'When Chrome asks to let Geld edit files, choose Allow on every visit. Installs then run on their own, even after Chrome restarts. With Allow this time, each install asks again.';
  return missing === null ? allow : `${allow} ${missing}`;
}

/** A failed connect says nothing new when the help above already says it, so the error line stays hidden. */
export function connectErrorShown(message: string, help: string): boolean {
  return !help.includes(message);
}
