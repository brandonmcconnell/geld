/**
 * Anonymous usage statistics, in the one shape the extension builds and
 * geld.sh accepts. A payload says which build is running (version, channel,
 * browser) and what happened to it (installed, updated from one version to
 * another, active today). It carries no identifier of any kind: no install id,
 * no account, no page, repository or file, and the site adds none when it
 * forwards the events. Counting is done by events alone: an install pings once
 * per UTC day, so a day's `extension_active` events are that day's active
 * installs, and the ones flagged `first_of_week` are the week's.
 */

export const USAGE_PAYLOAD_VERSION = 1;
export const MAX_USAGE_EVENTS = 50;

export type UsageChannel = 'stable' | 'nightly';
export type UsageBrowser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
/** Who started a nightly build's update: the reader pressing Install, or the build on its own (Automatic). */
export type UpdateTrigger = 'manual' | 'automatic';
/** The nightly build's Update setting at the time. */
export type UpdateMode = 'manual' | 'automatic';
/** How a nightly build got its new files: written through folder access, the downloads API, or by another profile sharing the folder. */
export type UpdateMethod = 'folder' | 'downloads' | 'shared';

export interface NightlyUsage {
  readonly mode: UpdateMode;
}

export interface InstalledEvent {
  readonly name: 'extension_installed';
  readonly at: number;
}

export interface UpdatedEvent {
  readonly name: 'extension_updated';
  readonly at: number;
  /** The version before the update; the payload's `version` is the one after. */
  readonly from: string;
  /** A self-updating nightly build's own record of the update, when it made it. */
  readonly trigger?: UpdateTrigger;
  readonly method?: UpdateMethod;
  readonly rollback?: true;
}

export interface ActiveEvent {
  readonly name: 'extension_active';
  readonly at: number;
  /** This install's first ping of the ISO week (UTC), so the week's flagged pings count weekly active installs. */
  readonly firstOfWeek: boolean;
  /** Its first ping of the calendar month (UTC). */
  readonly firstOfMonth: boolean;
}

export type UsageEvent = InstalledEvent | UpdatedEvent | ActiveEvent;

export interface UsagePayload {
  readonly v: typeof USAGE_PAYLOAD_VERSION;
  readonly version: string;
  readonly channel: UsageChannel;
  readonly browser: UsageBrowser;
  /** Only from a self-updating nightly build (named so a store build, which leaves it out, never carries the word nightly). */
  readonly selfUpdate?: NightlyUsage;
  readonly events: readonly UsageEvent[];
}

const VERSION = /^\d+(?:\.\d+){0,3}$/;
const BROWSERS: readonly UsageBrowser[] = ['chrome', 'edge', 'firefox', 'safari', 'other'];
const CHANNELS: readonly UsageChannel[] = ['stable', 'nightly'];
const MODES: readonly UpdateMode[] = ['manual', 'automatic'];
const METHODS: readonly UpdateMethod[] = ['folder', 'downloads', 'shared'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function oneOf<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value);
}

function parseEvent(value: unknown): UsageEvent | null {
  if (!isRecord(value) || !isTime(value.at)) return null;
  const at = value.at;
  switch (value.name) {
    case 'extension_installed':
      return { name: 'extension_installed', at };
    case 'extension_active':
      if (typeof value.firstOfWeek !== 'boolean' || typeof value.firstOfMonth !== 'boolean') return null;
      return { name: 'extension_active', at, firstOfWeek: value.firstOfWeek, firstOfMonth: value.firstOfMonth };
    case 'extension_updated': {
      if (typeof value.from !== 'string' || !VERSION.test(value.from)) return null;
      const trigger = oneOf(MODES, value.trigger);
      const method = oneOf(METHODS, value.method);
      return {
        name: 'extension_updated',
        at,
        from: value.from,
        ...(trigger === undefined ? {} : { trigger }),
        ...(method === undefined ? {} : { method }),
        ...(value.rollback === true ? { rollback: true as const } : {}),
      };
    }
    default:
      return null;
  }
}

