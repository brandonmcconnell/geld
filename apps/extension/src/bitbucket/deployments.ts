import type { ProviderDeployment } from '../providers/review-panel';
import type { ProviderReviewPage } from '../providers/types';
import { BitbucketClient } from './api';

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function time(value: unknown): string | null {
  const at = text(value);
  return at !== null && !Number.isNaN(Date.parse(at)) ? at : null;
}

/** Bitbucket's own pages only: a deployment's result link leads to its pipeline step there. */
function bitbucketLink(value: unknown): string | null {
  const href = text(value);
  if (href === null) return null;
  try {
    const url = new URL(href);
    return url.origin === 'https://bitbucket.org' && url.username === '' && url.password === '' ? url.href : null;
  } catch {
    return null;
  }
}

/** A deployment's state, from Bitbucket's `deployment_state` (its OpenAPI schema, Nov 2026). */
function stateOf(state: Readonly<Record<string, unknown>>): ProviderDeployment['state'] {
  if (state.name === 'IN_PROGRESS') return 'deploying';
  if (state.name === 'UNDEPLOYED') return 'waiting';
  if (state.name !== 'COMPLETED') return 'unknown';
  const status = record(state.status) ? state.status.name : undefined;
  return status === 'SUCCESSFUL' ? 'active' : status === 'FAILED' || status === 'STOPPED' ? 'failed' : 'unknown';
}

/**
 * One line per environment the pull request's head commit was deployed to, its latest deployment there:
 * Bitbucket keeps deployments per repository, so a deployment is this pull request's only by its release's commit.
 */
export function parseBitbucketDeployments(deployments: unknown, environments: unknown, headSha: string, repositoryPath: string): readonly ProviderDeployment[] | null {
  if (!record(deployments) || !Array.isArray(deployments.values) || !record(environments) || !Array.isArray(environments.values)) return null;
  const names = new Map<string, string>();
  for (const environment of environments.values) {
    if (!record(environment)) continue;
    const uuid = text(environment.uuid), name = text(environment.name);
    if (uuid !== null && name !== null) names.set(uuid, name);
  }
  const page = `https://bitbucket.org/${repositoryPath}/deployments`;
  const latest = new Map<string, { readonly at: number; readonly deployment: ProviderDeployment }>();
  for (const entry of deployments.values) {
    if (!record(entry) || !record(entry.state) || !record(entry.environment) || !record(entry.release) || !record(entry.release.commit)) continue;
    const commit = text(entry.release.commit.hash)?.toLowerCase() ?? null;
    if (commit === null || commit !== headSha.toLowerCase()) continue;
    const environment = text(entry.environment.uuid);
    const name = environment === null ? (text(entry.environment.name) ?? null) : (names.get(environment) ?? text(entry.environment.name));
    const id = text(entry.uuid);
    if (environment === null || name === null || id === null) continue;
    const deployedAt = time(entry.state.completion_date) ?? time(entry.state.start_date) ?? time(entry.release.created_on);
    const at = deployedAt === null ? 0 : Date.parse(deployedAt);
    const known = latest.get(environment);
    if (known !== undefined && known.at >= at) continue;
    latest.set(environment, {
      at,
      deployment: {
        id,
        name,
        state: stateOf(entry.state),
        environmentUrl: bitbucketLink(entry.state.url) ?? page,
        ...(deployedAt === null ? {} : { deployedAt }),
      },
    });
  }
  return [...latest.values()].map((entry) => entry.deployment);
}

/**
 * Read beside the review, never as part of it, and only for a reader signed in: two requests a visit would spend
 * a signed-out reader's 60 an hour on a row most repositories never fill. A failed read leaves the row out.
 */
export async function fetchBitbucketDeployments(page: ProviderReviewPage, headSha: string, signal: AbortSignal, signedIn: boolean): Promise<readonly ProviderDeployment[] | undefined> {
  if (!signedIn) return undefined;
  try {
    const { deployments, environments } = await new BitbucketClient(page).deploymentSources(signal);
    return parseBitbucketDeployments(deployments, environments, headSha, page.repository.path) ?? undefined;
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}
