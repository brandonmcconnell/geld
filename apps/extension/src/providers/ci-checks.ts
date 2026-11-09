import type { ProviderReviewCheck, ProviderReviewInput } from '@geld/review';

export type ProviderCheckState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled' | 'neutral' | 'manual' | 'scheduled' | 'unknown';
export interface ProviderCheckPresentation { readonly state: ProviderCheckState; readonly label: string }

const GITLAB_STATES: Readonly<Record<string, ProviderCheckPresentation>> = {
  created: { state: 'pending', label: 'Created' },
  waiting_for_resource: { state: 'pending', label: 'Waiting for resource' },
  preparing: { state: 'pending', label: 'Preparing' },
  pending: { state: 'pending', label: 'Pending' },
  running: { state: 'running', label: 'Running' },
  scheduled: { state: 'scheduled', label: 'Scheduled' },
  manual: { state: 'manual', label: 'Manual' },
  success: { state: 'passed', label: 'Passed' },
  failed: { state: 'failed', label: 'Failed' },
  canceled: { state: 'cancelled', label: 'Cancelled' },
  skipped: { state: 'skipped', label: 'Skipped' },
};
const BITBUCKET_STATES: Readonly<Record<string, ProviderCheckPresentation>> = {
  INPROGRESS: { state: 'running', label: 'In progress' },
  SUCCESSFUL: { state: 'passed', label: 'Passed' },
  FAILED: { state: 'failed', label: 'Failed' },
  STOPPED: { state: 'cancelled', label: 'Stopped' },
};
const UNKNOWN: ProviderCheckPresentation = { state: 'unknown', label: 'Unknown' };

export function providerCheckPresentation(check: ProviderReviewCheck, provider: ProviderReviewInput['subject']['provider']): ProviderCheckPresentation {
  if (check.nativeStatus !== undefined) {
    if (provider !== 'gitlab' && provider !== 'bitbucket') return UNKNOWN;
    const states = provider === 'gitlab' ? GITLAB_STATES : BITBUCKET_STATES;
    return Object.hasOwn(states, check.nativeStatus) ? states[check.nativeStatus] ?? UNKNOWN : UNKNOWN;
  }
  if (['queued', 'pending', 'waiting', 'requested'].includes(check.status)) return { state: 'pending', label: 'Pending' };
  if (['in_progress', 'running'].includes(check.status)) return { state: 'running', label: 'Running' };
  if (check.status !== 'completed') return UNKNOWN;
  if (check.conclusion === 'success') return { state: 'passed', label: 'Passed' };
  if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(check.conclusion ?? '')) return { state: 'failed', label: 'Failed' };
  if (check.conclusion === 'skipped') return { state: 'skipped', label: 'Skipped' };
  if (check.conclusion === 'cancelled' || check.conclusion === 'canceled') return { state: 'cancelled', label: 'Cancelled' };
  if (check.conclusion === 'neutral') return { state: 'neutral', label: 'Neutral' };
  return UNKNOWN;
}

export function providerChecksCoverage(input: ProviderReviewInput): 'complete' | 'partial' | 'unavailable' {
  return input.checks === undefined ? 'unavailable' : input.checksCoverage ?? 'complete';
}

export function providerCheckKey(check: ProviderReviewCheck): string | null {
  return check.key === undefined || check.key === '' ? null : JSON.stringify([check.sha, check.key]);
}
