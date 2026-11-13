/**
 * OpenAI-compatible chat completions. No SDK. `fetch` is injected so this
 * module stays free of browser/Node APIs. Never called unless the caller
 * already has a user/repo key.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatCompletionOptions {
  readonly fetch: FetchLike;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly jsonSchema?: unknown;
  readonly schemaName?: string;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type ChatCompletionResult =
  | { readonly ok: true; readonly text: string; readonly model: string }
  | { readonly ok: false; readonly reason: string; readonly status?: number };

/** What a gateway's `/v1/models` says about a model, beyond its id, when it says anything (Vercel and OpenRouter both do). */
export interface ModelInfo {
  readonly id: string;
  readonly name?: string;
  /** Who makes it (`owned_by`, or the id's prefix). */
  readonly provider?: string;
  /** Context window in tokens (`context_window` on Vercel, `context_length` on OpenRouter). */
  readonly context?: number;
  /** `language`, `evaluation`, `embedding`… as the gateway types it. */
  readonly type?: string;
  readonly tags?: readonly string[];
  /** The API paths that serve it, where the gateway says (OpenRouter: `/api/alpha/decisions`, `/api/alpha/extractions`). */
  readonly endpoints?: readonly string[];
}

function modelInfoOf(entry: Record<string, unknown>): ModelInfo | null {
  if (typeof entry.id !== 'string' || entry.id === '') return null;
  const info: { -readonly [K in keyof ModelInfo]: ModelInfo[K] } = {
    id: entry.id,
  };
  if (typeof entry.name === 'string' && entry.name !== '') info.name = entry.name;
  const provider =
    typeof entry.owned_by === 'string'
      ? entry.owned_by
      : entry.id.includes('/')
        ? entry.id.slice(0, entry.id.indexOf('/'))
        : undefined;
  if (provider !== undefined && provider !== '') info.provider = provider;
  const context =
    typeof entry.context_window === 'number'
      ? entry.context_window
      : typeof entry.context_length === 'number'
        ? entry.context_length
        : undefined;
  if (context !== undefined) info.context = context;
  if (typeof entry.type === 'string') info.type = entry.type;
  if (Array.isArray(entry.tags)) info.tags = entry.tags.filter((tag): tag is string => typeof tag === 'string');
  if (Array.isArray(entry.endpoints)) info.endpoints = entry.endpoints.filter((path): path is string => typeof path === 'string');
  return info;
}

/** `https://ai-gateway.vercel.sh/v1` and `https://api.openai.com` both work: a trailing `/v1` is folded into the path. */
/** A base that already ends in its own OpenAI version (Gemini's `/v1beta/openai`, DeepInfra's `/v1/openai`). */
const VERSIONED_BASE = /\/v\d+[a-z]*\w*(?:\/openai)?$/i;

