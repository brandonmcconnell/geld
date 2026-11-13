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
import { persist } from '../../lib/context';
import { whenIdle } from '../../lib/idle';
import type { AddressedEvidence, CommentLane, ConsolidateInputItem, ConsolidateOutputItem, GeldPrMeta, JevAnswer, JevRequest, LaneInput, Preview, PreviewStatusInput, RawComment, ReviewItem, ReviewSummary, SuggestInputItem, SuggestPullRequest, ThreadInput } from '@geld/review';
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
  answersComplete,
  defaultDecisionModel,
  isJevModel,
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
  codeSpans,
  isBotOnly,
  isOpenStatus,
  numberedLines,
  parseSuggestOutput,
  sourceExcerpts,
  SUGGEST_JSON_SCHEMA,
  SUGGEST_SYSTEM,
  suggestUserPrompt,
} from '@geld/review';
import type { Carried } from '@geld/review';
import { browser } from 'wxt/browser';
import type { AiRunRecord, AiStep, JevDecision, StoredSuggestion } from '../../lib/local-state';
import { AI_RUNS_CAP, aiGatewayItem, aiKeyItem, aiRunsItem, jevDecisionsItem, jevKeyItem, jevSourceItem } from '../../lib/local-state';
import type { AiCompleteRequest, AiEvaluateRequest } from '../../lib/messages';
import { isAiCompleteResponse, isAiEvaluateResponse } from '../../lib/messages';
import { countUsage } from '../../lib/usage-count';

/* ------------------------------------------------------------------------- */
/* On-demand runs, kept on this device per pull request                        */
/* ------------------------------------------------------------------------- */

/** What the model said about each item on this pull request, hydrated from the run store (`local:aiRuns`). */
const rewrites = new Map<string, ConsolidateOutputItem>();
let summary: ReviewSummary | undefined;
/** Comment anchors the model has been shown on this pull request (`PlanOptions.seen`). */
const seen = new Set<string>();
/** The triage's fixes, by the thread they are for. */
const suggestions = new Map<string, StoredSuggestion>();
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
  seen.clear();
  suggestions.clear();
  lastRun = null;
  inFlight.clear();
  const loading = aiRunsItem.getValue().then(
    (runs) => {
      if (runKey !== key) return;
      const record = runs[key];
      if (record !== undefined) adopt(record);
      onLoaded();
    },
    () => undefined,
  );
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
  seen.clear();
  for (const anchor of record.seen ?? []) seen.add(anchor);
  suggestions.clear();
  for (const entry of record.suggestions ?? []) suggestions.set(entry.key, entry);
}

interface AiFailure {
  readonly step?: AiStep;
  readonly reason: string;
}

function recordOf(ranAt: string, failure: AiFailure | null): AiRunRecord {
  return {
    ranAt,
    rewrites: [...rewrites.values()],
    ...(summary === undefined ? {} : { summary }),
    ...(failure === null ? {} : { error: failure.reason, ...(failure.step === undefined ? {} : { errorStep: failure.step }) }),
    seen: [...seen],
    suggestions: [...suggestions.values()],
  };
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
  seen.clear();
  suggestions.clear();
  lastRun = null;
  await store(null);
}

/**
 * Where AI stands for this pull request, for the panel's control and its
 * notices. `app`: the digest comment was written with AI by the repository's
 * Action, which wins over anything local. `nothing`: no review thread is open,
 * so there is nothing to ask the model about. `stale`: the model ran here, and
 * comments or threads have arrived since. `failed`: the last run here could
 * not get an answer, with the reason.
 */
export type AiState =
  | { readonly kind: 'off' }
  | { readonly kind: 'app'; readonly hasLocal: boolean }
  | { readonly kind: 'ready' }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'running' }
  | { readonly kind: 'current'; readonly ranAt: string }
  | { readonly kind: 'stale'; readonly ranAt: string; readonly reason: StaleReason }
  | { readonly kind: 'failed'; readonly ranAt: string; readonly error: string; readonly step?: AiStep };

