import { BROWSERS, userDataDir } from './browsers';
import { downloadDirectory, parseLocalState } from './profiles';

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

describe('userDataDir', () => {
  it('finds each browser where it keeps its profiles', () => {
    if (chrome === undefined || edge === undefined) throw new Error('browsers missing');
    expect(userDataDir(chrome, { platform: 'darwin', home: '/Users/me', env: {} })).toBe('/Users/me/Library/Application Support/Google/Chrome');
    expect(userDataDir(edge, { platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } })).toBe('C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge\\User Data');
    expect(userDataDir(chrome, { platform: 'linux', home: '/home/me', env: {} })).toBe('/home/me/.config/google-chrome');
  });
});

describe('downloadDirectory', () => {
  it("takes the profile's own setting, else the default", () => {
    expect(downloadDirectory(JSON.stringify({ download: { default_directory: '/data/dl' } }), '/home/me/Downloads')).toBe('/data/dl');
    expect(downloadDirectory(null, '/home/me/Downloads')).toBe('/home/me/Downloads');
    expect(downloadDirectory('{', '/home/me/Downloads')).toBe('/home/me/Downloads');
  });
});
