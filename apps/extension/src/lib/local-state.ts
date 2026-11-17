import type { ConsolidateOutputItem, ModelInfo, ReviewSummary } from '@geld/review';
import { storage } from 'wxt/utils/storage';
import { writeLocalReview } from './local-review-write';

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

/** The reader's Cursor API key, for chatting with a pull request's Cursor agents. Read only by the background. Never synced. */
export const cursorKeyItem = storage.defineItem<string>('local:cursorApiKey', { fallback: '' });

/** One turn of the assistant's chat on a pull request, as kept on this device. */
export interface StoredChatTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface StoredChat {
  readonly at: string;
  readonly turns: readonly StoredChatTurn[];
}

/** The assistant's chats, by pull request (`github[@host]:{owner}/{repo}/pull/{n}`), capped. A Cursor agent's chat is kept by Cursor. */
export const assistantChatsItem = storage.defineItem<Readonly<Record<string, StoredChat>>>('local:assistantChats', { fallback: {} });
export const ASSISTANT_CHATS_CAP = 20;
export const ASSISTANT_TURNS_CAP = 60;

/** The model last chosen in the chat's composer, per kind of thread; empty keeps the default (the writing model, or the agent's own). */
export interface ChatModels {
  readonly assistant?: string;
  readonly cursor?: string;
}
export const chatModelsItem = storage.defineItem<ChatModels>('local:chatModels', { fallback: {} });

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
/** The request of a triage run: the findings' titles, the TL;DR, the fixes. */
export type AiStep = 'findings' | 'tldr' | 'fixes';

export interface AiRunRecord {
  readonly ranAt: string;
  readonly rewrites: readonly ConsolidateOutputItem[];
  readonly summary?: ReviewSummary;
  readonly error?: string;
  /** The request that got no usable answer; absent on runs stored before it was recorded. */
  readonly errorStep?: AiStep;
  /** Comment anchors the model has been shown, so a finding it left as reported is not asked about (and paid for) again. */
  readonly seen?: readonly string[];
  readonly suggestions?: readonly StoredSuggestion[];
  /** Threads the reader asked Geld to fix from their chat, people's included: the triage writes fixes for them too. */
  readonly asked?: readonly string[];
}

/**
 * A fix the triage proposed for a finding's thread: a replacement for the lines the thread is on, at one head commit.
 * `replacement` is null when no fix fits those lines (the summary then says what is needed), so it is not asked again.
 */
export interface StoredSuggestion {
  /** The first comment's anchor of the thread the replacement is for. */
  readonly key: string;
  /** Every thread it answers (the first is `key`): findings that report the same problem share one fix. */
  readonly threads: readonly string[];
  readonly headSha: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly original: readonly string[];
  readonly replacement: readonly string[] | null;
  readonly summary: string;
  readonly state: 'open' | 'discarded' | 'applied';
  /** Sent to an agent by the gate before drafting: it judged the fix needs more than the thread's lines. */
  readonly routed?: boolean;
  /** Every comment anchor of its threads the fix was written from: a reply since makes it stale. Absent in records from before. */
  readonly sources?: readonly string[];
  /** The id each of its threads' findings had when the fix was written, which Geld's own replies change (`asWrittenFor`). */
  readonly itemIds?: Readonly<Record<string, string>>;
  /** Geld's own suggestion replies in the thread, which are not news for the triage. */
  readonly replies?: readonly string[];
  /** A suggestion reply Geld posted whose commit did not go through, committed instead of posting another. */
  readonly pendingReply?: number;
  /** That reply's words as the page first showed them, so a reply the reader edited since is posted afresh, not committed. */
  readonly pendingReplyText?: string;
  /**
   * A change a comment asks for outside its threads (a review's findings outside the diff, a failed check, a person's
   * request), read from that comment when the reader asked from its chat. No thread holds it, so it is for an agent:
   * `replacement` is null, `summary` is the task, and `path`/`start` say where when the comment did.
   */
  readonly origin?: { readonly anchor: string; readonly author: string; readonly title: string };
}
export const aiRunsItem = storage.defineItem<Readonly<Record<string, AiRunRecord>>>('local:aiRuns', { fallback: {} });
export const AI_RUNS_CAP = 40;

export interface ProviderReviewedRecord {
  readonly reviewKey: string;
  readonly headSha: string;
  readonly updatedAt: number;
  readonly items: Readonly<Record<string, string>>;
}

export interface ProviderReviewedStorage {
  getValue(): Promise<unknown>;
  setValue(value: Readonly<Record<string, ProviderReviewedRecord>>): Promise<void>;
}

