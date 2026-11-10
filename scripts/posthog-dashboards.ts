/**
 * Create the usage dashboards (`scripts/posthog/dashboards.ts`) in a PostHog
 * project, or bring existing ones in line: a dashboard and its insights are
 * found by name (insights also by the `geld-usage` tag), so running it again
 * updates them in place rather than adding copies.
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_… POSTHOG_PROJECT_ID=12345 pnpm posthog:dashboards
 *
 * The key is a personal API key with insight and dashboard write access to the
 * project geld.sh forwards to (`POSTHOG_USAGE_KEY` on the geld-site Vercel
 * project). `POSTHOG_APP_HOST` defaults to https://us.posthog.com; use
 * https://eu.posthog.com for an EU project. `--dry-run` prints the queries.
 */
import { DASHBOARDS } from './posthog/dashboards';
import type { DashboardSpec, Tile } from './posthog/dashboards';

const TAG = 'geld-usage';

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

function queryFor(tile: Tile): Json {
  if (tile.kind === 'sql') return { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query: tile.query } };
  const series: Json = [
    {
      kind: 'EventsNode',
      event: tile.event,
      name: tile.event,
      ...(tile.math === undefined ? { math: 'total' } : { math: tile.math.kind, math_property: tile.math.property }),
    },
  ];
  const properties: Json = (tile.where ?? []).map((filter) => ({
    type: 'event',
    key: filter.key,
    operator: 'exact',
    value: typeof filter.value === 'boolean' ? [String(filter.value)] : typeof filter.value === 'string' ? [filter.value] : [...filter.value],
  }));
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      series,
      interval: tile.interval,
      dateRange: { date_from: tile.from },
      properties,
      filterTestAccounts: false,
      ...(tile.breakdown === undefined ? {} : { breakdownFilter: { breakdown: tile.breakdown, breakdown_type: 'event', breakdown_limit: 25 } }),
      trendsFilter: { display: tile.display },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Named {
  readonly id: number;
  readonly name: string;
  readonly tags: readonly string[];
  readonly dashboards: readonly number[];
}

function namedList(value: unknown): Named[] {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  return value.results.flatMap((entry: unknown): Named[] => {
    if (!isRecord(entry) || typeof entry.id !== 'number' || typeof entry.name !== 'string' || entry.deleted === true) return [];
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    const dashboards = Array.isArray(entry.dashboards) ? entry.dashboards.filter((id): id is number => typeof id === 'number') : [];
    return [{ id: entry.id, name: entry.name, tags, dashboards }];
  });
}

function idOf(value: unknown): number {
  if (!isRecord(value) || typeof value.id !== 'number') throw new Error(`PostHog answered without an id: ${JSON.stringify(value)}`);
  return value.id;
}

function client(host: string, project: string, key: string) {
  return async (method: 'GET' | 'POST' | 'PATCH', path: string, body?: Json): Promise<unknown> => {
    const response = await fetch(`${host}/api/projects/${project}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 500)}`);
    return text === '' ? null : JSON.parse(text);
  };
}

async function apply(spec: DashboardSpec, request: ReturnType<typeof client>, host: string, project: string): Promise<void> {
  const dashboards = namedList(await request('GET', `/dashboards/?limit=500&search=${encodeURIComponent(spec.name)}`));
  const existing = dashboards.find((dashboard) => dashboard.name === spec.name);
  const dashboard = existing?.id ?? idOf(await request('POST', '/dashboards/', { name: spec.name, description: spec.description, tags: [TAG] }));
  if (existing !== undefined) await request('PATCH', `/dashboards/${dashboard}/`, { description: spec.description });
  for (const tile of spec.tiles) {
    const found = namedList(await request('GET', `/insights/?limit=100&saved=true&search=${encodeURIComponent(tile.name)}`)).find((insight) => insight.name === tile.name && insight.tags.includes(TAG));
    const fields = { name: tile.name, description: tile.description, query: queryFor(tile), tags: [TAG] };
    if (found === undefined) {
      await request('POST', '/insights/', { ...fields, saved: true, dashboards: [dashboard] });
      console.log(`  + ${tile.name}`);
    } else {
      await request('PATCH', `/insights/${found.id}/`, { ...fields, dashboards: [...new Set([...found.dashboards, dashboard])] });
      console.log(`  ~ ${tile.name}`);
    }
  }
  console.log(`${existing === undefined ? 'Created' : 'Updated'} ${spec.name}: ${host}/project/${project}/dashboard/${dashboard}`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--dry-run')) {
    for (const spec of DASHBOARDS) console.log(JSON.stringify({ dashboard: spec.name, tiles: spec.tiles.map((tile) => ({ name: tile.name, query: queryFor(tile) })) }, null, 2));
    return;
  }
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim() ?? '';
  const project = process.env.POSTHOG_PROJECT_ID?.trim() ?? '';
  const host = (process.env.POSTHOG_APP_HOST?.trim() || 'https://us.posthog.com').replace(/\/+$/, '');
  if (key === '' || !/^\d+$/.test(project)) {
    console.error('Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID (the numeric id in the project’s URL).');
    process.exitCode = 1;
    return;
  }
  const request = client(host, project, key);
  for (const spec of DASHBOARDS) await apply(spec, request, host, project);
}

await main();
