import type { ModelInfo } from '@geld/review';
import { storage } from 'wxt/utils/storage';

/**
 * Device-local, non-user-facing state (as opposed to synced settings).
 */

/**
 * Set once GitHub has stored the "hide whitespace" preference for the signed-in
 * user, so pages without the diff-settings form stop redirecting to `?w=1`.
 */
export const whitespacePersistedItem = storage.defineItem<boolean>('local:whitespacePersisted', { fallback: false });

/** The user's answer per repository when `repoConfigs` is `ask`: use its config, or ignore it. */
export type RepoConfigChoice = 'use' | 'ignore';
export type RepoConfigChoices = Readonly<Record<string, RepoConfigChoice>>;
export const repoConfigChoicesItem = storage.defineItem<RepoConfigChoices>('local:repoConfigChoices', { fallback: {} });

/** OpenAI-compatible gateway key. Never synced; never written to the gist. */
export const aiKeyItem = storage.defineItem<string>('local:aiKey', { fallback: '' });

/** The user's own TypeSafe key for Jev, for a gateway that does not offer it. Same rules as the gateway key. */
export const jevKeyItem = storage.defineItem<string>('local:jevKey', { fallback: '' });

/**
 * What the gateway last said it offers: the model list and, from it, the id
 * of its Jev model (null when it has none). Written by the options page when
 * models load; read by the content script to pick where a decision goes.
 */
export interface AiGatewayInfo {
  readonly baseUrl: string;
  readonly models: readonly string[];
  /** What the gateway said about each model, by id, when it said anything. */
  readonly details?: Readonly<Record<string, ModelInfo>>;
  readonly jevModel: string | null;
  readonly checkedAt: string;
}

/**
 * Where Jev's questions go when the gateway offers Jev *and* the user has a
 * TypeSafe key: the gateway (default) or their own key ("Use one anyway").
 * When the gateway lacks Jev the key is the only route and this is moot.
 */
export type JevSource = 'gateway' | 'own';
export const jevSourceItem = storage.defineItem<JevSource>('local:jevSource', { fallback: 'gateway' });
export const aiGatewayItem = storage.defineItem<AiGatewayInfo | null>('local:aiGateway', { fallback: null });

/**
 * Jev's answers about comments and threads, by a hash of the text they were
 * asked about, so a page revisited asks only about what changed. Capped; the
 * oldest entries go first.
 */
export interface JevDecision {
  readonly lane?: string;
  readonly done?: { readonly verdict: 'yes' | 'no' | 'unclear'; readonly probability: number };
  /** A preview deployment's state, read by Jev where the parser could not. */
  readonly preview?: string;
  readonly at: number;
}
export const jevDecisionsItem = storage.defineItem<Readonly<Record<string, JevDecision>>>('local:jevDecisions', { fallback: {} });
