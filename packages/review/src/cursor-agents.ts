/**
 * Cursor's Cloud Agents API, read from its docs and OpenAPI files in Nov 2026
 * (`cursor.com/docs-static/cloud-agents-openapi.yaml`, v1 in public beta, and the
 * legacy v0 one). The reader's own API key authenticates every call, so a message
 * sent here goes into the agent's own conversation: the Cursor app and cursor.com
 * show it as one of theirs. `fetch` is injected so this module stays free of
 * browser and Node APIs.
 *
 * v1 has no read of a conversation's past turns (a run keeps only its final
 * reply), so history comes from v0's `GET /v0/agents/{id}/conversation`, every
 * prompt and reply in order, with v1's run results as the fallback should v0 go.
 */

import type { FetchLike } from './ai-client';
import type { SseEvent } from './sse';

export const CURSOR_API = 'https://api.cursor.com';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AGENT_ID = new RegExp(`^bc-${UUID}$`, 'i');

/** A cloud agent's id as cursor.com's links carry it (`bc-` and a UUID), the only shape the API takes in its path. */
export function isCursorAgentId(value: string): boolean {
  return AGENT_ID.test(value);
}

export interface CursorAgent {
  readonly id: string;
  readonly name: string | null;
  /** `ACTIVE` while a turn runs or is about to, `IDLE` once it finished and takes follow-ups, `ARCHIVED` for good. */
  readonly status: string;
  readonly url: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly latestRunId: string | null;
}

export interface CursorRun {
  readonly id: string;
  /** `CREATING`, `RUNNING`, `WAITING_FOR_BACKGROUND_WORK` while active; `FINISHED`, `ERROR`, `CANCELLED`, `EXPIRED` once ended. */
  readonly status: string;
  readonly result: string | null;
  readonly createdAt: string | null;
}

export interface CursorMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface CursorModel {
  readonly id: string;
  readonly name: string;
}

export type CursorResult<T> = { readonly ok: true; readonly value: T } | CursorFailure;

export interface CursorFailure {
  readonly ok: false;
  readonly reason: string;
  readonly code: string | null;
  readonly status: number | null;
}

const ACTIVE_RUN = new Set(['CREATING', 'RUNNING', 'WAITING_FOR_BACKGROUND_WORK']);

export function isRunActive(status: string): boolean {
  return ACTIVE_RUN.has(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

export function parseAgent(value: unknown): CursorAgent | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const status = text(value.status);
  if (id === null || !isCursorAgentId(id) || status === null) return null;
  return {
    id,
    name: text(value.name),
    status,
    url: text(value.url) ?? `https://cursor.com/agents/${id}`,
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
    latestRunId: text(value.latestRunId),
  };
}

export function parseAgentList(value: unknown): CursorAgent[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => {
    const agent = parseAgent(item);
    return agent === null ? [] : [agent];
  });
}

export function parseRun(value: unknown): CursorRun | null {
  const run = isRecord(value) && isRecord(value.run) ? value.run : value;
  if (!isRecord(run)) return null;
  const id = text(run.id);
  const status = text(run.status);
  if (id === null || status === null) return null;
  return { id, status, result: text(run.result), createdAt: text(run.createdAt) };
}

export function parseRunList(value: unknown): CursorRun[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => {
    const run = parseRun(item);
    return run === null ? [] : [run];
  });
}

/** v0's conversation: `{ id, messages: [{ id, type: 'user_message' | 'assistant_message', text }] }`, in order. */
export function parseConversation(value: unknown): CursorMessage[] | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  return value.messages.flatMap((entry, index): CursorMessage[] => {
    if (!isRecord(entry) || typeof entry.text !== 'string') return [];
    const role = entry.type === 'user_message' ? 'user' : entry.type === 'assistant_message' ? 'assistant' : null;
    if (role === null) return [];
    return [{ id: text(entry.id) ?? `message-${index}`, role, text: entry.text }];
  });
}

/** What a conversation reads as from v1 alone: each finished run's final reply, oldest first, with no prompts. */
export function conversationFromRuns(runs: readonly CursorRun[]): CursorMessage[] {
  return [...runs].reverse().flatMap((run) => (run.result === null ? [] : [{ id: run.id, role: 'assistant' as const, text: run.result }]));
}

export function parseCursorModels(value: unknown): CursorModel[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = text(item.id);
    if (id === null) return [];
    return [{ id, name: text(item.displayName) ?? id }];
  });
}

/** How a steer landed: in the running turn, or queued as the next follow-up. A follow-up that starts a run reads `run`. */
export type CursorDelivery = 'run' | 'steered' | 'queued';

