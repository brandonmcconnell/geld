/**
 * The chat sidebar beside a pull request: one panel docked to the window's
 * right edge, opened from the digest's Chat button, with one thread per
 * conversation it can hold. The assistant answers through the reader's own
 * gateway with the pull request as its context. Each Cursor agent that worked
 * on the pull request (linked from it, or listed for it by Cursor's API under
 * the reader's key) is its own thread, and that thread is the agent's own
 * conversation: what the reader sends here is a follow-up in Cursor, so the
 * Cursor app and cursor.com show it too, and their messages show here.
 *
 * Every request goes through the background, which holds the keys. What
 * streams (the assistant's reply, the agent's live turn) comes over one port
 * that closes with the sidebar. This module holds the state and builds a plain
 * view of it (`ChatView`); the React view in `src/chat` renders that view in a
 * shadow root and calls the actions back.
 */

import type { CursorAgent, CursorModel, PullChatContext } from '@geld/review';
import { assistantSystemPrompt, isEvaluationModel, isRunActive } from '@geld/review';
import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { persist } from '../../lib/context';
import type { AssistantChatSave, ChatPortRequest, ChatTurnMessage, CursorRequest, CursorStatusReply } from '../../lib/chat-messages';
import { CHAT_PING_MS, CHAT_PORT, isChatPortEvent, isCursorConversationReply, isCursorFindReply, isCursorModelsReply, isCursorSendReply, isCursorStatusReply } from '../../lib/chat-messages';
import type { ChatModels } from '../../lib/local-state';
import { aiGatewayItem, aiKeyItem, assistantChatsItem, chatModelsItem } from '../../lib/local-state';
import type { OpenSettingsMessage } from '../../lib/messages';
import { reportError } from '../../lib/error-capture';
import { countUsage } from '../../lib/usage-count';
import { loadChatUi } from '../../chat/loader';
import type { ChatHost } from '../../chat/mount';
import type { ChatActions, ChatBodyView, ChatComposerView, ChatModelOption, ChatTabView, ChatTurnView, ChatView } from '../../chat/view';
import type { AgentLive, ChatTurn } from './chat-threads';
import { agentLiveStep, agentRunning, chatTurn, IDLE_LIVE, turnsFromHistory } from './chat-threads';

const ASSISTANT = 'assistant';
/** An idle agent's conversation is read again this often while its thread is shown, for messages sent from Cursor. */
const IDLE_POLL_MS = 30_000;
/** A finished run's words are read back from Cursor's record a moment after its stream says it ended. */
const RELOAD_AFTER_RUN_MS = 800;
const HISTORY_TURNS = 12;

export interface LinkedAgent {
  readonly id: string;
  readonly href: string;
}

/** What the sidebar needs from the page, refreshed by each digest pass. */
export interface ChatPageContext {
  /** `github[@host]:{owner}/{repo}/pull/{n}`: the key the assistant's chat is kept under. */
  readonly pageKey: string;
  /** `/owner/repo/pull/N`: the sidebar stays open on every tab of that pull request and closes off it. */
  readonly pullPath: string;
  readonly prUrl: string;
  readonly linkedAgents: readonly LinkedAgent[];
  /** The reader's coding agent choice leads with Cursor (or leaves it to Geld), so its thread opens first. */
  readonly preferCursor: boolean;
  readonly ai: { readonly enabled: boolean; readonly baseUrl: string; readonly model: string };
  readonly pull: () => PullChatContext;
}

interface AgentThread {
  readonly id: string;
  agent: CursorAgent | null;
  href: string;
  turns: ChatTurn[];
  live: AgentLive;
  /** The latest run's status at the last reading of the conversation. */
  readStatus: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Why the live stream closed, when it closed for a reason. */
  notice: string | null;
  sending: boolean;
}

