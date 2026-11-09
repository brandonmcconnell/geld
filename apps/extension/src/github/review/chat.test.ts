// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { botCommentControls, chatNeedsRedress, dressArrivals, hideAgentRerunControls, messagesIn, parkChats, releaseParkedChats, renderChatView, renderCommentChat, takeAgentViewLink, threadLinesOf } from './chat';

/**
 * Two shapes carry the `minimized-comment` class. A review's own body card
 * (`pullrequestreview-N`, "X left a comment") is the `timeline-comment-group`
 * itself — header, body, edit form and reactions are its direct children —
 * and GitHub gives it the class whether or not the review is minimized; it
 * is the message. A comment that *is* minimized is a wrapper holding a
 * `<details>` (the "This comment has been minimized" summary, then GitHub's
 * compact card); the card inside is the message. Markup reduced from
 * github.com, Oct 2026.
 */

function parse(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const first = holder.firstElementChild;
  if (!(first instanceof HTMLElement)) throw new Error('fixture has no element');
  return first;
}

const REVIEW_CARD = `
<div id="pullrequestreview-5405048471" class="timeline-comment-group js-minimizable-comment-group js-targetable-element my-0 comment previewable-edit js-task-list-container js-comment timeline-comment--caret timeline-comment--caret-nw timeline-comment tmp-ml-n3 current-user minimized-comment">
  <div class="timeline-comment-header clearfix d-flex flex-row flex-items-start">
    <h3 class="f5 text-normal py-2"><div class="d-flex flex-items-center flex-wrap gap-1"><a class="author Link--primary text-bold" href="/apps/cursor">cursor</a> <span>left a comment</span></div></h3>
    <div class="d-flex flex-row-reverse flex-items-center flex-shrink-0 tmp-pl-3"><div class="timeline-comment-actions flex-shrink-0 d-flex flex-items-center"></div></div>
  </div>
  <div class="edit-comment-hide">
    <div class="js-minimize-comment d-none"><form class="js-timeline-comment-minimize d-md-inline-block d-flex"></form></div>
    <task-lists><div class="comment-body markdown-body js-comment-body soft-wrap user-select-contain d-block"><p>Reviewed. One note inline.</p></div></task-lists>
  </div>
  <form class="js-comment-update"></form>
  <div class="pr-review-reactions d-flex gap-1"><div class="comment-reactions just-bottom js-reactions-container js-reaction-buttons-container social-reactions reactions-container d-flex"></div></div>
</div>`;

const MINIMIZED_COMMENT = `
<div class="timeline-comment-group js-minimizable-comment-group js-targetable-element my-0" id="issuecomment-5840397524">
  <div class="minimized-comment position-relative js-comment">
    <details class="Details-element details-reset">
      <summary class="btn-link text-small text-italic"><span>This comment has been minimized.</span></summary>
      <div class="review-comment-contents js-suggested-changes-contents">
        <div class="timeline-comment-header clearfix d-flex"><h3 class="f5 text-normal"><a class="author Link--primary text-bold" href="/apps/github-actions">github-actions</a> commented</h3></div>
        <div class="edit-comment-hide"><task-lists><div class="comment-body markdown-body js-comment-body d-block"><p>Build cache report: 12 hits.</p></div></task-lists></div>
      </div>
    </details>
  </div>
</div>`;

describe('messagesIn', () => {
  it("reads a review's own body card as the message, minimized-comment class and all", () => {
    const card = parse(REVIEW_CARD);
    const messages = messagesIn(card, false);
    expect(messages).toEqual([card]);
    // The header is the card's own child, so it is a part of the message (dressed as its author line), not a
    // bubble of its own: nothing inside the card is a message.
    expect(messages[0]?.querySelector('.timeline-comment-header')?.parentElement).toBe(card);
  });

  it("leaves a minimized comment's wrapper alone and reads the card inside its details", () => {
    const group = parse(MINIMIZED_COMMENT);
    const wrapper = group.querySelector<HTMLElement>('.minimized-comment');
    const inner = group.querySelector<HTMLElement>('.review-comment-contents');
    expect(wrapper).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(messagesIn(group, false)).toEqual([inner]);
    // Handed the wrapper itself (the node the panel moves), the same card is the message.
    if (wrapper !== null) expect(messagesIn(wrapper, false)).toEqual([inner]);
  });

  it('reads the details element itself as the wrapper when GitHub puts the class on it', () => {
    const group = parse(MINIMIZED_COMMENT);
    const wrapper = group.querySelector<HTMLElement>('.minimized-comment');
    const details = group.querySelector<HTMLElement>('details');
    if (wrapper === null || details === null) throw new Error('fixture lost its parts');
    details.classList.add('minimized-comment', 'js-comment');
    wrapper.replaceWith(details);
    expect(messagesIn(group, false)).toEqual([group.querySelector('.review-comment-contents')]);
  });
});

