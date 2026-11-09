import { browser } from 'wxt/browser';
import type { ErrorKind, ErrorReport } from '@geld/core';
import { errorReportFrom, isOwnError, mergeErrorReports } from '@geld/core';
import type { ErrorReportMessage } from './messages';
import { count as perfCount, markOnce } from './perf';

/**
 * Geld's own errors, caught before Chrome files them on the extension's
 * Errors card. Every context (content script, background, popup, options)
 * installs this once: an uncaught error or rejection
 * from Geld's code is recorded on this context's trail (`error:<where>` in
 * Copy diagnostics) and handed to the background worker, which keeps it in
 * the session log and, when the reader opted in to error reports, sends it
 * scrubbed to geld.sh (`error-uplink.ts`). A development build (`pnpm dev`)
 * records the same and still lets the browser report it, so bugs stay loud
 * while working; a production build keeps the card and the console clean.
 *
 * In a content script the page's own errors arrive on the same window; only
 * those whose stack or file is inside the extension are Geld's.
 */

type Sink = (reports: readonly ErrorReport[]) => void;

const FLUSH_MS = 2_000;

let where = 'unknown';
let origin = '';
let ownOnly = true;
let sink: Sink = sendToBackground;
let pending: ErrorReport[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushQueued = false;
/** Only a content script batches: an extension page or the worker can close or stop at any moment, and a page's pass repeats one fault many times. */
let batching = false;
let installed = false;

function extensionOrigin(): string {
  try {
    return browser.runtime.getURL('/');
  } catch {
    return '';
  }
}

function sendToBackground(reports: readonly ErrorReport[]): void {
  const message: ErrorReportMessage = { type: 'geld:error-report', errors: reports };
  try {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // An orphaned copy (the extension was reloaded): there is no background to tell, the trail still has it.
  }
}

function flush(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  flushQueued = false;
  const batch = pending;
  pending = [];
  if (batch.length > 0) sink(batch);
}

/** Record one of Geld's errors under `at`, a more specific place than the context (`content:pass`). */
export function reportError(at: string, error: unknown, kind: ErrorKind = 'error'): void {
  const report = errorReportFrom({ where: at, kind, error, origin, at: Date.now() });
  markOnce(`error:${at}:${report.message.slice(0, 80)}`);
  perfCount('errors');
  pending = mergeErrorReports(pending, [report]);
  if (flushQueued) return;
  flushQueued = true;
  // A microtask still merges a synchronous burst into one message.
  if (batching) flushTimer = setTimeout(flush, FLUSH_MS);
  else queueMicrotask(flush);
}

/** Run an entry point (an observer callback, a timer, a message handler), recording what it throws instead of letting it surface. */
export function guard(at: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    reportError(at, error);
    if (import.meta.env.DEV) throw error;
  }
}

function onError(event: Event): void {
  if (!(event instanceof ErrorEvent)) return;
  // A muted cross-origin "Script error." has no error and no file: it was not Geld's code.
  if ((event.error === null || event.error === undefined) && !event.filename.startsWith(origin)) return;
  if (ownOnly && !isOwnError(event.error, origin, event.filename)) return;
  reportError(where, event.error ?? event.message);
  if (!import.meta.env.DEV) event.preventDefault();
}

/** A tab closing or navigating away hands over what it is still holding. */
function onPageHide(): void {
  if (flushQueued) flush();
}

function onRejection(event: PromiseRejectionEvent): void {
  if (ownOnly && !isOwnError(event.reason, origin)) return;
  reportError(where, event.reason, 'rejection');
  if (!import.meta.env.DEV) event.preventDefault();
}

/**
 * Start catching this context's errors. Returns the way to stop: a content
 * script copy that retires (a newer one took the page) removes its listeners,
 * or both copies would report the live one's errors.
 */
export function installErrorCapture(context: 'content' | 'background' | 'popup' | 'options', deliver?: Sink): () => void {
  if (!installed) {
    installed = true;
    where = context;
    origin = extensionOrigin();
    // An extension page or the worker runs nothing but Geld; a content script shares its window with the page.
    ownOnly = context === 'content';
    batching = context === 'content';
    if (deliver !== undefined) sink = deliver;
    globalThis.addEventListener('error', onError);
    globalThis.addEventListener('unhandledrejection', onRejection);
    globalThis.addEventListener('pagehide', onPageHide);
  }
  return () => {
    globalThis.removeEventListener('error', onError);
    globalThis.removeEventListener('unhandledrejection', onRejection);
    globalThis.removeEventListener('pagehide', onPageHide);
    if (flushQueued) flush();
  };
}