export const providerReviewedItemsItem = storage.defineItem<Readonly<Record<string, ProviderReviewedRecord>>>('local:providerReviewedItems', { fallback: {} });
export const PROVIDER_REVIEWED_BUCKET_CAP = 100;
export const PROVIDER_REVIEWED_ITEM_CAP = 1000;
export const PROVIDER_REVIEWED_BYTE_CAP = 384 * 1024;
const REVIEWED_HASH = /^[a-f0-9]{64}$/;
const REVIEWED_HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
let providerReviewedWrites: Promise<unknown> = Promise.resolve();

function reviewedRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reviewedBucket(reviewKey: string, headSha: string): string { return JSON.stringify([reviewKey, headSha]); }

function reviewedIdentity(reviewKey: string, headSha: string): boolean {
  return reviewKey.length <= 4096 && /^(gitlab|bitbucket)@https:\/\//.test(reviewKey) && REVIEWED_HEAD.test(headSha);
}

function reviewedItemId(value: string): boolean { return /^[a-zA-Z0-9_-]{1,180}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value); }

export function normalizeProviderReviewedItems(value: unknown): Readonly<Record<string, ProviderReviewedRecord>> {
  if (!reviewedRecord(value)) return {};
  const records: Array<readonly [string, ProviderReviewedRecord]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (!reviewedRecord(raw) || typeof raw.reviewKey !== 'string' || typeof raw.headSha !== 'string' || !reviewedIdentity(raw.reviewKey, raw.headSha)
      || key !== reviewedBucket(raw.reviewKey, raw.headSha) || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt <= 0 || !reviewedRecord(raw.items)) continue;
    const items = Object.fromEntries(Object.entries(raw.items).filter((entry): entry is [string, string] => reviewedItemId(entry[0]) && typeof entry[1] === 'string' && REVIEWED_HASH.test(entry[1])).slice(-PROVIDER_REVIEWED_ITEM_CAP));
    if (Object.keys(items).length > 0) records.push([key, { reviewKey: raw.reviewKey, headSha: raw.headSha, updatedAt: raw.updatedAt, items }]);
  }
  records.sort((a, b) => b[1].updatedAt - a[1].updatedAt || a[0].localeCompare(b[0]));
  const result: Record<string, ProviderReviewedRecord> = {};
  let remaining = PROVIDER_REVIEWED_ITEM_CAP;
  for (const [key, entry] of records.slice(0, PROVIDER_REVIEWED_BUCKET_CAP)) {
    if (remaining <= 0) break;
    const items = Object.fromEntries(Object.entries(entry.items).slice(-remaining));
    const candidate = { ...entry, items };
    result[key] = candidate;
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PROVIDER_REVIEWED_BYTE_CAP) { delete result[key]; break; }
    remaining -= Object.keys(items).length;
  }
  return result;
}

export async function readProviderReviewedItems(reviewKey: string, headSha: string, source: ProviderReviewedStorage = providerReviewedItemsItem): Promise<Readonly<Record<string, string>>> {
  if (!reviewedIdentity(reviewKey, headSha)) throw new Error('Invalid reviewed-item identity.');
  return normalizeProviderReviewedItems(await source.getValue())[reviewedBucket(reviewKey, headSha)]?.items ?? {};
}

/** Explicit stores support isolated tests; production writes share the background authority. */
export function saveProviderReviewedItem(reviewKey: string, headSha: string, itemId: string, fingerprint: string, reviewed: boolean, validate: () => Promise<void>, source?: ProviderReviewedStorage): Promise<void> {
  if (!reviewedIdentity(reviewKey, headSha) || !reviewedItemId(itemId) || !REVIEWED_HASH.test(fingerprint)) return Promise.reject(new Error('Invalid reviewed-item identity.'));
  if (source === undefined) return writeLocalReview({ kind: 'reviewed', reviewKey, headSha, itemId, fingerprint, reviewed }, validate);
  const write = async (): Promise<void> => {
    await validate();
    const current = { ...normalizeProviderReviewedItems(await source.getValue()) };
    await validate();
    const key = reviewedBucket(reviewKey, headSha);
    const items = { ...current[key]?.items };
    if (reviewed) items[itemId] = fingerprint;
    else delete items[itemId];
    // A new head cannot inherit previous marks, and old heads need not consume local storage.
    for (const [other, entry] of Object.entries(current)) if (entry.reviewKey === reviewKey && other !== key) delete current[other];
    if (Object.keys(items).length === 0) delete current[key];
    else current[key] = { reviewKey, headSha, updatedAt: Date.now(), items };
    await source.setValue(normalizeProviderReviewedItems(current));
  };
  const run = providerReviewedWrites.then(write, write);
  providerReviewedWrites = run.catch(() => undefined);
  return run;
}

/**
 * Development only: after every region-scoped pass the controller runs the
 * full pass too and logs a `[geld] scope disagreement` when the two differ
 * (tab state or panel signature). Set from the harness; never from the UI.
 */
export const debugScopesItem = storage.defineItem<boolean>('local:debugScopes', { fallback: false });
