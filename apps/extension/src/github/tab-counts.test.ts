// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { applyTabCountsHint, rememberTabCounts, setTabCounts, tabCountsOn, withdrawTabCountsHint } from './tab-counts';

describe('the tab-row counts hint for the first frame', () => {
  afterEach(() => {
    setTabCounts(false);
    window.localStorage.clear();
  });

  it('moves the counts from the first frame on the pull requests of a repository where it did last time', () => {
    rememberTabCounts('Acme/Widgets', true);
    applyTabCountsHint('/acme/widgets/pull/7/commits');
    expect(tabCountsOn()).toBe(true);
    withdrawTabCountsHint();
    expect(tabCountsOn()).toBe(false);
  });

  it('leaves GitHub’s counts alone in a repository where Geld stood down, and off pull request pages', () => {
    rememberTabCounts('acme/widgets', true);
    rememberTabCounts('acme/widgets', false);
    applyTabCountsHint('/acme/widgets/pull/7');
    expect(tabCountsOn()).toBe(false);
    rememberTabCounts('acme/gadgets', true);
    applyTabCountsHint('/acme/gadgets/issues/7');
    expect(tabCountsOn()).toBe(false);
  });

  it('says whether it changed, so the header reads its counts again', () => {
    expect(setTabCounts(true)).toBe(true);
    expect(setTabCounts(true)).toBe(false);
    expect(setTabCounts(false)).toBe(true);
  });
});