/** What a run now would read that the last one did not: new comments or threads, or commits its fixes predate. */
export type StaleReason = 'comments' | 'commits';

export function aiStateFor(meta: GeldPrMeta, comments: readonly RawComment[], settings: GeldSettings): AiState {
  if (meta.producer.ai) return { kind: 'app', hasLocal: lastRun !== null };
  if (!aiSwitchedOn(settings)) return { kind: 'off' };
  if (inFlight.size > 0) return { kind: 'running' };
  // The model is only ever asked about open review threads: with none, a click would ask it nothing.
  if (summaryInput(withAi(meta).items).length === 0) return { kind: 'nothing' };
  if (lastRun === null) return { kind: 'ready' };
  if (lastRun.error !== undefined) return { kind: 'failed', ranAt: lastRun.ranAt, error: lastRun.error, ...(lastRun.errorStep === undefined ? {} : { step: lastRun.errorStep }) };
  const work = workFor(meta, comments, settings);
  return work === null ? { kind: 'current', ranAt: lastRun.ranAt } : { kind: 'stale', ranAt: lastRun.ranAt, reason: work };
}

function wantFix(settings: GeldSettings): boolean {
  return settings.suggestedFixes === 'all' || settings.suggestedFixes === 'ai';
}

/**
 * Whether the triage proposes fixes. They are what the reader asked for by running it, so only `off` stops them:
 * `bots` and `ai` choose which fixes stand on an item (`fixVisible`), as the setting's copy says.
 */
export function triageFixesOn(settings: GeldSettings): boolean {
  return settings.suggestedFixes !== 'off';
}

const anchorsOf = (items: readonly ReviewItem[]): readonly string[] => items.flatMap((item) => item.sources.map((source) => source.anchor));

/** The fix was written from every comment its threads hold now: no reply arrived since that it has not read. */
function writtenFrom(entry: StoredSuggestion, items: readonly ReviewItem[]): boolean {
  if (entry.sources === undefined) return true;
  const read = new Set(entry.sources);
  return anchorsOf(items).every((anchor) => read.has(anchor));
}

/**
 * What a run now would ask the model about, if anything: comments it has not been shown, a TL;DR behind the open
 * items, or findings whose fix was written for an earlier commit. Null when a run would change nothing, so the panel
 * offers no run that would only cost a request.
 */
function workFor(meta: GeldPrMeta, comments: readonly RawComment[], settings: GeldSettings): StaleReason | null {
  const known = withAi(meta);
  const plan = planConsolidation(known, meta.items, { comments, wantFix: wantFix(settings), seen });
  if (plan.pending.length > 0) return 'comments';
  const input = summaryInput(known.items);
  if (input.length > 0 && !summaryIsCurrent(known.summary ?? summary, known.items)) return 'comments';
  if (!triageFixesOn(settings)) return null;
  for (const item of suggestionCandidates(meta.items)) {
    const existing = suggestionFor(threadKeyOf(item));
    if (existing === undefined) return 'comments';
    if (existing.state !== 'open') continue;
    if (!writtenFrom(existing, [item])) return 'comments';
    if (existing.headSha !== meta.headSha) return 'commits';
  }
  return null;
}

/** The first comment's anchor of the item's review thread: it stays when replies join, unlike the item's id. */
export function threadKeyOf(item: ReviewItem): string {
  return item.sources.find((source) => source.kind === 'thread')?.anchor ?? '';
}

/** Open bot findings on a review thread, the ones a fix can be proposed for. People's requests stay theirs to settle. */
function suggestionCandidates(items: readonly ReviewItem[]): readonly ReviewItem[] {
  return items.filter((item) => isOpenStatus(item.status) && isBotOnly(item) && item.path !== undefined && threadKeyOf(item) !== '');
}

function suggestionFor(threadKey: string): StoredSuggestion | undefined {
  const own = suggestions.get(threadKey);
  if (own !== undefined) return own;
  for (const entry of suggestions.values()) if (entry.threads.includes(threadKey)) return entry;
  return undefined;
}

