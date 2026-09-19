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

export interface ModelInfo {
  readonly id: string;
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
      if (isRecord(entry) && typeof entry.id === 'string' && entry.id !== '') models.push({ id: entry.id });
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