let context: ChatPageContext | null = null;
let host: ChatHost | null = null;
let loadedKey: string | null = null;
let active = ASSISTANT;
/** The reader picked a thread themselves, so discovery never switches it under them. */
let chose = false;
let assistantTurns: ChatTurn[] = [];
let assistantStream: string | null = null;
let assistantKeySet = false;
let gatewayModels: readonly string[] = [];
const agents = new Map<string, AgentThread>();
let cursorStatus: CursorStatusReply | null = null;
let cursorModels: readonly CursorModel[] | null = null;
let chosenModels: ChatModels = {};
let watchedAgent: string | null = null;
let port: Browser.runtime.Port | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
let emitFrame = 0;
let draftEmpty = true;
const listeners = new Set<() => void>();
let view: ChatView | null = null;
let opener: HTMLElement | null = null;
/** Bumped on every open and close: an answer that arrives for an earlier sidebar, or another pull request's, is dropped. */
let session = 0;
/** Local keys whose change can enable the chat: the gateway key and its model list, the Cursor key. Their values are never read here. */
const SETUP_KEYS = ['aiKey', 'aiGateway', 'cursorApiKey'];

export function chatOpen(): boolean {
  return host !== null;
}

function markChatButtons(): void {
  for (const button of document.querySelectorAll('[data-geld-focus="chat"]')) button.setAttribute('aria-pressed', String(host !== null));
}

/** The digest's latest reading of the page. An open sidebar takes in agents newly linked; a different pull request closes it. */
export function setChatContext(next: ChatPageContext): void {
  const aiBefore = context === null ? null : JSON.stringify(context.ai);
  context = next;
  if (host === null) return;
  if (loadedKey !== next.pageKey) {
    closeChat();
    return;
  }
  let added = false;
  for (const linked of next.linkedAgents) added = ensureAgent(linked.id, linked.href) || added;
  if (aiBefore !== JSON.stringify(next.ai)) void readLocalState().then(emit);
  else if (added) emit();
}

/** The reader may have set the chat up meanwhile (a key saved in the options, the browser's permission granted): read it all again. */
function refreshSetup(): void {
  void readLocalState().then(emit);
  void discoverAgents();
}

function onStorageChanged(changes: Readonly<Record<string, unknown>>, area: string): void {
  if (area === 'local' && SETUP_KEYS.some((key) => key in changes)) refreshSetup();
}

/** After a navigation: a sidebar opened on another pull request closes. */
export function syncChatToPage(): void {
  if (context !== null && !location.pathname.startsWith(context.pullPath)) closeChat();
}

export function toggleChat(from: HTMLElement | null = null): void {
  if (host !== null) closeChat();
  else if (openRequest === 0) void openChat(from);
}

/** The view's script loads ahead of the click when the reader heads for the Chat button. */
export function warmChat(): void {
  void loadChatUi();
}

/** The open waiting on the view's script, 0 when none: a close or a navigation meanwhile withdraws it. */
let openRequest = 0;
let openRequests = 0;

async function openChat(from: HTMLElement | null): Promise<void> {
  if (context === null) return;
  const { pageKey, pullPath } = context;
  const request = ++openRequests;
  openRequest = request;
  const ui = await loadChatUi();
  if (openRequest !== request) return;
  openRequest = 0;
  if (ui === null || context?.pageKey !== pageKey || host !== null || !location.pathname.startsWith(pullPath)) return;
  session += 1;
  opener = from;
  if (loadedKey !== context.pageKey) {
    loadedKey = context.pageKey;
    agents.clear();
    assistantTurns = [];
    assistantStream = null;
    cursorStatus = null;
    active = ASSISTANT;
    chose = false;
    void loadAssistantChat(context.pageKey);
  }
  // Requests from the sidebar before are dropped when they answer, so nothing may still read as under way.
  for (const thread of agents.values()) {
    thread.loading = false;
    thread.sending = false;
  }
  for (const linked of context.linkedAgents) ensureAgent(linked.id, linked.href);
  if (!chose && context.preferCursor && context.linkedAgents[0] !== undefined) active = context.linkedAgents[0].id;
  draftEmpty = true;
  view = null;
  host = ui.mountChat({ subscribe, getView, actions: ACTIONS, onError: (error) => reportError('content:chat', error) });
  document.documentElement.setAttribute('data-geld-chat-open', '');
  markChatButtons();
  host.focusComposer();
  countUsage('chat_opened');
  // While the conversation is on the page: the sidebar stays open on the pull request's other tabs, which do not hold it.
  context.pull();
  void readLocalState().then(emit);
  void discoverAgents();
  pollTimer = setInterval(pollIdleAgent, IDLE_POLL_MS);
  browser.storage.onChanged.addListener(onStorageChanged);
  // A permission granted in the options leaves storage as it was: coming back to the page is the moment to look again.
  window.addEventListener('focus', refreshSetup);
}

