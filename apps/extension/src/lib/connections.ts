import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import type { RelatedKind, RelatedLink } from '@geld/review/related-links';
import {
  cacheKey,
  candidatesFor,
  hintsAfter,
  isFresh,
  normalizeConnections,
  pruneCache,
  resolveLink,
  resolverFor,
  resolverForLink,
  type CachedAnswer,
  type Connection,
  type ConnectionHints,
  type ConnectionUse,
  type FetchLike,
  type LinkDetails,
  type ServiceId,
} from '@geld/review/link-resolvers/index';

/**
 * The reader's connected accounts and what they read. Every secret stays in `storage.local`: never synced, never in
 * the gist, never sent anywhere but the service it belongs to.
 */
const connectionsStore = storage.defineItem<unknown>('local:connections', { fallback: [] });
export const connectionHintsItem = storage.defineItem<ConnectionHints>('local:connectionHints', { fallback: {} });
export const linkDetailsItem = storage.defineItem<Readonly<Record<string, CachedAnswer>>>('local:linkDetails', { fallback: {} });

export async function readConnections(): Promise<Connection[]> {
  return normalizeConnections(await connectionsStore.getValue());
}

export async function writeConnections(connections: readonly Connection[]): Promise<void> {
  await connectionsStore.setValue([...connections]);
  await linkDetailsItem.setValue({});
}

export function watchConnections(callback: (connections: Connection[]) => void): () => void {
  return connectionsStore.watch((value) => callback(normalizeConnections(value)));
}

/** The origins a connection's service is reached on, as permission patterns. */
export function originsFor(connection: Pick<Connection, 'service' | 'host'>): string[] {
  return [...(resolverFor(connection.service)?.origins(connection) ?? [])];
}

export async function hasOrigins(connection: Pick<Connection, 'service' | 'host'>): Promise<boolean> {
  const origins = originsFor(connection);
  if (origins.length === 0) return true;
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return false;
  }
}

