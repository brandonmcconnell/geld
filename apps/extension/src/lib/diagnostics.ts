import { storage } from 'wxt/utils/storage';

/**
 * A short log of what happened to diff fetches, for "Copy diagnostics" on the
 * options page. Kept in session storage (gone when the browser closes) and
 * written by the background worker only. Nothing sensitive: the subject is
 * `owner/repo#N` or `owner/repo@sha` — what the page itself shows — never a
 * URL with a query, a cookie, or any of the diff's text.
 */
export interface DiagnosticEvent {
  readonly at: number;
  readonly kind: 'fetch' | 'worker-start' | 'rate-limit' | 'busy' | 'cache-clear' | 'inject';
  readonly subject?: string | undefined;
  /**
   * `ok`, `memory-hit`, `queued`, `rate-limited`, `signed-out`, `not-a-diff`, `http-NNN`, `too-large`, or an error
   * name; for `inject`, `injected` (the tab had no answering copy and got one), `present` (it answered) or `failed`.
   */
  readonly outcome?: string;
  /** For `inject`: why the background looked — `install`, `activated` (a GitHub tab came to front) or `popup`. */
  readonly reason?: string;
  readonly ms?: number;
  /** Requests started in the current per-minute window when this was recorded. */
  readonly budgetUsed?: number;
  readonly files?: number | undefined;
  readonly cooldownMs?: number;
  readonly strikes?: number;
  /** For a 429/403 or 5xx: the status and the host that answered (github.com itself, or the patch-diff host after the redirect). */
  readonly status?: number;
  readonly host?: string;
}

const MAX_EVENTS = 300;
const diagnosticsItem = storage.defineItem<readonly DiagnosticEvent[]>('session:diagnostics', { fallback: [] });

let pending: DiagnosticEvent[] = [];
let flush: ReturnType<typeof setTimeout> | null = null;

/** Buffer events and append them in one write shortly after (a list page fires dozens at once). */
export function recordDiagnostic(event: Omit<DiagnosticEvent, 'at'>): void {
  pending.push({ at: Date.now(), ...event });
  flush ??= setTimeout(() => {
    flush = null;
    const batch = pending;
    pending = [];
    void diagnosticsItem
      .getValue()
      .then((existing) => diagnosticsItem.setValue([...existing, ...batch].slice(-MAX_EVENTS)))
      .catch(() => undefined);
  }, 250);
}

export async function readDiagnostics(): Promise<readonly DiagnosticEvent[]> {
  return diagnosticsItem.getValue();
}

/**
 * What a tab is called in the log: `owner/repo#N` (with `/files` or
 * `/changes` when on that tab), `owner/repo@sha7`, `owner/repo (pulls)` for
 * a repository's list and compare pages, and `other page` for anything else.
 * Never a path as such: a profile, an organisation or a search URL names
 * people, and the log may name repositories and nothing more.
 */
export function tabSubject(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'other page';
  }
  const pull = /^\/([^/]+\/[^/]+)\/pull\/(\d+)(\/(?:files|changes|commits|checks))?/.exec(pathname);
  if (pull !== null) return `${pull[1]}#${pull[2]}${pull[3] ?? ''}`;
  const commit = /^\/([^/]+\/[^/]+)\/commit\/([0-9a-f]+)/i.exec(pathname);
  if (commit !== null) return `${commit[1]}@${(commit[2] ?? '').slice(0, 7)}`;
  const repoPage = /^\/([^/]+\/[^/]+)\/(pulls|compare|commits)(?:\/|$)/.exec(pathname);
  if (repoPage !== null) return `${repoPage[1]} (${repoPage[2]})`;
  return 'other page';
}

/** `owner/repo#N` for a pull request diff, `owner/repo@sha7` for a commit's; null for anything else. */
export function diagnosticSubject(diffUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(diffUrl);
  } catch {
    return null;
  }
  const pull = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\.diff$/.exec(url.pathname);
  if (pull !== null) return `${pull[1]}/${pull[2]}#${pull[3]}`;
  const commit = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]+)\.diff$/i.exec(url.pathname);
  if (commit !== null) return `${commit[1]}/${commit[2]}@${(commit[3] ?? '').slice(0, 7)}`;
  return null;
}

/** Plain-text rendering for the clipboard: one line per event, newest last. */
export function formatDiagnostics(events: readonly DiagnosticEvent[], version: string): string {
  const lines = events.map((event) => {
    const time = new Date(event.at).toISOString().slice(11, 23);
    const parts = [time, event.kind, event.subject, event.outcome, event.ms === undefined ? undefined : `${event.ms}ms`];
    if (event.budgetUsed !== undefined) parts.push(`budget=${event.budgetUsed}`);
    if (event.files !== undefined) parts.push(`files=${event.files}`);
    if (event.cooldownMs !== undefined) parts.push(`cooldown=${Math.round(event.cooldownMs / 1000)}s`);
    if (event.strikes !== undefined) parts.push(`strikes=${event.strikes}`);
    if (event.status !== undefined) parts.push(`status=${event.status}`);
    if (event.host !== undefined) parts.push(`from=${event.host}`);
    if (event.reason !== undefined) parts.push(`on=${event.reason}`);
    return parts.filter((part): part is string => part !== undefined).join(' ');
  });
  return [`Geld ${version} diagnostics — ${events.length} events (this browser session)`, ...lines].join('\n');
}
