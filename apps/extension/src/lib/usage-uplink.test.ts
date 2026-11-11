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
vi.mock('./storage', async () => {
  const { DEFAULT_SETTINGS } = await import('@geld/core');
  return { settingsItem: { getValue: async () => ({ ...DEFAULT_SETTINGS, ...settings }), watch: () => () => undefined } };
});
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
    expect(active).toMatchObject({ firstOfWeek: true, firstOfMonth: true, settings: { toggles: { enabled: true }, categories: { tests: true } } });
  });

  it('reports an update the browser announces with the version before it, once', async () => {
    await start();
    onInstalled?.({ reason: 'update', previousVersion: '0.9.2.400' });
    await vi.advanceTimersByTimeAsync(6_000);
    const updates = sent.flatMap((payload) => payload.events).filter((event) => event.name === 'extension_updated');
    expect(updates).toEqual([{ name: 'extension_updated', at: Date.UTC(2026, 10, 10, 12), version: '0.9.3.412', from: '0.9.2.400' }]);
  });

  it('notices a version change from the one it recorded, with a nightly build’s own account of it', async () => {
    stored.set('local:usageState', { version: '0.9.3.410', day: '2026-11-10', week: '2026-W46', month: '2026-11', queue: [] });
    await start(async () => ({ mode: 'manual', install: { method: 'folder', trigger: 'manual' }, blocked: null }));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.selfUpdate).toEqual({ mode: 'manual' });
    expect(sent[0]?.events).toEqual([{ name: 'extension_updated', at: expect.any(Number), version: '0.9.3.412', from: '0.9.3.410', trigger: 'manual', method: 'folder' }]);
  });

  it('says what holds up a nightly build’s waiting update', async () => {
    stored.set('local:usageState', { version, day: '2026-11-09', week: '2026-W46', month: '2026-11', queue: [] });
    await start(async () => ({ mode: 'automatic', install: null, blocked: 'permission' }));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent[0]?.selfUpdate).toEqual({ mode: 'automatic' });
    expect(sent[0]?.events).toEqual([expect.objectContaining({ name: 'extension_active', blocked: 'permission' })]);
  });

  it('counts a new week and month only on their first ping', async () => {
    stored.set('local:usageState', { version, day: '2026-11-09', week: '2026-W46', month: '2026-11', queue: [] });
    await start();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent[0]?.events).toEqual([{ name: 'extension_active', at: expect.any(Number), version: '0.9.3.412', firstOfWeek: false, firstOfMonth: false }]);
  });

  it('hands the day’s feature counts to the next ping and starts again', async () => {
    stored.set('local:usageState', { version, day: '2026-11-09', week: '2026-W46', month: '2026-11', queue: [] });
    const { addUsageCount } = await import('./usage-uplink');
    await addUsageCount('flow_opened', 1);
    await addUsageCount('flow_opened', 2);
    await addUsageCount('digest_shown', 1);
    await start();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent[0]?.events).toEqual([{ name: 'extension_active', at: expect.any(Number), version: '0.9.3.412', firstOfWeek: false, firstOfMonth: false, counts: { flow_opened: 3, digest_shown: 1 } }]);
    expect(stored.get('local:usageState')).toMatchObject({ counts: {} });
  });

  it('keeps no counts while off', async () => {
    settings.usageStats = false;
    const { addUsageCount } = await import('./usage-uplink');
    await addUsageCount('flow_opened', 1);
    expect(stored.has('local:usageState')).toBe(false);
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

  it('keeps a batch geld.sh could not forward, and drops one it refused', async () => {
    let status = 503;
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    await start();
    onInstalled?.({ reason: 'install' });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(stored.get('local:usageState')).toMatchObject({ queue: [{ name: 'extension_installed' }, { name: 'extension_active' }] });
    status = 400;
    onAlarm?.({ name: 'geld:usage' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stored.get('local:usageState')).toMatchObject({ queue: [] });
  });

  it('sends events queued before an update under the version that noted them, and none older than 30 days', async () => {
    const day = 86_400_000;
    const now = Date.UTC(2026, 10, 10, 12);
    stored.set('local:usageState', {
      version: '0.9.3.400',
      day: '2026-11-10',
      week: '2026-W46',
      month: '2026-11',
      queue: [
        { name: 'extension_active', at: now - 2 * day, version: '0.9.3.400', firstOfWeek: false, firstOfMonth: false },
        { name: 'extension_active', at: now - 40 * day, version: '0.9.2.380', firstOfWeek: true, firstOfMonth: true },
      ],
    });
    await start();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent[0]?.version).toBe('0.9.3.412');
    expect(sent[0]?.events.map((event) => [event.name, event.version])).toEqual([
      ['extension_active', '0.9.3.400'],
      ['extension_updated', '0.9.3.412'],
    ]);
  });
});
