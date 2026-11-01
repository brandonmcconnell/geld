import { describe, expect, it } from 'vitest';
import { isBotOnly } from './cluster';
import { isSourceAnchor, parseGeldPrMeta } from './model';
import type { GeldPrMeta } from './model';
import { buildProviderReviewItems, isProviderSourceAnchor, providerReviewKey, providerReviewUrl, sourceLink } from './provider-review';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject, ProviderReviewThread } from './provider-review';
import { renderProviderSummary, renderSummary } from './summary-render';
import { parseSummaryBody } from './summary-parse';

const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/project', id: '42', headSha: 'a'.repeat(40) };

function comment(id: string, overrides: Partial<ProviderReviewComment> = {}): ProviderReviewComment {
  return {
    id,
    anchor: `note_${id}`,
    url: `https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_${id}`,
    author: { id: 'user-1', login: 'alice' },
    body: 'Check for null before reading the response.',
    createdAt: '2026-11-01T12:00:00Z',
    ...overrides,
  };
}

function thread(comments: readonly ProviderReviewComment[], overrides: Partial<ProviderReviewThread> = {}): ProviderReviewThread {
  return {
    id: 'd'.repeat(40),
    anchor: `discussion_${'d'.repeat(40)}`,
    url: `https://gitlab.com/group/subgroup/project/-/merge_requests/42#discussion_${'d'.repeat(40)}`,
    path: 'src/cache.ts',
    line: 20,
    resolved: false,
    outdated: false,
    comments,
    ...overrides,
  };
}

function input(threads: readonly ProviderReviewThread[]): ProviderReviewInput {
  return { subject, threads };
}

