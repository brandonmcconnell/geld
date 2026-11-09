import { describe, expect, it } from 'vitest';
import type { GeldPrMeta, ReviewItem } from './model';
import { parseGeldPrMeta, truncateMeta } from './model';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewThread } from './provider-review';
import { buildProviderReviewItems, providerReviewUrl } from './provider-review';
import { createNativePublication, providerPublicationCandidate, readProviderPublication } from './native-publication';
import type { ProviderSourceCoverage } from './native-publication';
import { encodePayloadAttribute, parsePublishedSummaryBody, publishedSummaryFooter } from './summary-parse';
import { renderProviderSummary, renderSummary } from './summary-render';

const HEAD = 'a'.repeat(40);
const UUID = '12345678-1234-1234-1234-123456789abc';
const COMPLETE: ProviderSourceCoverage = { comments: 'complete', threads: 'complete' };
const DATE = '2026-11-01T12:00:00Z';

function fixture(provider: 'gitlab' | 'bitbucket' = 'gitlab'): ProviderReviewInput {
  const subject = { provider, origin: provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org', repository: provider === 'gitlab' ? 'group/subgroup/project' : 'workspace/project', id: '42', headSha: HEAD };
  const anchor = provider === 'gitlab' ? 'note_10' : 'comment-10';
  const comment: ProviderReviewComment = { id: '10', anchor, url: `${providerReviewUrl(subject)}#${anchor}`, author: { id: provider === 'gitlab' ? '8' : `{${UUID}}`, login: 'alice' }, body: 'Please guard the null response.', createdAt: DATE, updatedAt: DATE };
  return { subject, threads: [{ id: provider === 'gitlab' ? 'd'.repeat(40) : '10', anchor: provider === 'gitlab' ? `discussion_${'d'.repeat(40)}` : anchor, url: comment.url, path: 'src/cache.ts', line: 27, resolved: false, outdated: false, stateKnown: true, comments: [comment] }] };
}

function mapThread(input: ProviderReviewInput, change: (thread: ProviderReviewThread) => ProviderReviewThread): ProviderReviewInput { return { ...input, threads: input.threads.map(change) }; }

async function published(input: ProviderReviewInput, change: (meta: GeldPrMeta) => GeldPrMeta = (meta) => meta): Promise<{ readonly comment: ProviderReviewComment; readonly meta: GeldPrMeta }> {
  const items = buildProviderReviewItems(input);
  const meta = change({ v: 1, generatedAt: DATE, headSha: HEAD, producer: { kind: 'action', version: '1', ai: false }, items, bots: [], reviewers: [], fold: { comments: [], events: [] }, nativePublication: await createNativePublication(input, items) });
  const anchor = input.subject.provider === 'gitlab' ? 'note_99' : 'comment-99';
  return { meta, comment: { id: '99', anchor, url: `${providerReviewUrl(input.subject)}#${anchor}`, author: { id: input.subject.provider === 'gitlab' ? '7' : `{${UUID.toUpperCase()}}`, login: 'geld-ci' }, body: renderProviderSummary(meta, input.subject), createdAt: DATE, updatedAt: DATE } };
}

async function read(input: ProviderReviewInput, comment: ProviderReviewComment, trustedPublisherIds: readonly string[] = ['7'], sourceCoverage: ProviderSourceCoverage | undefined = COMPLETE) {
  return readProviderPublication({ input, comments: [comment], trustedPublisherIds, sourceCoverage });
}

describe('native published digest framing and trust', () => {
  it('reads the actual renderer output with explicit native publisher identity and preserves human words', async () => {
    const input = fixture();
    const { comment } = await published(input);
    const candidate = providerPublicationCandidate(input, comment);
    expect(candidate).toMatchObject({ generatedAt: DATE, comment: { author: { id: '7' } } });
    const value = await read(input, comment);
    expect(value.status).toBe('current');
    expect(value.items).toEqual(buildProviderReviewItems(input));
    expect(value.items[0]?.title).toBe('Please guard the null response.');
    expect([...value.matchedItemIds]).toEqual(value.items.map((item) => item.id));
    expect(value.comments).toEqual([]);
    expect(value.input.threads).toEqual(input.threads);
    expect(input.threads[0]?.comments).toHaveLength(1);
  });

  it('keeps untrusted summaries ordinary and distinguishes a same-name account', async () => {
    const input = fixture();
    const { comment } = await published(input);
    expect((await read(input, comment, [])).status).toBe('untrusted');
    const impostor = { ...comment, author: { id: '9', login: comment.author.login } };
    const value = await read(input, impostor);
    expect(value.status).toBe('untrusted');
    expect(value.input).toBe(input);
    expect(value.comments).toEqual([impostor]);
    expect(value.matchedItemIds.size).toBe(0);
    expect((await read(input, comment, [])).comments).toEqual([comment]);
  });

  it('allows an explicitly trusted human PAT account and normalizes UUID spelling only for trust lookup', async () => {
    const input = fixture('bitbucket');
    const { comment } = await published(input);
    expect(comment.author.automated).toBeUndefined();
    const value = await read(input, comment, [UUID]);
    expect(value.status).toBe('current');
    expect(value.candidate?.comment.author.id).toBe(`{${UUID.toUpperCase()}}`);
    expect(value.items[0]?.sources[0]?.authorId).toBe(`{${UUID}}`);
  });

  it('rejects a copied payload across full scope, head and footer URL boundaries', async () => {
    const input = fixture();
    const { comment, meta } = await published(input);
    for (const subject of [
      { ...input.subject, repository: 'other/subgroup/project' }, { ...input.subject, id: '43' },
      { ...input.subject, origin: 'https://gitlab.example' }, { ...input.subject, headSha: 'b'.repeat(40) },
      { ...input.subject, headSha: HEAD.slice(0, 7) },
    ]) expect(providerPublicationCandidate({ ...input, subject }, comment)).toBeNull();
    const otherFooter = renderProviderSummary(meta, { ...input.subject, id: '43' });
    expect(providerPublicationCandidate(input, { ...comment, body: otherFooter })).toBeNull();
    const value = await read({ ...input, subject: { ...input.subject, headSha: 'b'.repeat(40) } }, comment);
    expect(value.status).toBe('stale');
    expect(value.comments).toEqual([comment]);
  });

  it('rejects fabricated native candidate identity and unsafe permalinks before offering account trust', async () => {
    const input = fixture();
    const { comment } = await published(input);
    for (const forged of [
      { ...comment, author: { id: 'geld-ci', login: 'geld-ci' } }, { ...comment, id: '100' },
      { ...comment, anchor: 'discussion_r99' }, { ...comment, url: `${comment.url}x` },
      { ...comment, url: comment.url.replace('/42', '/43') }, { ...comment, url: comment.url.replace('gitlab.com', 'evil.example') },
      { ...comment, url: 'javascript:alert(1)' },
    ]) expect(providerPublicationCandidate(input, forged)).toBeNull();
  });

  it('never adopts a legacy/body/code carrier or malformed/trailing published frame', async () => {
    const input = fixture();
    const { comment, meta } = await published(input);
    const { nativePublication: _publication, ...legacy } = meta;
    for (const body of [
      `\`\`\`geld\n${JSON.stringify(meta)}\n\`\`\``, `Example: ${comment.body}`, `${comment.body}trailing`,
      comment.body.replace(/<span title='geld:[^']*'><\/span>/, ''),
      renderProviderSummary(legacy, input.subject),
    ]) expect(providerPublicationCandidate(input, { ...comment, body })).toBeNull();
    expect((await read(input, { ...comment, body: `${comment.body}trailing` })).status).toBe('invalid');
  });

  it('reads the real final frame when source suggestions quote payload footers and arbitrary backticks', async () => {
    const input = mapThread(fixture(), (thread) => ({ ...thread, comments: thread.comments.map((comment) => ({ ...comment, body: `Please guard this response.\n\n\`\`\`suggestion\n${publishedSummaryFooter('{}', 'https://gitlab.com/group/subgroup/project/-/merge_requests/42', 'Open merge request')}\n\`\`\`\`\`\n\`\`\`` })) }));
    const { comment } = await published(input);
    expect((await read(input, comment)).status).toBe('current');
  });

  it('rejects conflicting trusted publications but chooses equivalent actual native updates deterministically', async () => {
    const input = fixture();
    const first = await published(input);
    const second = await published(input, (meta) => ({ ...meta, items: meta.items.map((item) => ({ ...item, title: 'Different claimed title.' })) }));
    const newer = { ...second.comment, id: '100', anchor: 'note_100', url: `${providerReviewUrl(input.subject)}#note_100`, updatedAt: '2026-11-01T13:00:00Z' };
    const rejected = await readProviderPublication({ input, comments: [first.comment, newer], sourceCoverage: COMPLETE, trustedPublisherIds: ['7'] });
    expect(rejected.status).toBe('invalid');
    expect(rejected.comments).toHaveLength(2);
    const equivalent = { ...newer, body: renderProviderSummary({ ...first.meta, generatedAt: '2026-11-01T13:00:00Z' }, input.subject) };
    const accepted = await readProviderPublication({ input, comments: [first.comment, equivalent], sourceCoverage: COMPLETE, trustedPublisherIds: ['7'] });
    expect(accepted.status).toBe('current');
    expect(accepted.candidate?.comment.id).toBe('100');
  });
});

describe('native publication source currentness and fallback', () => {
  it('does not report a broken publication when ordinary native content has no machine frame', async () => {
    const input = { ...fixture(), subject: { ...fixture().subject, headSha: HEAD.slice(0, 7) } };
    const value = await readProviderPublication({ input, comments: [], trustedPublisherIds: ['7'] });
    expect(value.status).toBe('none');
    expect(value.issues).toEqual([]);
    expect(value.items).toEqual(buildProviderReviewItems(input));
  });

  it('invalidates same-head body edits, replies, resolution, outdated and location changes', async () => {
    const input = fixture();
    const { comment } = await published(input);
    const changed: ProviderReviewInput[] = [
      mapThread(input, (thread) => ({ ...thread, comments: thread.comments.map((source) => ({ ...source, body: 'A different concern.' })) })),
      mapThread(input, (thread) => ({ ...thread, resolved: true })),
      mapThread(input, (thread) => ({ ...thread, outdated: true })),
      mapThread(input, (thread) => ({ ...thread, line: 28 })),
      mapThread(input, (thread) => ({ ...thread, comments: [...thread.comments, { id: '11', anchor: 'note_11', url: `${providerReviewUrl(input.subject)}#note_11`, author: { id: '9', login: 'bob' }, body: 'This still needs attention.', createdAt: DATE }] })),
    ];
    for (const native of changed) {
      const value = await read(native, comment);
      expect(value.status).toBe('partial');
      expect(value.matchedItemIds.size).toBe(0);
      expect(value.items).toEqual(buildProviderReviewItems(native));
      expect(value.issues.join(' ')).not.toContain('ri_');
    }
  });

  it('requires known native state instead of treating absent facts as false', async () => {
    for (const stateKnown of [undefined, false]) {
      const input = mapThread(fixture(), (thread) => {
        const { stateKnown: _known, ...rest } = thread;
        return stateKnown === undefined ? rest : { ...rest, stateKnown };
      });
      const { comment, meta } = await published(input);
      expect(meta.nativePublication?.items).toEqual([]);
      const value = await read(input, comment);
      expect(value.status).toBe('partial');
      expect(value.matchedItemIds.size).toBe(0);
      expect(value.items).toEqual(buildProviderReviewItems(input));
    }
  });

  it('keeps newly arrived native items and missing published sources visible as partial fallback', async () => {
    const input = fixture();
    const { comment } = await published(input);
    const first = input.threads[0];
    const source = first?.comments[0];
    if (first === undefined || source === undefined) throw new Error('Missing native fixture.');
    const additional: ProviderReviewThread = { ...first, id: 'e'.repeat(40), anchor: `discussion_${'e'.repeat(40)}`, path: 'src/worker.ts', comments: [{ ...source, id: '11', anchor: 'note_11', url: source.url.replace('note_10', 'note_11'), body: 'Do not drop pending work.' }] };
    const value = await read({ ...input, threads: [...input.threads, additional] }, comment);
    expect(value.status).toBe('partial');
    expect(value.items).toHaveLength(2);
    expect(value.matchedItemIds.size).toBe(1);
    const missing = await read({ ...input, threads: [] }, comment);
    expect(missing.status).toBe('partial');
    expect(missing.matchedItemIds.size).toBe(0);
  });

  it('uses fetched native facts even when no DOM is mounted and requires independent comment/thread coverage', async () => {
    const input = fixture();
    const { comment } = await published(input);
    for (const coverage of [undefined, { comments: 'partial', threads: 'complete' }, { comments: 'complete', threads: 'unavailable' }] as const) {
      const value = await readProviderPublication({ input, comments: [comment], trustedPublisherIds: ['7'], sourceCoverage: coverage });
      expect(value.status).toBe('partial');
      expect(value.matchedItemIds.size).toBe(1);
    }
    expect((await read({ ...input, complete: false }, comment)).status).toBe('current');
  });

  it('excludes only the valid trusted machine note, retaining its human replies and native thread facts', async () => {
    const clean = fixture();
    const thread = clean.threads[0];
    if (thread === undefined) throw new Error('Missing native fixture.');
    const { comment } = await published(clean);
    const original = { ...clean, threads: [{ ...thread, comments: [comment, ...thread.comments] }] };
    const value = await read(original, comment);
    expect(value.status).toBe('current');
    expect(value.input.threads[0]?.comments).toEqual(thread.comments);
    expect(value.input.threads[0]).toMatchObject({ resolved: false, outdated: false, path: thread.path });
    expect(original.threads[0]?.comments).toHaveLength(2);
    expect((await read(original, comment, [])).input).toBe(original);
  });

  it('does not adopt publisher bot/reviewer fields, resolution claims or rewritten human wording', async () => {
    const input = fixture();
    const { comment } = await published(input, (meta) => ({ ...meta, bots: [{ id: 'coderabbit', login: 'coderabbitai[bot]', verdict: 'clean', reviewedSha: HEAD }], reviewers: [{ login: 'mallory', state: 'approved' }], items: meta.items.map((item) => ({ ...item, title: 'Publisher changed the human words.', status: 'resolved', rewritten: true, addressed: { verdict: 'yes', evidence: ['Publisher claim'] } })) }));
    const value = await read(input, comment);
    expect(value.status).toBe('current');
    expect(value.items).toEqual(buildProviderReviewItems(input));
    expect(value.items[0]).toMatchObject({ status: 'open', rewritten: false, title: 'Please guard the null response.' });
    expect(value.items[0]?.addressed).toBeUndefined();
  });

  it('rejects source URL/identity forgeries and never adopts native producer AI by its flag alone', async () => {
    const input = fixture();
    const forged = await published(input, (meta) => ({ ...meta, items: meta.items.map((item) => ({ ...item, sources: item.sources.map((source) => source.url === undefined ? source : { ...source, url: source.url.replace('/42', '/43') }) })) }));
    expect((await read(input, forged.comment)).matchedItemIds.size).toBe(0);
    const ai = await published(input, (meta) => ({ ...meta, producer: { ...meta.producer, ai: true } }));
    const value = await read(input, ai.comment);
    expect(value.status).toBe('invalid');
    expect(value.comments).toEqual([ai.comment]);
  });

  it('rejects repeated/conflicting native identities instead of choosing a body', async () => {
    const input = fixture();
    const { comment } = await published(input);
    const value = await readProviderPublication({ input, comments: [comment, { ...comment, body: `${comment.body}changed` }], trustedPublisherIds: ['7'], sourceCoverage: COMPLETE });
    expect(value.status).toBe('invalid');
  });
});

describe('native publication schema and truncation compatibility', () => {
  it('preserves the typed native block and rejects duplicate/mismatched provenance', async () => {
    const input = fixture();
    const { meta } = await published(input);
    expect(parseGeldPrMeta(meta)).toEqual({ ok: true, value: meta });
    const publication = meta.nativePublication;
    const entry = publication?.items[0];
    if (publication === undefined || entry === undefined) throw new Error('Missing native publication.');
    for (const nativePublication of [
      { ...publication, subject: { ...publication.subject, headSha: 'b'.repeat(40) } },
      { ...publication, items: [entry, entry] },
      { ...publication, items: [{ ...entry, itemId: 'not-retained' }] },
      { ...publication, items: [{ ...entry, sources: entry.sources.map((source) => ({ ...source, anchor: 'discussion_r10' })) }] },
    ]) expect(parseGeldPrMeta({ ...meta, nativePublication }).ok).toBe(false);
    expect(parseGeldPrMeta({ ...meta, items: [...meta.items, ...meta.items] }).ok).toBe(false);
    expect(parseGeldPrMeta({ ...meta, items: meta.items.map((item) => ({ ...item, sources: item.sources.map((source) => ({ ...source, origin: 'https://gitlab.example', url: source.url?.replace('gitlab.com', 'gitlab.example') })) })) }).ok).toBe(false);
  });

  it('budgets retained item hashes together with items, keeping the remaining contract valid', async () => {
    const input = fixture();
    const first = input.threads[0];
    const source = first?.comments[0];
    if (first === undefined || source === undefined) throw new Error('Missing fixture.');
    const expanded = { ...input, threads: Array.from({ length: 5 }, (_, index): ProviderReviewThread => ({ ...first, id: String(index + 1).repeat(40), path: `src/${index}.ts`, comments: [{ ...source, id: String(index + 10), anchor: `note_${index + 10}`, url: source.url.replace('note_10', `note_${index + 10}`), body: `Please retain the original ${'long words '.repeat(50)}${index}.` }] })) };
    const { meta } = await published(expanded);
    const truncated = truncateMeta(meta, 2700);
    expect(truncated.truncated).toBe(true);
    expect(truncated.items.length).toBeGreaterThan(0);
    expect(truncated.items.length).toBeLessThan(meta.items.length);
    expect(encodePayloadAttribute(JSON.stringify(truncated)).length - 'geld:'.length).toBeLessThanOrEqual(2700);
    expect(truncated.nativePublication?.items.map((entry) => entry.itemId)).toEqual(truncated.items.map((item) => item.id));
    expect(parseGeldPrMeta(truncated).ok).toBe(true);
    expect(parsePublishedSummaryBody(renderProviderSummary(truncated, expanded.subject)).ok).toBe(true);
    const none = truncateMeta(meta, 600);
    expect(none.items).toEqual([]);
    expect(none.nativePublication?.items).toEqual([]);
  });

  it('binds an empty publication to its full scope and preserves legacy GitHub defaults', async () => {
    const input = { ...fixture(), threads: [] };
    const { comment, meta } = await published(input);
    expect((await read(input, comment)).status).toBe('current');
    expect(providerPublicationCandidate({ ...input, subject: { ...input.subject, repository: 'different/project' } }, comment)).toBeNull();
    const { nativePublication: _native, ...github } = meta;
    expect(parseGeldPrMeta(github)).toEqual({ ok: true, value: github });
    expect(renderSummary(github)).not.toContain('nativePublication');
    expect(truncateMeta(github)).toBe(github);
    await expect(createNativePublication({ ...input, subject: { ...input.subject, provider: 'github' } }, [])).rejects.toThrow('native provider');
  });

  it('refuses to fingerprint fabricated items or non-native author identities', async () => {
    const input = fixture();
    const canonical = buildProviderReviewItems(input);
    const item = canonical[0];
    if (item === undefined) throw new Error('Missing canonical fixture.');
    const forged: ReviewItem = { ...item, id: 'invented' };
    await expect(createNativePublication(input, [forged])).rejects.toThrow('canonical native');
    const aliases = mapThread(input, (thread) => ({ ...thread, comments: thread.comments.map((comment) => ({ ...comment, author: { id: 'github-actions[bot]', login: 'geld-ci' } })) }));
    expect((await createNativePublication(aliases, buildProviderReviewItems(aliases))).items).toEqual([]);
  });
});
