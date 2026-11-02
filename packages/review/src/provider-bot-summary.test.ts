import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProviderBotVerdicts, newestProviderBotSummary } from './provider-bots';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject } from './provider-review';

const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/sub/project', id: '42', headSha: 'a'.repeat(40) };
const rabbit = { id: '38968537', login: 'group_117740890_bot_4b22dd1a4e94814ac4828214cbd93cfe', automated: true };
const greptile = { id: '37628862', login: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b', automated: true };
const rabbitBody = '**Actionable comments posted: 3**\n\n<details><summary>🧹 Nitpick comments (1)</summary><blockquote>Consider explicit handling for missing or invalid state type.</blockquote></details>';
const greptileBody = '<h3>Greptile Summary</h3>\nThis PR ships the parallel HTTP range-request download feature.\n<h3>Confidence Score: 5/5</h3>\nSafe to merge.';

function note(id: string, body = rabbitBody, overrides: Partial<ProviderReviewComment> = {}): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `https://gitlab.com/group/sub/project/-/merge_requests/42#note_${id}`, author: rabbit, body, createdAt: '2026-11-02T00:00:00Z', ...overrides };
}

function input(overrides: Partial<ProviderReviewInput> = {}): ProviderReviewInput {
  return { subject, threads: [], bots: [{ id: 'coderabbit', authorId: rabbit.id }, { id: 'greptile', authorId: greptile.id }], complete: true, ...overrides };
}

afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });

describe('newest native bot summary', () => {
  it('selects the observed GitLab CodeRabbit and Greptile report formats by durable account', () => {
    const rabbitReport = note('3436707544');
    const greptileReport = note('3381334808', greptileBody, { author: greptile });
    const source = input();
    expect(newestProviderBotSummary(source, [greptileReport, rabbitReport], 'coderabbit')).toBe(rabbitReport);
    expect(newestProviderBotSummary(source, [rabbitReport, greptileReport], 'greptile')).toBe(greptileReport);
  });

  it('orders distinct reports by creation and keeps the available report in a partial snapshot', () => {
    const older = note('1', rabbitBody, { updatedAt: '2026-11-02T00:20:00Z' });
    const newer = note('2', rabbitBody, { createdAt: '2026-11-02T00:10:00Z' });
    const source = input({ complete: false });
    expect(newestProviderBotSummary(source, [newer, older], 'coderabbit')).toBe(newer);
    expect(newestProviderBotSummary(source, [older, newer], 'coderabbit')).toBe(newer);
    expect(newestProviderBotSummary(source, [older], 'coderabbit')).toBe(older);
  });

  it('keeps the report behind newer status, refusal, trigger, command acknowledgement and walkthrough notes', () => {
    const report = note('1');
    const later = [
      'Currently processing new changes in this merge request.',
      'Permission denied. Check the token and retry.',
      '@coderabbitai review',
      '✅ Action performed\nReview finished. CodeRabbit does not re-review already reviewed commits.',
      '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\n> ## Reviews paused\n> This branch is under active development.\n<details><summary>📝 Walkthrough</summary>VTXOs remain spendable.</details>',
    ].map((body, index) => note(String(index + 2), body, { createdAt: '2026-11-02T00:10:00Z' }));
    expect(newestProviderBotSummary(input(), [report, ...later], 'coderabbit')).toBe(report);
    expect(newestProviderBotSummary(input(), later, 'coderabbit')).toBeNull();
  });

  it('does not turn a bot-owned finding or a reply in a human thread into a top-level report', () => {
    const finding = note('1');
    const reply = note('2');
    const person = note('3', 'Could you review this?', { author: { id: 'person', login: 'alice' } });
    const source = input({ threads: [
      { id: 'a', anchor: finding.anchor, url: finding.url, resolved: false, outdated: false, comments: [finding] },
      { id: 'b', anchor: person.anchor, url: person.url, resolved: false, outdated: false, comments: [person, reply] },
    ] });
    expect(newestProviderBotSummary(source, [finding, reply], 'coderabbit')).toBeNull();
  });

  it('rejects unbound lookalikes and an account ambiguously bound to different services', () => {
    const report = note('1');
    const spoof = note('2', rabbitBody, { author: { ...rabbit, id: 'another-account' } });
    expect(newestProviderBotSummary(input(), [spoof], 'coderabbit')).toBeNull();
    expect(newestProviderBotSummary(input({ bots: [] }), [report], 'coderabbit')).toBeNull();
    const ambiguous = input({ bots: [{ id: 'coderabbit', authorId: rabbit.id }, { id: 'greptile', authorId: rabbit.id }] });
    expect(newestProviderBotSummary(ambiguous, [report], 'coderabbit')).toBeNull();
    expect(newestProviderBotSummary(ambiguous, [note('3', greptileBody)], 'greptile')).toBeNull();
    expect(buildProviderBotVerdicts(ambiguous, [report])).toEqual([]);
  });

  it.each([
    'https://evil.example/group/sub/project/-/merge_requests/42#note_1',
    'https://gitlab.com/group/other/-/merge_requests/42#note_1',
    'https://gitlab.com/group/sub/project/-/merge_requests/43#note_1',
    'https://user:password@gitlab.com/group/sub/project/-/merge_requests/42#note_1',
    'https://gitlab.com/group/sub/project/-/merge_requests/42#note_2',
    'javascript:alert(1)',
  ])('rejects a summary whose source URL is outside its native subject: %s', (url) => {
    expect(newestProviderBotSummary(input(), [note('1', rabbitBody, { url })], 'coderabbit')).toBeNull();
  });

  it('skips invalid clocks and identities without losing an older valid report', () => {
    const report = note('1');
    const invalid = [
      note('2', rabbitBody, { createdAt: 'not-a-time' }),
      note('3', rabbitBody, { author: { ...rabbit, login: '' } }),
      note('4', rabbitBody, { author: { ...rabbit, id: '' } }),
    ];
    expect(newestProviderBotSummary(input(), [...invalid, report], 'coderabbit')).toBe(report);
    expect(newestProviderBotSummary(input(), invalid, 'coderabbit')).toBeNull();
  });

  it('requires the observed Greptile confidence shape and a verified provider format', () => {
    expect(newestProviderBotSummary(input(), [note('1', 'Found 3 issues.', { author: greptile })], 'greptile')).toBeNull();
    const bitbucket: ProviderReviewInput = { ...input(), subject: { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repo' } };
    const report = note('1', rabbitBody, { anchor: 'comment-1', url: 'https://bitbucket.org/workspace/repo/pull-requests/42#comment-1' });
    expect(newestProviderBotSummary(bitbucket, [report], 'coderabbit')).toBeNull();
    expect(newestProviderBotSummary(input({ bots: [{ id: 'not-a-service', authorId: rabbit.id }] }), [note('1')], 'not-a-service')).toBeNull();
  });

  it('leaves a running verdict pointing at its actual request while independently selecting its report', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-02T00:12:00Z'));
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    const report = Object.freeze(note('1'));
    const request = Object.freeze(note('2', '@coderabbitai review', { author: { id: 'person', login: 'alice' }, createdAt: '2026-11-02T00:11:00Z' }));
    const comments = Object.freeze([report, request]);
    const source = input();
    const before = buildProviderBotVerdicts(source, comments);
    expect(before.find((bot) => bot.id === 'coderabbit')).toMatchObject({ verdict: 'running', sourceId: request.anchor });
    expect(newestProviderBotSummary(source, comments, 'coderabbit')).toBe(report);
    expect(buildProviderBotVerdicts(source, comments)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});
