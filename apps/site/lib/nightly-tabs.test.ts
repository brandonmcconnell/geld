import { describe, expect, it } from 'vitest';

import { createTabMemory, isNightlyTab, nightlyTabFor } from './nightly-tabs';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

describe('nightlyTabFor', () => {
  it('opens on the tab for the browser in use', () => {
    expect(nightlyTabFor(CHROME, false)).toBe('chrome');
    expect(nightlyTabFor(`${CHROME} Edg/156.0.0.0`, false)).toBe('chrome');
    expect(nightlyTabFor(CHROME, true)).toBe('brave');
    expect(nightlyTabFor(`${CHROME} OPR/120.0.0.0`, false)).toBe('chromium');
    expect(nightlyTabFor(`${CHROME} Vivaldi/7.4`, false)).toBe('chromium');
    expect(nightlyTabFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0', false)).toBe('firefox');
    expect(nightlyTabFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15', false)).toBe(
      'safari',
    );
  });
});

describe('isNightlyTab', () => {
  it('takes only the tab ids, so a page anchor like #updates leaves the tab alone', () => {
    expect(isNightlyTab('brave')).toBe(true);
    expect(isNightlyTab('updates')).toBe(false);
    expect(isNightlyTab(undefined)).toBe(false);
  });
});

describe('createTabMemory', () => {
  it('keeps the chosen browser through section anchors and Back and Forward', () => {
    const tabFor = createTabMemory();
    const guess = (): 'chrome' => 'chrome';
    expect(tabFor('', guess)).toBe('chrome');
    expect(tabFor('#brave', guess)).toBe('brave');
    expect(tabFor('#updates', guess)).toBe('brave');
    expect(tabFor('#brave', guess)).toBe('brave');
    expect(tabFor('#updates', guess)).toBe('brave');
    expect(tabFor('#firefox', guess)).toBe('firefox');
    expect(tabFor('#trouble', guess)).toBe('firefox');
  });

  it('guesses until a tab is chosen, including on a section anchor', () => {
    expect(createTabMemory()('#updates', () => 'safari')).toBe('safari');
  });
});
