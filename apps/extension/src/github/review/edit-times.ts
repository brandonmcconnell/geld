/**
 * A comment's edit history, read from GitHub's own partials. The header says
 * only "edited"; the times are in the edit-history log the header's dropdown
 * loads (`details-menu[src="/user_content_edits/show_edit_history_log/…"]`),
 * a small HTML partial listing every revision newest first, each a button
 * whose `data-edit-history-url` opens that revision's view — a rich diff
 * against the revision before (`<ins>`, `<del>`, unchanged `vicinity`
 * blocks) plus the markdown as it was then. Dropping the `<del>`s and
 * unwrapping the `<ins>`s of that diff leaves the comment exactly as it
 * read at that revision, rendered by GitHub.
 *
 * Two readers. `editedAt` wants only the latest time: a review bot that
 * reports a re-run by rewriting its summary in place posts nothing new, so
 * the edit is the report; asked for only while a run waits on that summary,
 * once per `REFRESH_MS`. `revisionAsOf` wants the revision in effect at a
 * moment: a bot's threads are pinned to the run summary they came from, and
 * a summary that has since been rewritten for a later run would otherwise
 * stand over an earlier run's threads saying something else. Everything is
 * cached per URL for the page; `onChange` runs once an answer lands so the
 * pass can read it.
 */

import { fragmentHeaders } from './deeplink';
import { revisionIndexAt } from './revisions';
import type { Revision } from './revisions';

export type { Revision } from './revisions';

/** While a run waits on a comment, its log is read again this often. */
const REFRESH_MS = 60_000;

interface EditLog {
  editedAt: string | null;
  /** Oldest first; empty until the log has been read. */
  revisions: Revision[];
  fetchedAt: number;
  pending: Promise<void> | null;
}

const logs = new Map<string, EditLog>();

interface RevisionBody {
  body: HTMLElement | null;
  pending: Promise<void> | null;
  failed: boolean;
}

const bodies = new Map<string, RevisionBody>();

let version = 0;

/** Bumped whenever a log or a revision lands, so a view built from these can tell it is stale. */
export function editsVersion(): number {
  return version;
}

/**
 * The edit-history log URL of the comment `node` (its own header, not a
 * nested comment's), or null when it was never edited. `anchor` is the
 * comment's id when `node` is a container around or inside the element
 * that carries it.
 */
function logUrlOf(node: Element, anchor = node.id): string | null {
  for (const menu of node.querySelectorAll('details-menu[src*="show_edit_history_log"]')) {
    // A review's node holds its threads' comments too, each with a header of its own: only the log whose nearest
    // comment is this one counts (GitHub repeats a comment's id on its wrapper, so ids are compared, not nodes).
    const owner = menu.closest('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"]');
    if (owner === null || owner.id === anchor) return menu.getAttribute('src');
  }
  return null;
}

/** Reads the log into `log`; true when it says something it did not before. */
async function fetchLog(url: string, log: EditLog): Promise<boolean> {
  try {
    const response = await fetch(new URL(url, location.href), { headers: fragmentHeaders(), credentials: 'same-origin' });
    if (!response.ok) return false;
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    // Newest first: "edited <time> (most recent)" leads the list, "created <time>" ends it.
    const revisions: Revision[] = [];
    for (const button of parsed.querySelectorAll('[data-edit-history-url]')) {
      const href = button.getAttribute('data-edit-history-url');
      const at = button.querySelector('relative-time[datetime]')?.getAttribute('datetime') ?? '';
      if (href === null || Number.isNaN(Date.parse(at))) continue;
      revisions.push({ at, url: href });
    }
    revisions.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const before = `${log.editedAt ?? ''}|${log.revisions.map((revision) => revision.url).join(',')}`;
    log.revisions = revisions;
    const times = [...parsed.querySelectorAll('relative-time[datetime]')].map((time) => time.getAttribute('datetime') ?? '').filter((time) => !Number.isNaN(Date.parse(time)));
    log.editedAt = times.length === 0 ? null : times.reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest));
    return before !== `${log.editedAt ?? ''}|${revisions.map((revision) => revision.url).join(',')}`;
  } catch {
    // Unreachable: the comment reads as never edited for now, and is asked about again later.
    return false;
  }
}

/** The log for `url`, read now when never read or stale; `onChange` once a read lands. */
function logFor(url: string, onChange: () => void, refreshAfter: number): EditLog {
  let log = logs.get(url);
  if (log === undefined) {
    log = { editedAt: null, revisions: [], fetchedAt: 0, pending: null };
    logs.set(url, log);
  }
  if (log.pending === null && (log.fetchedAt === 0 || Date.now() - log.fetchedAt >= refreshAfter)) {
    const current = log;
    const first = current.fetchedAt === 0;
    current.pending = fetchLog(url, current).then((changed) => {
      current.fetchedAt = Date.now();
      current.pending = null;
      // The first answer is news even when the log is empty (a reader waiting on it can now decide).
      if (changed || first) version += 1;
      onChange();
    });
  }
  return log;
}