describe('takeAgentViewLink', () => {
  const GREPTILE = `<div><h2><a href="https://app.greptile.com/api/retrigger?id=1"><picture><img alt="Retrigger" src="r.svg"></picture></a><a href="https://app.greptile.com/org/github/o/r/-/pull/9"><picture><img alt="View in Greptile" src="v.svg"></picture></a>Confidence Score: 5/5</h2><p>Safe.</p></div>`;
  const GREPTILE_PARAGRAPH = `<div><p><a href="https://app.greptile.com/api/retrigger?id=1"><picture><img alt="Retrigger" src="r.svg"></picture></a><a href="https://app.greptile.com/org/github/o/r/-/pull/9"><picture><img alt="View in Greptile" src="v.svg"></picture></a><br clear="all"></p><p>Safe.</p></div>`;
  const DEVIN = `<div><h2>Devin Review: No Issues Found</h2><p><a href="https://app.devin.ai/review/o/r/pull/9" target="_blank"><picture><img src="d.svg" alt="Devin Review"></picture></a></p></div>`;
  const CODERABBIT = `<div><p><a href="https://app.coderabbit.ai/change-stack/o/r/pull/9?scope=x"><img src="c.svg" alt="Review in Change Stack →"></a></p><p>Actionable comments posted: 0</p></div>`;

  it("takes Greptile's view badge and leaves the heading it shares with words", () => {
    const body = parse(GREPTILE);
    expect(takeAgentViewLink(body)).toEqual({ href: 'https://app.greptile.com/org/github/o/r/-/pull/9', label: 'View in Greptile' });
    expect(body.querySelector('a[href*="/pull/9"]')?.hasAttribute('data-geld-agent-view')).toBe(true);
    expect(body.querySelector('h2')?.hasAttribute('data-geld-agent-rerun')).toBe(false);
    // Taken once: the second look finds the same link, already marked.
    expect(takeAgentViewLink(body)?.label).toBe('View in Greptile');
  });

  it("takes Greptile's badge when it links through the tenant switch", () => {
    const href = 'https://app.greptile.com/-/switch-tenant?tenant=geld&next=%2Fbrandonmcconnell%2Fgeld%2Fpull%2F367&utm_source=greptile_review&utm_medium=github&utm_campaign=view_in_greptile';
    const body = parse(`<div><h2><a href="https://app.greptile.com/api/retrigger?id=1"><picture><img alt="Retrigger" src="r.svg"></picture></a><a href="${href.replace(/&/g, '&amp;')}"><picture><img alt="View in Greptile" src="v.svg" align="right"></picture></a>Confidence Score: 5/5</h2><p>Safe.</p></div>`);
    expect(takeAgentViewLink(body)).toEqual({ href, label: 'View in Greptile' });
    expect(body.querySelector('a[href*="switch-tenant"]')?.hasAttribute('data-geld-agent-view')).toBe(true);
    expect(body.querySelector('h2')?.hasAttribute('data-geld-agent-rerun')).toBe(false);
    // The switch with no run behind it (a tenant's home) is not the badge.
    expect(takeAgentViewLink(parse('<div><p><a href="https://app.greptile.com/-/switch-tenant?tenant=geld&amp;next=%2F"><img alt="Greptile" src="g.svg"></a></p></div>'))).toBeNull();
  });

  it('gives a bot comment shown in a hover card Geld\u2019s View and Rerun in place of its badges', () => {
    const body = parse(GREPTILE_PARAGRAPH);
    const asked: string[] = [];
    const controls = botCommentControls(body, { rerun: { bot: 'Greptile', running: false, onRerun: () => asked.push('rerun') } });
    const words = (list: readonly HTMLElement[]): readonly (string | null | undefined)[] => list.map((control) => control.querySelector('a, button')?.textContent);
    expect(words(controls)).toEqual(['View', 'Rerun']);
    expect(controls[0]?.querySelector('a')?.getAttribute('href')).toBe('https://app.greptile.com/org/github/o/r/-/pull/9');
    // Both badges hidden, and the paragraph they shared with it.
    expect(body.querySelector('a[href*="retrigger"]')?.hasAttribute('data-geld-agent-rerun')).toBe(true);
    expect(body.querySelector('a[href*="/pull/9"]')?.hasAttribute('data-geld-agent-view')).toBe(true);
    expect(body.querySelector('p')?.hasAttribute('data-geld-agent-rerun')).toBe(true);
    controls[1]?.querySelector('button')?.click();
    expect(asked).toEqual(['rerun']);
    // Drawn while the bot was idle, clicked once it runs (a card left open over a rebuilt panel): it asks first.
    let running = false;
    const stale = botCommentControls(parse(GREPTILE), { rerun: { bot: 'Greptile', running: false, isRunning: () => running, onRerun: () => asked.push('again') } });
    running = true;
    stale[1]?.querySelector('button')?.click();
    expect(asked).toEqual(['rerun']);
    expect(document.querySelector('dialog')?.textContent).toContain('Greptile is already running');
    document.querySelector('dialog')?.remove();
    // An earlier run's summary: See latest instead of Rerun, and the bot's re-trigger badge hidden all the same.
    const earlier = parse(GREPTILE);
    expect(words(botCommentControls(earlier, { latest: { bot: 'Greptile', onOpen: () => undefined } }))).toEqual(['View', 'See latest']);
    expect(earlier.querySelector('a[href*="retrigger"]')?.hasAttribute('data-geld-agent-rerun')).toBe(true);
    // A bot with no trigger and no newer summary: View alone, and its re-trigger badge (it has none to stand for) stays.
    expect(words(botCommentControls(parse(DEVIN), {}))).toEqual(['View']);
  });

  it('hides the paragraph both Greptile badges share once both are taken', () => {
    const body = parse(GREPTILE_PARAGRAPH);
    hideAgentRerunControls(body);
    expect(body.querySelector('p')?.hasAttribute('data-geld-agent-rerun')).toBe(false);
    takeAgentViewLink(body);
    expect(body.querySelector('p')?.hasAttribute('data-geld-agent-rerun')).toBe(true);
    expect(body.querySelectorAll('p')[1]?.hasAttribute('data-geld-agent-rerun')).toBe(false);
  });

  it("reads Devin's and CodeRabbit's badges, arrow dropped, and none where there is none", () => {
    const devin = parse(DEVIN);
    expect(takeAgentViewLink(devin)).toEqual({ href: 'https://app.devin.ai/review/o/r/pull/9', label: 'Devin Review' });
    expect(devin.querySelector('p')?.hasAttribute('data-geld-agent-rerun')).toBe(true);
    expect(takeAgentViewLink(parse(CODERABBIT))).toEqual({ href: 'https://app.coderabbit.ai/change-stack/o/r/pull/9?scope=x', label: 'Review in Change Stack' });
    expect(takeAgentViewLink(parse('<div><p>Nothing to see.</p></div>'))).toBeNull();
    // A text link to the bot's site before its badge is not the badge: the badge is the linked image on the run's path.
    const textFirst = parse('<div><p>Change your <a href="https://app.coderabbit.ai/settings/repository">review settings</a>.</p><p><a href="https://app.coderabbit.ai/change-stack/o/r/pull/9?scope=x"><img src="c.svg" alt="Review in Change Stack →"></a></p></div>');
    expect(takeAgentViewLink(textFirst)?.href).toBe('https://app.coderabbit.ai/change-stack/o/r/pull/9?scope=x');
    expect(textFirst.querySelector('a[href*="settings"]')?.hasAttribute('data-geld-agent-view')).toBe(false);
    // A linked image to the site that is not a run (a logo linking home) is left alone too.
    expect(takeAgentViewLink(parse('<div><p><a href="https://app.greptile.com/"><img alt="Greptile" src="g.svg"></a> reviewed this.</p></div>'))).toBeNull();
    // A Cursor cloud agent's review ends in "Open in Web" beside "View Automation": the run is the view, and the
    // other button stays, so the block holding both keeps showing.
    const cursor = parse('<div><div><a href="https://cursor.com/agents/bc-1?cursor_ref=pr_footer" rel="nofollow"><picture><img alt="Open in Web" src="o.png"></picture></a> <a href="https://cursor.com/automations/au-1"><picture><img alt="View Automation" src="a.png"></picture></a></div></div>');
    expect(takeAgentViewLink(cursor)).toEqual({ href: 'https://cursor.com/agents/bc-1?cursor_ref=pr_footer', label: 'Open in Web' });
    expect(cursor.querySelector('div > div')?.hasAttribute('data-geld-agent-rerun')).toBe(false);
  });
});