/** Asks for the service's origins. Must run from a click: browsers only show the prompt for a user's gesture. */
export async function requestOrigins(connection: Pick<Connection, 'service' | 'host'>): Promise<boolean> {
  const origins = originsFor(connection);
  if (origins.length === 0) return true;
  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

/** A link as the content script sends it: the registry's reading, which the background reads again. */
export interface WireLink {
  readonly key: string;
  readonly kind: RelatedKind;
  readonly service: string;
  readonly noun: string;
  readonly ref: string | null;
  readonly title: string | null;
  readonly context: string | null;
  readonly href: string;
}

export interface ResolveLinksRequest {
  readonly type: 'geld:resolve-links';
  readonly links: readonly WireLink[];
  readonly purpose: keyof ConnectionUse;
}

export type LinkAnswerView =
  | { readonly key: string; readonly status: 'ok'; readonly details: LinkDetails; readonly service: ServiceId; readonly connection: string }
  | { readonly key: string; readonly status: 'none' | 'no-access' | 'not-allowed' }
  | { readonly key: string; readonly status: 'failed'; readonly message: string | null; readonly retryAfterMs: number | null };

export interface ResolveLinksResponse {
  readonly answers: readonly LinkAnswerView[];
}

export const MAX_LINKS_PER_REQUEST = 32;
const KINDS: readonly RelatedKind[] = ['github', 'ticket', 'conversation', 'agent', 'review', 'doc', 'error'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isWireLink(value: unknown): value is WireLink {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    KINDS.some((kind) => kind === value.kind) &&
    typeof value.service === 'string' &&
    typeof value.noun === 'string' &&
    nullableString(value.ref) &&
    nullableString(value.title) &&
    nullableString(value.context) &&
    typeof value.href === 'string' &&
    value.href.startsWith('https://') &&
    value.href.length < 2000
  );
}

export function isResolveLinksRequest(value: unknown): value is ResolveLinksRequest {
  return (
    isRecord(value) &&
    value.type === 'geld:resolve-links' &&
    (value.purpose === 'details' || value.purpose === 'ai') &&
    Array.isArray(value.links) &&
    value.links.length <= MAX_LINKS_PER_REQUEST &&
    value.links.every(isWireLink)
  );
}

export function wireLinkOf(link: RelatedLink): WireLink {
  return { key: link.key, kind: link.kind, service: link.service, noun: link.noun, ref: link.ref, title: link.title, context: link.context, href: link.href };
}

const asLink = (wire: WireLink): RelatedLink => ({ ...wire, action: '', appId: null, icon: null });

const CONCURRENCY = 4;

function viewOf(key: string, answer: CachedAnswer['answer'], connections: readonly Connection[]): LinkAnswerView {
  const { resolution } = answer;
  if (resolution.status === 'ok') {
    const connection = connections.find((candidate) => candidate.id === answer.connectionId);
    return { key, status: 'ok', details: resolution.details, service: connection?.service ?? 'github', connection: connection?.label ?? '' };
  }
  if (resolution.status === 'failed') return { key, status: 'failed', message: resolution.message, retryAfterMs: resolution.retryAfterMs };
  return { key, status: resolution.status === 'unsupported' ? 'none' : 'no-access' };
}

/**
 * Answers a page's links from the reader's connections: cached answers while they hold, then each remaining link from
 * its candidates in turn, four at a time. A connection whose origins were never granted is not asked.
 */
export async function resolveLinksInBackground(request: ResolveLinksRequest, fetchImpl: FetchLike = (input, init) => fetch(input, init)): Promise<ResolveLinksResponse> {
  const connections = await readConnections();
  const allowed = new Map<string, boolean>();
  for (const connection of connections) allowed.set(connection.id, await hasOrigins(connection));
  let hints = await connectionHintsItem.getValue();
  const cache: Record<string, CachedAnswer> = { ...(await linkDetailsItem.getValue()) };
  const now = Date.now();
  const answers: LinkAnswerView[] = [];
  const queue = request.links.map(asLink);
  let changed = false;

  const work = async (link: RelatedLink): Promise<void> => {
    const service = resolverForLink(link)?.service ?? null;
    const candidates = candidatesFor(link, connections, hints, request.purpose);
    if (candidates.length === 0) {
      answers.push({ key: link.key, status: 'none' });
      return;
    }
    const usable = candidates.filter((candidate) => allowed.get(candidate.id) === true);
    if (usable.length === 0) {
      answers.push({ key: link.key, status: 'not-allowed' });
      return;
    }
    const keyed = cacheKey(link, usable);
    const cached = cache[keyed];
    if (cached !== undefined && isFresh(cached, service, now)) {
      answers.push(viewOf(link.key, cached.answer, connections));
      return;
    }
    const answer = await resolveLink(link, usable, fetchImpl);
    if (answer === null) {
      answers.push({ key: link.key, status: 'none' });
      return;
    }
    cache[keyed] = { at: Date.now(), answer };
    changed = true;
    if (answer.resolution.status === 'ok' && answer.connectionId !== null) hints = hintsAfter(link, answer.connectionId, hints);
    answers.push(viewOf(link.key, answer, connections));
  };

  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let link = queue.shift(); link !== undefined; link = queue.shift()) await work(link);
  });
  await Promise.all(runners);
  if (changed) {
    await linkDetailsItem.setValue(pruneCache(cache));
    await connectionHintsItem.setValue(hints);
  }
  return { answers };
}

export function isResolveLinksResponse(value: unknown): value is ResolveLinksResponse {
  return isRecord(value) && Array.isArray(value.answers);
}

/** Asks the background for the details of a page's links. */
export async function requestLinkDetails(links: readonly RelatedLink[], purpose: keyof ConnectionUse = 'details'): Promise<ReadonlyMap<string, LinkAnswerView>> {
  const message: ResolveLinksRequest = { type: 'geld:resolve-links', links: links.slice(0, MAX_LINKS_PER_REQUEST).map(wireLinkOf), purpose };
  try {
    const answer: unknown = await browser.runtime.sendMessage(message);
    if (!isResolveLinksResponse(answer)) return new Map();
    return new Map(answer.answers.map((view) => [view.key, view]));
  } catch {
    return new Map();
  }
}
