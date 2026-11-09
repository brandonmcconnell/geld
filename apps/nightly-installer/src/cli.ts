import { readFile, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { InstallRecord, NightlyBrowser, NightlyRelease, ZipEntry } from '@geld/core/nightly';
import { BROWSERS, pathApi, userDataDir } from './browsers';
import type { BrowserInfo, Environment, Platform } from './browsers';
import { folderRecord, inspectTarget, readInstalls, recordInstall, sameProfile, writeBuild } from './install';
import { defaultRoot, folderNames, locationProblems, profileKey, ROOT_NAME } from './location';
import { downloadDirectory, parseLocalState } from './profiles';
import type { Profile } from './profiles';
import { ask, confirm, interactive, parseChoice } from './prompt';
import { download, latestRelease, pickBuild, verifiedEntries } from './release';
import { banner } from './logo';
import { step, terminalOf } from './spinner';
import type { Terminal } from './spinner';
import { copyToClipboard, launchFor, open } from './system';

declare const INSTALLER_VERSION: string;

const HELP = `geld-nightly: installs Geld Nightly for the Chrome, Chrome Beta, Edge or Brave profiles you pick.

Usage: npx geld-nightly [options]

  --profile <name>       A profile to install for, by name or folder (repeatable). Default: ask.
  --all                  Every profile found.
  --browser <id>         Only chrome, chrome-beta, edge or brave (repeatable).
  --dir <folder>         Where the build folders go. Default: ~/${ROOT_NAME}.
  --downloads            Put them in the profile's Downloads folder instead, where updates
                         need no folder picker but cleanup tools may empty the folder.
  --yes                  Answer yes to warnings about the folder.
  --no-open              Do not open the browser or wait between profiles.
  --verify-attestation   Also check GitHub's build attestation (needs the gh CLI, signed in).
  --help, --version
`;

interface Options {
  readonly profiles: readonly string[];
  readonly all: boolean;
  readonly browsers: readonly string[];
  readonly dir: string | null;
  readonly downloads: boolean;
  readonly yes: boolean;
  readonly open: boolean;
  readonly attestation: boolean;
}

export function parseArgs(argv: readonly string[]): Options | 'help' | 'version' | string {
  const profiles: string[] = [];
  const browsers: string[] = [];
  let dir: string | null = null;
  const flags = { all: false, downloads: false, yes: false, open: true, attestation: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const value = (): string | null => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i++;
      return next;
    };
    if (arg === '--help' || arg === '-h') return 'help';
    if (arg === '--version' || arg === '-v') return 'version';
    if (arg === '--all') flags.all = true;
    else if (arg === '--downloads') flags.downloads = true;
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--no-open') flags.open = false;
    else if (arg === '--verify-attestation') flags.attestation = true;
    else if (arg === '--profile' || arg === '--browser' || arg === '--dir') {
      const given = value();
      if (given === null) return `${arg} needs a value.`;
      if (arg === '--profile') profiles.push(given);
      else if (arg === '--browser') browsers.push(...given.split(','));
      else dir = given;
    } else return `Unknown option ${arg}. See --help.`;
  }
  const unknown = browsers.find((id) => !BROWSERS.some((browser) => browser.id === id));
  if (unknown !== undefined) return `Unknown browser ${unknown}. Use chrome, chrome-beta, edge or brave.`;
  return { ...flags, profiles, browsers, dir };
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

interface Found extends Profile {
  readonly info: BrowserInfo;
  readonly downloads: string;
}

/** The path with every link in its existing part resolved; the part that does not exist yet is kept as written. */
export async function resolvedPath(dir: string): Promise<string> {
  const tail: string[] = [];
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    try {
      return path.join(await realpath(at), ...tail.reverse());
    } catch {
      if (path.dirname(at) === at) return path.resolve(dir);
      tail.push(path.basename(at));
    }
  }
}

async function findProfiles(environment: Environment, browsers: readonly string[]): Promise<Found[]> {
  const found: Found[] = [];
  const api = pathApi(environment.platform);
  for (const info of BROWSERS) {
    if (browsers.length > 0 && !browsers.includes(info.id)) continue;
    const root = userDataDir(info, environment);
    const state = await readText(api.join(root, 'Local State'));
    if (state === null) continue;
    for (const profile of parseLocalState(state, info.id)) {
      const preferences = await readText(api.join(root, profile.directory, 'Preferences'));
      found.push({ ...profile, info, downloads: downloadDirectory(preferences, api.join(environment.home, 'Downloads')) });
    }
  }
  return found;
}

