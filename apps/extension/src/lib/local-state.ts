import type { ConsolidateOutputItem, ModelInfo, ReviewPlan, ReviewProgress, ReviewSummary, StoryOutput } from '@geld/review';
import { storage } from 'wxt/utils/storage';

/**
 * Device-local, non-user-facing state (as opposed to synced settings).
 */

/**
 * Diff pages the reader turned "Hide whitespace" off on (GitHub's menu wrote
 * `?w=0` there), by page key: Geld adds `?w=1` everywhere else and leaves
 * these alone. See `WhitespaceRedirector`.
 */
export const whitespaceOptOutsItem = storage.defineItem<Readonly<Record<string, number>>>('local:whitespaceOptOuts', { fallback: {} });

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

/**
 * What the model wrote for one pull request when the reader asked (the AI
 * button on the digest), on this device only: nothing is posted to GitHub,
 * so nobody else sees it. Keyed `github[@host]:{owner}:{repo}:{pull}`, capped
 * at the most recent runs. A run that failed keeps its reason so the panel can
 * say why, instead of quietly showing the reporters' wording.
 */
export interface AiRunRecord {
  readonly ranAt: string;
  readonly rewrites: readonly ConsolidateOutputItem[];
  readonly summary?: ReviewSummary;
  readonly error?: string;
}
export const aiRunsItem = storage.defineItem<Readonly<Record<string, AiRunRecord>>>('local:aiRuns', { fallback: {} });
export const AI_RUNS_CAP = 40;

/**
 * The Review tab's plan for one pull request, on this device: the current
 * plan, the one before it (for the replan's diff), the stories written so
 * far by step id, and how the last run ended. Keyed like {@link aiRunsItem}
 * (`github[@host]:/owner/repo/pull/N`), capped at the most recent pull
 * requests. Nothing here is posted to GitHub.
 */
/** A step's story as written, with the step's fingerprint then: a story for hunks that have since changed is not shown. */
export interface StoredStory extends StoryOutput {
  readonly model: string;
  readonly at: string;
  readonly fingerprint: string;
}

export interface ReviewPlanRecord {
  readonly plan: ReviewPlan;
  readonly previous?: ReviewPlan;
  readonly stories: Readonly<Record<string, StoredStory>>;
  /** Why the last model call failed, when it did; cleared by the next success. */
  readonly error?: string;
  readonly savedAt: string;
}
export const reviewPlansItem = storage.defineItem<Readonly<Record<string, ReviewPlanRecord>>>('local:reviewPlans', { fallback: {} });
/** The reader's progress through a plan, keyed like the plans. */
export const reviewProgressItem = storage.defineItem<Readonly<Record<string, ReviewProgress & { readonly savedAt: string }>>>('local:reviewProgress', { fallback: {} });
export const REVIEW_PLANS_CAP = 20;

/**
 * Development only: after every region-scoped pass the controller runs the
 * full pass too and logs a `[geld] scope disagreement` when the two differ
 * (tab state or panel signature). Set from the harness; never from the UI.
 */
export const debugScopesItem = storage.defineItem<boolean>('local:debugScopes', { fallback: false });
