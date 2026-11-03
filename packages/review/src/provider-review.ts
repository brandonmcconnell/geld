import type { RawCheckRun } from './bots';
import type { RawComment, ThreadPeer } from './cluster';
import { clusterComments } from './cluster';
import type { ReviewItem, ReviewProvider, ReviewerState, ReviewSource } from './model';
import { isProviderSourceAnchor, itemIdFor, reviewSourceSchema } from './model';

export { isProviderSourceAnchor } from './model';

export interface ProviderReviewSubject {
  readonly provider: ReviewProvider;
  readonly origin: string;
  readonly repository: string;
  readonly id: string;
  readonly headSha: string;
}

export interface ProviderReviewAuthor {
  readonly id: string;
  readonly login: string;
  readonly automated?: boolean;
}

export interface ProviderReviewComment {
  readonly id: string;
  readonly anchor: string;
  readonly url: string;
  readonly author: ProviderReviewAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface ProviderReviewThread {
  readonly id: string;
  readonly anchor: string;
  readonly url: string;
  readonly path?: string;
  readonly line?: number;
  readonly resolved: boolean;
  readonly outdated: boolean;
  /** True only when the adapter established both native resolution and outdated state. */
  readonly stateKnown?: boolean;
  readonly comments: readonly ProviderReviewComment[];
}

export interface ProviderReviewReviewer {
  readonly author: ProviderReviewAuthor;
  readonly state: ReviewerState;
  /** Independent current request fact; absence retains legacy state-only behavior. */
  readonly reviewRequest?: 'pending' | 'not-pending' | 'unknown';
  readonly anchor?: string;
  readonly url?: string;
}

/** A provider adapter must establish the account identity before registering it as a reviewer bot. */
export interface ProviderReviewBot {
  readonly id: string;
  readonly authorId: string;
  readonly login?: string;
  readonly triggers?: readonly string[];
  readonly checkNames?: readonly string[];
}

export interface ProviderReviewCheck extends RawCheckRun {
  readonly authorId?: string;
  readonly key?: string;
  readonly nativeStatus?: string;
  readonly allowFailure?: boolean;
}

export interface ProviderReviewInput {
  readonly subject: ProviderReviewSubject;
  readonly threads: readonly ProviderReviewThread[];
  readonly reviewers?: readonly ProviderReviewReviewer[];
  readonly checks?: readonly ProviderReviewCheck[];
  readonly checksCoverage?: 'complete' | 'partial' | 'unavailable';
  readonly bots?: readonly ProviderReviewBot[];
  readonly complete?: boolean;
  readonly closed?: boolean;
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' ? url.origin : null;
  } catch {
    return null;
  }
}