/** A review thread of one comment, as the classic view renders it (reduced), with a reply box. */
function threadWith(comments: readonly { id: string; author: string }[]): HTMLElement {
  return parse(`
<review-thread-collapsible class="js-resolvable-timeline-thread-container" data-resolved="false">
  <div class="js-comments-holder">
    ${comments
      .map(
        ({ id, author }) => `
    <div id="${id}" class="review-comment js-comment js-minimizable-comment-group">
      <div class="ml-n1 flex-items-center clearfix d-flex flex-row flex-items-start">
        <h3 class="f5 text-normal py-2" style="flex: 1 1 auto"><div class="d-flex flex-items-center flex-wrap gap-1"><span class="d-inline-flex"><img class="avatar" src="https://avatars.githubusercontent.com/u/1?s=48" alt="@${author}"></span><strong><a class="author Link--primary text-bold" href="/${author}">${author}</a></strong> <a href="#${id}" class="Link--secondary js-timestamp"><relative-time datetime="2026-10-15T20:53:53Z">Oct 15, 2026</relative-time></a></div></h3>
        <div class="d-flex flex-row-reverse flex-items-center flex-shrink-0"><div class="timeline-comment-actions flex-shrink-0 d-flex flex-items-center"></div></div>
      </div>
      <task-lists><div class="comment-body markdown-body js-comment-body soft-wrap d-block"><p>test</p></div></task-lists>
    </div>`,
      )
      .join('')}
  </div>
  <div class="review-thread-reply"><form class="js-inline-comment-form"><textarea></textarea><button type="submit">Comment</button></form></div>
</review-thread-collapsible>`);
}

