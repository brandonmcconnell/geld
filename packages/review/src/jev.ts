import type { FetchLike, Refusal } from './ai-client';
import { joinUrl, providerMessage, refusalFrom } from './ai-client';

/**
 * TypeSafe's Jev is a System One model: it evaluates one piece of state
 * against typed questions and answers all of them in one parallel pass with
 * calibrated probabilities - a choice among options, a position on an ordered
 * scale, or the probability of "yes" (a "noul"). It generates no prose, so it
 * can never be the model that writes a title; it is the model that decides,
 * cheaply and fast, what the writing model should be asked to do.
 *
 * Other makers now serve decision models too (OpenAI's GPT-6 Luna Decisions,
 * Perplexity's Decider, Liquid's d1…), in one of two request formats:
 * TypeSafe's (`state`, a map of `noul`/`choice`/`score` questions), spoken by
 * TypeSafe itself, OpenRouter's Decisions API for every model it serves, and
 * Vercel's `/typesafe` prefix for Jev; or OpenAI's Decisions API (`input`, a
 * list of `predicate`/`choice`/`score` questions answered with `probability`),
 * spoken by OpenAI and by Vercel's `/v1/decisions` for any model it lists.
 * Requests and answers are written in TypeSafe's shape throughout Geld and
 * translated at the wire (`decisionRoute`).
 */

export const TYPESAFE_API = 'https://api.typesafe.ai';
export const JEV_DIRECT_MODEL = 'jev-latest';
const OPENAI_DECISION_MODEL = 'gpt-6-luna';