export function closeChat(): void {
  openRequest = 0;
  if (host === null) return;
  session += 1;
  browser.storage.onChanged.removeListener(onStorageChanged);
  window.removeEventListener('focus', refreshSetup);
  const returnTo = opener?.isConnected === true ? opener : document.querySelector<HTMLElement>('[data-geld-focus="chat"]');
  host.unmount();
  host = null;
  document.documentElement.removeAttribute('data-geld-chat-open');
  markChatButtons();
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  for (const timer of reloadTimers.values()) clearTimeout(timer);
  reloadTimers.clear();
  if (emitFrame !== 0) cancelAnimationFrame(emitFrame);
  emitFrame = 0;
  disconnectPort();
  if (assistantStream !== null) {
    const id = assistantStream;
    assistantTurns = assistantTurns.map((turn) => (turn.id === id ? { ...turn, streaming: false, note: 'Stopped' } : turn));
    assistantStream = null;
    saveAssistantChat();
  }
  returnTo?.focus({ preventScroll: true });
}

function ensureAgent(id: string, href: string): boolean {
  if (agents.has(id)) return false;
  agents.set(id, { id, agent: null, href, turns: [], live: IDLE_LIVE, readStatus: null, loading: false, loaded: false, error: null, notice: null, sending: false });
  return true;
}

async function readLocalState(): Promise<void> {
  const epoch = session;
  const [key, gateway, models] = await Promise.all([aiKeyItem.getValue(), aiGatewayItem.getValue(), chatModelsItem.getValue()]);
  if (epoch !== session) return;
  assistantKeySet = key.trim() !== '';
  chosenModels = models;
  gatewayModels = gateway === null || context === null || gateway.baseUrl !== context.ai.baseUrl ? [] : gateway.models.filter((id) => !isEvaluationModel(id, gateway.details?.[id]?.type) && !isEvaluationModel(id));
}

function assistantReady(): boolean {
  return context !== null && context.ai.enabled && context.ai.baseUrl !== '' && context.ai.model !== '' && assistantKeySet;
}

/* ------------------------------------------------------------------------- */
/* The background                                                              */
/* ------------------------------------------------------------------------- */

async function askCursor(request: CursorRequest): Promise<unknown> {
  try {
    return await browser.runtime.sendMessage(request);
  } catch {
    return null;
  }
}

function ensurePort(): Browser.runtime.Port {
  if (port !== null) return port;
  const opened = browser.runtime.connect({ name: CHAT_PORT });
  port = opened;
  opened.onMessage.addListener(onPortMessage);
  opened.onDisconnect.addListener(() => {
    if (port !== opened) return;
    port = null;
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
    // The worker stopped or reloaded: whatever streamed through it ended with it.
    if (assistantStream !== null) {
      const id = assistantStream;
      assistantStream = null;
      assistantTurns = assistantTurns.map((turn) => (turn.id === id ? { ...turn, streaming: false, error: 'The connection to Geld’s background stopped. Try again.' } : turn));
      saveAssistantChat();
    }
    const watched = watchedAgent;
    watchedAgent = null;
    if (host !== null && watched !== null) setTimeout(() => watchIfRunning(watched), 1000);
    emit();
  });
  pingTimer = setInterval(() => post({ type: 'ping' }), CHAT_PING_MS);
  return opened;
}

function post(message: ChatPortRequest): void {
  try {
    ensurePort().postMessage(message);
  } catch {
    port = null;
  }
}

function disconnectPort(): void {
  if (pingTimer !== null) clearInterval(pingTimer);
  pingTimer = null;
  watchedAgent = null;
  const open = port;
  port = null;
  open?.disconnect();
}