describe('dressArrivals', () => {
  it('dresses a comment GitHub appended to a loaned thread where it stands, and re-reads the run around it', () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="user-login" content="brandonmcconnell">');
    const thread = threadWith([{ id: 'discussion_r1', author: 'cubic-dev-ai[bot]' }, { id: 'discussion_r2', author: 'brandonmcconnell' }]);
    document.body.append(thread);
    const slot = document.createElement('div');
    document.body.append(slot);
    renderChatView(slot, [thread], {
      pathOf: () => '',
      sourceOf: () => null,
      sourceOpen: () => false,
      onCopy: () => undefined,
      onToggleSource: () => undefined,
      onOpenAnchor: () => undefined,
    });
    const before = [...slot.querySelectorAll('[data-geld-message]')].map((message) => `${message.id}:${message.getAttribute('data-geld-run')}:${message.hasAttribute('data-geld-mine')}`);
    expect(before).toEqual(['discussion_r1:only:false', 'discussion_r2:only:true']);
    expect(dressArrivals(document)).toBe(false);
    // The reader's reply lands as GitHub's raw card after the last comment.
    const reply = threadWith([{ id: 'discussion_r3', author: 'brandonmcconnell' }]).querySelector('#discussion_r3');
    if (!(reply instanceof HTMLElement)) throw new Error('fixture');
    thread.querySelector('.js-comments-holder')?.append(reply);
    expect(reply.hasAttribute('data-geld-message')).toBe(false);
    expect(dressArrivals(document)).toBe(true);
    const after = [...slot.querySelectorAll('[data-geld-message]')].map((message) => `${message.id}:${message.getAttribute('data-geld-run')}:${message.hasAttribute('data-geld-mine')}`);
    expect(after).toEqual(['discussion_r1:only:false', 'discussion_r2:first:true', 'discussion_r3:last:true']);
    expect(reply.querySelector('[data-geld-part="meta"]')).not.toBeNull();
    expect(reply.querySelector('[data-geld-part="bubble"]')).not.toBeNull();
    // Nothing left to dress: the pass that follows has no reason to rebuild the chat.
    expect(dressArrivals(document)).toBe(false);
  });
});

/**
 * An Overview thread comment as GitHub's bundle builds it (Nov 2026): the header in its inner container, then the
 * wrapper (the bubble) holding the body's container while the comment is shown and the editor while it is edited.
 * The body's container holds the words and, beside them, the reactions toolbar with the picker's button.
 */
const OVERVIEW_VIEW = `<div class="BodyHTMLContainer__vHY_bu"><div><div class="markdown-body"><p>A note.</p></div></div><div class="d-flex flex-direction-column gap-2"><div class="d-flex flex-direction-column mt-2"><div role="toolbar" aria-label="Reactions for octocat's comment"><button type="button" aria-label="👍 1 reaction">👍 1</button><button type="button" class="ReactionViewerAnchorButton__BIXMSn" aria-label="Add reaction">☺</button></div></div></div></div>`;
const OVERVIEW_THREAD = `<article><div class="header__x"><div><h2><a href="/o/r/pull/1/changes#r42">\u200esrc/a.ts</a></h2></div></div><div data-testid="review-thread"><div id="discussion_r42" class="ReviewThreadContainer__zrJcUC"><div class="ReviewThreadInnerContainer__cag4y4"><div data-testid="comment-header"><a data-testid="author-link" href="/octocat">octocat</a><button type="button" aria-label="More actions for octocat's comment, 2 days ago">⋯</button></div></div><div class="ReviewThreadWrapper__vspFQB" id="wrapper">${OVERVIEW_VIEW}</div></div></div></article>`;

