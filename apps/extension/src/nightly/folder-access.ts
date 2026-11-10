/** Brave keeps the folder picker (File System Access) behind a flag, off by default (Brave 1.x, Nov 2026). */
export const BRAVE_FOLDER_FLAG = 'brave://flags/#file-system-access-api';

/** What to do when the browser has no folder picker: a way to turn it on where there is one, else the Downloads install. */
export function folderAccessMissing(isBrave: boolean): string {
  const downloads = 'Or run npx geld-nightly@latest --downloads to reinstall in your Downloads folder, where Geld updates without folder access.';
  return isBrave
    ? `Brave turns off folder access. Open ${BRAVE_FOLDER_FLAG}, set it to Enabled, relaunch Brave and connect again. ${downloads}`
    : `This browser cannot give Geld access to a folder. ${downloads}`;
}
