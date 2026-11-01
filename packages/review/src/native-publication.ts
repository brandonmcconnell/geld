import type { GeldPrMeta, NativePublication, ReviewItem, ReviewSource } from './model';
import { nativePublicationSchema } from './model';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewThread } from './provider-review';
import { buildProviderReviewItems, providerReviewUrl, sourceLink } from './provider-review';
import { hasPublishedSummaryPrefix, parsePublishedSummaryFrame } from './summary-parse';

export interface ProviderSourceCoverage {
  readonly comments: 'complete' | 'partial' | 'unavailable';
  readonly threads: 'complete' | 'partial' | 'unavailable';
}

export interface ProviderPublicationCandidate {
  readonly comment: ProviderReviewComment;
  readonly meta: GeldPrMeta;
  readonly publication: NativePublication;
  readonly generatedAt: string;
}

export interface ProviderPublicationRead {
  readonly status: 'none' | 'untrusted' | 'invalid' | 'stale' | 'partial' | 'current';
  readonly candidate: ProviderPublicationCandidate | null;
  readonly input: ProviderReviewInput;
  readonly comments: readonly ProviderReviewComment[];
  readonly items: readonly ReviewItem[];
  readonly issues: readonly string[];
  readonly matchedItemIds: ReadonlySet<string>;
}

const MAX_BODY_BYTES = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accountId(provider: string, value: string): string | null {
  if (provider === 'gitlab') return /^[1-9]\d{0,19}$/.test(value) ? value : null;
  if (provider !== 'bitbucket') return null;
  const uuid = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value;
  return UUID.test(uuid) ? uuid.toLowerCase() : null;
}

function nativeSubject(input: ProviderReviewInput): NativePublication['subject'] {
  const { subject } = input;
  if (subject.provider === 'github') throw new TypeError('Expected a native provider publication.');
  const parsed = nativePublicationSchema.shape.subject.safeParse({ ...subject, headSha: subject.headSha.toLowerCase() });
  if (!parsed.success) throw new TypeError('Expected a full native publication subject and head.');
  if (subject.provider === 'bitbucket' && subject.repository.split('/').length !== 2) throw new TypeError('Expected a Bitbucket workspace and repository.');
  providerReviewUrl(subject);
  return parsed.data;
}

function sameScope(left: NativePublication['subject'], right: NativePublication['subject']): boolean {
  return left.provider === right.provider && left.origin === right.origin && left.repository === right.repository && left.id === right.id;
}

function sourceVector(item: ReviewItem): string {
  return JSON.stringify(item.sources.map((source) => [source.anchor, source.kind, source.sourceId, source.authorId]));
}

