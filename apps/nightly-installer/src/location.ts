import { BROWSERS, pathApi } from './browsers';
import type { BrowserId, Environment } from './browsers';
import type { Profile } from './profiles';

/**
 * Where nightly builds go: `~/Geld Nightly/<profile>`, one folder per profile, so two profiles never write
 * updates into one folder. Chrome derives an unpacked extension's id from its path, so the folder must stay
 * where it is once loaded, which rules out folders the system empties, moves or syncs, and folders Chrome's
 * own folder picker (the extension's Connect folder) refuses to open.
 */

export const ROOT_NAME = 'Geld Nightly';

export function defaultRoot({ platform, home }: Environment): string {
  return pathApi(platform).join(home, ROOT_NAME);
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitize(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return RESERVED.test(cleaned) ? `${cleaned} profile` : cleaned;
}

export function profileKey(profile: Pick<Profile, 'browser' | 'directory'>): string {
  return `${profile.browser}/${profile.directory}`;
}

/** Each profile's folder name: its own name for Chrome, the browser's name in front for the others, never two alike. */
export function folderNames(profiles: readonly Profile[]): Map<string, string> {
  const label = (browser: BrowserId): string => BROWSERS.find((info) => info.id === browser)?.label ?? browser;
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const profile of profiles) {
    const base = sanitize(profile.browser === 'chrome' ? profile.name : `${label(profile.browser)} ${profile.name}`) || sanitize(profile.directory) || 'Profile';
    let name = base;
    if (taken.has(name.toLowerCase())) name = `${base} (${sanitize(`${label(profile.browser)} ${profile.directory}`)})`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    taken.add(name.toLowerCase());
    names.set(profileKey(profile), name);
  }
  return names;
}

export interface Problem {
  /** `refuse`: the build would break or be lost there. `ask`: it works, but something may move or empty the folder. */
  readonly level: 'refuse' | 'ask';
  readonly reason: string;
}

export interface LocationContext extends Environment {
  readonly tmp: string;
  /** The download folders of the profiles being installed for. */
  readonly downloads: readonly string[];
}

const SYNCED = [/^onedrive\b/i, /^dropbox\b/i, /^google drive$/i, /^my drive$/i, /^icloud drive$/i, /^mobile documents$/i, /^box$/i, /^pcloud drive$/i];

export function locationProblems(dir: string, context: LocationContext): Problem[] {
  const api = pathApi(context.platform);
  const fold = (value: string): string => (context.platform === 'linux' ? value : value.toLowerCase());
  const target = fold(api.resolve(dir));
  const inside = (root: string | undefined): boolean => {
    if (root === undefined || root === '') return false;
    const relation = api.relative(fold(api.resolve(root)), target);
    return relation === '' || (!relation.startsWith('..') && !api.isAbsolute(relation));
  };
  const segments = api.resolve(dir).split(api.sep).filter((part) => part !== '');
  const problems: Problem[] = [];
  const refuse = (reason: string): void => void problems.push({ level: 'refuse', reason });
  const ask = (reason: string): void => void problems.push({ level: 'ask', reason });
  const { home, env } = context;

  if (target === fold(api.resolve(home))) refuse("It is your home folder itself, which Chrome's folder picker will not open.");
  const temps = [context.tmp, env['TEMP'], env['TMP'], ...(context.platform === 'win32' ? [] : ['/tmp', '/var/tmp', '/private/tmp', '/private/var/folders'])];
  if (temps.some(inside)) refuse('It is a temporary folder, which the system empties.');
  if (context.platform === 'darwin' && inside(api.join(home, 'Library'))) refuse("It is inside ~/Library, which Chrome's folder picker will not open.");
  if (segments.some((part) => fold(part) === fold('Application Support'))) refuse("It is inside Application Support, which Chrome's folder picker will not open.");
  if (context.platform === 'win32') {
    if ([env['APPDATA'], env['LOCALAPPDATA'], api.join(home, 'AppData')].some(inside)) refuse("It is inside AppData, which Chrome's folder picker will not open.");
    if ([env['ProgramFiles'], env['ProgramFiles(x86)'], env['SystemRoot']].some(inside)) refuse("It is a system folder, which Chrome's folder picker will not open.");
  } else if (['/usr', '/etc', '/bin', '/sbin', '/System', '/Library'].some(inside)) {
    refuse("It is a system folder, which Chrome's folder picker will not open.");
  }
  if (context.platform === 'linux' && inside(env['XDG_CONFIG_HOME'] ?? api.join(home, '.config'))) {
    refuse("It is inside ~/.config, where Chrome keeps its own data and which its folder picker will not open.");
  }
  if (segments.some((part) => SYNCED.some((pattern) => pattern.test(part))) || inside(env['OneDrive'])) {
    ask('It looks like a synced folder (OneDrive, Dropbox, Google Drive or iCloud). Syncing can lock, move or roll back the files Geld updates.');
  }
  if (context.platform === 'darwin' && [api.join(home, 'Desktop'), api.join(home, 'Documents')].some(inside)) {
    ask('It is in Desktop or Documents, which iCloud syncs when "Desktop & Documents Folders" is on.');
  }
  if (context.downloads.some(inside)) {
    ask('It is in a Downloads folder, which Storage Sense and cleanup tools empty. In return, updates there install with no folder picker.');
  }
  return problems;
}