function onPortMessage(message: unknown): void {
  if (!isChatPortEvent(message)) return;
  switch (message.type) {
    case 'delta':
      assistantTurns = assistantTurns.map((turn) => (turn.id === message.id ? { ...turn, text: turn.text + message.text } : turn));
      break;
    case 'done':
    case 'failed': {
      assistantTurns = assistantTurns.map((turn) =>
        turn.id !== message.id ? turn : message.type === 'done' ? { ...turn, streaming: false, note: message.model } : { ...turn, streaming: false, error: message.reason },
      );
      if (assistantStream === message.id) assistantStream = null;
      saveAssistantChat();
      break;
    }
    case 'agent': {
      const thread = agents.get(message.agentId);
      if (thread === undefined) return;
      thread.live = agentLiveStep(thread.live, message.update);
      thread.notice = null;
      if (thread.live.finished) scheduleReload(thread.id);
      break;
    }
    case 'agent-closed': {
      if (watchedAgent === message.agentId) watchedAgent = null;
      const thread = agents.get(message.agentId);
      if (thread !== undefined && message.reason !== null) thread.notice = message.reason;
      break;
    }
  }
  emit();
}

/* ------------------------------------------------------------------------- */
/* Cursor agents                                                               */
/* ------------------------------------------------------------------------- */

async function discoverAgents(): Promise<void> {
  const epoch = session;
  const reply = await askCursor({ type: 'geld:cursor', action: 'status' });
  if (epoch !== session || host === null || context === null) return;
  cursorStatus = isCursorStatusReply(reply) ? reply : null;
  if (cursorStatus?.connected === true && cursorStatus.permitted) {
    const found = await askCursor({ type: 'geld:cursor', action: 'find', prUrl: context.prUrl, ids: context.linkedAgents.map((linked) => linked.id) });
    if (epoch !== session || host === null) return;
    if (isCursorFindReply(found) && found.ok) {
      for (const agent of found.agents) {
        ensureAgent(agent.id, agent.url);
        const thread = agents.get(agent.id);
        if (thread !== undefined) thread.agent = agent;
      }
      const first = found.agents[0];
      if (!chose && context.preferCursor && first !== undefined && active === ASSISTANT && draftEmpty && assistantTurns.length === 0) active = first.id;
    }
  }
  emit();
  if (active !== ASSISTANT) void loadAgent(active);
}

function cursorUsable(): boolean {
  return cursorStatus?.connected === true && cursorStatus.permitted;
}

async function loadAgent(id: string, quiet = false): Promise<void> {
  const thread = agents.get(id);
  if (thread === undefined || !cursorUsable()) return;
  if (!quiet) {
    thread.loading = true;
    emit();
  }
  const epoch = session;
  const reply = await askCursor({ type: 'geld:cursor', action: 'conversation', agentId: id });
  // A reading made for an earlier sidebar is dropped, but its thread is not left marked busy, or it would never be read again.
  thread.loading = false;
  if (epoch !== session || agents.get(id) !== thread) return;
  if (!isCursorConversationReply(reply)) {
    thread.error = 'Geld could not read this conversation.';
  } else if (!reply.ok) {
    thread.error = reply.reason;
  } else {
    thread.error = null;
    thread.agent = reply.agent;
    thread.readStatus = reply.run?.status ?? null;
    const running = reply.run !== null && isRunActive(reply.run.status);
    // A turn already under way is played again by the stream from its start, so the reading leaves it out.
    thread.turns = turnsFromHistory(reply.messages, running);
    if (!running || watchedAgent !== id) thread.live = IDLE_LIVE;
    thread.loaded = true;
    if (running) watch(id);
    // Idle, the stream is let go: reopened later without its last event id it would play the finished run again. The
    // idle poll watches anew once a run started elsewhere shows.
    else if (watchedAgent === id) {
      watchedAgent = null;
      post({ type: 'unwatch' });
    }
  }
  if (cursorModels === null) void loadCursorModels();
  emit();
}

async function loadCursorModels(): Promise<void> {
  cursorModels = [];
  const reply = await askCursor({ type: 'geld:cursor', action: 'models' });
  if (isCursorModelsReply(reply) && reply.ok) cursorModels = reply.models;
  emit();
}

function watch(id: string): void {
  if (watchedAgent === id && port !== null) return;
  watchedAgent = id;
  post({ type: 'watch', agentId: id });
}

function watchIfRunning(id: string): void {
  const thread = agents.get(id);
  if (thread !== undefined && agentRunning(thread.live, thread.readStatus)) watch(id);
}

function scheduleReload(id: string): void {
  const pending = reloadTimers.get(id);
  if (pending !== undefined) clearTimeout(pending);
  reloadTimers.set(
    id,
    setTimeout(() => {
      reloadTimers.delete(id);
      void loadAgent(id, true);
    },
    RELOAD_AFTER_RUN_MS),
  );
}