function describe(profile: Found): string {
  return `${profile.info.label} · ${profile.name}${profile.email === null ? '' : ` (${profile.email})`}`;
}

async function choose(found: readonly Found[], options: Options): Promise<Found[]> {
  if (options.all) return [...found];
  if (options.profiles.length > 0) {
    const wanted = options.profiles.map((name) => name.toLowerCase());
    const picked = found.filter((profile) => wanted.includes(profile.name.toLowerCase()) || wanted.includes(profile.directory.toLowerCase()));
    if (picked.length === 0) throw new Error(`No profile named ${options.profiles.join(', ')}. Run without --profile to see them.`);
    return picked;
  }
  if (found.length === 1 || !interactive) return found.slice(0, 1);
  console.log('Profiles found:');
  found.forEach((profile, index) => console.log(`  ${index + 1}. ${describe(profile)}`));
  for (;;) {
    const picked = parseChoice(await ask('Install for which? Numbers like 1,3, or all [1]: ', '1'), found.length);
    if (picked !== null) return picked.map((index) => found[index]).filter((profile): profile is Found => profile !== undefined);
    console.log('Pick numbers from the list, like 1 or 1,3, or type all.');
  }
}

function attest(file: string): void {
  const result = spawnSync('gh', ['attestation', 'verify', file, '--repo', 'brandonmcconnell/geld'], { stdio: 'inherit' });
  if (result.error !== undefined) throw new Error('--verify-attestation needs the GitHub CLI (gh).');
  if (result.status !== 0) throw new Error(`GitHub could not verify the attestation for ${path.basename(file)}.`);
}

/** Downloads, checks and unzips each zip once, however many profiles take it; the zip itself is deleted straight away. */
async function buildsFor(terminal: Terminal, kinds: ReadonlySet<NightlyBrowser>, stateDir: string, attestation: boolean): Promise<Map<NightlyBrowser, { readonly build: NightlyRelease; readonly entries: ZipEntry[] }>> {
  const release = await step(terminal, 'Finding the latest nightly build', () => latestRelease(fetch));
  const builds = new Map<NightlyBrowser, { readonly build: NightlyRelease; readonly entries: ZipEntry[] }>();
  const downloads = path.join(stateDir, 'downloads');
  await mkdir(downloads, { recursive: true });
  for (const kind of kinds) {
    const build = pickBuild(release, kind);
    const [zip, sums] = await step(terminal, `Downloading ${build.assetName}`, () => Promise.all([download(fetch, build.assetUrl), download(fetch, build.checksumUrl)]));
    const file = path.join(downloads, build.assetName);
    await writeFile(file, zip);
    try {
      if (attestation) attest(file);
      const entries = await step(terminal, `Checking build ${build.build} against its checksum`, () => verifiedEntries(build, zip, new TextDecoder().decode(sums)));
      builds.set(kind, { build, entries });
    } finally {
      await rm(file, { force: true });
    }
  }
  return builds;
}

