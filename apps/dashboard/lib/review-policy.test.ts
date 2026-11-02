import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./env', () => ({ demoEnabled: () => false }));
vi.mock('./session', () => ({ currentActor: async () => null, providerTokenSource: async () => ({}) }));
vi.mock('./db', () => ({ database: () => null }));
vi.mock('@geld/github', () => ({
  createApiTransport: () => ({
    request: async (path: string) => path.endsWith('/.github/geld.yml')
      ? { ok: true, value: 'review:\n  ai: false\n#' + 'x'.repeat(100000) }
      : { ok: false, reason: 'not_found' },
  }),
}));
import { reviewSettings } from './review-settings';

it('pauses AI when an oversized repository policy cannot be evaluated', async () => {
  const result = await reviewSettings({ provider: 'github', host: 'github.com', owner: 'org', repo: 'repo' });
  expect(result.aiAllowed).toBe(false);
  expect(result.warning).toContain('paused');
});
