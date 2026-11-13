/**
 * Geld's own errors, in the one shape the extension builds and geld.sh
 * accepts. Everything that leaves a browser goes through {@link scrubErrorText}
 * and {@link scrubStack} first, and the site runs the payload through
 * {@link parseErrorPayload}, which scrubs again: a report says what broke and
 * where in Geld's code, never which page, repository, file or person.
 */

export const ERROR_PAYLOAD_VERSION = 1;
export const MAX_ERRORS_PER_PAYLOAD = 25;
/** Room for an AI provider's refusal in its own words (`reportAiFailure`), which runs past two hundred characters. */
export const MAX_ERROR_MESSAGE = 600;
export const MAX_STACK_FRAMES = 12;
const MAX_FRAME = 160;

export type ErrorKind = 'error' | 'rejection';
export type ReportBrowser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

export interface ErrorReport {
  /** Which part of Geld: `content`, `content:pass`, `background`, `popup`, `options`, `offscreen`. */
  readonly where: string;
  readonly kind: ErrorKind;
  readonly message: string;
  /** Frames in Geld's own files only, `name file:line:col`, the extension origin removed. */
  readonly stack: readonly string[];
  readonly count: number;
  readonly firstAt: number;
  readonly lastAt: number;
}

export interface ErrorPayload {
  readonly v: typeof ERROR_PAYLOAD_VERSION;
  readonly version: string;
  readonly browser: ReportBrowser;
  readonly errors: readonly ErrorReport[];
}

const WHERE = /^[a-z][a-z0-9:-]{0,40}$/;
const VERSION = /^\d+(?:\.\d+){0,3}$/;
const BROWSERS: readonly ReportBrowser[] = ['chrome', 'edge', 'firefox', 'safari', 'other'];
/** What {@link scrubStack} writes: an optional function name, then a file inside the extension and a position. */
const FRAME = /^(?:[\w$.<>[\]]+ )?[\w.-]+(?:\/[\w.-]+)*:\d+(?::\d+)?$/;

/**
 * Remove whatever could name a place or a person: URLs, email addresses,
 * @mentions, anything path-shaped (`owner/repo`, `src/a/b.ts`), and quoted
 * text long enough to be page content (a JSON parse error quotes what it read).
 */
