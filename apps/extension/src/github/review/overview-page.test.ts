// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { threadRootOf } from './actions';
import { crawlConversation, crawlLeftovers, crawlReviews, crawlSidebarReviewers, reactionsOf, resetCrawlCache } from './crawler';
import { editLogUrlOf, nodeIdOf } from './edit-times';
import { restoreAll, teleportInto } from './teleport';
import { applyTopCardHint, rememberTopCard } from './top-card';
import { closeOverviewChecks, isOverviewPage, openOverviewChecks, overviewChecksList, overviewCommentsControls, overviewCommentsFiltered, overviewCommentsSection, overviewNewestFirst, showAllOverviewComments } from './overview-page';

/** An Overview comment's header as GitHub rendered it on brandonmcconnell/geld#461 (Nov 2026), trimmed. */
function header(login: string, href: string, at: string, muted = '', extra = ''): string {
  return `<div data-testid="comment-header" class="ActivityHeaderContainer__sf0_ID"><div class="activityHeader__V45NcJ">
    <h3 class="sr-only">${login} commented <relative-time datetime="${at}">on Nov 7, 2026</relative-time></h3>
    <div><a class="avatarLink__sqWzwe" href="${href}" aria-label="@${login}'s profile"><img data-testid="github-avatar" alt="@${login}" src="https://avatars.githubusercontent.com/u/1?v=4&size=48"></a></div>
    <div data-testid="comment-header-left-side-items"><div><a data-testid="avatar-link" href="${href}" data-hovercard-url="/users/${encodeURIComponent(/\[bot\]$/.test(login) || href.startsWith('/apps/') ? `${login.replace(/\[bot\]$/, '')}[bot]` : login)}/hovercard" data-hovercard-type="user">${login}</a>${href.startsWith('/apps/') ? '<span data-component="Label">Bot</span>' : ''}</div>
      <div class="footer__x">${muted === '' ? '' : `<span class="HeaderMutedText__oT4m5j">${muted}</span>`}<span class="HeaderMutedText__oT4m5j"><a href="#"><relative-time datetime="${at}">on Nov 7, 2026</relative-time></a></span></div></div>
    <div data-testid="comment-header-right-side-items">${extra}<button aria-label="More actions">⋯</button></div>
  </div></div>`;
}

function thread(id: string, path: string, line: number, resolved: boolean, body: string): string {
  return `<article class="container__rfx-3s">
    <div class="header__8DCKRC"><div class="d-flex"><button aria-label="Close review comment in ${path}, line ${line}"></button>
      <h2><a class="file-name-overflow__w2kn8A" href="/o/r/pull/461/changes#r${id}">\u200e${path}\u200e</a><span class="f6 fgColor-muted">Line ${line}</span></h2>
      ${resolved ? '<span data-component="Label">Resolved</span>' : ''}</div></div>
    <div class="body__APdwN2"><div data-testid="review-thread"><div><div id="discussion_r${id}" class="ReviewThreadContainer__zrJcUC">
      <div class="ReviewThreadInnerContainer__cag4y4">${header('coderabbitai[bot]', '/coderabbitai[bot]', '2026-11-07T06:13:29.000Z')}</div>
      <div class="ReviewThreadWrapper__vspFQB"><div class="markdown-body"><p>${body}</p></div></div>
    </div></div></div></div>
  </article>`;
}