function checkedComment(comment: ProviderReviewComment, input: ProviderReviewInput): readonly unknown[] {
  const id = accountId(input.subject.provider, comment.author.id);
  const native = input.subject.provider === 'gitlab' ? comment.anchor === `note_${comment.id}` : comment.anchor === `comment-${comment.id}` || comment.anchor === `comment_${comment.id}`;
  const href = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
  const created = Date.parse(comment.createdAt);
  const updated = comment.updatedAt === undefined ? null : Date.parse(comment.updatedAt);
  if (!/^[1-9]\d{0,19}$/.test(comment.id) || id === null || !native || href === null || comment.author.login.trim() === '' || !Number.isFinite(created) || updated !== null && !Number.isFinite(updated)) throw new TypeError('Expected an actual native comment identity and source link.');
  // Presentation routes can differ between the API and web discussion sources.
  return [comment.id, comment.anchor, id, `${providerReviewUrl(input.subject)}#${comment.anchor}`, comment.body, created, updated];
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceIndex(input: ProviderReviewInput): ReadonlyMap<string, { readonly comment: ProviderReviewComment; readonly thread: ProviderReviewThread }> {
  const index = new Map<string, { readonly comment: ProviderReviewComment; readonly thread: ProviderReviewThread }>();
  const ids = new Set<string>();
  const threads = new Set<string>();
  for (const thread of input.threads) {
    if (threads.has(thread.id)) throw new TypeError('Native publication threads must be unique.');
    threads.add(thread.id);
    for (const comment of thread.comments) {
      if (index.has(comment.anchor) || ids.has(comment.id)) throw new TypeError('Native publication sources must be unique.');
      index.set(comment.anchor, { comment, thread });
      ids.add(comment.id);
    }
  }
  return index;
}

function availableComment(comment: ProviderReviewComment, input: ProviderReviewInput): readonly unknown[] | null {
  try { return checkedComment(comment, input); } catch { return null; }
}

async function itemFingerprint(input: ProviderReviewInput, item: ReviewItem, index: ReturnType<typeof sourceIndex>): Promise<NativePublication['items'][number] | null> {
  const facts: unknown[][] = [];
  const sourceFacts: unknown[][] = [];
  const threads = new Map<string, ProviderReviewThread>();
  const sources: Array<NativePublication['items'][number]['sources'][number]> = [];
  for (const source of item.sources) {
    const found = index.get(source.anchor);
    if (found === undefined || found.thread.stateKnown !== true || typeof found.thread.resolved !== 'boolean' || typeof found.thread.outdated !== 'boolean' || source.sourceId !== found.comment.id || source.authorId !== found.comment.author.id
      || source.provider !== input.subject.provider || source.origin !== input.subject.origin || source.url === undefined || sourceLink(source, input.subject) === null) return null;
    if (source.kind !== 'thread') return null;
    const fact = availableComment(found.comment, input);
    if (fact === null) return null;
    sourceFacts.push([...fact]);
    threads.set(found.thread.id, found.thread);
    sources.push({ id: found.comment.id, anchor: found.comment.anchor, authorId: found.comment.author.id, fingerprint: await digest(fact) });
  }
  if (sources.length === 0) return null;
  for (const thread of threads.values()) {
    const comments = thread.comments.map((comment) => availableComment(comment, input));
    if (comments.some((comment) => comment === null)) return null;
    facts.push([thread.id, thread.path ?? null, thread.line ?? null, thread.resolved, thread.outdated, comments]);
  }
  return { itemId: item.id, sources, fingerprint: await digest([nativeSubject(input), item.path ?? null, item.line ?? null, sourceFacts, facts]) };
}

/** Unknown native thread states are deliberately absent from the publishable subset. */
export async function createNativePublication(input: ProviderReviewInput, items: readonly ReviewItem[]): Promise<NativePublication> {
  const subject = nativeSubject(input);
  const canonical = new Map(buildProviderReviewItems(input).map((item) => [item.id, item]));
  const index = sourceIndex(input);
  const entries: Array<NativePublication['items'][number]> = [];
  for (const item of items) {
    const original = canonical.get(item.id);
    if (original === undefined || sourceVector(original) !== sourceVector(item)) throw new TypeError('Publication items must have canonical native sources.');
    const entry = await itemFingerprint(input, original, index);
    if (entry !== null) entries.push(entry);
  }
  return nativePublicationSchema.parse({ v: 1, subject, items: entries });
}

/** The caller must obtain this comment from its native snapshot; this grants no account trust. */
export function providerPublicationCandidate(input: ProviderReviewInput, comment: ProviderReviewComment): ProviderPublicationCandidate | null {
  try {
    if (comment.body.length > MAX_BODY_BYTES || new TextEncoder().encode(comment.body).byteLength > MAX_BODY_BYTES) return null;
    const subject = nativeSubject(input);
    checkedComment(comment, input);
    const parsed = parsePublishedSummaryFrame(comment.body);
    if (!parsed.ok) return null;
    const { meta, href, label } = parsed.value;
    const publication = meta.nativePublication;
    if (publication === undefined || !sameScope(publication.subject, subject) || publication.subject.headSha !== subject.headSha || meta.headSha !== subject.headSha
      || href !== providerReviewUrl(input.subject) || label !== (subject.provider === 'gitlab' ? 'Open merge request' : 'Open pull request')) return null;
    return { comment, meta, publication, generatedAt: meta.generatedAt };
  } catch {
    return null;
  }
}

function withoutSummary(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], candidate: ProviderPublicationCandidate): { readonly input: ProviderReviewInput; readonly comments: readonly ProviderReviewComment[] } {
  const keep = (comment: ProviderReviewComment): boolean => comment.id !== candidate.comment.id || comment.author.id !== candidate.comment.author.id;
  return { input: { ...input, threads: input.threads.map((thread) => ({ ...thread, comments: thread.comments.filter(keep) })).filter((thread) => thread.comments.length > 0) }, comments: comments.filter(keep) };
}

function sourceMatches(source: ReviewSource, comment: ProviderReviewComment, input: ProviderReviewInput): boolean {
  return source.sourceId === comment.id && source.anchor === comment.anchor && source.authorId === comment.author.id && source.author === comment.author.login
    && source.provider === input.subject.provider && source.origin === input.subject.origin && source.url !== undefined && sourceLink(source, input.subject) !== null;
}

