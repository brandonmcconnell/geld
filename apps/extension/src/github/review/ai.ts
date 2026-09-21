/**
 * In-browser AI for a pull request whose digest the Action did not write with
 * AI: run when the reader asks (the AI control on the digest), never on its
 * own. The user's gateway key stays in `storage.local` (never the gist); the
 * background worker talks to the gateway. Nothing is sent without a key, URL
 * and model. What the model writes is stored on this device per pull request
 * (`local:aiRuns`) and layered onto every later pass, so a title never goes
 * back to the verbatim one across reloads; only items whose sources the last
 * run did not see are asked again (`planConsolidation`).
 */

import type { GeldSettings } from '@geld/core';
import type { AddressedEvidence, CommentLane, ConsolidateInputItem, ConsolidateOutputItem, GeldPrMeta, JevAnswer, JevRequest, LaneInput, Preview, PreviewStatusInput, RawComment, ReviewItem, ReviewSummary, ThreadInput } from '@geld/review';
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
  PREVIEW_STATUSES,
  previewStatusesFrom,
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
import type { AiRunRecord, JevDecision } from '../../lib/local-state';
import { AI_RUNS_CAP, aiGatewayItem, aiKeyItem, aiRunsItem, jevDecisionsItem, jevKeyItem, jevSourceItem } from '../../lib/local-state';
import type { AiCompleteRequest, AiEvaluateRequest } from '../../lib/messages';
import { isAiCompleteResponse, isAiEvaluateResponse } from '../../lib/messages';

/* ------------------------------------------------------------------------- */
/* On-demand runs, kept on this device per pull request                        */
/* ------------------------------------------------------------------------- */

/** What the model said about each item on this pull request, hydrated from the run store (`local:aiRuns`). */
const rewrites = new Map<string, ConsolidateOutputItem>();
let summary: ReviewSummary | undefined;
/** The pull request the module state belongs to, and its record as last stored. */
let runKey: string | null = null;
let lastRun: AiRunRecord | null = null;
let hydrating: Promise<void> | null = null;
/** Item ids (and `tldr`) a request is in flight for — the rows that shimmer. */
const inFlight = new Set<string>();
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

/** The same test without the key lookup, for a pass that cannot wait: the key is checked when the run starts. */
export function aiSwitchedOn(settings: GeldSettings): boolean {
  return settings.aiEnabled && settings.aiBaseUrl !== '' && settings.aiModel !== '' && !isEvaluationModel(settings.aiModel);
}

aiKeyItem.watch(() => {
  configured = null;
});

/**
 * Point the module at a pull request and load what the model last wrote for
 * it on this device. Resolves once the store has answered (`onLoaded` runs
 * then, so the pass can re-apply with the words); synchronous callers see the
 * previous page's words cleared at once.
 */
export function loadAiForPage(key: string, onLoaded: () => void): void {
  if (runKey === key) return;
  runKey = key;
  rewrites.clear();
  summary = undefined;
  lastRun = null;
  inFlight.clear();
  const loading = aiRunsItem.getValue().then((runs) => {
    if (runKey !== key) return;
    const record = runs[key];
    if (record !== undefined) adopt(record);
    onLoaded();
  });
  hydrating = loading;
  void loading.finally(() => {
    if (hydrating === loading) hydrating = null;
  });
}

function adopt(record: AiRunRecord): void {
  lastRun = record;
  rewrites.clear();
  for (const entry of record.rewrites) rewrites.set(entry.id, entry);
  summary = record.summary;
}

async function store(record: AiRunRecord | null): Promise<void> {
  if (runKey === null) return;
  const key = runKey;
  const runs = { ...(await aiRunsItem.getValue()) };
  if (record === null) delete runs[key];
  else runs[key] = record;
  const keys = Object.keys(runs);
  if (keys.length > AI_RUNS_CAP) {
    const oldest = keys.sort((a, b) => Date.parse(runs[a]?.ranAt ?? '') - Date.parse(runs[b]?.ranAt ?? '')).slice(0, keys.length - AI_RUNS_CAP);
    for (const stale of oldest) delete runs[stale];
  }
  await aiRunsItem.setValue(runs);
}

/** Forget this device's run for the pull request (the repository's Action now writes the digest). */
export async function clearAiForPage(): Promise<void> {
  rewrites.clear();
  summary = undefined;
  lastRun = null;
  await store(null);
}