const PAGE = `
<section aria-label="Description" class="container__qcj0r_"><div class="body__fphukB"><div class="editMetadata__ws0CPo"><button class="editHistoryMenuButton__TJDAkv">Edited</button></div><div><div><div class="markdown-body"><p>The plan.</p></div></div></div></div></section>
<section class="container__-reUmk">
  <div class="controlsRow__XfPhtA"><div class="headingArea__S6rRhX"><h2 id="overview-comments">Comments</h2></div>
    <div class="viewControls"><button><svg class="octicon octicon-sort-desc"></svg></button></div></div>
  <div data-component="Stack"><div data-component="Stack">
    <div data-testid="timeline-item" data-item-type="issue"><div><article id="issuecomment-30">
      <div class="header">${header('greptile-apps', '/apps/greptile-apps', '2026-11-07T06:20:00.000Z', '', '<div class="editHistoryContainer"><button class="editHistoryMenuButton__TJDAkv">Last edited by greptile-apps[bot]</button></div>')}</div>
      <div class="body"><div data-component="Stack"><div class="markdown-body"><h2>Confidence Score: 5/5</h2></div>
        <div role="toolbar" aria-label="Reactions for greptile-apps[bot]'s comment"><button aria-label="👍 1 reaction" aria-describedby="sr-1 tip-1">👍 1</button><span id="tip-1" role="tooltip">brandonmcconnell</span></div></div></div>
    </article></div></div>
    <div data-testid="timeline-item" data-item-type="commit_group"><div data-testid="timeline-commit-group"><div class="CommitRow__w1guph" data-testid="timeline-commit-row">
      <img data-testid="commit-stack-avatar" alt="cursoragent" data-hovercard-type="user" src="https://avatars.githubusercontent.com/u/2?v=4">
      <a class="Title__YUzlpe" href="/o/r/pull/461/changes/69125e473b3598b4a739e816d8fbf7ecc5cd74d7">Plan</a>
    </div></div></div>
    <div data-testid="timeline-item" data-item-type="review_summary"><div id="pullrequestreview-20" role="group" data-testid="review-thread-focus-target">
      ${thread('400', 'src/flow.ts', 57, true, 'A resolved finding')}
    </div></div>
    <div data-testid="timeline-item" data-item-type="review_summary"><div><article id="pullrequestreview-10" class="container border rounded-2">
      <div class="header">${header('alice', '/alice', '2026-11-07T06:10:00.000Z', 'approved')}</div>
      <div class="body"><div class="d-flex"><div data-component="Stack"><div class="markdown-body"><p>Looks good</p></div></div>
        ${thread('300', '.cursor/plans/plan.md', 341, false, 'Line 44 says otherwise')}
      </div></div>
    </article></div></div>
    <div data-testid="timeline-item" data-item-type="review_summary"><div><article id="pullrequestreview-5" class="container border rounded-2">
      <div class="header">${header('bob', '/bob', '2026-11-07T06:00:00.000Z', 'previously approved')}</div>
      <div class="body"><div data-component="Stack"><div class="markdown-body"><p>Ship it</p></div></div></div>
    </article></div></div>
  </div></div>
</section>`;