export async function readProviderPublication(options: {
  readonly input: ProviderReviewInput;
  readonly comments: readonly ProviderReviewComment[];
  readonly sourceCoverage?: ProviderSourceCoverage | undefined;
  readonly trustedPublisherIds: readonly string[];
}): Promise<ProviderPublicationRead> {
  const { input, comments } = options;
  const original = buildProviderReviewItems(input);
  const fallback = (status: ProviderPublicationRead['status'], issues: readonly string[], candidate: ProviderPublicationCandidate | null = null): ProviderPublicationRead => ({ status, candidate, input, comments, items: original, issues, matchedItemIds: new Set() });
  if (![...comments, ...input.threads.flatMap((thread) => thread.comments)].some((comment) => hasPublishedSummaryPrefix(comment.body))) return fallback('none', []);
  let subject: NativePublication['subject'];
  try { subject = nativeSubject(input); } catch { return fallback('invalid', ['The native review does not have a complete publication subject and head.']); }
  const all = new Map<string, ProviderReviewComment>();
  for (const comment of [...comments, ...input.threads.flatMap((thread) => thread.comments)]) {
    const prior = all.get(comment.id);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(comment)) return fallback('invalid', ['The native source contains conflicting comment identities.']);
    all.set(comment.id, comment);
  }
  const candidates: ProviderPublicationCandidate[] = [];
  let invalid = false;
  let stale = false;
  const trusted = new Set(options.trustedPublisherIds.flatMap((value) => accountId(input.subject.provider, value) ?? []));
  for (const comment of all.values()) {
    if (!hasPublishedSummaryPrefix(comment.body)) continue;
    const candidate = providerPublicationCandidate(input, comment);
    if (candidate !== null) candidates.push(candidate);
    else {
      invalid = true;
      if (comment.body.length > MAX_BODY_BYTES || new TextEncoder().encode(comment.body).byteLength > MAX_BODY_BYTES) continue;
      const parsed = parsePublishedSummaryFrame(comment.body);
      const publication = parsed.ok ? parsed.value.meta.nativePublication : undefined;
      if (publication !== undefined && sameScope(publication.subject, subject) && publication.subject.headSha !== subject.headSha
        && trusted.has(accountId(input.subject.provider, comment.author.id) ?? '')) stale = true;
    }
  }
  const selected = candidates.filter((candidate) => trusted.has(accountId(input.subject.provider, candidate.comment.author.id) ?? ''));
  if (selected.length === 0) return fallback(candidates.length > 0 ? 'untrusted' : stale ? 'stale' : invalid ? 'invalid' : 'none', candidates.length > 0 ? ['This summary publisher has not been trusted for this repository.'] : stale ? ['The trusted summary was written for a different review head.'] : invalid ? ['A summary did not pass strict native scope and frame validation.'] : [], candidates[0] ?? null);
  const first = selected[0];
  if (first === undefined) return fallback('none', []);
  const signature = (candidate: ProviderPublicationCandidate): string => JSON.stringify({ ...candidate.meta, generatedAt: '' });
  if (selected.some((candidate) => signature(candidate) !== signature(first))) return fallback('invalid', ['Multiple trusted summaries disagree on this review.']);
  selected.sort((a, b) => Date.parse(b.comment.updatedAt ?? b.comment.createdAt) - Date.parse(a.comment.updatedAt ?? a.comment.createdAt) || a.comment.id.localeCompare(b.comment.id));
  const candidate = selected[0] ?? first;
  if (candidate.meta.producer.kind !== 'action' || candidate.meta.producer.ai) return fallback('invalid', ['This native publisher format is not supported.'], candidate);
  if (candidate.meta.items.some((item) => item.sources.some((source) => source.sourceId === candidate.comment.id))) return fallback('invalid', ['A machine summary cannot be one of its own review sources.'], candidate);
  const filtered = withoutSummary(input, comments, candidate);
  const items = buildProviderReviewItems(filtered.input);
  const byId = new Map(items.map((item) => [item.id, item]));
  const proofs = new Map(candidate.publication.items.map((item) => [item.itemId, item]));
  const actual = sourceIndex(filtered.input);
  const matched = new Set<string>();
  const issues: string[] = [];
  let unmatched = 0;
  let changed = 0;
  for (const item of candidate.meta.items) {
    const native = byId.get(item.id);
    const proof = proofs.get(item.id);
    if (native === undefined || sourceVector(native) !== sourceVector(item) || proof === undefined || !item.sources.every((source) => {
      const comment = actual.get(source.anchor)?.comment;
      return comment !== undefined && sourceMatches(source, comment, filtered.input);
    })) { unmatched += 1; continue; }
    const current = await itemFingerprint(filtered.input, native, actual);
    if (current === null || current.fingerprint !== proof.fingerprint || current.sources.length !== proof.sources.length || current.sources.some((source, index) => {
      const published = proof.sources[index];
      return published === undefined || source.id !== published.id || source.anchor !== published.anchor || source.authorId !== published.authorId || source.fingerprint !== published.fingerprint;
    })) { changed += 1; continue; }
    matched.add(native.id);
  }
  if (unmatched > 0) issues.push(`${unmatched} published finding${unmatched === 1 ? ' does' : 's do'} not match the current native comments.`);
  if (changed > 0) issues.push(`${changed} published finding${changed === 1 ? ' has' : 's have'} changed sources or an unavailable native thread state.`);
  if (items.some((item) => !matched.has(item.id))) issues.push('The native conversation contains additional or changed review items.');
  if (options.sourceCoverage?.comments !== 'complete' || options.sourceCoverage.threads !== 'complete') issues.push('Native comment and thread coverage is incomplete.');
  if (candidate.meta.truncated === true) issues.push('The published summary was truncated.');
  // Native content, status and identities stay authoritative; the current producer publishes deterministic items only.
  return { status: issues.length === 0 ? 'current' : 'partial', candidate, ...filtered, items, issues, matchedItemIds: matched };
}
