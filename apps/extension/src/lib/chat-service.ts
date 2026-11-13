/**
 * The background's half of the chat sidebar: it alone reads the keys and
 * talks to the gateway and to Cursor. A port from a GitHub tab carries what
 * streams (the assistant's reply, the agent's live turn) and is closed with
 * the sidebar, which aborts whatever it had open.
 */

import type { AgentStreamUpdate, CursorAgent, CursorClientOptions } from '@geld/review';
import {
  agentStreamUpdate,
  cursorAgent,
  cursorAgentsForPull,
  cursorConversation,
  cursorFailure,
  cursorMe,
  cursorModels,
  cursorRun,
  cursorSend,
  cursorStreamUrl,
  isCursorAgentId,
  isEvaluationModel,
  SseParser,
  streamChat,
} from '@geld/review';
import { browser } from 'wxt/browser';
import { hasGatewayPermission } from './ai-gateway';
import type { AssistantChatSave, ChatPortEvent, ChatPortRequest, CursorRequest } from './chat-messages';
import { CHAT_PORT, CURSOR_ORIGIN, isChatPortRequest } from './chat-messages';
import type { StoredChat } from './local-state';
import { ASSISTANT_CHATS_CAP, ASSISTANT_TURNS_CAP, aiKeyItem, assistantChatsItem, cursorKeyItem } from './local-state';
import { settingsItem } from './storage';

/** Agents read for one pull request at most: its linked ones, then the newest the API lists for it. */
const MAX_AGENTS = 6;
const MAX_MESSAGE_CHARS = 50_000;
const STREAM_RETRIES = 5;

export async function cursorPermitted(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [CURSOR_ORIGIN] });
  } catch {
    return false;
  }
}

const failed = (reason: string, code: string | null = null): { readonly ok: false; readonly reason: string; readonly code: string | null } => ({ ok: false, reason, code });

async function client(signal?: AbortSignal): Promise<CursorClientOptions | string> {
  const apiKey = (await cursorKeyItem.getValue()).trim();
  if (apiKey === '') return 'Add your Cursor API key in Geld’s settings to chat with this agent here.';
  if (!(await cursorPermitted())) return 'Allow Geld to reach api.cursor.com from Geld’s settings.';
  return { fetch, apiKey, ...(signal === undefined ? {} : { signal }) };
}

export async function handleCursorRequest(request: CursorRequest): Promise<unknown> {
  if (request.action === 'status') return { ok: true, connected: (await cursorKeyItem.getValue()).trim() !== '', permitted: await cursorPermitted() };
  const options = await client();
  if (typeof options === 'string') return failed(options, 'not-connected');
  switch (request.action) {
    case 'me': {
      const me = await cursorMe(options);
      return me.ok ? { ok: true, email: me.value.email } : failed(me.reason, me.code);
    }
    case 'find': {
      const linked = [...new Set(request.ids.filter(isCursorAgentId))].slice(0, MAX_AGENTS);
      const [listed, read] = await Promise.all([cursorAgentsForPull(options, request.prUrl), Promise.all(linked.map((id) => cursorAgent(options, id)))]);
      const agents: CursorAgent[] = [];
      for (const result of read) if (result.ok) agents.push(result.value);
      if (listed.ok) for (const agent of listed.value) if (!agents.some((known) => known.id === agent.id)) agents.push(agent);
      if (agents.length === 0 && !listed.ok) return failed(listed.reason, listed.code);
      return { ok: true, agents: agents.filter((agent) => agent.status !== 'ARCHIVED' || linked.includes(agent.id)).slice(0, MAX_AGENTS) };
    }
    case 'conversation': {
      if (!isCursorAgentId(request.agentId)) return failed('That is not a Cursor agent id.');
      const [agent, conversation] = await Promise.all([cursorAgent(options, request.agentId), cursorConversation(options, request.agentId)]);
      if (!agent.ok) return failed(agent.reason, agent.code);
      if (!conversation.ok) return failed(conversation.reason, conversation.code);
      const run = agent.value.latestRunId === null ? null : await cursorRun(options, request.agentId, agent.value.latestRunId);
      return { ok: true, agent: agent.value, run: run?.ok === true ? run.value : null, messages: conversation.value };
    }
    case 'send': {
      if (!isCursorAgentId(request.agentId)) return failed('That is not a Cursor agent id.');
      const text = request.text.trim();
      if (text === '') return failed('Write a message first.');
      if (text.length > MAX_MESSAGE_CHARS) return failed('That message is too long for Cursor.');
      const sent = await cursorSend(options, request.agentId, { text, model: request.model, steer: request.steer });
      return sent.ok ? { ok: true, delivery: sent.value.delivery, runId: sent.value.runId } : failed(sent.reason, sent.code);
    }
    case 'models': {
      const models = await cursorModels(options);
      return models.ok ? { ok: true, models: models.value } : failed(models.reason, models.code);
    }
  }
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * The agent's live stream, its events posted as they come. Cursor closes open streams when it deploys, with no last
 * event, so a stream that ends without `done` is opened again from the last event it sent.
 */
async function watchAgent(agentId: string, signal: AbortSignal, post: (event: ChatPortEvent) => void): Promise<void> {
  const closed = (reason: string | null): void => post({ type: 'agent-closed', agentId, reason });
  let lastEventId: string | null = null;
  let attempts = 0;
  while (!signal.aborted) {
    const options = await client(signal);
    if (typeof options === 'string') return closed(options);
    let response: Response;
    try {
      response = await fetch(cursorStreamUrl(agentId), {
        headers: { authorization: `Bearer ${options.apiKey}`, accept: 'text/event-stream', ...(lastEventId === null ? {} : { 'last-event-id': lastEventId }) },
        signal,
      });
    } catch {
      if (signal.aborted) return;
      attempts += 1;
      if (attempts > STREAM_RETRIES) return closed('The agent’s live stream is unavailable.');
      await sleep(1000 * 2 ** attempts, signal);
      continue;
    }
    if (!response.ok || response.body === null) {
      // An event id past the stream's retention: start again from the agent's newest run.
      if (response.status === 410 && lastEventId !== null) {
        lastEventId = null;
        continue;
      }
      return closed(cursorFailure(response.status, await response.json().catch(() => null)).reason);
    }
    attempts = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        for (const event of done ? parser.flush() : parser.feed(decoder.decode(value, { stream: true }))) {
          if (event.id !== null) lastEventId = event.id;
          const update: AgentStreamUpdate | null = agentStreamUpdate(event);
          if (update === null) continue;
          if (update.kind === 'done') return closed(null);
          post({ type: 'agent', agentId, update });
        }
        if (done) break;
      }
    } catch {
      if (signal.aborted) return;
    } finally {
      reader.releaseLock();
    }
    await sleep(1000, signal);
  }
}

