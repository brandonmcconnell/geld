// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './actions';

const clipboard = (writeText: () => Promise<void>): void => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
};

afterEach(() => vi.restoreAllMocks());

describe('copyText', () => {
  it('says the clipboard took the text', async () => {
    clipboard(() => Promise.resolve());
    expect(await copyText('task')).toBe(true);
  });

  it('falls back to the copy command and says whether that took it', async () => {
    clipboard(() => Promise.reject(new Error('not focused')));
    const command = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
    expect(await copyText('task')).toBe(true);
    expect(command).toHaveBeenCalledWith('copy');
    command.mockReturnValue(false);
    expect(await copyText('task')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('treats a copy command that throws as not copied', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => { throw new Error('unsupported'); } });
    expect(await copyText('task')).toBe(false);
  });
});
