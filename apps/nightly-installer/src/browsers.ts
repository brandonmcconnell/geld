import path from 'node:path';
import type { NightlyBrowser } from '@geld/core/nightly';

/** The Chromium browsers the installer knows, where each keeps its profiles, and how each is started. */

export type BrowserId = 'chrome' | 'chrome-beta' | 'edge' | 'brave';
export type Platform = 'darwin' | 'win32' | 'linux';

export interface BrowserInfo {
  readonly id: BrowserId;
  readonly label: string;
  /** Which nightly zip it loads: Edge has its own, the rest take Chrome's. */
  readonly zip: NightlyBrowser;
  readonly extensionsUrl: string;
  /** The user data folder, below Application Support (macOS), %LOCALAPPDATA% (Windows) or ~/.config (Linux). */
  readonly userData: Readonly<Record<Platform, string>>;
  readonly macApp: string;
  readonly linuxBinaries: readonly string[];
  /** Below Program Files, Program Files (x86) or %LOCALAPPDATA%. */
  readonly windowsExe: string;
}

export const BROWSERS: readonly BrowserInfo[] = [
  {
    id: 'chrome',
    label: 'Chrome',
    zip: 'chrome',
    extensionsUrl: 'chrome://extensions',
    userData: { darwin: 'Google/Chrome', win32: 'Google/Chrome/User Data', linux: 'google-chrome' },
    macApp: 'Google Chrome',
    linuxBinaries: ['google-chrome', 'google-chrome-stable'],
    windowsExe: 'Google/Chrome/Application/chrome.exe',
  },
  {
    id: 'chrome-beta',
    label: 'Chrome Beta',
    zip: 'chrome',
    extensionsUrl: 'chrome://extensions',
    userData: { darwin: 'Google/Chrome Beta', win32: 'Google/Chrome Beta/User Data', linux: 'google-chrome-beta' },
    macApp: 'Google Chrome Beta',
    linuxBinaries: ['google-chrome-beta'],
    windowsExe: 'Google/Chrome Beta/Application/chrome.exe',
  },
  {
    id: 'edge',
    label: 'Edge',
    zip: 'edge',
    extensionsUrl: 'edge://extensions',
    userData: { darwin: 'Microsoft Edge', win32: 'Microsoft/Edge/User Data', linux: 'microsoft-edge' },
    macApp: 'Microsoft Edge',
    linuxBinaries: ['microsoft-edge', 'microsoft-edge-stable'],
    windowsExe: 'Microsoft/Edge/Application/msedge.exe',
  },
  {
    id: 'brave',
    label: 'Brave',
    zip: 'chrome',
    extensionsUrl: 'brave://extensions',
    userData: { darwin: 'BraveSoftware/Brave-Browser', win32: 'BraveSoftware/Brave-Browser/User Data', linux: 'BraveSoftware/Brave-Browser' },
    macApp: 'Brave Browser',
    linuxBinaries: ['brave-browser', 'brave'],
    windowsExe: 'BraveSoftware/Brave-Browser/Application/brave.exe',
  },
];

export interface Environment {
  readonly platform: Platform;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function pathApi(platform: Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function userDataDir(browser: BrowserInfo, { platform, home, env }: Environment): string {
  const join = pathApi(platform).join;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', ...browser.userData.darwin.split('/'));
  if (platform === 'win32') return join(env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), ...browser.userData.win32.split('/'));
  return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), ...browser.userData.linux.split('/'));
}

export function windowsExeCandidates(browser: BrowserInfo, { home, env }: Environment): string[] {
  const join = path.win32.join;
  const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')];
  return roots.filter((root): root is string => root !== undefined).map((root) => join(root, ...browser.windowsExe.split('/')));
}
