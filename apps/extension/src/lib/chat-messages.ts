import type { AgentStreamUpdate, CursorAgent, CursorDelivery, CursorMessage, CursorModel, CursorRun } from '@geld/review';
import { parseAgent, parseRun } from '@geld/review';

/**
 * The chat sidebar's messages to the background, which holds the keys and
 * makes every request: one-shot requests to Cursor's API (`geld:cursor`), and
 * a port (`CHAT_PORT`) for what streams, the assistant's reply and the agent's
 * live turn. The Cursor key never leaves the background.
 */

export const CHAT_PORT = 'geld:chat';

/** The origin Cursor's API answers on, asked for by the options page when the key is saved. */
export const CURSOR_ORIGIN = 'https://api.cursor.com/*';

/** How often the page pings an open port: a message to the worker keeps Chrome from stopping it mid-stream. */
export const CHAT_PING_MS = 20_000;

export type CursorRequest =
  | { readonly type: 'geld:cursor'; readonly action: 'status' }
  | { readonly type: 'geld:cursor'; readonly action: 'me' }
  | { readonly type: 'geld:cursor'; readonly action: 'find'; readonly prUrl: string; readonly ids: readonly string[] }
  | { readonly type: 'geld:cursor'; readonly action: 'conversation'; readonly agentId: string }
  | { readonly type: 'geld:cursor'; readonly action: 'send'; readonly agentId: string; readonly text: string; readonly model: string | null; readonly steer: boolean }
  | { readonly type: 'geld:cursor'; readonly action: 'models' };

export type CursorFailureReply = { readonly ok: false; readonly reason: string; readonly code: string | null };

/** `connected`: a key is saved. `permitted`: the browser lets Geld reach api.cursor.com (asked for on the options page). */
export type CursorStatusReply = { readonly ok: true; readonly connected: boolean; readonly permitted: boolean };
export type CursorFindReply = { readonly ok: true; readonly agents: readonly CursorAgent[] } | CursorFailureReply;
export type CursorConversationReply = { readonly ok: true; readonly agent: CursorAgent; readonly run: CursorRun | null; readonly messages: readonly CursorMessage[] } | CursorFailureReply;
export type CursorSendReply = { readonly ok: true; readonly delivery: CursorDelivery; readonly runId: string | null } | CursorFailureReply;
export type CursorMeReply = { readonly ok: true; readonly email: string | null } | CursorFailureReply;
export type CursorModelsReply = { readonly ok: true; readonly models: readonly CursorModel[] } | CursorFailureReply;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isStrings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export function isCursorRequest(value: unknown): value is CursorRequest {
  if (!isRecord(value) || value.type !== 'geld:cursor') return false;
  switch (value.action) {
    case 'status':
    case 'me':
    case 'models':
      return true;
    case 'find':
      return typeof value.prUrl === 'string' && isStrings(value.ids);
    case 'conversation':
      return typeof value.agentId === 'string';
    case 'send':
      return typeof value.agentId === 'string' && typeof value.text === 'string' && (value.model === null || typeof value.model === 'string') && typeof value.steer === 'boolean';
    default:
      return false;
  }
}

function isFailure(value: Record<string, unknown>): boolean {
  return value.ok === false && typeof value.reason === 'string' && (value.code === null || typeof value.code === 'string');
}

const isAgents = (value: unknown): value is readonly CursorAgent[] => Array.isArray(value) && value.every((entry) => parseAgent(entry) !== null);
const isMessages = (value: unknown): value is readonly CursorMessage[] =>
  Array.isArray(value) && value.every((entry) => isRecord(entry) && typeof entry.id === 'string' && typeof entry.text === 'string' && (entry.role === 'user' || entry.role === 'assistant'));
const isModels = (value: unknown): value is readonly CursorModel[] => Array.isArray(value) && value.every((entry) => isRecord(entry) && typeof entry.id === 'string' && typeof entry.name === 'string');

export function isCursorStatusReply(value: unknown): value is CursorStatusReply {
  return isRecord(value) && value.ok === true && typeof value.connected === 'boolean' && typeof value.permitted === 'boolean';
}

export function isCursorFindReply(value: unknown): value is CursorFindReply {
  return isRecord(value) && (isFailure(value) || (value.ok === true && isAgents(value.agents)));
}

