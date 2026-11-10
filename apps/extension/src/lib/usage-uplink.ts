import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import type { GeldSettings, UpdateMethod, UpdateMode, UsageBrowser, UsageEvent, UsagePayload } from '@geld/core';
import { MAX_USAGE_EVENTS, USAGE_PAYLOAD_VERSION, usagePeriods } from '@geld/core';
import { recordDiagnostic } from './diagnostics';
import { settingsItem } from './storage';

/**
 * Anonymous usage statistics (`usageStats`, on by default): an event when Geld
 * is installed, one when the running version changes (with the version before),
 * and one ping per UTC day while the browser runs. Nothing identifies the
 * install: the events carry the version, channel and browser and nothing else,
 * and the queue lives in local storage only until geld.sh has it. Development
 * builds never send, and neither does Firefox, which wants its own
 * data-collection permission for this (not yet requested).
 */

export const USAGE_ENDPOINT = 'https://www.geld.sh/api/usage';
const ALARM = 'geld:usage';
const PING_EVERY_MINUTES = 60;
/** onInstalled reaches a fresh worker moments after it starts; the version check waits for it, so an update is told by the browser's own `previousVersion`. */
const RECONCILE_DELAY_MS = 5_000;

export interface NightlyUsageInfo {
  readonly mode: UpdateMode;
  readonly install: { readonly method: UpdateMethod; readonly rollback?: true; readonly trigger?: UpdateMode } | null;
}

/** A self-updating nightly build says how it came to run `version`; store builds pass none. */
export type NightlyUsageSource = (version: string) => Promise<NightlyUsageInfo>;

interface UsageState {
  /** The version this install last ran; null before the first run that recorded it. */
  readonly version: string | null;
  readonly day: string | null;
  readonly week: string | null;
  readonly month: string | null;
  readonly queue: readonly UsageEvent[];
}

const EMPTY: UsageState = { version: null, day: null, week: null, month: null, queue: [] };
const stateItem = storage.defineItem<UsageState>('local:usageState', { fallback: EMPTY });

let chain: Promise<unknown> = Promise.resolve();