/** `inDownloads`: the extension connects such a folder on its own (from nightly-install.json), so step 4 is not needed. */
function steps(profile: Found, dir: string, copied: boolean, opened: boolean, platform: Platform, last: boolean, inDownloads: boolean): string[] {
  const pickHint = platform === 'darwin' ? 'press Cmd+Shift+G, paste, and press Return' : 'paste it into the path box (Ctrl+L on Linux)';
  return [
    '',
    `${describe(profile)}`,
    opened ? `  ${profile.info.label} is open in this profile.` : `  Open ${profile.info.label} in this profile.`,
    `  1. Go to ${profile.info.extensionsUrl} (type it in the address bar) and turn on Developer mode, top right.`,
    '  2. Click Load unpacked.',
    copied ? `  3. Pick this folder. Its path is on your clipboard, so ${pickHint}:` : '  3. Pick this folder:',
    `     ${dir}`,
    ...(inDownloads ? [] : ['  4. Click the Geld Nightly toolbar icon, then Connect folder, and pick the same folder when Chrome asks.']),
    ...(last ? [] : ['']),
  ];
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options === 'help' || options === 'version') {
    console.log(options === 'help' ? HELP : INSTALLER_VERSION);
    return 0;
  }
  if (typeof options === 'string') {
    console.error(options);
    return 2;
  }
  const platform: Platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
  const environment: Environment = { platform, home: os.homedir(), env: process.env };
  const api = pathApi(platform);
  const stateDir = api.join(environment.home, '.geld');
  const terminal = terminalOf(process.stdout, process.env, process.platform);
  if (terminal.isTTY) console.log(`\n${banner(terminal.columns, `Geld Nightly installer ${INSTALLER_VERSION}`).join('\n')}\n`);

  const found = await findProfiles(environment, options.browsers);
  if (found.length === 0) {
    console.error('No Chrome, Chrome Beta, Edge or Brave profiles were found. Open the browser once, then run this again.');
    return 1;
  }
  const chosen = await choose(found, options);
  const installs = await readInstalls(stateDir);
  const owner = (profile: Found): Pick<InstallRecord, 'browser' | 'profile'> => ({ browser: profile.info.id, profile: { directory: profile.directory, name: profile.name } });
  // Named from every profile found, not only the ones picked, so a profile's folder never depends on the selection.
  const names = folderNames(found);
  const rootFor = (profile: Found): string =>
    options.dir !== null ? api.resolve(options.dir) : options.downloads ? api.join(profile.downloads, ROOT_NAME) : defaultRoot(environment);
  const targets = chosen.map((profile) => {
    const saved = options.dir === null && !options.downloads ? installs.find((known) => sameProfile(known, owner(profile))) : undefined;
    return { profile, dir: saved?.folder ?? api.join(rootFor(profile), names.get(profileKey(profile)) ?? profile.directory) };
  });

  for (const { profile, dir } of targets) {
    const holder = (await folderRecord(dir)) ?? installs.find((known) => known.folder === dir) ?? null;
    if (holder !== null && !sameProfile(holder, owner(profile))) {
      console.error(`${dir} holds the Geld Nightly build of another profile (${holder.profile.name}). Pick another folder with --dir.`);
      return 1;
    }
    const context = { ...environment, tmp: os.tmpdir(), downloads: chosen.map((profile) => profile.downloads) };
    // A link can hide where the files really go (a synced or temporary folder), so both paths are checked.
    const real = await resolvedPath(dir);
    const problems = [...locationProblems(dir, context), ...(real === dir ? [] : locationProblems(real, context))].filter(
      (problem, index, all) => all.findIndex((other) => other.reason === problem.reason) === index,
    );
    const refused = problems.filter((problem) => problem.level === 'refuse');
    if (refused.length > 0) {
      console.error(`Geld will not install into ${dir}.`);
      for (const problem of refused) console.error(`  ${problem.reason}`);
      return 1;
    }
    for (const problem of problems) console.log(`Note about ${dir}: ${problem.reason}`);
    if (problems.length > 0 && !options.yes && !(await confirm('Use it anyway?', false))) return 1;
    if ((await inspectTarget(dir)) === 'other') {
      console.error(`${dir} already holds something that is not Geld Nightly, and Geld never writes over it. Pick another folder with --dir.`);
      return 1;
    }
  }

  const inDownloads = new Set<string>();
  const builds = await buildsFor(terminal, new Set(chosen.map((profile) => profile.info.zip)), stateDir, options.attestation);
  for (const { profile, dir } of targets) {
    const ready = builds.get(profile.info.zip);
    if (ready === undefined) continue;
    const inside = api.relative(profile.downloads, dir);
    const record: InstallRecord = {
      folder: dir,
      installedAt: new Date().toISOString(),
      version: ready.build.version,
      browser: profile.info.id,
      profile: { directory: profile.directory, name: profile.name },
      downloadsName: inside !== '' && !inside.startsWith('..') && !api.isAbsolute(inside) ? inside.split(api.sep).join('/') : null,
    };
    if (record.downloadsName !== null) inDownloads.add(dir);
    await step(terminal, `Installing build ${ready.build.build} into ${dir}`, async () => {
      await writeBuild(dir, ready.entries, record);
      await recordInstall(stateDir, record);
    });
  }

  if (!options.open) {
    for (const { profile, dir } of targets) console.log(steps(profile, dir, false, false, platform, true, inDownloads.has(dir)).join('\n'));
  } else {
    for (const [index, { profile, dir }] of targets.entries()) {
      const copied = copyToClipboard(dir, platform);
      const launch = launchFor(profile.info, profile.directory, environment);
      const opened = launch !== null && (await open(launch));
      const last = index === targets.length - 1;
      console.log(steps(profile, dir, copied, opened, platform, last, inDownloads.has(dir)).join('\n'));
      if (!last) await ask('Press Enter for the next profile. ', '');
    }
  }
  console.log('\nDo not move or rename these folders after loading them: Chrome ties the extension to its folder path.');
  console.log('Run geld-nightly again any time to repair a folder. Updates after this install themselves.');
  return 0;
}
