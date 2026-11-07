// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } } }));

import { applyRelatedLinks, assigneesSection, relatedLinksOnPage, removeRelatedLinks } from './related-links';

// mintlify/mint#14542's footer as GitHub renders it, after the author's own words.
const DESCRIPTION =
  '<div class="js-comment-container"><div class="js-comment-body markdown-body"><h2>Summary</h2><p>See <a href="https://linear.app/mintlify/issue/DOC-77/sdk-nav-overview">the ticket</a>.</p>' +
  '<pre><a href="https://linear.app/mintlify/issue/DOC-99">in code</a></pre><hr>' +
  '<div align="center"><sub>Created by <b>Brandon McConnell</b> with <a href="https://replicas.dev">Replicas</a></sub><br><br>' +
  '<a href="https://app.replicas.dev/workspaces/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010"><img alt="Replicas Workspace" src="w.svg"></a>&nbsp;' +
  '<a href="https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139?thread_ts=1793123214.352139&amp;cid=C0BCMJ9JFA9"><img alt="Slack Thread" src="s.svg"></a></div></div></div>';

// The Rails sidebar of wxt-dev/wxt#2544 (Nov 2026), trimmed: signed out the headings are `h3`s, signed in a `summary`.
const item = (name: string, signedIn: boolean): string =>
  `<div class="discussion-sidebar-item js-discussion-sidebar-item"><form class="js-issue-sidebar-form">${signedIn ? `<details><summary class="text-bold discussion-sidebar-heading">${name}</summary></details>` : `<h3 class="discussion-sidebar-heading text-bold">${name}</h3>`}<span>None yet</span></form></div>`;
const railsSidebar = (signedIn = false): string =>
  `<div id="partial-discussion-sidebar">${['Reviewers', 'Assignees', 'Labels', 'Projects', 'Milestone'].map((name) => item(name, signedIn)).join('')}<div class="discussion-sidebar-item">2 participants</div></div>`;

const reactSidebar =
  '<aside class="sidebar__x"><section class="section__a"><h3 class="heading__b">Activity</h3></section><section class="section__a"><div><h3 class="heading__b">Reviewers</h3></div></section>' +
  '<section class="section__a"><div><h3 class="heading__b">Assignees</h3><p>No one</p></div></section><section class="section__a"><div><h3 class="heading__b">Labels</h3></div></section></aside>';

afterEach(() => {
  removeRelatedLinks();
  document.body.innerHTML = '';
});

describe('related links in the sidebar', () => {
  it('reads the description and Linear’s linkback, leaving code alone', () => {
    document.body.innerHTML = `${DESCRIPTION}<div class="timeline-comment"><a class="author" href="/apps/linear">linear</a><div class="comment-body"><p><a href="https://linear.app/mintlify/issue/DOC-80">DOC-80</a></p></div></div>`;
    expect(relatedLinksOnPage().map((link) => link.key)).toEqual([
      'linear:mintlify:DOC-77',
      'linear:mintlify:DOC-80',
      'slack:mintlify:C0BCMJ9JFA9:1793123214.352139',
      'replicas:9e2a6c22-c7ad-49f7-8219-fe70dd1c8010',
    ]);
  });

  it('stands under Assignees in the Rails sidebar, signed in or out, as one of its items', () => {
    for (const signedIn of [false, true]) {
      document.body.innerHTML = DESCRIPTION + railsSidebar(signedIn);
      applyRelatedLinks(true);
      const section = document.querySelector<HTMLElement>('.geld-related');
      expect(section?.previousElementSibling?.textContent).toContain('Assignees');
      expect(section?.classList.contains('discussion-sidebar-item')).toBe(true);
      expect(section?.querySelector('h3')?.textContent).toBe('Related links');
      expect([...(section?.querySelectorAll('.geld-related__name') ?? [])].map((name) => name.textContent)).toEqual(['Linear DOC-77', 'Slack thread', 'Replicas workspace']);
      expect(section?.querySelector('a')?.getAttribute('title')).toBe('Open in Linear · Sdk nav overview · mintlify');
      removeRelatedLinks();
    }
  });

  it('takes the shape of a React sidebar’s sections', () => {
    document.body.innerHTML = DESCRIPTION + reactSidebar;
    expect(assigneesSection()?.textContent).toContain('No one');
    applyRelatedLinks(true);
    const section = document.querySelector('.geld-related');
    expect(section?.tagName).toBe('SECTION');
    expect(section?.classList.contains('section__a')).toBe(true);
    expect(section?.querySelector('h3')?.className).toBe('heading__b geld-related__heading');
    expect(section?.previousElementSibling?.textContent).toContain('Assignees');
  });

  it('writes nothing again while nothing changed, comes back after GitHub replaces the sidebar, and goes when off', () => {
    document.body.innerHTML = DESCRIPTION + railsSidebar();
    applyRelatedLinks(true);
    const first = document.querySelector('.geld-related');
    applyRelatedLinks(true);
    expect(document.querySelector('.geld-related')).toBe(first);
    document.getElementById('partial-discussion-sidebar')?.replaceWith(document.createRange().createContextualFragment(railsSidebar()));
    applyRelatedLinks(true);
    expect(document.querySelectorAll('.geld-related')).toHaveLength(1);
    expect(document.querySelector('.geld-related')?.previousElementSibling?.textContent).toContain('Assignees');
    applyRelatedLinks(false);
    expect(document.querySelector('.geld-related')).toBeNull();
  });

  it('draws nothing without links or without an Assignees section', () => {
    document.body.innerHTML = railsSidebar();
    applyRelatedLinks(true);
    expect(document.querySelector('.geld-related')).toBeNull();
    document.body.innerHTML = DESCRIPTION;
    applyRelatedLinks(true);
    expect(document.querySelector('.geld-related')).toBeNull();
  });
});