export type JevQuestion =
  | { readonly type: 'noul'; readonly instructions: string; readonly criteria?: Readonly<Record<'true' | 'false', string>> }
  | { readonly type: 'choice'; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
  | { readonly type: 'score'; readonly instructions: string; readonly criteria: readonly string[] };

export type JevAnswer =
  | { readonly type: 'noul'; readonly noul: number }
  | { readonly type: 'choice'; readonly choice: string; readonly confidence: number; readonly probabilities: Readonly<Record<string, number>> }
  | { readonly type: 'score'; readonly score: number; readonly confidence: number; readonly probabilities: Readonly<Record<string, number>> };

/** The state Jev evaluates: a string, or (preferred) a structured object whose fields the questions name in backticks. */
export type JevState = string | Readonly<Record<string, unknown>> | readonly unknown[];

export interface JevRequest {
  readonly model: string;
  readonly state: JevState;
  readonly questions: Readonly<Record<string, JevQuestion>>;
}

export type JevResult =
  | { readonly ok: true; readonly model: string; readonly answers: Readonly<Record<string, JevAnswer>> }
  | Refusal;

const JEV_ID = /(^|[/:@-])jev(\b|[-.])/i;
const UNPINNED_JEV_ID = /(^|\/)jev(-latest)?$/i;

/** Does a model id name an evaluation model (Jev)? Such a model must never be offered as the prose model. Vercel now calls them decision models. */
export function isEvaluationModel(id: string, type?: string): boolean {
  if (type !== undefined) return type === 'evaluation' || type === 'decision';
  return JEV_ID.test(id) || /typesafe/i.test(id);
}

/**
 * The Jev model id a gateway's model list offers, if any, the unpinned one first. Chosen by name, never by
 * type: Vercel lists Baseten's, Perplexity's and OpenAI's decision models under the same `evaluation` type,
 * and Geld's questions are written for Jev.
 */
export function jevModelIn(models: ReadonlyArray<{ readonly id: string }>): string | null {
  const jev = models.filter((model) => JEV_ID.test(model.id));
  return (jev.find((model) => UNPINNED_JEV_ID.test(model.id)) ?? jev[0])?.id ?? null;
}

/**
 * Gateways known to serve Jev without listing it among their chat models.
 * OpenRouter runs it on its Decisions API, outside `/api/v1`, and its
 * `/api/v1/models` does not name it; `typesafe/jev-latest` follows TypeSafe's
 * latest release (a pinned `typesafe/jev-1.13` also exists).
 */
const KNOWN_JEV: ReadonlyArray<{ readonly host: RegExp; readonly model: string }> = [
  { host: /(^|\.)openrouter\.ai$/i, model: 'typesafe/jev-latest' },
  { host: /(^|\.)ai-gateway\.vercel\.sh$/i, model: 'typesafe-ai/jev' },
  { host: /^api\.typesafe\.ai$/i, model: JEV_DIRECT_MODEL },
];

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

/** The Jev model a gateway serves: from its model list when it names one, else from what is known about the host. */
export function jevModelFor(baseUrl: string, models: ReadonlyArray<{ readonly id: string }> = []): string | null {
  const listed = jevModelIn(models);
  if (listed !== null) return listed;
  const host = hostOf(baseUrl);
  return KNOWN_JEV.find((entry) => entry.host.test(host))?.model ?? null;
}

const TYPESAFE_HOST = /^api\.typesafe\.ai$/i;
const OPENROUTER_HOST = /(^|\.)openrouter\.ai$/i;
const OPENAI_HOST = /^api\.openai\.com$/i;

/** Whether an id names Jev, under any gateway's spelling (`typesafe-ai/jev`, `typesafe/jev-latest`, `jev-1.13.0`). */
export function isJevModel(id: string): boolean {
  return JEV_ID.test(id);
}

/**
 * Whether a model from OpenRouter's decisions catalog answers on its Decisions API: the catalog also holds
 * extraction-only models (`cloudflare/clairic`, served at `/api/alpha/extractions`). A model naming no endpoints is kept.
 */
export function servesDecisions(model: { readonly endpoints?: readonly string[] }): boolean {
  return model.endpoints === undefined || model.endpoints.some((path) => /\/decisions$/.test(path));
}

/** The decision models a gateway's list offers: typed as decision models (Vercel), or named as Jev. */
export function decisionModelsIn<T extends { readonly id: string; readonly type?: string }>(models: readonly T[]): readonly T[] {
  return models.filter((model) => (model.type !== undefined && isEvaluationModel(model.id, model.type)) || JEV_ID.test(model.id));
}

/**
 * Where a gateway lists its decision models, when not among its chat models: OpenRouter filters its catalog by
 * output modality. Null means the gateway's own `/v1/models` (Vercel types them there).
 */
export function decisionModelsPath(baseUrl: string): string | null {
  return OPENROUTER_HOST.test(hostOf(baseUrl)) ? '/v1/models?output_modalities=decisions' : null;
}

/** Decision models a host serves without listing them apart from its text models. */
export function knownDecisionModels(baseUrl: string): readonly string[] {
  const host = hostOf(baseUrl);
  if (TYPESAFE_HOST.test(host)) return [JEV_DIRECT_MODEL];
  if (OPENAI_HOST.test(host)) return [OPENAI_DECISION_MODEL];
  return [];
}

/** The decision model to use when the reader picks none: Jev where offered, else the gateway's own, else the first it lists. */
export function defaultDecisionModel(baseUrl: string, models: ReadonlyArray<{ readonly id: string; readonly type?: string }> = []): string | null {
  return jevModelFor(baseUrl, models) ?? knownDecisionModels(baseUrl)[0] ?? decisionModelsIn(models)[0]?.id ?? null;
}

export type DecisionWire = 'typesafe' | 'openai';

export interface DecisionRoute {
  readonly url: string;
  readonly wire: DecisionWire;
}

/**
 * Where to POST a decision for `model` at `baseUrl`, and in which format. TypeSafe and OpenRouter speak
 * TypeSafe's format for every model; Vercel serves Jev under its TypeSafe-compatible prefix (`noul` and its
 * criteria reach Jev as written) and every decision model, Jev included, at OpenAI's `/v1/decisions`, which
 * is also OpenAI's own. An unknown gateway is asked the way Vercel is.
 */
export function decisionRoute(baseUrl: string, model: string): DecisionRoute {
  const base = baseUrl.replace(/\/+$/, '');
  const host = hostOf(base);
  if (TYPESAFE_HOST.test(host)) return { url: joinUrl(base, '/v1/systemone'), wire: 'typesafe' };
  if (OPENROUTER_HOST.test(host)) return { url: `https://${host}/api/alpha/decisions`, wire: 'typesafe' };
  if (!OPENAI_HOST.test(host) && JEV_ID.test(model)) return { url: joinUrl(base, '/typesafe/v1/systemone'), wire: 'typesafe' };
  return { url: joinUrl(base, '/v1/decisions'), wire: 'openai' };
}

type OpenAiDecisionQuestion =
  | { readonly type: 'predicate'; readonly name: string; readonly instructions: string }
  | { readonly type: 'choice'; readonly name: string; readonly instructions: string; readonly choices: readonly { readonly value: string; readonly description: string }[] }
  | { readonly type: 'score'; readonly name: string; readonly instructions: string; readonly levels: readonly { readonly label: string }[] };

/**
 * A TypeSafe-shaped request in OpenAI's Decisions format. A predicate has no criteria, so a `noul`'s go into its
 * instructions. Questions are named `q0`, `q1`… (Geld's ids hold colons, which a stricter name rule may refuse);
 * `names` maps them back.
 */
export function openAiDecisionsBody(request: JevRequest): { readonly body: { readonly model: string; readonly input: string; readonly questions: readonly OpenAiDecisionQuestion[] }; readonly names: ReadonlyMap<string, string> } {
  const names = new Map<string, string>();
  const questions = Object.entries(request.questions).map(([id, question], index): OpenAiDecisionQuestion => {
    const name = `q${index}`;
    names.set(name, id);
    if (question.type === 'choice') {
      return { type: 'choice', name, instructions: question.instructions, choices: Object.entries(question.criteria).map(([value, description]) => ({ value, description })) };
    }
    if (question.type === 'score') return { type: 'score', name, instructions: question.instructions, levels: question.criteria.map((label) => ({ label })) };
    const criteria = question.criteria === undefined ? '' : `\nYes means: ${question.criteria.true}\nNo means: ${question.criteria.false}`;
    return { type: 'predicate', name, instructions: `${question.instructions}${criteria}` };
  });
  return { body: { model: request.model, input: typeof request.state === 'string' ? request.state : JSON.stringify(request.state), questions }, names };
}

/** `[{ value, probability }]` as TypeSafe's `{ value: probability }`. */
function probabilityList(value: unknown): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (isRecord(entry) && (typeof entry.value === 'string' || typeof entry.value === 'number' || typeof entry.value === 'boolean') && typeof entry.probability === 'number') out[String(entry.value)] = entry.probability;
  }
  return out;
}