function repositoryParts(subject: ProviderReviewSubject): readonly string[] {
  const parts = subject.repository.split('/');
  if (parts.length < 2 || parts.some((part) => part.trim() === '' || part === '.' || part === '..' || /[?#\\\x00-\x1f]/.test(part))) {
    throw new TypeError('Expected a full provider repository path.');
  }
  return parts;
}

function validateSubject(subject: ProviderReviewSubject): void {
  if (originOf(subject.origin) !== subject.origin) throw new TypeError('Expected an HTTP(S) provider origin.');
  if (!/^[1-9]\d*$/.test(subject.id)) throw new TypeError('Expected a positive native review number.');
  if (!/^[0-9a-f]{7,64}$/i.test(subject.headSha)) throw new TypeError('Expected a review head SHA.');
  repositoryParts(subject);
}

/** Review identity is stable across pushes and distinct across providers and self-hosted origins. */
export function providerReviewKey(subject: ProviderReviewSubject): string {
  validateSubject(subject);
  return `${subject.provider}@${subject.origin}:${encodeURIComponent(subject.repository)}!${subject.id}`;
}

export function providerReviewUrl(subject: ProviderReviewSubject): string {
  validateSubject(subject);
  const repository = repositoryParts(subject).map(encodeURIComponent).join('/');
  const segment = subject.provider === 'gitlab' ? '-/merge_requests' : subject.provider === 'bitbucket' ? 'pull-requests' : 'pull';
  return `${subject.origin}/${repository}/${segment}/${subject.id}`;
}

/** Never follow a payload URL onto a different provider origin or a non-HTTP scheme. */
export function sourceLink(source: ReviewSource, subject: ProviderReviewSubject): string | null {
  try {
    if (!isProviderSourceAnchor(subject.provider, source.anchor)) return null;
    if (source.provider !== undefined && source.provider !== subject.provider) return null;
    if (source.origin !== undefined && source.origin !== subject.origin) return null;
    const page = providerReviewUrl(subject);
    if (source.url === undefined) return `${page}#${source.anchor}`;
    if (originOf(source.url) !== subject.origin) return null;
    const url = new URL(source.url);
    if (subject.provider !== 'github') {
      const path = new URL(page).pathname;
      const suffix = url.pathname.slice(path.length).replace(/\/$/, '');
      const permitted = subject.provider === 'gitlab' ? ['', '/diffs'] : ['', '/diff', '/activity', '/overview', '/_/diff', '/_/overview'];
      if (!url.pathname.startsWith(path) || !permitted.includes(suffix) || url.hash !== `#${source.anchor}`) return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function normalizedTrigger(body: string): string {
  return body.trim().replace(/\s+/g, ' ').toLowerCase();
}

function commentSource(comment: ProviderReviewComment, input: ProviderReviewInput, bots: ReadonlyMap<string, ProviderReviewBot>): ThreadPeer {
  const { subject } = input;
  if (comment.id.trim() === '' || comment.author.id.trim() === '' || comment.author.login.trim() === '') {
    throw new TypeError('Expected native comment and author identities.');
  }
  if (sourceLink({ anchor: comment.anchor, kind: 'thread', author: comment.author.login, provider: subject.provider, origin: subject.origin, url: comment.url }, subject) === null) {
    throw new TypeError('Expected a native source anchor and URL on the provider origin.');
  }
  if (Number.isNaN(Date.parse(comment.createdAt)) || (comment.updatedAt !== undefined && Number.isNaN(Date.parse(comment.updatedAt)))) {
    throw new TypeError('Expected source timestamps.');
  }
  return {
    kind: 'thread',
    anchor: comment.anchor,
    sourceId: comment.id,
    author: comment.author.login,
    authorId: comment.author.id,
    automated: bots.has(comment.author.id) || comment.author.automated === true,
    provider: subject.provider,
    origin: subject.origin,
    url: comment.url,
    body: comment.body,
  };
}

export function buildProviderReviewItems(input: ProviderReviewInput): readonly ReviewItem[] {
  const key = providerReviewKey(input.subject);
  const bots = new Map<string, ProviderReviewBot>();
  for (const bot of input.bots ?? []) {
    if (bot.id.trim() === '' || bot.authorId.trim() === '' || bots.has(bot.authorId)) {
      throw new TypeError('Expected one verified review bot per provider account.');
    }
    bots.set(bot.authorId, bot);
  }
  const anchors = new Set<string>();
  const comments: RawComment[] = [];
  for (const thread of input.threads) {
    if (thread.id.trim() === '' || !isProviderSourceAnchor(input.subject.provider, thread.anchor) || originOf(thread.url) !== input.subject.origin) {
      throw new TypeError('Expected a native thread identity and URL on the provider origin.');
    }
    if (thread.line !== undefined && (!Number.isSafeInteger(thread.line) || thread.line <= 0)) throw new TypeError('Expected a positive source line.');
    const sources = thread.comments.map((comment) => commentSource(comment, input, bots));
    for (const source of sources) {
      if (anchors.has(source.anchor)) throw new TypeError('A source anchor must identify exactly one comment.');
      anchors.add(source.anchor);
    }
    const firstIndex = thread.comments.findIndex((comment) => comment.body.trim() !== '');
    const first = thread.comments[firstIndex];
    const source = sources[firstIndex];
    if (first === undefined || source === undefined) continue;
    comments.push({
      ...source,
      createdAt: first.createdAt,
      isResolved: thread.resolved,
      isOutdated: thread.outdated,
      threadAnchors: sources,
      ...(thread.path === undefined || thread.path === '' ? {} : { path: thread.path }),
      ...(thread.line === undefined ? {} : { line: thread.line }),
    });
  }
  const triggers = new Set([...bots.values()].flatMap((bot) => (bot.triggers ?? []).map(normalizedTrigger)).filter((trigger) => trigger !== ''));
  return clusterComments(comments, [], {
    resolveBot: (source) => source.authorId === undefined ? null : bots.get(source.authorId)?.id ?? null,
    isTrigger: (comment) => triggers.has(normalizedTrigger(comment.body)),
  }).map((item) => {
    for (const source of item.sources) {
      if (!reviewSourceSchema.safeParse(source).success) throw new TypeError('Invalid normalized review source.');
    }
    return { ...item, id: itemIdFor([key, item.id]) };
  });
}