describe("a comment's controls after GitHub redraws it", () => {
  const handlers = { pathOf: () => 'src/a.ts', onCopy: () => undefined, sourceOf: () => null, sourceOpen: () => false, onToggleSource: () => undefined, onOpenAnchor: () => undefined };
  const render = (html: string): { slot: HTMLElement; message: HTMLElement } => {
    document.body.innerHTML = `<div id="home">${html}</div><section class="geld-review"><div id="slot"></div></section>`;
    const thread = document.querySelector('#home > *');
    const slot = document.getElementById('slot');
    if (!(thread instanceof HTMLElement) || slot === null) throw new Error('fixture');
    renderChatView(slot, [thread], handlers);
    const message = slot.querySelector<HTMLElement>('[data-geld-message]');
    if (message === null) throw new Error('fixture has no message');
    return { slot, message };
  };
  const sideOf = (message: HTMLElement): readonly string[] =>
    [...(message.querySelector(':scope > .geld-review__msg-side')?.children ?? [])].map((slot) => slot.querySelector('button')?.getAttribute('aria-label') ?? '');
  const bubbleOf = (message: HTMLElement): HTMLElement => {
    const bubble = message.querySelector<HTMLElement>(':scope > [data-geld-part="bubble"]');
    if (bubble === null) throw new Error('message has no bubble');
    return bubble;
  };

  it('puts the Overview\'s reaction button back on the side when its editor closes', () => {
    const { slot, message } = render(OVERVIEW_THREAD);
    expect(sideOf(message)).toEqual(['Add reaction', "More actions for octocat's comment, 2 days ago"]);
    expect(message.querySelector(':scope > .geld-review__msg-reactions [role="toolbar"]')).not.toBeNull();
    const wrapper = bubbleOf(message);
    // Edit: React drops the body's container from the wrapper, placeholders and all, and mounts the editor.
    wrapper.replaceChildren(parse('<div class="flex-1"><textarea aria-label="Update comment"></textarea><button type="button">Cancel</button></div>'));
    expect(dressArrivals(document)).toBe(true);
    // The discarded copies leave with their home: no pills under the editor, no dead reaction button beside it.
    expect(message.querySelector('.geld-review__msg-reactions')).toBeNull();
    expect(sideOf(message)).toEqual(["More actions for octocat's comment, 2 days ago"]);
    expect(document.querySelectorAll('button[class*="ReactionViewerAnchorButton"]')).toHaveLength(0);
    // Cancel: a fresh body's container, its reaction button inside the bubble again.
    wrapper.replaceChildren(parse(OVERVIEW_VIEW));
    expect(chatNeedsRedress(slot.querySelector<HTMLElement>('.geld-review__chat') ?? message)).toBe(true);
    expect(dressArrivals(document)).toBe(true);
    expect(sideOf(message)).toEqual(['Add reaction', "More actions for octocat's comment, 2 days ago"]);
    expect(wrapper.querySelector('button[class*="ReactionViewerAnchorButton"]')).toBeNull();
    expect(document.querySelectorAll('button[class*="ReactionViewerAnchorButton"]')).toHaveLength(1);
    expect(message.querySelectorAll(':scope > .geld-review__msg-reactions')).toHaveLength(1);
    expect(message.querySelector(':scope > .geld-review__msg-reactions [role="toolbar"]')).not.toBeNull();
    // Settled: the pass that follows finds nothing to redress, and nothing more to dress.
    expect(chatNeedsRedress(slot.querySelector<HTMLElement>('.geld-review__chat') ?? message)).toBe(false);
    expect(dressArrivals(document)).toBe(false);
    releaseParkedChats();
  });

  it('puts back a reaction button React made anew inside the toolbar that stands under the bubble', () => {
    const { message } = render(OVERVIEW_THREAD);
    const toolbar = message.querySelector<HTMLElement>('.geld-review__msg-reactions [role="toolbar"]');
    const old = message.querySelector<HTMLElement>('.geld-review__msg-side button[class*="ReactionViewerAnchorButton"]');
    if (toolbar === null || old === null) throw new Error('fixture');
    // What the portal's guard does for React: the loaned button goes, the new one lands in its parent.
    old.remove();
    toolbar.append(parse('<button type="button" class="ReactionViewerAnchorButton__BIXMSn" aria-label="Add reaction">☺</button>'));
    expect(dressArrivals(document)).toBe(true);
    expect(sideOf(message)).toEqual(['Add reaction', "More actions for octocat's comment, 2 days ago"]);
    expect(toolbar.querySelector('button[class*="ReactionViewerAnchorButton"]')).toBeNull();
    releaseParkedChats();
  });

  it('leaves a one-bubble comment\'s controls where they are when GitHub draws it again', () => {
    document.body.innerHTML = `<div id="home"><article id="issuecomment-7"><div data-testid="comment-header"><a data-testid="avatar-link" href="/octocat">octocat</a><button type="button" aria-label="More actions for octocat's comment, 2 days ago">⋯</button></div><div class="body" id="body">${OVERVIEW_VIEW}</div></article></div><section class="geld-review"><div id="slot"></div></section>`;
    const slot = document.getElementById('slot');
    const comment = document.getElementById('issuecomment-7');
    const body = document.getElementById('body');
    if (slot === null || comment === null || body === null) throw new Error('fixture');
    // The row above wears its ⋯ and the reactions stay in the bubble: nothing moves, before or after a redraw.
    renderCommentChat(slot, comment);
    body.replaceChildren(parse(OVERVIEW_VIEW));
    expect(dressArrivals(document)).toBe(false);
    expect(comment.querySelector('.geld-review__msg-side')).toBeNull();
    expect(body.querySelector('button[class*="ReactionViewerAnchorButton"]')).not.toBeNull();
    expect(chatNeedsRedress(slot.querySelector<HTMLElement>('.geld-review__chat') ?? comment)).toBe(false);
    releaseParkedChats();
  });

  it('leaves a classic comment\'s controls on the side through Edit, Cancel and Update', () => {
    const { message } = render(`<div class="js-resolvable-timeline-thread-container"><div id="discussion_r42" class="review-comment js-comment"><div class="timeline-comment-header"><a class="author" href="/octocat">octocat</a><div class="timeline-comment-actions"><details class="details-overlay"><summary aria-label="Show options">⋯</summary><details-menu class="dropdown-menu"><button type="button" class="js-comment-edit-button">Edit</button></details-menu></details></div></div><div class="edit-comment-hide"><task-lists><div class="comment-body markdown-body js-comment-body"><p>A note.</p></div></task-lists></div><div class="comment-reactions js-reactions-container"><reactions-menu><details class="js-add-reaction"><summary id="react-42" aria-label="Add reaction">☺</summary></details></reactions-menu></div><div class="js-comment-update-fragment"></div></div></div>`);
    const placed = (): readonly string[] => [...(message.querySelector(':scope > .geld-review__msg-side')?.children ?? [])].map((slot) => slot.querySelector('summary')?.getAttribute('aria-label') ?? '');
    expect(placed()).toEqual(['Add reaction', 'Show options']);
    // GitHub's Edit and Cancel toggle a class, its deferred edit form lands once, and Update rewrites the body's HTML.
    message.classList.add('is-comment-editing');
    message.querySelector('.js-comment-update-fragment')?.replaceWith(parse('<form class="js-comment-update"><textarea></textarea><button type="button" class="js-comment-cancel-button">Cancel</button></form>'));
    expect(dressArrivals(document)).toBe(false);
    message.classList.remove('is-comment-editing');
    const body = message.querySelector('.js-comment-body');
    if (body !== null) body.innerHTML = '<p>A better note.</p>';
    expect(dressArrivals(document)).toBe(false);
    expect(placed()).toEqual(['Add reaction', 'Show options']);
    expect(message.querySelector('[data-geld-part="bubble"] summary')).toBeNull();
    releaseParkedChats();
  });
});

