import type { Catalog } from '@geld/core';
import { BUNDLED_CATALOG, CATALOG_PUBLIC_KEY, catalogRejection, formatCatalogVersion, parseCatalogText, resolveCatalog, verifyCatalogSignature } from '@geld/core';
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { settingsItem } from './storage';

/**
 * The updatable pattern catalog on the extension side: a cached copy of the
 * signed `catalog/patterns.json` from the repository, the status of the last
 * check, and the fetch that runs in the background. The pure parts —
 * validation, signature verification, merging with the bundled catalog — are
 * in `@geld/core` (`catalog.ts`); nothing here decides what a catalog may
 * change, it only decides *whether* to look and stores what it found.
 *
 * Every surface (content script, popup, options) resolves its catalog with
 * {@link loadCatalog} and follows changes with {@link watchCatalog}, so a
 * fetched update applies without a reload.
 */

/**
 * `api.github.com` is already a host permission (sign-in and gist sync use
 * it); fetching through the contents API with the raw media type keeps the
 * manifest unchanged, whereas `raw.githubusercontent.com` would need a new
 * host permission and disable the extension in Chrome until re-approved.
 */
const CONTENTS_URL = 'https://api.github.com/repos/brandonmcconnell/geld/contents/catalog/';
const JSON_URL = `${CONTENTS_URL}patterns.json?ref=main`;
const SIG_URL = `${CONTENTS_URL}patterns.sig?ref=main`;
/** Refuse anything implausibly large before reading it; the real file is ~20 KB. */
const MAX_CATALOG_BYTES = 512 * 1024;

export const CATALOG_ALARM = 'geld:catalog-check';
/**
 * How often the alarm fires; browser restarts also check (subject to
 * {@link MIN_CHECK_INTERVAL_MS}). Six hours: the catalog now also carries the
 * PR-list selectors, so a GitHub markup change should be fixed the same day.
 */
export const CATALOG_CHECK_PERIOD_MINUTES = 6 * 60;
/** Startups closer together than this do not re-check; unauthenticated GitHub allows 60 requests an hour per IP. */
const MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** After a rate-limit response with no usable reset header, wait this long. */
const DEFAULT_BACKOFF_MS = 60 * 60 * 1000;

/** The accepted catalog: its verified JSON text, kept so the parser of a later build can re-check it. */
export interface CachedCatalog {
  readonly version: number;
  readonly fetchedAt: number;
  readonly json: string;
}

export type CatalogCheckOutcome =
  /** A newer catalog was verified and stored. */
  | { readonly kind: 'updated'; readonly version: number }
  /** The repository has nothing newer than what this build already uses. */
  | { readonly kind: 'current' }
  /** GitHub's unauthenticated rate limit; not an error, we simply wait. */
  | { readonly kind: 'rate-limited'; readonly until: number }
  /** The file was fetched but must not be used (bad signature, invalid, needs a newer Geld). */
  | { readonly kind: 'rejected'; readonly reason: string }
  /** Could not fetch (offline, HTTP error). */
  | { readonly kind: 'failed'; readonly reason: string };

export interface CatalogStatus {
  readonly lastCheckedAt: number | null;
  readonly lastOutcome: CatalogCheckOutcome | null;
  /** Set while a check is running so the options page can say "Checking…". */
  readonly checking: boolean;
  /** Do not ask GitHub again before this time (rate limit). */
  readonly backoffUntil: number | null;
}

export const EMPTY_CATALOG_STATUS: CatalogStatus = { lastCheckedAt: null, lastOutcome: null, checking: false, backoffUntil: null };

export const catalogItem = storage.defineItem<CachedCatalog | null>('local:catalog', { fallback: null });
export const catalogStatusItem = storage.defineItem<CatalogStatus>('local:catalogStatus', { fallback: EMPTY_CATALOG_STATUS });

/**
 * The catalog to use given what is cached: the bundled one when nothing (or
 * nothing newer) is cached, otherwise the fetched content on top of the
 * bundled policy. A cached copy that no longer parses (the format moved on
 * in this build, or storage was damaged) is ignored, not trusted.
 */
export function catalogFromCache(cached: CachedCatalog | null): Catalog {
  if (cached === null || cached.version <= BUNDLED_CATALOG.version) return BUNDLED_CATALOG;
  const parsed = parseCatalogText(cached.json);
  if (!parsed.ok) return BUNDLED_CATALOG;
  return resolveCatalog(BUNDLED_CATALOG, parsed.document);
}

