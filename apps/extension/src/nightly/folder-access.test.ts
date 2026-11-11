import { BRAVE_FOLDER_FLAG, connectErrorShown, folderAccessMissing, folderHelp } from './folder-access';
import type { NightlyFolder } from './state';

const picked: NightlyFolder = { name: 'Brave Personal', downloads: null, connectedAt: '2026-11-10T12:00:00Z' };
const inDownloads: NightlyFolder = { name: 'Geld Nightly/Brave Personal', downloads: true, connectedAt: '2026-11-10T12:00:00Z' };
const brave = { installedIn: '/Users/me/Geld Nightly/Brave Personal', installedInDownloads: false, hasPicker: false, isBrave: true };

describe('folderAccessMissing', () => {
  it('points Brave to its flag and every browser to the Downloads install', () => {
    expect(folderAccessMissing(true)).toContain(BRAVE_FOLDER_FLAG);
    expect(folderAccessMissing(true)).toContain('--downloads');
    expect(folderAccessMissing(false)).not.toContain('brave://');
    expect(folderAccessMissing(false)).toContain('--downloads');
  });

  it('says to remove the old copy, since two loaded copies pause one of them', () => {
    expect(folderAccessMissing(true)).toContain('remove this copy');
    expect(folderAccessMissing(true)).toContain('Export your settings first');
  });

  it('keeps to the UI copy rules: no em or en dashes and no semicolons', () => {
    for (const text of [folderAccessMissing(true), folderAccessMissing(false)]) expect(text).not.toMatch(/[—–;]/);
  });
});

describe('folderHelp', () => {
  it('says how to get folder access before any click, with no folder connected', () => {
    expect(folderHelp({ ...brave, folder: null })).toBe(folderAccessMissing(true));
  });

  it('keeps the permission help and adds the missing-picker help for a connected folder', () => {
    const help = folderHelp({ ...brave, folder: picked });
    expect(help).toContain('Allow on every visit');
    expect(help).toContain(BRAVE_FOLDER_FLAG);
  });

  it('needs nothing more for a folder in Downloads, which updates without folder access', () => {
    expect(folderHelp({ ...brave, folder: inDownloads })).not.toContain(BRAVE_FOLDER_FLAG);
  });

  it('takes a fresh Downloads install, not yet checked by an update, for what it is', () => {
    const fresh: NightlyFolder = { ...inDownloads, downloads: null };
    expect(folderHelp({ ...brave, installedInDownloads: true, folder: fresh })).toBe(folderHelp({ ...brave, folder: inDownloads }));
    expect(folderHelp({ ...brave, installedInDownloads: true, folder: fresh })).not.toContain('remove this copy');
  });

  it('names the installed folder where the picker works', () => {
    expect(folderHelp({ ...brave, hasPicker: true, folder: null })).toBe('The installer put Geld in /Users/me/Geld Nightly/Brave Personal. Pick that folder.');
  });
});

describe('connectErrorShown', () => {
  it('hides a failed connect the help already explains, and shows any other failure', () => {
    for (const folder of [null, picked]) {
      expect(connectErrorShown(folderAccessMissing(true), folderHelp({ ...brave, folder }))).toBe(false);
    }
    expect(connectErrorShown('Work is not the folder Geld runs from.', folderHelp({ ...brave, folder: null }))).toBe(true);
  });
});
