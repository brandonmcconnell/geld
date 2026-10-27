// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { joinCommitSubjects, renderQuickView } from './quick-view';
import { restoreAll } from './teleport';

/**
 * A commit row as GitHub renders it in a pull request's timeline when the
 * subject runs past 72 characters: the link shows the head and ends in "…",
 * the body under the "…" expander begins with the tail, and the link's
 * `title` is the whole message (mintlify/docs#7824, Oct 2026).
 */
function row(subjectHead: string, body: string, title: string): HTMLElement {
  const list = document.createElement('div');
  list.innerHTML = `<div class="TimelineItem"><div class="TimelineItem-body"><div class="js-details-container Details"><div class="d-flex flex-md-row flex-column"><div class="d-flex flex-auto"><div class="pr-1 flex-auto min-width-0"><code><a title="${title}" class="Link--secondary markdown-title" href="/o/r/pull/1/commits/af79eb7">${subjectHead}</a></code><span class="hidden-text-expander inline"><button class="ellipsis-expander js-details-target" type="button">…</button></span></div></div></div><div class="Details-content--hidden mt-2"><pre class="color-fg-muted ws-pre-wrap">${body}</pre></div></div></div></div>`;
  return list;
}

describe('joinCommitSubjects', () => {
  it('reads the subject whole on the link and takes its tail off the body', () => {
    const list = row('docs: soften TypeDoc layout wording and cover namespaces without cate…', '…gories\n\nCo-authored-by: Brandon McConnell &lt;brandon@dreamthinkbuild.com&gt;', 'docs: soften TypeDoc layout wording and cover namespaces without categories\n\nCo-authored-by: Brandon McConnell &lt;brandon@dreamthinkbuild.com&gt;');
    const link = list.querySelector('a');
    const pre = list.querySelector('pre');
    joinCommitSubjects(list);
    expect(link?.textContent).toBe('docs: soften TypeDoc layout wording and cover namespaces without categories');
    expect(pre?.textContent).toBe('Co-authored-by: Brandon McConnell <brandon@dreamthinkbuild.com>');
    expect(pre?.hasAttribute('data-geld-empty')).toBe(false);
    // Twice is once: the join is marked.
    joinCommitSubjects(list);
    expect(link?.textContent).toBe('docs: soften TypeDoc layout wording and cover namespaces without categories');
    // Going home puts GitHub's halves back.
    restoreAll();
    expect(link?.textContent).toBe('docs: soften TypeDoc layout wording and cover namespaces without cate…');
    expect(pre?.textContent).toBe('…gories\n\nCo-authored-by: Brandon McConnell <brandon@dreamthinkbuild.com>');
    expect(link?.hasAttribute('data-geld-joined')).toBe(false);
  });

  it('hides a body that was only the tail, and leaves a row whose halves do not meet alone', () => {
    const only = row('a subject long enough to be cut by GitHub at seventy-two charac…', '…ters', 'a subject long enough to be cut by GitHub at seventy-two characters');
    joinCommitSubjects(only);
    expect(only.querySelector('a')?.textContent).toBe('a subject long enough to be cut by GitHub at seventy-two characters');
    expect(only.querySelector('pre')?.hasAttribute('data-geld-empty')).toBe(true);
    restoreAll();
    // A body that begins with "…" for its own reasons is not the subject's tail: nothing moves.
    const other = row('fix: trim…', '…and then some other thought', 'fix: trim\n\n…and then some other thought');
    joinCommitSubjects(other);
    expect(other.querySelector('a')?.textContent).toBe('fix: trim…');
    expect(other.querySelector('pre')?.textContent).toBe('…and then some other thought');
  });
});

const AVATAR = 'https://avatars.githubusercontent.com/u/10746682?s=40&v=4';

/** A close event as GitHub renders it: the actor's picture and name as links, the words between them bare text (microsoft/vscode#343264, Oct 2026). */
function closeEvent(): HTMLElement {
  const home = document.createElement('div');
  const picture = `<a class="d-inline-block" href="/sandy081"><img class="avatar avatar-user" src="${AVATAR}" width="20" height="20" alt="@sandy081"></a>`;
  home.innerHTML = `<div class="TimelineItem" id="event-1"><div class="TimelineItem-badge"></div><div class="TimelineItem-body">${picture}<a class="author" href="/sandy081">sandy081</a>
          closed this
      <a href="#event-1" class="Link--secondary"><relative-time datetime="2026-10-21T17:35:24Z">Oct 21, 2026</relative-time></a></div></div>`;
  document.body.append(home);
  const node = home.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error('fixture');
  return node;
}

describe('compactEvents', () => {
  it('says a state change once, words and picture', () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    renderQuickView(slot, [closeEvent()]);
    const body = slot.querySelector('.TimelineItem-body');
    // The line says it; the sentence's bare words are hidden with the links around them.
    expect(slot.querySelector('.geld-review__event-words')?.textContent).toBe('closed this');
    const loose = [...(body?.childNodes ?? [])].filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
    expect(loose).toHaveLength(0);
    expect([...(body?.querySelectorAll('[data-geld-event-hidden]') ?? [])].some((node) => node.textContent?.trim() === 'closed this')).toBe(true);
    expect(slot.querySelectorAll('.geld-review__event-who')).toHaveLength(1);
    // Home again, the words are GitHub's bare text as before.
    restoreAll();
    expect(document.querySelector('#event-1 .TimelineItem-body')?.textContent).toContain('closed this');
    expect(document.querySelector('#event-1 [data-geld-event-hidden]')).toBeNull();
  });
});
