// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { clearSidebarPeople, syncSidebarPeople } from './sidebar-people';

/** The Overview's Reviewers section as GitHub renders it (Nov 2026): a person's name is a plain profile link. */
const OVERVIEW = `
  <section aria-label="Reviewers" data-overview-sidebar-item>
    <div class="header__c3"><h4>Reviewers</h4></div>
    <div class="body__d4"><ul>
      <li class="reviewerRow__a1"><a href="/someone"><span class="reviewerName__b2">someone</span></a></li>
      <li class="reviewerRow__a1"><a href="/other"><span class="reviewerName__b2">other</span></a></li>
      <li class="reviewerRow__a1"><a href="/apps/greptile-apps"><span class="reviewerName__b2">greptile-apps</span></a></li>
    </ul></div>
  </section>`;

afterEach(() => {
  clearSidebarPeople();
  document.body.innerHTML = '';
});

describe('syncSidebarPeople', () => {
  it('hides an Overview reviewer whose row links only to their profile', () => {
    document.body.innerHTML = OVERVIEW;
    syncSidebarPeople((login) => login === 'someone' || login === 'greptile-apps[bot]');
    const hidden = [...document.querySelectorAll('li')].map((row) => row.hasAttribute('data-geld-sidebar-hidden'));
    expect(hidden).toEqual([true, false, true]);
    expect(document.body.textContent).not.toContain('No reviewers');
  });

  it('says "No reviewers" once every Overview reviewer is hidden', () => {
    document.body.innerHTML = OVERVIEW;
    syncSidebarPeople(() => true);
    expect(document.body.textContent).toContain('No reviewers');
  });
});
