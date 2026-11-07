import type { RelatedLink } from '../related-links';
import { bitbucketResolver } from './bitbucket';
import { githubResolver } from './github';
import { gitlabResolver } from './gitlab';
import { jiraResolver } from './jira';
import { linearResolver } from './linear';
import { slackResolver } from './slack';
import { record } from './http';
import { isServiceId, type Connection, type ConnectionDraft, type ConnectionUse, type ConnectionHints, type FetchLike, type Identity, type LinkDetails, type LinkResolver, type Resolution, type ServiceId } from './types';

export * from './types';
export { adfText } from './jira';
export { SLACK_API, SLACK_LIMITED_METHODS, SLACK_USER_SCOPES, slackFailure, slackText } from './slack';

const RESOLVERS = new Map<ServiceId, LinkResolver>([
  ['linear', linearResolver],
  ['jira', jiraResolver],
  ['github', githubResolver],
  ['gitlab', gitlabResolver],
  ['bitbucket', bitbucketResolver],
  ['slack', slackResolver],
]);

/** Services added in a later step register here, so this module never imports their platform code. */
export function registerResolver(resolver: LinkResolver): void {
  RESOLVERS.set(resolver.service, resolver);
}

export function resolverFor(service: ServiceId): LinkResolver | null {
  return RESOLVERS.get(service) ?? null;
}

export function resolverForLink(link: RelatedLink): LinkResolver | null {
  for (const resolver of RESOLVERS.values()) if (resolver.reads(link)) return resolver;
  return null;
}

/**
 * The reader's connections that may open a link, in the order to try them: the one that last opened something in the
 * same repository or workspace, then those whose workspaces include the link's, then those that do not say which
 * workspaces they open. One that names other workspaces only is never asked.
 */
export function candidatesFor(link: RelatedLink, connections: readonly Connection[], hints: ConnectionHints = {}, purpose: keyof ConnectionUse = 'details'): Connection[] {
  const resolver = resolverForLink(link);
  if (resolver === null) return [];
  const workspace = resolver.workspaceOf(link);
  const eligible = connections.filter((connection) => connection.service === resolver.service && connection.use[purpose] && connection.secret !== '');
  const matches = (connection: Connection): boolean => connection.covers.length === 0 || workspace === null || connection.covers.includes(workspace);
  const hinted = resolver
    .hintKeys(link)
    .map((key) => hints[key])
    .filter((id): id is string => id !== undefined);
  const rank = (connection: Connection): number => {
    const hint = hinted.indexOf(connection.id);
    if (hint !== -1) return hint;
    return connection.covers.length > 0 ? hinted.length : hinted.length + 1;
  };
  return eligible.filter(matches).sort((a, b) => rank(a) - rank(b));
}

export interface LinkAnswer {
  readonly resolution: Resolution;
  /** The connection that answered, for `ok`; the last one asked otherwise. */
  readonly connectionId: string | null;
}

/**
 * Asks the candidates in turn until one can open the link. A connection that cannot is passed over; one rate-limited
 * or failing is passed over too, and the answer reports the failure only when no other connection opened it.
 */
export async function resolveLink(link: RelatedLink, candidates: readonly Connection[], fetch: FetchLike): Promise<LinkAnswer | null> {
  const resolver = resolverForLink(link);
  if (resolver === null || candidates.length === 0) return null;
  let answer: LinkAnswer | null = null;
  for (const connection of candidates) {
    const resolution = await resolver.resolve(link, connection, fetch);
    if (resolution.status === 'ok') return { resolution, connectionId: connection.id };
    if (answer === null || answer.resolution.status === 'unsupported' || resolution.status === 'failed') answer = { resolution, connectionId: connection.id };
  }
  return answer;
}

