// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { menuHoldsRebuild } from './panel';

const panelWith = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('a rebuild while one of the panel’s menus is open', () => {
  it('waits for the triage’s agent and Apply menus, a row’s ⋯, grouping and View, as for Request a review', () => {
    for (const kind of ['geld-review__split-menu', '', 'geld-review__grouping', 'geld-review__view', 'geld-review__request']) {
      expect(menuHoldsRebuild(panelWith(`<details class="geld-review__menu ${kind}" open><summary></summary></details>`))).toBe(true);
    }
    expect(menuHoldsRebuild(panelWith('<details class="geld-review__edited-wrap" open><summary></summary></details>'))).toBe(true);
  });

  it('goes ahead with every menu closed, with GitHub’s own menus open, and with the hidden-people menu open', () => {
    expect(menuHoldsRebuild(panelWith('<details class="geld-review__menu geld-review__split-menu"><summary></summary></details>'))).toBe(false);
    expect(menuHoldsRebuild(panelWith('<details class="details-overlay" open><summary></summary></details>'))).toBe(false);
    expect(menuHoldsRebuild(panelWith('<details class="geld-review__menu geld-review__hidden" open><summary></summary></details>'))).toBe(false);
  });
});
