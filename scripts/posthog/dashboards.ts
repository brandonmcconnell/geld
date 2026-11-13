/**
 * The PostHog dashboards over the extension's anonymous usage statistics
 * (`@geld/core/usage-report.ts`), as data. `scripts/posthog-dashboards.ts`
 * creates them in a project, or brings existing ones in line, by name.
 *
 * There is no install id, so every number is a count of events: an install
 * pings `extension_active` once per UTC day, so a day's pings are that day's
 * active installs, and pings flagged `first_of_week` are a week's.
 */

import { CATEGORY_IDS, USAGE_TOGGLES, usageToggleProperty } from '@geld/core';
import type { UsageCounter } from '@geld/core';

export type Display = 'ActionsLineGraph' | 'ActionsBar' | 'ActionsAreaGraph' | 'ActionsTable' | 'ActionsBarValue' | 'BoldNumber';

export interface EventFilter {
  readonly key: string;
  readonly value: string | boolean | readonly string[];
}

export interface Series {
  readonly event: string;
  /** The series' name on the chart; the event's own when absent. */
  readonly label?: string;
  readonly math?: { readonly kind: 'avg' | 'sum' | 'max'; readonly property: string };
  /** Filters for this series alone, on top of the tile's `where`. */
  readonly where?: readonly EventFilter[];
}

export interface TrendTile {
  readonly kind: 'trend';
  readonly name: string;
  readonly description: string;
  readonly series: readonly Series[];
  readonly where?: readonly EventFilter[];
  readonly breakdown?: string;
  /** Series as letters in order (`A / B * 100`). */
  readonly formula?: string;
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
      series: [{ event: 'extension_installed' }],
      breakdown: 'channel',
      interval: 'day',
      from: '-90d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Updates per day, by channel',
      description: 'Installs that started running a new version that day.',
      series: [{ event: 'extension_updated' }],
      breakdown: 'channel',
      interval: 'day',
      from: '-90d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Daily active installs, by channel',
      description: 'One ping per install per UTC day while the browser runs Geld.',
      series: [{ event: 'extension_active' }],
      breakdown: 'channel',
      interval: 'day',
      from: '-90d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Weekly active installs, by channel',
      description: 'Each install’s first ping of the ISO week. Falling weeks with steady installs are churn.',
      series: [{ event: 'extension_active' }],
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
      series: [{ event: 'extension_active' }],
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
      series: [{ event: 'extension_updated' }],
      breakdown: 'version',
      interval: 'day',
      from: '-60d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'How far updates jump',
      description: 'The first part of the version that changed: build, patch, minor, major, or downgrade (a nightly roll back).',
      series: [{ event: 'extension_updated' }],
      breakdown: 'version_jump',
      interval: 'week',
      from: '-180d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Builds between versions per update (average)',
      description: 'CI run numbers between the version before and after. Run numbers also count runs that released nothing, so this is an upper bound on releases skipped.',
      series: [{ event: 'extension_updated', math: { kind: 'avg', property: 'build_delta' } }],
      breakdown: 'channel',
      interval: 'week',
      from: '-180d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Upgrade paths (last 30 days)',
      description: 'Every from → to pair seen, most common first. Skipped versions show as paths that jump past them.',
      series: [{ event: 'extension_updated' }],
      breakdown: 'upgrade_path',
      interval: 'day',
      from: '-30d',
      display: 'ActionsTable',
    },
    {
      kind: 'trend',
      name: 'Nightly updates by trigger',
      description: 'automatic: the build installed it on its own. manual: the reader pressed Install or Roll back. by_hand: new files the build did not write (the installer, or an unzip).',
      series: [{ event: 'extension_updated' }],
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
      series: [{ event: 'extension_active' }],
      where: [NIGHTLY, WEEKLY],
      breakdown: 'nightly_mode',
      interval: 'week',
      from: '-180d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Daily active Automatic nightly installs, by what holds up their update',
      description:
        'none: nothing waiting, or the waiting build is installing. permission: a newer build is found but the browser has not let Geld write to its folder (the reader chose Allow this time, not Allow on every visit). folder: its folder is not connected or no longer reachable.',
      series: [{ event: 'extension_active' }],
      where: [NIGHTLY, { key: 'nightly_mode', value: 'automatic' }],
      breakdown: 'nightly_blocked',
      interval: 'day',
      from: '-60d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Weekly active installs, by browser',
      description: 'Chrome, Edge and Safari. Firefox builds send nothing.',
      series: [{ event: 'extension_active' }],
      where: [WEEKLY],
      breakdown: 'browser',
      interval: 'week',
      from: '-180d',
      display: 'ActionsBar',
    },
  ],
};

