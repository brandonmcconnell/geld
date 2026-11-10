// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerDigestViewChoice } from './digest-view';

afterEach(() => document.body.replaceChildren());

describe('provider conversation view choice', () => {
  it.each(['gitlab', 'bitbucket'] as const)('names the %s views and uses shared setting values', async (provider) => {
    const choose = vi.fn(async () => undefined);
    const control = providerDigestViewChoice(provider, { prOverview: false, compactTimeline: 'compact' }, choose);
    document.body.append(control);
    const native = control.querySelector<HTMLButtonElement>('[data-geld-digest-view="github"]');
    expect(native?.getAttribute('aria-label')).toBe(provider === 'gitlab' ? 'GitLab' : 'Bitbucket');
    expect(native?.getAttribute('aria-pressed')).toBe('true');
    control.querySelector<HTMLButtonElement>('[data-geld-digest-view="digest-timeline"]')?.click();
    await vi.waitFor(() => expect(choose).toHaveBeenCalledWith('digest-timeline'));
    expect(control.textContent).not.toContain('GitHub');
    expect(control.querySelectorAll('svg')).toHaveLength(4);
    const combined = control.querySelector('[data-geld-digest-view="digest-timeline"]');
    expect(combined?.textContent?.trim()).toBe('+');
    expect(combined?.getAttribute('aria-label')).toBe(`Geld + ${provider === 'gitlab' ? 'GitLab' : 'Bitbucket'}`);
  });

  it('prevents duplicate writes and keeps a failed choice recoverable', async () => {
    let reject: ((error: Error) => void) | undefined;
    const choose = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const control = providerDigestViewChoice('gitlab', { prOverview: true, compactTimeline: 'compact' }, choose);
    document.body.append(control);
    const button = control.querySelector<HTMLButtonElement>('button');
    button?.click();button?.click();
    expect(choose).toHaveBeenCalledOnce();
    expect(control.getAttribute('aria-busy')).toBe('true');
    reject?.(new Error('Storage unavailable'));
    await vi.waitFor(() => expect(button?.disabled).toBe(false));
    expect(control.querySelector('[role="status"]')?.textContent).toContain('could not be saved');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });
});