export interface CursorSent {
  readonly delivery: CursorDelivery;
  readonly runId: string | null;
}

export function parseSent(value: unknown): CursorSent | null {
  if (!isRecord(value)) return null;
  if (value.delivery === 'steered' || value.delivery === 'queued') return { delivery: value.delivery, runId: text(value.runId) };
  const run = parseRun(value);
  return run === null ? null : { delivery: 'run', runId: run.id };
}

/** Plain words for a refused call, from the API's own error code where one helps the reader act. */
export function cursorFailure(status: number, body: unknown): CursorFailure {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = error === null ? null : text(error.code);
  const message = error === null ? null : text(error.message);
  const reason = (() => {
    if (status === 401 || code === 'unauthorized' || code === 'api_key_not_found') return 'Cursor did not accept the API key. Check it in Geld’s settings.';
    if (code === 'agent_not_found' || status === 404) return 'Cursor could not find this agent for your API key. It may belong to someone else.';
    if (code === 'agent_archived') return 'This agent is archived, so it takes no more messages.';
    if (code === 'agent_busy') return 'The agent is still working on its last message.';
    if (code === 'plan_required' || code === 'feature_unavailable') return message ?? 'Your Cursor plan does not include this.';
    if (code === 'usage_limit_exceeded') return 'Your Cursor usage limit is reached.';
    if (status === 429 || code === 'rate_limit_exceeded' || code === 'too_many_open_streams') return 'Cursor is rate limiting these requests. Try again in a minute.';
    if (status === 403) return message ?? 'Cursor refused this request for your API key.';
    return message === null ? `Cursor answered ${status}.` : `Cursor answered ${status}: ${message.slice(0, 240)}`;
  })();
  return { ok: false, reason, code, status };
}

export interface CursorClientOptions {
  readonly fetch: FetchLike;
  readonly apiKey: string;
  readonly signal?: AbortSignal;
}

