// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { detectHeadSha } from './head-sha';
import { restoreAll, teleportInto } from './review/teleport';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('detectHeadSha', () => {
  const row = (sha: string, extra = ''): string => `<div class="TimelineItem"><div class="js-commits-list-item"><a href="/acme/widgets/pull/71/commits/${sha}">${sha.slice(0, 7)}</a>${extra}</div></div>`;

  it('reads the conversation tab from its last commit row, which a live push appends', () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/71');
    document.body.innerHTML = `
      <div class="js-discussion">${row(A)}${row(B)}</div>
      <div class="js-stale-comparison" data-url="/acme/widgets/pull/71/partials/stale?end_commit_oid=${A}"></div>`;
    expect(detectHeadSha()).toBe(B);
    // The socket appends the pushed commit's row; the poller's attribute stays as loaded.
    document.querySelector('.js-discussion')?.insertAdjacentHTML('beforeend', row(C));
    expect(detectHeadSha()).toBe(C);
  });

  it('takes only commit rows for this pull request, never a link in a comment', () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/71');
    // A comment after the last push linking an older commit (and one of another repository's pull request) is
    // not a push; nor is a bare link outside any commit row.
    document.body.innerHTML = `
      <div class="js-discussion">
        ${row(A)}${row(B)}
        <div class="TimelineItem"><div class="comment-body"><a href="https://github.com/acme/widgets/pull/71/commits/${A}">see</a><a href="/acme/gadgets/pull/9/commits/${C}">other</a></div></div>
        <div class="TimelineItem"><a href="/acme/widgets/pull/71/commits/${C}">loose</a></div>
      </div>`;
    expect(detectHeadSha()).toBe(B);
    // With no commit row at all the other hooks answer.
    document.body.innerHTML = `<div data-url="/acme/widgets/pull/71/partials/stale?end_commit_oid=${A}"></div>`;
    expect(detectHeadSha()).toBe(A);
  });

  it('takes a force-push row\'s target when it is the latest push', () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/71');
    // vitest#11625's row: "X force-pushed the branch from a to b", linking compare/a..b and each commit, with no
    // commit row of its own for the rewrite, which GitHub's socket can append live as this one row.
    const forcePush = (from: string, to: string): string => `
      <div class="TimelineItem"><div class="TimelineItem-badge"><svg class="octicon octicon-repo-push"></svg></div>
        <div class="TimelineItem-body"><a href="/alice">alice</a> <a href="/acme/widgets/compare/${from}..${to}">force-pushed</a> the branch from
        <a href="/acme/widgets/commit/${from}"><code>${from.slice(0, 7)}</code></a> to <a href="/acme/widgets/commit/${to}"><code>${to.slice(0, 7)}</code></a>
        <a href="/acme/widgets/compare/${from}..${to}">Compare</a></div></div>`;
    document.body.innerHTML = `<div class="js-discussion">${row(A)}${forcePush(A, B)}</div>`;
    expect(detectHeadSha()).toBe(B);
    // A commit row appended after it is the newer push.
    document.querySelector('.js-discussion')?.insertAdjacentHTML('beforeend', row(C));
    expect(detectHeadSha()).toBe(C);
    // A compare link of another repository, or in a comment, is neither.
    document.body.innerHTML = `<div class="js-discussion">${row(A)}${forcePush(A, B).replaceAll('acme/widgets/compare', 'acme/gadgets/compare')}
      <div class="TimelineItem"><div class="comment-body"><a href="/acme/widgets/compare/${A}..${C}">diff</a></div></div></div>`;
    expect(detectHeadSha()).toBe(A);
  });

  it('orders commit rows by their home, not where a loan has moved them', () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/71');
    document.body.innerHTML = `
      <div class="geld-review"><div class="slot"></div></div>
      <div class="js-discussion">${row(A)}${row(B)}</div>`;
    // The digest shows the newest row in a slot above the timeline; its place at home is still last.
    const newest = document.querySelectorAll('.js-discussion > .TimelineItem')[1];
    const slot = document.querySelector('.slot');
    if (!(newest instanceof HTMLElement) || !(slot instanceof HTMLElement)) throw new Error('fixture');
    teleportInto(slot, [newest]);
    expect(detectHeadSha()).toBe(B);
    restoreAll();
  });

  it('leaves the other pages to their own hooks', () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/71/files');
    document.body.innerHTML = `
      <a href="/acme/widgets/pull/71/commits/${B}">b</a>
      <div data-url="/acme/widgets/pull/71/partials/stale?end_commit_oid=${A}"></div>`;
    expect(detectHeadSha()).toBe(A);
  });
});
