import type { GeldSettings } from '@geld/core';
import type { AddressedEvidence, GeldPrMeta, JevRequest, ProviderReviewComment, ProviderReviewInput, RawComment, ReviewItem, ReviewSummary, ThreadInput } from '@geld/review';
import {
  applyAddressed, applyConsolidation, buildProviderReviewItems, classificationRequests,
  CONSOLIDATE_JSON_SCHEMA, CONSOLIDATE_SYSTEM, consolidateUserPrompt, doneFrom,
  isEvaluationModel, isOpenStatus, JEV_DIRECT_MODEL, jevModelFor, META_VERSION, parseConsolidateOutput,
  parseSummaryOutput, planConsolidation, providerReviewKey, sameProblemGroups,
  sameProblemRequest, SUMMARY_JSON_SCHEMA, SUMMARY_SYSTEM, summaryInput,
  summaryIsCurrent, summaryRecord, summaryUserPrompt, TYPESAFE_API, withSameProblem,
} from '@geld/review';
import { browser } from 'wxt/browser';
import { hasGatewayPermission } from '../lib/ai-gateway';
import type { AiRunRecord } from '../lib/local-state';
import type { AiCompleteRequest, AiEvaluateRequest } from '../lib/messages';
import { isAiCompleteResponse, isAiEvaluateResponse } from '../lib/messages';

interface ProviderAiCache {
  readonly headSha: string;
  readonly sourceKeys: Readonly<Record<string, string>>;
  readonly summaryKey: string;
  readonly skipped: readonly string[];
  readonly done: Readonly<Record<string, { readonly verdict: 'yes' | 'no' | 'unclear'; readonly probability: number }>>;
}

interface ProviderAiRunRecord extends AiRunRecord { readonly providerAi: ProviderAiCache }
interface JevRoute { readonly baseUrl: string; readonly apiKey: string; readonly model: string }

export interface ProviderAiDependencies {
  readonly readKey: () => Promise<string>;
  readonly permission: (baseUrl: string) => Promise<string | null>;
  readonly readRuns: () => Promise<Readonly<Record<string, AiRunRecord>>>;
  readonly writeRuns: (runs: Readonly<Record<string, AiRunRecord>>) => Promise<void>;
  readonly send: (message: AiCompleteRequest | AiEvaluateRequest) => Promise<unknown>;
  readonly jevRoute: (settings: GeldSettings, key: string) => Promise<JevRoute | null>;
  readonly now: () => string;
}

export interface ProviderAiState {
  readonly kind: 'idle' | 'running' | 'ready' | 'error';
  readonly key: string | null;
  readonly pending: ReadonlySet<string>;
  readonly stale: boolean;
  readonly summary?: ReviewSummary;
  readonly ranAt?: string;
  readonly error?: string;
}