describe('a thread chat parked over a panel rebuild', () => {
  const byId = (id: string): HTMLElement => {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) throw new Error(`fixture has no #${id}`);
    return element;
  };
  const panel = (): HTMLElement => {
    const element = document.querySelector('.geld-review');
    if (!(element instanceof HTMLElement)) throw new Error('fixture has no panel');
    return element;
  };
  const handlers = { pathOf: () => 'src/a.ts', onCopy: () => undefined, sourceOf: () => null, sourceOpen: () => false, onToggleSource: () => undefined, onOpenAnchor: () => undefined };
  const threadAt = (home: HTMLElement): HTMLElement => {
    home.innerHTML = '<div class="js-resolvable-timeline-thread-container"><div id="discussion_r42" class="review-comment js-comment"><div class="timeline-comment-header"><a class="author" href="/octocat">octocat</a></div><div class="comment-body markdown-body"><p>A note.</p></div></div></div>';
    const thread = home.firstElementChild;
    if (!(thread instanceof HTMLElement)) throw new Error('fixture');
    return thread;
  };

  it('comes back with its thread when the same thread is rendered again', () => {
    document.body.innerHTML = '<div id="home"></div><section class="geld-review"><div id="slot"></div></section>';
    const home = byId('home');
    const slot = byId('slot');
    const thread = threadAt(home);
    renderChatView(slot, [thread], handlers);
    const chats = slot.querySelector('.geld-review__chats');
    parkChats(panel());
    renderChatView(slot, [thread], handlers);
    expect(slot.querySelector('.geld-review__chats')).toBe(chats);
    expect(slot.contains(thread)).toBe(true);
    releaseParkedChats();
  });

  it('is not taken back without its thread: GitHub replaced the thread at home, same anchor and path', () => {
    document.body.innerHTML = '<div id="home"></div><section class="geld-review"><div id="slot"></div></section>';
    const home = byId('home');
    const slot = byId('slot');
    const stale = threadAt(home);
    renderChatView(slot, [stale], handlers);
    const chats = slot.querySelector('.geld-review__chats');
    // What `dropOrphanedLoans` leaves: the stale copy gone from the chat, a fresh one at home under the same anchor.
    stale.remove();
    const fresh = threadAt(document.createElement('div'));
    home.replaceChildren(fresh);
    parkChats(panel());
    renderChatView(slot, [fresh], handlers);
    expect(slot.querySelector('.geld-review__chats')).not.toBe(chats);
    expect(slot.contains(fresh)).toBe(true);
    releaseParkedChats();
  });
});

