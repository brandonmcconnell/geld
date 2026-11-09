// @vitest-environment happy-dom
import type { ErrorReport } from '@geld/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://test${path}`, sendMessage: async () => undefined } } }));

/** The capture keeps module state (one install per context), so every test loads a fresh copy. */
async function fresh(): Promise<typeof import('./error-capture')> {
  vi.resetModules();
  return import('./error-capture');
}

describe('error capture hand-off', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hands an extension page’s errors over at once, a burst as one batch', async () => {
    const { installErrorCapture, reportError } = await fresh();
    const batches: (readonly ErrorReport[])[] = [];
    const stop = installErrorCapture('popup', (reports) => batches.push(reports));
    reportError('popup', new Error('first'));
    reportError('popup', new Error('second'));
    await Promise.resolve();
    expect(batches.map((batch) => batch.map((report) => report.message))).toEqual([['first', 'second']]);
    stop();
  });

  it('batches a content script’s errors, and hands them over when the page goes', async () => {
    const { installErrorCapture, reportError } = await fresh();
    const batches: (readonly ErrorReport[])[] = [];
    const stop = installErrorCapture('content', (reports) => batches.push(reports));
    reportError('content:pass', new Error('again'));
    reportError('content:pass', new Error('again'));
    await Promise.resolve();
    expect(batches).toEqual([]);
    window.dispatchEvent(new Event('pagehide'));
    expect(batches.map((batch) => batch.map((report) => [report.message, report.count]))).toEqual([[['again', 2]]]);
    reportError('content:pass', new Error('later'));
    vi.advanceTimersByTime(2_000);
    expect(batches).toHaveLength(2);
    stop();
  });
});