describe('provider review normalization', () => {
  it('clusters mixed authors with native provenance and keeps the human concern', () => {
    const first = thread([comment('1', { author: { id: 'bot-1', login: 'review-agent', automated: true }, body: 'Null response can crash the worker.' })], { resolved: true });
    const second = thread([comment('2', { body: 'Please check for null before reading this field.' }), comment('3', { author: { id: 'user-2', login: 'bob' }, body: 'This is still needed after the retry.' })], { id: 'e'.repeat(40), anchor: `discussion_${'e'.repeat(40)}`, line: 22, outdated: true });
    const items = buildProviderReviewItems({ ...input([first, second]), bots: [{ id: 'verified-reviewer', authorId: 'bot-1' }] });
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Please check for null before reading this field.');
    expect(items[0]?.status).toBe('outdated');
    expect(items[0]?.sources.map((source) => [source.anchor, source.sourceId, source.authorId, source.bot])).toEqual([
      ['note_1', '1', 'bot-1', 'verified-reviewer'],
      ['note_2', '2', 'user-1', undefined],
      ['note_3', '3', 'user-2', undefined],
    ]);
    const source = items[0]?.sources[0];
    expect(source).toMatchObject({ provider: 'gitlab', origin: 'https://gitlab.com', url: first.comments[0]?.url });
    expect(source === undefined ? null : sourceLink(source, subject)).toBe(first.comments[0]?.url);
    expect(items.some(isBotOnly)).toBe(false);
  });

  it('does not turn outdated into resolved and requires every merged concern resolved', () => {
    const resolved = thread([comment('1')], { resolved: true, outdated: true });
    expect(buildProviderReviewItems(input([resolved]))[0]?.status).toBe('resolved');
    expect(buildProviderReviewItems(input([thread([comment('1')], { outdated: true })]))[0]?.status).toBe('outdated');
    const open = thread([comment('2')], { id: 'e'.repeat(40), anchor: `discussion_${'e'.repeat(40)}` });
    expect(buildProviderReviewItems(input([resolved, open]))[0]?.status).toBe('outdated');
  });

  it('binds bots to verified native account ids without inheriting GitHub login aliases', () => {
    const unknown = thread([comment('1', { author: { id: 'unknown', login: 'cursor[bot]', automated: true } })]);
    const impostor = thread([comment('2', { author: { id: 'other-user', login: 'review-agent' } })], { path: 'other.ts' });
    const known = thread([comment('3', { author: { id: 'verified-id', login: 'review-agent' } })], { path: 'third.ts' });
    const items = buildProviderReviewItems({ ...input([unknown, impostor, known]), bots: [{ id: 'provider-reviewer', authorId: 'verified-id' }] });
    expect(items.map((item) => item.sources[0]?.bot)).toEqual([undefined, undefined, 'provider-reviewer']);
    expect(items.map(isBotOnly)).toEqual([true, false, true]);
    const humanWithAlias = thread([comment('4', { author: { id: 'a-person', login: 'cursor[bot]' } })]);
    expect(buildProviderReviewItems(input([humanWithAlias])).some(isBotOnly)).toBe(false);
  });

  it('keeps unknown commands as findings and filters only explicitly registered triggers', () => {
    const request = thread([comment('1', { body: '@review-agent review' })]);
    expect(buildProviderReviewItems(input([request]))).toHaveLength(1);
    const registered = { ...input([request]), bots: [{ id: 'reviewer', authorId: 'bot-1', triggers: ['@review-agent review'] }] };
    expect(buildProviderReviewItems(registered)).toEqual([]);
    expect(buildProviderReviewItems({ ...registered, threads: [thread([comment('2', { body: '@review-agent review must preserve this field.' })])] })).toHaveLength(1);
  });

  it('keeps source identities stable over pushes and separates repositories and origins', () => {
    const original = buildProviderReviewItems(input([thread([comment('1')])]))[0]?.id;
    expect(buildProviderReviewItems({ subject: { ...subject, headSha: 'b'.repeat(40) }, threads: [thread([comment('1')])] })[0]?.id).toBe(original);
    expect(providerReviewKey({ ...subject, headSha: 'b'.repeat(40) })).toBe(providerReviewKey(subject));
    expect(providerReviewKey({ ...subject, repository: 'another/project' })).not.toBe(providerReviewKey(subject));
    expect(providerReviewKey({ ...subject, origin: 'https://gitlab.example.com' })).not.toBe(providerReviewKey(subject));
    const movedUrl = 'https://gitlab.com/group/subgroup/project/-/merge_requests/43';
    expect(buildProviderReviewItems({ subject: { ...subject, id: '43' }, threads: [thread([comment('1', { url: `${movedUrl}#note_1` })], { url: `${movedUrl}#discussion_${'d'.repeat(40)}` })] })[0]?.id).not.toBe(original);
    expect(() => buildProviderReviewItems({ subject: { ...subject, id: '43' }, threads: [thread([comment('1')])] })).toThrow('Expected a native source');
  });

  it('uses Bitbucket comment anchors without manufacturing GitHub anchors', () => {
    const bitbucket: ProviderReviewSubject = { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/project', id: '8', headSha: 'c'.repeat(40) };
    const note = comment('11', { anchor: 'comment-11', url: 'https://bitbucket.org/workspace/project/pull-requests/8#comment-11' });
    const items = buildProviderReviewItems({ subject: bitbucket, threads: [thread([note], { anchor: 'comment-11', url: note.url })] });
    expect(items[0]?.sources[0]?.anchor).toBe('comment-11');
    expect(items[0]?.sources[0]?.provider).toBe('bitbucket');
    expect(providerReviewUrl(bitbucket)).toBe('https://bitbucket.org/workspace/project/pull-requests/8');
  });

  it('does not fabricate items for empty discussions and rejects reused source anchors', () => {
    expect(buildProviderReviewItems(input([thread([])]))).toEqual([]);
    expect(() => buildProviderReviewItems(input([thread([comment('1'), comment('1')])]))).toThrow(/exactly one/);
  });
});

describe('provider anchors and links', () => {
  it('accepts actual native fragments and an explicit provider-qualified fallback', () => {
    for (const anchor of ['note_42', `discussion_${'a'.repeat(40)}`, 'comment-42', 'comment_42', 'geld-bitbucket-thread-stable_id']) expect(isSourceAnchor(anchor)).toBe(true);
    expect(isProviderSourceAnchor('gitlab', 'note_42')).toBe(true);
    expect(isProviderSourceAnchor('bitbucket', 'comment-42')).toBe(true);
    expect(isProviderSourceAnchor('gitlab', 'discussion_r42')).toBe(false);
    expect(isProviderSourceAnchor('bitbucket', 'geld-gitlab-comment-42')).toBe(false);
    for (const anchor of ['note_42#fragment', 'note_42\n', 'discussion_xxx', 'comment-42 onclick=alert(1)', 'geld-bitbucket-thread-../42']) expect(isSourceAnchor(anchor)).toBe(false);
  });

  it('rejects unsafe schemes, credential URLs and cross-origin source links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://gitlab.com.evil.example/note_1', 'https://gitlab.com@evil.example/note_1', 'https://name:secret@gitlab.com/note_1', '//gitlab.com/note_1']) {
      expect(() => buildProviderReviewItems(input([thread([comment('1', { url })])]))).toThrow(/provider origin/);
      expect(sourceLink({ anchor: 'note_1', kind: 'thread', author: 'alice', url }, subject)).toBeNull();
    }
    expect(sourceLink({ anchor: 'note_1', kind: 'thread', author: 'alice', provider: 'bitbucket' }, subject)).toBeNull();
  });

  it('encodes nested repository names and rejects malformed review identity', () => {
    expect(providerReviewUrl(subject)).toBe('https://gitlab.com/group/subgroup/project/-/merge_requests/42');
    expect(providerReviewUrl({ ...subject, repository: 'group/a project' })).toBe('https://gitlab.com/group/a%20project/-/merge_requests/42');
    for (const invalid of [{ ...subject, origin: 'https://gitlab.com/path' }, { ...subject, repository: 'group/../project' }, { ...subject, id: '42/notes' }]) expect(() => providerReviewKey(invalid)).toThrow(TypeError);
  });

  it('round trips native source provenance in v1 while keeping GitHub source defaults intact', () => {
    const items = buildProviderReviewItems(input([thread([comment('1')])]));
    const meta: GeldPrMeta = { v: 1, generatedAt: '2026-11-01T12:00:00Z', headSha: subject.headSha, producer: { kind: 'crawler', version: '1', ai: false }, items, bots: [], reviewers: [], fold: { comments: [], events: [] } };
    const parsed = parseGeldPrMeta(meta);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.items).toEqual(items);
    const githubSource = { anchor: 'discussion_r42', kind: 'thread', author: 'alice' };
    const github = parseGeldPrMeta({ ...meta, items: [{ ...items[0], sources: [githubSource] }] });
    expect(github.ok).toBe(true);
    if (github.ok) expect(github.value.items[0]?.sources[0]).toEqual(githubSource);
    const forged = parseGeldPrMeta({ ...meta, items: [{ ...items[0], sources: [{ ...githubSource, origin: 'https://gitlab.com', url: 'https://evil.example/attack' }] }] });
    expect(forged.ok).toBe(false);
    expect(parseGeldPrMeta({ ...meta, items: [{ ...items[0], sources: [{ ...githubSource, provider: 'gitlab', origin: 'https://gitlab.com' }] }] }).ok).toBe(false);
    expect(parseGeldPrMeta({ ...meta, items: [{ ...items[0], sources: [{ ...githubSource, anchor: 'note_42' }] }] }).ok).toBe(false);
  });
});

