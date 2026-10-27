// @vitest-environment happy-dom
import { BUNDLED_CATALOG } from '@geld/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { surfacesOf } from './list-surfaces';
import type { ListSurface } from './list-surfaces';

/**
 * GitHub's CSS-module class names come in two shapes: `Component-module__name--hash`
 * until Oct 2026 and `name__hash` since. The bundled surfaces must own the same rows
 * and anchor their chips in the same place under either, and the list surface must
 * leave the stack UIs' rows to theirs. Fixtures are the markup as GitHub renders it,
 * reduced to what the specs read.
 */

const SHAPES = {
  old: {
    description: 'Description-module__container--a1b2c',
    stackPopover: 'StackState-module__popover--d3e4f',
    stackList: 'StackList-module__list--g5h6i',
    expandableWrapper: 'MergeBoxExpandable-module__expandableWrapper--j7k8l',
    checksHeader: 'MergeBoxSectionHeader-module__wrapper--m9n0o',
  },
  new: {
    description: 'container__W45oI6 description__mZjLFE',
    stackPopover: 'stackNavList__tnBSrW',
    stackList: 'stackNavList__IqxYcP',
    expandableWrapper: 'expandableWrapper__noG29t isExpanded__BtNx4K',
    checksHeader: 'wrapper__OsSk1Y wrapperCanExpand__SEVqPM',
  },
} as const;

type Shape = (typeof SHAPES)[keyof typeof SHAPES];

function reactListRow(shape: Shape): string {
  return `<ul><li id="issue_12934-list-view-node-1" role="listitem">
    <a data-testid="listitem-title-link" href="/mintlify/mint/pull/12934">fix: titles</a>
    <div class="${shape.description}">#12934 · <a data-testid="author-filter-link" aria-label="Filter by author hunterchen7" href="/pulls?q=author%3Ahunterchen7">hunterchen7</a> opened Oct 14, 2026</div>
  </li></ul>`;
}

function stackPopover(shape: Shape): string {
  // The new shape: a nav inside a Primer AnchoredOverlay; the old: the StackState wrapper.
  const open = shape === SHAPES.new ? `<div class="prc-AnchoredOverlay-AnchoredOverlay-fYg9Z prc-Overlay-Overlay-jfs-T"><nav class="${shape.stackPopover}">` : `<div class="${shape.stackPopover}"><nav>`;
  return `${open}<ul data-component="ActionList">
    <li data-component="ActionList.Item"><a href="/mintlify/mint/pull/12780">refactor: node titles</a><span data-component="ActionList.Description">#12780 · refactor/node-title</span></li>
  </ul></nav></div>`;
}

function stackList(shape: Shape): string {
  const open = shape === SHAPES.new ? `<nav class="${shape.stackList}" aria-label="Stacked pull requests list">` : `<div class="${shape.stackList}"><nav>`;
  const close = shape === SHAPES.new ? '</nav>' : '</nav></div>';
  return `${open}<ul data-component="ActionList">
    <li data-component="ActionList.Item"><a href="/mintlify/mint/pull/12778">fix: git page titles</a><span data-component="ActionList.Description">#12778 · fix/agent-tool</span></li>
  </ul>${close}`;
}

function checksSection(shape: Shape): string {
  return `<section aria-label="Checks">
    <div class="${shape.checksHeader}"><h3>Some checks were not successful</h3><button aria-label="Collapse checks"></button></div>
    <div class="${shape.expandableWrapper}"><div>4 failing checks</div></div>
  </section>`;
}

function ownerOf(surfaces: readonly ListSurface[], link: HTMLAnchorElement): { id: string; row: HTMLElement } | null {
  for (const surface of surfaces) {
    const row = surface.rowOf(link);
    if (row !== null) return { id: surface.id, row };
  }
  return null;
}

describe('bundled list surfaces under both shapes of GitHub\u2019s class names', () => {
  const surfaces = surfacesOf(BUNDLED_CATALOG);

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`${name}: the React list owns its rows and anchors the chip on the description line`, () => {
      document.body.innerHTML = reactListRow(shape);
      const link = document.querySelector<HTMLAnchorElement>('a[data-testid="listitem-title-link"]');
      if (link === null) throw new Error('fixture has no title link');
      const owner = ownerOf(surfaces, link);
      expect(owner?.id).toBe('react-list');
      if (owner === null) return;
      const anchor = surfaces.find((surface) => surface.id === 'react-list')?.chipAnchor(owner.row, '12934');
      expect(anchor?.placement).toBe('append');
      expect(anchor?.element.className).toBe(shape.description);
      expect(surfaces.find((surface) => surface.id === 'react-list')?.authorOf(owner.row)).toBe('hunterchen7');
    });

    it(`${name}: the Stack popover's rows are the popover surface's, never the list's`, () => {
      document.body.innerHTML = stackPopover(shape);
      const link = document.querySelector<HTMLAnchorElement>('a[href="/mintlify/mint/pull/12780"]');
      if (link === null) throw new Error('fixture has no link');
      const owner = ownerOf(surfaces, link);
      expect(owner?.id).toBe('stack-popover');
      if (owner === null) return;
      const anchor = surfaces.find((surface) => surface.id === 'stack-popover')?.chipAnchor(owner.row, '12780');
      expect(anchor?.placement).toBe('prepend');
      expect(anchor?.element.getAttribute('data-component')).toBe('ActionList.Description');
    });

    it(`${name}: the merge box's stack list rows are the stack-list surface's`, () => {
      document.body.innerHTML = stackList(shape);
      const link = document.querySelector<HTMLAnchorElement>('a[href="/mintlify/mint/pull/12778"]');
      if (link === null) throw new Error('fixture has no link');
      const owner = ownerOf(surfaces, link);
      expect(owner?.id).toBe('stack-list');
      if (owner === null) return;
      expect(surfaces.find((surface) => surface.id === 'stack-list')?.chipAnchor(owner.row, '12778')?.placement).toBe('append');
    });

    it(`${name}: the Checks section's expandable wrapper and header are found by the slot's hooks`, () => {
      document.body.innerHTML = checksSection(shape);
      const section = document.querySelector('section[aria-label="Checks"]');
      if (section === null) throw new Error('fixture has no section');
      // What `quickViewFor(CHECKS_KEY)` loans (the list without the header) and what the stylesheet hides.
      expect(section.querySelector('[class*="expandableWrapper"]')?.textContent).toContain('4 failing checks');
      const header = section.querySelector('[class*="MergeBoxSectionHeader-module__wrapper"], section[aria-label="Checks"] > :has(> button[aria-label$="checks" i])');
      expect(header?.textContent).toContain('Some checks were not successful');
    });
  }

  it('an ActionList item outside any stack belongs to no surface', () => {
    document.body.innerHTML = `<ul data-component="ActionList"><li data-component="ActionList.Item"><a href="/mintlify/mint/pull/1">elsewhere</a></li></ul>`;
    const link = document.querySelector<HTMLAnchorElement>('a');
    if (link === null) throw new Error('fixture has no link');
    // `li[role="listitem"]` is what the React list claims; a bare ActionList item is not one.
    expect(ownerOf(surfaces, link)).toBeNull();
  });
});
