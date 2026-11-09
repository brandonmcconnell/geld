// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { BlockedBy } from './blocked-list';
import { applyBlockedListHiding, removeBlockedListHiding } from './blocked-lists';

/** A discussions list as GitHub serves it (Nov 2026, names replaced): `li.Box-row`s, each led by its title, then its author. */
function discussionsList(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <ul class="list-style-none js-navigation-container js-active-navigation-container" role="list">
      <li class="Box-row"><h3><a class="markdown-title js-navigation-open" href="/acme/widgets/discussions/1">First question</a></h3>
        <a href="/someone" data-hovercard-url="/users/someone/hovercard">someone</a> asked</li>
      <li class="Box-row"><h3><a class="markdown-title js-navigation-open" href="/acme/widgets/discussions/2">Spam question</a></h3>
        <a href="/Blocked-One" data-hovercard-url="/users/Blocked-One/hovercard">Blocked-One</a> asked</li>
    </ul>`;
  document.body.append(root);
  return root;
}

afterEach(() => {
  removeBlockedListHiding();
  document.body.innerHTML = '';
});

describe('applyBlockedListHiding', () => {
  it('hides a blocked person’s discussion behind a row at the foot of the list, and shows it under that row', () => {
    const root = discussionsList();
    const blocked = new Map<string, BlockedBy>([['blocked-one', { org: false, personal: true }]]);
    const owners: string[] = [];
    applyBlockedListHiding((owner) => {
      owners.push(owner);
      return owner === 'acme' ? blocked : new Map();
    }, []);
    // Blocks are read for each row's own repository owner, as a list across organizations needs.
    expect(new Set(owners)).toEqual(new Set(['acme']));
    const rows = [...root.querySelectorAll('li.Box-row')];
    expect(rows.map((row) => row.getAttribute('data-geld-blocked-row'))).toEqual([null, 'hidden']);
    const note = root.querySelector('[data-geld-blocked-note]');
    expect(note?.textContent).toContain('1 discussion by blocked users hidden');
    expect(note?.parentElement?.lastElementChild).toBe(note);
    expect(rows[1]?.querySelector('.geld-blocked-label')?.textContent).toBe('Blocked');

    note?.querySelector('button')?.click();
    expect(rows[1]?.getAttribute('data-geld-blocked-row')).toBe('shown');
    expect(note?.textContent).toContain('1 discussion by blocked users');
    expect(note?.querySelector('button')?.textContent).toBe('Hide');
  });

  it('puts the list back when nobody on it is blocked', () => {
    const root = discussionsList();
    applyBlockedListHiding(() => new Map<string, BlockedBy>([['blocked-one', { org: true, personal: false }]]), []);
    applyBlockedListHiding(() => new Map(), []);
    expect(root.querySelector('[data-geld-blocked-note]')).toBeNull();
    expect(root.querySelector('[data-geld-blocked-row]')).toBeNull();
    expect(root.querySelector('[data-geld-blocked-list]')).toBeNull();
  });
});
