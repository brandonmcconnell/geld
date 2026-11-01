import { DEFAULT_SETTINGS, withTrustedSummaryPublisher } from '@geld/core';
import type { ProviderPublicationRead, ProviderReviewInput, readProviderPublication } from '@geld/review';
import { ProviderPublishedReview } from './publication';

const input: ProviderReviewInput = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '42', headSha: 'a'.repeat(40) }, threads: [] };

function completed(value: ProviderReviewInput = input): ProviderPublicationRead {
  return { status: 'none', candidate: null, input: value, comments: [], items: [], issues: [], matchedItemIds: new Set() };
}

function pending() {
  let resolve: ((result: ProviderPublicationRead) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<ProviderPublicationRead>((success, failure) => { resolve = success; reject = failure; });
  return {
    promise,
    resolve(value: ProviderPublicationRead): void { if (resolve === undefined) throw new Error('Missing resolver'); resolve(value); },
    reject(): void { if (reject === undefined) throw new Error('Missing rejection'); reject(new Error('Unreadable publication')); },
  };
}

it('deduplicates identical source reads without preserving a result across a trust change', async () => {
  const deferred = pending();
  const read = vi.fn<typeof readProviderPublication>().mockReturnValueOnce(deferred.promise).mockResolvedValue(completed());
  const changed = vi.fn();
  const source = new ProviderPublishedReview(changed, read);
  const repository = { provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository };
  const trusted = { ...DEFAULT_SETTINGS, trustedSummaryPublishers: withTrustedSummaryPublisher([], repository, '77') };
  source.load(input, [], undefined, trusted);
  source.load(input, [], undefined, trusted);
  expect(read).toHaveBeenCalledOnce();
  deferred.resolve(completed());
  await vi.waitFor(() => expect(source.result).not.toBeNull());
  expect(changed).toHaveBeenCalledOnce();
  source.load(input, [], undefined, DEFAULT_SETTINGS);
  expect(source.result).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1]?.[0].trustedPublisherIds).toEqual([]);
});

it('discards an older head or source response after a newer read starts', async () => {
  const old = pending();
  const current = pending();
  const changed = vi.fn();
  const read = vi.fn<typeof readProviderPublication>().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const source = new ProviderPublishedReview(changed, read);
  source.load(input, [], undefined, DEFAULT_SETTINGS);
  const next = { ...input, subject: { ...input.subject, headSha: 'b'.repeat(40) } };
  source.load(next, [], { comments: 'complete', threads: 'complete' }, DEFAULT_SETTINGS);
  current.resolve(completed(next));
  await vi.waitFor(() => expect(source.result?.input.subject.headSha).toBe(next.subject.headSha));
  old.resolve(completed());
  await Promise.resolve();
  expect(source.result?.input.subject.headSha).toBe(next.subject.headSha);
  expect(changed).toHaveBeenCalledOnce();
});

it('keeps native fallback after failure and ignores reads that finish after teardown', async () => {
  const first = pending();
  const second = pending();
  const changed = vi.fn();
  const read = vi.fn<typeof readProviderPublication>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const source = new ProviderPublishedReview(changed, read);
  source.load(input, [], undefined, DEFAULT_SETTINGS);
  first.reject();
  await vi.waitFor(() => expect(source.error).toContain('Native review sources remain available'));
  expect(source.result).toBeNull();
  source.reset();
  source.load(input, [], undefined, DEFAULT_SETTINGS);
  source.reset();
  second.resolve(completed());
  await Promise.resolve();
  expect(source.result).toBeNull();
  expect(source.error).toBe('');
  expect(changed).toHaveBeenCalledOnce();
});
