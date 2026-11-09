// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { renderProviderReviewPanel } from './review-panel';

beforeEach(() => {
  document.body.replaceChildren();
  const style = document.createElement('style');
  style.dataset.testColors = '';
  style.textContent = `:root { --geld-provider-text: rgb(20, 30, 40); --geld-provider-danger: rgb(180, 20, 30); --geld-provider-success: rgb(20, 120, 30); }
    ${readFileSync('src/providers/style.css', 'utf8')}`;
  document.head.append(style);
});
afterEach(() => document.head.querySelector('[data-test-colors]')?.remove());

for (const provider of ['gitlab', 'bitbucket'] as const) for (const allowFailure of [undefined, true, false]) {
  it(`${provider} colors a failed check status without treating allowFailure=${allowFailure} as a merge requirement`, () => {
    const host = document.createElement('div');document.body.append(host);
    const sha = 'a'.repeat(40);
    const failed = { name: 'Build', sha, status: 'completed', conclusion: 'failure', nativeStatus: provider === 'gitlab' ? 'failed' : 'FAILED', ...(allowFailure === undefined ? {} : { allowFailure }) } as const;
    const panel = renderProviderReviewPanel(host, {
      subject: { provider, origin: `https://${provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org'}`, repository: 'team/project', id: '1', headSha: sha },
      threads: [], checks: [failed, { ...failed, name: 'Older build', sha: 'b'.repeat(40) }],
    });
    const rows = panel.element.querySelectorAll<HTMLElement>('.geld-provider-review__check');
    const current = rows[0], previous = rows[1];
    if (current === undefined || previous === undefined) throw new Error('Missing check rows');
    const status = current.querySelector('.geld-provider-review__check-part');
    if (status === null) throw new Error('Missing check status');
    expect(current.dataset.state).toBe('failed');
    expect(getComputedStyle(current).color).toBe('rgb(20, 30, 40)');
    expect(getComputedStyle(status).color).toBe('rgb(180, 20, 30)');
    expect(getComputedStyle(previous).color).toBe('rgb(20, 30, 40)');
    expect(previous.querySelector('.geld-provider-review__check-part')?.getAttribute('data-geld-check-state')).toBe('previous');
    panel.destroy();
  });
}
