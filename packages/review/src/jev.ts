import type { FetchLike } from './ai-client';
import { joinUrl } from './ai-client';

/**
 * TypeSafe's Jev is a System One model: it evaluates one piece of state
 * against typed questions and answers all of them in one parallel pass with
 * calibrated probabilities - a choice among options, a position on an ordered
 * scale, or the probability of "yes" (a "noul"). It generates no prose, so it
 * can never be the model that writes a title; it is the model that decides,
 * cheaply and fast, what the writing model should be asked to do.
 *
 * Reached two ways: through an AI gateway that offers it (Vercel AI Gateway
 * exposes the TypeSafe-compatible API under `/typesafe/v1/systemone` with the
 * gateway's own key and the model id `typesafe-ai/jev`), or directly at
 * `https://api.typesafe.ai/v1/systemone` with a TypeSafe key.
 */

export const TYPESAFE_API = 'https://api.typesafe.ai';
export const JEV_DIRECT_MODEL = 'jev-latest';

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
  | { readonly ok: false; readonly reason: string };

/** Does a model id name an evaluation model (Jev)? Such a model must never be offered as the prose model. */
export function isEvaluationModel(id: string): boolean {
  return /(^|[/:@-])jev(\b|[-.])/i.test(id) || /typesafe/i.test(id);
}

/** The Jev model id a gateway's model list offers, if any. */
export function jevModelIn(models: ReadonlyArray<{ readonly id: string }>): string | null {
  return models.find((model) => isEvaluationModel(model.id))?.id ?? null;
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

/**
 * Where to POST for `baseUrl`: TypeSafe's own API takes `/v1/systemone`;
 * OpenRouter takes its Decisions API; any other gateway takes the
 * TypeSafe-compatible prefix in front of `/v1/systemone`.
 */
export function jevEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const host = hostOf(base);
  if (/^api\.typesafe\.ai$/i.test(host)) return joinUrl(base, '/v1/systemone');
  if (/(^|\.)openrouter\.ai$/i.test(host)) return `https://${host}/api/alpha/decisions`;
  return joinUrl(base, '/typesafe/v1/systemone');
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

export async function evaluateJev(options: EvaluateOptions): Promise<JevResult> {
  if (options.apiKey === '') return { ok: false, reason: 'No API key.' };
  if (Object.keys(options.request.questions).length === 0) return { ok: true, model: options.request.model, answers: {} };
  const controller = options.timeoutMs === undefined ? null : new AbortController();
  const timer = controller === null || options.timeoutMs === undefined ? null : setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetch(jevEndpoint(options.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(options.request),
      ...(controller === null ? {} : { signal: controller.signal }),
    });
    if (!response.ok) return { ok: false, reason: `Jev request failed (${response.status}).` };
    const parsed = parseJevResponse(await response.json());
    if (parsed === null) return { ok: false, reason: 'Jev answered in an unexpected shape.' };
    return { ok: true, ...parsed };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Jev request failed.' };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