/** Run `change` after every state change already asked for: onInstalled, the version check, the ping and a send's cleanup each read and rewrite it. */
function serially<T>(change: (state: UsageState) => Promise<{ readonly next: UsageState; readonly result: T }>): Promise<T> {
  const run = chain.then(async () => {
    const { next, result } = await change({ ...EMPTY, ...(await stateItem.getValue()) });
    await stateItem.setValue(next);
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function sendsUsage(settings: GeldSettings): boolean {
  return settings.usageStats && !import.meta.env.DEV && !import.meta.env.FIREFOX;
}

function usageBrowser(): UsageBrowser {
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

function currentVersion(): string {
  return browser.runtime.getManifest().version;
}

async function updatedEvent(from: string, nightly: NightlyUsageSource | null, at: number): Promise<UsageEvent> {
  const install = nightly === null ? null : (await nightly(currentVersion()).catch(() => null))?.install ?? null;
  return {
    name: 'extension_updated',
    at,
    from,
    ...(install?.trigger === undefined ? {} : { trigger: install.trigger }),
    ...(install === null ? {} : { method: install.method }),
    ...(install?.rollback === true ? { rollback: true as const } : {}),
  };
}

function enqueue(state: UsageState, event: UsageEvent): UsageState {
  return { ...state, queue: [...state.queue, event].slice(-MAX_USAGE_EVENTS) };
}

/**
 * A fresh install, or a version change the browser told us about. The first
 * telemetry-carrying version reaches existing installs as an update, so its
 * `previousVersion` is the only record of where they came from.
 */
async function noteInstalled(reason: string, previousVersion: string | undefined, nightly: NightlyUsageSource | null): Promise<void> {
  const now = Date.now();
  const version = currentVersion();
  const update = reason === 'update' && previousVersion !== undefined && previousVersion !== version ? await updatedEvent(previousVersion, nightly, now) : null;
  await serially(async (state) => {
    if (reason === 'install') return { next: { ...enqueue(state, { name: 'extension_installed', at: now }), version }, result: undefined };
    if (update === null || state.version === version) return { next: { ...state, version }, result: undefined };
    return { next: { ...enqueue(state, update), version }, result: undefined };
  });
}

/** A version change onInstalled did not report (a worker that missed it): told from the version last recorded. */
async function reconcileVersion(nightly: NightlyUsageSource | null): Promise<void> {
  const version = currentVersion();
  const before = (await stateItem.getValue()).version;
  const update = before !== null && before !== version ? await updatedEvent(before, nightly, Date.now()) : null;
  await serially(async (state) => {
    if (state.version === version) return { next: state, result: undefined };
    return { next: { ...(update !== null && state.version === before ? enqueue(state, update) : state), version }, result: undefined };
  });
}

async function ping(): Promise<void> {
  const now = Date.now();
  const periods = usagePeriods(now);
  await serially(async (state) => {
    if (state.day === periods.day) return { next: state, result: undefined };
    const event: UsageEvent = { name: 'extension_active', at: now, firstOfWeek: state.week !== periods.week, firstOfMonth: state.month !== periods.month };
    return { next: { ...enqueue(state, event), day: periods.day, week: periods.week, month: periods.month }, result: undefined };
  });
}

function eventKey(event: UsageEvent): string {
  return `${event.name}\u0000${event.at}`;
}

let flushing: Promise<void> | null = null;

async function flush(nightly: NightlyUsageSource | null): Promise<void> {
  const settings = await settingsItem.getValue();
  const queue = (await stateItem.getValue()).queue;
  if (!sendsUsage(settings)) {
    if (queue.length > 0) await serially(async (state) => ({ next: { ...state, queue: [] }, result: undefined }));
    return;
  }
  if (queue.length === 0) return;
  const info = nightly === null ? null : await nightly(currentVersion()).catch(() => null);
  const payload: UsagePayload = {
    v: USAGE_PAYLOAD_VERSION,
    version: currentVersion(),
    channel: __GELD_CHANNEL__,
    browser: usageBrowser(),
    ...(info === null ? {} : { selfUpdate: { mode: info.mode } }),
    events: queue,
  };
  try {
    // A simple request (text/plain, no credentials) needs no CORS preflight and no host permission; the answer is not read.
    await fetch(USAGE_ENDPOINT, { method: 'POST', mode: 'no-cors', credentials: 'omit', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
  } catch {
    recordDiagnostic({ kind: 'usage-report', subject: `${queue.length} events`, outcome: 'failed' });
    return;
  }
  recordDiagnostic({ kind: 'usage-report', subject: `${queue.length} events`, outcome: 'sent' });
  // Events noted while the request was out stay for the next send.
  const sent = new Set(queue.map(eventKey));
  await serially(async (state) => ({ next: { ...state, queue: state.queue.filter((event) => !sent.has(eventKey(event))) }, result: undefined }));
}

let flushAgain = false;

/** One send at a time; an event noted while one is out goes in a second send right after. */
function flushSoon(nightly: NightlyUsageSource | null): void {
  if (flushing !== null) {
    flushAgain = true;
    return;
  }
  flushing = flush(nightly)
    .catch(() => undefined)
    .finally(() => {
      flushing = null;
      if (!flushAgain) return;
      flushAgain = false;
      flushSoon(nightly);
    });
}

/**
 * Background start. The day's ping is made whatever the setting, so turning
 * the statistics on mid-day does not send a second one, and the flush drops
 * the queue unsent while they are off: nothing noted while off is ever sent.
 */
export function startUsageReports(nightly: NightlyUsageSource | null): void {
  browser.runtime.onInstalled.addListener((details) => {
    void noteInstalled(details.reason, details.previousVersion, nightly)
      .then(() => flushSoon(nightly))
      .catch(() => undefined);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    void ping()
      .then(() => flushSoon(nightly))
      .catch(() => undefined);
  });
  void browser.alarms
    .get(ALARM)
    .then((alarm) => (alarm?.periodInMinutes === PING_EVERY_MINUTES ? undefined : browser.alarms.create(ALARM, { periodInMinutes: PING_EVERY_MINUTES })))
    .catch(() => undefined);
  setTimeout(() => {
    void reconcileVersion(nightly)
      .then(ping)
      .then(() => flushSoon(nightly))
      .catch(() => undefined);
  }, RECONCILE_DELAY_MS);
  settingsItem.watch((settings) => {
    if (!sendsUsage(settings)) void serially(async (state) => ({ next: { ...state, queue: [] }, result: undefined })).catch(() => undefined);
  });
}