/** A payload as received, or `null` when it is not one. Anything not named here is dropped, so a modified client cannot add fields. */
export function parseUsagePayload(value: unknown): UsagePayload | null {
  if (!isRecord(value) || value.v !== USAGE_PAYLOAD_VERSION) return null;
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) return null;
  const channel = oneOf(CHANNELS, value.channel);
  const browser = oneOf(BROWSERS, value.browser);
  if (channel === undefined || browser === undefined) return null;
  if (!Array.isArray(value.events) || value.events.length === 0 || value.events.length > MAX_USAGE_EVENTS) return null;
  const events = value.events.map(parseEvent);
  if (!events.every((event): event is UsageEvent => event !== null)) return null;
  const mode = isRecord(value.selfUpdate) ? oneOf(MODES, value.selfUpdate.mode) : undefined;
  return { v: USAGE_PAYLOAD_VERSION, version: value.version, channel, browser, ...(mode === undefined ? {} : { selfUpdate: { mode } }), events };
}

/** How far an update moved: the first part that changed, `downgrade` going back (a nightly roll back), `same` for a reinstall of one version. */
export type VersionJump = 'major' | 'minor' | 'patch' | 'build' | 'downgrade' | 'same';

function parts(version: string): number[] {
  return version.split('.').map(Number);
}

/** The fourth part of a CI version (its build number), or null for a local build that has none. */
export function usageBuildOf(version: string): number | null {
  const all = version.split('.');
  return all.length === 4 && /^\d+$/.test(all[3] ?? '') ? Number(all[3]) : null;
}

export function versionJump(from: string, to: string): VersionJump {
  const left = parts(from);
  const right = parts(to);
  const names: readonly VersionJump[] = ['major', 'minor', 'patch', 'build'];
  for (let i = 0; i < 4; i++) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff < 0) return 'downgrade';
    if (diff > 0) return names[i] ?? 'build';
  }
  return 'same';
}

export type UsageProperty = string | number | boolean | null;

/** One event as geld.sh hands it to the analytics store: a name, when it happened, and flat properties. */
export interface UsageCapture {
  readonly event: UsageEvent['name'];
  readonly timestamp: string;
  readonly properties: Readonly<Record<string, UsageProperty>>;
}

/** A client clock this far off is not believed: the event is stamped when it arrived. */
const MAX_PAST_MS = 7 * 86_400_000;
const MAX_FUTURE_MS = 60 * 60_000;

/**
 * The payload's events as flat property sets. Everything derived (build
 * numbers, how far an update jumped, who started it) is worked out here from
 * the validated versions, so the client sends only what it knows.
 * `update_trigger` is the nightly build's own record of an update it made, or
 * `store` for a stable build (its browser's store updated it) and `by_hand`
 * for a nightly build that found new files it did not write itself.
 */
export function usageCaptures(payload: UsagePayload, receivedAt: number): UsageCapture[] {
  const build = usageBuildOf(payload.version);
  const common: Record<string, UsageProperty> = {
    version: payload.version,
    build,
    channel: payload.channel,
    browser: payload.browser,
    ...(payload.selfUpdate === undefined ? {} : { nightly_mode: payload.selfUpdate.mode }),
  };
  return payload.events.map((event) => {
    const at = event.at < receivedAt - MAX_PAST_MS || event.at > receivedAt + MAX_FUTURE_MS ? receivedAt : event.at;
    const timestamp = new Date(at).toISOString();
    switch (event.name) {
      case 'extension_installed':
        return { event: event.name, timestamp, properties: common };
      case 'extension_active':
        return { event: event.name, timestamp, properties: { ...common, first_of_week: event.firstOfWeek, first_of_month: event.firstOfMonth } };
      case 'extension_updated': {
        const fromBuild = usageBuildOf(event.from);
        return {
          event: event.name,
          timestamp,
          properties: {
            ...common,
            from_version: event.from,
            from_build: fromBuild,
            build_delta: build === null || fromBuild === null ? null : build - fromBuild,
            version_jump: versionJump(event.from, payload.version),
            upgrade_path: `${event.from} → ${payload.version}`,
            update_trigger: event.trigger ?? (payload.channel === 'stable' ? 'store' : 'by_hand'),
            update_method: event.method ?? null,
            rollback: event.rollback === true,
          },
        };
      }
    }
  });
}

/** UTC calendar day, ISO week and month keys for a moment: what decides whether a ping is the day's, week's or month's first. */
export function usagePeriods(at: number): { readonly day: string; readonly week: string; readonly month: string } {
  const date = new Date(at);
  const day = date.toISOString().slice(0, 10);
  // ISO weeks start on Monday and belong to the year of their Thursday; week 1 holds January 4.
  const thursday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstThursday = Date.UTC(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thursday - firstThursday) / (7 * 86_400_000));
  return { day, week: `${year}-W${String(week).padStart(2, '0')}`, month: day.slice(0, 7) };
}
