import { describe, expect, it } from 'vitest';
import { parseSettingsPayload, serializeSettingsPayload } from './gist-sync';
import { DEFAULT_SETTINGS } from './settings';

describe('settings gist serialization', () => {
  it('cleans retired large-category fields on every outbound document', () => {
    const content = serializeSettingsPayload(
      {
        ...DEFAULT_SETTINGS,
        categories: { tests: false, large: true },
        groups: { 'large/large': false, 'tests/e2e': false },
        categoryPatterns: { large: ['vendor/**'], tests: ['*.golden'] },
      },
      new Date('2026-09-21T00:00:00.000Z'),
    );
    expect(content).not.toContain('"large"');
    expect(content).not.toContain('"large/large"');
    expect(content).not.toContain('vendor/**');
    const parsed = parseSettingsPayload(content);
    expect(parsed?.categories).toEqual({ tests: false });
    expect(parsed?.groups).toEqual({ 'tests/e2e': false });
    expect(parsed?.categoryPatterns).toEqual({ tests: ['*.golden'] });
    expect(parsed?.hideLargeDiffs).toBe(false);
  });
});