/**
 * The ISO time `node`'s comment was last edited: null when the page shows
 * no edit, or while the log is on its way (then `onChange` runs once it
 * has landed).
 */
export function editedAt(node: Element, onChange: () => void): string | null {
  const url = logUrlOf(node);
  if (url === null) return null;
  return logFor(url, onChange, REFRESH_MS).editedAt;
}

/**
 * The comment as it read at one revision: GitHub's rich diff of that
 * revision against the one before, with the removed parts dropped and the
 * added parts unwrapped. Unchanged stretches come wrapped as collapsible
 * blocks; those are unwrapped too, and the diff's own classes go, leaving a
 * plain `markdown-body`.
 */
function contentOf(parsed: Document): HTMLElement | null {
  const article = parsed.querySelector('.js-rich-diff article, .rich-diff article, article.markdown-body');
  if (!(article instanceof HTMLElement)) return null;
  const body = document.createElement('div');
  body.className = 'markdown-body comment-body';
  body.append(...[...article.childNodes].map((node) => document.importNode(node, true)));
  for (const removed of body.querySelectorAll('del')) removed.remove();
  for (const control of body.querySelectorAll('button, .expand-handle, .js-expand-handle')) control.remove();
  const unwrap = (selector: string): void => {
    for (const wrapper of [...body.querySelectorAll(selector)]) wrapper.replaceWith(...wrapper.childNodes);
  };
  unwrap('ins');
  unwrap('.expandable');
  for (const element of body.querySelectorAll('*')) {
    for (const name of [...element.classList]) if (/^(?:rich-diff-level-\w+|vicinity|unchanged|expandable|js-expandable|changed|added|removed|show-more)$/.test(name)) element.classList.remove(name);
    if (element.classList.length === 0) element.removeAttribute('class');
  }
  return body;
}

async function fetchRevision(url: string, entry: RevisionBody): Promise<void> {
  try {
    const response = await fetch(new URL(url, location.href), { headers: fragmentHeaders(), credentials: 'same-origin' });
    if (!response.ok) {
      entry.failed = true;
      return;
    }
    entry.body = contentOf(new DOMParser().parseFromString(await response.text(), 'text/html'));
    if (entry.body === null) entry.failed = true;
  } catch {
    entry.failed = true;
  }
}

export type RevisionView =
  /** The comment has not changed since `at` (or was never edited): what the page shows is what read then. */
  | { readonly state: 'current' }
  /** The log or the revision is on its way; `onChange` will say. */
  | { readonly state: 'loading' }
  /** The comment read differently then: its content at that revision, and how it has moved on since. */
  | { readonly state: 'revision'; readonly at: string; readonly body: HTMLElement; readonly editsSince: number; readonly editedAt: string };

/**
 * How `node`'s comment (id `anchor`) read at `at` (epoch ms): the latest revision written
 * by then — a bot finishes writing a summary in the moments after it posts
 * the run's threads, so edits within `settleMs` after `at` count as that
 * moment's. `current` when no later edit exists, since then the page's own
 * node is the revision; `loading` while the answer is on its way (the log,
 * then the revision), with `onChange` once it has landed; a revision that
 * cannot be read falls back to `current`. The body is a fresh copy each
 * call, the caller's to insert.
 */
export function revisionAsOf(node: Element, anchor: string, at: number, settleMs: number, onChange: () => void): RevisionView {
  const url = logUrlOf(node, anchor);
  if (url === null) return { state: 'current' };
  const log = logFor(url, onChange, Number.POSITIVE_INFINITY);
  if (log.fetchedAt === 0) return { state: 'loading' };
  const revisions = log.revisions;
  if (revisions.length === 0) return { state: 'current' };
  const index = revisionIndexAt(revisions, at, settleMs);
  if (index === revisions.length - 1) return { state: 'current' };
  const chosen = revisions[index];
  const last = revisions[revisions.length - 1];
  if (chosen === undefined || last === undefined) return { state: 'current' };
  let entry = bodies.get(chosen.url);
  if (entry === undefined) {
    entry = { body: null, pending: null, failed: false };
    bodies.set(chosen.url, entry);
  }
  if (entry.body === null && !entry.failed && entry.pending === null) {
    const current = entry;
    current.pending = fetchRevision(chosen.url, current).finally(() => {
      current.pending = null;
      version += 1;
      onChange();
    });
  }
  if (entry.failed) return { state: 'current' };
  if (entry.body === null) return { state: 'loading' };
  const body = entry.body.cloneNode(true);
  if (!(body instanceof HTMLElement)) return { state: 'current' };
  return { state: 'revision', at: chosen.at, body, editsSince: revisions.length - 1 - index, editedAt: last.at };
}

/** Forget every log and revision (a new page). */
export function resetEditTimes(): void {
  logs.clear();
  bodies.clear();
}
