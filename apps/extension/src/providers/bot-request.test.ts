// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderBotRequest } from './bot-request';
import { renderProviderBotRequest } from './bot-request';

const commands = [{ id: 'incremental', label: 'Incremental review', text: '@coderabbitai review' }, { id: 'full', label: 'Full review', text: '@coderabbitai full review' }];
function request(overrides: Partial<ProviderBotRequest> = {}): ProviderBotRequest {
  return { key: 'native-source-and-head', botId: 'coderabbit', label: 'CodeRabbit', sourceUrl: 'https://gitlab.com/g/r/-/merge_requests/1#note_2', commands, current: () => true,
    comment: { available: false, reason: 'Sign in to GitLab to open the native comment writer.', activate: async () => false }, ...overrides };
}
function mount(value = request(), copy = vi.fn(async (): Promise<void> => undefined)) {
  const host = document.createElement('div');document.body.append(host);
  const control = renderProviderBotRequest(host, value, copy);
  const button = (name: string) => [...host.querySelectorAll('button')].find((button) => button.textContent === name)!;
  return { control, host, copy, button, notice: () => host.querySelector('[role="status"]')?.textContent };
}
async function settle(): Promise<void> { await vi.waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull()); }
beforeEach(() => document.body.replaceChildren());

describe('native bot command preview', () => {
  it('copies the selected literal command while signed out, without enabling the composer or changing state', async () => {
    const draft = document.createElement('textarea');draft.value = 'Existing native draft';document.body.append(draft);draft.setSelectionRange(2, 7, 'backward');
    const f = mount();
    expect(f.button('Open native comment').disabled).toBe(true);
    expect(f.button('Open native comment').title).toContain('Sign in');
    f.button('Full review').click();
    expect(f.host.querySelector('code')?.textContent).toBe('@coderabbitai full review');
    expect(f.button('Full review').getAttribute('aria-pressed')).toBe('true');
    f.button('Copy command').click();await settle();
    expect(f.copy).toHaveBeenCalledExactlyOnceWith('@coderabbitai full review');
    expect(f.notice()).toBe('Command copied. Paste it into the native comment writer and post when ready.');
    expect(f.host.textContent).not.toMatch(/Review requested|Rerun started|Review running/);
    expect(draft.value).toBe('Existing native draft');expect([draft.selectionStart, draft.selectionEnd, draft.selectionDirection]).toEqual([2, 7, 'backward']);
  });

  it('keeps picks and disclosure across same-source updates, and reports a native writer failure distinctly', async () => {
    const f = mount();f.control.element.open = true;f.button('Full review').click();
    const activate = vi.fn(async () => false);
    f.control.update(request({ comment: { available: true, activate } }));
    expect(f.control.element.open).toBe(true);
    expect(f.host.querySelector('code')?.textContent).toBe('@coderabbitai full review');
    f.button('Open native comment').click();await settle();
    expect(activate).toHaveBeenCalledOnce();expect(f.copy).not.toHaveBeenCalled();
    expect(f.notice()).toContain('no longer available');
  });

  it('prevents duplicate copy and selection changes while the clipboard is pending', async () => {
    let finish!: () => void;
    const copy = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const f = mount(request(), copy);
    f.button('Copy command').click();f.button('Copy command').click();f.button('Full review').click();
    expect(copy).toHaveBeenCalledExactlyOnceWith('@coderabbitai review');
    expect(f.host.querySelector('code')?.textContent).toBe('@coderabbitai review');
    finish();await settle();expect(f.button('Copy command').disabled).toBe(false);
  });

  it.each(['stale', 'destroy', 'changed-source'])('never presents late clipboard success after %s', async (condition) => {
    let finish!: () => void;let live = true;
    const f = mount(request({ current: () => live }), vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    f.button('Copy command').click();
    if (condition === 'stale') live = false;
    if (condition === 'destroy') f.control.destroy();
    if (condition === 'changed-source') f.control.update(request({ key: 'new-native-head' }));
    finish();await Promise.resolve();await Promise.resolve();
    expect(f.notice() ?? '').not.toContain('Command copied');
  });

  it('retains a specific clipboard failure and allows retry', async () => {
    const f = mount(request(), vi.fn(async () => { throw new Error('Permission denied'); }));
    f.button('Copy command').click();await settle();
    expect(f.notice()).toBe('Could not copy the command. Try again.');expect(f.button('Copy command').disabled).toBe(false);
  });

  it('Cancel and Escape close without copying or opening, using the native summary focus', () => {
    const activate = vi.fn(async () => true);const f = mount(request({ comment: { available: true, activate } }));
    f.control.element.open = true;f.button('Cancel').click();expect(f.control.element.open).toBe(false);
    f.control.element.open = true;f.button('Full review').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.control.element.open).toBe(false);expect(document.activeElement).toBe(f.host.querySelector('summary'));
    expect(f.copy).not.toHaveBeenCalled();expect(activate).not.toHaveBeenCalled();
  });

  it('renders labels and commands as literal text and rejects executable source links', () => {
    const markup = '<img src=x onerror=attack()>';
    const f = mount(request({ label: markup, sourceUrl: 'javascript:attack()', commands: [{ id: 'literal', label: markup, text: markup }] }));
    expect(f.host.querySelector('img')).toBeNull();expect(f.host.querySelector('a')?.hasAttribute('href')).toBe(false);expect(f.host.querySelector('code')?.textContent).toBe(markup);
  });
});
