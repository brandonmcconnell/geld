import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGeldPrMeta } from './model';
import { buildProviderBotVerdicts, providerCodeSourceLink, PROVIDER_BOT_CAPABILITIES, providerBotSupport } from './provider-bots';
import { refusalReason } from './bots';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject, ProviderReviewThread } from './provider-review';

const SHA = 'a'.repeat(40);
const MERGE_SHA = 'b'.repeat(40);
const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'ark-bitcoin/bark', id: '2117', headSha: SHA };
const coderabbit = { id: '38968537', login: 'group_117740890_bot_4b22dd1a4e94814ac4828214cbd93cfe', automated: true };
const greptile = { id: '37628862', login: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b', automated: true };

function note(id: string, body: string, overrides: Partial<ProviderReviewComment> = {}): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117#note_${id}`, author: coderabbit, body, createdAt: '2026-06-09T10:16:47.804Z', ...overrides };
}

function thread(comment: ProviderReviewComment, resolved = true): ProviderReviewThread {
  return { id: comment.id, anchor: comment.anchor, url: comment.url, resolved, outdated: false, comments: [comment] };
}

function input(overrides: Partial<ProviderReviewInput> = {}): ProviderReviewInput {
  return { subject, threads: [], bots: [{ id: 'coderabbit', authorId: coderabbit.id, login: coderabbit.login }], complete: true, ...overrides };
}

afterEach(() => { vi.useRealTimers(); });