function mount(): void {
  document.head.innerHTML = '<meta name="octolytics-dimension-repository_id" content="1357541534">';
  document.body.innerHTML = PAGE;
  resetCrawlCache();
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('the Overview tab', () => {
  it('is told by its description box, and lists its Comments newest first by the sort button', () => {
    mount();
    expect(isOverviewPage()).toBe(true);
    const section = overviewCommentsSection();
    expect(section?.querySelector('#overview-comments')).not.toBeNull();
    expect(section === null ? null : overviewCommentsControls(section)?.className).toBe('controlsRow__XfPhtA');
    expect(section === null ? false : overviewNewestFirst(section)).toBe(true);
  });

  it('reads comments, reviews and threads in timeline order, oldest first, though the page lists them newest first', () => {
    mount();
    const { comments } = crawlConversation();
    expect(comments.map((entry) => [entry.comment.anchor, entry.comment.kind, entry.author.login])).toEqual([
      ['pullrequestreview-5', 'review', 'bob'],
      ['pullrequestreview-10', 'review', 'alice'],
      ['discussion_r300', 'thread', 'coderabbitai[bot]'],
      ['discussion_r400', 'thread', 'coderabbitai[bot]'],
      ['issuecomment-30', 'comment', 'greptile-apps[bot]'],
    ]);
  });

  it('reads what each comment and each thread reply links to, with who and when', () => {
    mount();
    const reply = document.querySelector('#discussion_r300 .markdown-body p');
    const top = document.querySelector('#issuecomment-30 .markdown-body');
    if (reply === null || top === null) throw new Error('fixture');
    reply.insertAdjacentHTML('beforeend', ' see <a class="issue-link" href="https://github.com/o/r/pull/1">#1</a>');
    top.insertAdjacentHTML('beforeend', '<p>Related: <a href="https://github.com/o/r/discussions/5" data-hovercard-type="discussion">#5</a></p>');
    resetCrawlCache();
    const mentions = crawlConversation().comments.flatMap((entry) => entry.mentions.map((mention) => [mention.ref, mention.anchor, mention.author.login, mention.discussion, mention.at]));
    expect(mentions).toEqual([
      ['o/r#1', 'discussion_r300', 'coderabbitai[bot]', false, '2026-11-07T06:13:29.000Z'],
      ['o/r#5', 'issuecomment-30', 'greptile-apps[bot]', true, '2026-11-07T06:20:00.000Z'],
    ]);
  });

  it("reads a thread's file, line and state from its box's heading, never from the words of its comments", () => {
    mount();
    const threads = crawlConversation().comments.filter((entry) => entry.comment.kind === 'thread');
    expect(threads.map((entry) => [entry.comment.path, entry.comment.line, entry.comment.isResolved])).toEqual([
      ['.cursor/plans/plan.md', 341, false],
      ['src/flow.ts', 57, true],
    ]);
    expect(threads.every((entry) => entry.root.matches('[data-testid="timeline-item"]'))).toBe(true);
    expect(threadRootOf('discussion_r300')?.tagName).toBe('ARTICLE');
  });

  it("keeps a range's last line, the line GitHub's API gives a multi-line comment and the Action's data carries", () => {
    mount();
    const heading = document.querySelector('#discussion_r400')?.closest('article')?.querySelector('h2 span');
    if (heading === null || heading === undefined) throw new Error('fixture');
    heading.textContent = 'Lines 52 to 57';
    resetCrawlCache();
    const thread = crawlConversation().comments.find((entry) => entry.comment.anchor === 'discussion_r400');
    expect(thread?.comment.line).toBe(57);
  });

  it('keeps the timeline order while a whole entry is on loan to the digest', () => {
    mount();
    const order = (): string[] => crawlConversation().comments.map((entry) => entry.comment.anchor);
    const before = order();
    const entry = document.getElementById('pullrequestreview-20')?.closest<HTMLElement>('[data-testid="timeline-item"]');
    if (entry === null || entry === undefined) throw new Error('fixture');
    const slot = document.createElement('div');
    document.querySelector('section[aria-label="Description"]')?.after(slot);
    teleportInto(slot, [entry]);
    resetCrawlCache();
    expect(order()).toEqual(before);
    restoreAll();
  });

  it('reads a verdict from the words beside the author, a dismissed one as "previously approved"', () => {
    mount();
    expect(crawlReviews().map((review) => [review.anchor, review.state, review.comment?.id ?? null])).toEqual([
      ['pullrequestreview-5', 'dismissed', 'pullrequestreview-5'],
      ['pullrequestreview-10', 'approved', 'pullrequestreview-10'],
      ['pullrequestreview-20', 'commented', null],
    ]);
  });

  it("keeps a bot's review a bot's once the chat has dropped \"[bot]\" from its thread's name", () => {
    mount();
    for (const name of document.querySelectorAll('#pullrequestreview-20 a[data-testid="avatar-link"]')) name.textContent = (name.textContent ?? '').replace(/\[bot\]$/, '');
    resetCrawlCache();
    expect(crawlReviews().find((review) => review.anchor === 'pullrequestreview-20')?.author).toEqual({ login: 'coderabbitai[bot]', bot: true });
    expect(crawlConversation().comments.find((entry) => entry.comment.anchor === 'discussion_r400')?.author).toEqual({ login: 'coderabbitai[bot]', bot: true });
  });

  it('reads who reacted from the reaction tooltips', () => {
    mount();
    const node = document.getElementById('issuecomment-30');
    expect(node === null ? [] : reactionsOf(node)).toEqual([{ login: 'brandonmcconnell', emoji: 'thumbs up' }]);
  });

  it('finds the edit log of an edited comment by its node id', () => {
    mount();
    expect(editLogUrlOf('issuecomment-30')).toBe(`/user_content_edits/show_edit_history_log/${nodeIdOf('issuecomment-30', 1357541534) ?? ''}`);
    expect(editLogUrlOf('pullrequestreview-10')).toBeNull();
  });

  it('lists a run of commits as commits', () => {
    mount();
    const claimed = new Set(crawlConversation().comments.map((entry) => entry.root));
    expect(crawlLeftovers(claimed, () => false).map((entry) => entry.kind)).toEqual(['commit']);
  });
});

describe('an Overview run of commits', () => {
  it('counts the commits it folds behind its summary', () => {
    document.body.innerHTML = `<section><h2 id="overview-comments">Comments</h2><div data-component="Stack">
      <div data-testid="timeline-item"><div data-testid="timeline-commit-group">
        <div data-testid="timeline-commit-row"><a href="/o/r/pull/1/changes/${'a'.repeat(40)}">one</a></div>
        <details><summary aria-label="57 additional commits by sheremet-va, starting at commit 02a833f">57 additional commits</summary></details>
      </div></div>
    </div></section>`;
    expect(crawlLeftovers(new Set(), () => false).map((entry) => [entry.kind, entry.count])).toEqual([['commit', 58]]);
  });

  it('is still read while on loan to the digest, which stands outside the Comments section', () => {
    const commit = (sha: string): string => `<div data-testid="timeline-commit-group"><div data-testid="timeline-commit-row"><a href="/o/r/pull/1/changes/${sha.repeat(40)}">one</a></div></div>`;
    document.body.innerHTML = `<section aria-label="Description"></section>
      <section class="geld-review"><div class="geld-review__slot-body"><div data-testid="timeline-item" data-geld-teleported="t1">${commit('a')}</div></div></section>
      <section><h2 id="overview-comments">Comments</h2><div data-component="Stack"><!--geld:quick-view:t1--><div data-testid="timeline-item">${commit('b')}</div></div></section>`;
    expect(crawlLeftovers(new Set(), () => false).map((entry) => entry.kind)).toEqual(['commit', 'commit']);
  });
});

describe("the Overview's top card before the settings arrive", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-geld-top-card');
  });

  it('takes the last decision on a pull request page, and nothing elsewhere', () => {
    rememberTopCard('folded');
    applyTopCardHint('/o/r/pull/7');
    expect(document.documentElement.getAttribute('data-geld-top-card')).toBe('folded');
    document.documentElement.removeAttribute('data-geld-top-card');
    applyTopCardHint('/o/r/pull/7/files');
    expect(document.documentElement.hasAttribute('data-geld-top-card')).toBe(false);
    rememberTopCard('off');
    applyTopCardHint('/o/r/pull/7');
    expect(document.documentElement.hasAttribute('data-geld-top-card')).toBe(false);
  });
});

