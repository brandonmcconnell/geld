import type { NightlyFolder, NightlyStatus } from './state';
import { nightlyView } from './view';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
const folder: NightlyFolder = { name: 'geld', downloads: false, connectedAt: minutesAgo(600) };
const release = (build: number): NightlyStatus['latest'] => ({
  tag: `v0.1.2-build.${build}`,
  version: `0.1.2.${build}`,
  build,
  assetName: `geld-0.1.2.${build}-chrome-nightly.zip`,
  assetUrl: 'https://github.com/brandonmcconnell/geld/releases/download/x/y.zip',
  checksumUrl: 'https://github.com/brandonmcconnell/geld/releases/download/x/y.zip.sha256',
  size: 1,
  publishedAt: minutesAgo(5),
  htmlUrl: 'https://github.com/brandonmcconnell/geld/releases',
});
const status = (patch: Partial<NightlyStatus>): NightlyStatus => ({
  checkedAt: null,
  latest: null,
  checkError: null,
  installing: null,
  failure: null,
  lastInstall: null,
  skipped: null,
  backup: null,
  askedTag: null,
  askedAt: null,
  etag: null,
  limitedUntil: null,
  writing: null,
  blocked: null,
  ...patch,
});

describe('nightlyView', () => {
  it('is up to date and says when it last looked', () => {
    expect(nightlyView(status({ latest: release(3301), checkedAt: minutesAgo(5) }), folder, '0.1.2.3301', NOW)).toEqual({
      headline: 'Up to date',
      detail: 'Checked 5 minutes ago.',
      tone: 'ok',
      action: { kind: 'check', label: 'Check now' },
    });
  });

  it('offers a newer build', () => {
    const view = nightlyView(status({ latest: release(3305) }), folder, '0.1.2.3301', NOW);
    expect(view.headline).toBe('Build 3305 is ready');
    expect(view.action).toEqual({ kind: 'install', label: 'Install' });
  });

  it('asks for the folder before anything can install, naming the one the installer wrote', () => {
    const view = nightlyView(status({ latest: release(3305) }), null, '0.1.2.3301', NOW);
    expect(view.action?.kind).toBe('connect');
    expect(nightlyView(status({}), null, '0.1.2.3301', NOW, { installedIn: '/Users/me/Geld Nightly/Work' }).detail).toBe('Connect /Users/me/Geld Nightly/Work so Geld can install builds. Pick it when Chrome asks.');
  });

  it('says why a build Automatic found did not install on its own', () => {
    const blocked = (need: 'folder' | 'permission', at: string): Partial<NightlyStatus> => ({
      latest: release(3305),
      blocked: { version: '0.1.2.3305', need, reason: 'The connected folder is not the one Geld runs from. Connect it again.', at },
    });
    expect(nightlyView(status(blocked('permission', minutesAgo(1))), folder, '0.1.2.3301', NOW)).toEqual({
      headline: 'Build 3305 is ready',
      detail: 'Chrome needs your OK before Geld can write to its folder. Choose Allow on every visit and later builds install on their own.',
      tone: 'ready',
      action: { kind: 'install', label: 'Allow and install' },
    });
    const wrongFolder = nightlyView(status(blocked('folder', minutesAgo(1))), folder, '0.1.2.3301', NOW);
    expect(wrongFolder.detail).toBe('The connected folder is not the one Geld runs from. Connect it again.');
    expect(wrongFolder.action).toEqual({ kind: 'connect', label: 'Connect folder' });
    expect(nightlyView(status(blocked('folder', minutesAgo(601))), folder, '0.1.2.3301', NOW).action?.kind).toBe('install');
    expect(nightlyView(status({ ...blocked('permission', minutesAgo(1)), latest: release(3306) }), folder, '0.1.2.3301', NOW).action?.label).toBe('Install');
  });

  it('promises installs on their own only in Automatic', () => {
    const waiting = status({ latest: release(3305), blocked: { version: '0.1.2.3305', need: 'permission', reason: 'x', at: minutesAgo(1) } });
    expect(nightlyView(waiting, folder, '0.1.2.3301', NOW, { mode: 'manual' }).detail).toBe('Chrome needs your OK before Geld can write to its folder. Choose Allow on every visit and Chrome stops asking.');
  });

  it('shows whichever of a failure and a blocker came later, and a broken folder before both', () => {
    const blocked = { version: '0.1.2.3305', need: 'permission' as const, reason: 'x', at: minutesAgo(5) };
    const failure = (at: string, broken?: true) => ({ version: '0.1.2.3305', stillOn: '0.1.2.3301', reason: 'The download failed (503).', at, restored: true as const, ...(broken === undefined ? {} : { broken }) });
    const view = (patch: Partial<NightlyStatus>) => nightlyView(status({ latest: release(3305), blocked, ...patch }), folder, '0.1.2.3301', NOW).action?.kind;
    expect(view({ failure: failure(minutesAgo(10)) })).toBe('install');
    expect(view({ failure: failure(minutesAgo(1)) })).toBe('retry');
    expect(view({ failure: failure(minutesAgo(10), true) })).toBe('restore');
  });

  it('shows an install under way', () => {
    expect(nightlyView(status({ installing: '0.1.2.3305' }), folder, '0.1.2.3301', NOW).headline).toBe('Installing build 3305…');
    expect(nightlyView(status({ installing: '0.1.2.3300' }), folder, '0.1.2.3301', NOW).headline).toBe('Going back to build 3300…');
  });

  it('names both builds when an update fails and was undone', () => {
    const view = nightlyView(
      status({ latest: release(3305), failure: { version: '0.1.2.3305', stillOn: '0.1.2.3301', reason: 'The browser stopped the download (FILE_NO_SPACE).', at: minutesAgo(1), restored: true } }),
      folder,
      '0.1.2.3301',
      NOW,
    );
    expect(view).toEqual({
      headline: 'Update to build 3305 failed',
      detail: 'Still on build 3301. The browser stopped the download (FILE_NO_SPACE).',
      tone: 'error',
      action: { kind: 'retry', label: 'Try again' },
    });
  });

  it('offers to restore when the old build could not be put back', () => {
    const view = nightlyView(
      status({ latest: release(3305), failure: { version: '0.1.2.3305', stillOn: '0.1.2.3301', reason: 'x', at: minutesAgo(1), broken: true } }),
      folder,
      '0.1.2.3301',
      NOW,
    );
    expect(view.action).toEqual({ kind: 'restore', label: 'Restore build 3301' });
  });

  it('lets an older failure give way to a newer build', () => {
    const view = nightlyView(
      status({ latest: release(3306), failure: { version: '0.1.2.3305', stillOn: '0.1.2.3301', reason: 'x', at: minutesAgo(30), restored: true } }),
      folder,
      '0.1.2.3301',
      NOW,
    );
    expect(view.headline).toBe('Build 3306 is ready');
  });

  it('offers Roll back for a day after an update', () => {
    const updated = status({ latest: release(3305), backup: '0.1.2.3301', lastInstall: { from: '0.1.2.3301', to: '0.1.2.3305', at: minutesAgo(10), method: 'folder' } });
    expect(nightlyView(updated, folder, '0.1.2.3305', NOW)).toEqual({
      headline: 'Up to date',
      detail: 'Updated from build 3301 10 minutes ago.',
      tone: 'ok',
      action: { kind: 'rollback', label: 'Roll back' },
    });
    expect(nightlyView(updated, folder, '0.1.2.3305', NOW + 25 * 3_600_000).action?.kind).toBe('check');
  });

  it('says a rolled-back build waits for the reader', () => {
    const view = nightlyView(
      status({ latest: release(3305), skipped: '0.1.2.3305', lastInstall: { from: '0.1.2.3305', to: '0.1.2.3301', at: minutesAgo(1), method: 'folder', rollback: true } }),
      folder,
      '0.1.2.3301',
      NOW,
    );
    expect(view.detail).toBe('You went back from it, so it waits for you.');
    expect(view.action?.kind).toBe('install');
  });
});