export function isCursorConversationReply(value: unknown): value is CursorConversationReply {
  return isRecord(value) && (isFailure(value) || (value.ok === true && parseAgent(value.agent) !== null && (value.run === null || parseRun(value.run) !== null) && isMessages(value.messages)));
}

export function isCursorSendReply(value: unknown): value is CursorSendReply {
  return isRecord(value) && (isFailure(value) || (value.ok === true && (value.delivery === 'run' || value.delivery === 'steered' || value.delivery === 'queued') && (value.runId === null || typeof value.runId === 'string')));
}

export function isCursorMeReply(value: unknown): value is CursorMeReply {
  return isRecord(value) && (isFailure(value) || (value.ok === true && (value.email === null || typeof value.email === 'string')));
}

export function isCursorModelsReply(value: unknown): value is CursorModelsReply {
  return isRecord(value) && (isFailure(value) || (value.ok === true && isModels(value.models)));
}

/** Page → background: one pull request's assistant chat to keep, written by the background alone. Empty turns forget it. */
export interface AssistantChatSave {
  readonly type: 'geld:chat-save';
  readonly key: string;
  readonly turns: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
}

export function isAssistantChatSave(value: unknown): value is AssistantChatSave {
  return (
    isRecord(value) &&
    value.type === 'geld:chat-save' &&
    typeof value.key === 'string' &&
    Array.isArray(value.turns) &&
    value.turns.every((turn) => isRecord(turn) && typeof turn.text === 'string' && (turn.role === 'user' || turn.role === 'assistant'))
  );
}

export interface ChatTurnMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** Page → background over the chat port. */
export type ChatPortRequest =
  | { readonly type: 'assistant'; readonly id: string; readonly model: string; readonly messages: readonly ChatTurnMessage[] }
  | { readonly type: 'stop'; readonly id: string }
  | { readonly type: 'watch'; readonly agentId: string }
  | { readonly type: 'unwatch' }
  | { readonly type: 'ping' };

/** Background → page over the chat port. */
export type ChatPortEvent =
  | { readonly type: 'delta'; readonly id: string; readonly text: string }
  | { readonly type: 'done'; readonly id: string; readonly model: string }
  | { readonly type: 'failed'; readonly id: string; readonly reason: string }
  | { readonly type: 'agent'; readonly agentId: string; readonly update: AgentStreamUpdate }
  | { readonly type: 'agent-closed'; readonly agentId: string; readonly reason: string | null };

const isTurns = (value: unknown): value is readonly ChatTurnMessage[] =>
  Array.isArray(value) && value.every((entry) => isRecord(entry) && typeof entry.content === 'string' && (entry.role === 'system' || entry.role === 'user' || entry.role === 'assistant'));

export function isChatPortRequest(value: unknown): value is ChatPortRequest {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'assistant':
      return typeof value.id === 'string' && typeof value.model === 'string' && isTurns(value.messages);
    case 'stop':
      return typeof value.id === 'string';
    case 'watch':
      return typeof value.agentId === 'string';
    case 'unwatch':
    case 'ping':
      return true;
    default:
      return false;
  }
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isAgentStreamUpdate(value: unknown): value is AgentStreamUpdate {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'status':
      return isText(value.status) && isTextOrNull(value.runId);
    case 'assistant':
    case 'thinking':
      return isText(value.text);
    case 'tool':
      return isText(value.callId) && isText(value.name) && (value.status === 'running' || value.status === 'completed') && isTextOrNull(value.detail);
    case 'result':
      return isTextOrNull(value.runId) && isText(value.status) && isTextOrNull(value.text);
    case 'error':
      return isText(value.message);
    case 'done':
      return true;
    default:
      return false;
  }
}

export function isChatPortEvent(value: unknown): value is ChatPortEvent {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'delta':
      return typeof value.id === 'string' && typeof value.text === 'string';
    case 'done':
      return typeof value.id === 'string' && typeof value.model === 'string';
    case 'failed':
      return typeof value.id === 'string' && typeof value.reason === 'string';
    case 'agent':
      return typeof value.agentId === 'string' && isAgentStreamUpdate(value.update);
    case 'agent-closed':
      return typeof value.agentId === 'string' && (value.reason === null || typeof value.reason === 'string');
    default:
      return false;
  }
}
