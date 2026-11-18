import { describe, expect, it } from 'vitest';
import { parseUsagePayload, usageBuildOf, usageCaptures, usagePeriods, versionJump } from './usage-report';

const base = { v: 1, version: '0.9.3.412', channel: 'stable', browser: 'chrome' };

describe('parseUsagePayload', () => {
  it('keeps the named fields of each event and drops everything else', () => {
    const payload = parseUsagePayload({
      ...base,
      installId: 'abc',
      url: 'https://github.com/private/repo',
      events: [
        { name: 'extension_installed', at: 1, login: 'someone' },
        { name: 'extension_updated', at: 2, from: '0.9.2.400', trigger: 'automatic', method: 'folder', rollback: true, path: '/Users/me' },
        { name: 'extension_active', at: 3, firstOfWeek: true, firstOfMonth: false },
      ],
    });
    expect(payload).toEqual({
      ...base,
      events: [
        { name: 'extension_installed', at: 1 },
        { name: 'extension_updated', at: 2, from: '0.9.2.400', trigger: 'automatic', method: 'folder', rollback: true },
        { name: 'extension_active', at: 3, firstOfWeek: true, firstOfMonth: false },
      ],
    });
  });

  it('keeps a nightly build’s update mode', () => {
    expect(parseUsagePayload({ ...base, channel: 'nightly', selfUpdate: { mode: 'manual', folder: 'x' }, events: [{ name: 'extension_installed', at: 1 }] })?.selfUpdate).toEqual({ mode: 'manual' });
  });

  it('keeps what held up a nightly update on its daily ping, only by its fixed names', () => {
    const active = (blocked: unknown) => parseUsagePayload({ ...base, channel: 'nightly', selfUpdate: { mode: 'automatic' }, events: [{ name: 'extension_active', at: 1, firstOfWeek: false, firstOfMonth: false, blocked }] })?.events[0];
    expect(active('permission')).toMatchObject({ blocked: 'permission' });
    expect(active('/Users/me/Geld Nightly')).not.toHaveProperty('blocked');
  });

  it('refuses what is not a payload', () => {
    expect(parseUsagePayload({ ...base, events: [] })).toBeNull();
    expect(parseUsagePayload({ ...base, version: 'latest', events: [{ name: 'extension_installed', at: 1 }] })).toBeNull();
    expect(parseUsagePayload({ ...base, channel: 'beta', events: [{ name: 'extension_installed', at: 1 }] })).toBeNull();
    expect(parseUsagePayload({ ...base, events: [{ name: 'page_view', at: 1 }] })).toBeNull();
    expect(parseUsagePayload({ ...base, events: [{ name: 'extension_updated', at: 1, from: 'owner/repo' }] })).toBeNull();
    expect(parseUsagePayload({ ...base, events: Array.from({ length: 51 }, () => ({ name: 'extension_installed', at: 1 })) })).toBeNull();
  });
});

