// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlockChoices } from './block-dialog';
import { DEFAULT_BLOCK_CHOICES, openBlockDialog, openUnblockDialog } from './block-dialog';

function byLabel(dialog: HTMLElement, words: string): HTMLInputElement {
  const label = [...dialog.querySelectorAll('label')].find((node) => node.textContent?.includes(words));
  const input = label?.querySelector('input') ?? null;
  if (input === null) throw new Error(`no checkbox ${words}`);
  return input;
}

function button(dialog: HTMLElement, words: string): HTMLButtonElement {
  const found = [...dialog.querySelectorAll('button')].find((node) => node.textContent === words);
  if (found === undefined) throw new Error(`no button ${words}`);
  return found;
}

describe('openBlockDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('offers the personal block’s options and sends GitHub’s defaults when left alone', async () => {
    const onBlock = vi.fn(async (_choices: BlockChoices) => null);
    const dialog = openBlockDialog({ scope: 'personal', login: 'spammer', org: 'o', contentUrl: 'https://github.com/o/r/pull/7', onBlock, returnFocus: null });
    expect(dialog.querySelector('.Overlay-title')?.textContent).toBe('Block @spammer');
    expect(byLabel(dialog, 'Close all open issues').checked).toBe(false);
    expect(dialog.querySelector('textarea')?.getAttribute('maxlength')).toBe('250');
    button(dialog, 'Block user for you').click();
    await vi.waitFor(() => expect(onBlock).toHaveBeenCalledWith({ ...DEFAULT_BLOCK_CHOICES, notify: false }));
  });

  it('offers the organization’s options with notification on, and needs a reason to hide their comments', async () => {
    const onBlock = vi.fn(async (_choices: BlockChoices) => null);
    const dialog = openBlockDialog({ scope: 'org', login: 'spammer', org: 'acme', contentUrl: 'https://github.com/o/r/pull/7', onBlock, returnFocus: null });
    expect(dialog.querySelector('.Overlay-title')?.textContent).toBe('Block spammer from acme');
    const [duration, reason] = [...dialog.querySelectorAll('select')];
    expect(duration?.value).toBe('INDEFINITE');
    expect(byLabel(dialog, 'Send user a notification').checked).toBe(true);
    const submit = button(dialog, 'Block user for org');
    const hide = byLabel(dialog, "Hide this user's comments");
    hide.checked = true;
    hide.dispatchEvent(new Event('change'));
    expect(submit.disabled).toBe(true);
    expect(reason?.disabled).toBe(false);
    if (reason === undefined || duration === undefined) throw new Error('no selects');
    reason.value = 'SPAM';
    reason.dispatchEvent(new Event('change'));
    duration.value = 'THIRTY_DAYS';
    const note = dialog.querySelector('textarea');
    if (note !== null) note.value = 'repeat spam';
    expect(submit.disabled).toBe(false);
    submit.click();
    await vi.waitFor(() => expect(onBlock).toHaveBeenCalledWith({ duration: 'THIRTY_DAYS', note: 'repeat spam', closeContent: false, notify: true, hideReason: 'SPAM' }));
  });

  it('keeps the dialog open with GitHub’s refusal', async () => {
    const dialog = openBlockDialog({ scope: 'personal', login: 'spammer', org: 'o', contentUrl: '', onBlock: async () => 'GitHub did not block this user (422). Please try again.', returnFocus: null });
    button(dialog, 'Block user for you').click();
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('422'));
    expect(dialog.isConnected).toBe(true);
    expect(button(dialog, 'Block user for you').disabled).toBe(false);
  });
});

describe('openUnblockDialog', () => {
  it('asks in GitHub’s words and unblocks on confirm', async () => {
    const onUnblock = vi.fn(async () => null);
    const dialog = openUnblockDialog({ scope: 'org', login: 'spammer', org: 'acme', onUnblock, returnFocus: null });
    expect(dialog.textContent).toContain('Are you sure you want to unblock spammer from acme?');
    button(dialog, 'Unblock user for org').click();
    await vi.waitFor(() => expect(onUnblock).toHaveBeenCalled());
    document.body.innerHTML = '';
  });
});
