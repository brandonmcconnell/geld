/**
 * Optional in-browser consolidation when the Action did not run with AI.
 * The user's gateway key stays in `storage.local` (never the gist); the
 * background worker talks to the gateway. Nothing is sent without a key,
 * URL and model. Results are cached for the visit and layered onto every
 * later pass, so a title never flickers back to the verbatim one; only
 * items whose sources changed are asked again (`planConsolidation`).
 */

import type { GeldSettings } from '@geld/core';
import type { AddressedEvidence, CommentLane, ConsolidateInputItem, ConsolidateOutputItem, GeldPrMeta, JevAnswer, JevRequest, LaneInput, RawComment, ReviewItem, ReviewSummary, ThreadInput } from '@geld/review';
import {
  applyAddressed,
  applyConsolidation,
  classificationRequests,
  doneFrom,
  isCommentLane,
  lanesFrom,
  CONSOLIDATE_JSON_SCHEMA,
  CONSOLIDATE_SYSTEM,
  consolidateUserPrompt,
  isEvaluationModel,
  JEV_DIRECT_MODEL,
  jevModelFor,
  parseConsolidateOutput,
  sameProblemGroups,
  sameProblemRequest,
  TYPESAFE_API,
  withSameProblem,
  parseSummaryOutput,
  planConsolidation,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM,
  summaryInput,
  summaryIsCurrent,
  summaryRecord,
  summaryUserPrompt,
} from '@geld/review';
import type { Carried } from '@geld/review';
import { browser } from 'wxt/browser';
import type { JevDecision } from '../../lib/local-state';
import { aiGatewayItem, aiKeyItem, jevDecisionsItem, jevKeyItem } from '../../lib/local-state';
import type { AiCompleteRequest, AiEvaluateRequest } from '../../lib/messages';
import { isAiCompleteResponse, isAiEvaluateResponse } from '../../lib/messages';

/** What the model said about an item, kept for the visit. */
const rewrites = new Map<string, ConsolidateOutputItem>();
let summary: ReviewSummary | undefined;
/** Item ids (and `tldr`) a request is in flight for — the rows that shimmer. */
const inFlight = new Set<string>();
/**
 * Item ids this visit has already asked about, whatever the model answered.
 * Without this a model that cannot answer (an evaluation model picked as the
 * writer, a gateway that rejects the schema) was asked again on the very next
 * pass: rows shimmered on, off, on, and the page jumped with them.
 */
const attempted = new Set<string>();
let configured: boolean | null = null;

export function aiPending(): ReadonlySet<string> {
  return inFlight;
}

/**
 * Whether the prose model can be called: the master switch on, a gateway URL,
 * a writing model (never an evaluation model, which produces no text) and a
 * key on this device. With any of them missing, AI behaves as switched off.
 */
export async function aiConfigured(settings: GeldSettings): Promise<boolean> {
  if (!settings.aiEnabled || settings.aiBaseUrl === '' || settings.aiModel === '' || isEvaluationModel(settings.aiModel)) return false;
  if (configured === null) configured = (await aiKeyItem.getValue()).trim() !== '';
  return configured;
}

aiKeyItem.watch(() => {
  configured = null;
});

/** Where a Jev question goes: the gateway when it offers Jev, else TypeSafe with the user's own key; null when neither is set up. */
async function jevRoute(settings: GeldSettings): Promise<{ readonly baseUrl: string; readonly apiKey: string; readonly model: string } | null> {
  if (!settings.aiJev) return null;
  // The gateway's Jev: the id its model list named when models were loaded, else what is known about the host
  // (OpenRouter serves Jev without listing it), so a gateway checked before this was known still routes.
  const gateway = await aiGatewayItem.getValue();
  const gatewayJev = (gateway !== null && gateway.baseUrl === settings.aiBaseUrl ? gateway.jevModel : null) ?? jevModelFor(settings.aiBaseUrl);
  if (settings.aiBaseUrl !== '' && gatewayJev !== null) {
    const apiKey = (await aiKeyItem.getValue()).trim();
    return apiKey === '' ? null : { baseUrl: settings.aiBaseUrl, apiKey, model: gatewayJev };
  }
  const jevKey = (await jevKeyItem.getValue()).trim();
  return jevKey === '' ? null : { baseUrl: TYPESAFE_API, apiKey: jevKey, model: JEV_DIRECT_MODEL };
}

