import { repoFromPathname } from '@geld/core';

/** The repository feedback is opened on, as a public issue from the reader's own account. */
export const FEEDBACK_REPO = 'brandonmcconnell/geld';

/** GitHub refuses an issue body longer than this many characters. */
export const ISSUE_BODY_LIMIT = 65_536;

const TITLE_LIMIT = 200;

export type FeedbackKind = 'bug' | 'idea' | 'question' | 'other';

export const FEEDBACK_KINDS: ReadonlyArray<{ readonly id: FeedbackKind; readonly label: string; readonly prefix: string }> = [
  { id: 'bug', label: 'Something broke', prefix: 'Bug' },
  { id: 'idea', label: 'An idea', prefix: 'Idea' },
  { id: 'question', label: 'A question', prefix: 'Question' },
  { id: 'other', label: 'Something else', prefix: 'Feedback' },
];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return FEEDBACK_KINDS.some((kind) => kind.id === value);
}

/** What the reader wrote. Kept on this device until it is sent, so closing the tab loses nothing. */
export interface FeedbackDraft {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly text: string;
}

export const EMPTY_DRAFT: FeedbackDraft = { kind: 'bug', title: '', text: '' };

/** Each piece of context the reader may attach; `null` when this device has none to offer. */
export interface FeedbackContext {
  /** Geld's version and the browser, in words. */
  readonly environment: string | null;
  /** The kind of page it happened on ("pull request conversation"). */
  readonly where: string | null;
  /** The page's full address. */
  readonly page: string | null;
  /** The Copy diagnostics report. */
  readonly diagnostics: string | null;
}

export type ContextKey = keyof FeedbackContext;

export type ContextChoice = Readonly<Record<ContextKey, boolean>>;

export interface FeedbackIssue {
  readonly title: string;
  readonly body: string;
  /** How far the body runs past GitHub's limit when the reader's own words do not fit; 0 when it fits. */
  readonly overBy: number;
}

export function parseDraft(value: unknown): FeedbackDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind: unknown = Reflect.get(value, 'kind');
  const title: unknown = Reflect.get(value, 'title');
  const text: unknown = Reflect.get(value, 'text');
  if (!isFeedbackKind(kind) || typeof title !== 'string' || typeof text !== 'string') return null;
  return { kind, title, text };
}

export function draftIsEmpty(draft: FeedbackDraft): boolean {
  return draft.title.trim() === '' && draft.text.trim() === '';
}

/** A fence longer than any run of backticks inside, so the report can never close it early. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function diagnosticsBlock(report: string): string {
  const fence = fenceFor(report);
  return `<details><summary>Diagnostics</summary>\n\n${fence}text\n${report}\n${fence}\n\n</details>`;
}

/** What a report may still name: the page's own repository and host, when its address goes into the issue too. */
export interface NamedPage {
  readonly repo: string;
  readonly host: string;
}

export const OBFUSCATED = '[obfuscated]';