describe("the Overview sidebar's Reviewers", () => {
  it('reads each reviewer and the sentence of their status tooltip', () => {
    document.body.innerHTML = `<section aria-label="Reviewers"><ul class="reviewerList__x">
      <li class="reviewerRow__GGvypX"><span><a href="/apps/coderabbitai"><span><img src="https://avatars.githubusercontent.com/in/347564?s=40&v=4"></span><span class="reviewerName__kuuPXF">coderabbitai[bot]</span></a></span>
        <span><a class="statusIcon__gxAEMz" aria-labelledby="tip-a" href="#"><svg class="octicon octicon-comment"></svg></a><span id="tip-a" role="tooltip">coderabbitai[bot] left review comments</span></span></li>
      <li class="reviewerRow__GGvypX"><span><a href="/alice"><span><img src="https://avatars.githubusercontent.com/u/9?v=4"></span><span class="reviewerName__kuuPXF">alice</span></a></span>
        <span><span class="statusIcon__gxAEMz" aria-labelledby="tip-b"><svg class="octicon octicon-dot-fill"></svg></span><span id="tip-b" role="tooltip">Awaiting requested review from alice</span></span></li>
    </ul></section>`;
    expect(crawlSidebarReviewers().map((entry) => [entry.login, entry.state, entry.bot])).toEqual([
      ['coderabbitai[bot]', 'commented', true],
      ['alice', 'awaiting', false],
    ]);
  });
});

