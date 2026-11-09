// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { compileAuthorRules } from '@geld/core';
import { exactRulesFor, HiddenPeople, hideReasonOf, markedOnGitHub } from './hidden-people';

/**
 * Markup reduced from a public pull request signed out (Nov 2026), with the
 * names and ids replaced: a review requesting changes, hidden as spam, while
 * the sidebar still said "requested changes".
 */
const SPAM_REVIEW = `
<div class="js-timeline-item js-timeline-progressive-focus-container" data-gid="PRR_test">
  <div class="">
    <div id="pullrequestreview-1000001" class="js-comment js-updatable-content js-socket-channel js-targetable-element js-minimize-container">
      <div class="TimelineItem">
        <a href="/Spam-User" class="TimelineItem-avatar mt-n1 avatar circle lh-0 Link"><img data-hovercard-type="user" data-hovercard-url="/users/Spam-User/hovercard" src="https://example.test/spam-user.png" alt="Spam-User" /></a>
        <div class="TimelineItem-body">
          <details class="js-comment Details-element details-reset width-full">
            <summary class="rounded-2 py-0 px-2">
              <div class="d-flex flex-justify-between flex-items-center">
                <h3 class="timeline-comment-header-text f5 color-fg-muted text-normal text-italic"> This comment was marked as spam. </h3>
                <div class="color-fg-muted text-small"><a rel="nofollow" class="Link--secondary" href="/login?return_to=x">Sign in to view</a></div>
              </div>
            </summary>
            <div class="minimized-comment"><include-fragment loading="lazy" src="/acme/widgets/pull/7/reviews/1000001"></include-fragment></div>
          </details>
        </div>
      </div>
    </div>
  </div>
</div>`;

const RESOLVED_COMMENT = `
<div class="js-timeline-item">
  <div class="TimelineItem js-comment-container" id="issuecomment-1">
    <a class="TimelineItem-avatar" href="/octocat"><img data-hovercard-url="/users/octocat/hovercard" src="https://example.test/o.png" alt="" /></a>
    <details><summary><h3 class="timeline-comment-header-text">This comment was marked as resolved.</h3></summary></details>
  </div>
</div>`;

const UNHIDE = `
<div class="js-timeline-item">
  <div class="TimelineItem js-comment-container" id="issuecomment-2">
    <a class="TimelineItem-avatar" href="/apps/spammy"><img src="https://example.test/s.png" alt="" /></a>
    <details><summary><h3 class="timeline-comment-header-text">This comment was marked as abuse.</h3></summary>
      <form action="/acme/repo/issues/comments/2/unminimize" method="post"><button type="submit">Unhide</button></form>
    </details>
  </div>
</div>`;

function page(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder;
}

describe('hideReasonOf', () => {
  it('reads the reason from GitHub’s header', () => {
    expect(hideReasonOf('  This comment was marked as spam. ')).toBe('spam');
    expect(hideReasonOf('This review was marked as off-topic.')).toBe('off-topic');
    expect(hideReasonOf('This comment has been marked as disruptive content.')).toBe('abuse');
    expect(hideReasonOf('This comment has been minimized.')).toBeNull();
  });
});

describe('markedOnGitHub', () => {
  it('finds a review hidden as spam and whose it is, not the sign-in link beside it', () => {
    const found = markedOnGitHub(page(SPAM_REVIEW));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ login: 'Spam-User', bot: false, reason: 'spam', anchor: 'pullrequestreview-1000001', unhide: null });
    expect(found[0]?.root.classList.contains('js-timeline-item')).toBe(true);
  });

  it('leaves comments hidden for what they say (resolved, outdated) alone', () => {
    expect(markedOnGitHub(page(RESOLVED_COMMENT))).toEqual([]);
  });

  it('keeps GitHub’s own Unhide when the page offers it, and reads an App as a bot', () => {
    const [content] = markedOnGitHub(page(UNHIDE));
    expect(content).toMatchObject({ login: 'spammy[bot]', bot: true, reason: 'abuse' });
    expect(content?.unhide?.textContent).toBe('Unhide');
  });
});

describe('HiddenPeople', () => {
  it('hides a person GitHub marked as spam everywhere, until the reader peeks', () => {
    const marked = markedOnGitHub(page(SPAM_REVIEW));
    const hidden = new HiddenPeople(marked, compileAuthorRules([]), new Set());
    expect(hidden.hides('spam-user', false)).toBe(true);
    expect(hidden.hides('octocat', false)).toBe(false);
    expect(hidden.markedRoots()).toHaveLength(1);
    expect(hidden.people()).toEqual([expect.objectContaining({ login: 'Spam-User', peeking: false, why: expect.objectContaining({ by: 'github', reason: 'spam', anchors: ['pullrequestreview-1000001'] }) })]);

    const peeking = new HiddenPeople(marked, compileAuthorRules([]), new Set(['spam-user']));
    expect(peeking.hides('Spam-User', false)).toBe(false);
    expect(peeking.markedRoots()).toEqual([]);
    expect(peeking.people()[0]?.peeking).toBe(true);
  });

  it('hides people and bots matching the reader’s list, listing only those it met', () => {
    const hidden = new HiddenPeople([], compileAuthorRules(['*[bot]', '@spammer']), new Set());
    expect(hidden.people()).toEqual([]);
    expect(hidden.hides('renovate[bot]', true, 'https://example.test/r.png')).toBe(true);
    expect(hidden.hides('Spammer', false)).toBe(true);
    expect(hidden.hides('someone', false)).toBe(false);
    expect(hidden.people().map((person) => [person.login, person.why.by === 'list' ? person.why.rule : ''])).toEqual([
      ['renovate[bot]', '*[bot]'],
      ['Spammer', 'spammer'],
    ]);
  });
});

describe('namesHidden', () => {
  it('finds timeline events about a hidden person, until the reader peeks', () => {
    const event = page(`<div class="TimelineItem"><a href="/acme" data-hovercard-type="organization">acme</a> deleted a comment from <a class="Link--primary text-bold" data-hovercard-type="user" data-hovercard-url="/users/Spam-User/hovercard" href="/Spam-User">Spam-User</a></div>`);
    const other = page(`<div class="TimelineItem"><a class="author" href="/octocat" data-hovercard-type="user">octocat</a> force-pushed</div>`);
    const marked = markedOnGitHub(page(SPAM_REVIEW));
    const hidden = new HiddenPeople(marked, compileAuthorRules([]), new Set());
    expect(hidden.namesHidden(event)).toBe(true);
    expect(hidden.namesHidden(other)).toBe(false);
    expect(new HiddenPeople(marked, compileAuthorRules([]), new Set(['spam-user'])).namesHidden(event)).toBe(false);
  });
});

describe('exactRulesFor', () => {
  it('finds only the lines naming that login, never a wildcard', () => {
    expect(exactRulesFor(['*[bot]', '@Spam-User', 'spam-user', 'spam*'], 'Spam-User')).toEqual(['@Spam-User', 'spam-user']);
  });
});