/** `owner/repo`, then `#N` or `@sha`, standing on their own (a rate like `45.2/min` is no repository). */
const REPO_REFERENCE = /(?<![\w./-])([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)(?:(#)\d+|(@)[0-9a-f]{7,40})?(?![\w-])/g;
/** A repository's page on a host: `https://host/owner/repo`, then `/pull/N`, `/issues/N`, `/discussions/N` and the like. */
const REPO_URL = /\bhttps?:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)(?:\/(pull|pulls|issues|discussions|commit|commits|compare|tree|blob|actions|releases)(?:\/([^\s/?#]+))?)?/g;
const HOST_FIELD = /\bfrom=([^\s]+)/g;

function isGitHubHost(host: string): boolean {
  return /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i.test(host);
}

/**
 * The diagnostics report with every organization, repository, pull request,
 * issue, discussion, commit and Enterprise host it names shown as
 * `[obfuscated]`: `[obfuscated]/[obfuscated]#[obfuscated]`, and
 * `https://github.com/[obfuscated]/[obfuscated]/pull/[obfuscated]` for an
 * address. The report covers every open GitHub tab, so even with the page's
 * address in the issue only that page's own repository and host keep their
 * names.
 */
export function anonymizeDiagnostics(report: string, named: NamedPage | null): string {
  const kept = named?.repo.toLowerCase() ?? null;
  const keptHost = named?.host.toLowerCase() ?? null;
  const hostShown = (host: string): string => (isGitHubHost(host) || host.toLowerCase() === keptHost ? host : OBFUSCATED);
  return report
    .replace(REPO_URL, (whole: string, host: string, owner: string, repo: string, kind: string | undefined, item: string | undefined) => {
      if (`${owner}/${repo}`.toLowerCase() === kept && host.toLowerCase() === keptHost) return whole;
      const path = kind === undefined ? '' : `/${kind}${item === undefined ? '' : `/${OBFUSCATED}`}`;
      return `${whole.startsWith('http://') ? 'http' : 'https'}://${hostShown(host)}/${OBFUSCATED}/${OBFUSCATED}${path}`;
    })
    .replace(REPO_REFERENCE, (whole: string, owner: string, repo: string, pull: string | undefined, sha: string | undefined) => {
      if (`${owner}/${repo}`.toLowerCase() === kept) return whole;
      return `${OBFUSCATED}/${OBFUSCATED}${pull !== undefined ? `#${OBFUSCATED}` : sha !== undefined ? `@${OBFUSCATED}` : ''}`;
    })
    .replace(HOST_FIELD, (_whole: string, host: string) => `from=${hostShown(host)}`);
}

/** The page whose address goes into the issue, as the report may name it; `null` when no address does. */
export function namedPage(page: string | null, included: boolean): NamedPage | null {
  if (!included || page === null) return null;
  try {
    const url = new URL(page);
    const repo = repoFromPathname(url.pathname);
    return repo === null ? null : { repo, host: url.hostname };
  } catch {
    return null;
  }
}

const TRIM_NOTE = '(Trimmed to fit the issue. The oldest lines were dropped.)';

/** The report's header and its newest lines, as many as fit in `budget` characters once fenced. */
function trimReport(report: string, budget: number): string {
  const lines = report.split('\n');
  const header = lines[0] ?? '';
  const kept: string[] = [];
  let used = diagnosticsBlock(`${header}\n${TRIM_NOTE}`).length;
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const line = lines[index] ?? '';
    if (used + line.length + 1 > budget) break;
    used += line.length + 1;
    kept.unshift(line);
  }
  return [header, TRIM_NOTE, ...kept].join('\n');
}

/** A value on one Markdown line: line breaks folded, so a page title or URL cannot start a block of its own. */
function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The issue as it will be opened: the reader's words, then what they chose to
 * attach. A long diagnostics report loses its oldest lines so the body fits
 * GitHub's limit. The reader's own words are never cut: when they alone do not
 * fit, `overBy` says by how much and the form refuses to send.
 */
export function feedbackIssue(draft: FeedbackDraft, context: FeedbackContext, choice: ContextChoice): FeedbackIssue {
  const prefix = FEEDBACK_KINDS.find((kind) => kind.id === draft.kind)?.prefix ?? 'Feedback';
  const title = `[${prefix}] ${inline(draft.title)}`.slice(0, TITLE_LIMIT);
  const facts: string[] = [];
  if (choice.environment && context.environment !== null) facts.push(`- **Geld:** ${inline(context.environment)}`);
  if (choice.where && context.where !== null) facts.push(`- **Page type:** ${inline(context.where)}`);
  if (choice.page && context.page !== null) facts.push(`- **Page address:** <${inline(context.page)}>`);
  const footer = '<sub>Sent from the feedback form in the Geld extension.</sub>';
  const parts = draft.text.trim() === '' ? [] : [draft.text.trim()];
  if (facts.length > 0) parts.push(facts.join('\n'));
  const fixed = [...parts, footer].join('\n\n');
  if (choice.diagnostics && context.diagnostics !== null) {
    const named = namedPage(context.page, choice.page);
    const report = anonymizeDiagnostics(context.diagnostics, named);
    const room = ISSUE_BODY_LIMIT - fixed.length - 4;
    const whole = diagnosticsBlock(report);
    const block = whole.length <= room ? whole : room > 200 ? diagnosticsBlock(trimReport(report, room)) : null;
    if (block !== null) parts.push(block);
  }
  const body = [...parts, footer].join('\n\n');
  return { title, body, overBy: Math.max(0, body.length - ISSUE_BODY_LIMIT) };
}

export interface CreatedIssue {
  readonly number: number;
  readonly url: string;
}

export function parseCreatedIssue(value: unknown): CreatedIssue | null {
  if (typeof value !== 'object' || value === null) return null;
  const number: unknown = Reflect.get(value, 'number');
  const url: unknown = Reflect.get(value, 'html_url');
  return typeof number === 'number' && typeof url === 'string' && url.startsWith('https://github.com/') ? { number, url } : null;
}

/** Why GitHub refused to open the issue, in words the form can show. */
export function refusalMessage(status: number, body: unknown, rateLimited: boolean): string {
  const said = typeof body === 'object' && body !== null ? Reflect.get(body, 'message') : undefined;
  const message = typeof said === 'string' ? said : '';
  if (rateLimited || status === 429) return 'GitHub is limiting requests from your account right now. Try again in a few minutes.';
  if (/not accessible by integration/i.test(message) || status === 404)
    return `Geld's GitHub App cannot open issues on ${FEEDBACK_REPO} yet. Your draft is kept, so try again later.`;
  if (status === 410) return `Issues are turned off on ${FEEDBACK_REPO}. Your draft is kept.`;
  if (status === 422) return message === '' ? 'GitHub did not accept the issue. Check the title and details.' : `GitHub did not accept the issue: ${message}`;
  return message === '' ? `GitHub answered ${status}. Your draft is kept, so try again.` : `GitHub answered ${status}: ${message}`;
}