describe("the Overview's Comments view", () => {
  const VIEWS = `<section><div><h2 id="overview-comments">Comments</h2><ul aria-label="Comments view mode"><li><button aria-pressed="false">All</button></li><li><button aria-pressed="true">Unresolved</button></li><li><button aria-pressed="false">Mine</button></li></ul></div></section>`;

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is turned back to All, the view with the composer, once per gap', () => {
    document.body.innerHTML = VIEWS;
    const pressed: string[] = [];
    for (const button of document.querySelectorAll('button')) button.addEventListener('click', () => pressed.push(button.textContent ?? ''));
    expect(overviewCommentsFiltered()).toBe(true);
    expect(showAllOverviewComments(document, 10_000)).toBe(true);
    expect(showAllOverviewComments(document, 10_500)).toBe(false);
    expect(pressed).toEqual(['All']);
  });

  it('is left alone on All', () => {
    document.body.innerHTML = VIEWS.replace('"false">All', '"true">All').replace('"true">Unresolved', '"false">Unresolved');
    expect(overviewCommentsFiltered()).toBe(false);
    expect(showAllOverviewComments(document, 100_000)).toBe(false);
  });
});

describe("the Overview's checks list", () => {
  const card = (expanded: boolean): string =>
    `<div class="MiniStatusGrid__x"><section aria-label="Merge status"><section aria-label="${expanded ? 'Collapse' : 'Expand'} checks"><button>${expanded ? 'Collapse' : 'Expand'} checks</button></section></section></div>`;
  const overlay = '<div class="OverlayPortalRoot__x"><div><div role="group" aria-label="Checks"><div class="expandableWrapper__x">9 successful checks</div></div></div></div>';

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is opened while the digest folds the card, again once gone, and closed by Geld only when it opened it', () => {
    document.body.innerHTML = card(false);
    const pressed: string[] = [];
    document.body.addEventListener('click', (event) => pressed.push(event.target instanceof Element ? (event.target.textContent ?? '') : ''));
    expect(openOverviewChecks(document, 10_000)).toBe(true);
    expect(openOverviewChecks(document, 10_500)).toBe(false);
    document.body.innerHTML = card(true) + overlay;
    expect(overviewChecksList()?.getAttribute('aria-label')).toBe('Checks');
    expect(openOverviewChecks(document, 20_000)).toBe(false);
    closeOverviewChecks();
    closeOverviewChecks();
    expect(pressed).toEqual(['Expand checks', 'Collapse checks']);
  });

  it('waits to close while its list is on loan to the CI row', () => {
    document.body.innerHTML = card(false);
    openOverviewChecks(document, 30_000);
    document.body.innerHTML = card(true) + overlay.replace('<div class="expandableWrapper__x">9 successful checks</div>', '<!--geld:quick-view:1-->');
    const pressed: string[] = [];
    document.body.addEventListener('click', (event) => pressed.push(event.target instanceof Element ? (event.target.textContent ?? '') : ''));
    expect(overviewChecksList()).toBeNull();
    closeOverviewChecks();
    expect(pressed).toEqual([]);
  });

  it('is found in the drawer inside the Merge status card as well as in the overlay', () => {
    const drawerCard = (list: string): string =>
      `<div class="MiniStatusGrid__x"><section aria-label="Merge status"><section aria-label="Collapse checks"><button>Collapse checks</button></section><section class="StatusDrawer__x" aria-label="Checks"><div>${list}</div></section></section></div>`;
    const list = '<div class="expandableWrapper__x"><div role="group" aria-label="failing checks"></div></div>';
    document.body.innerHTML = card(false);
    openOverviewChecks(document, 40_000);
    document.body.innerHTML = drawerCard(list);
    expect(overviewChecksList()?.classList.contains('StatusDrawer__x')).toBe(true);
    const pressed: string[] = [];
    document.body.addEventListener('click', (event) => pressed.push(event.target instanceof Element ? (event.target.textContent ?? '') : ''));
    document.body.innerHTML = drawerCard('<!--geld:quick-view:1-->');
    expect(overviewChecksList()).toBeNull();
    closeOverviewChecks();
    expect(pressed).toEqual([]);
    document.body.innerHTML = drawerCard(list);
    closeOverviewChecks();
    expect(pressed).toEqual(['Collapse checks']);
  });
});
