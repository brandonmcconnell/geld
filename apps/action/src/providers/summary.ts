import { createNativePublication, buildProviderReviewItems, hasPublishedSummaryPrefix, META_VERSION, parseGeldPrMeta, parsePublishedSummaryBody, renderProviderSummary, truncateMeta } from '@geld/review';
import type { GeldPrMeta } from '@geld/review';
import { BitbucketCiAdapter } from './bitbucket';
import { ProviderCiError } from './config';
import type { ProviderCiConfig } from './config';
import { GitLabCiAdapter } from './gitlab';
import { ProviderHttp } from './http';
import type { OwnedComment, ProviderCiAdapter } from './types';

const VERSION = '0.1.0';
const MAX_SUMMARY_BYTES = 30_000;

export function findOwnedSummary(comments: readonly OwnedComment[], owner: string): OwnedComment | null {
  return comments.find((comment) => comment.authorId === owner && hasPublishedSummaryPrefix(comment.body)) ?? null;
}

function validatedMeta(value: GeldPrMeta): GeldPrMeta {
  const parsed = parseGeldPrMeta(value);
  if (!parsed.ok) throw new ProviderCiError('The generated review summary did not pass validation.');
  return parsed.value;
}

function checksText(metaChecks: readonly { readonly name: string; readonly status: string; readonly conclusion: string | null }[]): readonly string[] {
  if (metaChecks.length === 0) return [];
  const counts = { passed: 0, failed: 0, running: 0, other: 0 };
  for (const check of metaChecks) {
    if (check.status !== 'completed') counts.running += 1;
    else if (check.conclusion === 'success') counts.passed += 1;
    else if (check.conclusion === 'failure') counts.failed += 1;
    else counts.other += 1;
  }
  return [`CI checks: ${counts.passed} passed, ${counts.failed} failed, ${counts.running} running, ${counts.other} other`];
}

export async function produceProviderSummary(adapter: ProviderCiAdapter, now = new Date().toISOString()): Promise<'created' | 'updated' | 'unchanged'> {
  const owner = await adapter.identity();
  if (owner.trim() === '') throw new ProviderCiError('The provider did not verify the token owner.');
  const review = await adapter.load();
  const existing = findOwnedSummary(review.comments, owner);
  const input = existing === null ? review.input : {
    ...review.input,
    threads: review.input.threads.map((thread) => ({ ...thread, comments: thread.comments.filter((comment) => comment.id !== existing.id || comment.author.id !== owner) })).filter((thread) => thread.comments.length > 0),
  };
  const items = buildProviderReviewItems(input);
  let meta = validatedMeta({
    v: META_VERSION, generatedAt: now, headSha: review.input.subject.headSha,
    producer: { kind: 'action', version: VERSION, ai: false }, items, bots: [],
    reviewers: (review.input.reviewers ?? []).filter((reviewer) => reviewer.state !== 'pending' || reviewer.reviewRequest === undefined || reviewer.reviewRequest === 'pending').map((reviewer) => ({ login: reviewer.author.login, state: reviewer.state })),
    fold: { comments: [], events: [] },
    nativePublication: await createNativePublication(input, items),
  });
  meta = validatedMeta(truncateMeta(meta, 14_000));
  if (existing !== null) {
    const previous = parsePublishedSummaryBody(existing.body);
    if (previous.ok && JSON.stringify({ ...previous.value, generatedAt: '' }) === JSON.stringify({ ...meta, generatedAt: '' })) meta = { ...meta, generatedAt: previous.value.generatedAt };
  }
  const supplemental = [...review.notes, ...checksText(review.input.checks ?? [])];
  const body = renderProviderSummary(meta, review.input.subject, { notes: supplemental });
  if (Buffer.byteLength(body, 'utf8') > MAX_SUMMARY_BYTES) throw new ProviderCiError('The review summary exceeds the provider comment budget.');
  if (existing?.body === body) return 'unchanged';
  if (await adapter.head() !== meta.headSha) throw new ProviderCiError('The review head changed before the summary could be written.');
  await adapter.upsert(existing?.id ?? null, body);
  return existing === null ? 'created' : 'updated';
}

export async function runProviderSummary(config: ProviderCiConfig, fetcher: typeof fetch = fetch, now?: string): Promise<'created' | 'updated' | 'unchanged'> {
  const http = new ProviderHttp(config, fetcher);
  const adapter = config.provider === 'gitlab' ? new GitLabCiAdapter(http) : new BitbucketCiAdapter(http);
  return produceProviderSummary(adapter, now);
}
