import { describe, expect, it } from 'vitest';
import type { RepositoryIdentity } from './providers';
import { mergeTrustedReviewAccounts, normalizeTrustedReviewAccounts, parseTrustedReviewAccount, trustedReviewAccountFor, trustedReviewAccountsFor, trustedReviewAccountsProblem, withTrustedReviewAccount } from './review-accounts';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import { parseSettingsPayload, serializeSettingsPayload } from './gist-sync';
import { validateSettingsDocument } from './settings-validate';
import { parseRepoConfig } from './repo-config';

const GITLAB: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/platform/widgets' };
const BITBUCKET: RepositoryIdentity = { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'acme/widgets' };
const UUID = '12345678-1234-1234-1234-123456789abc';
const FIRST = 'gitlab.com/acme/platform/widgets coderabbit 12345';

it('starts with no native bindings and never treats a GitHub alias as explicit provider trust', () => {
  expect(DEFAULT_SETTINGS.trustedReviewAccounts).toEqual([]);
  const settings = normalizeSettings({ reviewBots: ['coderabbitai', 'greptileai[bot]'] });
  expect(settings.trustedReviewAccounts).toEqual([]);
  expect(trustedReviewAccountsFor(settings.trustedReviewAccounts, GITLAB)).toEqual([]);
  expect(parseTrustedReviewAccount('gitlab.com/acme/platform/widgets coderabbit coderabbitai')).toBeNull();
  expect(parseTrustedReviewAccount('github.com/acme/widgets coderabbit 12345')).toBeNull();
});

it('keeps account trust inside one exact provider repository', () => {
  const lines = [FIRST];
  expect(trustedReviewAccountFor(lines, GITLAB, '12345')?.botId).toBe('coderabbit');
  expect(trustedReviewAccountFor(lines, GITLAB, '99999')).toBeNull();
  expect(trustedReviewAccountsFor(lines, { ...GITLAB, path: 'acme/other/widgets' })).toEqual([]);
  expect(trustedReviewAccountsFor(lines, { ...GITLAB, origin: 'https://gitlab.example' })).toEqual([]);
  expect(trustedReviewAccountsFor(lines, { provider: 'github', origin: 'https://github.com', path: 'acme/platform/widgets' })).toEqual([]);
});

it('matches native Bitbucket UUID spellings without trusting a nickname or token', () => {
  const lines = [`bitbucket.org/acme/widgets coderabbit {${UUID.toUpperCase()}}`];
  expect(normalizeTrustedReviewAccounts(lines)).toEqual([`bitbucket.org/acme/widgets coderabbit ${UUID}`]);
  expect(trustedReviewAccountFor(lines, BITBUCKET, `{${UUID}}`)?.botId).toBe('coderabbit');
  expect(trustedReviewAccountFor(lines, { ...BITBUCKET, path: 'other/widgets' }, UUID)).toBeNull();
  expect(parseTrustedReviewAccount('bitbucket.org/acme/widgets coderabbit coderabbitai')).toBeNull();
  expect(parseTrustedReviewAccount('bitbucket.org/acme/widgets coderabbit not-a-native-account-id')).toBeNull();
});

it('retains a well-formed future service id across normalization and settings sync', () => {
  const future = 'gitlab.com/acme/platform/widgets future-reviewer-2027 67890';
  const settings = normalizeSettings({ trustedReviewAccounts: [future, '# a comment', FIRST, FIRST] });
  expect(settings.trustedReviewAccounts).toEqual([future, FIRST]);
  const serialized = serializeSettingsPayload(settings);
  expect(parseSettingsPayload(serialized)?.trustedReviewAccounts).toEqual([future, FIRST]);
  const strict = validateSettingsDocument(serialized);
  expect(strict.ok && strict.settings.trustedReviewAccounts).toEqual([future, FIRST]);
});

it('rejects wildcard scopes and ambiguity instead of guessing which service an account represents', () => {
  expect(parseTrustedReviewAccount('gitlab.com/acme/** coderabbit 12345')).toBeNull();
  expect(parseTrustedReviewAccount('gitlab.com/acme/widgets/../other coderabbit 12345')).toBeNull();
  expect(parseTrustedReviewAccount('gitlab.com/acme/widgets coderabbit 12345\n')).toBeNull();
  const conflict = [FIRST, 'gitlab.com/acme/platform/widgets greptile 12345'];
  expect(trustedReviewAccountsProblem(conflict)).toContain('more than one bot');
  expect(normalizeTrustedReviewAccounts(conflict)).toEqual([]);
});

it('adds or changes only an explicitly selected account binding and preserves other installations', () => {
  const other = 'gitlab.com/acme/other/widgets coderabbit 12345';
  const selected = withTrustedReviewAccount([FIRST, other], GITLAB, 'greptile', '12345');
  expect(selected).toEqual([other, 'gitlab.com/acme/platform/widgets greptile 12345']);
  expect(() => withTrustedReviewAccount([], GITLAB, 'coderabbit', 'coderabbitai')).toThrow('numeric');
  expect(() => withTrustedReviewAccount([], { provider: 'github', origin: 'https://github.com', path: 'acme/widgets' }, 'coderabbit', '12345')).toThrow();
});

it('merges list edits with newer panel trust actions instead of losing or reviving bindings', () => {
  const newer = 'gitlab.com/acme/other/widgets coderabbit 22222';
  expect(mergeTrustedReviewAccounts([FIRST], [FIRST], [FIRST, newer])).toEqual([FIRST, newer]);
  expect(mergeTrustedReviewAccounts([FIRST], [], [FIRST, newer])).toEqual([newer]);
  expect(mergeTrustedReviewAccounts([FIRST], [FIRST], [])).toEqual([]);
  expect(mergeTrustedReviewAccounts([FIRST], ['gitlab.com/acme/platform/widgets greptile 12345'], [FIRST, newer])).toEqual(['gitlab.com/acme/platform/widgets greptile 12345', newer]);
});

describe('strict trusted-account imports', () => {
  it('reports every malformed field with its list position', () => {
    const result = validateSettingsDocument(JSON.stringify({ settings: { trustedReviewAccounts: [
      FIRST,
      'gitlab.com/acme/** coderabbit 12345',
      'gitlab.com/acme/widgets coderabbit username',
      'bitbucket.org/acme/widgets coderabbit private-token-value',
      42,
    ] } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.path)).toEqual([
      'settings.trustedReviewAccounts[1]', 'settings.trustedReviewAccounts[2]', 'settings.trustedReviewAccounts[3]', 'settings.trustedReviewAccounts[4]',
    ]);
  });
  it('reports conflicting service assignments without silently normalizing the import', () => {
    const result = validateSettingsDocument(JSON.stringify({ trustedReviewAccounts: [FIRST, 'gitlab.com/acme/platform/widgets greptile 12345'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('$.trustedReviewAccounts[1]');
  });
  it('rejects repository policy trying to establish user account trust', () => {
    const result = parseRepoConfig('trustedReviewAccounts:\n  - ' + FIRST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('trustedReviewAccounts');
  });
});
