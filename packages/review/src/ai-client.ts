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
}

export type ChatCompletionResult =
  | { readonly ok: true; readonly text: string; readonly model: string }
  | { readonly ok: false; readonly reason: string };

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
}

function modelInfoOf(entry: Record<string, unknown>): ModelInfo | null {
  if (typeof entry.id !== 'string' || entry.id === '') return null;
  const info: { -readonly [K in keyof ModelInfo]: ModelInfo[K] } = { id: entry.id };
  if (typeof entry.name === 'string' && entry.name !== '') info.name = entry.name;
  const provider = typeof entry.owned_by === 'string' ? entry.owned_by : entry.id.includes('/') ? entry.id.slice(0, entry.id.indexOf('/')) : undefined;
  if (provider !== undefined && provider !== '') info.provider = provider;
  const context = typeof entry.context_window === 'number' ? entry.context_window : typeof entry.context_length === 'number' ? entry.context_length : undefined;
  if (context !== undefined) info.context = context;
  if (typeof entry.type === 'string') info.type = entry.type;
  if (Array.isArray(entry.tags)) info.tags = entry.tags.filter((tag): tag is string => typeof tag === 'string');
  return info;
}

/** `https://ai-gateway.vercel.sh/v1` and `https://api.openai.com` both work: a trailing `/v1` is folded into the path. */
export function joinUrl(base: string, path: string): string {
  const origin = base.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${origin}/${path.replace(/^\/+/, '')}`;
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

export async function listModels(fetchImpl: FetchLike, baseUrl: string, apiKey: string): Promise<{ readonly ok: true; readonly models: readonly ModelInfo[] } | { readonly ok: false; readonly reason: string }> {
  if (apiKey === '') return { ok: false, reason: 'No API key.' };
  try {
    const response = await fetchImpl(joinUrl(baseUrl, '/v1/models'), {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
    if (!response.ok) return { ok: false, reason: `Models request failed (${response.status}).` };
    const body: unknown = await response.json();
    const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
    const models: ModelInfo[] = [];
    for (const entry of data) {
      const info = isRecord(entry) ? modelInfoOf(entry) : null;
      if (info !== null) models.push(info);
    }
    return { ok: true, models };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Models request failed.' };
  }
}

export async function completeChat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  if (options.apiKey === '') return { ok: false, reason: 'No API key.' };
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0,
  };
  if (options.jsonSchema !== undefined) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.schemaName ?? 'geld',
        strict: true,
        schema: options.jsonSchema,
      },
    };
  }
  const controller = options.timeoutMs === undefined ? null : new AbortController();
  const timer = controller === null || options.timeoutMs === undefined ? null : setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetch(joinUrl(options.baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      ...(controller === null ? {} : { signal: controller.signal }),
    });
    if (!response.ok) return { ok: false, reason: `Completion failed (${response.status}).` };
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.choices)) return { ok: false, reason: 'Completion response was empty.' };
    const first = payload.choices[0];
    const message = isRecord(first) && isRecord(first.message) ? first.message : null;
    const text = message === null ? null : contentOf(message.content);
    if (text === null) return { ok: false, reason: 'Completion response had no text.' };
    const model = typeof payload.model === 'string' ? payload.model : options.model;
    return { ok: true, text, model };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Completion failed.' };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
