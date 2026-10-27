// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { dressArrivals, hideAgentRerunControls, messagesIn, renderChatView, takeAgentViewLink } from './chat';

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