describe('usageCaptures', () => {
  const now = Date.UTC(2026, 10, 10, 12);
  it('derives the update’s jump, path and trigger from the versions', () => {
    const payload = parseUsagePayload({
      ...base,
      channel: 'nightly',
      selfUpdate: { mode: 'automatic' },
      events: [
        { name: 'extension_updated', at: now - 1000, from: '0.9.2.400', trigger: 'automatic', method: 'downloads' },
        { name: 'extension_updated', at: now - 500, from: '0.9.3.410' },
      ],
    });
    if (payload === null) throw new Error('payload refused');
    const [automatic, byHand] = usageCaptures(payload, now);
    expect(automatic).toEqual({
      event: 'extension_updated',
      timestamp: new Date(now - 1000).toISOString(),
      properties: {
        version: '0.9.3.412',
        build: 412,
        channel: 'nightly',
        browser: 'chrome',
        nightly_mode: 'automatic',
        from_version: '0.9.2.400',
        from_build: 400,
        build_delta: 12,
        version_jump: 'patch',
        upgrade_path: '0.9.2.400 → 0.9.3.412',
        update_trigger: 'automatic',
        update_method: 'downloads',
        rollback: false,
      },
    });
    expect(byHand?.properties.update_trigger).toBe('by_hand');
  });

  it('flattens each ping’s own held-up update to nightly_blocked', () => {
    const payload = parseUsagePayload({
      ...base,
      channel: 'nightly',
      selfUpdate: { mode: 'automatic' },
      events: [
        { name: 'extension_active', at: now - 86_400_000, firstOfWeek: false, firstOfMonth: false, blocked: 'folder' },
        { name: 'extension_active', at: now, firstOfWeek: false, firstOfMonth: false },
      ],
    });
    if (payload === null) throw new Error('payload refused');
    expect(usageCaptures(payload, now).map((capture) => capture.properties.nightly_blocked)).toEqual(['folder', 'none']);
    const { selfUpdate: _selfUpdate, ...stable } = payload;
    expect(usageCaptures({ ...stable, channel: 'stable' }, now)[0]?.properties).not.toHaveProperty('nightly_blocked');
  });

  it('calls a stable build’s update the store’s', () => {
    const payload = parseUsagePayload({ ...base, events: [{ name: 'extension_updated', at: now, from: '0.9.2' }, { name: 'extension_active', at: now, firstOfWeek: true, firstOfMonth: true }] });
    if (payload === null) throw new Error('payload refused');
    const [update, active] = usageCaptures(payload, now);
    expect(update?.properties).toMatchObject({ update_trigger: 'store', from_build: null, build_delta: null, version_jump: 'patch' });
    expect(active?.properties).toMatchObject({ version: '0.9.3.412', build: 412, channel: 'stable', browser: 'chrome', first_of_week: true, first_of_month: true, used_digest_shown: 0 });
  });

  it('keeps each event’s own version and date, drops what is too old and re-dates a clock ahead', () => {
    const day = 86_400_000;
    const payload = parseUsagePayload({
      ...base,
      events: [
        { name: 'extension_active', at: now - 10 * day, version: '0.9.2.400', firstOfWeek: true, firstOfMonth: false },
        { name: 'extension_updated', at: now - 9 * day, version: '0.9.2.400', from: '0.9.1.390' },
        { name: 'extension_active', at: now - 31 * day, version: '0.9.1.390', firstOfWeek: true, firstOfMonth: true },
        { name: 'extension_installed', at: now + 2 * 60 * 60_000 },
      ],
    });
    if (payload === null) throw new Error('payload refused');
    const captures = usageCaptures(payload, now);
    expect(captures.map((capture) => [capture.event, capture.timestamp, capture.properties.version])).toEqual([
      ['extension_active', new Date(now - 10 * day).toISOString(), '0.9.2.400'],
      ['extension_updated', new Date(now - 9 * day).toISOString(), '0.9.2.400'],
      ['extension_installed', new Date(now).toISOString(), '0.9.3.412'],
    ]);
    expect(captures[1]?.properties).toMatchObject({ upgrade_path: '0.9.1.390 → 0.9.2.400', build_delta: 10, build: 400 });
  });

  it('refuses an event whose own version is not one', () => {
    expect(parseUsagePayload({ ...base, events: [{ name: 'extension_installed', at: 1, version: 'owner/repo' }] })).toBeNull();
  });
});

describe('versionJump', () => {
  it('names the first part that moved', () => {
    expect(versionJump('0.9.3.400', '1.0.0.410')).toBe('major');
    expect(versionJump('0.9.3.400', '0.10.0.410')).toBe('minor');
    expect(versionJump('0.9.3.400', '0.9.4.410')).toBe('patch');
    expect(versionJump('0.9.3.400', '0.9.3.410')).toBe('build');
    expect(versionJump('0.9.3.410', '0.9.3.400')).toBe('downgrade');
    expect(versionJump('0.9.3.400', '0.9.3.400')).toBe('same');
    expect(versionJump('0.9.3', '0.9.3.12')).toBe('build');
  });
  it('reads the build number of a CI version only', () => {
    expect(usageBuildOf('0.9.3.412')).toBe(412);
    expect(usageBuildOf('0.9.3')).toBeNull();
  });
});

describe('usagePeriods', () => {
  it('keys days, ISO weeks and months in UTC', () => {
    expect(usagePeriods(Date.UTC(2026, 10, 10, 23, 59))).toEqual({ day: '2026-11-10', week: '2026-W46', month: '2026-11' });
    expect(usagePeriods(Date.UTC(2027, 0, 1))).toEqual({ day: '2027-01-01', week: '2026-W53', month: '2027-01' });
    expect(usagePeriods(Date.UTC(2024, 11, 30))).toEqual({ day: '2024-12-30', week: '2025-W01', month: '2024-12' });
    expect(usagePeriods(Date.UTC(2026, 0, 5)).week).toBe('2026-W02');
  });
});