export function scrubErrorText(text: string): string {
  const scrubbed = text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '<email>')
    .replace(/(^|[\s(])@[\w-]+/g, '$1@<user>')
    .replace(/[\w.-]+(?:\/[\w.-]+)+/g, '<path>')
    .replace(/(["“”])([^"“”]*)["“”]/g, (whole, _open: string, inner: string) => (inner.length > 40 || /\s/.test(inner) ? '"<text>"' : whole))
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > MAX_ERROR_MESSAGE ? `${scrubbed.slice(0, MAX_ERROR_MESSAGE - 1)}…` : scrubbed;
}

/**
 * Keep the frames that run Geld's own files (`origin` is the extension's base
 * URL, `chrome-extension://<id>/`) as `name file:line:col`; every other frame
 * is the page's or the browser's and is dropped. Reads Chrome's `at name (url)`
 * and Firefox's and Safari's `name@url` lines.
 */
export function scrubStack(stack: string, origin: string): string[] {
  const frames: string[] = [];
  for (const line of stack.split('\n')) {
    const at = line.indexOf(origin);
    if (at === -1) continue;
    const location = /^([^\s):]+:\d+(?::\d+)?)/.exec(line.slice(at + origin.length))?.[1];
    if (location === undefined) continue;
    const chrome = /^\s*at\s+(?:async\s+)?([^\s(]+)\s+\(/.exec(line)?.[1];
    const other = /^([^@\s]+)@/.exec(line.trim())?.[1];
    const name = chrome ?? other;
    const frame = name === undefined || name.includes('/') ? location : `${name} ${location}`;
    frames.push(frame.slice(0, MAX_FRAME));
    if (frames.length === MAX_STACK_FRAMES) break;
  }
  return frames;
}

function hasStack(value: unknown): value is { readonly stack: string } {
  return typeof value === 'object' && value !== null && 'stack' in value && typeof value.stack === 'string';
}

/** Whether a thrown value (or the script it came from) is Geld's own code, by the extension origin in its stack or file. */
export function isOwnError(value: unknown, origin: string, filename = ''): boolean {
  if (origin === '') return false;
  if (filename.startsWith(origin)) return true;
  return hasStack(value) && value.stack.includes(origin);
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.name === 'Error' ? value.message : `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function errorReportFrom(input: { readonly where: string; readonly kind: ErrorKind; readonly error: unknown; readonly origin: string; readonly at: number }): ErrorReport {
  return {
    where: WHERE.test(input.where) ? input.where : 'unknown',
    kind: input.kind,
    message: scrubErrorText(messageOf(input.error)) || '(no message)',
    stack: hasStack(input.error) ? scrubStack(input.error.stack, input.origin) : [],
    count: 1,
    firstAt: input.at,
    lastAt: input.at,
  };
}

function reportKey(report: ErrorReport): string {
  return `${report.where}\u0000${report.kind}\u0000${report.message}\u0000${report.stack[0] ?? ''}`;
}

/** The same error repeated (a pass that throws on every mutation) is one entry with a count; the newest `cap` distinct ones are kept. */
export function mergeErrorReports(existing: readonly ErrorReport[], incoming: readonly ErrorReport[], cap = MAX_ERRORS_PER_PAYLOAD): ErrorReport[] {
  const merged = new Map<string, ErrorReport>();
  for (const report of [...existing, ...incoming]) {
    const key = reportKey(report);
    const prior = merged.get(key);
    merged.delete(key);
    merged.set(
      key,
      prior === undefined
        ? report
        : { ...prior, count: prior.count + report.count, firstAt: Math.min(prior.firstAt, report.firstAt), lastAt: Math.max(prior.lastAt, report.lastAt) },
    );
  }
  return [...merged.values()].slice(-cap);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseReport(value: unknown): ErrorReport | null {
  if (!isRecord(value)) return null;
  const { where, kind, message, stack, count, firstAt, lastAt } = value;
  if (typeof where !== 'string' || !WHERE.test(where)) return null;
  if (kind !== 'error' && kind !== 'rejection') return null;
  if (typeof message !== 'string' || !Array.isArray(stack) || !stack.every((frame) => typeof frame === 'string')) return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || !isTime(firstAt) || !isTime(lastAt)) return null;
  return {
    where,
    kind,
    message: scrubErrorText(message),
    stack: stack.slice(0, MAX_STACK_FRAMES).filter((frame) => frame.length <= MAX_FRAME && FRAME.test(frame)),
    count: Math.min(count, 1_000_000),
    firstAt,
    lastAt,
  };
}

/** Reports handed from one part of the extension to another, or `null` when the list is not one. */
export function parseErrorReports(value: unknown): ErrorReport[] | null {
  if (!Array.isArray(value) || value.length > MAX_ERRORS_PER_PAYLOAD) return null;
  const reports = value.map(parseReport);
  return reports.every((report): report is ErrorReport => report !== null) ? reports : null;
}

/** A payload as received, or `null` when it is not one; scrubbed again, so nothing a modified client sends gets through unchanged. */
export function parseErrorPayload(value: unknown): ErrorPayload | null {
  if (!isRecord(value) || value.v !== ERROR_PAYLOAD_VERSION) return null;
  const { version, browser, errors } = value;
  if (typeof version !== 'string' || !VERSION.test(version)) return null;
  const known = BROWSERS.find((candidate) => candidate === browser);
  if (known === undefined) return null;
  const reports = parseErrorReports(errors);
  if (reports === null || reports.length === 0) return null;
  return { v: ERROR_PAYLOAD_VERSION, version, browser: known, errors: reports };
}
