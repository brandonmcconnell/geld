import { describe, expect, it } from 'vitest';
import type { RepositoryIdentity } from './providers';
import { mergeTrustedSummaryPublishers, normalizeTrustedSummaryPublishers, parseTrustedSummaryPublisher, trustedSummaryPublisherIdsFor, trustedSummaryPublishersProblem, withTrustedSummaryPublisher } from './publisher-accounts';
import { trustedReviewAccountsFor } from './review-accounts';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import { validateSettingsDocument } from './settings-validate';
import { parseSettingsPayload, serializeSettingsPayload } from './gist-sync';
import { applyRepoConfigs, parseRepoConfig } from './repo-config';

const GL: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/platform/widgets' };
const BB: RepositoryIdentity = { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'acme/widgets' };
const UUID = '12345678-1234-1234-1234-123456789abc';
const FIRST = 'gitlab.com/acme/platform/widgets 12345';

it('defaults to no publishers and keeps publisher authorization separate from reviewer bots', () => {
  expect(DEFAULT_SETTINGS.trustedSummaryPublishers).toEqual([]);
  const bots = normalizeSettings({ trustedReviewAccounts: ['gitlab.com/acme/platform/widgets coderabbit 12345'], reviewBots: ['geld', 'github-actions[bot]'] });
  expect(trustedSummaryPublisherIdsFor(bots.trustedSummaryPublishers, GL)).toEqual([]);
  const publishers = normalizeSettings({ trustedSummaryPublishers: [FIRST] });
  expect(publishers.trustedReviewAccounts).toEqual([]);
  expect(trustedReviewAccountsFor(publishers.trustedSummaryPublishers, GL)).toEqual([]);
  expect(parseTrustedSummaryPublisher('gitlab.com/acme/platform/widgets coderabbit 12345')).toBeNull();
});

it('permits explicit human account ids and multiple independent publishers in an exact repository', () => {
  const lines = withTrustedSummaryPublisher([FIRST], GL, '67890');
  expect(trustedSummaryPublisherIdsFor(lines, GL)).toEqual(['12345', '67890']);
  expect(parseTrustedSummaryPublisher(FIRST)).toEqual({ repository: GL, authorId: '12345' });
  expect(withTrustedSummaryPublisher(lines, GL, '12345')).toHaveLength(2);
});

it('isolates full nested namespaces, providers and exact cloud origins', () => {
  for (const repository of [
    { ...GL, path: 'acme/other/widgets' }, { ...GL, path: 'acme/widgets' },
    { ...GL, origin: 'https://gitlab.example' }, { ...GL, origin: 'https://gitlab.com/' },
    { ...GL, origin: 'https://gitlab.com:444' }, { ...GL, origin: 'http://gitlab.com' },
    { ...GL, origin: 'https://gitlab.com/anything' },
    { provider: 'github', origin: 'https://github.com', path: GL.path } satisfies RepositoryIdentity,
  ]) expect(trustedSummaryPublisherIdsFor([FIRST], repository)).toEqual([]);
  expect(() => withTrustedSummaryPublisher([], { ...GL, origin: 'https://gitlab.com/' }, '12345')).toThrow();
});

it('normalizes equivalent Bitbucket UUID spellings without accepting another workspace or nickname', () => {
  const lines = normalizeTrustedSummaryPublishers([`bitbucket.org/acme/widgets {${UUID.toUpperCase()}}`, `bitbucket.org/acme/widgets ${UUID}`, '# comment']);
  expect(lines).toEqual([`bitbucket.org/acme/widgets ${UUID}`]);
  expect(trustedSummaryPublisherIdsFor(lines, BB)).toEqual([UUID]);
  expect(trustedSummaryPublisherIdsFor(lines, { ...BB, path: 'other/widgets' })).toEqual([]);
  expect(parseTrustedSummaryPublisher('bitbucket.org/acme/widgets publisher-name')).toBeNull();
});

it('round-trips personal publisher settings through existing cross-device transport without credentials', () => {
  const settings = normalizeSettings({ trustedSummaryPublishers: [FIRST, `bitbucket.org/acme/widgets {${UUID}}`], showBadge: false });
  const encoded = serializeSettingsPayload(settings);
  expect(parseSettingsPayload(encoded)?.trustedSummaryPublishers).toEqual(settings.trustedSummaryPublishers);
  const validated = validateSettingsDocument(encoded);
  expect(validated.ok && validated.settings.trustedSummaryPublishers).toEqual(settings.trustedSummaryPublishers);
  expect(validated.ok && validated.settings.showBadge).toBe(false);
});

it('merges maintenance removals and additions with fresh panel changes without reviving withdrawn trust', () => {
  const other = 'gitlab.com/acme/other/widgets 12345';
  const added = 'gitlab.com/acme/platform/widgets 67890';
  expect(mergeTrustedSummaryPublishers([FIRST], [FIRST], [FIRST, other])).toEqual([FIRST, other]);
  expect(mergeTrustedSummaryPublishers([FIRST], [], [FIRST, other])).toEqual([other]);
  expect(mergeTrustedSummaryPublishers([FIRST], [FIRST], [])).toEqual([]);
  expect(mergeTrustedSummaryPublishers([FIRST], [added], [FIRST, other])).toEqual([other, added]);
});

describe('strict publisher imports and repository policy', () => {
  it('rejects unknown hosts, wildcard/traversal scopes, forged aliases and extra service/token fields', () => {
    const invalid = ['gitlab.com/acme/** 12345', 'gitlab.com/acme/../widgets 12345', 'gitlab.com/acme/widgets/%2fother 12345', 'gitlab.com/acme/widgets username', 'github.com/acme/widgets 12345', 'bitbucket.org/acme/sub/widgets ' + UUID, 'https://gitlab.com/acme/widgets 12345', 'gitlab.com/acme/widgets 12345\n', 'gitlab.com/acme/widgets 12345 token=secret'];
    for (const line of invalid) expect(parseTrustedSummaryPublisher(line), line).toBeNull();
    expect(normalizeTrustedSummaryPublishers([FIRST, ...invalid, FIRST, null])).toEqual([FIRST]);
    expect(trustedSummaryPublishersProblem([FIRST, invalid[0] ?? ''])).toContain('Line 2');
  });
  it('reports each malformed import entry rather than silently granting a repaired authorization', () => {
    const result = validateSettingsDocument(JSON.stringify({ settings: { trustedSummaryPublishers: [FIRST, 'gitlab.com/acme/** 12345', 42, 'bitbucket.org/acme/widgets token'] } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.path)).toEqual(['settings.trustedSummaryPublishers[1]', 'settings.trustedSummaryPublishers[2]', 'settings.trustedSummaryPublishers[3]']);
  });
  it('forbids repository and organization config from granting or withdrawing personal publisher trust', () => {
    const config = parseRepoConfig('trustedSummaryPublishers:\n  - ' + FIRST);
    expect(config.ok).toBe(false);
    if (!config.ok) expect(config.issues[0]?.path).toBe('trustedSummaryPublishers');
    const allowed = parseRepoConfig('reviewBots:\n  - coderabbit');
    expect(allowed.ok).toBe(true);
    const settings = normalizeSettings({ trustedSummaryPublishers: [FIRST] });
    if (allowed.ok) expect(applyRepoConfigs(settings, [allowed.config]).trustedSummaryPublishers).toEqual([FIRST]);
  });
});