async function evaluate(route: { readonly baseUrl: string; readonly apiKey: string }, request: JevRequest): Promise<Readonly<Record<string, JevAnswer>> | null> {
  const message: AiEvaluateRequest = { type: 'geld:ai-evaluate', baseUrl: route.baseUrl, apiKey: route.apiKey, request };
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch {
    return null;
  }
  if (!isAiEvaluateResponse(response) || !response.ok) return null;
  return response.answers;
}

/**
 * With Jev on: ask which pending items report the same problem and send only
 * those, each told its partners, to the prose model; the rest keep their
 * reporters' wording. Without Jev (or when it cannot answer), everything goes
 * to the prose model as before, which then judges duplicates itself.
 */
async function decideScope(settings: GeldSettings, pending: readonly ConsolidateInputItem[]): Promise<readonly ConsolidateInputItem[]> {
  const route = await jevRoute(settings);
  if (route === null || pending.length < 2) return pending;
  const request = sameProblemRequest(route.model, pending);
  if (request === null) return [];
  const answers = await evaluate(route, request);
  if (answers === null) return pending;
  return withSameProblem(pending, sameProblemGroups(pending, answers));
}

/** Layer this visit's model output onto a meta built without it. */
export function withAi(meta: GeldPrMeta): GeldPrMeta {
  const previous: GeldPrMeta = { ...meta, items: meta.items.map((item) => (rewrites.has(item.id) ? { ...item, rewritten: true } : item)) };
  const items = applyConsolidation(previous.items, new Map<string, Carried>(), [...rewrites.values()]);
  const withItems = items === meta.items ? meta : { ...meta, items };
  if (summary !== undefined && withItems.summary === undefined && summaryIsCurrent(summary, items)) return { ...withItems, summary };
  return withItems;
}

async function complete(settings: GeldSettings, apiKey: string, system: string, user: string, jsonSchema: unknown, schemaName: string): Promise<string | null> {
  const message: AiCompleteRequest = {
    type: 'geld:ai-complete',
    baseUrl: settings.aiBaseUrl,
    apiKey,
    model: settings.aiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    jsonSchema,
    schemaName,
  };
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch {
    return null;
  }
  if (!isAiCompleteResponse(response) || !response.ok) return null;
  return response.text;
}

export interface ConsolidateRun {
  /** Something changed: re-apply to show it. */
  readonly changed: boolean;
}

/**
 * Consolidate bot-only items whose sources are new to this visit and write
 * (or refresh) the TL;DR. `onProgress` fires as soon as requests start, so
 * the rows can shimmer, and again when results land.
 */
export async function consolidateInBrowser(
  meta: GeldPrMeta,
  comments: readonly RawComment[],
  settings: GeldSettings,
  onProgress: () => void,
): Promise<ConsolidateRun> {
  if (meta.producer.ai || !(await aiConfigured(settings))) return { changed: false };
  const apiKey = (await aiKeyItem.getValue()).trim();
  if (apiKey === '') return { changed: false };
  const known: GeldPrMeta = withAi(meta);
  const plan = planConsolidation(known, meta.items, { comments, wantFix: settings.suggestedFixes === 'all' || settings.suggestedFixes === 'ai' });
  const pending = plan.pending.filter((item) => !inFlight.has(item.id) && !attempted.has(item.id));
  // A TL;DR the model could not write is not asked for again until the items it would describe change.
  const tldrKey = `tldr:${summaryInput(known.items)
    .map((item) => `${item.id}${item.status}`)
    .join(',')}`;
  const needsTldr = !inFlight.has('tldr') && !attempted.has(tldrKey) && summaryInput(known.items).length > 0 && !summaryIsCurrent(known.summary ?? summary, known.items);
  if (pending.length === 0 && !needsTldr) return { changed: false };

  for (const item of pending) inFlight.add(item.id);
  if (needsTldr) inFlight.add('tldr');
  onProgress();

  let changed = false;
  if (pending.length > 0) {
    const scope = await decideScope(settings, pending);
    if (scope.length > 0) {
      const text = await complete(settings, apiKey, CONSOLIDATE_SYSTEM, consolidateUserPrompt(scope), CONSOLIDATE_JSON_SCHEMA, 'geld_consolidate');
      const parsed = text === null ? null : parseConsolidateOutput(text, new Set(scope.map((item) => item.id)));
      if (parsed !== null && parsed.ok) {
        for (const entry of parsed.value) rewrites.set(entry.id, entry);
        changed = parsed.value.length > 0;
      }
    }
    for (const item of pending) {
      inFlight.delete(item.id);
      attempted.add(item.id);
    }
    // The rows stop shimmering either way; only a changed title is worth another pass.
    onProgress();
  }
  if (needsTldr) {
    const items = applyConsolidation(meta.items, new Map<string, Carried>(), [...rewrites.values()]);
    const text = await complete(settings, apiKey, SUMMARY_SYSTEM, summaryUserPrompt(summaryInput(items), summary?.tldr ?? null), SUMMARY_JSON_SCHEMA, 'geld_summary');
    const parsed = text === null ? null : parseSummaryOutput(text);
    if (parsed !== null && parsed.ok) {
      summary = summaryRecord(parsed.value, items, new Date().toISOString());
      changed = true;
    } else {
      attempted.add(tldrKey);
    }
    inFlight.delete('tldr');
    onProgress();
  }
  return { changed };
}

