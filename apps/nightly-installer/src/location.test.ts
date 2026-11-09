import { defaultRoot, folderNames, locationProblems, profileKey } from './location';
import type { LocationContext } from './location';

const mac: LocationContext = { platform: 'darwin', home: '/Users/me', env: {}, tmp: '/var/folders/xy/T', downloads: ['/Users/me/Downloads'] };
const windows: LocationContext = {
  platform: 'win32',
  home: 'C:\\Users\\me',
  env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'C:\\Program Files', OneDrive: 'C:\\Users\\me\\OneDrive' },
  tmp: 'C:\\Users\\me\\AppData\\Local\\Temp',
  downloads: ['C:\\Users\\me\\Downloads'],
};
const linux: LocationContext = { platform: 'linux', home: '/home/me', env: {}, tmp: '/tmp', downloads: ['/home/me/Downloads'] };
const levels = (dir: string, context: LocationContext): string[] => locationProblems(dir, context).map((problem) => problem.level);

describe('locationProblems', () => {
  it('takes the default folder on every system', () => {
    expect(locationProblems(defaultRoot(mac), mac)).toEqual([]);
    expect(locationProblems(`${defaultRoot(windows)}\\Work`, windows)).toEqual([]);
    expect(locationProblems(`${defaultRoot(linux)}/Work`, linux)).toEqual([]);
  });

  it("refuses folders Chrome's picker will not open, and temporary ones", () => {
    expect(levels('/Users/me/Library/Geld', mac)).toContain('refuse');
    expect(levels('/Users/me/Library/Application Support/Geld', mac)).toContain('refuse');
    expect(levels('C:\\Users\\me\\AppData\\Local\\Geld', windows)).toContain('refuse');
    expect(levels('C:\\Program Files\\Geld', windows)).toContain('refuse');
    expect(levels('/tmp/geld', linux)).toContain('refuse');
    expect(levels('/var/folders/xy/T/geld', mac)).toContain('refuse');
    expect(levels('/Users/me', mac)).toContain('refuse');
    expect(levels('/home/me/.config/geld', linux)).toContain('refuse');
  });

  it('asks before synced folders and Downloads', () => {
    expect(levels('/Users/me/Documents/Geld', mac)).toEqual(['ask']);
    expect(levels('C:\\Users\\me\\OneDrive\\Geld', windows)).toEqual(['ask']);
    expect(levels('/home/me/Dropbox/Geld', linux)).toEqual(['ask']);
    expect(levels('/Users/me/Downloads/Geld Nightly/Work', mac)).toEqual(['ask']);
  });

  it('compares case-insensitively where the file system does', () => {
    expect(levels('/users/ME/library/geld', mac)).toContain('refuse');
    expect(levels('c:\\program files\\geld', windows)).toContain('refuse');
  });
});

describe('folderNames', () => {
  it('names each folder after its profile, never two alike', () => {
    const names = folderNames([
      { browser: 'chrome', directory: 'Default', name: 'Work', email: null },
      { browser: 'chrome', directory: 'Profile 1', name: 'Work', email: null },
      { browser: 'edge', directory: 'Default', name: 'Personal', email: null },
      { browser: 'chrome', directory: 'Profile 2', name: 'Client: A/B?', email: null },
      { browser: 'chrome', directory: 'Profile 3', name: 'con', email: null },
    ]);
    expect([...names.values()]).toEqual(['Work', 'Work (Chrome Profile 1)', 'Edge Personal', 'Client A B', 'con profile']);
    expect(names.get(profileKey({ browser: 'edge', directory: 'Default' }))).toBe('Edge Personal');
  });
});
