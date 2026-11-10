import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import type { GeldSettings, UpdateMethod, UpdateMode, UsageBrowser, UsageCounter, UsageEvent, UsagePayload } from '@geld/core';
import { MAX_USAGE_EVENTS, USAGE_COUNTER_CAP, USAGE_MAX_AGE_MS, USAGE_PAYLOAD_VERSION, usagePeriods, usageSettingsOf } from '@geld/core';
import { recordDiagnostic } from './diagnostics';
import { settingsItem } from './storage';

/**
 * Anonymous usage statistics (`usageStats`, on by default): an event when Geld
 * is installed, one when the running version changes (with the version before),
 * and one ping per UTC day while the browser runs. Nothing identifies the
 * install: the events carry the version, channel and browser, the day's ping
 * how often features were used since the one before (`countUsage`), and the
 * week's first ping a summary of the settings (`usageSettingsOf`, choices Geld
 * offers and capped counts, never what the reader typed). The queue lives in
 * local storage only until geld.sh has taken it (events older than 30 days
 * are dropped unsent). Development
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
  /** Feature uses since the last ping, handed to the next one. */
  readonly counts?: Readonly<Partial<Record<UsageCounter, number>>>;
}

const EMPTY: UsageState = { version: null, day: null, week: null, month: null, queue: [], counts: {} };
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
    version: currentVersion(),
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
    if (reason === 'install') return { next: { ...enqueue(state, { name: 'extension_installed', at: now, version }), version }, result: undefined };
    if (update === null || state.version === version) return { next: { ...state, version }, result: undefined };
    return { next: { ...enqueue(state, update), version }, result: undefined };
  });
}

function eventKey(event: UsageEvent): string {
  return `${event.name}\u0000${event.at}`;
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
  const settings = await settingsItem.getValue();
  await serially(async (state) => {
    if (state.day === periods.day) return { next: state, result: undefined };
    const firstOfWeek = state.week !== periods.week;
    const counts = state.counts ?? {};
    const event: UsageEvent = {
      name: 'extension_active',
      at: now,
      version: currentVersion(),
      firstOfWeek,
      firstOfMonth: state.month !== periods.month,
      ...(firstOfWeek ? { settings: usageSettingsOf(settings) } : {}),
      ...(Object.keys(counts).length > 0 ? { counts } : {}),
    };
    return { next: { ...enqueue(state, event), day: periods.day, week: periods.week, month: periods.month, counts: {} }, result: undefined };
  });
}

/** One more use of a feature for the next ping; nothing is kept while the statistics are off. */
export async function addUsageCount(counter: UsageCounter, by: number): Promise<void> {
  if (!sendsUsage(await settingsItem.getValue())) return;
  await serially(async (state) => {
    const counts = state.counts ?? {};
    return { next: { ...state, counts: { ...counts, [counter]: Math.min((counts[counter] ?? 0) + by, USAGE_COUNTER_CAP) } }, result: undefined };
  });
}

let flushing: Promise<void> | null = null;

/** The answer to a send: taken (drop the batch), refused as malformed (drop it too, sending it again would not help), or to be tried again. */
type SendOutcome = 'sent' | 'refused' | 'retry';

async function send(payload: UsagePayload): Promise<SendOutcome> {
  try {
    // A simple request (text/plain, no credentials) needs no preflight; geld.sh answers with CORS, so the status can be read with no host permission.
    const response = await fetch(USAGE_ENDPOINT, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
    if (response.ok) return 'sent';
    return response.status === 400 || response.status === 413 ? 'refused' : 'retry';
  } catch {
    // Offline, or no CORS answer at all (the route not deployed yet): kept for the next ping.
    return 'retry';
  }
}

async function flush(nightly: NightlyUsageSource | null): Promise<void> {
  const settings = await settingsItem.getValue();
  if (!sendsUsage(settings)) {
    if ((await stateItem.getValue()).queue.length > 0) await serially(async (state) => ({ next: { ...state, queue: [], counts: {} }, result: undefined }));
    return;
  }
  const oldest = Date.now() - USAGE_MAX_AGE_MS;
  const queue = await serially(async (state) => {
    const kept = state.queue.filter((event) => event.at >= oldest);
    return { next: kept.length === state.queue.length ? state : { ...state, queue: kept }, result: kept };
  });
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
  const outcome = await send(payload);
  recordDiagnostic({ kind: 'usage-report', subject: `${queue.length} events`, outcome });
  if (outcome === 'retry') return;
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
    if (!sendsUsage(settings)) void serially(async (state) => ({ next: { ...state, queue: [], counts: {} }, result: undefined })).catch(() => undefined);
  });
}
