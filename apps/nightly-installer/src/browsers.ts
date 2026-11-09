import path from 'node:path';
import type { NightlyBrowser } from '@geld/core/nightly';

/** The Chromium browsers the installer knows, where each keeps its profiles, and how each is started. */

export type BrowserId =
  | 'chrome'
  | 'chrome-beta'
  | 'chrome-dev'
  | 'chrome-canary'
  | 'chromium'
  | 'edge'
  | 'edge-beta'
  | 'edge-dev'
  | 'edge-canary'
  | 'brave'
  | 'brave-beta'
  | 'brave-nightly'
  | 'helium'
  | 'arc'
  | 'dia'
  | 'comet'
  | 'vivaldi'
  | 'opera'
  | 'opera-gx'
  | 'thorium'
  | 'yandex';
export type Platform = 'darwin' | 'win32' | 'linux';

export interface BrowserInfo {
  readonly id: BrowserId;
  readonly label: string;
  /** Which nightly zip it loads: Edge has its own, the rest take Chrome's. */
  readonly zip: NightlyBrowser;
  readonly extensionsUrl: string;
  /**
   * The user data folder, below Application Support (macOS), %LOCALAPPDATA% or, with `windowsRoaming`, %APPDATA%
   * (Windows) or ~/.config (Linux). The first that exists is used; a platform the browser is not made for is absent.
   */
  readonly userData: Readonly<Partial<Record<Platform, readonly string[]>>>;
  readonly windowsRoaming?: true;
  /** The browser keeps its one profile in the user data folder itself (Opera), not in `Default` below it. */
  readonly rootProfile?: true;
  readonly macApp: string;
  readonly linuxBinaries: readonly string[];
  /** Below Program Files, Program Files (x86) or %LOCALAPPDATA%. */
  readonly windowsExe: readonly string[];
}

const chromium = (info: Omit<BrowserInfo, 'zip' | 'extensionsUrl'> & Partial<Pick<BrowserInfo, 'zip' | 'extensionsUrl'>>): BrowserInfo => ({
  zip: 'chrome',
  extensionsUrl: 'chrome://extensions',
  ...info,
});

