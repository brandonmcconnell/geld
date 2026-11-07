// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } } }));

import { applyRelatedLinks, assigneesSections, relatedLinksOnPage, removeRelatedLinks } from './related-links';

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

// The Overview page's sidebar as GitHub's bundle renders it (`OverviewInfo`, Nov 2026): one `SidebarSection` each,
// `<section aria-label data-overview-sidebar-item>` with a plain `div > h4` header or a gear's `h4 > button > span`.
const plainSection = (title: string, body = 'None yet'): string =>
  `<section aria-label="${title}" data-overview-sidebar-item=""><div class="header__wx"><h4 class="title__Gf">${title}</h4></div><div class="content__rf"><span>${body}</span></div></section>`;
const gearSection = (title: string, body = 'No one'): string =>
  `<section aria-label="${title}" data-overview-sidebar-item=""><h4 class="disclosure__gI"><button type="button" class="button__nF" aria-label="Manage ${title.toLowerCase()}"><span class="title__Gf">${title}</span><svg class="octicon octicon-gear icon__PR"></svg></button></h4><div class="content__rf"><span>${body}</span></div></section>`;
const overviewSidebar =
  `<div class="info__x">${plainSection('Activity')}${gearSection('Reviewers')}<div data-overview-sidebar-item="" role="group" aria-label="Proof of presence"></div>${gearSection('Assignees')}` +
  `${gearSection('Labels')}${plainSection('Projects')}${gearSection('Milestones')}${gearSection('Development')}${plainSection('2 participants')}</div>` +
  // A picker GitHub opens over the page, titled like the section.
  '<div id="__primerPortalRoot__"><div class="Overlay" role="dialog"><h3>Assignees</h3><ul><li>Reviewers</li></ul></div></div>';

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

  it('stands under Assignees on the Overview page in GitHub’s SidebarSection shape, and not in its picker', () => {
    document.body.innerHTML = DESCRIPTION + overviewSidebar;
    expect(assigneesSections().map((section) => section.getAttribute('aria-label'))).toEqual(['Assignees']);
    applyRelatedLinks(true);
    const sections = document.querySelectorAll<HTMLElement>('.geld-related');
    expect(sections).toHaveLength(1);
    const section = sections[0];
    expect(section?.previousElementSibling?.getAttribute('aria-label')).toBe('Assignees');
    expect(section?.nextElementSibling?.getAttribute('aria-label')).toBe('Labels');
    expect(section?.outerHTML).toMatch(/^<section class="geld-related" aria-label="Related links" data-overview-sidebar-item=""/);
    expect(section?.firstElementChild?.outerHTML).toBe('<div class="header__wx"><h4 class="title__Gf geld-related__heading">Related links</h4></div>');
    expect(section?.lastElementChild?.className).toBe('content__rf');
    expect(section?.querySelectorAll('.geld-related__link')).toHaveLength(3);
    expect(document.getElementById('__primerPortalRoot__')?.querySelector('.geld-related')).toBeNull();
  });

  it('stands in every Overview sidebar the page shows, and leaves when React drops one', () => {
    document.body.innerHTML = DESCRIPTION + overviewSidebar + overviewSidebar;
    applyRelatedLinks(true);
    expect(document.querySelectorAll('.geld-related')).toHaveLength(2);
    document.querySelectorAll('.info__x')[1]?.remove();
    applyRelatedLinks(true);
    expect(document.querySelectorAll('.geld-related')).toHaveLength(1);
  });

  it('takes the shape of another sidebar’s sections', () => {
    document.body.innerHTML = DESCRIPTION + reactSidebar;
    expect(assigneesSections()[0]?.textContent).toContain('No one');
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