async function streamAssistant(id: string, model: string, messages: Extract<ChatPortRequest, { type: 'assistant' }>['messages'], signal: AbortSignal, post: (event: ChatPortEvent) => void): Promise<void> {
  const settings = await settingsItem.getValue();
  const apiKey = (await aiKeyItem.getValue()).trim();
  const fail = (reason: string): void => post({ type: 'failed', id, reason });
  if (!settings.aiEnabled) return fail('Turn on AI features in Geld’s settings to chat with the assistant.');
  if (settings.aiBaseUrl === '' || apiKey === '') return fail('Add an AI gateway and its key in Geld’s settings to chat with the assistant.');
  const denied = await hasGatewayPermission(settings.aiBaseUrl);
  if (denied !== null) return fail(denied);
  const chosen = model.trim() === '' ? settings.aiModel : model.trim();
  if (chosen === '') return fail('Choose a model for the assistant.');
  if (isEvaluationModel(chosen)) return fail('That is an evaluation model. It answers questions but writes nothing. Pick a language model.');
  const result = await streamChat({ fetch, baseUrl: settings.aiBaseUrl, apiKey, model: chosen, messages, signal, onDelta: (text) => post({ type: 'delta', id, text }) });
  if (signal.aborted) return;
  post(result.ok ? { type: 'done', id, model: result.model } : { type: 'failed', id, reason: result.reason });
}

let chatWrites: Promise<void> = Promise.resolve();

/**
 * Saves one pull request's assistant chat. Every tab sends its chat here rather than rewriting the stored map itself:
 * two tabs finishing replies together each read the same map, and the second write dropped the first tab's chat.
 */
export function saveAssistantChat(save: AssistantChatSave): Promise<void> {
  chatWrites = chatWrites
    .then(async () => {
      const all = await assistantChatsItem.getValue();
      const turns = save.turns.slice(-ASSISTANT_TURNS_CAP);
      const rest = Object.entries(all).filter(([key]) => key !== save.key);
      const kept: [string, StoredChat][] = turns.length === 0 ? rest : [...rest, [save.key, { at: new Date().toISOString(), turns }]];
      kept.sort((a, b) => a[1].at.localeCompare(b[1].at));
      await assistantChatsItem.setValue(Object.fromEntries(kept.slice(-ASSISTANT_CHATS_CAP)));
    })
    .catch(() => undefined);
  return chatWrites;
}

/** Ports from GitHub tabs only: the sidebar is a content script's, and nothing else of Geld's streams. */
export function startChatPorts(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CHAT_PORT) return;
    if (port.sender?.tab?.id === undefined) {
      port.disconnect();
      return;
    }
    let open = true;
    const assistants = new Map<string, AbortController>();
    let watching: { readonly agentId: string; readonly controller: AbortController } | null = null;
    const post = (event: ChatPortEvent): void => {
      if (!open) return;
      try {
        port.postMessage(event);
      } catch {
        open = false;
      }
    };
    const unwatch = (): void => {
      watching?.controller.abort();
      watching = null;
    };
    port.onMessage.addListener((message: unknown) => {
      if (!isChatPortRequest(message)) return;
      switch (message.type) {
        case 'assistant': {
          assistants.get(message.id)?.abort();
          const controller = new AbortController();
          assistants.set(message.id, controller);
          void streamAssistant(message.id, message.model, message.messages, controller.signal, post).finally(() => {
            if (assistants.get(message.id) === controller) assistants.delete(message.id);
          });
          return;
        }
        case 'stop':
          assistants.get(message.id)?.abort();
          assistants.delete(message.id);
          return;
        case 'watch': {
          if (watching?.agentId === message.agentId) return;
          unwatch();
          if (!isCursorAgentId(message.agentId)) return;
          const current = { agentId: message.agentId, controller: new AbortController() };
          watching = current;
          // A watch that ended by itself (`done`, a refusal) lets the next one for the same agent open; an older watch never clears a newer.
          void watchAgent(message.agentId, current.controller.signal, post).finally(() => {
            if (watching === current) watching = null;
          });
          return;
        }
        case 'unwatch':
          unwatch();
          return;
        case 'ping':
          return;
      }
    });
    port.onDisconnect.addListener(() => {
      open = false;
      for (const controller of assistants.values()) controller.abort();
      assistants.clear();
      unwatch();
    });
  });
}