function pollIdleAgent(): void {
  if (host === null || document.hidden || active === ASSISTANT) return;
  const thread = agents.get(active);
  // A run only the stream would report on is left to it, while the stream is open; any other thread is read again.
  if (thread === undefined || !thread.loaded || thread.sending || (agentRunning(thread.live, thread.readStatus) && watchedAgent === thread.id && port !== null)) return;
  void loadAgent(thread.id, true);
}

/* ------------------------------------------------------------------------- */
/* Sending                                                                     */
/* ------------------------------------------------------------------------- */

function sendAssistant(text: string): void {
  if (context === null || assistantStream !== null) return;
  const user = chatTurn('user', text);
  const reply = chatTurn('assistant', '', { streaming: true });
  const history: ChatTurnMessage[] = assistantTurns
    .filter((turn) => turn.error === null && turn.text !== '')
    .slice(-HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.text }));
  assistantTurns = [...assistantTurns, user, reply];
  assistantStream = reply.id;
  const messages: ChatTurnMessage[] = [{ role: 'system', content: assistantSystemPrompt(context.pull()) }, ...history, { role: 'user', content: text }];
  post({ type: 'assistant', id: reply.id, model: selectedModel(), messages });
  countUsage('chat_assistant_sent');
}

async function sendAgent(thread: AgentThread, text: string): Promise<void> {
  if (thread.sending) return;
  const running = agentRunning(thread.live, thread.readStatus);
  const user = chatTurn('user', text, { local: true });
  thread.turns = [...thread.turns, user];
  thread.sending = true;
  emit();
  const model = running ? null : selectedModel() || null;
  const epoch = session;
  const reply = await askCursor({ type: 'geld:cursor', action: 'send', agentId: thread.id, text, model, steer: running });
  thread.sending = false;
  if (epoch !== session || agents.get(thread.id) !== thread) return;
  if (!isCursorSendReply(reply) || !reply.ok) {
    const reason = isCursorSendReply(reply) && !reply.ok ? reply.reason : 'Cursor could not be reached.';
    thread.turns = thread.turns.map((turn) => (turn.id === user.id ? { ...turn, error: reason } : turn));
  } else {
    countUsage('chat_agent_sent');
    if (reply.delivery === 'run') {
      thread.live = { turn: null, status: 'CREATING', finished: false };
      watch(thread.id);
    } else {
      const note = reply.delivery === 'steered' ? 'Sent into the running turn' : 'Queued as the agent’s next message';
      thread.turns = thread.turns.map((turn) => (turn.id === user.id ? { ...turn, note } : turn));
    }
  }
  emit();
}

function submit(raw: string): void {
  const text = raw.trim();
  if (host === null || text === '' || !canSend()) return;
  if (active === ASSISTANT) sendAssistant(text);
  else {
    const thread = agents.get(active);
    if (thread !== undefined) void sendAgent(thread, text);
  }
  emit();
}

function canSend(): boolean {
  if (active === ASSISTANT) return assistantReady() && assistantStream === null;
  const thread = agents.get(active);
  return thread !== undefined && cursorUsable() && thread.loaded && thread.error === null && !thread.sending && thread.agent?.status !== 'ARCHIVED';
}

function stopAssistant(): void {
  if (assistantStream === null) return;
  const id = assistantStream;
  post({ type: 'stop', id });
  assistantStream = null;
  assistantTurns = assistantTurns.map((turn) => (turn.id === id ? { ...turn, streaming: false, note: 'Stopped' } : turn));
  saveAssistantChat();
  emit();
}

/* ------------------------------------------------------------------------- */
/* Models                                                                      */
/* ------------------------------------------------------------------------- */

/** The thread's model choices, and which one the next message uses. */
function modelChoices(): { readonly options: readonly ChatModelOption[]; readonly selected: string } {
  if (active === ASSISTANT) {
    const fallback = context?.ai.model ?? '';
    const ids = [...new Set([fallback, ...gatewayModels].filter((id) => id !== ''))];
    return {
      options: ids.map((id) => ({ value: id, label: id === fallback ? `${id} (default)` : id })),
      selected: chosenModels.assistant !== undefined && ids.includes(chosenModels.assistant) ? chosenModels.assistant : fallback,
    };
  }
  const options: ChatModelOption[] = [{ value: '', label: 'Agent’s model' }, ...(cursorModels ?? []).map((each) => ({ value: each.id, label: each.name }))];
  return { options, selected: chosenModels.cursor !== undefined && options.some((option) => option.value === chosenModels.cursor) ? chosenModels.cursor : '' };
}

