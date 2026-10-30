/**
 * The reader's pending review on a pull request: the comments left with
 * "Start a review", waiting to go out with it. GitHub's own dialog lists them
 * from the files view's store; on any tab the same threads come from
 * `page_data/thread_previews` (path, line, every comment with its
 * `state`), where a pending comment is `state: "pending"`
 * and `viewerDidAuthor`. `page_data/pending_review` answers 404 whether or
 * not one exists, so it says nothing (seen Oct 2026).
 */

export interface PendingComment {
  readonly id: string;
  readonly path: string;
  readonly line: number | null;
  readonly outdated: boolean;
  /** What was written, as Markdown; the box shows its first sentence. */
  readonly body: string;
  /** Where the comment is on the Files changed tab. */
  readonly href: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The viewer's pending comments in a `thread_previews` answer, in the order GitHub gives the threads. */
export function parsePendingComments(payload: unknown): readonly PendingComment[] {
  if (!Array.isArray(payload)) return [];
  const out: PendingComment[] = [];
  for (const thread of payload) {
    if (!isRecord(thread)) continue;
    const path = stringOf(thread.path);
    const commentsData = thread.commentsData;
    const comments = isRecord(commentsData) && Array.isArray(commentsData.comments) ? commentsData.comments : [];
    if (path === null) continue;
    const subject = isRecord(thread.subject) ? thread.subject : {};
    for (const comment of comments) {
      if (!isRecord(comment) || stringOf(comment.state) !== 'pending' || comment.viewerDidAuthor !== true) continue;
      out.push({
        id: stringOf(comment.id) ?? String(numberOf(comment.databaseId) ?? out.length),
        path,
        line: numberOf(thread.line) ?? numberOf(subject.endLine),
        outdated: thread.isOutdated === true,
        body: stringOf(comment.body) ?? '',
        href: stringOf(comment.currentDiffResourcePath) ?? stringOf(comment.url),
      });
    }
  }
  return out;
}

/**
 * A comment's link on the Files changed tab as the page's own tab names it:
 * GitHub still answers with `/pull/N/files#r<id>`, which github.com now
 * redirects to `/pull/N/changes#r<id>` (verified Oct 2026), so from the
 * Changes tab itself the link reloaded the page where the same-document
 * jump scrolls to the comment. Left alone where the tab is still `/files`
 * (GitHub Enterprise Server before the move).
 */
export function linkOnFilesTab(href: string, pullPath: string, tabIsChanges: boolean): string {
  if (!tabIsChanges) return href;
  const files = `${pullPath}/files`;
  for (const prefix of [files, `${location.origin}${files}`]) {
    if (href === prefix || href.startsWith(`${prefix}#`) || href.startsWith(`${prefix}?`)) return `${prefix.slice(0, -'/files'.length)}/changes${href.slice(prefix.length)}`;
  }
  return href;
}

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' };
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? '';
  if (nonce !== '') headers['X-Fetch-Nonce'] = nonce;
  return headers;
}

/** The reader's pending comments on `/owner/repo/pull/N`; null when GitHub could not say. */
export async function fetchPendingComments(pullPath: string): Promise<readonly PendingComment[] | null> {
  try {
    const response = await fetch(`${pullPath}/page_data/thread_previews`, { credentials: 'same-origin', headers: jsonHeaders() });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return parsePendingComments(payload);
  } catch {
    return null;
  }
}

/** Discard the pending review and its comments, as GitHub's "Discard review" does. */
export async function discardPendingReview(pullPath: string): Promise<boolean> {
  try {
    const response = await fetch(`${pullPath}/page_data/abandon_review`, { method: 'DELETE', credentials: 'same-origin', headers: { ...jsonHeaders(), 'Content-Type': 'application/json' } });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The count GitHub's own (hidden) Files changed button shows, live while
 * comments are added there or the pending review is discarded. The button
 * drops its counter at zero, so buttons with none say none are pending; null
 * where no such button is on the page.
 */
export function pendingCountOnPage(): number | null {
  // The page may carry more than one (the toolbar's, and its copy in the sticky header): a counter on any of them wins.
  const buttons = document.querySelectorAll('[class*="ReviewMenuButton"]');
  if (buttons.length === 0) return null;
  const counter = [...buttons].map((button) => button.querySelector('[data-component="ButtonCounter"]')).find((found) => found !== null) ?? null;
  if (counter === null) return 0;
  const count = Number.parseInt(counter.textContent?.trim() ?? '', 10);
  return Number.isFinite(count) ? count : null;
}