/**
 * Where AI stands for this pull request, for the panel's control and its
 * notices. `app`: the digest comment was written with AI by the repository's
 * Action, which wins over anything local. `stale`: the model ran here, and
 * comments or threads have arrived since. `failed`: the last run here could
 * not get an answer, with the reason.
 */
export type AiState =
  | { readonly kind: 'off' }
  | { readonly kind: 'app'; readonly hasLocal: boolean }
  | { readonly kind: 'ready' }
  | { readonly kind: 'running' }
  | { readonly kind: 'current'; readonly ranAt: string }
  | { readonly kind: 'stale'; readonly ranAt: string }
  | { readonly kind: 'failed'; readonly ranAt: string; readonly error: string };

export function aiStateFor(meta: GeldPrMeta, comments: readonly RawComment[], settings: GeldSettings): AiState {
  if (meta.producer.ai) return { kind: 'app', hasLocal: lastRun !== null };
  if (!aiSwitchedOn(settings)) return { kind: 'off' };
  if (inFlight.size > 0) return { kind: 'running' };
  if (lastRun === null) return { kind: 'ready' };
  if (lastRun.error !== undefined) return { kind: 'failed', ranAt: lastRun.ranAt, error: lastRun.error };
  return hasWork(meta, comments, settings) ? { kind: 'stale', ranAt: lastRun.ranAt } : { kind: 'current', ranAt: lastRun.ranAt };
}

/** Whether a run now would ask the model anything: items whose sources the last run did not see, or a TL;DR behind the items. */
function hasWork(meta: GeldPrMeta, comments: readonly RawComment[], settings: GeldSettings): boolean {
  const known = withAi(meta);
  const plan = planConsolidation(known, meta.items, { comments, wantFix: settings.suggestedFixes === 'all' || settings.suggestedFixes === 'ai' });
  if (plan.pending.length > 0) return true;
  const input = summaryInput(known.items);
  return input.length > 0 && !summaryIsCurrent(known.summary ?? summary, known.items);
}

/** Where a Jev question goes: the gateway when it offers Jev, else TypeSafe with the user's own key; null when neither is set up. */
async function jevRoute(settings: GeldSettings): Promise<{ readonly baseUrl: string; readonly apiKey: string; readonly model: string } | null> {
  if (!settings.aiJev) return null;
  // The gateway's Jev: the id its model list named when models were loaded, else what is known about the host
  // (OpenRouter serves Jev without listing it), so a gateway checked before this was known still routes.
  const gateway = await aiGatewayItem.getValue();
  const gatewayJev = (gateway !== null && gateway.baseUrl === settings.aiBaseUrl ? gateway.jevModel : null) ?? jevModelFor(settings.aiBaseUrl);
  const jevKey = (await jevKeyItem.getValue()).trim();
  const own = { baseUrl: TYPESAFE_API, apiKey: jevKey, model: JEV_DIRECT_MODEL };
  // The user's own key wins only when they chose it ("Use one anyway"); the gateway is the default whenever it offers Jev.
  if (jevKey !== '' && (await jevSourceItem.getValue()) === 'own') return own;
  if (settings.aiBaseUrl !== '' && gatewayJev !== null) {
    const apiKey = (await aiKeyItem.getValue()).trim();
    return apiKey === '' ? null : { baseUrl: settings.aiBaseUrl, apiKey, model: gatewayJev };
  }
  return jevKey === '' ? null : own;
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

/** Layer this device's model output onto a meta built without it. */
export function withAi(meta: GeldPrMeta): GeldPrMeta {
  const previous: GeldPrMeta = { ...meta, items: meta.items.map((item) => (rewrites.has(item.id) ? { ...item, rewritten: true } : item)) };
  const items = applyConsolidation(previous.items, new Map<string, Carried>(), [...rewrites.values()]);
  const withItems = items === meta.items ? meta : { ...meta, items };
  if (summary !== undefined && withItems.summary === undefined && summaryIsCurrent(summary, items)) return { ...withItems, summary };
  return withItems;
}

type Completion = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

async function complete(settings: GeldSettings, apiKey: string, system: string, user: string, jsonSchema: unknown, schemaName: string): Promise<Completion> {
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
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The extension did not answer.' };
  }
  if (!isAiCompleteResponse(response)) return { ok: false, reason: 'The extension did not answer.' };
  return response.ok ? { ok: true, text: response.text } : { ok: false, reason: response.reason };
}

