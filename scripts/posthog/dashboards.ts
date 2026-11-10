/**
 * The PostHog dashboards over the extension's anonymous usage statistics
 * (`@geld/core/usage-report.ts`), as data. `scripts/posthog-dashboards.ts`
 * creates them in a project, or brings existing ones in line, by name.
 *
 * There is no install id, so every number is a count of events: an install
 * pings `extension_active` once per UTC day, so a day's pings are that day's
 * active installs, and pings flagged `first_of_week` are a week's.
 */

export type Display = 'ActionsLineGraph' | 'ActionsBar' | 'ActionsAreaGraph' | 'ActionsTable' | 'ActionsBarValue' | 'BoldNumber';

export interface EventFilter {
  readonly key: string;
  readonly value: string | boolean | readonly string[];
}

export interface TrendTile {
  readonly kind: 'trend';
  readonly name: string;
  readonly description: string;
  readonly event: string;
  readonly math?: { readonly kind: 'avg' | 'sum' | 'max'; readonly property: string };
  readonly where?: readonly EventFilter[];
  readonly breakdown?: string;
  readonly interval: 'day' | 'week' | 'month';
  readonly from: string;
  readonly display: Display;
}

export interface SqlTile {
  readonly kind: 'sql';
  readonly name: string;
  readonly description: string;
  readonly query: string;
}

export type Tile = TrendTile | SqlTile;

export interface DashboardSpec {
  readonly name: string;
  readonly description: string;
  readonly tiles: readonly Tile[];
}

const NIGHTLY: EventFilter = { key: 'channel', value: 'nightly' };
const WEEKLY: EventFilter = { key: 'first_of_week', value: true };

const OLDER_BUILD_SQL = `
SELECT channel,
  count() AS active_installs,
  countIf(build = newest) AS on_newest_build,
  countIf(build < newest) AS on_an_older_build,
  round(100 * countIf(build < newest) / count(), 1) AS percent_behind,
  round(avgIf(newest - build, build < newest), 1) AS builds_behind_when_behind
FROM (
  SELECT channel, build, max(build) OVER (PARTITION BY channel) AS newest
  FROM (
    SELECT properties.channel AS channel, toInt(properties.build) AS build
    FROM events
    WHERE event = 'extension_active'
      AND properties.build IS NOT NULL
      AND timestamp >= toStartOfDay(now()) - INTERVAL 1 DAY
      AND timestamp < toStartOfDay(now())
  )
)
GROUP BY channel
ORDER BY channel
`.trim();

export const USAGE_DASHBOARD: DashboardSpec = {
  name: 'Geld · Installs & updates',
  description:
    'Anonymous counts from the extension: installs, updates (with the version before and after) and one ping per install per day. No install id, so a day’s pings are its active installs and pings flagged first_of_week are the week’s. Firefox builds send nothing.',
  tiles: [
    {
      kind: 'trend',
      name: 'Installs per day, by channel',
      description: 'New installs of Geld Stable and Geld Nightly. A reinstall counts again, since uninstalling clears the extension’s storage.',
      event: 'extension_installed',
      breakdown: 'channel',
      interval: 'day',
      from: '-90d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Updates per day, by channel',
      description: 'Installs that started running a new version that day.',
      event: 'extension_updated',
      breakdown: 'channel',
      interval: 'day',
      from: '-90d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Daily active installs, by channel',
      description: 'One ping per install per UTC day while the browser runs Geld.',
      event: 'extension_active',
      breakdown: 'channel',
      interval: 'day',
      from: '-90d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Weekly active installs, by channel',
      description: 'Each install’s first ping of the ISO week. Falling weeks with steady installs are churn.',
      event: 'extension_active',
      where: [WEEKLY],
      breakdown: 'channel',
      interval: 'week',
      from: '-180d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Daily active installs, by version',
      description: 'Which versions are running. A new release shows as a new band taking over from the one before.',
      event: 'extension_active',
      breakdown: 'version',
      interval: 'day',
      from: '-60d',
      display: 'ActionsAreaGraph',
    },
    {
      kind: 'sql',
      name: 'Active installs on an older build (yesterday)',
      description:
        'Yesterday’s pings against the newest build seen that day, per channel. Installs that stay behind have not received the update or have stopped updating.',
      query: OLDER_BUILD_SQL,
    },
    {
      kind: 'trend',
      name: 'Updates by version reached',
      description: 'How quickly each release is taken up.',
      event: 'extension_updated',
      breakdown: 'version',
      interval: 'day',
      from: '-60d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'How far updates jump',
      description: 'The first part of the version that changed: build, patch, minor, major, or downgrade (a nightly roll back).',
      event: 'extension_updated',
      breakdown: 'version_jump',
      interval: 'week',
      from: '-180d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Builds between versions per update (average)',
      description: 'CI run numbers between the version before and after. Run numbers also count runs that released nothing, so this is an upper bound on releases skipped.',
      event: 'extension_updated',
      math: { kind: 'avg', property: 'build_delta' },
      breakdown: 'channel',
      interval: 'week',
      from: '-180d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Upgrade paths (last 30 days)',
      description: 'Every from → to pair seen, most common first. Skipped versions show as paths that jump past them.',
      event: 'extension_updated',
      breakdown: 'upgrade_path',
      interval: 'day',
      from: '-30d',
      display: 'ActionsTable',
    },
    {
      kind: 'trend',
      name: 'Nightly updates by trigger',
      description: 'automatic: the build installed it on its own. manual: the reader pressed Install or Roll back. by_hand: new files the build did not write (the installer, or an unzip).',
      event: 'extension_updated',
      where: [NIGHTLY],
      breakdown: 'update_trigger',
      interval: 'week',
      from: '-180d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Weekly active nightly installs, by update mode',
      description: 'Self-updating nightly builds (Chrome, Edge) by their Update setting.',
      event: 'extension_active',
      where: [NIGHTLY, WEEKLY],
      breakdown: 'nightly_mode',
      interval: 'week',
      from: '-180d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Weekly active installs, by browser',
      description: 'Chrome, Edge and Safari. Firefox builds send nothing.',
      event: 'extension_active',
      where: [WEEKLY],
      breakdown: 'browser',
      interval: 'week',
      from: '-180d',
      display: 'ActionsBar',
    },
  ],
};

export const DASHBOARDS: readonly DashboardSpec[] = [USAGE_DASHBOARD];