export function connectionFrom(id: string, draft: ConnectionDraft, identity: Identity): Connection {
  return {
    id,
    service: draft.service,
    label: draft.label.trim() === '' ? (identity.suggestedLabel ?? identity.account) : draft.label.trim(),
    host: identity.host,
    secret: draft.secret.trim(),
    email: draft.email === null || draft.email.trim() === '' ? null : draft.email.trim(),
    account: identity.account,
    covers: identity.covers,
    use: { details: true, ai: false },
    expiresAt: null,
    refresh: null,
  };
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const nullableString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** Connections as stored, with anything malformed dropped rather than trusted. */
export function normalizeConnections(value: unknown): Connection[] {
  if (!Array.isArray(value)) return [];
  const out: Connection[] = [];
  for (const item of value) {
    const entry = record(item);
    if (entry === null || typeof entry.id !== 'string' || !isServiceId(entry.service) || typeof entry.secret !== 'string') continue;
    const use = record(entry.use);
    out.push({
      id: entry.id,
      service: entry.service,
      label: typeof entry.label === 'string' ? entry.label : '',
      host: nullableString(entry.host),
      secret: entry.secret,
      email: nullableString(entry.email),
      account: nullableString(entry.account),
      covers: strings(entry.covers),
      use: { details: use?.details !== false, ai: use?.ai === true },
      expiresAt: typeof entry.expiresAt === 'number' ? entry.expiresAt : null,
      refresh: nullableString(entry.refresh),
    });
  }
  return out;
}

/** The hint keys to remember after a connection opened a link. */
export function hintsAfter(link: RelatedLink, connectionId: string, hints: ConnectionHints): ConnectionHints {
  const resolver = resolverForLink(link);
  if (resolver === null) return hints;
  const next: Record<string, string> = { ...hints };
  for (const key of resolver.hintKeys(link)) next[key] = connectionId;
  return next;
}

export const DETAILS_TTL_MS = 6 * 60 * 60 * 1000;
export const NO_ACCESS_TTL_MS = 60 * 60 * 1000;
export const FAILURE_TTL_MS = 5 * 60 * 1000;
export const DETAILS_CACHE_CAP = 500;

export interface CachedAnswer {
  readonly at: number;
  readonly answer: LinkAnswer;
}

/** Per link and the set of connections that may answer it, so a connection added since is asked. */
export function cacheKey(link: RelatedLink, candidates: readonly Connection[]): string {
  return `${link.key}|${candidates.map((connection) => connection.id).sort().join(',')}`;
}

export function ttlFor(answer: LinkAnswer, service: ServiceId | null, longTitles: readonly ServiceId[] = ['slack', 'teams', 'discord']): number {
  const { resolution } = answer;
  if (resolution.status === 'ok') return service !== null && longTitles.includes(service) ? 4 * DETAILS_TTL_MS : DETAILS_TTL_MS;
  if (resolution.status === 'failed') return resolution.retryAfterMs ?? FAILURE_TTL_MS;
  return NO_ACCESS_TTL_MS;
}

export function isFresh(entry: CachedAnswer, service: ServiceId | null, now: number): boolean {
  return now - entry.at < ttlFor(entry.answer, service);
}

/** Keeps the newest `cap` entries. */
export function pruneCache(cache: Readonly<Record<string, CachedAnswer>>, cap = DETAILS_CACHE_CAP): Record<string, CachedAnswer> {
  const entries = Object.entries(cache).sort(([, a], [, b]) => b.at - a.at);
  return Object.fromEntries(entries.slice(0, cap));
}

/** A resolved link as text for an AI prompt: its title, state and body or messages, cut to `cap` characters. */
export function contextText(link: RelatedLink, details: LinkDetails, cap = 4000): string {
  const head = [`${link.service} ${link.noun}: ${details.title}`, details.state === null ? null : `State: ${details.state}`, details.where === null ? null : `Where: ${details.where}`];
  const lines = details.messages.length > 0 ? details.messages.map((message) => `${message.author ?? 'Someone'}: ${message.text}`) : details.body === null ? [] : [details.body];
  const out = [...head.filter((line) => line !== null), '', ...lines].join('\n').trim();
  return out.length <= cap ? out : `${out.slice(0, cap - 1).trimEnd()}…`;
}