export interface ConsolidateRun {
  /** Something changed: re-apply to show it. */
  readonly changed: boolean;
}

/**
 * Run the model for this pull request, on the reader's request: consolidate
 * the open bot-only items whose sources the last run did not see and write
 * (or refresh) the TL;DR, then store the result on this device. `onProgress`
 * fires as soon as requests start, so the rows can shimmer, and again when
 * results land. A run that gets no usable answer is stored with its reason.
 */
export async function runAi(meta: GeldPrMeta, comments: readonly RawComment[], settings: GeldSettings, onProgress: () => void): Promise<ConsolidateRun> {
  if (meta.producer.ai || !(await aiConfigured(settings)) || inFlight.size > 0) return { changed: false };
  await hydrating;
  const apiKey = (await aiKeyItem.getValue()).trim();
  if (apiKey === '') return { changed: false };
  const known: GeldPrMeta = withAi(meta);
  const plan = planConsolidation(known, meta.items, { comments, wantFix: settings.suggestedFixes === 'all' || settings.suggestedFixes === 'ai' });
  const pending = plan.pending;
  const needsTldr = summaryInput(known.items).length > 0 && !summaryIsCurrent(known.summary ?? summary, known.items);
  const ranAt = new Date().toISOString();
  if (pending.length === 0 && !needsTldr) {
    // Nothing new to ask about: the run still counts, so the control says when the reader last looked.
    lastRun = { ranAt, rewrites: [...rewrites.values()], ...(summary === undefined ? {} : { summary }) };
    await store(lastRun);
    return { changed: true };
  }

  for (const item of pending) inFlight.add(item.id);
  if (needsTldr) inFlight.add('tldr');
  onProgress();

  let failure: string | null = null;
  if (pending.length > 0) {
    const scope = await decideScope(settings, pending);
    if (scope.length > 0) {
      const result = await complete(settings, apiKey, CONSOLIDATE_SYSTEM, consolidateUserPrompt(scope), CONSOLIDATE_JSON_SCHEMA, 'geld_consolidate');
      if (!result.ok) failure = result.reason;
      else {
        const parsed = parseConsolidateOutput(result.text, new Set(scope.map((item) => item.id)));
        if (parsed !== null && parsed.ok) for (const entry of parsed.value) rewrites.set(entry.id, entry);
        else failure = 'The model answered in a shape Geld could not read.';
      }
    }
    for (const item of pending) inFlight.delete(item.id);
    onProgress();
  }
  if (needsTldr && failure === null) {
    const items = applyConsolidation(meta.items, new Map<string, Carried>(), [...rewrites.values()]);
    const result = await complete(settings, apiKey, SUMMARY_SYSTEM, summaryUserPrompt(summaryInput(items), summary?.tldr ?? null), SUMMARY_JSON_SCHEMA, 'geld_summary');
    if (!result.ok) failure = result.reason;
    else {
      const parsed = parseSummaryOutput(result.text);
      if (parsed !== null && parsed.ok) summary = summaryRecord(parsed.value, items, ranAt);
      else failure = 'The model answered in a shape Geld could not read.';
    }
  }
  inFlight.delete('tldr');
  lastRun = { ranAt, rewrites: [...rewrites.values()], ...(summary === undefined ? {} : { summary }), ...(failure === null ? {} : { error: failure }) };
  await store(lastRun);
  onProgress();
  return { changed: true };
}

/** Titles the model has already rewritten for this pull request. */
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

/** A preview whose status the parser left `unknown`, with the comment text it came from. */
export interface PreviewToClassify {
  readonly preview: Preview;
  readonly text: string;
}

function previewHash(entry: PreviewToClassify): string {
  return `p:${textHash(`${entry.preview.host}\n${entry.preview.project}\n${entry.text}`)}`;
}

/** Jev's decisions as the current pass can use them: lanes by anchor, thread state by item id, preview states by `host:project@anchor`. */
export interface JevDecisions {
  readonly lanes: ReadonlyMap<string, CommentLane>;
  readonly done: ReadonlyMap<string, AddressedEvidence>;
  readonly previewStatus: ReadonlyMap<string, Preview['status']>;
}

