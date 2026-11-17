import type { ProviderReviewSubject, ProviderReviewThread } from '@geld/review';
import { suggestionReplyBody } from '@geld/review';
import { pageFetch } from '../github/page-fetch';
import type { ApplyResult, FixApplier, FixToApply } from '../review/apply-fixes';
import { commitMessage } from '../review/apply-fixes';

/**
 * Applying a triage fix the way GitLab applies a reviewer's suggestion, as GitHub's does there: the fix is posted as a
 * `suggestion:-a+b` note in the finding's discussion (GitLab's suggestion syntax, the lines it replaces counted around
 * the thread's line), then committed with GitLab's suggestions API (`PUT /api/v4/suggestions/batch_apply`), and the
 * discussion resolved (`PUT …/discussions/:id?resolved=true`). Every request is GitLab's own REST API, sent from the
 * page with the reader's session and the page's CSRF token, as GitLab's merge request page sends them; GitLab refuses
 * any of them for a reader who may not, and says why.
 */

interface Answer {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

/** GitLab's words for a refusal: its `message` (a string, or field errors), else its `error`, else the status. */
export function gitLabRefusal(answer: Answer): string {
  const body = record(answer.body);
  const message = body?.message ?? body?.error;
  if (typeof message === 'string' && message.trim() !== '') return `GitLab refused it: ${message.trim()}`;
  const fields = record(message);
  if (fields !== null) {
    const words = Object.entries(fields).flatMap(([field, value]) => (Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string').map((each) => `${field} ${each}`) : []));
    if (words.length > 0) return `GitLab refused it: ${words.join('; ')}`;
  }
  if (answer.status === 401) return 'Sign in to GitLab to apply a fix.';
  if (answer.status === 403) return 'GitLab does not let you apply suggestions here.';
  return `GitLab refused it (${answer.status}).`;
}

/** The fence's info for a fix replacing `start`..`end` around the thread's line `line`: GitLab's `suggestion:-a+b`. */
export function gitLabSuggestionInfo(line: number, start: number, end: number): string | null {
  if (start > line || end < line) return null;
  return `suggestion:-${line - start}+${end - line}`;
}

/** The first suggestion id GitLab gives a note, from the note itself or the discussion as the merge request page reads it. */
function suggestionIdOf(note: unknown): number | null {
  const suggestions = record(note)?.suggestions;
  if (!Array.isArray(suggestions)) return null;
  const first = record(suggestions[0]);
  return typeof first?.id === 'number' && Number.isSafeInteger(first.id) ? first.id : null;
}

export function gitLabFixApplier(subject: ProviderReviewSubject, threads: () => readonly ProviderReviewThread[], doc: Document = document): FixApplier {
  const api = `${subject.origin}/api/v4/projects/${encodeURIComponent(subject.repository)}/merge_requests/${encodeURIComponent(subject.id)}`;
  const csrf = (): string => doc.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
  const send = async (url: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<Answer> => {
    try {
      const response = await pageFetch(url, {
        method,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try { parsed = text === '' ? null : JSON.parse(text); } catch { parsed = null; }
      return { ok: response.ok, status: response.status, body: parsed };
    } catch {
      return { ok: false, status: 0, body: { message: 'the request did not reach GitLab' } };
    }
  };
  const threadOf = (anchors: readonly string[]): ProviderReviewThread | undefined =>
    threads().find((thread) => thread.comments.some((comment) => anchors.includes(comment.anchor)));
  /** The suggestion a note carries, asked of the discussion when the note GitLab answered with does not list it. */
  const suggestionOf = async (note: unknown, noteId: number): Promise<number | null> => {
    const own = suggestionIdOf(note);
    if (own !== null) return own;
    const page = await send(`${subject.origin}/${subject.repository}/-/merge_requests/${encodeURIComponent(subject.id)}/discussions.json`, 'GET');
    if (!page.ok || !Array.isArray(page.body)) return null;
    for (const discussion of page.body) {
      const notes = record(discussion)?.notes;
      if (!Array.isArray(notes)) continue;
      const found = notes.find((each) => Number(record(each)?.id) === noteId);
      if (found !== undefined) return suggestionIdOf(found);
    }
    return null;
  };
  /** One fix's suggestion note and its suggestion: the note Geld posted before, else a new one. A refusal is the fix's result. */
  const noteFor = async (fix: FixToApply): Promise<{ readonly note: number; readonly suggestion: number } | ApplyResult> => {
    const thread = threadOf(fix.threadAnchors);
    if (thread === undefined || thread.line === undefined || thread.side === 'old') return { ok: false, reason: 'This finding has no line on the new code to suggest a fix for.', posted: false };
    const info = gitLabSuggestionInfo(thread.line, fix.start ?? thread.line, fix.end ?? thread.line);
    if (info === null) return { ok: false, reason: 'The fix does not cover its thread’s line. Triage again.', posted: false };
    if (fix.pendingReply !== undefined && fix.pendingReply !== null) {
      const suggestion = await suggestionOf(null, fix.pendingReply);
      if (suggestion !== null) return { note: fix.pendingReply, suggestion };
    }
    const posted = await send(`${api}/discussions/${encodeURIComponent(thread.id)}/notes`, 'POST', { body: suggestionReplyBody(fix.replacement, fix.summary, info) });
    if (!posted.ok) return { ok: false, reason: gitLabRefusal(posted), posted: false };
    const noteId = Number(record(posted.body)?.id);
    if (!Number.isSafeInteger(noteId) || noteId <= 0) return { ok: false, reason: 'The suggestion is in the thread. Apply it from there.', posted: true };
    const suggestion = await suggestionOf(posted.body, noteId);
    return suggestion === null ? { ok: false, reason: 'The suggestion is in the thread. Apply it from there.', posted: true, reply: { anchor: `note_${noteId}`, id: noteId } } : { note: noteId, suggestion };
  };
  return {
    apply: async (fixes) => {
      if (csrf() === '') return fixes.map(() => ({ ok: false, reason: 'Sign in to GitLab to apply a fix.', posted: false }));
      // In order, then every suggestion that stands committed at once: a commit moves the branch, and GitLab refuses a
      // suggestion whose lines changed since, so one after another would fail all but the first.
      const notes: (Awaited<ReturnType<typeof noteFor>>)[] = [];
      for (const fix of fixes) notes.push(await noteFor(fix));
      const ready = notes.flatMap((entry, index) => ('note' in entry ? [{ ...entry, fix: fixes[index] }] : []));
      if (ready.length === 0) return notes.flatMap((entry) => ('note' in entry ? [] : [entry]));
      const commit = await send(`${subject.origin}/api/v4/suggestions/batch_apply`, 'PUT', { ids: ready.map((entry) => entry.suggestion), commit_message: commitMessage(ready.map((entry) => entry.fix?.title ?? '')) });
      const refusal = commit.ok ? '' : `${gitLabRefusal(commit)} The ${ready.length === 1 ? 'suggestion is' : 'suggestions are'} in the thread.`;
      return notes.map((entry): ApplyResult => {
        if (!('note' in entry)) return entry;
        const anchor = `note_${entry.note}`;
        return commit.ok ? { ok: true, replyAnchor: anchor } : { ok: false, reason: refusal, posted: true, reply: { anchor, id: entry.note } };
      });
    },
    resolve: (key) => {
      const thread = threads().find((each) => each.comments[0]?.anchor === key || each.anchor === key);
      if (thread === undefined || thread.resolved) return;
      void send(`${api}/discussions/${encodeURIComponent(thread.id)}?resolved=true`, 'PUT');
    },
  };
}