const ACTIVE = 'extension_active';

function used(counter: UsageCounter, label: string): Series {
  return { event: ACTIVE, label, math: { kind: 'sum', property: `used_${counter}` } };
}

export const FEATURES_DASHBOARD: DashboardSpec = {
  name: 'Geld · Settings & features',
  description:
    'What installs have turned on and what they use. Settings ride on each install’s first ping of the ISO week only, so weekly numbers are installs. Feature counts ride on every daily ping and cover the time since the install’s ping before, so they lag by about a day. Counts of what readers typed (custom categories, patterns, rules) stop at 10, and their contents are never sent. Set the project’s week to start on Monday so weeks line up with the pings.',
  tiles: [
    {
      kind: 'trend',
      name: 'Built-in categories turned on (last 7 days)',
      description: 'Installs with each built-in category on, from their weekly ping. Tests is on by default and the rest are opt-in.',
      series: CATEGORY_IDS.map((id) => ({ event: ACTIVE, label: id, where: [{ key: `category_${id}`, value: true }] })),
      where: [WEEKLY],
      interval: 'day',
      from: '-7d',
      display: 'ActionsBarValue',
    },
    {
      kind: 'trend',
      name: 'Installs by number of categories on',
      description: 'Built-in and custom categories on at once (10 means 10 or more).',
      series: [{ event: ACTIVE }],
      where: [WEEKLY],
      breakdown: 'categories_on',
      interval: 'week',
      from: '-84d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Installs with custom categories',
      description: 'Whether an install has defined any categories of its own.',
      series: [{ event: ACTIVE }],
      where: [WEEKLY],
      breakdown: 'has_custom_categories',
      interval: 'week',
      from: '-84d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Custom categories per install that has any (average)',
      description: 'Defined, and turned on. Each install’s count stops at 10.',
      series: [
        { event: ACTIVE, label: 'defined', math: { kind: 'avg', property: 'custom_categories' } },
        { event: ACTIVE, label: 'on', math: { kind: 'avg', property: 'custom_categories_on' } },
      ],
      where: [WEEKLY, { key: 'has_custom_categories', value: true }],
      interval: 'week',
      from: '-84d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Pattern tweaks per install (average)',
      description: 'Built-in pattern groups switched off, and extra pattern lines added to built-in categories (each stops at 10).',
      series: [
        { event: ACTIVE, label: 'groups off', math: { kind: 'avg', property: 'pattern_groups_off' } },
        { event: ACTIVE, label: 'extra patterns', math: { kind: 'avg', property: 'extra_patterns' } },
        { event: ACTIVE, label: 'repository rules', math: { kind: 'avg', property: 'repo_rules' } },
        { event: ACTIVE, label: 'hidden people', math: { kind: 'avg', property: 'hidden_authors' } },
      ],
      where: [WEEKLY],
      interval: 'week',
      from: '-84d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Switches turned on (last 7 days)',
      description: 'Installs with each setting on, from their weekly ping.',
      series: USAGE_TOGGLES.map((key) => ({ event: ACTIVE, label: key, where: [{ key: usageToggleProperty(key), value: true }] })),
      where: [WEEKLY],
      interval: 'day',
      from: '-7d',
      display: 'ActionsBarValue',
    },
    {
      kind: 'trend',
      name: 'Pull request view',
      description: 'digest, digest-timeline (both) or github (the digest off).',
      series: [{ event: ACTIVE }],
      where: [WEEKLY],
      breakdown: 'digest_view',
      interval: 'week',
      from: '-84d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Timeline folding',
      description: 'How far the digest folds the timeline: off, compact or minimal.',
      series: [{ event: ACTIVE }],
      where: [WEEKLY],
      breakdown: 'compact_timeline',
      interval: 'week',
      from: '-84d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Issue trackers configured',
      description: 'The tracker an install links ticket keys to, or none.',
      series: [{ event: ACTIVE }],
      where: [WEEKLY],
      breakdown: 'issue_tracker',
      interval: 'week',
      from: '-84d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Digest use per day',
      description: 'Pull request conversations the digest was shown on, and what readers did there.',
      series: [
        used('digest_shown', 'digest shown'),
        used('digest_copied', 'digest copied'),
        used('digest_view_changed', 'view changed'),
        used('flow_opened', 'Flow opened'),
        used('bot_review_requested', 'bot reviews requested'),
        used('ai_triage_run', 'AI triage runs'),
        used('ai_triage_failed', 'AI triage runs that failed'),
        used('ai_fix_applied', 'AI fixes applied'),
        used('ai_comment_fix', 'AI fixes asked from a comment'),
        used('ai_fix_discarded', 'AI fixes discarded'),
        used('agent_handoff', 'handed to a coding agent'),
      ],
      interval: 'day',
      from: '-60d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Hidden files per day',
      description: 'Diff pages read, those where Geld hid at least one file, and how often readers showed hidden files again.',
      series: [
        used('diff_pages', 'diff pages'),
        used('diff_pages_hiding', 'pages hiding files'),
        used('hidden_files_shown', 'hidden files shown'),
        used('hidden_file_revealed', 'one hidden file opened'),
      ],
      interval: 'day',
      from: '-60d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Diff pages where Geld hid something (%)',
      description: 'Of the diff pages read, the share where at least one file was hidden.',
      series: [used('diff_pages_hiding', 'hiding'), used('diff_pages', 'pages')],
      formula: 'A / B * 100',
      interval: 'week',
      from: '-84d',
      display: 'ActionsLineGraph',
    },
    {
      kind: 'trend',
      name: 'Categories that hid files (last 30 days)',
      description: 'Diff pages where each category hid at least one file. custom is any of the readers’ own categories.',
      series: [...CATEGORY_IDS, 'custom'].map((id) => ({ event: ACTIVE, label: id, math: { kind: 'sum' as const, property: `used_hid_${id}` } })),
      interval: 'day',
      from: '-30d',
      display: 'ActionsBarValue',
    },
    {
      kind: 'trend',
      name: 'Reviews and comments from the review group',
      description: 'Sent with Geld’s ✓ ✗ 💬 group, on any tab.',
      series: [used('review_approve', 'approve'), used('review_request_changes', 'request changes'), used('review_comment', 'comment review'), used('comment_posted', 'plain comment')],
      interval: 'week',
      from: '-84d',
      display: 'ActionsBar',
    },
    {
      kind: 'trend',
      name: 'Status changes from the pill',
      description: 'Merges, queueing, auto-merge, drafts, ready, close and reopen sent from Geld’s status menu or the Overview’s merge button.',
      series: [
        used('status_merge', 'merge'),
        used('status_queue', 'merge queue'),
        used('status_auto', 'auto-merge'),
        used('status_ready', 'ready'),
        used('status_draft', 'draft'),
        used('status_close', 'close'),
        used('status_reopen', 'reopen'),
      ],
      interval: 'week',
      from: '-84d',
      display: 'ActionsBar',
    },
  ],
};

export const DASHBOARDS: readonly DashboardSpec[] = [USAGE_DASHBOARD, FEATURES_DASHBOARD];