function selectedModel(): string {
  return modelChoices().selected;
}

function chooseModel(value: string): void {
  chosenModels = active === ASSISTANT ? { ...chosenModels, assistant: value } : { ...chosenModels, cursor: value };
  persist(chatModelsItem.setValue(chosenModels));
  emit();
}

/* ------------------------------------------------------------------------- */
/* The assistant's chat, kept on this device                                   */
/* ------------------------------------------------------------------------- */

async function loadAssistantChat(key: string): Promise<void> {
  const stored = (await assistantChatsItem.getValue())[key];
  if (stored === undefined || loadedKey !== key || assistantTurns.length > 0) return;
  assistantTurns = stored.turns.map((turn) => chatTurn(turn.role, turn.text));
  emit();
}

function saveAssistantChat(): void {
  const key = loadedKey;
  if (key === null) return;
  const save: AssistantChatSave = { type: 'geld:chat-save', key, turns: assistantTurns.filter((turn) => !turn.streaming && turn.text !== '').map((turn) => ({ role: turn.role, text: turn.text })) };
  persist(browser.runtime.sendMessage(save));
}

function clearAssistantChat(): void {
  if (assistantStream !== null) stopAssistant();
  assistantTurns = [];
  saveAssistantChat();
  emit();
  host?.focusComposer();
}

/* ------------------------------------------------------------------------- */
/* The view                                                                    */
/* ------------------------------------------------------------------------- */