export function joinUrl(base: string, path: string): string {
  const origin = base.replace(/\/+$/, '').replace(/\/v1$/i, '');
  const rest = path.replace(/^\/+/, '');
  return `${origin}/${VERSIONED_BASE.test(origin) ? rest.replace(/^v1\//i, '') : rest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentOf(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value;
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const part of value) {
    if (typeof part === 'string') parts.push(part);
    else if (isRecord(part) && typeof part.text === 'string') parts.push(part.text);
  }
  const joined = parts.join('');
  return joined === '' ? null : joined;
}

export async function listModels(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey: string,
  path = '/v1/models',
): Promise<
  { readonly ok: true; readonly models: readonly ModelInfo[] } | { readonly ok: false; readonly reason: string }
> {
  if (apiKey === '') return { ok: false, reason: 'No API key.' };
  try {
    const response = await fetchImpl(joinUrl(baseUrl, path), {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      return {
        ok: false,
        reason: `Models request failed (${response.status}).`,
      };
    const body: unknown = await response.json();
    const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
    const models: ModelInfo[] = [];
    for (const entry of data) {
      const info = isRecord(entry) ? modelInfoOf(entry) : null;
      if (info !== null) models.push(info);
    }
    return { ok: true, models };
  } catch {
    return { ok: false, reason: 'The provider model catalog is unavailable.' };
  }
}

const MAX_PROVIDER_MESSAGE = 240;

/** How a 400 words a gateway or model that cannot take a JSON schema in `response_format`. */
const SCHEMA_REFUSED = /response_format|json_schema|structured output|schema|strict/i;

function messageIn(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  // Gemini's OpenAI endpoint answers some errors as a one-element array.
  if (Array.isArray(value)) return messageIn(value[0]);
  if (!isRecord(value)) return null;
  for (const key of ['error', 'message', 'detail']) {
    const found = messageIn(value[key]);
    if (found !== null) return found;
  }
  return null;
}

/** What a provider said about a refused request, short, with the key and anything key-shaped taken out. */
export function providerMessage(body: string, apiKey: string): string | null {
  let message: string | null;
  try {
    message = messageIn(JSON.parse(body));
  } catch {
    message = /^\s*</.test(body) ? null : body;
  }
  if (message === null) return null;
  let text = apiKey === '' ? message : message.split(apiKey).join('<key>');
  text = text
    .replace(/\b(?:sk|pk|rk|key)-[\w-]{6,}/gi, '<key>')
    .replace(/[\w-]{32,}/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  return text.length > MAX_PROVIDER_MESSAGE ? `${text.slice(0, MAX_PROVIDER_MESSAGE - 1)}…` : text;
}

/** "Completion failed (400)", then the provider's words when it gave any, as one sentence. */
export function failureReason(lead: string, message: string | null): string {
  if (message === null) return `${lead}.`;
  return `${lead}: ${/[.!?…]$/.test(message) ? message : `${message}.`}`;
}

function refusal(status: number, message: string | null): ChatCompletionResult {
  return { ok: false, reason: failureReason(`Completion failed (${status})`, message), status };
}

/** The schema as an instruction, for a gateway that takes no `response_format`: the parsers read JSON with or without a fence. */
function withSchemaInPrompt(messages: readonly ChatMessage[], schema: unknown): readonly ChatMessage[] {
  const instruction = `Answer with one JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(schema)}`;
  const system = messages.findIndex((message) => message.role === 'system');
  if (system === -1) return [{ role: 'system', content: instruction }, ...messages];
  return messages.map((message, index) => (index === system ? { ...message, content: `${message.content}\n\n${instruction}` } : message));
}

export async function completeChat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  if (options.apiKey === '') return { ok: false, reason: 'No API key.' };
  const base: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
  };
  // Reasoning models (OpenAI's gpt-5 and later, o-series) answer 400 to any temperature but their default.
  if (options.temperature !== undefined) base.temperature = options.temperature;
  const body =
    options.jsonSchema === undefined
      ? base
      : {
          ...base,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: options.schemaName ?? 'geld',
              strict: true,
              schema: options.jsonSchema,
            },
          },
        };
  const controller = options.timeoutMs === undefined ? null : new AbortController();
  const timer =
    controller === null || options.timeoutMs === undefined
      ? null
      : setTimeout(() => controller.abort(), options.timeoutMs);
  const signal =
    options.signal && controller
      ? AbortSignal.any([options.signal, controller.signal])
      : (options.signal ?? controller?.signal ?? null);
  try {
    // Detached first: a browser's native fetch called as `options.fetch(…)` throws "Illegal invocation".
    const fetchImpl = options.fetch;
    const post = (payload: Record<string, unknown>): Promise<Response> =>
      fetchImpl(joinUrl(options.baseUrl, '/v1/chat/completions'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      });
    let response = await post(body);
    if (!response.ok) {
      const status = response.status;
      const message = providerMessage(await response.text().catch(() => ''), options.apiKey);
      const schemaRefused = status === 400 && options.jsonSchema !== undefined && message !== null && SCHEMA_REFUSED.test(message);
      if (!schemaRefused) return refusal(status, message);
      response = await post({ ...base, messages: withSchemaInPrompt(options.messages, options.jsonSchema) });
      if (!response.ok) return refusal(status, message);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.choices))
      return { ok: false, reason: 'Completion response was empty.' };
    const first = payload.choices[0];
    const message = isRecord(first) && isRecord(first.message) ? first.message : null;
    const text = message === null ? null : contentOf(message.content);
    if (text === null) return { ok: false, reason: 'Completion response had no text.' };
    const model = typeof payload.model === 'string' ? payload.model : options.model;
    return { ok: true, text, model };
  } catch {
    return {
      ok: false,
      reason: 'The AI provider could not complete the request.',
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