/** An OpenAI Decisions answer list as TypeSafe's answer map, under Geld's ids. A refused question is left out, as an unanswered one is. */
export function parseOpenAiDecisions(body: unknown, names: ReadonlyMap<string, string>): { readonly model: string; readonly answers: Readonly<Record<string, JevAnswer>> } | null {
  if (!isRecord(body) || !Array.isArray(body.answers)) return null;
  const answers: Record<string, JevAnswer> = {};
  for (const raw of body.answers) {
    const id = isRecord(raw) && typeof raw.name === 'string' ? names.get(raw.name) : undefined;
    if (!isRecord(raw) || id === undefined) continue;
    const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;
    if (raw.type === 'predicate' && typeof raw.probability === 'number') answers[id] = { type: 'noul', noul: raw.probability };
    else if (raw.type === 'choice' && (typeof raw.choice === 'string' || typeof raw.choice === 'boolean')) {
      answers[id] = { type: 'choice', choice: String(raw.choice), confidence, probabilities: probabilityList(raw.probabilities) };
    } else if (raw.type === 'score' && typeof raw.score === 'number') answers[id] = { type: 'score', score: raw.score, confidence, probabilities: probabilityList(raw.probabilities) };
  }
  return { model: typeof body.model === 'string' ? body.model : '', answers };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberMap(value: unknown): Readonly<Record<string, number>> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number') return null;
    out[key] = entry;
  }
  return out;
}

function parseAnswer(value: unknown): JevAnswer | null {
  if (!isRecord(value)) return null;
  if (value.type === 'noul' && typeof value.noul === 'number') return { type: 'noul', noul: value.noul };
  if (value.type === 'choice' && typeof value.choice === 'string') {
    const probabilities = numberMap(value.probabilities) ?? {};
    return { type: 'choice', choice: value.choice, confidence: typeof value.confidence === 'number' ? value.confidence : 0, probabilities };
  }
  if (value.type === 'score' && typeof value.score === 'number') {
    const probabilities = numberMap(value.probabilities) ?? {};
    return { type: 'score', score: value.score, confidence: typeof value.confidence === 'number' ? value.confidence : 0, probabilities };
  }
  return null;
}

/** The answers of a System One response, or null when the body is not one. */
export function parseJevResponse(body: unknown): { readonly model: string; readonly answers: Readonly<Record<string, JevAnswer>> } | null {
  if (!isRecord(body) || !isRecord(body.answers)) return null;
  const answers: Record<string, JevAnswer> = {};
  for (const [id, raw] of Object.entries(body.answers)) {
    const answer = parseAnswer(raw);
    if (answer === null) return null;
    answers[id] = answer;
  }
  return { model: typeof body.model === 'string' ? body.model : '', answers };
}

export interface EvaluateOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly request: JevRequest;
  readonly timeoutMs?: number;
}

/** Ask a decision model, in whichever format its gateway speaks; the answers come back in TypeSafe's shape either way. */
export async function evaluateDecision(options: EvaluateOptions): Promise<JevResult> {
  if (options.apiKey === '') return { ok: false, reason: 'No API key.' };
  if (Object.keys(options.request.questions).length === 0) return { ok: true, model: options.request.model, answers: {} };
  const route = decisionRoute(options.baseUrl, options.request.model);
  const controller = options.timeoutMs === undefined ? null : new AbortController();
  const timer = controller === null || options.timeoutMs === undefined ? null : setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const openai = route.wire === 'openai' ? openAiDecisionsBody(options.request) : null;
    // Detached first: a browser's native fetch called as `options.fetch(…)` throws "Illegal invocation".
    const fetchImpl = options.fetch;
    const response = await fetchImpl(route.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(openai === null ? options.request : openai.body),
      ...(controller === null ? {} : { signal: controller.signal }),
    });
    if (!response.ok) {
      const message = providerMessage(await response.text().catch(() => ''), options.apiKey);
      return refusalFrom('Decision request failed', response.status, message);
    }
    // A parse error's message can quote the body, which is the gateway's text: an unreadable body is the shape failure below.
    const body: unknown = await response.json().catch(() => null);
    const parsed = openai === null ? parseJevResponse(body) : parseOpenAiDecisions(body, openai.names);
    if (parsed === null) return { ok: false, reason: 'The decision model answered in an unexpected shape.' };
    return { ok: true, ...parsed };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Decision request failed.' };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