/** Thread headings and snippets reduced from brandonmcconnell/geld#516 and #509 (Nov 2026), classic and Overview. */
describe('threadLinesOf', () => {
  const overview = (words: string): HTMLElement => parse(`<article><div class="header__8DCKRC"><div><h2><a href="/o/r/pull/1/changes#r9">\u200eapps/a.ts</a><span role="tooltip">apps/a.ts</span><span class="f6 fgColor-muted">${words}</span></h2></div></div></article>`);
  const classicRow = (left: string, right: string): string => `<tr><td class="blob-num" ${left === '' ? '' : `data-line-number="${left}"`}></td><td class="blob-num" ${right === '' ? '' : `data-line-number="${right}"`}></td><td class="blob-code"></td></tr>`;

  it('reads the Overview heading, a range or one line', () => {
    expect(threadLinesOf(overview('Lines 845 - 853'))).toEqual({ start: 845, end: 853 });
    expect(threadLinesOf(overview('Line 8230'))).toEqual({ start: 8230, end: 8230 });
  });

  it('reads the classic "Comment on lines +3331 to +3335"', () => {
    const thread = parse('<div class="js-resolvable-timeline-thread-container"><div class="f6 py-2 border-bottom"><div class="f6 color-fg-muted">Comment on lines <span class="js-multi-line-preview-start">+3331</span> to <span class="js-multi-line-preview-end">+3335</span></div></div></div>');
    expect(threadLinesOf(thread)).toEqual({ start: 3331, end: 3335 });
  });

  it('takes a single classic line from the snippet\'s last numbered row, not from a table in a comment', () => {
    const thread = parse(`<div class="js-resolvable-timeline-thread-container"><div class="blob-wrapper"><table>${classicRow('8227', '')}${classicRow('', '8230')}<tr><td></td></tr></table></div><div class="comment-body"><div class="blob-wrapper"><table>${classicRow('1', '2')}</table></div></div></div>`);
    expect(threadLinesOf(thread)).toEqual({ start: 8230, end: 8230 });
  });

  it('says nothing when the thread names no line', () => {
    expect(threadLinesOf(parse('<div class="js-resolvable-timeline-thread-container"><p>Hi</p></div>'))).toBeNull();
  });
});