describe('native source evidence in a bot refusal', () => {
  const gitlab: ProviderReviewSubject = { ...subject, repository: 'group/sub/project', id: '17' };
  const bitbucket: ProviderReviewSubject = { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repo', id: '23' };
  const nativeOptions = (value: ProviderReviewSubject): { isSourceLink: (href: string) => boolean } => ({ isSourceLink: (href) => providerCodeSourceLink(href, value) });

  it.each([
    '/group/sub/project/-/merge_requests/17/diffs#diff-content-abc',
    '/group/sub/project/-/merge_requests/17/diffs?diff_id=12&start_sha=abc',
    '/group/sub/project/-/blob/main/src/auth.ts#L42',
    '/group/sub/project/-/tree/main/src',
    '/group/sub/project/-/tree/main',
    `/group/sub/project/-/commit/${SHA}`,
    `/group/sub/project/-/commit/${SHA}.diff`,
    `/group/sub/project/-/compare/${SHA}...${MERGE_SHA}`,
  ])('treats GitLab code surface %s as evidence, including nested namespaces', (path) => {
    const url = `https://gitlab.com${path}`;
    expect(providerCodeSourceLink(url, gitlab)).toBe(true);
    expect(refusalReason(`Cannot access repository. See ${url} for the broken check.`, nativeOptions(gitlab))).toBeNull();
  });

  it.each([
    '/workspace/repo/pull-requests/23/diff#chg-src/auth.ts',
    '/workspace/repo/pull-requests/23/_/diff#chg-src/auth.ts',
    '/workspace/repo/src/main/src/auth.ts#lines-42',
    '/workspace/repo/src/main/',
    `/workspace/repo/commits/${SHA}`,
  ])('treats Bitbucket code surface %s as evidence without assuming its bot summary format', (path) => {
    const url = `https://bitbucket.org${path}`;
    expect(providerCodeSourceLink(url, bitbucket)).toBe(true);
    expect(refusalReason(`Cannot access repository. See ${url} for the broken check.`, nativeOptions(bitbucket))).toBeNull();
  });

  it('reads relative Markdown and HTML links through the same native evidence predicate', () => {
    const path = '/group/sub/project/-/merge_requests/17/diffs#diff-content-abc';
    expect(refusalReason(`Cannot access repository. See [the diff](${path}) for the broken check.`, nativeOptions(gitlab))).toBeNull();
    expect(refusalReason(`Cannot access repository. See <a href="${path}">the diff</a> for the broken check.`, nativeOptions(gitlab))).toBeNull();
    expect(refusalReason(`Cannot access repository. See [the diff](https://gitlab.com${path}) for the broken check.`, nativeOptions(gitlab))).toBeNull();
  });

  it.each([
    'https://docs.example.com/changes/access',
    'https://gitlab.com/users/sign_in',
    'https://gitlab.com/group/sub/project/-/settings/access_tokens',
    'https://gitlab.com/group/sub/project/-/merge_requests/17#note_123',
    'https://gitlab.com/group/sub/project/-/merge_requests/18/diffs',
    'https://gitlab.com/group/sub/project-other/-/merge_requests/17/diffs',
    'https://gitlab.com/other/project/-/merge_requests/17/diffs',
    'https://evil.example/group/sub/project/-/merge_requests/17/diffs',
    'https://gitlab.com.evil.example/group/sub/project/-/merge_requests/17/diffs',
    'https://name:secret@gitlab.com/group/sub/project/-/merge_requests/17/diffs',
    'javascript:alert(1)',
  ])('does not treat a setup or foreign link %s as native code evidence', (url) => {
    expect(providerCodeSourceLink(url, gitlab)).toBe(false);
  });

  it('keeps real setup refusals and default GitHub behavior', () => {
    const githubFinding = 'Cannot access repository. See https://github.com/acme/widgets/pull/1/files#diff-abc for the broken check.';
    expect(refusalReason(githubFinding)).toBeNull();
    expect(refusalReason('Cannot access repository. See https://docs.example.com/changes/access for help.')).toBe('Cannot access repository');
    expect(refusalReason('Cannot access repository. See https://gitlab.com/group/sub/project/-/settings/access_tokens for help.', nativeOptions(gitlab))).toBe('Cannot access repository');
    expect(refusalReason('Permission denied. Reconnect the integration.', nativeOptions(bitbucket))).toBe('Permission denied');
  });

  it('isolates self-managed origins and full repository paths', () => {
    const hosted = { ...gitlab, origin: 'https://forge.example:8443' };
    expect(providerCodeSourceLink('/group/sub/project/-/merge_requests/17/diffs', hosted)).toBe(true);
    expect(providerCodeSourceLink('https://gitlab.com/group/sub/project/-/merge_requests/17/diffs', hosted)).toBe(false);
    expect(providerCodeSourceLink('https://forge.example/group/sub/project/-/merge_requests/17/diffs', hosted)).toBe(false);
    expect(providerCodeSourceLink('/workspace/repo/pull-requests/24/diff', bitbucket)).toBe(false);
    expect(providerCodeSourceLink('/workspace/repo/settings', bitbucket)).toBe(false);
  });

  it('preserves the native finding through both the provider prefilter and shared verdict pass', () => {
    const body = `Cannot access repository. See https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117/diffs#diff-content-abc for the broken check.\n\n**Actionable comments posted: 1**`;
    const summary = note('123', body);
    expect(buildProviderBotVerdicts(input(), [summary])[0]).toMatchObject({ id: 'coderabbit', verdict: 'findings', count: 1, sourceId: 'note_123' });
    expect(buildProviderBotVerdicts(input(), [note('124', 'Cannot access repository. See https://gitlab.com/ark-bitcoin/bark/-/settings/access_tokens for help.')])[0]).toMatchObject({ id: 'coderabbit', verdict: 'failed', reason: 'Cannot access repository' });
  });
});

describe('native bot account binding', () => {
  it('uses the real GitLab CodeRabbit summary and resolved inline findings as one resolved review', () => {
    // Public bark !2117 notes 3436707544/3436707624/3436707657/3436707667, captured November 1, 2026.
    const summary = note('3436707544', '**Actionable comments posted: 3**\n\n<details>\n<summary>🧹 Nitpick comments (1)</summary><blockquote>\n\n**Consider explicit handling for missing or invalid state type.**\n\n</blockquote></details>');
    const findings = [
      note('3436707624', '_⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_\n\n**Fix malformed table rows in the properties table.**', { createdAt: '2026-06-09T10:16:49.574Z' }),
      note('3436707657', '_⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_\n\n**Add the missing `Notes` table cell for the property row.**', { createdAt: '2026-06-09T10:16:50.131Z' }),
      note('3436707667', '_⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_\n\n**Complete the row to match the 4-column table format.**', { createdAt: '2026-06-09T10:16:50.433Z' }),
    ];
    const result = buildProviderBotVerdicts(input({ threads: findings.map((finding) => thread(finding)) }), [summary]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'coderabbit', login: coderabbit.login, verdict: 'findings', count: 0, sourceId: 'note_3436707667' });
    expect(JSON.stringify(result)).not.toContain('discussion_r');
    expect(JSON.stringify(result)).not.toContain('coderabbitai[bot]');
    const partial = buildProviderBotVerdicts(input({ complete: false, threads: findings.slice(0, 2).map((finding) => thread(finding)) }), [summary]);
    expect(partial[0]?.verdict).toBe('findings');
    expect(partial[0]?.count).toBeUndefined();
  });

  it('takes the real edited GitLab Greptile score over its earlier resolved run', () => {
    const whitebox: ProviderReviewSubject = { ...subject, repository: 'whitebox-aero/whitebox', id: '272' };
    const summary = note('3381334808', '<h3>Greptile Summary</h3>\n\nThis PR ships the parallel HTTP range-request download feature.\n\n<h3>Confidence Score: 5/5</h3>\n\nSafe to merge — the changes are purely dependency version bumps that promote already-reviewed branch work to published PyPI releases.', { author: greptile, createdAt: '2026-05-25T08:20:44.347Z', updatedAt: '2026-06-17T03:55:42.680Z', url: 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272#note_3381334808' });
    const finding = note('3384406925', '<a href="#"><img alt="P1" src="https://greptile-static-assets.s3.amazonaws.com/badges/p1.svg?v=9" height="20" align="top"></a> **Missing transitive dependency for git-sourced plugin**', { author: greptile, createdAt: '2026-05-26T08:58:09.914Z', url: 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272#note_3384406925' });
    const result = buildProviderBotVerdicts(input({ subject: whitebox, threads: [thread(finding)], bots: [{ id: 'greptile', authorId: greptile.id }] }), [summary]);
    expect(result[0]).toMatchObject({ id: 'greptile', login: greptile.login, verdict: 'clean', score: 5, sourceId: 'note_3381334808' });
    expect(buildProviderBotVerdicts(input({ subject: whitebox, threads: [thread(finding, false)], bots: [{ id: 'greptile', authorId: greptile.id }] }), [summary])[0]).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'note_3384406925' });
  });

  it('never authenticates GitHub aliases, account display names or body markers', () => {
    const forged = note('1', '<!-- This is an auto-generated comment by CodeRabbit -->\n**Actionable comments posted: 0**', { author: { id: 'unbound-user', login: 'coderabbitai[bot]', automated: true } });
    expect(buildProviderBotVerdicts(input(), [forged])).toEqual([]);
    expect(buildProviderBotVerdicts(input({ bots: [] }), [note('2', '**Actionable comments posted: 0**')])).toEqual([]);
    expect(buildProviderBotVerdicts(input({ bots: [{ id: 'coderabbit', authorId: 'different-project-account' }] }), [note('2', '**Actionable comments posted: 0**')])).toEqual([]);
    expect(buildProviderBotVerdicts(input({ bots: [{ id: 'coderabbit', authorId: coderabbit.id }, { id: 'greptile', authorId: coderabbit.id }] }), [note('2', '**Actionable comments posted: 0**')])).toEqual([]);
  });

  it('does not count a bot reply as a new bot-owned finding or a generic chat as a review', () => {
    const human = note('1', 'Could we keep this behavior?', { author: { id: 'a-person', login: 'alice' } });
    const reply = note('2', 'The fix is correct. No issues found.');
    const discussion = { ...thread(human, false), comments: [human, reply] };
    expect(buildProviderBotVerdicts(input({ threads: [discussion] }), [reply])).toEqual([]);
    expect(buildProviderBotVerdicts(input(), [reply])).toEqual([]);
    const walkthrough = note('3436654383', '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\n> ## Reviews paused\n> It looks like this branch is under active development.\n<details><summary>📝 Walkthrough</summary>\nVTXOs remain spendable while unilateral-exit transactions are broadcast.\n</details>');
    expect(buildProviderBotVerdicts(input(), [walkthrough]).every((record) => record.verdict !== 'clean')).toBe(true);
  });
});

describe('provider checks and run provenance', () => {
  const bitbucket: ProviderReviewSubject = { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repo', id: '5', headSha: SHA };
  function checked(overrides: Partial<NonNullable<ProviderReviewInput['checks']>[number]> = {}): ProviderReviewInput {
    return input({ subject: bitbucket, bots: [{ id: 'bugbot', authorId: '{native-account-id}' }], checks: [{ name: 'Cursor code review', key: 'cursor-bugbot', authorId: '{native-account-id}', status: 'completed', conclusion: 'success', sha: MERGE_SHA, reviewHeadSha: SHA, startedAt: '2026-11-01T11:55:00Z', completedAt: '2026-11-01T11:56:00Z', ...overrides }] });
  }

  it('accepts an authoritative merge-pipeline association while retaining its actual commit SHA', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    const value = checked();
    const result = buildProviderBotVerdicts(value, []);
    expect(result[0]).toMatchObject({ id: 'bugbot', login: '{native-account-id}', verdict: 'clean', reviewedSha: SHA, checkSha: MERGE_SHA, checkName: 'Cursor code review', runJudged: true });
    expect(value.checks?.[0]?.sha).toBe(MERGE_SHA);
    const meta = parseGeldPrMeta({ v: 1, generatedAt: '2026-11-01T12:00:00Z', headSha: SHA, producer: { kind: 'crawler', version: '1', ai: false }, items: [], bots: result, reviewers: [], fold: { comments: [], events: [] } });
    expect(meta.ok).toBe(true);
    if (meta.ok) expect(meta.value.bots[0]?.checkSha).toBe(MERGE_SHA);
  });

  it('requires the bound publisher, native check key and exact head association', () => {
    expect(buildProviderBotVerdicts(checked({ authorId: 'someone-else' }), [])).toEqual([]);
    expect(buildProviderBotVerdicts(checked({ key: 'cursor-bugbot-autofix' }), [])).toEqual([]);
    expect(buildProviderBotVerdicts(checked({ reviewHeadSha: 'c'.repeat(40) }), [])).toEqual([]);
    const noAssociation = checked();
    const checks = noAssociation.checks?.map(({ reviewHeadSha: _omitted, ...check }) => check);
    expect(buildProviderBotVerdicts({ ...noAssociation, checks: checks ?? [] }, [])).toEqual([]);
  });

  it('does not turn a neutral or unknown completed check into a clean review', () => {
    expect(buildProviderBotVerdicts(checked({ conclusion: 'neutral' }), [])[0]).toMatchObject({ verdict: 'unknown', reviewedSha: SHA, checkSha: MERGE_SHA });
    expect(buildProviderBotVerdicts(checked({ conclusion: null }), [])[0]?.verdict).toBe('unknown');
    expect(buildProviderBotVerdicts(checked({ status: 'in_progress', conclusion: null }), [])[0]?.verdict).toBe('running');
  });

  it('keeps comments-only Sourcery free of invented check results or failures', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T14:00:00Z'));
    const request = note('1', '@sourcery-ai review', { author: { id: 'human', login: 'alice' }, createdAt: '2026-11-01T12:00:00Z' });
    const value = input({ bots: [{ id: 'sourcery', authorId: 'service', checkNames: ['Sourcery review'] }], checks: [{ name: 'Sourcery review', key: 'Sourcery review', authorId: 'service', sha: SHA, status: 'completed', conclusion: 'failure' }] });
    expect(buildProviderBotVerdicts(value, [request])[0]).toMatchObject({ id: 'sourcery', verdict: 'unknown', sourceId: 'note_1' });
    expect(buildProviderBotVerdicts(value, [])).toEqual([]);
  });

  it('keeps an earlier finding when a verified command is answered with no new review', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T13:00:00Z'));
    const finding = note('2', 'An unresolved native finding.', { createdAt: '2026-11-01T11:00:00Z' });
    const request = note('3', '@coderabbitai review', { author: { id: 'human', login: 'alice' }, createdAt: '2026-11-01T12:00:00Z' });
    const answer = note('4', '✅ Action performed\nReview finished. CodeRabbit does not re-review already reviewed commits.', { createdAt: '2026-11-01T12:00:02Z', updatedAt: '2026-11-01T12:00:10Z' });
    const value = input({ threads: [thread(finding, false)], bots: [{ id: 'coderabbit', authorId: coderabbit.id, checkNames: ['native-review'] }], checks: [{ name: 'Native review', key: 'native-review', authorId: coderabbit.id, status: 'completed', conclusion: 'success', sha: SHA, startedAt: '2026-11-01T12:00:01Z', completedAt: '2026-11-01T12:00:11Z' }] });
    expect(buildProviderBotVerdicts(value, [request, answer])[0]).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'note_2' });
  });
});

