/**
 * When a comment was last edited. GitHub's comment header says only
 * "edited"; the time is in the edit-history log the header's dropdown loads
 * (`details-menu[src="/user_content_edits/show_edit_history_log/…"]`), a
 * small HTML partial whose first `relative-time` is the most recent edit.
 *
 * Asked for sparingly: only a review bot's summary with a run still waiting
 * on it (a person's trigger, or the bot's own "Starting" line, after the
 * summary was posted) needs it, since a bot that reports a re-run by
 * rewriting that summary in place posts nothing new — the edit is the
 * report. One fetch per comment per `REFRESH_MS` while that is so;
 * `onChange` runs once an answer lands so the pass can read it.
 */

import { fragmentHeaders } from './deeplink';

/** While a run waits on a comment, its log is read again this often. */
const REFRESH_MS = 60_000;

interface EditLog {
  editedAt: string | null;
  fetchedAt: number;
  pending: Promise<void> | null;
}

const logs = new Map<string, EditLog>();

/** The edit-history log URL of the comment `node` (its own header, not a nested comment's), or null when it was never edited. */
function logUrlOf(node: Element): string | null {
  for (const menu of node.querySelectorAll('details-menu[src*="show_edit_history_log"]')) {
    // A review's node holds its threads' comments too, each with a header of its own: only the log whose nearest
    // comment is this one counts (GitHub repeats a comment's id on its wrapper, so ids are compared, not nodes).
    const owner = menu.closest('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"]');
    if (owner === null || owner.id === node.id) return menu.getAttribute('src');
  }
  return null;
}

async function fetchLog(url: string, log: EditLog): Promise<void> {
  try {
    const response = await fetch(new URL(url, location.href), { headers: fragmentHeaders(), credentials: 'same-origin' });
    if (!response.ok) return;
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    // Newest first: "edited <time> (most recent)" leads the list.
    const times = [...parsed.querySelectorAll('relative-time[datetime]')].map((time) => time.getAttribute('datetime') ?? '').filter((time) => !Number.isNaN(Date.parse(time)));
    log.editedAt = times.length === 0 ? null : times.reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest));
  } catch {
    // Unreachable: the comment reads as never edited for now, and is asked about again later.
  }
}

/**
 * The ISO time `node`'s comment was last edited: null when the page shows
 * no edit, or while the log is on its way (then `onChange` runs once it
 * has landed).
 */
export function editedAt(node: Element, onChange: () => void): string | null {
  const url = logUrlOf(node);
  if (url === null) return null;
  let log = logs.get(url);
  if (log === undefined) {
    log = { editedAt: null, fetchedAt: 0, pending: null };
    logs.set(url, log);
  }
  if (log.pending === null && Date.now() - log.fetchedAt >= REFRESH_MS) {
    const current = log;
    current.pending = fetchLog(url, current).finally(() => {
      current.fetchedAt = Date.now();
      current.pending = null;
      onChange();
    });
  }
  return log.editedAt;
}

/** Forget every log (a new page). */
export function resetEditTimes(): void {
  logs.clear();
}