export function previewDecisionKey(preview: Preview): string {
  return `${preview.host}:${preview.project}@${preview.anchor}`;
}

const NO_DECISIONS: JevDecisions = { lanes: new Map(), done: new Map(), previewStatus: new Map() };

/**
 * What Jev has already said about these comments and threads (from the cache,
 * synchronously when it is loaded), and a request for whatever it has not.
 * `onProgress` runs when new answers land, so the pass re-applies with them.
 */
export function jevDecisionsFor(settings: GeldSettings, comments: readonly CommentToClassify[], threads: readonly ThreadToClassify[], onProgress: () => void, previews: readonly PreviewToClassify[] = []): JevDecisions {
  if (!settings.aiEnabled || !settings.aiJev) return NO_DECISIONS;
  const cache = decisions;
  if (cache === null) {
    void loadDecisions().then(onProgress);
    return NO_DECISIONS;
  }
  const lanes = new Map<string, CommentLane>();
  const done = new Map<string, AddressedEvidence>();
  const previewStatus = new Map<string, Preview['status']>();
  const missingComments: Array<{ readonly hash: string; readonly comment: CommentToClassify }> = [];
  const missingThreads: Array<{ readonly hash: string; readonly thread: ThreadToClassify }> = [];
  const missingPreviews: Array<{ readonly hash: string; readonly entry: PreviewToClassify }> = [];
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
  for (const entry of previews) {
    const hash = previewHash(entry);
    const known = cache.get(hash);
    const status = known?.preview === undefined ? undefined : PREVIEW_STATUSES.find((candidate) => candidate === known.preview);
    if (status !== undefined) previewStatus.set(previewDecisionKey(entry.preview), status);
    else if (known === undefined && !asked.has(hash)) missingPreviews.push({ hash, entry });
  }
  if (missingComments.length + missingThreads.length + missingPreviews.length > 0) void classify(settings, missingComments, missingThreads, missingPreviews, onProgress);
  return { lanes, done, previewStatus };
}

async function classify(
  settings: GeldSettings,
  comments: ReadonlyArray<{ readonly hash: string; readonly comment: CommentToClassify }>,
  threads: ReadonlyArray<{ readonly hash: string; readonly thread: ThreadToClassify }>,
  previews: ReadonlyArray<{ readonly hash: string; readonly entry: PreviewToClassify }>,
  onProgress: () => void,
): Promise<void> {
  for (const entry of comments) asked.add(entry.hash);
  for (const entry of threads) asked.add(entry.hash);
  for (const entry of previews) asked.add(entry.hash);
  const route = await jevRoute(settings);
  if (route === null) return;
  const laneInputs: LaneInput[] = comments.map((entry) => ({ id: entry.hash, author: entry.comment.author, bot: entry.comment.bot, text: entry.comment.body }));
  const threadInputs: ThreadInput[] = threads.map((entry) => {
    const [first, ...replies] = entry.thread.comments;
    return { id: entry.hash, ...(entry.thread.path === undefined ? {} : { path: entry.thread.path }), first: { author: first?.author ?? '', text: first?.body ?? '' }, replies: replies.map((reply) => ({ author: reply.author, text: reply.body })) };
  });
  const previewInputs: PreviewStatusInput[] = previews.map((entry) => ({ id: entry.hash, host: entry.entry.preview.host, project: entry.entry.preview.project, text: entry.entry.text }));
  const cache = await loadDecisions();
  let landed = false;
  for (const request of classificationRequests(route.model, laneInputs, threadInputs, previewInputs)) {
    const answers = await evaluate(route, request);
    if (answers === null) continue;
    const at = Date.now();
    for (const [hash, lane] of lanesFrom(answers)) cache.set(hash, { lane, at });
    for (const [hash, state] of doneFrom(answers)) cache.set(hash, { done: state, at });
    for (const [hash, status] of previewStatusesFrom(answers)) cache.set(hash, { preview: status, at });
    // A lane Jev was unsure about is remembered as asked (no lane), so the deterministic answer stands without re-asking.
    for (const key of Object.keys(request.questions)) {
      const hash = key.replace(/^(lane|done|preview):/, '');
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