async function call(options: CursorClientOptions, method: 'GET' | 'POST', path: string, body?: unknown): Promise<CursorResult<unknown>> {
  if (options.apiKey === '') return { ok: false, reason: 'No Cursor API key.', code: null, status: null };
  const fetchImpl = options.fetch;
  try {
    const response = await fetchImpl(`${CURSOR_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: options.signal ?? AbortSignal.timeout(20_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) return cursorFailure(response.status, payload);
    return { ok: true, value: payload };
  } catch {
    return { ok: false, reason: 'Cursor could not be reached.', code: null, status: null };
  }
}

function mapped<T>(result: CursorResult<unknown>, parse: (value: unknown) => T | null, empty: string): CursorResult<T> {
  if (!result.ok) return result;
  const value = parse(result.value);
  return value === null ? { ok: false, reason: empty, code: null, status: null } : { ok: true, value };
}

const agentPath = (id: string): string => `/v1/agents/${encodeURIComponent(id)}`;

/** Who the key belongs to: its owner's email, when the key is a person's. */
export async function cursorMe(options: CursorClientOptions): Promise<CursorResult<{ readonly email: string | null }>> {
  return mapped(await call(options, 'GET', '/v1/me'), (value) => (isRecord(value) ? { email: text(value.userEmail) } : null), 'Cursor answered with no key details.');
}

/** The reader's agents that worked on a pull request (`prUrl`, the API's own filter), newest first. */
export async function cursorAgentsForPull(options: CursorClientOptions, prUrl: string): Promise<CursorResult<CursorAgent[]>> {
  return mapped(await call(options, 'GET', `/v1/agents?limit=20&prUrl=${encodeURIComponent(prUrl)}`), parseAgentList, '');
}

export async function cursorAgent(options: CursorClientOptions, id: string): Promise<CursorResult<CursorAgent>> {
  return mapped(await call(options, 'GET', agentPath(id)), parseAgent, 'Cursor answered with no agent.');
}

export async function cursorRun(options: CursorClientOptions, id: string, runId: string): Promise<CursorResult<CursorRun>> {
  return mapped(await call(options, 'GET', `${agentPath(id)}/runs/${encodeURIComponent(runId)}`), parseRun, 'Cursor answered with no run.');
}

/** Every prompt and reply of the agent, from v0; from v1's run results when v0 no longer answers for it. */
export async function cursorConversation(options: CursorClientOptions, id: string): Promise<CursorResult<CursorMessage[]>> {
  const legacy = await call(options, 'GET', `/v0/agents/${encodeURIComponent(id)}/conversation`);
  if (legacy.ok) return mapped(legacy, parseConversation, 'Cursor answered with no conversation.');
  if (legacy.status === 401 || legacy.status === 403 || legacy.status === 429 || legacy.status === null) return legacy;
  const runs = await call(options, 'GET', `${agentPath(id)}/runs?limit=100`);
  return runs.ok ? { ok: true, value: conversationFromRuns(parseRunList(runs.value)) } : runs;
}

export async function cursorModels(options: CursorClientOptions): Promise<CursorResult<CursorModel[]>> {
  return mapped(await call(options, 'GET', '/v1/models'), parseCursorModels, '');
}

export interface CursorSendOptions {
  readonly text: string;
  /** An explicit model for the run; null keeps the agent's own. Never sent with a steer, which the API refuses. */
  readonly model: string | null;
  /** Into the running turn rather than as a new run. */
  readonly steer: boolean;
}

/** A follow-up, or a steer while a turn runs: one message in the agent's own conversation. */
export async function cursorSend(options: CursorClientOptions, id: string, send: CursorSendOptions): Promise<CursorResult<CursorSent>> {
  const body = send.steer ? { prompt: { text: send.text }, delivery: 'steer' } : { prompt: { text: send.text }, ...(send.model === null ? {} : { model: { id: send.model } }) };
  return mapped(await call(options, 'POST', `${agentPath(id)}/runs`, body), parseSent, 'Cursor answered with no run.');
}

/** The agent's live stream across its runs (beta): open it with the reader's key and `Accept: text/event-stream`. */
export function cursorStreamUrl(id: string): string {
  return `${CURSOR_API}${agentPath(id)}/stream`;
}

/** What one event of the agent's stream changes in the chat. */
export type AgentStreamUpdate =
  | { readonly kind: 'status'; readonly status: string; readonly runId: string | null }
  | { readonly kind: 'assistant'; readonly text: string }
  | { readonly kind: 'thinking'; readonly text: string }
  | { readonly kind: 'tool'; readonly callId: string; readonly name: string; readonly status: 'running' | 'completed'; readonly detail: string | null }
  | { readonly kind: 'result'; readonly runId: string | null; readonly status: string; readonly text: string | null }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done' };

/** The part of a tool call worth a line: the file, command or query it acted on, cut short. */
export function toolDetail(args: unknown): string | null {
  if (!isRecord(args)) return null;
  for (const key of ['path', 'targetFile', 'target_file', 'file', 'command', 'query', 'pattern', 'url']) {
    const value = text(args[key]);
    if (value !== null) {
      const line = value.replace(/\s+/g, ' ').trim();
      return line.length > 90 ? `${line.slice(0, 89)}…` : line;
    }
  }
  return null;
}

/** One event of the agent stream read into a chat update; heartbeats and the richer `interaction_update` events read as nothing. */
export function agentStreamUpdate(event: SseEvent): AgentStreamUpdate | null {
  let data: unknown;
  try {
    data = event.data === '' ? {} : JSON.parse(event.data);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (event.event) {
    case 'status': {
      const status = text(data.status);
      return status === null ? null : { kind: 'status', status, runId: text(data.runId) };
    }
    case 'assistant':
    case 'thinking': {
      const delta = typeof data.text === 'string' ? data.text : null;
      return delta === null || delta === '' ? null : { kind: event.event, text: delta };
    }
    case 'tool_call': {
      const callId = text(data.callId);
      const name = text(data.name);
      if (callId === null || name === null) return null;
      return { kind: 'tool', callId, name, status: data.status === 'completed' ? 'completed' : 'running', detail: toolDetail(data.args) };
    }
    case 'result':
      return { kind: 'result', runId: text(data.runId), status: text(data.status) ?? 'FINISHED', text: text(data.text) };
    case 'error':
      return { kind: 'error', message: text(data.message) ?? 'The agent stream failed.' };
    case 'done':
      return { kind: 'done' };
    default:
      return null;
  }
}

const TOOL_WORDS: Readonly<Record<string, string>> = {
  read_file: 'Read',
  edit_file: 'Edited',
  search_replace: 'Edited',
  write: 'Wrote',
  delete_file: 'Deleted',
  run_terminal_cmd: 'Ran',
  grep: 'Searched',
  grep_search: 'Searched',
  codebase_search: 'Searched',
  file_search: 'Found',
  list_dir: 'Listed',
  web_search: 'Searched the web for',
  mcp: 'Used a tool',
};

/** A tool call as one short line: "Read README.md", "Ran pnpm test". */
export function toolLine(name: string, detail: string | null): string {
  const verb = TOOL_WORDS[name] ?? name.replace(/_/g, ' ');
  return detail === null ? verb : `${verb} ${detail}`;
}
