import type { ProviderDeployment } from '../providers/review-panel';
import type { ProviderReviewPage } from '../providers/types';

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// GitLab's deployment statuses, read from its merge request widget's own endpoint (Nov 2026).
const STATES: ReadonlyMap<string, ProviderDeployment['state']> = new Map([
  ['success', 'active'],
  ['running', 'deploying'], ['created', 'deploying'], ['pending', 'deploying'],
  ['failed', 'failed'], ['canceled', 'failed'],
  ['blocked', 'waiting'], ['manual', 'waiting'],
]);

function link(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value, origin);
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null;
  } catch {
    return null;
  }
}

/** Reads `…/merge_requests/N/ci_environments_status`: one entry per environment this merge request deployed to. */
export function parseGitLabEnvironments(value: unknown, origin: string): readonly ProviderDeployment[] | null {
  if (!Array.isArray(value)) return null;
  const deployments: ProviderDeployment[] = [];
  for (const entry of value) {
    if (!record(entry) || typeof entry.name !== 'string' || entry.name === '' || (typeof entry.id !== 'number' && typeof entry.id !== 'string')) continue;
    const environmentUrl = link(entry.url, origin);
    if (environmentUrl === null || new URL(environmentUrl).origin !== origin) continue;
    const siteUrl = link(entry.external_url, origin);
    const deployedAt = typeof entry.deployed_at === 'string' && !Number.isNaN(Date.parse(entry.deployed_at)) ? entry.deployed_at : null;
    deployments.push({
      id: String(entry.id),
      name: entry.name,
      state: typeof entry.status === 'string' ? STATES.get(entry.status) ?? 'unknown' : 'unknown',
      environmentUrl,
      ...(siteUrl === null ? {} : { siteUrl }),
      ...(deployedAt === null ? {} : { deployedAt }),
    });
  }
  return deployments;
}

/** Read beside the review, never as part of it: a failed read leaves the row out and the review whole. */
export async function fetchGitLabDeployments(page: ProviderReviewPage, signal: AbortSignal): Promise<readonly ProviderDeployment[] | undefined> {
  const origin = page.repository.origin;
  const url = `${origin}/${page.repository.path}/-/merge_requests/${page.number}/ci_environments_status`;
  try {
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' }, signal });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return undefined;
    return parseGitLabEnvironments(await response.json(), origin) ?? undefined;
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}
