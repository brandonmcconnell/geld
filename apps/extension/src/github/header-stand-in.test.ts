// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allCategories, DEFAULT_SETTINGS } from '@geld/core';
import { EMPTY_BREAKDOWN } from './breakdown';
import { applyHeaderStats, ATTR_COUNTS_STAND_IN, branchGroupTotals, countsSkeletonStandIn, findHeaderStatGroups, isCountsStandIn, syncCountsStandIn } from './header-stats';
import { setTabCounts } from './tab-counts';

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
const ZERO = { additions: 0, deletions: 0 };
const REAL_COUNTS =
  '<div class="d-flex flex-items-center gap-1"><span aria-hidden="true" class="f6 fgColor-success text-bold">+22</span><span aria-hidden="true" class="f6 fgColor-danger text-bold">-12</span><span class="sr-only">Lines changed: 22 additions &amp; 12 deletions</span></div>';

describe('syncCountsStandIn', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("stands in GitHub's empty counts wrapper, read as GitHub's counts are", () => {
    header(EMPTY_WRAPPER);
    expect(syncCountsStandIn(ZERO)).toBe(true);
    const groups = findHeaderStatGroups();
    expect(groups).toHaveLength(1);
    expect(isCountsStandIn(groups[0]!.host)).toBe(true);
    expect(groups[0]!.host.parentElement?.className).toContain('rightContentWrapper');
    expect(groups[0]!.original).toMatchObject({ additions: 0, deletions: 0 });
    // Already in place: nothing to do.
    expect(syncCountsStandIn(ZERO)).toBe(false);
  });

  it("gives way to GitHub's own counts, and comes back when they go", () => {
    header(EMPTY_WRAPPER);
    syncCountsStandIn(ZERO);
    const wrapper = document.querySelector('[class*="rightContentWrapper"]')!;
    wrapper.insertAdjacentHTML('beforeend', REAL_COUNTS);
    expect(syncCountsStandIn(ZERO)).toBe(true);
    expect(document.querySelector('[data-geld-counts-stand-in]')).toBeNull();
    expect(findHeaderStatGroups().map((group) => group.original?.additions)).toEqual([22]);
    wrapper.querySelector('.d-flex')!.remove();
    expect(syncCountsStandIn(ZERO)).toBe(true);
    expect(findHeaderStatGroups().every((group) => isCountsStandIn(group.host))).toBe(true);
  });

  it("waits while GitHub's skeleton holds the wrapper, and stands in once it resolves to nothing", () => {
    header('<div class="rightContentWrapper__DE7XPN"><!--$--><div class="skeleton__c5fLaY"></div><!--/$--></div>');
    expect(syncCountsStandIn(ZERO)).toBe(false);
    expect(document.querySelector('[data-geld-counts-stand-in]')).toBeNull();
    document.querySelector('[class*="skeleton"]')!.remove();
    expect(syncCountsStandIn(ZERO)).toBe(true);
    // A skeleton coming back (GitHub suspending again) takes the stand-in away until it resolves.
    document.querySelector('[class*="rightContentWrapper"]')!.insertAdjacentHTML('afterbegin', '<div class="skeleton__c5fLaY"></div>');
    expect(syncCountsStandIn(ZERO)).toBe(true);
    expect(document.querySelector('[data-geld-counts-stand-in]')).toBeNull();
  });

  it('makes a wrapper of its own where GitHub renders none, and leaves when not wanted', () => {
    header(null);
    expect(syncCountsStandIn(ZERO)).toBe(true);
    expect(document.querySelector('.geld-counts-stand > [data-geld-counts-stand-in]')).not.toBeNull();
    expect(syncCountsStandIn(null)).toBe(true);
    expect(document.querySelector('.geld-counts-stand, [data-geld-counts-stand-in]')).toBeNull();
    expect(syncCountsStandIn(null)).toBe(false);
  });

  it("shows Geld's counts in a wrapper GitHub's skeleton left empty, before GitHub's own arrive (mintlify/mint#14204)", () => {
    header(EMPTY_WRAPPER);
    expect(syncCountsStandIn({ additions: 3328, deletions: 2986 })).toBe(true);
    const groups = findHeaderStatGroups();
    expect(groups.map((group) => [isCountsStandIn(group.host), group.original?.additions, group.original?.deletions])).toEqual([[true, 3328, 2986]]);
    expect(document.querySelector('[data-geld-counts-stand-in]')?.textContent).toContain('+3,328');
    // New totals (the diff replacing GitHub's summaries, a push) rebuild it; the same ones leave it be.
    expect(syncCountsStandIn({ additions: 3330, deletions: 2986 })).toBe(true);
    expect(findHeaderStatGroups()[0]?.original?.additions).toBe(3330);
    expect(syncCountsStandIn({ additions: 3330, deletions: 2986 })).toBe(false);
    // GitHub's own counts render: they win, and the stand-in goes.
    document.querySelector('[class*="rightContentWrapper"]')!.insertAdjacentHTML('beforeend', REAL_COUNTS);
    expect(syncCountsStandIn({ additions: 3330, deletions: 2986 })).toBe(true);
    expect(document.querySelector('[data-geld-counts-stand-in]')).toBeNull();
    expect(findHeaderStatGroups().map((group) => group.original?.additions)).toEqual([22]);
  });

  it("holds the counts' place with GitHub's skeleton until Geld's counts are ready, then puts them in its very place", () => {
    // GitHub's skeleton, seen while it holds the wrapper; then GitHub empties the wrapper with its counts still to come.
    header('<div class="rightContentWrapper__DE7XPN"><!--$--><div class="skeleton__c5fLaY rectangular__E8KpBt" style="width:80px"></div><!--/$--></div>');
    expect(syncCountsStandIn('skeleton')).toBe(false);
    document.querySelector('.skeleton__c5fLaY')!.remove();
    expect(syncCountsStandIn('skeleton')).toBe(true);
    const skeleton = countsSkeletonStandIn();
    expect(skeleton?.className).toBe('skeleton__c5fLaY rectangular__E8KpBt');
    expect(skeleton?.style.width).toBe('80px');
    // Nothing for the header pass to read yet, and the wrapper is not GitHub's busy one.
    expect(findHeaderStatGroups()).toEqual([]);
    // Something standing before it (the review group) stays where it is when the counts come.
    const before = document.createElement('span');
    before.setAttribute('data-geld-ui', '');
    skeleton!.before(before);
    expect(syncCountsStandIn({ additions: 22, deletions: 12 })).toBe(true);
    expect(countsSkeletonStandIn()).toBeNull();
    expect(before.nextElementSibling?.getAttribute('data-geld-counts-stand-in')).toBe('22:12');
    expect(findHeaderStatGroups().map((group) => group.original?.additions)).toEqual([22]);
  });

  it('stays out of pages that are not a pull request header', () => {
    document.body.innerHTML = '<div data-component="PageHeader"><div class="prc-PageHeader-Navigation--uLav"><nav class="TabNav__qHkBGx"></nav></div></div>';
    expect(syncCountsStandIn(ZERO)).toBe(false);
    expect(document.querySelector('[data-geld-counts-stand-in]')).toBeNull();
  });
});