/** Coalesces a burst of changes (a reply streaming in) into one new view per frame. */
function emit(): void {
  if (host === null || emitFrame !== 0) return;
  emitFrame = requestAnimationFrame(() => {
    emitFrame = 0;
    view = null;
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getView(): ChatView {
  view ??= viewOf();
  return view;
}

function selectThread(id: string): void {
  if (active === id) return;
  active = id;
  chose = true;
  if (id !== ASSISTANT) {
    const thread = agents.get(id);
    // A thread read before is read again: its run may have ended, or gone on unwatched while another thread was shown.
    if (thread !== undefined && !thread.loading) void loadAgent(id, thread.loaded);
  }
  emit();
  host?.focusComposer();
}

function openSettings(): void {
  const message: OpenSettingsMessage = { type: 'geld:open-settings', section: 'experiments' };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

const ACTIONS: ChatActions = {
  selectThread,
  submit,
  sendPrompt: (text) => {
    if (active === ASSISTANT && canSend()) {
      sendAssistant(text);
      emit();
    }
    host?.focusComposer();
  },
  stop: stopAssistant,
  chooseModel,
  clear: clearAssistantChat,
  close: () => closeChat(),
  openSettings,
  draftChanged: (empty) => {
    draftEmpty = empty;
  },
};

const QUICK_PROMPTS = ['Summarize this pull request', 'What could break?', 'What do the open threads ask for?', 'Draft a review comment'];

function statusWords(thread: AgentThread): string {
  if (thread.agent?.status === 'ARCHIVED') return 'Archived';
  const status = thread.live.status ?? thread.readStatus;
  if (status !== null && isRunActive(status)) return 'Working';
  if (status === 'ERROR') return 'Last run failed';
  if (status === 'CANCELLED') return 'Last run cancelled';
  return thread.loaded ? 'Idle' : '';
}

function turnView(turn: ChatTurn, author: ChatTurnView['author']): ChatTurnView {
  return { id: turn.id, role: turn.role, author, text: turn.text, tools: turn.tools, streaming: turn.streaming, error: turn.error, note: turn.note };
}

function tabsView(): ChatTabView[] {
  const tabs: ChatTabView[] = [{ id: ASSISTANT, kind: 'assistant', label: 'Assistant', title: 'Geld’s assistant, through your AI gateway', running: assistantStream !== null }];
  for (const thread of agents.values()) {
    const name = thread.agent?.name ?? 'Cursor agent';
    tabs.push({ id: thread.id, kind: 'cursor', label: name, title: `Cursor agent: ${name}`, running: agentRunning(thread.live, thread.readStatus) });
  }
  return tabs;
}

function assistantBody(): ChatBodyView {
  if (!assistantReady()) {
    return { kind: 'empty', title: 'Set up the assistant', text: 'The assistant answers through your own AI gateway. Turn on AI features and add a gateway, its key and a model in Geld’s settings.', actions: [{ kind: 'settings', label: 'Open settings' }], prompts: [] };
  }
  if (assistantTurns.length === 0) {
    return { kind: 'empty', title: 'Ask about this pull request', text: 'The assistant reads its description, review threads and changed files with each question.', actions: [], prompts: QUICK_PROMPTS };
  }
  return { kind: 'turns', turns: assistantTurns.map((turn) => turnView(turn, 'assistant')), pending: null, notices: [] };
}

function agentBody(thread: AgentThread): ChatBodyView {
  const open = { kind: 'link' as const, label: 'Open in Cursor', href: thread.agent?.url ?? thread.href };
  if (cursorStatus === null && !thread.loaded) return { kind: 'loading', text: 'Connecting to Cursor…' };
  if (!cursorUsable()) {
    const text =
      cursorStatus?.connected === true
        ? 'Allow Geld to reach api.cursor.com in Geld’s settings, and this agent’s conversation shows here.'
        : 'Add a Cursor API key in Geld’s settings to read and continue this agent’s conversation here. Messages you send go into the same conversation you see in Cursor.';
    return { kind: 'empty', title: 'Chat with this agent here', text, actions: [{ kind: 'settings', label: 'Open settings' }, open], prompts: [] };
  }
  if (thread.error !== null && !thread.loaded) return { kind: 'empty', title: 'Could not open this conversation', text: thread.error, actions: [open], prompts: [] };
  if (thread.loading && !thread.loaded) return { kind: 'loading', text: 'Loading the conversation…' };
  const turns = thread.turns.map((turn) => turnView(turn, 'cursor'));
  if (thread.live.turn !== null) turns.push(turnView(thread.live.turn, 'cursor'));
  const running = agentRunning(thread.live, thread.readStatus);
  const pending = thread.live.turn === null && (running || thread.sending) ? (thread.sending ? 'Sending…' : 'Starting…') : null;
  const notices = [thread.notice, thread.error].filter((notice): notice is string => notice !== null);
  if (turns.length === 0 && pending === null && notices.length === 0) {
    return { kind: 'empty', title: 'No messages yet', text: 'Send the agent a follow-up. It works on this pull request’s branch as it does from Cursor.', actions: [], prompts: [] };
  }
  return { kind: 'turns', turns, pending, notices };
}

function composerView(thread: AgentThread | undefined): ChatComposerView {
  const running = thread !== undefined && agentRunning(thread.live, thread.readStatus);
  const stopping = active === ASSISTANT && assistantStream !== null;
  const { options, selected } = modelChoices();
  return {
    placeholder: active === ASSISTANT ? 'Ask about this pull request…' : running ? 'Steer the running agent…' : 'Message the agent…',
    models: options,
    model: selected,
    modelDisabled: active === ASSISTANT ? !assistantReady() : running || !cursorUsable(),
    modelTitle: running ? 'A message to a running agent goes into its current turn, on the model that turn uses' : 'Model for the next reply',
    mode: stopping ? 'stop' : running ? 'steer' : 'send',
    canSend: canSend(),
    disabled: active === ASSISTANT ? !assistantReady() : !cursorUsable() || thread?.agent?.status === 'ARCHIVED',
  };
}

function viewOf(): ChatView {
  const thread = active === ASSISTANT ? undefined : agents.get(active);
  const bar =
    thread === undefined
      ? { text: assistantReady() ? 'Knows this pull request’s description, threads and files' : null, status: null, link: null }
      : {
          text: 'Same conversation as in Cursor',
          status: statusWords(thread) === '' ? null : { words: statusWords(thread), running: agentRunning(thread.live, thread.readStatus) },
          link: { label: 'Open in Cursor', href: thread.agent?.url ?? thread.href },
        };
  return {
    tabs: tabsView(),
    active,
    bar,
    body: thread === undefined ? assistantBody() : agentBody(thread),
    canClear: active === ASSISTANT && assistantTurns.length > 0,
    composer: composerView(thread),
  };
}