const defaults: ProviderAiDependencies = {
  readKey: async () => (await import('../lib/local-state')).aiKeyItem.getValue(),
  permission: hasGatewayPermission,
  readRuns: async () => (await import('../lib/local-state')).aiRunsItem.getValue(),
  writeRuns: async (runs) => (await import('../lib/local-state')).aiRunsItem.setValue(runs),
  send: (message) => browser.runtime.sendMessage(message),
  now: () => new Date().toISOString(),
  jevRoute: async (settings, key) => {
    if (!settings.aiJev) return null;
    const { aiGatewayItem, jevKeyItem, jevSourceItem } = await import('../lib/local-state');
    const gateway = await aiGatewayItem.getValue();
    const model = (gateway?.baseUrl === settings.aiBaseUrl ? gateway.jevModel : null) ?? jevModelFor(settings.aiBaseUrl);
    const ownKey = (await jevKeyItem.getValue()).trim();
    if (ownKey !== '' && (await jevSourceItem.getValue()) === 'own') return { baseUrl: TYPESAFE_API, apiKey: ownKey, model: JEV_DIRECT_MODEL };
    if (model !== null) return { baseUrl: settings.aiBaseUrl, apiKey: key, model };
    return ownKey === '' ? null : { baseUrl: TYPESAFE_API, apiKey: ownKey, model: JEV_DIRECT_MODEL };
  },
};

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function cacheFrom(record: AiRunRecord | null): ProviderAiCache | null {
  const value: unknown = record === null ? null : Reflect.get(record, 'providerAi');
  if (!isRecord(value) || typeof value.headSha !== 'string' || typeof value.summaryKey !== 'string' || !isRecord(value.sourceKeys) || !isRecord(value.done)) return null;
  const sourceKeys: Record<string, string> = {};
  for (const [id, key] of Object.entries(value.sourceKeys)) {
    if (typeof key !== 'string') return null;
    sourceKeys[id] = key;
  }
  const done: Record<string, { verdict: 'yes' | 'no' | 'unclear'; probability: number }> = {};
  for (const [id, answer] of Object.entries(value.done)) {
    if (!isRecord(answer) || (answer.verdict !== 'yes' && answer.verdict !== 'no' && answer.verdict !== 'unclear') || typeof answer.probability !== 'number' || !Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) return null;
    done[id] = { verdict: answer.verdict, probability: answer.probability };
  }
  const skipped: string[] = [];
  if (Array.isArray(value.skipped)) for (const entry of value.skipped) { const id: unknown = entry; if (typeof id !== 'string') return null; skipped.push(id); }
  return { headSha: value.headSha, summaryKey: value.summaryKey, sourceKeys, done, skipped };
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rawComments(input: ProviderReviewInput, comments: readonly ProviderReviewComment[]): readonly RawComment[] {
  const output = new Map<string, RawComment>();
  for (const comment of comments) output.set(comment.anchor, { anchor: comment.anchor, author: comment.author.login, authorId: comment.author.id, body: comment.body, createdAt: comment.createdAt, kind: 'comment' });
  for (const thread of input.threads) for (const comment of thread.comments) output.set(comment.anchor, {
    anchor: comment.anchor, author: comment.author.login, authorId: comment.author.id, body: comment.body,
    createdAt: comment.createdAt, kind: 'thread', ...(thread.path === undefined ? {} : { path: thread.path }),
  });
  return [...output.values()];
}

interface Context {
  readonly key: string;
  readonly input: ProviderReviewInput;
  readonly settings: GeldSettings;
  readonly items: readonly ReviewItem[];
  readonly comments: readonly RawComment[];
  readonly eligible: ReadonlySet<string>;
  readonly sourceKeys: Readonly<Record<string, string>>;
  readonly summaryKey: string;
}

let storeQueue: Promise<void> = Promise.resolve();

/** Loads and overlays device-local results; only an explicit run calls the gateway. */
export class ProviderAiTriage {
  private generation = 0;
  private signature = '';
  private context: Context | null = null;
  private record: AiRunRecord | null = null;
  private loading: Promise<void> = Promise.resolve();
  private value: ProviderAiState = { kind: 'idle', key: null, pending: new Set(), stale: false };
  private readonly dependencies: ProviderAiDependencies;

  constructor(private readonly changed: (state: ProviderAiState) => void, dependencies: Partial<ProviderAiDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  get state(): ProviderAiState { return this.value; }

  async load(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], settings: GeldSettings): Promise<void> {
    const key = providerReviewKey(input.subject);
    const signature = JSON.stringify([input, comments, settings.aiEnabled, settings.aiBaseUrl, settings.aiModel, settings.aiJev, settings.suggestedFixes]);
    if (signature === this.signature) return this.loading;
    this.generation += 1;
    const generation = this.generation;
    this.signature = signature;
    this.context = null;
    this.record = null;
    this.emit({ kind: 'idle', key, pending: new Set(), stale: false });
    this.loading = (async () => {
      const items = buildProviderReviewItems(input);
      const raw = rawComments(input, comments);
      const byAnchor = new Map(raw.map((comment) => [comment.anchor, comment]));
      const trusted = new Set((input.bots ?? []).map((bot) => bot.authorId));
      const eligible = new Set(items.filter((item) => item.sources.length > 0 && item.sources.every((source) => source.bot !== undefined && source.authorId !== undefined && trusted.has(source.authorId))).map((item) => item.id));
      const sourceKeys = Object.fromEntries(await Promise.all(items.map(async (item) => [item.id, await fingerprint(item.sources.map((source) => [source, byAnchor.get(source.anchor)]))])));
      const summaryKey = await fingerprint([input.subject.headSha, sourceKeys, items.map((item) => [item.id, item.status, item.title]), [...eligible]]);
      const runs = await this.dependencies.readRuns();
      if (generation !== this.generation) return;
      this.context = { key, input, settings, items, comments: raw, eligible, sourceKeys, summaryKey };
      this.record = runs[key] ?? null;
      this.publish();
    })().catch((error: unknown) => {
      if (generation === this.generation) this.fail(error);
    });
    return this.loading;
  }

  apply(items: readonly ReviewItem[]): readonly ReviewItem[] {
    const context = this.context;
    const cache = cacheFrom(this.record);
    if (context === null || cache === null || !context.settings.aiEnabled) return items;
    const rewrites = (this.record?.rewrites ?? []).filter((entry) => context.eligible.has(entry.id) && cache.sourceKeys[entry.id] === context.sourceKeys[entry.id]);
    const rewritten = applyConsolidation(items, new Map(), rewrites);
    if (cache.headSha !== context.input.subject.headSha || !context.settings.aiJev) return rewritten;
    return rewritten.map((item) => {
      const answer = cache.done[item.id];
      if (answer === undefined || cache.sourceKeys[item.id] !== context.sourceKeys[item.id]) return item;
      const semantic: AddressedEvidence = { verdict: answer.verdict, evidence: [`AI interpreted later discussion (${Math.round(answer.probability * 100)}%); native resolution is unchanged`] };
      return applyAddressed(item, { changedPaths: [], manualDoneIds: new Set(), humanReplied: false }, semantic);
    });
  }

  cancel(): void {
    this.generation += 1;
    this.signature = '';
    this.publish();
  }

  reset(): void {
    this.generation += 1;
    this.signature = '';
    this.context = null;
    this.record = null;
    this.emit({ kind: 'idle', key: null, pending: new Set(), stale: false });
  }

  async run(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], settings: GeldSettings): Promise<void> {
    await this.load(input, comments, settings);
    const context = this.context;
    if (context === null || this.value.kind === 'running') return;
    const generation = this.generation;
    const current = (): boolean => generation === this.generation && this.context === context;
    let next = this.record;
    let attempted = false;
    this.emit({ kind: 'running', key: context.key, pending: new Set(), stale: true, ...(this.record === null ? {} : { ranAt: this.record.ranAt }) });
    try {
      if (!settings.aiEnabled) throw new Error('Enable AI in Geld settings before running triage.');
      if (settings.aiBaseUrl.trim() === '' || settings.aiModel.trim() === '' || isEvaluationModel(settings.aiModel)) throw new Error('Choose an AI gateway and a writing model in Geld settings.');
      const apiKey = (await this.dependencies.readKey()).trim();
      if (!current()) return;
      if (apiKey === '') throw new Error('Add an AI gateway key on this device in Geld settings.');
      const permission = await this.dependencies.permission(settings.aiBaseUrl);
      if (!current()) return;
      if (permission !== null) throw new Error(permission);
      const previousCache = cacheFrom(this.record);
      const known = this.apply(context.items).map((item) => previousCache !== null && previousCache.sourceKeys[item.id] === context.sourceKeys[item.id] && previousCache.skipped.includes(item.id) ? { ...item, rewritten: true } : item);
      const plan = planConsolidation(this.meta(context, known), context.items.filter((item) => context.eligible.has(item.id)), { comments: context.comments, wantFix: settings.suggestedFixes === 'all' || settings.suggestedFixes === 'ai' });
      const pending = new Set(plan.pending.map((item) => item.id));
      this.emit({ kind: 'running', key: context.key, pending, stale: true, ...(this.record === null ? {} : { ranAt: this.record.ranAt }) });
      let done: ProviderAiCache['done'] = previousCache?.headSha === input.subject.headSha ? Object.fromEntries(Object.entries(previousCache.done).filter(([id]) => previousCache.sourceKeys[id] === context.sourceKeys[id])) : {};
      const rewrites = new Map((this.record?.rewrites ?? []).filter((entry) => context.eligible.has(entry.id) && previousCache?.sourceKeys[entry.id] === context.sourceKeys[entry.id]).map((entry) => [entry.id, entry]));
      const route = await this.dependencies.jevRoute(settings, apiKey);
      if (!current()) return;
      let prose = plan.pending;
      if (route !== null) {
        const allowed = await this.dependencies.permission(route.baseUrl);
        if (!current()) return;
        if (allowed !== null) throw new Error(allowed);
        const threads = this.semanticThreads(context, done);
        for (const request of classificationRequests(route.model, [], threads)) {
          attempted = true;
          const answers = await this.evaluate(route, request);
          if (!current()) return;
          done = { ...done, ...Object.fromEntries(doneFrom(answers)) };
        }
        const scope = sameProblemRequest(route.model, prose);
        if (scope !== null) {
          attempted = true;
          const answers = await this.evaluate(route, scope);
          if (!current()) return;
          prose = withSameProblem(prose, sameProblemGroups(prose, answers));
        }
      }
      if (prose.length > 0) {
        attempted = true;
        const text = await this.complete(settings, apiKey, CONSOLIDATE_SYSTEM, consolidateUserPrompt(prose), CONSOLIDATE_JSON_SCHEMA, 'geld_consolidate');
        if (!current()) return;
        const output = parseConsolidateOutput(text, new Set(prose.map((item) => item.id)));
        if (!output.ok) throw new Error(output.issues.join('; '));
        if (new Set(output.value.map((item) => item.id)).size !== prose.length) throw new Error('The AI response omitted review items.');
        for (const entry of output.value) rewrites.set(entry.id, entry);
      }
      const skipped = [...(previousCache?.skipped ?? []).filter((id) => previousCache?.sourceKeys[id] === context.sourceKeys[id]), ...plan.pending.filter((item) => !prose.some((candidate) => candidate.id === item.id)).map((item) => item.id)];
      const cache: ProviderAiCache = { headSha: input.subject.headSha, sourceKeys: context.sourceKeys, summaryKey: this.record?.summary === undefined ? context.summaryKey : previousCache?.summaryKey ?? '', done, skipped };
      let completed: ProviderAiRunRecord = { ranAt: this.dependencies.now(), rewrites: [...rewrites.values()], providerAi: cache, ...(this.record?.summary === undefined ? {} : { summary: this.record.summary }) };
      next = completed;
      const original = this.record;
      this.record = next;
      const items = this.apply(context.items);
      this.record = original;
      const previousSummary = previousCache?.summaryKey === context.summaryKey ? this.record?.summary : undefined;
      if (summaryInput(items).length > 0 && !summaryIsCurrent(previousSummary, items)) {
        this.emit({ ...this.value, pending: new Set(['tldr']) });
        attempted = true;
        const text = await this.complete(settings, apiKey, SUMMARY_SYSTEM, summaryUserPrompt(summaryInput(items), this.record?.summary?.tldr ?? null), SUMMARY_JSON_SCHEMA, 'geld_summary');
        if (!current()) return;
        const output = parseSummaryOutput(text);
        if (!output.ok) throw new Error(output.issues.join('; '));
        completed = { ...completed, summary: summaryRecord(output.value, items, completed.ranAt), providerAi: { ...cache, summaryKey: context.summaryKey } };
      } else if (previousSummary !== undefined) completed = { ...completed, summary: previousSummary, providerAi: { ...cache, summaryKey: context.summaryKey } };
      else if (summaryInput(items).length === 0) completed = { ranAt: completed.ranAt, rewrites: completed.rewrites, providerAi: { ...cache, summaryKey: context.summaryKey } };
      next = completed;
      if (!current()) return;
      await this.persist(context.key, completed, current);
      if (!current()) return;
      this.record = completed;
      this.publish();
    } catch (error) {
      if (!current()) return;
      const reason = error instanceof Error ? error.message : 'AI triage failed.';
      const empty: ProviderAiRunRecord = { ranAt: this.dependencies.now(), rewrites: [], providerAi: { headSha: input.subject.headSha, sourceKeys: {}, summaryKey: '', done: {}, skipped: [] } };
      const preserved = next ?? this.record ?? (attempted ? empty : null);
      if (preserved !== null) {
        const record = { ...preserved, error: reason };
        try { await this.persist(context.key, record, current); } catch { /* Keep the earlier successful local record. */ }
        if (!current()) return;
        this.record = record;
      }
      this.fail(error);
    }
  }

  private semanticThreads(context: Context, done: ProviderAiCache['done']): readonly ThreadInput[] {
    return context.items.flatMap((item) => {
      if (done[item.id] !== undefined || item.status === 'resolved' || item.status === 'outdated') return [];
      const thread = context.input.threads.find((candidate) => candidate.comments.length > 1 && candidate.comments.some((comment) => item.sources.some((source) => source.anchor === comment.anchor)));
      const first = thread?.comments[0];
      if (thread === undefined || first === undefined) return [];
      return [{ id: item.id, ...(thread.path === undefined ? {} : { path: thread.path }), first: { author: first.author.login, text: first.body }, replies: thread.comments.slice(1).map((comment) => ({ author: comment.author.login, text: comment.body })) }];
    });
  }

  private meta(context: Context, items: readonly ReviewItem[]): GeldPrMeta {
    return { v: META_VERSION, headSha: context.input.subject.headSha, generatedAt: this.dependencies.now(), producer: { kind: 'app', version: '1', ai: false }, items, bots: [], reviewers: [], fold: { comments: [], events: [] } };
  }

  private async complete(settings: GeldSettings, apiKey: string, system: string, user: string, jsonSchema: unknown, schemaName: string): Promise<string> {
    const response = await this.dependencies.send({ type: 'geld:ai-complete', baseUrl: settings.aiBaseUrl, apiKey, model: settings.aiModel, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], jsonSchema, schemaName });
    if (!isAiCompleteResponse(response)) throw new Error('The AI gateway returned an unexpected response.');
    if (!response.ok) throw new Error(response.reason);
    return response.text;
  }

  private async evaluate(route: JevRoute, request: JevRequest) {
    const response = await this.dependencies.send({ type: 'geld:ai-evaluate', baseUrl: route.baseUrl, apiKey: route.apiKey, request });
    if (!isAiEvaluateResponse(response)) throw new Error('The AI decision gateway returned an unexpected response.');
    if (!response.ok) throw new Error(response.reason);
    return response.answers;
  }

  private async persist(key: string, record: AiRunRecord, current: () => boolean): Promise<void> {
    const write = storeQueue.catch(() => undefined).then(async () => {
      if (!current()) return;
      const runs = { ...(await this.dependencies.readRuns()), [key]: record };
      if (!current()) return;
      const { AI_RUNS_CAP } = await import('../lib/local-state');
      if (!current()) return;
      const oldest = Object.keys(runs).sort((a, b) => Date.parse(runs[a]?.ranAt ?? '') - Date.parse(runs[b]?.ranAt ?? '')).slice(0, Math.max(0, Object.keys(runs).length - AI_RUNS_CAP));
      for (const stale of oldest) delete runs[stale];
      await this.dependencies.writeRuns(runs);
    });
    storeQueue = write;
    return write;
  }

  private publish(): void {
    const context = this.context;
    if (context === null) { this.emit({ kind: 'idle', key: null, pending: new Set(), stale: false }); return; }
    const cache = cacheFrom(this.record);
    const items = this.apply(context.items);
    const summary = cache?.summaryKey === context.summaryKey && summaryIsCurrent(this.record?.summary, items) ? this.record?.summary : undefined;
    const stale = cache === null || cache.summaryKey !== context.summaryKey || (summaryInput(items).length > 0 && summary === undefined) || context.items.some((item) => isOpenStatus(item.status) && context.eligible.has(item.id) && (cache.sourceKeys[item.id] !== context.sourceKeys[item.id] || (!(this.record?.rewrites.some((entry) => entry.id === item.id) ?? false) && !cache.skipped.includes(item.id))));
    this.emit({ kind: this.record?.error !== undefined ? 'error' : this.record === null ? 'idle' : 'ready', key: context.key, pending: new Set(), stale, ...(summary === undefined || !context.settings.aiEnabled ? {} : { summary }), ...(this.record === null ? {} : { ranAt: this.record.ranAt }), ...(this.record?.error === undefined ? {} : { error: this.record.error }) });
  }

  private fail(error: unknown): void {
    this.emit({ ...this.value, kind: 'error', pending: new Set(), error: error instanceof Error ? error.message : 'AI triage failed.' });
  }

  private emit(state: ProviderAiState): void { this.value = state; this.changed(state); }
}