describe('applyHeaderStats with nothing hidden', () => {
  it('offers the breakdown on every pass without binding its hover listeners again', () => {
    header(EMPTY_WRAPPER);
    syncCountsStandIn(ZERO);
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

describe("the counts' narrow-screen copy", () => {
  it('stands beside the Overview’s status button, never inside it, since Geld hides that button whole', () => {
    document.body.innerHTML = `
      <div data-component="PageHeader">
        <div data-component="PageHeader.Description"><div class="row d-flex"><button type="button" aria-haspopup="true"><span data-component="StateLabel" data-status="pullOpened">Open</span></button></div></div>
        <div class="prc-PageHeader-Navigation--uLav">${EMPTY_WRAPPER}<div class="flex-auto"><nav class="TabNav__qHkBGx"><a id="prs-files-anchor-tab" href="/o/r/pull/1/changes">Files changed</a></nav></div></div>
      </div>`;
    syncCountsStandIn(ZERO);
    const group = findHeaderStatGroups()[0]!;
    applyHeaderStats(group, EMPTY_BREAKDOWN, allCategories(DEFAULT_SETTINGS), 1);
    const mirror = document.querySelector('.geld-header-mirror');
    expect(mirror?.parentElement?.classList.contains('row')).toBe(true);
    expect(mirror?.closest('button')).toBeNull();
  });
});

/** The new page's header: GitHub's counts beside the branch names, the tab row's wrapper empty, and its bar over the page. */
function overview(slot: string, stuck = false): { branches: Element; tabs: Element; bar: Element } {
  document.body.innerHTML = `
    <div data-testid="diff-comparison-viewer-sticky-header-slot" class="StickyHeaderSlotPersistent__x">
      <div data-testid="diff-comparison-viewer-sticky-header-bar"><div class="miniHeaderInner__x">
        ${stuck ? '<button data-testid="mini-header-tab-switcher-trigger" type="button"></button>' : ''}
        <div class="metadata__x">#1</div>
        <div class="actions__x"><button type="button">Merge status</button><div class="divider__x"></div></div>
      </div></div>
    </div>
    <div data-component="PageHeader">
      <div data-component="PageHeader.Description"><div class="branchGroup__x"><div class="branches__x">main ← topic</div>${slot}</div></div>
      <div class="prc-PageHeader-Navigation--uLav">
        <div class="rightContentWrapper__DE7XPN reducedTopPadding__x"></div>
        <div class="flex-auto"><nav class="prc-UnderlineNav-UnderlineWrapper-x"><a id="prs-files-anchor-tab" href="/o/r/pull/1/changes">Files changed</a></nav></div>
      </div>
    </div>`;
  return {
    branches: document.querySelector('[class*="branchGroup"]')!,
    tabs: document.querySelector('[class*="rightContentWrapper"]')!,
    bar: document.querySelector('[class*="actions"]')!,
  };
}

function stick(on: boolean): void {
  const inner = document.querySelector('[class*="miniHeaderInner"]')!;
  if (on) inner.insertAdjacentHTML('afterbegin', '<button data-testid="mini-header-tab-switcher-trigger" type="button"></button>');
  else inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')?.remove();
}

describe('syncCountsStandIn on the new page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setTabCounts(true);
  });

  afterEach(() => {
    setTabCounts(false);
  });

  it("leaves GitHub's counts beside the branch names out of the header's groups and reads their totals", () => {
    overview(REAL_COUNTS);
    expect(findHeaderStatGroups()).toHaveLength(0);
    expect(branchGroupTotals()).toEqual({ additions: 22, deletions: 12 });
    setTabCounts(false);
    expect(findHeaderStatGroups()).toHaveLength(1);
  });

  it('reads no totals while GitHub shows its skeleton there', () => {
    overview('<div class="skeleton__c5fLaY" style="width: 96px"></div>');
    expect(branchGroupTotals()).toBeNull();
  });

  it('stands at the end of the tab row in Geld’s own skeleton, then turns into counts in its place', () => {
    const { branches, tabs } = overview(REAL_COUNTS);
    expect(syncCountsStandIn('skeleton')).toBe(true);
    const skeleton = countsSkeletonStandIn();
    expect(skeleton?.parentElement).toBe(tabs);
    expect(skeleton?.className).toBe('geld-counts-skeleton');
    expect(tabs.hasAttribute('data-geld-counts-home')).toBe(true);
    expect(syncCountsStandIn('skeleton')).toBe(false);
    expect(syncCountsStandIn(ZERO)).toBe(true);
    const counts = document.querySelector(`[${ATTR_COUNTS_STAND_IN}]`);
    expect(counts === skeleton).toBe(false);
    expect(counts?.parentElement).toBe(tabs);
    expect(branches.querySelector(`[${ATTR_COUNTS_STAND_IN}]`)).toBeNull();
    expect(findHeaderStatGroups().map((group) => isCountsStandIn(group.host))).toEqual([true]);
  });

  it("rides GitHub's bar while its tabs are scrolled under it, the same node, after the review group, and comes back", () => {
    const { tabs, bar } = overview(REAL_COUNTS);
    syncCountsStandIn(ZERO);
    const counts = document.querySelector(`[${ATTR_COUNTS_STAND_IN}]`);
    bar.insertAdjacentHTML('afterbegin', '<span class="geld-quick-review" data-geld-ui></span>');
    stick(true);
    // A move, not a new node: nothing for the header to read again.
    expect(syncCountsStandIn(ZERO)).toBe(false);
    expect(document.querySelector(`[${ATTR_COUNTS_STAND_IN}]`)).toBe(counts);
    expect(counts?.parentElement).toBe(bar);
    expect(counts?.previousElementSibling?.className).toBe('geld-quick-review');
    stick(false);
    expect(syncCountsStandIn(ZERO)).toBe(false);
    expect(counts?.parentElement).toBe(tabs);
  });

  it('stands first in the bar when the page loads scrolled past the tabs', () => {
    const { bar } = overview(REAL_COUNTS, true);
    expect(syncCountsStandIn(ZERO)).toBe(true);
    expect(bar.firstElementChild?.hasAttribute(ATTR_COUNTS_STAND_IN)).toBe(true);
  });

  it('goes when Geld has nothing to show', () => {
    const { tabs } = overview(REAL_COUNTS);
    syncCountsStandIn(ZERO);
    expect(syncCountsStandIn(null)).toBe(true);
    expect(document.querySelector(`[${ATTR_COUNTS_STAND_IN}]`)).toBeNull();
    expect(tabs.hasAttribute('data-geld-counts-home')).toBe(false);
  });
});