describe('provider summary comments', () => {
  function meta(): GeldPrMeta {
    return { v: 1, generatedAt: '2026-11-01T12:00:00Z', headSha: subject.headSha, producer: { kind: 'crawler', version: '1', ai: false }, items: buildProviderReviewItems(input([thread([comment('1')])])), bots: [], reviewers: [], fold: { comments: [], events: [] }, truncated: true };
  }

  it('renders native GitLab source links and MR wording with the same parseable payload', () => {
    const value = meta();
    const rendered = renderProviderSummary(value, subject);
    expect(rendered).toContain('[source](https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_1)');
    expect(rendered).toContain('Open merge request');
    expect(rendered).toContain('open the merge request with Geld');
    expect(rendered).not.toContain('discussion_r');
    expect(rendered).not.toContain('github.com');
    const parsed = parseSummaryBody(rendered);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.items).toEqual(value.items);
  });

  it('uses safe URLs as Markdown destinations and refuses foreign source origins', () => {
    const value = meta();
    const first = value.items[0];
    if (first === undefined) throw new Error('Expected a review item.');
    const source = first.sources[0];
    if (source === undefined) throw new Error('Expected a review source.');
    const poisoned = { ...value, items: [{ ...first, sources: [{ ...source, url: 'https://evil.example/payload' }] }] };
    expect(renderProviderSummary(poisoned, subject)).toContain('source unavailable');
    const special = { ...value, items: [{ ...first, sources: [{ ...source, url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42?view=path(a) b#note_1' }] }] };
    expect(renderProviderSummary(special, subject)).toContain('[source](https://gitlab.com/group/subgroup/project/-/merge_requests/42?view=path%28a%29%20b#note_1)');
    expect(sourceLink({ ...source, url: 'https://gitlab.com/another/project/-/merge_requests/42#note_1' }, subject)).toBeNull();
    expect(sourceLink({ ...source, url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_2' }, subject)).toBeNull();
  });

  it('preserves GitHub rendering and keeps the new entry point native for Bitbucket', () => {
    const value = { ...meta(), items: [] };
    expect(renderSummary(value, { owner: 'owner', repo: 'repo', number: 42 })).toContain('Open in Geld');
    expect(renderSummary(value, { owner: 'owner', repo: 'repo', number: 42 })).toContain('open the pull request with Geld');
    const bitbucket: ProviderReviewSubject = { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repo' };
    const rendered = renderProviderSummary(value, bitbucket);
    expect(rendered).toContain('href="https://bitbucket.org/workspace/repo/pull-requests/42">Open pull request</a>');
    expect(rendered).not.toContain('Open in Geld');
  });
});
