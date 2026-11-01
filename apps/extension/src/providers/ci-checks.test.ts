import type { ProviderReviewCheck } from '@geld/review';
import { providerCheckKey, providerCheckPresentation, providerChecksCoverage } from './ci-checks';

const check: ProviderReviewCheck = { name: 'Passed tests', sha: 'a'.repeat(40), status: 'queued', conclusion: null };

it.each(['queued', 'pending', 'waiting', 'requested'])('does not call %s a running job', (status) => {
  expect(providerCheckPresentation({ ...check, status }, 'gitlab')).toEqual({ state: 'pending', label: 'Pending' });
});

it.each(['in_progress', 'running'])('keeps %s separate from checks that have not started', (status) => {
  expect(providerCheckPresentation({ ...check, status }, 'gitlab')).toEqual({ state: 'running', label: 'Running' });
});

it('preserves native manual and stopped states without changing the underlying check verdict', () => {
  const manual = { ...check, status: 'completed', conclusion: 'neutral', nativeStatus: 'manual' };
  expect(providerCheckPresentation(manual, 'gitlab')).toEqual({ state: 'manual', label: 'Manual' });
  expect(manual.conclusion).toBe('neutral');
  expect(providerCheckPresentation({ ...check, status: 'completed', conclusion: 'cancelled', nativeStatus: 'STOPPED' }, 'bitbucket')).toEqual({ state: 'cancelled', label: 'Stopped' });
  expect(providerCheckPresentation({ ...check, status: 'in_progress', nativeStatus: 'INPROGRESS' }, 'bitbucket')).toEqual({ state: 'running', label: 'In progress' });
  expect(providerCheckPresentation({ ...check, status: 'completed', conclusion: 'success', nativeStatus: 'new_status' }, 'gitlab')).toEqual({ state: 'unknown', label: 'Unknown' });
  expect(providerCheckPresentation({ ...check, nativeStatus: 'SUCCESSFUL' }, 'github')).toEqual({ state: 'unknown', label: 'Unknown' });
});

it('keeps absent and partial CI separate from a complete empty legacy source', () => {
  const input = { subject: { provider: 'gitlab' as const, origin: 'https://gitlab.com', repository: 'a/b', id: '1', headSha: check.sha }, threads: [] };
  expect(providerChecksCoverage(input)).toBe('unavailable');
  expect(providerChecksCoverage({ ...input, checks: [] })).toBe('complete');
  expect(providerChecksCoverage({ ...input, checks: [], checksCoverage: 'unavailable' })).toBe('unavailable');
  expect(providerChecksCoverage({ ...input, checks: [check], checksCoverage: 'partial' })).toBe('partial');
});

it('uses native keys and commit identity, never equal check names, for focus matching', () => {
  expect(providerCheckKey(check)).toBeNull();
  expect(providerCheckKey({ ...check, key: 'job:1' })).not.toBe(providerCheckKey({ ...check, key: 'job:2' }));
  expect(providerCheckKey({ ...check, key: 'job:1' })).not.toBe(providerCheckKey({ ...check, key: 'job:1', sha: 'b'.repeat(40) }));
});

it.each(['constructor', '__proto__', 'toString'])('treats the unknown native status %s as unknown', (nativeStatus) => {
  expect(providerCheckPresentation({ ...check, nativeStatus }, 'gitlab')).toEqual({ state: 'unknown', label: 'Unknown' });
});