export const BROWSERS: readonly BrowserInfo[] = [
  chromium({
    id: 'chrome',
    label: 'Chrome',
    userData: { darwin: ['Google/Chrome'], win32: ['Google/Chrome/User Data'], linux: ['google-chrome'] },
    macApp: 'Google Chrome',
    linuxBinaries: ['google-chrome', 'google-chrome-stable'],
    windowsExe: ['Google/Chrome/Application/chrome.exe'],
  }),
  chromium({
    id: 'chrome-beta',
    label: 'Chrome Beta',
    userData: { darwin: ['Google/Chrome Beta'], win32: ['Google/Chrome Beta/User Data'], linux: ['google-chrome-beta'] },
    macApp: 'Google Chrome Beta',
    linuxBinaries: ['google-chrome-beta'],
    windowsExe: ['Google/Chrome Beta/Application/chrome.exe'],
  }),
  chromium({
    id: 'chrome-dev',
    label: 'Chrome Dev',
    userData: { darwin: ['Google/Chrome Dev'], win32: ['Google/Chrome Dev/User Data'], linux: ['google-chrome-unstable'] },
    macApp: 'Google Chrome Dev',
    linuxBinaries: ['google-chrome-unstable'],
    windowsExe: ['Google/Chrome Dev/Application/chrome.exe'],
  }),
  chromium({
    id: 'chrome-canary',
    label: 'Chrome Canary',
    userData: { darwin: ['Google/Chrome Canary'], win32: ['Google/Chrome SxS/User Data'], linux: ['google-chrome-canary'] },
    macApp: 'Google Chrome Canary',
    linuxBinaries: ['google-chrome-canary'],
    windowsExe: ['Google/Chrome SxS/Application/chrome.exe'],
  }),
  chromium({
    id: 'chromium',
    label: 'Chromium',
    userData: { darwin: ['Chromium'], win32: ['Chromium/User Data'], linux: ['chromium'] },
    macApp: 'Chromium',
    linuxBinaries: ['chromium', 'chromium-browser', 'ungoogled-chromium'],
    windowsExe: ['Chromium/Application/chrome.exe'],
  }),
  ...(
    [
      ['edge', 'Edge', 'Edge', 'microsoft-edge', ['microsoft-edge', 'microsoft-edge-stable']],
      ['edge-beta', 'Edge Beta', 'Edge Beta', 'microsoft-edge-beta', ['microsoft-edge-beta']],
      ['edge-dev', 'Edge Dev', 'Edge Dev', 'microsoft-edge-dev', ['microsoft-edge-dev']],
      ['edge-canary', 'Edge Canary', 'Edge SxS', 'microsoft-edge-canary', ['microsoft-edge-canary']],
    ] as const
  ).map(([id, label, windowsName, linux, binaries]) =>
    chromium({
      id,
      label,
      zip: 'edge',
      extensionsUrl: 'edge://extensions',
      userData: { darwin: [`Microsoft ${label}`], win32: [`Microsoft/${windowsName}/User Data`], linux: [linux] },
      macApp: `Microsoft ${label}`,
      linuxBinaries: binaries,
      windowsExe: [`Microsoft/${windowsName}/Application/msedge.exe`],
    }),
  ),
  ...(
    [
      ['brave', 'Brave', 'Brave-Browser', '', ['brave-browser', 'brave']],
      ['brave-beta', 'Brave Beta', 'Brave-Browser-Beta', ' Beta', ['brave-browser-beta']],
      ['brave-nightly', 'Brave Nightly', 'Brave-Browser-Nightly', ' Nightly', ['brave-browser-nightly']],
    ] as const
  ).map(([id, label, folder, channel, binaries]) =>
    chromium({
      id,
      label,
      extensionsUrl: 'brave://extensions',
      userData: { darwin: [`BraveSoftware/${folder}`], win32: [`BraveSoftware/${folder}/User Data`], linux: [`BraveSoftware/${folder}`] },
      macApp: `Brave Browser${channel}`,
      linuxBinaries: binaries,
      windowsExe: [`BraveSoftware/${folder}/Application/brave.exe`],
    }),
  ),
  chromium({
    id: 'helium',
    label: 'Helium',
    userData: { darwin: ['net.imput.helium'], win32: ['imput/Helium/User Data'], linux: ['net.imput.helium'] },
    macApp: 'Helium',
    linuxBinaries: ['helium', 'helium-browser'],
    windowsExe: ['imput/Helium/Application/chrome.exe'],
  }),
  chromium({
    id: 'arc',
    label: 'Arc',
    userData: { darwin: ['Arc/User Data'] },
    macApp: 'Arc',
    linuxBinaries: [],
    windowsExe: [],
  }),
  chromium({
    id: 'dia',
    label: 'Dia',
    userData: { darwin: ['Dia/User Data'] },
    macApp: 'Dia',
    linuxBinaries: [],
    windowsExe: [],
  }),
  chromium({
    id: 'comet',
    label: 'Comet',
    userData: { darwin: ['Comet'], win32: ['Perplexity/Comet/User Data', 'Comet/User Data'] },
    macApp: 'Comet',
    linuxBinaries: [],
    windowsExe: ['Perplexity/Comet/Application/comet.exe', 'Comet/Application/comet.exe'],
  }),
  chromium({
    id: 'vivaldi',
    label: 'Vivaldi',
    extensionsUrl: 'vivaldi://extensions',
    userData: { darwin: ['Vivaldi'], win32: ['Vivaldi/User Data'], linux: ['vivaldi'] },
    macApp: 'Vivaldi',
    linuxBinaries: ['vivaldi', 'vivaldi-stable'],
    windowsExe: ['Vivaldi/Application/vivaldi.exe'],
  }),
  chromium({
    id: 'opera',
    label: 'Opera',
    extensionsUrl: 'opera://extensions',
    userData: { darwin: ['com.operasoftware.Opera'], win32: ['Opera Software/Opera Stable'], linux: ['opera'] },
    windowsRoaming: true,
    rootProfile: true,
    macApp: 'Opera',
    linuxBinaries: ['opera'],
    windowsExe: ['Programs/Opera/opera.exe'],
  }),
  chromium({
    id: 'opera-gx',
    label: 'Opera GX',
    extensionsUrl: 'opera://extensions',
    userData: { darwin: ['com.operasoftware.OperaGX'], win32: ['Opera Software/Opera GX Stable'] },
    windowsRoaming: true,
    rootProfile: true,
    macApp: 'Opera GX',
    linuxBinaries: [],
    windowsExe: ['Programs/Opera GX/opera.exe'],
  }),
  chromium({
    id: 'thorium',
    label: 'Thorium',
    userData: { darwin: ['Thorium'], win32: ['Thorium/User Data'], linux: ['thorium'] },
    macApp: 'Thorium',
    linuxBinaries: ['thorium-browser', 'thorium'],
    windowsExe: ['Thorium/Application/thorium.exe'],
  }),
  chromium({
    id: 'yandex',
    label: 'Yandex',
    extensionsUrl: 'browser://extensions',
    userData: { darwin: ['Yandex/YandexBrowser'], win32: ['Yandex/YandexBrowser/User Data'], linux: ['yandex-browser'] },
    macApp: 'Yandex',
    linuxBinaries: ['yandex-browser', 'yandex-browser-stable'],
    windowsExe: ['Yandex/YandexBrowser/Application/browser.exe'],
  }),
];

export const BROWSER_IDS: readonly string[] = BROWSERS.map((browser) => browser.id);

export interface Environment {
  readonly platform: Platform;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function pathApi(platform: Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Every place the browser may keep its user data on this platform, most likely first. */
export function userDataDirs(browser: BrowserInfo, { platform, home, env }: Environment): string[] {
  const join = pathApi(platform).join;
  const set = (name: string): string | undefined => (env[name] === '' ? undefined : env[name]);
  const root =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? browser.windowsRoaming === true
          ? (set('APPDATA') ?? join(home, 'AppData', 'Roaming'))
          : (set('LOCALAPPDATA') ?? join(home, 'AppData', 'Local'))
        : (set('XDG_CONFIG_HOME') ?? join(home, '.config'));
  return (browser.userData[platform] ?? []).map((dir) => join(root, ...dir.split('/')));
}

export function windowsExeCandidates(browser: BrowserInfo, { home, env }: Environment): string[] {
  const join = path.win32.join;
  const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')];
  return roots.filter((root): root is string => root !== undefined).flatMap((root) => browser.windowsExe.map((exe) => join(root, ...exe.split('/'))));
}
