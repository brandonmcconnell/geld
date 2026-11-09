import { BROWSERS, userDataDirs, windowsExeCandidates } from './browsers';
import type { BrowserInfo } from './browsers';
import { browserProfiles, downloadDirectory, parseLocalState, profileFolder } from './profiles';
import { launchFor } from './system';

const chrome = BROWSERS.find((browser) => browser.id === 'chrome');
const edge = BROWSERS.find((browser) => browser.id === 'edge');

describe('parseLocalState', () => {
  const state = JSON.stringify({
    profile: {
      profiles_order: ['Profile 2', 'Default'],
      info_cache: {
        Default: { name: 'Personal', user_name: 'me@example.com' },
        'Profile 2': { name: 'Work', user_name: '' },
        'Profile 3': { gaia_name: 'Old' },
      },
    },
  });

  it("lists the profiles by name in the browser's own order", () => {
    expect(parseLocalState(state, 'chrome')).toEqual([
      { browser: 'chrome', directory: 'Profile 2', name: 'Work', email: null },
      { browser: 'chrome', directory: 'Default', name: 'Personal', email: 'me@example.com' },
      { browser: 'chrome', directory: 'Profile 3', name: 'Old', email: null },
    ]);
  });

  it('puts Default first when there is no order, and reads nothing from a broken file', () => {
    const unordered = JSON.stringify({ profile: { info_cache: { 'Profile 1': { name: 'B' }, Default: { name: 'A' } } } });
    expect(parseLocalState(unordered, 'edge').map((profile) => profile.directory)).toEqual(['Default', 'Profile 1']);
    expect(parseLocalState('{', 'chrome')).toEqual([]);
    expect(parseLocalState('{"profile":{}}', 'chrome')).toEqual([]);
  });
});

describe('userDataDirs', () => {
  const browser = (id: string): BrowserInfo => {
    const found = BROWSERS.find((info) => info.id === id);
    if (found === undefined) throw new Error(`no ${id}`);
    return found;
  };
  const mac = { platform: 'darwin', home: '/Users/me', env: {} } as const;
  const windows = { platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } } as const;
  const linux = { platform: 'linux', home: '/home/me', env: {} } as const;

  it('finds each browser where it keeps its profiles', () => {
    if (chrome === undefined || edge === undefined) throw new Error('browsers missing');
    expect(userDataDirs(chrome, mac)).toEqual(['/Users/me/Library/Application Support/Google/Chrome']);
    expect(userDataDirs(edge, windows)).toEqual(['C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge\\User Data']);
    expect(userDataDirs(chrome, linux)).toEqual(['/home/me/.config/google-chrome']);
  });

  it('knows browsers that keep it under their bundle id, under User Data, or in Roaming', () => {
    expect(userDataDirs(browser('helium'), mac)).toEqual(['/Users/me/Library/Application Support/net.imput.helium']);
    expect(userDataDirs(browser('helium'), windows)).toEqual(['C:\\Users\\me\\AppData\\Local\\imput\\Helium\\User Data']);
    expect(userDataDirs(browser('helium'), linux)).toEqual(['/home/me/.config/net.imput.helium']);
    expect(userDataDirs(browser('arc'), mac)).toEqual(['/Users/me/Library/Application Support/Arc/User Data']);
    expect(userDataDirs(browser('opera'), windows)).toEqual(['C:\\Users\\me\\AppData\\Roaming\\Opera Software\\Opera Stable']);
    expect(userDataDirs(browser('edge-canary'), windows)).toEqual(['C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge SxS\\User Data']);
  });

  it('reads an empty variable as unset, for profiles and for the executable alike', () => {
    const empty = { platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: '', ProgramFiles: '' } } as const;
    expect(userDataDirs(browser('helium'), empty)).toEqual(['C:\\Users\\me\\AppData\\Local\\imput\\Helium\\User Data']);
    expect(windowsExeCandidates(browser('helium'), empty)).toEqual(['C:\\Users\\me\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe']);
  });

  it('has nowhere to look on a platform the browser is not made for', () => {
    expect(userDataDirs(browser('arc'), linux)).toEqual([]);
  });

  it('gives every browser a distinct id and, per platform, a distinct folder', () => {
    expect(new Set(BROWSERS.map((info) => info.id)).size).toBe(BROWSERS.length);
    for (const environment of [mac, windows, linux]) {
      const dirs = BROWSERS.flatMap((info) => userDataDirs(info, environment));
      expect(new Set(dirs).size).toBe(dirs.length);
    }
  });
});

describe('browserProfiles', () => {
  const opera = BROWSERS.find((info) => info.id === 'opera');

  it("offers Opera's one profile, kept in the user data folder itself, when Local State lists none", () => {
    if (opera === undefined) throw new Error('no opera');
    const [profile, ...rest] = browserProfiles(opera, '{"browser":{}}');
    expect(rest).toEqual([]);
    expect(profile).toEqual({ browser: 'opera', directory: 'Default', name: 'Default', email: null });
    if (profile === undefined) throw new Error('no profile');
    expect(profileFolder(opera, profile)).toEqual([]);
    expect(launchFor(opera, profile.directory, { platform: 'darwin', home: '/Users/me', env: {} })).toEqual({ command: 'open', args: ['-na', 'Opera', '--args'], exits: true });
  });

  it('offers nothing for a browser with profile folders whose Local State lists none', () => {
    if (chrome === undefined) throw new Error('no chrome');
    expect(browserProfiles(chrome, '{"browser":{}}')).toEqual([]);
    expect(profileFolder(chrome, { directory: 'Profile 1' })).toEqual(['Profile 1']);
    expect(launchFor(chrome, 'Profile 1', { platform: 'darwin', home: '/Users/me', env: {} })?.args).toEqual(['-na', 'Google Chrome', '--args', '--profile-directory=Profile 1']);
  });
});

describe('downloadDirectory', () => {
  it("takes the profile's own setting, else the default", () => {
    expect(downloadDirectory(JSON.stringify({ download: { default_directory: '/data/dl' } }), '/home/me/Downloads')).toBe('/data/dl');
    expect(downloadDirectory(null, '/home/me/Downloads')).toBe('/home/me/Downloads');
    expect(downloadDirectory('{', '/home/me/Downloads')).toBe('/home/me/Downloads');
  });
});