/**
 * Where a decision goes: the model the reader chose, at the gateway; else, automatically, the gateway's Jev or
 * its own decision model; else Jev at TypeSafe with the reader's own key. Null when none of these is set up.
 */
async function jevRoute(settings: GeldSettings): Promise<{ readonly baseUrl: string; readonly apiKey: string; readonly model: string } | null> {
  if (!settings.aiJev) return null;
  // Read from the gateway's model list as stored when models were loaded (not the stored pick, which earlier builds
  // made from the first decision model of any maker), else from what is known about the host, so a gateway checked
  // before this was known still routes.
  const gateway = await aiGatewayItem.getValue();
  const listed = gateway !== null && gateway.baseUrl === settings.aiBaseUrl ? gateway.models.map((id) => gateway.details?.[id] ?? { id }) : [];
  const automatic = defaultDecisionModel(settings.aiBaseUrl, listed);
  // A pick made for another gateway is not sent to one that serves no decision model.
  const gatewayModel = automatic !== null && settings.aiDecisionModel !== '' ? settings.aiDecisionModel : automatic;
  const jevKey = (await jevKeyItem.getValue()).trim();
  const own = { baseUrl: TYPESAFE_API, apiKey: jevKey, model: JEV_DIRECT_MODEL };
  // The user's own key wins only when they chose it ("Use one anyway"); the gateway is the default whenever it serves a decision model.
  if (jevKey !== '' && (await jevSourceItem.getValue()) === 'own') return own;
  if (settings.aiBaseUrl !== '' && gatewayModel !== null) {
    const apiKey = (await aiKeyItem.getValue()).trim();
    return apiKey === '' ? null : { baseUrl: settings.aiBaseUrl, apiKey, model: gatewayModel };
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
  // Unanswered pairs would read as "no partner" and leave every finding unrewritten; the prose model decides instead.
  if (answers === null || !answersComplete(request, answers)) return pending;
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

/** What the triage needs from the page to propose fixes: the pull request's intent, and each finding's lines. */
export interface SuggestionSource {
  readonly pull: SuggestPullRequest;
  /** The lines the finding's thread is on and the whole file at the head, or null when its thread takes no suggestion (outdated, unreadable). */
  readonly target: (item: ReviewItem) => Promise<SuggestionTarget | null>;
}

export interface SuggestionTarget {
  readonly path: string;
  readonly start: number;
  readonly end: number;
  /** The file at the head, line 1 first. */
  readonly lines: readonly string[];
}

/** Findings asked about in one request: enough for one pull request's open threads, few enough to keep the answer reliable. */
const SUGGEST_BATCH = 12;
const SUGGEST_MARGIN = 25;

/**
 * Run the model for this pull request, on the reader's request: consolidate the open bot-only items whose comments the
 * model has not been shown, write (or refresh) the TL;DR, and propose a fix for each open bot finding that has none for
 * this commit, then store it all on this device. Nothing is asked that was asked before: a finding the model left as
 * reported, or a fix whose lines did not change across a push, costs no request. `onProgress` fires as requests start,
 * so the rows can shimmer, and again when results land. A run that gets no usable answer is stored with its reason.
 */
export async function runAi(meta: GeldPrMeta, comments: readonly RawComment[], settings: GeldSettings, onProgress: () => void, source: SuggestionSource | null = null): Promise<ConsolidateRun> {
  if (meta.producer.ai || !(await aiConfigured(settings)) || inFlight.size > 0) return { changed: false };
  await hydrating;
  const apiKey = (await aiKeyItem.getValue()).trim();
  if (apiKey === '') return { changed: false };
  const known: GeldPrMeta = withAi(meta);
  const plan = planConsolidation(known, meta.items, { comments, wantFix: wantFix(settings), seen });
  const pending = plan.pending;
  const needsTldr = summaryInput(known.items).length > 0 && !summaryIsCurrent(known.summary ?? summary, known.items);
  const needsFixes = source !== null && triageFixesOn(settings) && workFor(meta, comments, settings) !== null;
  const ranAt = new Date().toISOString();
  if (pending.length === 0 && !needsTldr && !needsFixes) return { changed: false };
  countUsage('ai_triage_run');

  for (const item of pending) inFlight.add(item.id);
  if (needsTldr) inFlight.add('tldr');
  if (needsFixes) inFlight.add('suggest');
  onProgress();

  let failure: AiFailure | null = null;
  if (pending.length > 0) {
    const scope = await decideScope(settings, pending);
    if (scope.length > 0) {
      const result = await complete(settings, apiKey, CONSOLIDATE_SYSTEM, consolidateUserPrompt(scope), CONSOLIDATE_JSON_SCHEMA, 'geld_consolidate');
      if (!result.ok) failure = { step: 'findings', reason: result.reason };
      else {
        const parsed = parseConsolidateOutput(result.text, new Set(scope.map((item) => item.id)));
        if (parsed !== null && parsed.ok) for (const entry of parsed.value) rewrites.set(entry.id, entry);
        else failure = { step: 'findings', reason: UNREADABLE };
      }
    }
    // Shown to the model or judged to need nothing from it: either way, not asked again until a new comment joins.
    if (failure === null) for (const item of pending) for (const anchor of item.sources) seen.add(anchor);
    for (const item of pending) inFlight.delete(item.id);
    onProgress();
  }
  const items = applyConsolidation(meta.items, new Map<string, Carried>(), [...rewrites.values()]);
  if (needsTldr && failure === null) {
    const result = await complete(settings, apiKey, SUMMARY_SYSTEM, summaryUserPrompt(summaryInput(items), summary?.tldr ?? null), SUMMARY_JSON_SCHEMA, 'geld_summary');
    if (!result.ok) failure = { step: 'tldr', reason: result.reason };
    else {
      const parsed = parseSummaryOutput(result.text);
      const paths = items.flatMap((item) => (item.path === undefined ? [] : [item.path]));
      if (parsed !== null && parsed.ok) summary = summaryRecord(codeSpans(parsed.value, paths), items, ranAt);
      else failure = { step: 'tldr', reason: UNREADABLE };
    }
  }
  inFlight.delete('tldr');
  onProgress();
  if (needsFixes && source !== null && failure === null) {
    const reason = await proposeFixes(meta.headSha, items, comments, settings, apiKey, source);
    if (reason !== null) failure = { step: 'fixes', reason };
  }
  inFlight.delete('suggest');
  if (failure !== null) countUsage('ai_triage_failed');
  lastRun = recordOf(ranAt, failure);
  await store(lastRun);
  onProgress();
  return { changed: true };
}

const UNREADABLE = 'The model answered in a shape Geld could not read.';

/**
 * Fixes for the open bot findings that have none for this commit. A fix written for an earlier commit whose lines read
 * the same now is carried to this one without asking; the rest are asked about together, so findings reporting one
 * problem can share a fix. Resolves with the reason when the model could not answer.
 */
async function proposeFixes(headSha: string, items: readonly ReviewItem[], comments: readonly RawComment[], settings: GeldSettings, apiKey: string, source: SuggestionSource): Promise<string | null> {
  const asks: Array<{ readonly item: ReviewItem; readonly target: SuggestionTarget }> = [];
  // Threads that own their fix first: a partner reads what became of the fix it shares.
  const owns = (item: ReviewItem): boolean => (suggestionFor(threadKeyOf(item))?.key ?? threadKeyOf(item)) === threadKeyOf(item);
  const candidates = [...suggestionCandidates(items)].sort((a, b) => Number(owns(b)) - Number(owns(a)));
  const openThreads = new Set(candidates.map(threadKeyOf));
  for (const item of candidates) {
    const key = threadKeyOf(item);
    const existing = suggestionFor(key);
    if (existing !== undefined && existing.state !== 'open') continue;
    const fresh = existing !== undefined && writtenFrom(existing, [item]);
    if (existing !== undefined && fresh && existing.headSha === headSha) continue;
    const target = await source.target(item);
    if (target === null) {
      // Unreadable or outdated here: this thread leaves any fix it shared and gets a placeholder of its own for this
      // commit, so the next run does not count it as behind. A shared fix written for its lines goes, and its partners
      // are asked about on their own.
      const shared = existing === undefined ? undefined : suggestions.get(existing.key);
      if (shared !== undefined && shared.threads.length > 1) {
        if (shared.key === key) suggestions.delete(key);
        else suggestions.set(shared.key, { ...shared, threads: shared.threads.filter((thread) => thread !== key) });
      }
      const ownNote = existing?.key === key && existing.threads.length === 1 && existing.replacement === null ? existing.summary : '';
      suggestions.set(key, { key, threads: [key], headSha, path: item.path ?? '', start: 0, end: 0, original: [], replacement: null, summary: ownNote, state: 'open', sources: [...anchorsOf([item])] });
      continue;
    }
    if (existing !== undefined && existing.key !== key) {
      // A partner follows the fix it shares while that fix's own thread is open and nothing new arrived in its own.
      const shared = suggestions.get(existing.key);
      if (fresh && openThreads.has(existing.key) && shared !== undefined) continue;
      if (shared !== undefined) suggestions.set(existing.key, { ...shared, threads: shared.threads.filter((thread) => thread !== key) });
      asks.push({ item, target });
      continue;
    }
    const original = target.lines.slice(target.start - 1, target.end);
    if (existing !== undefined && fresh && existing.key === key && existing.start === target.start && existing.end === target.end && existing.original.join('\n') === original.join('\n')) {
      suggestions.set(key, { ...existing, headSha });
      continue;
    }
    asks.push({ item, target });
  }
  const byTitle = new Map<string, string[]>();
  for (const { item } of asks) byTitle.set(item.title, [...(byTitle.get(item.title) ?? []), threadKeyOf(item)]);
  for (let at = 0; at < asks.length; at += SUGGEST_BATCH) {
    const batch = asks.slice(at, at + SUGGEST_BATCH);
    const inputs: SuggestInputItem[] = batch.map(({ item, target }) => {
      const key = threadKeyOf(item);
      const partners = (byTitle.get(item.title) ?? []).filter((other) => other !== key);
      return {
        id: key,
        title: item.title,
        ...(item.context === undefined ? {} : { context: item.context }),
        path: target.path,
        excerpts: sourceExcerpts(comments, item),
        target: { start: target.start, end: target.end, text: target.lines.slice(target.start - 1, target.end).join('\n') },
        around: numberedLines(target.lines, target.start, target.end, SUGGEST_MARGIN),
        ...(partners.length === 0 ? {} : { sameProblemAs: partners }),
      };
    });
    const result = await complete(settings, apiKey, SUGGEST_SYSTEM, suggestUserPrompt(source.pull, inputs), SUGGEST_JSON_SCHEMA, 'geld_suggest');
    if (!result.ok) return result.reason;
    const parsed = parseSuggestOutput(result.text, inputs);
    if (parsed === null) return UNREADABLE;
    const targets = new Map(batch.map(({ item, target }) => [threadKeyOf(item), target]));
    const asked = new Map(batch.map(({ item }) => [threadKeyOf(item), item]));
    const paths = items.flatMap((item) => (item.path === undefined ? [] : [item.path]));
    for (const entry of parsed) {
      const key = entry.ids[0] ?? '';
      const target = targets.get(key);
      if (target === undefined) continue;
      for (const other of entry.ids.slice(1)) suggestions.delete(other);
      suggestions.set(key, {
        key,
        threads: entry.ids,
        headSha,
        path: target.path,
        start: target.start,
        end: target.end,
        original: target.lines.slice(target.start - 1, target.end),
        replacement: entry.replacement,
        summary: codeSpans(entry.summary, paths),
        state: 'open',
        sources: [...anchorsOf(entry.ids.flatMap((id) => asked.get(id) ?? []))],
      });
    }
  }
  return null;
}

/** A fix the triage proposed, as the panel shows it: its finding's current title and whether it is for the head. */
export interface TriageSuggestion {
  readonly entry: StoredSuggestion;
  /** The finding the fix is for (the first of the threads it answers). */
  readonly item: ReviewItem;
  /** The other findings it settles with the same change. */
  readonly partners: readonly ReviewItem[];
  /** Written at the head commit from every comment its threads hold: an earlier commit or a reply since makes it stale. */
  readonly current: boolean;
}

/**
 * The triage's rows: a fix for each finding still open (or a note that it needs an agent, where no fix fits its lines),
 * and fixes applied while their finding stands.
 */
export function triageSuggestions(meta: GeldPrMeta, settings: GeldSettings): readonly TriageSuggestion[] {
  if (!triageFixesOn(settings)) return [];
  const byThread = new Map(meta.items.map((item) => [threadKeyOf(item), item]));
  const out: TriageSuggestion[] = [];
  for (const entry of suggestions.values()) {
    if (entry.state === 'discarded') continue;
    const item = byThread.get(entry.key);
    if (item === undefined) continue;
    if (entry.state === 'open' && !isOpenStatus(item.status)) continue;
    const partners = entry.threads.slice(1).flatMap((key) => {
      const partner = byThread.get(key);
      return partner === undefined ? [] : [partner];
    });
    out.push({ entry, item, partners, current: entry.headSha === meta.headSha && writtenFrom(entry, [item, ...partners]) });
  }
  return out;
}

/** What the triage said is needed where no fix fits a finding's lines, for the hand-off to an agent. */
export function triageNoteFor(item: ReviewItem): string | null {
  const entry = suggestionFor(threadKeyOf(item));
  return entry === undefined || entry.summary === '' ? null : entry.summary;
}

async function settle(key: string, state: StoredSuggestion['state'], anchors: readonly string[] = []): Promise<void> {
  const entry = suggestions.get(key);
  if (entry === undefined) return;
  suggestions.set(key, { ...entry, state, ...(entry.sources === undefined ? {} : { sources: [...entry.sources, ...anchors] }) });
  // Geld's own reply in the thread is not news for the model.
  for (const anchor of anchors) seen.add(anchor);
  if (lastRun !== null) {
    lastRun = recordOf(lastRun.ranAt, lastRun.error === undefined ? null : { reason: lastRun.error, ...(lastRun.errorStep === undefined ? {} : { step: lastRun.errorStep }) });
    await store(lastRun);
  }
}

export function discardSuggestion(key: string): Promise<void> {
  return settle(key, 'discarded');
}

export function markSuggestionApplied(key: string, replyAnchor: string | null): Promise<void> {
  return settle(key, 'applied', replyAnchor === null ? [] : [replyAnchor]);
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

/** A model's answers are its own: Jev's stay under the bare key they were always stored under, any other model's carry its id. */
function saltFor(model: string): string {
  return isJevModel(model) ? '' : `${textHash(model)}.`;
}

/**
 * The salt of the model that would answer now, read from the route (the pick, automatic, or the reader's own
 * TypeSafe key), which takes storage reads; the synchronous pass uses the last one read. It is read again when
 * something the route depends on changes: the settings it takes, or the gateway list, keys and key choice.
 */
let routeSalt: { readonly key: string; readonly salt: string | null } | null = null;
let routeVersion = 0;
let routeReading: string | null = null;
for (const item of [aiGatewayItem, aiKeyItem, jevKeyItem, jevSourceItem]) item.watch(() => (routeVersion += 1));

function currentSalt(settings: GeldSettings, onProgress: () => void): string | null | undefined {
  const key = `${routeVersion}\n${settings.aiBaseUrl}\n${settings.aiDecisionModel}`;
  if (routeSalt?.key === key) return routeSalt.salt;
  if (routeReading !== key) {
    routeReading = key;
    void jevRoute(settings).then((route) => {
      if (routeReading === key) routeReading = null;
      routeSalt = { key, salt: route === null ? null : saltFor(route.model) };
      onProgress();
    });
  }
  return undefined;
}

function commentHash(comment: CommentToClassify, salt: string): string {
  return `c:${salt}${textHash(`${comment.author}\n${comment.bot ? 1 : 0}\n${comment.body}`)}`;
}

function threadHash(thread: ThreadToClassify, salt: string): string {
  return `t:${salt}${textHash(thread.comments.map((comment) => `${comment.author}\n${comment.body}`).join('\n\u0000'))}`;
}

/** A preview whose status the parser left `unknown`, with the comment text it came from. */
export interface PreviewToClassify {
  readonly preview: Preview;
  readonly text: string;
}

function previewHash(entry: PreviewToClassify, salt: string): string {
  return `p:${salt}${textHash(`${entry.preview.host}\n${entry.preview.project}\n${entry.text}`)}`;
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
    persist(loadDecisions().then(onProgress));
    return NO_DECISIONS;
  }
  const salt = currentSalt(settings, onProgress);
  // Until the answering model is known (or with none set up), no cached answer can be told apart as its own.
  if (salt === undefined || salt === null) return NO_DECISIONS;
  const lanes = new Map<string, CommentLane>();
  const done = new Map<string, AddressedEvidence>();
  const previewStatus = new Map<string, Preview['status']>();
  const missingComments: Array<{ readonly hash: string; readonly comment: CommentToClassify }> = [];
  const missingThreads: Array<{ readonly hash: string; readonly thread: ThreadToClassify }> = [];
  const missingPreviews: Array<{ readonly hash: string; readonly entry: PreviewToClassify }> = [];
  for (const comment of comments) {
    const hash = commentHash(comment, salt);
    const known = cache.get(hash);
    if (known?.lane !== undefined && isCommentLane(known.lane)) lanes.set(comment.anchor, known.lane);
    else if (known === undefined && !asked.has(hash)) missingComments.push({ hash, comment });
  }
  for (const thread of threads) {
    if (thread.comments.length < 2) continue;
    const hash = threadHash(thread, salt);
    const known = cache.get(hash);
    if (known?.done !== undefined) done.set(thread.itemId, { verdict: known.done.verdict, evidence: [`Jev: ${Math.round(known.done.probability * 100)}% addressed`] });
    else if (known === undefined && !asked.has(hash)) missingThreads.push({ hash, thread });
  }
  for (const entry of previews) {
    const hash = previewHash(entry, salt);
    const known = cache.get(hash);
    const status = known?.preview === undefined ? undefined : PREVIEW_STATUSES.find((candidate) => candidate === known.preview);
    if (status !== undefined) previewStatus.set(previewDecisionKey(entry.preview), status);
    else if (known === undefined && !asked.has(hash)) missingPreviews.push({ hash, entry });
  }
  // The submission waits for an idle moment: passes come in bursts while a page loads, and the last one of the
  // burst knows every comment; an earlier request still waiting is replaced, so the batch goes out once.
  if (missingComments.length + missingThreads.length + missingPreviews.length > 0) {
    whenIdle('jev-submit', () => persist(classify(settings, salt, missingComments, missingThreads, missingPreviews, onProgress)));
  }
  return { lanes, done, previewStatus };
}

async function classify(
  settings: GeldSettings,
  salt: string,
  comments: ReadonlyArray<{ readonly hash: string; readonly comment: CommentToClassify }>,
  threads: ReadonlyArray<{ readonly hash: string; readonly thread: ThreadToClassify }>,
  previews: ReadonlyArray<{ readonly hash: string; readonly entry: PreviewToClassify }>,
  onProgress: () => void,
): Promise<void> {
  // Marked before the route is read, so a pass meanwhile does not submit them again.
  const hashes = [...comments, ...threads, ...previews].map((entry) => entry.hash);
  for (const hash of hashes) asked.add(hash);
  const route = await jevRoute(settings);
  // The questions were keyed for the model the pass expected; another one answering now would file its answers under them.
  // Nothing was sent, so they were not asked: a later pass under that model asks them again.
  if (route === null || saltFor(route.model) !== salt) {
    for (const hash of hashes) asked.delete(hash);
    return;
  }
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