export function resetAiForVisit(): void {
  inFlight.clear();
  attempted.clear();
}

/** Titles the model has already rewritten for this visit (kept across page keys: ids are anchor hashes). */
export function rewrittenIds(): ReadonlySet<string> {
  return new Set(rewrites.keys());
}

export function itemsWithRewrite(items: readonly ReviewItem[]): readonly ReviewItem[] {
  return applyConsolidation(items, new Map<string, Carried>(), [...rewrites.values()]);
}


/* ------------------------------------------------------------------------- */
/* Jev as the stand-in for deterministic classification                       */
/* ------------------------------------------------------------------------- */

/**
 * With Jev on, the deterministic checks - "is this comment only a trigger
 * phrase", "is this bot comment a run-status line, a verdict, a report or a
 * finding", "do the replies say this thread is done" - are answered by Jev
 * from the text, in one request per batch, and only a confident answer
 * replaces the deterministic one. Answers are cached by a hash of the text
 * (`local:jevDecisions`), so a revisited page asks only about what changed,
 * and every answer is remembered for the visit so nothing is asked twice.
 */

/** FNV-1a over the text, as a short key. Collisions would only swap one cached lane for another; the text decides, not the anchor. */
function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

const DECISIONS_CAP = 3000;
let decisions: Map<string, JevDecision> | null = null;
let decisionsLoading: Promise<Map<string, JevDecision>> | null = null;
/** Hashes a request is in flight for, or that this visit already asked about without a usable answer. */
const asked = new Set<string>();

async function loadDecisions(): Promise<Map<string, JevDecision>> {
  if (decisions !== null) return decisions;
  decisionsLoading ??= jevDecisionsItem.getValue().then((stored) => {
    decisions ??= new Map(Object.entries(stored));
    return decisions;
  });
  return decisionsLoading;
}

async function storeDecisions(map: Map<string, JevDecision>): Promise<void> {
  if (map.size > DECISIONS_CAP) {
    const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, map.size - DECISIONS_CAP);
    for (const [key] of oldest) map.delete(key);
  }
  await jevDecisionsItem.setValue(Object.fromEntries(map));
}

export interface CommentToClassify {
  readonly anchor: string;
  readonly author: string;
  readonly bot: boolean;
  readonly body: string;
}

export interface ThreadToClassify {
  readonly itemId: string;
  readonly path?: string;
  readonly comments: readonly { readonly author: string; readonly body: string }[];
}

function commentHash(comment: CommentToClassify): string {
  return `c:${textHash(`${comment.author}\n${comment.bot ? 1 : 0}\n${comment.body}`)}`;
}

function threadHash(thread: ThreadToClassify): string {
  return `t:${textHash(thread.comments.map((comment) => `${comment.author}\n${comment.body}`).join('\n\u0000'))}`;
}

/** Jev's decisions as the current pass can use them: lanes by anchor, thread state by item id. */
export interface JevDecisions {
  readonly lanes: ReadonlyMap<string, CommentLane>;
  readonly done: ReadonlyMap<string, AddressedEvidence>;
}

