// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://github.com/acme/web/pull/7"}
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } } }));
const fetches = vi.hoisted((): { paths: string[]; body: string | null } => ({ paths: [], body: null }));
vi.mock('./page-fetch', () => ({
  pageFetch: async (path: string) => {
    fetches.paths.push(path);
    const hovercard = /\/([^/]+)\/([^/]+)\/pull\/(\d+)\/hovercard$/.exec(path);
    if (hovercard !== null) {
      const merged = hovercard[3] === '52514';
      const title = merged ? 'Cache fetches across routes' : 'Nav overview is a group of one';
      const badge = merged ? '<span class="State State--merged">Merged</span><svg class="octicon octicon-git-merge"></svg>' : '<span class="State State--open">Open</span><svg class="octicon octicon-issue-opened"></svg>';
      return new Response(`<div>${badge}<a href="/${hovercard[1]}/${hovercard[2]}/issues/${hovercard[3]}">${title} #${hovercard[3]}</a></div>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response(fetches.body === null ? '{}' : JSON.stringify({ body: '', bodyHtml: fetches.body }), { status: fetches.body === null ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
  },
}));

import { applyRelatedLinks, assigneesSections, relatedLinksOnPage, relatedText, removeRelatedLinks } from './related-links';

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
  fetches.paths = [];
  fetches.body = null;
  history.replaceState(null, '', '/');
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('related links in the sidebar', () => {
  it('names a link by its identifier and title, or by what following it does', () => {
    document.body.innerHTML = DESCRIPTION;
    expect(relatedLinksOnPage().map(relatedText)).toEqual(['DOC-77 Sdk nav overview', 'Open thread in Slack', 'View workspace in Replicas']);
  });

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
      expect([...(section?.querySelectorAll('.geld-related__text') ?? [])].map((text) => text.textContent)).toEqual(['DOC-77Sdk nav overview', 'Open thread in Slack', 'View workspace in Replicas']);
      expect([...(section?.querySelectorAll('.geld-related__text > *') ?? [])].map((part) => part.className)).toEqual(['geld-related__ref', 'geld-related__title', 'geld-related__action', 'geld-related__action']);
      const first = section?.querySelector('a');
      expect(first?.getAttribute('title')).toBe('Open issue in Linear · Sdk nav overview · mintlify');
      expect(first?.getAttribute('aria-label')).toBe('DOC-77 Sdk nav overview. Open issue in Linear, mintlify');
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

  it('reads the description from GitHub’s page_data/description where the page does not hold it as the conversation does', async () => {
    history.replaceState(null, '', '/acme/web/pull/7');
    document.body.innerHTML = overviewSidebar;
    fetches.body = '<p>Asked in <a href="https://acme.slack.com/archives/C0BCMJ9JFA9/p1793123214352139?thread_ts=1793123214.352139">Slack</a>.</p>';
    let changes = 0;
    applyRelatedLinks(true, () => {
      changes += 1;
      applyRelatedLinks(true);
    });
    expect(document.querySelector('.geld-related')).toBeNull();
    await settle();
    await settle();
    expect(fetches.paths).toEqual(['/acme/web/pull/7/page_data/description']);
    expect(changes).toBe(1);
    expect(document.querySelector('.geld-related__text')?.textContent).toBe('Open thread in Slack');
    applyRelatedLinks(true);
    expect(fetches.paths).toHaveLength(1);
  });

  it('reads Linear’s linkback wherever its author link stands', () => {
    document.body.innerHTML = '<div class="comment__x"><div class="header__y"><a href="/apps/linear">linear</a></div><div class="markdown-body"><p><a href="https://linear.app/acme/issue/ENG-9">ENG-9</a></p></div></div>';
    expect(relatedLinksOnPage().map((link) => link.key)).toEqual(['linear:acme:ENG-9']);
  });

  it('takes nothing from a dependency update, whose links are upstream release notes', () => {
    document.body.innerHTML = '<div class="js-comment-container"><div class="js-comment-body markdown-body"><p>This PR contains the following updates:</p><p><a href="https://gitlab.com/cznic/sqlite/-/issues/263">#263</a></p></div></div>';
    expect(relatedLinksOnPage()).toEqual([]);
  });

  it('shows eight rows and the rest behind Show N more, which stays open across redraws', () => {
    const tickets = Array.from({ length: 11 }, (_, index) => `<a href="https://linear.app/acme/issue/ENG-${index + 1}">ENG-${index + 1}</a>`).join(' ');
    document.body.innerHTML = `<div class="js-comment-container"><div class="js-comment-body markdown-body"><p>${tickets}</p></div></div>${railsSidebar()}`;
    applyRelatedLinks(true);
    const visible = (): number => [...document.querySelectorAll<HTMLElement>('.geld-related__link')].filter((row) => row.closest('li')?.hidden !== true).length;
    expect(visible()).toBe(8);
    const more = document.querySelector<HTMLButtonElement>('.geld-related__more');
    expect(more?.textContent).toBe('Show 3 more');
    more?.click();
    expect(visible()).toBe(11);
    expect(document.querySelector('.geld-related__more')).toBeNull();
    document.querySelector('.js-comment-body p')?.append(' ', Object.assign(document.createElement('a'), { href: 'https://linear.app/acme/issue/ENG-12', textContent: 'ENG-12' }));
    applyRelatedLinks(true);
    expect(visible()).toBe(12);
  });

  it('lists GitHub’s own issues and pull requests with the title and state GitHub’s hovercard gives, never this one', async () => {
    history.replaceState(null, '', '/acme/web/pull/7');
    document.body.innerHTML =
      '<div class="js-comment-container"><div class="js-comment-body markdown-body"><p>Fixes <a class="issue-link js-issue-link" href="https://github.com/acme/web/issues/12">#12</a>, after ' +
      '<a class="issue-link js-issue-link" href="https://github.com/vercel/next.js/pull/52514">vercel/next.js#52514</a>. Stacked on <a href="https://github.com/acme/web/pull/7">this one</a>.</p></div></div>' +
      railsSidebar();
    const rerun = (): void => applyRelatedLinks(true, rerun);
    rerun();
    expect([...document.querySelectorAll('.geld-related__text')].map((text) => text.textContent)).toEqual(['vercel/next.js#52514', '#12']);
    expect([...document.querySelectorAll('.geld-related__mark')].map((mark) => mark.getAttribute('data-tone'))).toEqual(['unknown', 'unknown']);
    await settle();
    await settle();
    expect([...document.querySelectorAll('.geld-related__text')].map((text) => text.textContent)).toEqual(['vercel/next.js#52514Cache fetches across routes', '#12Nav overview is a group of one']);
    const marks = [...document.querySelectorAll('.geld-related__mark')];
    expect(marks.map((mark) => [mark.getAttribute('data-tone'), mark.getAttribute('class')])).toEqual([
      ['done', 'octicon octicon-git-merge geld-related__mark'],
      ['open', 'octicon octicon-issue-opened geld-related__mark'],
    ]);
    expect(document.querySelectorAll('.geld-related__link')[0]?.getAttribute('title')).toBe('Merged · Open pull request on GitHub · Cache fetches across routes · vercel/next.js');
  });
});