describe('a thread chat\'s head and composer', () => {
  const handlers = { pathOf: () => 'src/a.ts', onCopy: () => undefined, sourceOf: () => null, sourceOpen: () => false, onToggleSource: () => undefined, onOpenAnchor: () => undefined };
  const classic = (resolved: boolean): string => `<div class="js-resolvable-timeline-thread-container"${resolved ? ' data-resolved="true"' : ''}><div class="f6 py-2 border-bottom"><div class="f6 color-fg-muted">Comment on lines <span class="js-multi-line-preview-start">+12</span> to <span class="js-multi-line-preview-end">+14</span></div></div><div id="discussion_r42" class="review-comment js-comment"><div class="timeline-comment-header"><a class="author" href="/octocat">octocat</a></div><div class="comment-body markdown-body"><p>A note.</p></div></div><div class="review-thread-reply"><div class="js-inline-comment-form-container"><button type="button" class="review-thread-reply-button">Reply...</button></div><form class="js-resolvable-timeline-thread-form" action="/o/r/pull/1/threads/7/${resolved ? 'unresolve' : 'resolve'}">${resolved ? '<strong>octocat</strong> marked this conversation as resolved.' : ''}<button type="submit">${resolved ? 'Unresolve conversation' : 'Resolve conversation'}</button></form></div></div>`;
  const render = (html: string): { slot: HTMLElement; thread: HTMLElement } => {
    document.body.innerHTML = `<div id="home">${html}</div><section class="geld-review"><div id="slot"></div></section>`;
    const thread = document.querySelector('#home > *');
    const slot = document.getElementById('slot');
    if (!(thread instanceof HTMLElement) || slot === null) throw new Error('fixture');
    renderChatView(slot, [thread], handlers);
    return { slot, thread };
  };

  it('names the lines after the path and resolves through GitHub\'s own button', () => {
    const { slot } = render(classic(false));
    expect(slot.querySelector('.geld-review__chat-lines')?.textContent).toBe('12-14');
    const resolve = slot.querySelector<HTMLButtonElement>('.geld-review__chat-resolve');
    expect(resolve?.getAttribute('aria-label')).toBe('Resolve conversation');
    let pressed = 0;
    slot.querySelector('form.js-resolvable-timeline-thread-form button')?.addEventListener('click', (event) => {
      event.preventDefault();
      pressed += 1;
    });
    resolve?.click();
    expect(pressed).toBe(1);
    releaseParkedChats();
  });

  it('offers Unresolve on a resolved classic thread, in the row and the head, which names who resolved it', () => {
    const { slot } = render(classic(true));
    const resolve = slot.querySelector('.geld-review__chat-resolve');
    expect(resolve?.getAttribute('aria-label')).toBe('Unresolve conversation');
    expect(resolve?.getAttribute('title')).toBe('Unresolve conversation \u00b7 resolved by octocat');
    expect(slot.querySelector('.geld-review__composer-side .geld-review__composer-label')?.textContent).toBe('Unresolve');
    expect(slot.querySelector('.geld-review__composer-side strong')?.hasAttribute('data-geld-spoken-for')).toBe(true);
    releaseParkedChats();
  });

  it('follows the thread GitHub swaps in after a classic Resolve', async () => {
    const { slot, thread } = render(classic(false));
    const fresh = parse(classic(true));
    fresh.setAttribute('data-geld-teleported', thread.getAttribute('data-geld-teleported') ?? '');
    thread.replaceWith(fresh);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resolve = slot.querySelector<HTMLButtonElement>('.geld-review__chat-resolve');
    expect(resolve?.getAttribute('aria-label')).toBe('Unresolve conversation');
    let pressed = 0;
    fresh.querySelector('form button')?.addEventListener('click', (event) => {
      event.preventDefault();
      pressed += 1;
    });
    resolve?.click();
    expect(pressed).toBe(1);
    releaseParkedChats();
  });

  it('keeps the head\'s Unresolve when the thread\'s path cannot be read', () => {
    document.body.innerHTML = `<div id="home">${classic(true)}</div><section class="geld-review"><div id="slot"></div></section>`;
    const thread = document.querySelector('#home > *');
    const slot = document.getElementById('slot');
    if (!(thread instanceof HTMLElement) || slot === null) throw new Error('fixture');
    renderChatView(slot, [thread], { ...handlers, pathOf: () => '' });
    expect(slot.querySelector('.geld-review__chat-path')).toBeNull();
    expect(slot.querySelector('.geld-review__chat-lines')?.textContent).toBe('12-14');
    expect(slot.querySelector('.geld-review__chat-resolve')?.getAttribute('aria-label')).toBe('Unresolve conversation');
    releaseParkedChats();
  });

  it('leaves the Overview\'s reply row as GitHub draws it', () => {
    const { slot } = render('<article><div class="header__x"><div><h2><a href="/o/r/pull/1/changes#r42">\u200esrc/a.ts</a><span class="f6">Line 3</span></h2><a aria-label="Jump to the comment in the diff for src/a.ts" href="/o/r/pull/1/changes#r42"></a><button type="button" aria-label="Resolve conversation in src/a.ts, line 3"></button></div></div><div id="discussion_r42"><div data-testid="comment-header"><a data-testid="author-link" href="/octocat">octocat</a></div><div class="markdown-body"><p>A note.</p></div></div><div class="p-2"><div class="d-flex"><button type="button" class="CompactCommentInputContainer__x">Write a reply</button><button type="button">Resolve</button></div></div></article>');
    expect(slot.querySelector('.geld-review__chat-lines')?.textContent).toBe('3');
    expect(slot.querySelector('.geld-review__chat-jump')?.getAttribute('href')).toBe('/o/r/pull/1/changes#r42');
    expect(slot.querySelector('.geld-review__composer-side')).toBeNull();
    expect(slot.querySelector('.geld-review__chat-resolve')?.getAttribute('aria-label')).toBe('Resolve conversation');
    expect(slot.querySelector<HTMLElement>('.geld-review__composer-unresolve')?.hidden).toBe(true);
    releaseParkedChats();
  });

  it('lets go of the old row\'s watcher when GitHub redraws the Overview\'s reply row', async () => {
    const { slot } = render('<article><div class="header__x"><div><h2><a href="/o/r/pull/1/changes#r42">\u200esrc/a.ts</a></h2><button type="button" aria-label="Unresolve conversation in src/a.ts, line 3"></button></div></div><div id="discussion_r42"><div data-testid="comment-header"><a data-testid="author-link" href="/octocat">octocat</a></div><div class="markdown-body"><p>A note.</p></div></div><div class="p-2" id="reply"><div class="d-flex"><button type="button" class="CompactCommentInputContainer__x">Write a reply</button></div></div></article>');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    slot.querySelector('#reply')?.replaceChildren(parse('<div class="d-flex"><button type="button" class="CompactCommentInputContainer__x">Write a reply</button></div>'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
    releaseParkedChats();
  });

  it('adds Unresolve to the Overview\'s row once resolved, where GitHub draws none', () => {
    const { slot } = render('<article><div class="header__x"><div><h2><a href="/o/r/pull/1/changes#r42">\u200esrc/a.ts</a><span class="f6">Line 3</span></h2><button type="button" aria-label="Unresolve conversation in src/a.ts, line 3"></button></div></div><div id="discussion_r42"><div data-testid="comment-header"><a data-testid="author-link" href="/octocat">octocat</a></div><div class="markdown-body"><p>A note.</p></div></div><div class="p-2"><div class="d-flex"><button type="button" class="CompactCommentInputContainer__x">Write a reply</button></div></div></article>');
    const unresolve = slot.querySelector<HTMLButtonElement>('.geld-review__composer-unresolve');
    expect(unresolve?.hidden).toBe(false);
    let pressed = 0;
    slot.querySelector('.geld-review__chat-body button[aria-label^="Unresolve conversation in"]')?.addEventListener('click', () => {
      pressed += 1;
    });
    unresolve?.click();
    expect(pressed).toBe(1);
    releaseParkedChats();
  });
});
