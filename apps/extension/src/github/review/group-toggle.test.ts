// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { GroupId } from './panel';
import { syncPanelGroups } from './panel';

function panel(openRow: boolean): void {
  document.body.innerHTML = `
    <section class="geld-review" data-geld-review-panel>
      <ul class="geld-review__rows">
        <li class="geld-review__group" data-group="open"><button class="geld-review__group-btn" aria-expanded="true"></button></li>
        <li class="geld-review__row" data-geld-in-group="open" id="round-2"></li>
        <li class="geld-review__group" data-group="done"><button class="geld-review__group-btn" aria-expanded="false"></button></li>
        <li class="geld-review__row" data-geld-in-group="done" id="round-1" hidden ${openRow ? 'data-open' : ''}></li>
        <li class="geld-review__row" data-geld-in-group="done" id="round-0" hidden></li>
      </ul>
    </section>`;
}

const button = (group: GroupId): string | null | undefined => document.querySelector(`[data-group="${group}"] > button`)?.getAttribute('aria-expanded');
const hidden = (id: string): boolean | undefined => document.getElementById(id)?.hasAttribute('hidden');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('folding a digest group', () => {
  it('shows and hides the rows already built, with no render', () => {
    panel(false);
    expect(syncPanelGroups(new Set(), 'done')).toBe(true);
    expect(button('done')).toBe('true');
    expect(hidden('round-1')).toBe(false);
    expect(hidden('round-0')).toBe(false);
    expect(hidden('round-2')).toBe(false);

    expect(syncPanelGroups(new Set<GroupId>(['done', 'open']), 'open')).toBe(true);
    expect(button('open')).toBe('false');
    expect(hidden('round-2')).toBe(true);
    expect(hidden('round-1')).toBe(true);
  });

  it('asks for a render when the group holds the open row, whose slot only a render adds or takes away', () => {
    panel(true);
    expect(syncPanelGroups(new Set(), 'done')).toBe(false);
    // The rows are shown at once all the same.
    expect(hidden('round-1')).toBe(false);
    expect(syncPanelGroups(new Set(), 'open')).toBe(true);
  });

  it('asks for a render when no panel is mounted', () => {
    expect(syncPanelGroups(new Set(), 'done')).toBe(false);
  });
});