describe('provider-verified rerun commands and capabilities', () => {
  it('starts a human request without inheriting GitHub reaction rules and never starts from automation', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:05:00Z'));
    const request = note('1', '@greptileai', { author: { id: 'human', login: 'alice' }, createdAt: '2026-11-01T12:00:00Z' });
    const value = input({ bots: [{ id: 'greptile', authorId: greptile.id, login: greptile.login }] });
    expect(buildProviderBotVerdicts(value, [request])[0]).toMatchObject({ verdict: 'running', login: greptile.login, sourceId: 'note_1' });
    expect(buildProviderBotVerdicts(value, [{ ...request, author: { id: 'automation', login: 'another-bot', automated: true } }])).toEqual([]);
    vi.setSystemTime(new Date('2026-11-01T14:00:00Z'));
    expect(buildProviderBotVerdicts(value, [request])[0]?.verdict).toBe('unknown');
  });

  it('does not transplant Devin GitHub commands or treat command names in prose as a request', () => {
    const request = note('1', '/devin review', { author: { id: 'human', login: 'alice' } });
    expect(buildProviderBotVerdicts(input({ bots: [{ id: 'devin', authorId: 'native-devin', triggers: ['/devin review'] }] }), [request])).toEqual([]);
    expect(buildProviderBotVerdicts(input(), [{ ...request, body: 'We removed the old @coderabbitai review command from the docs.' }])).toEqual([]);
    expect(providerBotSupport('gitlab', 'devin')?.triggers).toEqual([]);
  });

  it('exposes documented support separately from observed verdict formats and unavailable services', () => {
    expect(PROVIDER_BOT_CAPABILITIES).toHaveLength(36);
    expect(providerBotSupport('gitlab', 'coderabbit')).toMatchObject({ support: 'supported', formatVerified: true });
    expect(providerBotSupport('bitbucket', 'coderabbit')).toMatchObject({ support: 'supported', formatVerified: false, triggers: [] });
    expect(providerBotSupport('gitlab', 'sourcery')).toMatchObject({ support: 'supported', checkMode: 'none' });
    expect(providerBotSupport('bitbucket', 'bugbot')?.checkKeys).toContain('cursor-bugbot');
    expect(providerBotSupport('gitlab', 'cubic')?.support).toBe('unsupported');
    expect(providerBotSupport('gitlab', 'codex')?.support).toBe('unverified');
    expect(providerBotSupport('gitlab', 'amazon-q')?.support).toBe('unsupported');
    const bitbucket: ProviderReviewSubject = { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repo' };
    const body = note('1', 'No actionable comments were generated.', { anchor: 'comment-1', url: 'https://bitbucket.org/workspace/repo/pull-requests/2117#comment-1' });
    expect(buildProviderBotVerdicts(input({ subject: bitbucket }), [body])).toEqual([]);
  });
});
