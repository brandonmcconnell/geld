import { describe, expect, it } from 'vitest';
import { consentPatch, DEFAULT_SETTINGS, normalizeSettings } from './settings';
import { collectRepoConfigIssues } from './repo-config';

describe('the privacy prompt’s answer', () => {
  it('starts unanswered, and an answer writes both settings with its time', () => {
    expect(DEFAULT_SETTINGS.consentDecidedAt).toBe('');
    expect(consentPatch({ usageStats: false, errorReports: true }, '2026-11-13T23:00:00.000Z')).toEqual({ usageStats: false, errorReports: true, consentDecidedAt: '2026-11-13T23:00:00.000Z' });
  });

  it('keeps an answer stored, and reads anything else as unanswered', () => {
    expect(normalizeSettings({ consentDecidedAt: '2026-11-13T23:00:00.000Z' }).consentDecidedAt).toBe('2026-11-13T23:00:00.000Z');
    expect(normalizeSettings({ consentDecidedAt: 5 }).consentDecidedAt).toBe('');
  });

  it('is the reader’s own: a repository config may not answer it', () => {
    expect(collectRepoConfigIssues({ consentDecidedAt: 'x' }).map((issue) => issue.path)).toEqual(['consentDecidedAt']);
  });
});
