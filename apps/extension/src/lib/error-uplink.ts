import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import type { ErrorPayload, ErrorReport, GeldSettings, ReportBrowser } from '@geld/core';
import { ERROR_PAYLOAD_VERSION, mergeErrorReports } from '@geld/core';
import { recordDiagnostic } from './diagnostics';
import { settingsItem } from './storage';

/**
 * The background's half of error reports. Every report lands in the session
 * log (Copy diagnostics), whatever the setting. With `errorReports` on, it
 * also joins a queue kept in local storage (the worker is stopped after
 * ~30 s idle) that an alarm sends to geld.sh at most every few minutes, the
 * same error repeated counted once. Nothing collected while the setting was
 * off is ever sent: turning it on starts an empty queue, turning it off drops
 * the queue. Development builds never send, and neither does Firefox, which
 * wants its own data-collection permission for this (not yet requested).
 */

export const ERROR_ENDPOINT = 'https://www.geld.sh/api/diagnostics';
const ALARM = 'geld:error-reports';
const MIN_INTERVAL_MS = 5 * 60_000;

const queueItem = storage.defineItem<readonly ErrorReport[]>('local:errorQueue', { fallback: [] });
const sentAtItem = storage.defineItem<number>('local:errorReportSentAt', { fallback: 0 });

let queueChain: Promise<unknown> = Promise.resolve();

/** Run `change` after every queue change already asked for: two tabs' reports, a send's cleanup and an opt-out each read and rewrite the queue. */
function serially<T>(change: () => Promise<T>): Promise<T> {
  const run = queueChain.then(change, change);
  queueChain = run.catch(() => undefined);
  return run;
}

function sends(settings: GeldSettings): boolean {
  return settings.errorReports && !import.meta.env.DEV && !import.meta.env.FIREFOX;
}

function reportBrowser(): ReportBrowser {
  switch (import.meta.env.BROWSER) {
    case 'chrome':
      return 'chrome';
    case 'edge':
      return 'edge';
    case 'firefox':
      return 'firefox';
    case 'safari':
      return 'safari';
    default:
      return 'other';
  }
}

function sentKey(report: ErrorReport): string {
  return `${report.where}\u0000${report.kind}\u0000${report.message}\u0000${report.stack[0] ?? ''}\u0000${report.lastAt}`;
}

/**
 * `sent` is what goes to geld.sh when it differs from what this device logs: an AI provider's words reach the error
 * report the reader opted into, never Copy diagnostics, which the feedback form can attach to a public issue.
 */
export async function queueErrorReports(reports: readonly ErrorReport[], sent: readonly ErrorReport[] = reports): Promise<void> {
  for (const report of reports) recordDiagnostic({ kind: 'error', subject: report.where, outcome: report.message });
  if (!sends(await settingsItem.getValue())) return;
  await serially(async () => queueItem.setValue(mergeErrorReports(await queueItem.getValue(), sent)));
  if ((await browser.alarms.get(ALARM)) === undefined) await browser.alarms.create(ALARM, { delayInMinutes: 1 });
}

async function flushErrorReports(): Promise<void> {
  const queue = await queueItem.getValue();
  if (queue.length === 0) return;
  if (!sends(await settingsItem.getValue())) {
    await serially(() => queueItem.setValue([]));
    return;
  }
  const wait = (await sentAtItem.getValue()) + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await browser.alarms.create(ALARM, { delayInMinutes: Math.max(1, wait / 60_000) });
    return;
  }
  const payload: ErrorPayload = { v: ERROR_PAYLOAD_VERSION, version: browser.runtime.getManifest().version, browser: reportBrowser(), errors: queue };
  try {
    // A simple request (text/plain, no credentials) needs no CORS preflight and no host permission; the answer is not read.
    await fetch(ERROR_ENDPOINT, { method: 'POST', mode: 'no-cors', credentials: 'omit', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
  } catch {
    recordDiagnostic({ kind: 'error-report', subject: `${queue.length} errors`, outcome: 'failed' });
    await browser.alarms.create(ALARM, { delayInMinutes: MIN_INTERVAL_MS / 60_000 });
    return;
  }
  recordDiagnostic({ kind: 'error-report', subject: `${queue.length} errors`, outcome: 'sent' });
  await sentAtItem.setValue(Date.now());
  // An error that arrived or repeated while the request was out (a newer `lastAt`) stays for the next send.
  const sent = new Set(queue.map(sentKey));
  await serially(async () => queueItem.setValue((await queueItem.getValue()).filter((report) => !sent.has(sentKey(report)))));
}

/** Background start: the alarm sends what is queued; turning the setting off drops the queue. */
export function startErrorReports(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void flushErrorReports().catch(() => undefined);
  });
  settingsItem.watch((settings) => {
    if (!sends(settings)) void serially(() => queueItem.setValue([])).catch(() => undefined);
  });
}