export async function loadCatalog(): Promise<Catalog> {
  return catalogFromCache(await catalogItem.getValue());
}

/** Call `callback` with the new active catalog whenever the cached copy changes. */
export function watchCatalog(callback: (catalog: Catalog) => void): () => void {
  return catalogItem.watch((cached) => callback(catalogFromCache(cached)));
}

/** "Patterns updated 8 Sep 2026 (catalog 2026.09.08)" or "Built-in patterns (v2026.09.09)". */
export function describeCatalog(cached: CachedCatalog | null, locale?: string): string {
  const active = catalogFromCache(cached);
  if (active === BUNDLED_CATALOG || cached === null) return `Built-in patterns (v${formatCatalogVersion(BUNDLED_CATALOG.version)})`;
  const date = new Date(cached.fetchedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `Patterns updated ${date} (catalog ${formatCatalogVersion(active.version)})`;
}

/** A sentence for the last outcome worth telling the user about, or `null` when there is nothing to say. */
export function describeCatalogOutcome(status: CatalogStatus, locale?: string): { readonly text: string; readonly tone: 'error' | 'muted' } | null {
  const outcome = status.lastOutcome;
  if (outcome === null) return null;
  switch (outcome.kind) {
    case 'rejected':
      return { text: `The latest catalog was not applied: ${outcome.reason}.`, tone: 'error' };
    case 'failed':
      return { text: `Could not check for new patterns: ${outcome.reason}.`, tone: 'error' };
    case 'rate-limited':
      return { text: `GitHub's rate limit was reached; Geld will check again after ${new Date(outcome.until).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}.`, tone: 'muted' };
    case 'updated':
    case 'current':
      return null;
  }
}

/* ------------------------------------------------------------------ fetch */

async function setStatus(patch: Partial<CatalogStatus>): Promise<void> {
  // Spread the defaults first so a status saved by an older build gains new fields.
  const current = await catalogStatusItem.getValue();
  await catalogStatusItem.setValue({ ...EMPTY_CATALOG_STATUS, ...current, ...patch });
}

type Fetched = { readonly ok: true; readonly body: string } | { readonly ok: false; readonly outcome: CatalogCheckOutcome };

/** Milliseconds until the rate limit resets, from GitHub's header, or the default backoff. */
function backoffFrom(response: Response): number {
  const reset = Number.parseInt(response.headers.get('x-ratelimit-reset') ?? '', 10);
  const until = Number.isFinite(reset) ? reset * 1000 : Number.NaN;
  // Never trust the header to make us wait less than a minute or more than a day.
  const now = Date.now();
  if (!Number.isFinite(until) || until < now + 60 * 1000) return now + DEFAULT_BACKOFF_MS;
  return Math.min(until, now + 24 * 60 * 60 * 1000);
}

async function fetchText(url: string): Promise<Fetched> {
  let response: Response;
  try {
    // The raw media type returns the file's bytes rather than a JSON envelope;
    // no credentials, so a signed-in user's token is never spent on this.
    response = await fetch(url, { headers: { Accept: 'application/vnd.github.raw+json' }, credentials: 'omit', cache: 'no-store' });
  } catch (error) {
    return { ok: false, outcome: { kind: 'failed', reason: error instanceof Error && error.message !== '' ? error.message : 'network error' } };
  }
  if (response.status === 403 || response.status === 429) {
    return { ok: false, outcome: { kind: 'rate-limited', until: backoffFrom(response) } };
  }
  if (!response.ok) return { ok: false, outcome: { kind: 'failed', reason: `GitHub answered HTTP ${response.status}` } };
  const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
  if (declared > MAX_CATALOG_BYTES) return { ok: false, outcome: { kind: 'rejected', reason: 'the file is implausibly large' } };
  const body = await response.text();
  if (body.length > MAX_CATALOG_BYTES) return { ok: false, outcome: { kind: 'rejected', reason: 'the file is implausibly large' } };
  return { ok: true, body };
}

/** UTF-8 bytes of the file exactly as fetched; the signature covers these, not a re-serialisation. */
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(new ArrayBuffer(text.length * 3));
  const { written } = new TextEncoder().encodeInto(text, buffer);
  return buffer.slice(0, written);
}

