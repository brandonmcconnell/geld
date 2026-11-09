import type { ErrorReport } from '@geld/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
/** Storage that answers a turn later, as `browser.storage` does, so interleaved read-modify-writes would show. */
const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: <T>(key: string, options: { fallback: T }) => ({
      getValue: async (): Promise<unknown> => {
        await later();
        return stored.has(key) ? stored.get(key) : options.fallback;
      },
      setValue: async (value: T): Promise<void> => {
        await later();
        stored.set(key, value);
      },
    }),
  },
}));
vi.mock('wxt/browser', () => ({ browser: { alarms: { get: async () => ({ name: 'geld:error-reports' }), create: async () => undefined } } }));
vi.mock('./storage', () => ({ settingsItem: { getValue: async () => ({ errorReports: true }), watch: () => () => undefined } }));
vi.mock('./diagnostics', () => ({ recordDiagnostic: () => undefined }));

function report(message: string): ErrorReport {
  return { where: 'content:pass', kind: 'error', message, stack: [], count: 1, firstAt: 1, lastAt: 1 };
}

afterEach(() => {
  stored.clear();
  vi.unstubAllEnvs();
});

describe('queueErrorReports', () => {
  it('keeps every tab’s reports when they arrive together', async () => {
    vi.stubEnv('DEV', false);
    const { queueErrorReports } = await import('./error-uplink');
    await Promise.all([queueErrorReports([report('from one tab')]), queueErrorReports([report('from another')]), queueErrorReports([report('and a third')])]);
    const queue = stored.get('local:errorQueue');
    expect(Array.isArray(queue) ? queue.map((entry: ErrorReport) => entry.message).sort() : queue).toEqual(['and a third', 'from another', 'from one tab']);
  });
});
