// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderReviewInput } from '@geld/review';
import type { ProviderBotRequest } from './bot-request';
import { renderProviderReviewPanel } from './review-panel';

const input: ProviderReviewInput = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'g/r', id: '42', headSha: 'a'.repeat(40) }, threads: [], checks: [], bots: [{ id: 'coderabbit', authorId: '38968537' }] };
const request = (live = true): ProviderBotRequest => ({ key: 'bound-source-and-full-head', botId: 'coderabbit', label: 'CodeRabbit', sourceUrl: 'https://gitlab.com/g/r/-/merge_requests/42#note_3436654383', commands: [{ id: 'incremental', label: 'Incremental review', text: '@coderabbitai review' }, { id: 'full', label: 'Full review', text: '@coderabbitai full review' }], current: () => live, comment: { available: false, reason: 'Sign in to GitLab.', activate: async () => false } });
beforeEach(() => { document.body.replaceChildren();window.location.href = 'https://gitlab.com/g/r/-/merge_requests/42'; });
function mount() { const host = document.createElement('div');document.body.append(host);return host; }

describe('bot command panel lifecycle', () => {
  it('retains command picks, disclosure and keyboard focus across harmless refreshes without changing bot state', async () => {
    const host = mount();const copy = vi.fn(async () => undefined);
    const panel = renderProviderReviewPanel(host, input, { botRequests: [request()], copyText: copy });
    const details = host.querySelector<HTMLDetailsElement>('[data-geld-bot-request]')!;details.open = true;
    const full = [...details.querySelectorAll('button')].find((button) => button.textContent === 'Full review')!;full.click();full.focus();
    panel.update(input, { botRequests: [request()], copyText: copy, version: 2 });
    expect(host.querySelector('[data-geld-bot-request]')).toBe(details);expect(details.open).toBe(true);expect(document.activeElement).toBe(full);
    expect(details.querySelector('code')?.textContent).toBe('@coderabbitai full review');
    details.querySelector<HTMLButtonElement>('[data-geld-bot-request-action="copy"]')!.click();
    await vi.waitFor(() => expect(details.querySelector('[role="status"]')?.textContent).toContain('Command copied'));
    expect(copy).toHaveBeenCalledExactlyOnceWith('@coderabbitai full review');
    expect(host.querySelector('[data-geld-review-bot]')?.getAttribute('data-state')).toBe('unknown');
    expect(input.checks).toEqual([]);expect(input.threads).toEqual([]);
  });

  it('rebinds a same-key remounted native source even when the rest of the panel signature is unchanged', async () => {
    let old = true;const host = mount();const copy = vi.fn(async () => undefined);
    const panel = renderProviderReviewPanel(host, input, { botRequests: [{ ...request(), current: () => old }], copyText: copy });
    old = false;
    panel.update(input, { botRequests: [request()], copyText: copy });
    host.querySelector<HTMLButtonElement>('[data-geld-bot-request-action="copy"]')!.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
  });

  it('removes stale controls when trust is withdrawn and blocks a retained button after destroy', () => {
    const host = mount();const copy = vi.fn(async () => undefined);
    const panel = renderProviderReviewPanel(host, input, { botRequests: [request()], copyText: copy });
    const button = host.querySelector<HTMLButtonElement>('[data-geld-bot-request-action="copy"]')!;
    panel.update({ ...input, bots: [] }, { botRequests: [], copyText: copy });
    expect(host.querySelector('[data-geld-bot-request]')).toBeNull();button.click();expect(copy).not.toHaveBeenCalled();
    panel.destroy();
  });
});
