import { conflictFor, manageUrl, parseDeclaredScripts, STABLE_IDS } from './conflicts';
import { pausedView } from './view';

const SELF = 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm';
const home = 'https://github.com/brandonmcconnell/geld';

describe('conflictFor', () => {
  it('pauses for Geld from either store', () => {
    for (const id of STABLE_IDS) expect(conflictFor(SELF, [{ id, name: 'Geld', enabled: true, type: 'extension' }])).toEqual({ kind: 'stable', id });
  });

  it('pauses for an unpacked store build, known by its name and homepage', () => {
    expect(conflictFor(SELF, [{ id: 'bbbb', name: 'Geld', enabled: true, homepageUrl: `${home}/` }])).toEqual({ kind: 'stable', id: 'bbbb' });
    expect(conflictFor(SELF, [{ id: 'bbbb', name: 'Geld', enabled: true, homepageUrl: 'https://example.com' }])).toBeNull();
  });

  it('ignores a Geld that is turned off, and itself', () => {
    expect(conflictFor(SELF, [{ id: STABLE_IDS[0] ?? '', name: 'Geld', enabled: false }])).toBeNull();
    expect(conflictFor(SELF, [{ id: SELF, name: 'Geld Nightly', enabled: true, homepageUrl: home }])).toBeNull();
  });

  it('lets exactly one of two nightly copies run', () => {
    const low = { id: 'aaaa', name: 'Geld Nightly', enabled: true, homepageUrl: home };
    const high = { id: 'zzzz', name: 'Geld Nightly', enabled: true, homepageUrl: home };
    expect(conflictFor('aaaa', [low, high])).toBeNull();
    expect(conflictFor('zzzz', [low, high])).toEqual({ kind: 'nightly', id: 'aaaa' });
  });

  it('says what to do and where', () => {
    expect(pausedView({ kind: 'stable', id: 'x' }).action).toEqual({ kind: 'manage', label: 'Turn off Geld' });
    expect(manageUrl('abc')).toBe('chrome://extensions/?id=abc');
  });
});

describe('parseDeclaredScripts', () => {
  it('reads the manifest entries the nightly build registers', () => {
    expect(
      parseDeclaredScripts([
        { matches: ['https://github.com/*'], run_at: 'document_start', css: ['content-scripts/github.css'], js: ['content-scripts/github.js'] },
        { matches: ['https://github.com/*'], run_at: 'document_start', js: ['content-scripts/portal.js'], world: 'MAIN' },
      ]),
    ).toEqual([
      { matches: ['https://github.com/*'], js: ['content-scripts/github.js'], css: ['content-scripts/github.css'], runAt: 'document_start', world: 'ISOLATED', allFrames: false },
      { matches: ['https://github.com/*'], js: ['content-scripts/portal.js'], css: [], runAt: 'document_start', world: 'MAIN', allFrames: false },
    ]);
  });

  it('refuses entries it could not register faithfully', () => {
    expect(parseDeclaredScripts([{ matches: [], js: ['a.js'] }])).toBeNull();
    expect(parseDeclaredScripts([{ matches: ['x'], js: ['a.js'], world: 'ELSEWHERE' }])).toBeNull();
    expect(parseDeclaredScripts({})).toBeNull();
  });
});
