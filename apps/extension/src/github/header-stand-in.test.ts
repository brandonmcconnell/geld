// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allCategories, DEFAULT_SETTINGS } from '@geld/core';
import { EMPTY_BREAKDOWN } from './breakdown';
import { applyHeaderStats, findHeaderStatGroups, isCountsStandIn, syncCountsStandIn } from './header-stats';

/** A pull request header's tab row as GitHub renders it, its counts wrapper empty for a change of binary files only. */
function header(wrapper: string | null): void {
  document.body.innerHTML = `
    <div data-component="PageHeader">
      <div class="prc-PageHeader-Navigation--uLav">
        ${wrapper ?? ''}
        <div class="flex-auto"><nav class="TabNav__qHkBGx"><a id="prs-files-anchor-tab" href="/o/r/pull/1/changes">Files changed</a></nav></div>
      </div>
    </div>`;
}

const EMPTY_WRAPPER = '<div class="rightContentWrapper__DE7XPN hideWhenVeryNarrowContainer__gKh_VK"><!--$--><!--/$--></div>';
const REAL_COUNTS =
  '<div class="d-flex flex-items-center gap-1"><span aria-hidden="true" class="f6 fgColor-success text-bold">+22</span><span aria-hidden="true" class="f6 fgColor-danger text-bold">-12</span><span class="sr-only">Lines changed: 22 additions &amp; 12 deletions</span></div>';

describe('syncCountsStandIn', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("stands in GitHub's empty counts wrapper, read as GitHub's counts are", () => {
    header(EMPTY_WRAPPER);
    expect(syncCountsStandIn(true)).toBe(true);
    const groups = findHeaderStatGroups();
    expect(groups).toHaveLength(1);
    expect(isCountsStandIn(groups[0]!.host)).toBe(true);
    expect(groups[0]!.host.parentElement?.className).toContain('rightContentWrapper');
    expect(groups[0]!.original).toMatchObject({ additions: 0, deletions: 0 });
    // Already in place: nothing to do.
    expect(syncCountsStandIn(true)).toBe(false);
  });

  it("gives way to GitHub's own counts, and comes back when they go", () => {
    header(EMPTY_WRAPPER);
    syncCountsStandIn(true);
    const wrapper = document.querySelector('[class*="rightContentWrapper"]')!;
    wrapper.insertAdjacentHTML('beforeend', REAL_COUNTS);
    expect(syncCountsStandIn(true)).toBe(true);
    expect(document.querySelector('[data-geld-counts-stand-in]')).toBeNull();
    expect(findHeaderStatGroups().map((group) => group.original?.additions)).toEqual([22]);
    wrapper.querySelector('.d-flex')!.remove();
    expect(syncCountsStandIn(true)).toBe(true);
    expect(findHeaderStatGroups().every((group) => isCountsStandIn(group.host))).toBe(true);
  });

  it('makes a wrapper of its own where GitHub renders none, and leaves when not wanted', () => {
    header(null);
    expect(syncCountsStandIn(true)).toBe(true);
    expect(document.querySelector('.geld-counts-stand > [data-geld-counts-stand-in]')).not.toBeNull();
    expect(syncCountsStandIn(false)).toBe(true);
    expect(document.querySelector('.geld-counts-stand, [data-geld-counts-stand-in]')).toBeNull();
    expect(syncCountsStandIn(false)).toBe(false);
  });

  it('stays out of pages that are not a pull request header', () => {
    document.body.innerHTML = '<div data-component="PageHeader"><div class="prc-PageHeader-Navigation--uLav"><nav class="TabNav__qHkBGx"></nav></div></div>';
    expect(syncCountsStandIn(true)).toBe(false);
    expect(document.querySelector('[data-geld-counts-stand-in]')).toBeNull();
  });
});

describe('applyHeaderStats with nothing hidden', () => {
  it('offers the breakdown on every pass without binding its hover listeners again', () => {
    header(EMPTY_WRAPPER);
    syncCountsStandIn(true);
    const group = findHeaderStatGroups()[0]!;
    const bind = vi.spyOn(group.host, 'addEventListener');
    const categories = allCategories(DEFAULT_SETTINGS);
    for (let pass = 0; pass < 3; pass += 1) applyHeaderStats(group, EMPTY_BREAKDOWN, categories, 1);
    expect(bind.mock.calls.filter(([type]) => type === 'mouseenter')).toHaveLength(1);
    expect(group.host.querySelector('[data-geld-tooltip-anchor]')).not.toBeNull();
    // A change of nothing at all has nothing to read: no tooltip.
    applyHeaderStats(group, EMPTY_BREAKDOWN, categories, 0);
    expect(group.host.querySelector('[data-geld-tooltip-anchor]')).toBeNull();
  });
});
