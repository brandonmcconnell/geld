import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { InstallRecord } from '@geld/core/nightly';
import { folderRecord, inspectTarget, readInstalls, recordInstall, sameProfile, writeBuild } from './install';
import { parseArgs, resolvedPath } from './cli';
import { parseChoice } from './prompt';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'geld-installer-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const entry = (p: string, text: string) => ({ path: p, data: new TextEncoder().encode(text) });
const build = (version: string, extra: readonly string[] = []) => {
  const paths = ['manifest.json', 'nightly.html', 'nightly-files.json', ...extra];
  return [
    entry('manifest.json', JSON.stringify({ name: 'Geld Nightly', version })),
    entry('nightly.html', ''),
    entry('nightly-files.json', JSON.stringify({ files: paths })),
    ...extra.map((p) => entry(p, p)),
  ];
};
const record = (folder: string): InstallRecord => ({ folder, installedAt: '2026-11-09T12:00:00Z', version: '0.1.2.1', browser: 'chrome', profile: { directory: 'Default', name: 'Work' }, downloadsName: null });

describe('writeBuild', () => {
  it('writes into a new folder with the install record beside the build', async () => {
    const dir = path.join(root, 'Geld Nightly', 'Work');
    await writeBuild(dir, build('0.1.2.1', ['chunks/a.js']), record(dir));
    expect((await readdir(dir)).sort()).toEqual(['chunks', 'manifest.json', 'nightly-files.json', 'nightly-install.json', 'nightly.html']);
    expect(JSON.parse(await readFile(path.join(dir, 'nightly-install.json'), 'utf8')).folder).toBe(dir);
  });

  it('updates a nightly build in place, dropping what the new build lost', async () => {
    const dir = path.join(root, 'Work');
    await writeBuild(dir, build('0.1.2.1', ['chunks/old.js']), record(dir));
    await writeBuild(dir, build('0.1.2.2', ['chunks/new.js']), record(dir));
    expect(await readdir(path.join(dir, 'chunks'))).toEqual(['new.js']);
    expect(await inspectTarget(dir)).toBe('nightly');
  });

  it('leaves files the reader keeps beside the build', async () => {
    const dir = path.join(root, 'Work');
    await writeBuild(dir, build('0.1.2.1', ['chunks/old.js']), record(dir));
    await writeFile(path.join(dir, 'notes.txt'), 'mine');
    await writeBuild(dir, build('0.1.2.2', ['chunks/new.js']), record(dir));
    expect(await readFile(path.join(dir, 'notes.txt'), 'utf8')).toBe('mine');
    expect(await readdir(path.join(dir, 'chunks'))).toEqual(['new.js']);
  });

  it('repairs a folder its own run was interrupted in, before the manifest was written', async () => {
    const dir = path.join(root, 'Work');
    await mkdir(dir);
    await writeFile(path.join(dir, 'nightly-install.json'), JSON.stringify(record(dir)));
    await writeFile(path.join(dir, 'background.js'), 'half');
    expect(await inspectTarget(dir)).toBe('nightly');
    await writeBuild(dir, build('0.1.2.1'), record(dir));
    expect(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')).version).toBe('0.1.2.1');
    expect((await readdir(dir)).some((name) => name.endsWith('.partial'))).toBe(false);
  });

  it('never writes over a folder that is not a nightly build', async () => {
    const dir = path.join(root, 'Photos');
    await mkdir(dir);
    await writeFile(path.join(dir, 'cat.jpg'), 'meow');
    await expect(writeBuild(dir, build('0.1.2.1'), record(dir))).rejects.toThrow('not Geld Nightly');
    expect(await readdir(dir)).toEqual(['cat.jpg']);
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ name: 'Geld' }));
    expect(await inspectTarget(root)).toBe('other');
  });

  it('waits its turn while the extension holds the lock', async () => {
    const dir = path.join(root, 'Work');
    await writeBuild(dir, build('0.1.2.1'), record(dir));
    await writeFile(path.join(dir, 'nightly-update.lock'), JSON.stringify({ token: 'profile-a', at: Date.now() }));
    await expect(writeBuild(dir, build('0.1.2.2'), record(dir))).rejects.toThrow('installing an update into this folder');
  });

  it('lets only one of two installer runs write a folder at once', async () => {
    const dir = path.join(root, 'Work');
    await writeBuild(dir, build('0.1.2.1'), record(dir));
    const runs = await Promise.allSettled([writeBuild(dir, build('0.1.2.2'), record(dir)), writeBuild(dir, build('0.1.2.3'), record(dir))]);
    expect(runs.filter((run) => run.status === 'fulfilled')).toHaveLength(1);
    expect((await readdir(dir)).some((name) => name.startsWith('nightly-update.lock'))).toBe(false);
  }, 15_000);
});