/**
 * Download, verify and — if it is newer and this build may use it — store the
 * catalog. Order matters: the signature is checked before the JSON is even
 * parsed, so unsigned content never reaches the parser, and validation runs
 * before the version comparison so a bad file is reported as bad rather than
 * as "not newer".
 */
async function fetchAndVerify(): Promise<CatalogCheckOutcome> {
  const json = await fetchText(JSON_URL);
  if (!json.ok) return json.outcome;
  const sig = await fetchText(SIG_URL);
  if (!sig.ok) return sig.outcome;

  if (!(await verifyCatalogSignature(bytesOf(json.body), sig.body, CATALOG_PUBLIC_KEY))) {
    return { kind: 'rejected', reason: 'its signature does not verify' };
  }
  const parsed = parseCatalogText(json.body);
  if (!parsed.ok) return { kind: 'rejected', reason: parsed.reason };

  const active = await loadCatalog();
  const rejection = catalogRejection(parsed.document, { extensionVersion: browser.runtime.getManifest().version, currentVersion: active.version });
  if (rejection !== null) {
    if (rejection.kind === 'not-newer') return { kind: 'current' };
    return { kind: 'rejected', reason: rejection.reason };
  }
  await catalogItem.setValue({ version: parsed.document.version, fetchedAt: Date.now(), json: json.body });
  return { kind: 'updated', version: parsed.document.version };
}

let inFlight: Promise<CatalogCheckOutcome | null> | null = null;

/**
 * Check for a newer catalog. `manual` (the options page's "Check now") skips
 * the opt-out, the startup throttle and the rate-limit backoff — one request
 * on the user's say-so is fine; if GitHub still says no, the backoff extends.
 * Returns `null` when the check was skipped. Concurrent callers share one run.
 */
export function checkCatalog(manual = false): Promise<CatalogCheckOutcome | null> {
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    try {
      const status = await catalogStatusItem.getValue();
      if (!manual) {
        const settings = await settingsItem.getValue();
        if (!settings.autoUpdatePatterns) return null;
        const now = Date.now();
        if (status.backoffUntil !== null && status.backoffUntil > now) return null;
        if (status.lastCheckedAt !== null && now - status.lastCheckedAt < MIN_CHECK_INTERVAL_MS) return null;
      }
      await setStatus({ checking: true });
      let outcome: CatalogCheckOutcome;
      try {
        outcome = await fetchAndVerify();
      } catch (error) {
        outcome = { kind: 'failed', reason: error instanceof Error && error.message !== '' ? error.message : 'unexpected error' };
      }
      await setStatus({
        checking: false,
        lastCheckedAt: Date.now(),
        lastOutcome: outcome,
        backoffUntil: outcome.kind === 'rate-limited' ? outcome.until : null,
      });
      return outcome;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * After an update the bundled catalog may have caught up with the cache;
 * dropping the stale copy keeps `storage.local` honest (and the options page
 * saying "Built-in patterns" when that is what runs).
 */
export async function pruneCatalogCache(): Promise<void> {
  const cached = await catalogItem.getValue();
  if (cached !== null && cached.version <= BUNDLED_CATALOG.version) await catalogItem.setValue(null);
}

/**
 * Background wiring: a daily alarm plus a check on install/update and on
 * browser start. `alarms` carries no install warning, and an alarm is the only
 * timer that survives an MV3 service worker being put to sleep.
 */
export function startCatalogUpdates(): void {
  const schedule = (): void => {
    void browser.alarms
      .get(CATALOG_ALARM)
      .then((existing) => {
        // Recreate when the period changed in an update; alarms outlive the code that made them.
        if (existing === undefined || existing.periodInMinutes !== CATALOG_CHECK_PERIOD_MINUTES) {
          return browser.alarms.create(CATALOG_ALARM, { periodInMinutes: CATALOG_CHECK_PERIOD_MINUTES });
        }
        return undefined;
      })
      .catch(() => undefined);
  };
  const check = (): void => {
    void pruneCatalogCache()
      .then(() => checkCatalog())
      .catch(() => undefined);
  };
  browser.runtime.onInstalled.addListener(() => {
    schedule();
    check();
  });
  browser.runtime.onStartup.addListener(() => {
    schedule();
    check();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CATALOG_ALARM) check();
  });
  // The worker was (re)started for some other reason: make sure the alarm exists.
  schedule();
}
