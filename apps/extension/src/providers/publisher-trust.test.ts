import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { GeldSettings, RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { createProviderPublisherTrust } from './publisher-trust';
import type { ProviderPage, ProviderReviewPage, ProviderReviewSnapshot } from './types';

const repository: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/subgroup/project' };
const url = `${repository.origin}/${repository.path}/-/merge_requests/42`;
const sha = 'a'.repeat(40);
const page: ProviderReviewPage = { provider: 'gitlab', repository, number: '42', kind: 'overview', url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, headSha: sha, version: sha };
const subject = { provider: repository.provider, origin: repository.origin, repository: repository.path, id: '42', headSha: sha };
const comment: ProviderReviewComment = { id: '123', anchor: 'note_123', url: `${url}#note_123`, author: { id: '12345', login: 'Actual human PAT owner' }, body: 'Reader-validated native publication frame', createdAt: '2026-11-01T12:00:00Z' };
function source(comments: readonly ProviderReviewComment[] = [comment], input: ProviderReviewInput = { subject, threads: [] }): ProviderReviewSnapshot {
  return { input, comments, events: [], complete: false, unavailable: [{ area: 'checks', reason: 'unavailable' }], approvalsRequired: null, approvalsLeft: null, actions: [] };
}
function fixture(snapshot = source()) {
  let active: ProviderPage | null = page;
  let observed: ProviderReviewSnapshot | null = snapshot;
  let retired = false;
  let current = DEFAULT_SETTINGS;
  let wait: Promise<void> = Promise.resolve();
  let queue: Promise<void> = Promise.resolve();
  const updated = vi.fn<(settings: GeldSettings) => void>();
  const eligible = vi.fn((_input: ProviderReviewInput, _comment: ProviderReviewComment) => true);
  const update = (edit: (settings: GeldSettings) => Partial<GeldSettings>): Promise<GeldSettings> => {
    const next = queue.then(async () => { await wait;current = { ...current, ...edit(current) };return current; });
    queue = next.then(() => undefined, () => undefined);
    return next;
  };
  const save = createProviderPublisherTrust({ page: () => active, snapshot: () => observed, retired: () => retired, updated, eligible, settings: { update } });
  return { save, eligible, updated, update, settings: () => current, pause: (promise: Promise<void>) => { wait = promise; }, navigate: (next: ProviderPage | null) => { active = next; }, snapshot: (next: ProviderReviewSnapshot | null) => { observed = next; }, retire: () => { retired = true; } };
}
function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe('explicit native summary publisher trust', () => {
  it('allows an observed human PAT publisher independently of bot trust or unrelated unavailable data', async () => {
    const f = fixture();
    await f.update(() => ({ showBadge: false, trustedReviewAccounts: ['gitlab.com/group/subgroup/project coderabbit 99999'] }));
    await f.save(source().input, comment);
    expect(f.settings().trustedSummaryPublishers).toEqual(['gitlab.com/group/subgroup/project 12345']);
    expect(f.settings().trustedReviewAccounts).toEqual(['gitlab.com/group/subgroup/project coderabbit 99999']);
    expect(f.settings().showBadge).toBe(false);
    expect(f.eligible).toHaveBeenCalledTimes(2);
    expect(f.updated).toHaveBeenCalledWith(f.settings());
  });
  it('preserves other publishers when independent explicit saves queue together', async () => {
    const other = { ...comment, id: '124', anchor: 'note_124', url: `${url}#note_124`, author: { id: '67890', login: 'Another publisher' } };
    const snapshot = source([comment, other]);const f = fixture(snapshot);
    await Promise.all([f.save(snapshot.input, comment), f.save(snapshot.input, other)]);
    expect(f.settings().trustedSummaryPublishers).toEqual(['gitlab.com/group/subgroup/project 12345', 'gitlab.com/group/subgroup/project 67890']);
  });
  it('uses a fetched threaded publication without requiring mounted DOM', async () => {
    const input: ProviderReviewInput = { subject, threads: [{ id: 'native-discussion', anchor: 'discussion_' + 'a'.repeat(40), url: comment.url, resolved: false, outdated: false, comments: [comment] }] };
    const f = fixture(source([], input));await f.save(input, comment);
    expect(f.settings().trustedSummaryPublishers).toHaveLength(1);
  });
  it('never grants trust from a frame marker when the strict candidate guard rejects it', async () => {
    const f = fixture();f.eligible.mockReturnValue(false);
    await expect(f.save(source().input, comment)).rejects.toThrow('unchanged native Geld summary');
    expect(f.settings().trustedSummaryPublishers).toEqual([]);
    expect(f.updated).not.toHaveBeenCalled();
  });
  it.each(['navigation', 'head', 'source', 'eligibility', 'retired'] as const)('rejects a queued save after %s changes', async (kind) => {
    const f = fixture();const gate = deferred();f.pause(gate.promise);
    const save = f.save(source().input, comment);
    if (kind === 'navigation') f.navigate({ ...page, number: '43' });
    else if (kind === 'head') f.snapshot(source([comment], { subject: { ...subject, headSha: 'b'.repeat(40) }, threads: [] }));
    else if (kind === 'source') f.snapshot(source([{ ...comment, body: 'A replaced but possibly still well-framed body', updatedAt: '2026-11-01T13:00:00Z' }]));
    else if (kind === 'eligibility') f.eligible.mockReturnValue(false);
    else f.retire();
    gate.resolve();await expect(save).rejects.toThrow();
    expect(f.settings().trustedSummaryPublishers).toEqual([]);expect(f.updated).not.toHaveBeenCalled();
  });
  it('rejects copied URLs, mismatched source IDs and account replacements even if the callback accepts a frame', async () => {
    const variants: readonly ProviderReviewComment[] = [
      { ...comment, url: `${url.replace('/42', '/43')}#note_123` },
      { ...comment, anchor: 'note_999', url: `${url}#note_999` },
      { ...comment, url: 'https://evil.example/#note_123' },
      { ...comment, author: { id: 'nickname', login: 'Same name' } },
    ];
    for (const candidate of variants) {
      const f = fixture(source([candidate]));await expect(f.save(source().input, candidate)).rejects.toThrow();expect(f.settings().trustedSummaryPublishers).toEqual([]);
    }
    const f = fixture(source([{ ...comment, author: { ...comment.author, id: '99999' } }]));
    await expect(f.save(source().input, comment)).rejects.toThrow();
  });
  it('canonicalizes a native Bitbucket UUID but never changes its observed account or adds bot trust', async () => {
    const bbRepository: RepositoryIdentity = { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'workspace/repo' };
    const bbUrl = `${bbRepository.origin}/${bbRepository.path}/pull-requests/42`;
    const bbComment = { ...comment, anchor: 'comment-123', url: `${bbUrl}#comment-123`, author: { id: '{AABBCCDD-1234-5678-ABCD-AABBCCDDEEFF}', login: 'Native publisher' } };
    const bbInput = { subject: { ...subject, provider: bbRepository.provider, origin: bbRepository.origin, repository: bbRepository.path }, threads: [] };
    const f = fixture(source([bbComment], bbInput));f.navigate({ ...page, provider: 'bitbucket', repository: bbRepository, url: bbUrl, diffPageUrl: `${bbUrl}/diff`, diffUrl: `${bbUrl}/diff` });
    await f.save(bbInput, bbComment);
    expect(f.settings().trustedSummaryPublishers).toEqual(['bitbucket.org/workspace/repo aabbccdd-1234-5678-abcd-aabbccddeeff']);
    expect(f.settings().trustedReviewAccounts).toEqual([]);
    expect(f.eligible.mock.calls[0]?.[1].author.id).toBe(bbComment.author.id);
  });
});
