import type { RelatedLink } from '../related-links';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ServiceId = 'linear' | 'jira' | 'github' | 'gitlab' | 'bitbucket' | 'slack' | 'teams' | 'discord';

export const SERVICE_IDS: readonly ServiceId[] = ['linear', 'jira', 'github', 'gitlab', 'bitbucket', 'slack', 'teams', 'discord'];

export function isServiceId(value: unknown): value is ServiceId {
  return typeof value === 'string' && SERVICE_IDS.some((id) => id === value);
}

/** What a connection is used for. AI context is the reader's own choice and starts off. */
export interface ConnectionUse {
  readonly details: boolean;
  readonly ai: boolean;
}

/** One account the reader connected. Kept on the device only: it holds a secret. */
export interface Connection {
  readonly id: string;
  readonly service: ServiceId;
  /** The reader's own name for it: "Work", "Personal". */
  readonly label: string;
  /** The site or host the account lives on: a Jira site, a GitLab or GitHub Enterprise host. Null is the service's own. */
  readonly host: string | null;
  readonly secret: string;
  /** The Atlassian account's email (Jira, Bitbucket), which its API tokens are paired with. */
  readonly email: string | null;
  /** Who the account is, as the service answered when it was saved: "brandon", "Brandon McConnell". */
  readonly account: string | null;
  /**
   * The workspaces this account opens, learned when it was saved: Linear's workspace key, a Slack team's id and
   * domain, a Jira site. Empty when the service does not say, and then every link of the service may be tried.
   */
  readonly covers: readonly string[];
  readonly use: ConnectionUse;
  /** When the access expires (Teams), as epoch milliseconds; null when it does not. */
  readonly expiresAt: number | null;
  /** The refresh token that renews it (Teams), on the device only. */
  readonly refresh: string | null;
}

/** What the reader types to add a connection, before the service has said who it is. */
export interface ConnectionDraft {
  readonly service: ServiceId;
  readonly label: string;
  readonly host: string | null;
  readonly secret: string;
  readonly email: string | null;
}

export interface Identity {
  readonly account: string;
  readonly covers: readonly string[];
  /** A label to offer when the reader gave none: the workspace's name. */
  readonly suggestedLabel: string | null;
  /** The host to keep, normalised (`acme.atlassian.net`), when the service has one. */
  readonly host: string | null;
}

export type IdentifyResult = { readonly ok: true; readonly identity: Identity } | { readonly ok: false; readonly message: string };

/** How a linked thing stands, in GitHub's state colours. */
export type DetailsTone = 'open' | 'done' | 'closed' | 'draft' | 'neutral';

export interface LinkMessage {
  readonly author: string | null;
  readonly at: string | null;
  readonly text: string;
}

/** What a connection could read about a link. */
export interface LinkDetails {
  readonly title: string;
  /** The service's word for its state: "In Progress", "Merged", "Done". */
  readonly state: string | null;
  readonly tone: DetailsTone | null;
  readonly author: string | null;
  /** ISO time of the last change. */
  readonly updatedAt: string | null;
  /** Where it lives, as the service names it: "ENG · Acme", "#eng-review". */
  readonly where: string | null;
  /** The description, as plain text or Markdown, cut to `BODY_CAP` characters. */
  readonly body: string | null;
  /** A conversation's messages, oldest first, at most `MESSAGE_CAP`. */
  readonly messages: readonly LinkMessage[];
}

export type FailureReason = 'unauthorized' | 'rate-limited' | 'unavailable' | 'invalid';

export type Resolution =
  | { readonly status: 'ok'; readonly details: LinkDetails }
  /** This account cannot open it, or it does not exist: the service does not tell the two apart. */
  | { readonly status: 'no-access' }
  /** The service has no way to read this kind of link. */
  | { readonly status: 'unsupported' }
  | { readonly status: 'failed'; readonly reason: FailureReason; readonly retryAfterMs: number | null; readonly message: string | null };

/** Which connection last opened a repository or workspace, so the next link there tries it first. */
export type ConnectionHints = Readonly<Record<string, string>>;

export interface LinkResolver {
  readonly service: ServiceId;
  /** Whether this resolver reads the link at all. */
  reads(link: RelatedLink): boolean;
  /** The workspace the link names (Linear's workspace, a Jira site, a GitLab host), compared with `covers`. */
  workspaceOf(link: RelatedLink): string | null;
  /** Keys for `ConnectionHints`, most specific first: `github.com/acme/web`, then `github.com/acme`. */
  hintKeys(link: RelatedLink): readonly string[];
  /** The origins the extension must be allowed to reach for this connection, as permission patterns. */
  origins(connection: Pick<Connection, 'host'>): readonly string[];
  identify(draft: ConnectionDraft, fetch: FetchLike): Promise<IdentifyResult>;
  resolve(link: RelatedLink, connection: Connection, fetch: FetchLike): Promise<Resolution>;
}

export const BODY_CAP = 4000;
export const MESSAGE_CAP = 30;