const NO_DECISIONS: JevDecisions = { lanes: new Map(), done: new Map() };

/**
 * What Jev has already said about these comments and threads (from the cache,
 * synchronously when it is loaded), and a request for whatever it has not.
 * `onProgress` runs when new answers land, so the pass re-applies with them.
 */
export function jevDecisionsFor(settings: GeldSettings, comments: readonly CommentToClassify[], threads: readonly ThreadToClassify[], onProgress: () => void): JevDecisions {
  if (!settings.aiEnabled || !settings.aiJev) return NO_DECISIONS;
  const cache = decisions;
  if (cache === null) {
    void loadDecisions().then(onProgress);
    return NO_DECISIONS;
  }
  const lanes = new Map<string, CommentLane>();
  const done = new Map<string, AddressedEvidence>();
  const missingComments: Array<{ readonly hash: string; readonly comment: CommentToClassify }> = [];
  const missingThreads: Array<{ readonly hash: string; readonly thread: ThreadToClassify }> = [];
  for (const comment of comments) {
    const hash = commentHash(comment);
    const known = cache.get(hash);
    if (known?.lane !== undefined && isCommentLane(known.lane)) lanes.set(comment.anchor, known.lane);
    else if (known === undefined && !asked.has(hash)) missingComments.push({ hash, comment });
  }
  for (const thread of threads) {
    if (thread.comments.length < 2) continue;
    const hash = threadHash(thread);
    const known = cache.get(hash);
    if (known?.done !== undefined) done.set(thread.itemId, { verdict: known.done.verdict, evidence: [`Jev: ${Math.round(known.done.probability * 100)}% addressed`] });
    else if (known === undefined && !asked.has(hash)) missingThreads.push({ hash, thread });
  }
  if (missingComments.length + missingThreads.length > 0) void classify(settings, missingComments, missingThreads, onProgress);
  return { lanes, done };
}

async function classify(
  settings: GeldSettings,
  comments: ReadonlyArray<{ readonly hash: string; readonly comment: CommentToClassify }>,
  threads: ReadonlyArray<{ readonly hash: string; readonly thread: ThreadToClassify }>,
  onProgress: () => void,
): Promise<void> {
  for (const entry of comments) asked.add(entry.hash);
  for (const entry of threads) asked.add(entry.hash);
  const route = await jevRoute(settings);
  if (route === null) return;
  const laneInputs: LaneInput[] = comments.map((entry) => ({ id: entry.hash, author: entry.comment.author, bot: entry.comment.bot, text: entry.comment.body }));
  const threadInputs: ThreadInput[] = threads.map((entry) => {
    const [first, ...replies] = entry.thread.comments;
    return { id: entry.hash, ...(entry.thread.path === undefined ? {} : { path: entry.thread.path }), first: { author: first?.author ?? '', text: first?.body ?? '' }, replies: replies.map((reply) => ({ author: reply.author, text: reply.body })) };
  });
  const cache = await loadDecisions();
  let landed = false;
  for (const request of classificationRequests(route.model, laneInputs, threadInputs)) {
    const answers = await evaluate(route, request);
    if (answers === null) continue;
    const at = Date.now();
    for (const [hash, lane] of lanesFrom(answers)) cache.set(hash, { lane, at });
    for (const [hash, state] of doneFrom(answers)) cache.set(hash, { done: state, at });
    // A lane Jev was unsure about is remembered as asked (no lane), so the deterministic answer stands without re-asking.
    for (const key of Object.keys(request.questions)) {
      const hash = key.replace(/^(lane|done):/, '');
      if (!cache.has(hash)) cache.set(hash, { at });
    }
    landed = true;
  }
  if (!landed) return;
  await storeDecisions(cache);
  onProgress();
}

/** Items whose threads Jev judged addressed (or not) get that verdict, the way an LLM verdict would. */
export function withJevDone(meta: GeldPrMeta, done: ReadonlyMap<string, AddressedEvidence>): GeldPrMeta {
  if (done.size === 0) return meta;
  const neutral = { changedPaths: [], manualDoneIds: new Set<string>(), humanReplied: false };
  return { ...meta, items: meta.items.map((item) => (done.has(item.id) ? applyAddressed(item, neutral, done.get(item.id)) : item)) };
}
