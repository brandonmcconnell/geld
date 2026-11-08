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

  it('stands under Reviewers in the Rails sidebar, signed in or out, as one of its items, and under Assignees with no Reviewers', () => {
    for (const signedIn of [false, true]) {
      document.body.innerHTML = DESCRIPTION + railsSidebar(signedIn);
      applyRelatedLinks(true);
      const section = document.querySelector<HTMLElement>('.geld-related');
      expect(section?.previousElementSibling?.textContent).toContain('Reviewers');
      expect(section?.classList.contains('discussion-sidebar-item')).toBe(true);
      expect(section?.querySelector('h3')?.textContent).toBe('Related links');
      expect([...(section?.querySelectorAll('.geld-related__text') ?? [])].map((text) => text.textContent)).toEqual(['DOC-77 Sdk nav overview', 'Open thread in Slack', 'View workspace in Replicas']);
      expect([...(section?.querySelectorAll('.geld-related__text > *') ?? [])].map((part) => part.className)).toEqual(['geld-related__ref', 'geld-related__title', 'geld-related__action', 'geld-related__action']);
      const first = section?.querySelector('a');
      expect(first?.getAttribute('title')).toBe('Open issue in Linear · Sdk nav overview · mintlify');
      expect(first?.getAttribute('aria-label')).toBe('DOC-77 Sdk nav overview. Open issue in Linear, mintlify');
      removeRelatedLinks();
    }
    document.body.innerHTML = DESCRIPTION + railsSidebar();
    [...document.querySelectorAll('.discussion-sidebar-item')].find((item) => item.textContent?.includes('Reviewers'))?.remove();
    expect(document.body.textContent).not.toContain('Reviewers');
    applyRelatedLinks(true);
    expect(document.querySelector('.geld-related')?.previousElementSibling?.textContent).toContain('Assignees');
  });

  it('leaves one section: a section another copy of Geld left in the sidebar goes, wherever it stands', () => {
    document.body.innerHTML = DESCRIPTION + overviewSidebar;
    applyRelatedLinks(true);
    const ours = document.querySelector('.geld-related');
    // What a retired copy's section looks like: the same element, drawn by a copy that no longer tracks it.
    const after = ours?.cloneNode(true);
    if (after instanceof HTMLElement) document.querySelector('[aria-label="Proof of presence"]')?.after(after);
    applyRelatedLinks(true);
    const kept = document.querySelectorAll('.geld-related');
    expect(kept).toHaveLength(1);
    expect(kept[0] === ours).toBe(true);
    // Before ours it stands in our place: ours is drawn again there, and the leftover still goes.
    const before = ours?.cloneNode(true);
    if (before instanceof HTMLElement) ours?.before(before);
    applyRelatedLinks(true);
    const again = document.querySelectorAll('.geld-related');
    expect(again).toHaveLength(1);
    expect(again[0] === before).toBe(false);
    expect(again[0]?.previousElementSibling?.getAttribute('aria-label')).toBe('Reviewers');
    removeRelatedLinks();
  });

  it('stands after the hidden fragment GitHub keeps after Reviewers, so Assignees stays a sidebar item’s neighbour', () => {
    document.body.innerHTML = DESCRIPTION + railsSidebar();
    const reviewers = [...document.querySelectorAll('.discussion-sidebar-item')].find((item) => item.textContent?.includes('Reviewers'));
    reviewers?.after(document.createRange().createContextualFragment('<include-fragment class="d-none is-error"><h3 class="blankslate-heading">Uh oh!</h3></include-fragment>'));
    applyRelatedLinks(true);
    const section = document.querySelector('.geld-related');
    expect(section?.previousElementSibling?.tagName).toBe('INCLUDE-FRAGMENT');
    expect(section?.nextElementSibling?.textContent).toContain('Assignees');
  });

  it('stands under Reviewers on the Overview page in GitHub’s SidebarSection shape, and not in its picker', () => {
    document.body.innerHTML = DESCRIPTION + overviewSidebar;
    expect(assigneesSections().map((section) => section.getAttribute('aria-label'))).toEqual(['Assignees']);
    applyRelatedLinks(true);
    const sections = document.querySelectorAll<HTMLElement>('.geld-related');
    expect(sections).toHaveLength(1);
    const section = sections[0];
    expect(section?.previousElementSibling?.getAttribute('aria-label')).toBe('Reviewers');
    expect(section?.nextElementSibling?.getAttribute('aria-label')).toBe('Proof of presence');
    expect(section?.outerHTML).toMatch(/^<section class="geld-related" aria-label="Related links" data-overview-sidebar-item=""/);
    expect(section?.firstElementChild?.outerHTML).toBe('<div class="header__wx"><h4 class="title__Gf geld-related__heading">Related links</h4></div>');
    expect(section?.lastElementChild?.className).toBe('content__rf');
    expect(section?.querySelectorAll('.geld-related__link')).toHaveLength(3);
    expect(document.getElementById('__primerPortalRoot__')?.querySelector('.geld-related')).toBeNull();
  });

  it('orders the Overview sidebar Reviewers, Related links, Activity, then GitHub’s order, and leaves the classic one alone', () => {
    document.body.innerHTML = DESCRIPTION + overviewSidebar;
    applyRelatedLinks(true);
    const list = document.querySelector('.info__x');
    expect(list?.hasAttribute('data-geld-sidebar-order')).toBe(true);
    const placed = [...(list?.children ?? [])].map((child) => [child.getAttribute('aria-label'), child.getAttribute('data-geld-order'), child.hasAttribute('data-geld-order-first')]);
    expect(placed).toEqual([
      ['Activity', 'activity', false],
      ['Reviewers', 'reviewers', true],
      ['Related links', 'related', false],
      ['Proof of presence', null, false],
      ['Assignees', null, false],
      ['Labels', null, false],
      ['Projects', null, false],
      ['Milestones', null, false],
      ['Development', null, false],
      ['2 participants', null, false],
    ]);
    removeRelatedLinks();
    expect(document.querySelectorAll('[data-geld-sidebar-order], [data-geld-order], [data-geld-order-first]')).toHaveLength(0);
    document.body.innerHTML = DESCRIPTION + railsSidebar();
    applyRelatedLinks(true);
    expect(document.querySelectorAll('[data-geld-sidebar-order]')).toHaveLength(0);
  });

  it('orders the Overview sidebar with no related links to show, and marks the first shown when Reviewers is not there', () => {
    document.body.innerHTML = overviewSidebar.replace(/<section aria-label="Reviewers"[\s\S]*?<\/section>/, '');
    applyRelatedLinks(true);
    expect(document.querySelector('.geld-related')).toBeNull();
    expect(document.querySelector('[data-geld-order-first]')?.getAttribute('aria-label')).toBe('Activity');
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
    expect(section?.previousElementSibling?.textContent).toContain('Reviewers');
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
    expect(document.querySelector('.geld-related')?.previousElementSibling?.textContent).toContain('Reviewers');
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

  it('reads an App’s comment for its own service only, and never a person’s', () => {
    const comment = (author: string, links: string): string => `<div class="timeline-comment"><div class="timeline-comment-header"><a class="author" href="${author}">x</a></div><div class="comment-body markdown-body"><p>${links}</p></div></div>`;
    document.body.innerHTML =
      '<div class="js-comment-container"><div class="js-comment-body markdown-body"><p>The description.</p></div></div>' +
      comment('/octocat', '<a href="https://linear.app/acme/issue/ENG-1">ENG-1</a>') +
      comment('/apps/linear', '<a href="https://linear.app/acme/issue/ENG-2">ENG-2</a> <a href="https://acme.slack.com/archives/C0123ABCD/p1793123214352139">thread</a>') +
      comment('/apps/replicas-connector', '<a href="https://app.replicas.dev/workspaces/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010"><img alt="Replicas Workspace"></a> <a href="https://app.greptile.com/review/github/acme/web/pull/9"><img alt="View in Greptile"></a>');
    expect(relatedLinksOnPage().map((link) => link.key)).toEqual(['linear:acme:ENG-2', 'replicas:9e2a6c22-c7ad-49f7-8219-fe70dd1c8010']);
  });

  it('keeps an App comment’s links while the digest has it open, its body on loan and its header worn in a row', () => {
    document.body.innerHTML =
      '<div class="js-comment-container"><div class="js-comment-body markdown-body"><p>The description.</p></div></div>' +
      '<div class="timeline-comment" id="home"><div class="timeline-comment-header"><a class="author" href="/apps/greptile-apps">greptile-apps</a></div>' +
      '<div class="comment-body markdown-body"><a href="https://app.greptile.com/review/github/acme/web/pull/9"><img alt="View in Greptile"></a></div></div>' +
      '<div data-geld-ui=""><div class="row" data-geld-ui=""></div><div class="slot"></div></div>';
    expect(relatedLinksOnPage().map((link) => link.key)).toEqual(['greptile:review/github/acme/web/pull/9']);
    const header = document.querySelector('.timeline-comment-header');
    const body = document.querySelector('#home .comment-body');
    const row = document.querySelector('.row');
    const slot = document.querySelector('.slot');
    if (header === null || body === null || row === null || slot === null) throw new Error('fixture');
    header.setAttribute('data-geld-teleported', 'a');
    body.setAttribute('data-geld-teleported', 'b');
    row.append(header);
    slot.append(body);
    expect(relatedLinksOnPage().map((link) => link.key)).toEqual(['greptile:review/github/acme/web/pull/9']);
  });

  it('passes over a box that holds several comments rather than guess whose the links are', () => {
    document.body.innerHTML = '<div class="group"><a href="/apps/linear">linear</a><div class="markdown-body"><a href="https://linear.app/acme/issue/ENG-3">ENG-3</a></div><div class="markdown-body"><a href="https://linear.app/acme/issue/ENG-4">ENG-4</a></div></div>';
    expect(relatedLinksOnPage()).toEqual([]);
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
    expect([...document.querySelectorAll('.geld-related__text')].map((text) => text.textContent)).toEqual(['vercel/next.js#52514 Cache fetches across routes', '#12 Nav overview is a group of one']);
    const marks = [...document.querySelectorAll('.geld-related__mark')];
    expect(marks.map((mark) => [mark.getAttribute('data-tone'), mark.getAttribute('class')])).toEqual([
      ['done', 'octicon octicon-git-merge geld-related__mark'],
      ['open', 'octicon octicon-issue-opened geld-related__mark'],
    ]);
    expect(document.querySelectorAll('.geld-related__link')[0]?.getAttribute('title')).toBe('Merged · Open pull request on GitHub · Cache fetches across routes · vercel/next.js');
  });

  it('looks up only the rows that show, the rest once Show N more opens them', async () => {
    history.replaceState(null, '', '/acme/web/pull/7');
    const refs = Array.from({ length: 11 }, (_, index) => `<a href="https://github.com/acme/web/issues/${index + 100}">#${index + 100}</a>`).join(' ');
    document.body.innerHTML = `<div class="js-comment-container"><div class="js-comment-body markdown-body"><p>${refs}</p></div></div>${railsSidebar()}`;
    const rerun = (): void => applyRelatedLinks(true, rerun);
    rerun();
    const lookups = (): number => fetches.paths.filter((path) => path.endsWith('/hovercard')).length;
    expect(lookups()).toBe(8);
    await settle();
    document.querySelector<HTMLButtonElement>('.geld-related__more')?.click();
    await settle();
    expect(lookups()).toBe(11);
  });
});
