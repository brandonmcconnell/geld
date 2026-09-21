import { describe, expect, it } from 'vitest';
import { formatSyncAge } from './sync-age';

const NOW = Date.UTC(2026, 8, 21, 20, 0, 0);

describe('formatSyncAge', () => {
  it('uses compact menu copy and a complete accessible label', () => {
    expect(formatSyncAge(NOW, NOW)).toEqual({ compact: 'now', accessible: 'Synced just now' });
    expect(formatSyncAge(NOW - 60_000, NOW)).toEqual({ compact: '1 min', accessible: 'Synced 1 minute ago' });
    expect(formatSyncAge(NOW - 2 * 60_000, NOW)).toEqual({ compact: '2 mins', accessible: 'Synced 2 minutes ago' });
    expect(formatSyncAge(NOW - 2 * 60 * 60_000, NOW)).toEqual({ compact: '2 hrs', accessible: 'Synced 2 hours ago' });
    expect(formatSyncAge(NOW - 2 * 24 * 60 * 60_000, NOW)).toEqual({ compact: '2 days', accessible: 'Synced 2 days ago' });
  });

  it('treats a clock slightly ahead of this device as just synced', () => {
    expect(formatSyncAge(NOW + 15_000, NOW)).toEqual({ compact: 'now', accessible: 'Synced just now' });
  });
});