describe('recordInstall', () => {
  it('keeps one entry per folder in ~/.geld, never in the build folder', async () => {
    const state = path.join(root, '.geld');
    const other = (folder: string): InstallRecord => ({ ...record(folder), profile: { directory: 'Profile 1', name: 'Personal' } });
    await recordInstall(state, record('/a'));
    await recordInstall(state, other('/b'));
    await recordInstall(state, { ...record('/a'), version: '0.1.2.2' });
    const saved = JSON.parse(await readFile(path.join(state, 'nightly.json'), 'utf8'));
    expect(saved.installs.map((install: InstallRecord) => [install.folder, install.version])).toEqual([['/b', '0.1.2.1'], ['/a', '0.1.2.2']]);
    expect((await readInstalls(state)).map((install) => install.folder)).toEqual(['/b', '/a']);
  });

  it('keeps one entry per profile, so a profile moved to another folder is found there', async () => {
    const state = path.join(root, '.geld');
    await recordInstall(state, record('/a'));
    await recordInstall(state, record('/c'));
    expect((await readInstalls(state)).map((install) => install.folder)).toEqual(['/c']);
  });
});

describe('folder ownership', () => {
  it('reads which profile a build folder belongs to', async () => {
    const dir = path.join(root, 'Work');
    await writeBuild(dir, build('0.1.2.1'), record(dir));
    const holder = await folderRecord(dir);
    expect(holder !== null && sameProfile(holder, record(dir))).toBe(true);
    expect(holder !== null && sameProfile(holder, { ...record(dir), profile: { directory: 'Profile 1', name: 'Work' } })).toBe(false);
    expect(await folderRecord(path.join(root, 'nowhere'))).toBeNull();
  });
});

describe('arguments and choices', () => {
  it('reads the options', () => {
    expect(parseArgs(['--profile', 'Work', '--profile', 'Default', '--browser', 'chrome,edge', '--yes'])).toMatchObject({ profiles: ['Work', 'Default'], browsers: ['chrome', 'edge'], yes: true, open: true });
    expect(parseArgs(['--browser', 'safari'])).toMatch('Unknown browser');
    expect(parseArgs(['--dir'])).toMatch('needs a value');
    expect(parseArgs(['--help'])).toBe('help');
  });

  it('reads a pick from the list', () => {
    expect(parseChoice('1,3', 3)).toEqual([0, 2]);
    expect(parseChoice('2-3', 3)).toEqual([1, 2]);
    expect(parseChoice('all', 2)).toEqual([0, 1]);
    expect(parseChoice('4', 3)).toBeNull();
    expect(parseChoice('x', 3)).toBeNull();
  });
});

describe('resolvedPath', () => {
  it('follows a link in the part of the path that exists and keeps the rest as written', async () => {
    const real = path.join(root, 'Dropbox');
    await mkdir(real);
    await symlink(real, path.join(root, 'link'));
    expect(await resolvedPath(path.join(root, 'link', 'Geld Nightly', 'Work'))).toBe(path.join(await realpath(real), 'Geld Nightly', 'Work'));
  });
});
