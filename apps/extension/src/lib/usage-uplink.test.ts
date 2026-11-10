import type { UsagePayload } from '@geld/core';
import { parseUsagePayload } from '@geld/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
const settings = { usageStats: true };
let version = '0.9.3.412';
let onInstalled: ((details: { reason: string; previousVersion?: string }) => void) | null = null;
let onAlarm: ((alarm: { name: string }) => void) | null = null;

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: <T>(key: string, options: { fallback: T }) => ({
      getValue: async (): Promise<unknown> => (stored.has(key) ? stored.get(key) : options.fallback),
      setValue: async (value: T): Promise<void> => {
        stored.set(key, value);
      },
    }),
  },
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      getManifest: () => ({ version }),
      onInstalled: { addListener: (listener: typeof onInstalled) => (onInstalled = listener) },
    },
    alarms: {
      get: async () => undefined,
      create: async () => undefined,
      onAlarm: { addListener: (listener: typeof onAlarm) => (onAlarm = listener) },
    },
  },
}));
vi.mock('./storage', () => ({ settingsItem: { getValue: async () => settings, watch: () => () => undefined } }));
vi.mock('./diagnostics', () => ({ recordDiagnostic: () => undefined }));

const sent: UsagePayload[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 10, 12) });
  vi.stubEnv('DEV', false);
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body: unknown = JSON.parse(init.body);
    const payload = parseUsagePayload(body);
    if (payload === null) throw new Error('geld.sh would refuse this payload.');
    sent.push(payload);
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  stored.clear();
  sent.length = 0;
  settings.usageStats = true;
  version = '0.9.3.412';
  onInstalled = null;
  onAlarm = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function start(nightly: Parameters<typeof import('./usage-uplink').startUsageReports>[0] = null): Promise<void> {
  const { startUsageReports } = await import('./usage-uplink');
  startUsageReports(nightly);
}

function names(): string[] {
  return sent.flatMap((payload) => payload.events.map((event) => event.name));
}

describe('usage statistics', () => {
  it('sends an install and the day’s ping, then nothing more that day', async () => {
    await start();
    onInstalled?.({ reason: 'install' });
    await vi.advanceTimersByTimeAsync(6_000);
    onAlarm?.({ name: 'geld:usage' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(names().sort()).toEqual(['extension_active', 'extension_installed']);
    expect(sent[0]).toMatchObject({ v: 1, version: '0.9.3.412', channel: 'stable' });
    const active = sent.flatMap((payload) => payload.events).find((event) => event.name === 'extension_active');
    expect(active).toMatchObject({ firstOfWeek: true, firstOfMonth: true });
  });

  it('reports an update the browser announces with the version before it, once', async () => {
    await start();
    onInstalled?.({ reason: 'update', previousVersion: '0.9.2.400' });
    await vi.advanceTimersByTimeAsync(6_000);
    const updates = sent.flatMap((payload) => payload.events).filter((event) => event.name === 'extension_updated');
    expect(updates).toEqual([{ name: 'extension_updated', at: Date.UTC(2026, 10, 10, 12), from: '0.9.2.400' }]);
  });

  it('notices a version change from the one it recorded, with a nightly build’s own account of it', async () => {
    stored.set('local:usageState', { version: '0.9.3.410', day: '2026-11-10', week: '2026-W46', month: '2026-11', queue: [] });
    await start(async () => ({ mode: 'manual', install: { method: 'folder', trigger: 'manual' } }));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.selfUpdate).toEqual({ mode: 'manual' });
    expect(sent[0]?.events).toEqual([{ name: 'extension_updated', at: expect.any(Number), from: '0.9.3.410', trigger: 'manual', method: 'folder' }]);
  });

  it('counts a new week and month only on their first ping', async () => {
    stored.set('local:usageState', { version, day: '2026-11-09', week: '2026-W46', month: '2026-11', queue: [] });
    await start();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent[0]?.events).toEqual([{ name: 'extension_active', at: expect.any(Number), firstOfWeek: false, firstOfMonth: false }]);
  });

  it('sends nothing while off, and drops what it noted', async () => {
    settings.usageStats = false;
    await start();
    onInstalled?.({ reason: 'install' });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent).toEqual([]);
    expect(stored.get('local:usageState')).toMatchObject({ queue: [] });
  });

  it('keeps the queue when the send fails, for the next ping', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await start();
    onInstalled?.({ reason: 'install' });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(stored.get('local:usageState')).toMatchObject({ queue: [{ name: 'extension_installed' }, { name: 'extension_active' }] });
  });
});
