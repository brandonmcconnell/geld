// @vitest-environment happy-dom
import { providerCheckIcon } from './ci-icons';

it('renders the source-native GitLab status glyph as passive vector geometry', () => {
  const icon = providerCheckIcon('gitlab', { name: 'Manual', sha: 'a'.repeat(40), status: 'completed', conclusion: 'neutral', nativeStatus: 'manual' }, document);
  expect(icon?.classList.contains('ci-status-icon-manual')).toBe(true);
  expect(icon?.querySelector('svg')?.dataset.geldNativeCheckIcon).toBe('status_manual_borderless');
  expect(icon?.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 22 22');
  expect(icon?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(icon?.querySelector('path')).not.toBeNull();
  expect(icon?.querySelector('a, use, script, foreignObject, [id], [style]')).toBeNull();
});

it('uses only the actually observed Bitbucket success glyph and retains text for unverified states', () => {
  const check = { name: 'Build', sha: 'a'.repeat(40), status: 'completed', conclusion: 'success', nativeStatus: 'SUCCESSFUL' };
  const icon = providerCheckIcon('bitbucket', check, document);
  expect(icon?.querySelector('svg')?.dataset.geldNativeCheckIcon).toBe('bitbucket-check-circle');
  expect(icon?.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16');
  expect(providerCheckIcon('bitbucket', { ...check, nativeStatus: 'INPROGRESS' }, document)).toBeNull();
  expect(providerCheckIcon('bitbucket', { ...check, nativeStatus: 'FAILED' }, document)).toBeNull();
  expect(providerCheckIcon('github', check, document)).toBeNull();
});

it.each(['created', 'preparing', 'pending', 'running', 'scheduled', 'canceled', 'manual'])('retains the native %s CSS rule instead of a canonical-state color alias', (nativeStatus) => {
  const icon = providerCheckIcon('gitlab', { name: 'Job', sha: 'a'.repeat(40), status: 'queued', conclusion: null, nativeStatus }, document);
  expect(icon?.matches(`.ci-status-icon-${nativeStatus}`)).toBe(true);
  expect(icon?.querySelector(`.ci-status-icon-${nativeStatus} svg`)).not.toBeNull();
  expect(icon?.querySelector('[style]')).toBeNull();
  expect(icon?.getAttribute('style')).toBeNull();
});

it('leaves unknown native and allowed-failure glyphs as text until their exact mapping is verified', () => {
  const check = { name: 'Job', sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure', nativeStatus: 'failed' };
  expect(providerCheckIcon('gitlab', { ...check, allowFailure: true }, document)).toBeNull();
  expect(providerCheckIcon('gitlab', { ...check, nativeStatus: 'constructor' }, document)).toBeNull();
  expect(providerCheckIcon('gitlab', { ...check, nativeStatus: 'waiting_for_resource' }, document)).toBeNull();
  expect(providerCheckIcon('gitlab', { name: 'Passed', sha: check.sha, status: 'completed', conclusion: 'success' }, document)).toBeNull();
});
