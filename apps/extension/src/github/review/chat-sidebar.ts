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
 * that closes with the sidebar.
 */

import type { CursorAgent, CursorModel, PullChatContext } from '@geld/review';
import { assistantSystemPrompt, botAppAvatar, botById, isEvaluationModel, isRunActive } from '@geld/review';
import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { persist } from '../../lib/context';
import type { ChatPortRequest, ChatTurnMessage, CursorRequest, CursorStatusReply } from '../../lib/chat-messages';
import { CHAT_PING_MS, CHAT_PORT, isChatPortEvent, isCursorConversationReply, isCursorFindReply, isCursorModelsReply, isCursorSendReply, isCursorStatusReply } from '../../lib/chat-messages';
import type { ChatModels, StoredChat } from '../../lib/local-state';
import { ASSISTANT_CHATS_CAP, ASSISTANT_TURNS_CAP, aiGatewayItem, aiKeyItem, assistantChatsItem, chatModelsItem } from '../../lib/local-state';
import type { OpenSettingsMessage } from '../../lib/messages';
import { countUsage } from '../../lib/usage-count';
import { renderIssueMarkdown } from '../../ui/issue-markdown';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_CHECK, ICON_LINK_EXTERNAL, ICON_PAPER_AIRPLANE, ICON_SPARKLE_FILL, ICON_SPINNER, ICON_TRASH, ICON_X } from '../ui/icons';
import type { AgentLive, ChatTurn } from './chat-threads';
import { agentLiveStep, agentRunning, chatTurn, IDLE_LIVE, turnsFromHistory } from './chat-threads';

const CLASS = 'geld-chat';
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

interface Sidebar {
  readonly root: HTMLElement;
  readonly tabs: HTMLElement;
  readonly clear: HTMLButtonElement;
  readonly bar: HTMLElement;
  readonly log: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly model: HTMLSelectElement;
  readonly send: HTMLButtonElement;
}

let context: ChatPageContext | null = null;
let ui: Sidebar | null = null;
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
let renderFrame = 0;
let opener: HTMLElement | null = null;

export function chatOpen(): boolean {
  return ui !== null;
}

function markChatButtons(): void {
  for (const button of document.querySelectorAll('[data-geld-focus="chat"]')) button.setAttribute('aria-pressed', String(ui !== null));
}

/** The digest's latest reading of the page. An open sidebar takes in agents newly linked; a different pull request closes it. */
export function setChatContext(next: ChatPageContext): void {
  context = next;
  if (ui === null) return;
  if (loadedKey !== next.pageKey) {
    closeChat();
    return;
  }
  let added = false;
  for (const linked of next.linkedAgents) added = ensureAgent(linked.id, linked.href) || added;
  if (added) scheduleRender();
}

/** After a navigation: a sidebar opened on another pull request closes. */
export function syncChatToPage(): void {
  if (ui !== null && context !== null && !location.pathname.startsWith(context.pullPath)) closeChat();
}

export function toggleChat(from: HTMLElement | null = null): void {
  if (ui !== null) closeChat();
  else openChat(from);
}

function openChat(from: HTMLElement | null): void {
  if (context === null) return;
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
  for (const linked of context.linkedAgents) ensureAgent(linked.id, linked.href);
  if (!chose && context.preferCursor && context.linkedAgents[0] !== undefined) active = context.linkedAgents[0].id;
  ui = buildSidebar();
  document.documentElement.setAttribute('data-geld-chat-open', '');
  document.body.append(ui.root);
  render();
  markChatButtons();
  ui.input.focus({ preventScroll: true });
  countUsage('chat_opened');
  void readLocalState().then(scheduleRender);
  void discoverAgents();
  pollTimer = setInterval(pollIdleAgent, IDLE_POLL_MS);
}

export function closeChat(): void {
  if (ui === null) return;
  const returnTo = opener?.isConnected === true ? opener : document.querySelector<HTMLElement>('[data-geld-focus="chat"]');
  ui.root.remove();
  ui = null;
  document.documentElement.removeAttribute('data-geld-chat-open');
  markChatButtons();
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  for (const timer of reloadTimers.values()) clearTimeout(timer);
  reloadTimers.clear();
  if (renderFrame !== 0) cancelAnimationFrame(renderFrame);
  renderFrame = 0;
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
  const [key, gateway, models] = await Promise.all([aiKeyItem.getValue(), aiGatewayItem.getValue(), chatModelsItem.getValue()]);
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
    if (ui !== null && watched !== null) setTimeout(() => watchIfRunning(watched), 1000);
    scheduleRender();
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
  scheduleRender();
}

/* ------------------------------------------------------------------------- */
/* Cursor agents                                                               */
/* ------------------------------------------------------------------------- */

async function discoverAgents(): Promise<void> {
  const reply = await askCursor({ type: 'geld:cursor', action: 'status' });
  cursorStatus = isCursorStatusReply(reply) ? reply : null;
  if (ui === null || context === null) return;
  if (cursorStatus?.connected === true && cursorStatus.permitted) {
    const found = await askCursor({ type: 'geld:cursor', action: 'find', prUrl: context.prUrl, ids: context.linkedAgents.map((linked) => linked.id) });
    if (ui === null) return;
    if (isCursorFindReply(found) && found.ok) {
      for (const agent of found.agents) {
        ensureAgent(agent.id, agent.url);
        const thread = agents.get(agent.id);
        if (thread !== undefined) thread.agent = agent;
      }
      const first = found.agents[0];
      if (!chose && context.preferCursor && first !== undefined && active === ASSISTANT && ui.input.value === '' && assistantTurns.length === 0) active = first.id;
    }
  }
  scheduleRender();
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
    scheduleRender();
  }
  const reply = await askCursor({ type: 'geld:cursor', action: 'conversation', agentId: id });
  thread.loading = false;
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
  scheduleRender();
}

async function loadCursorModels(): Promise<void> {
  cursorModels = [];
  const reply = await askCursor({ type: 'geld:cursor', action: 'models' });
  if (isCursorModelsReply(reply) && reply.ok) cursorModels = reply.models;
  scheduleRender();
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
  if (ui === null || document.hidden || active === ASSISTANT) return;
  const thread = agents.get(active);
  if (thread === undefined || !thread.loaded || thread.sending || agentRunning(thread.live, thread.readStatus)) return;
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
  scheduleRender();
  const model = running ? null : selectedModel() || null;
  const reply = await askCursor({ type: 'geld:cursor', action: 'send', agentId: thread.id, text, model, steer: running });
  thread.sending = false;
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
  scheduleRender();
}

function submit(): void {
  if (ui === null) return;
  const text = ui.input.value.trim();
  if (text === '' || !canSend()) return;
  ui.input.value = '';
  if (active === ASSISTANT) sendAssistant(text);
  else {
    const thread = agents.get(active);
    if (thread !== undefined) void sendAgent(thread, text);
  }
  render();
  scrollToEnd(true);
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
  render();
}

/* ------------------------------------------------------------------------- */
/* Models                                                                      */
/* ------------------------------------------------------------------------- */

function selectedModel(): string {
  return ui?.model.value ?? '';
}

function fillModels(model: HTMLSelectElement): void {
  const options: { readonly value: string; readonly label: string }[] = [];
  let selected: string;
  if (active === ASSISTANT) {
    const fallback = context?.ai.model ?? '';
    const ids = [...new Set([fallback, ...gatewayModels].filter((id) => id !== ''))];
    for (const id of ids) options.push({ value: id, label: id === fallback ? `${id} (default)` : id });
    selected = chosenModels.assistant !== undefined && ids.includes(chosenModels.assistant) ? chosenModels.assistant : fallback;
  } else {
    options.push({ value: '', label: 'Agent’s model' });
    for (const each of cursorModels ?? []) options.push({ value: each.id, label: each.name });
    selected = chosenModels.cursor !== undefined && options.some((option) => option.value === chosenModels.cursor) ? chosenModels.cursor : '';
  }
  const signature = JSON.stringify([options, selected]);
  if (model.dataset.signature === signature) return;
  model.dataset.signature = signature;
  model.replaceChildren(...options.map((option) => createElement('option', { value: option.value }, [option.label])));
  model.value = selected;
}

function rememberModel(): void {
  if (ui === null) return;
  const value = ui.model.value;
  chosenModels = active === ASSISTANT ? { ...chosenModels, assistant: value } : { ...chosenModels, cursor: value };
  persist(chatModelsItem.setValue(chosenModels));
}

/* ------------------------------------------------------------------------- */
/* The assistant's chat, kept on this device                                   */
/* ------------------------------------------------------------------------- */

async function loadAssistantChat(key: string): Promise<void> {
  const stored = (await assistantChatsItem.getValue())[key];
  if (stored === undefined || loadedKey !== key || assistantTurns.length > 0) return;
  assistantTurns = stored.turns.map((turn) => chatTurn(turn.role, turn.text));
  scheduleRender();
}

function saveAssistantChat(): void {
  const key = loadedKey;
  if (key === null) return;
  const turns = assistantTurns.filter((turn) => !turn.streaming && turn.text !== '').slice(-ASSISTANT_TURNS_CAP).map((turn) => ({ role: turn.role, text: turn.text }));
  persist(
    assistantChatsItem.getValue().then((all) => {
      const rest = Object.entries(all).filter(([each]) => each !== key);
      const kept: [string, StoredChat][] = turns.length === 0 ? rest : [...rest, [key, { at: new Date().toISOString(), turns }]];
      kept.sort((a, b) => a[1].at.localeCompare(b[1].at));
      return assistantChatsItem.setValue(Object.fromEntries(kept.slice(-ASSISTANT_CHATS_CAP)));
    }),
  );
}

function clearAssistantChat(): void {
  if (assistantStream !== null) stopAssistant();
  assistantTurns = [];
  saveAssistantChat();
  render();
  ui?.input.focus();
}

/* ------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* ------------------------------------------------------------------------- */

function icon(markup: string): SVGElement {
  return svgFromString(markup);
}

const CURSOR_MARK = ((): string | null => {
  const bot = botById('bugbot');
  return bot === null ? null : botAppAvatar(bot, 40);
})();

function cursorMark(): HTMLElement {
  return CURSOR_MARK === null ? createElement('span', { class: `${CLASS}__mark` }) : createElement('img', { class: `${CLASS}__mark`, src: CURSOR_MARK, alt: '', width: '16', height: '16' });
}

function buildSidebar(): Sidebar {
  const tabs = createElement('div', { class: `${CLASS}__tabs`, role: 'tablist', 'aria-label': 'Conversations' });
  const clear = createElement('button', { type: 'button', class: `${CLASS}__icon`, 'aria-label': 'Clear this chat', title: 'Clear this chat' }, [icon(ICON_TRASH)]);
  clear.addEventListener('click', clearAssistantChat);
  const close = createElement('button', { type: 'button', class: `${CLASS}__icon`, 'aria-label': 'Close chat', title: 'Close chat' }, [icon(ICON_X)]);
  close.addEventListener('click', () => closeChat());
  const head = createElement('div', { class: `${CLASS}__head` }, [tabs, clear, close]);
  const bar = createElement('div', { class: `${CLASS}__bar` });
  const log = createElement('div', { class: `${CLASS}__log`, role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions text' });
  const input = createElement('textarea', { class: `${CLASS}__input`, rows: '3', 'aria-label': 'Message' });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  input.addEventListener('input', () => updateComposer());
  const model = createElement('select', { class: `${CLASS}__model`, 'aria-label': 'Model' });
  model.addEventListener('change', rememberModel);
  const send = createElement('button', { type: 'submit', class: `${CLASS}__send` });
  const form = createElement('form', { class: `${CLASS}__composer` }, [input, createElement('div', { class: `${CLASS}__composer-row` }, [model, send])]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (active === ASSISTANT && assistantStream !== null) stopAssistant();
    else submit();
  });
  const root = createElement('aside', { class: CLASS, [OWN_UI_ATTRIBUTE]: '', 'aria-label': 'Geld chat' }, [head, bar, log, form]);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing && !(event.target instanceof HTMLSelectElement)) {
      event.stopPropagation();
      closeChat();
    }
  });
  return { root, tabs, clear, bar, log, input, model, send };
}

function scheduleRender(): void {
  if (ui === null || renderFrame !== 0) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    render();
  });
}

function nearEnd(log: HTMLElement): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

function scrollToEnd(force: boolean): void {
  if (ui === null) return;
  if (force || nearEnd(ui.log)) ui.log.scrollTop = ui.log.scrollHeight;
}

function render(): void {
  if (ui === null) return;
  const follow = nearEnd(ui.log);
  renderTabs(ui);
  renderBar(ui);
  renderLog(ui);
  ui.clear.hidden = active !== ASSISTANT || assistantTurns.length === 0;
  updateComposer();
  if (follow) scrollToEnd(true);
}

function selectThread(id: string): void {
  if (active === id) return;
  active = id;
  chose = true;
  if (id !== ASSISTANT) {
    const thread = agents.get(id);
    if (thread !== undefined && !thread.loaded && !thread.loading) void loadAgent(id);
  }
  render();
  scrollToEnd(true);
  ui?.input.focus({ preventScroll: true });
}

function renderTabs(view: Sidebar): void {
  const make = (id: string, label: string, mark: Element, title: string, running: boolean): HTMLButtonElement => {
    const selected = id === active;
    const tab = createElement('button', { type: 'button', class: `${CLASS}__tab`, role: 'tab', 'aria-selected': String(selected), title, tabindex: selected ? '0' : '-1', 'data-thread': id }, [mark, createElement('span', { class: `${CLASS}__tab-label` }, [label])]);
    if (running) tab.append(createElement('span', { class: `${CLASS}__live`, 'aria-label': 'Running' }));
    tab.addEventListener('click', () => selectThread(id));
    return tab;
  };
  const tabs = [make(ASSISTANT, 'Assistant', icon(ICON_SPARKLE_FILL), 'Geld’s assistant, through your AI gateway', assistantStream !== null)];
  for (const thread of agents.values()) {
    const name = thread.agent?.name ?? 'Cursor agent';
    tabs.push(make(thread.id, name, cursorMark(), `Cursor agent: ${name}`, agentRunning(thread.live, thread.readStatus)));
  }
  const focused = document.activeElement instanceof HTMLElement && view.tabs.contains(document.activeElement) ? document.activeElement.dataset.thread : undefined;
  view.tabs.replaceChildren(...tabs);
  if (focused !== undefined) tabs.find((tab) => tab.dataset.thread === focused)?.focus({ preventScroll: true });
  view.tabs.onkeydown = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex((tab) => tab.dataset.thread === active);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (next?.dataset.thread !== undefined) {
      selectThread(next.dataset.thread);
      view.tabs.querySelector<HTMLElement>(`[data-thread="${next.dataset.thread}"]`)?.focus();
    }
  };
}

function statusWords(thread: AgentThread): string {
  if (thread.agent?.status === 'ARCHIVED') return 'Archived';
  const status = thread.live.status ?? thread.readStatus;
  if (status !== null && isRunActive(status)) return 'Working';
  if (status === 'ERROR') return 'Last run failed';
  if (status === 'CANCELLED') return 'Last run cancelled';
  return thread.loaded ? 'Idle' : '';
}

function renderBar(view: Sidebar): void {
  if (active === ASSISTANT) {
    view.bar.replaceChildren(...(assistantReady() ? ['Knows this pull request’s description, threads and files'] : []));
    view.bar.hidden = !assistantReady();
    return;
  }
  const thread = agents.get(active);
  if (thread === undefined) return;
  view.bar.hidden = false;
  const link = createElement('a', { class: `${CLASS}__open`, href: thread.agent?.url ?? thread.href, target: '_blank', rel: 'noreferrer' }, ['Open in Cursor', icon(ICON_LINK_EXTERNAL)]);
  const words = statusWords(thread);
  const parts: (Node | string)[] = [];
  if (words !== '') parts.push(createElement('span', { class: `${CLASS}__status`, 'data-running': String(agentRunning(thread.live, thread.readStatus)) }, [words]));
  parts.push(createElement('span', { class: `${CLASS}__bar-note` }, ['Same conversation as in Cursor']), link);
  view.bar.replaceChildren(...parts);
}

function settingsButton(label: string): HTMLButtonElement {
  const button = createElement('button', { type: 'button', class: 'btn btn-sm' }, [label]);
  button.addEventListener('click', () => {
    const message: OpenSettingsMessage = { type: 'geld:open-settings', section: 'experiments' };
    void browser.runtime.sendMessage(message).catch(() => undefined);
  });
  return button;
}

function emptyState(title: string, text: string, actions: readonly HTMLElement[] = []): HTMLElement {
  return createElement('div', { class: `${CLASS}__empty` }, [createElement('p', { class: `${CLASS}__empty-title` }, [title]), createElement('p', {}, [text]), ...(actions.length === 0 ? [] : [createElement('div', { class: `${CLASS}__empty-actions` }, [...actions])])]);
}

const QUICK_PROMPTS = ['Summarize this pull request', 'What could break?', 'What do the open threads ask for?', 'Draft a review comment'];

function renderLog(view: Sidebar): void {
  if (active === ASSISTANT) {
    if (!assistantReady()) {
      view.log.replaceChildren(emptyState('Set up the assistant', 'The assistant answers through your own AI gateway. Turn on AI features and add a gateway, its key and a model in Geld’s settings.', [settingsButton('Open settings')]));
      return;
    }
    if (assistantTurns.length === 0) {
      const prompts = QUICK_PROMPTS.map((prompt) => {
        const button = createElement('button', { type: 'button', class: `${CLASS}__prompt` }, [prompt]);
        button.addEventListener('click', () => {
          if (!canSend()) return;
          sendAssistant(prompt);
          render();
          ui?.input.focus({ preventScroll: true });
        });
        return button;
      });
      view.log.replaceChildren(emptyState('Ask about this pull request', 'The assistant reads its description, review threads and changed files with each question.', prompts));
      return;
    }
    view.log.replaceChildren(...assistantTurns.map((turn) => turnElement(turn, 'Assistant')));
    return;
  }
  const thread = agents.get(active);
  if (thread === undefined) return;
  const open = createElement('a', { class: 'btn btn-sm', href: thread.agent?.url ?? thread.href, target: '_blank', rel: 'noreferrer' }, ['Open in Cursor']);
  if (cursorStatus === null && !thread.loaded) {
    view.log.replaceChildren(loading('Connecting to Cursor…'));
    return;
  }
  if (!cursorUsable()) {
    const words =
      cursorStatus?.connected === true
        ? 'Allow Geld to reach api.cursor.com in Geld’s settings, and this agent’s conversation shows here.'
        : 'Add a Cursor API key in Geld’s settings to read and continue this agent’s conversation here. Messages you send go into the same conversation you see in Cursor.';
    view.log.replaceChildren(emptyState('Chat with this agent here', words, [settingsButton('Open settings'), open]));
    return;
  }
  if (thread.error !== null && !thread.loaded) {
    view.log.replaceChildren(emptyState('Could not open this conversation', thread.error, [open]));
    return;
  }
  if (thread.loading && !thread.loaded) {
    view.log.replaceChildren(loading('Loading the conversation…'));
    return;
  }
  const nodes: HTMLElement[] = thread.turns.map((turn) => turnElement(turn, 'Cursor'));
  if (thread.live.turn !== null) nodes.push(turnElement(thread.live.turn, 'Cursor'));
  else if (agentRunning(thread.live, thread.readStatus) || thread.sending) nodes.push(loading(thread.sending ? 'Sending…' : 'Starting…'));
  if (thread.notice !== null) nodes.push(createElement('p', { class: `${CLASS}__error` }, [thread.notice]));
  if (thread.error !== null) nodes.push(createElement('p', { class: `${CLASS}__error` }, [thread.error]));
  if (nodes.length === 0) nodes.push(emptyState('No messages yet', 'Send the agent a follow-up. It works on this pull request’s branch as it does from Cursor.'));
  view.log.replaceChildren(...nodes);
}

function loading(words: string): HTMLElement {
  return createElement('div', { class: `${CLASS}__loading` }, [icon(ICON_SPINNER), createElement('span', {}, [words])]);
}

function turnElement(turn: ChatTurn, name: string): HTMLElement {
  const element = createElement('div', { class: `${CLASS}__turn`, 'data-role': turn.role });
  if (turn.role === 'user') {
    element.append(createElement('div', { class: `${CLASS}__bubble` }, [turn.text]));
  } else {
    element.append(createElement('div', { class: `${CLASS}__byline` }, [name === 'Cursor' ? cursorMark() : icon(ICON_SPARKLE_FILL), name]));
    if (turn.tools.length > 0) {
      element.append(
        createElement(
          'ul',
          { class: `${CLASS}__tools` },
          turn.tools.map((tool) => createElement('li', { 'data-done': String(tool.done) }, [icon(tool.done ? ICON_CHECK : ICON_SPINNER), createElement('span', {}, [tool.line])])),
        ),
      );
    }
    if (turn.text !== '') {
      const body = createElement('div', { class: `${CLASS}__text markdown-body` });
      body.append(renderIssueMarkdown(turn.text, `${CLASS}__image`));
      element.append(body);
    } else if (turn.streaming && turn.tools.length === 0) {
      element.append(loading('Thinking…'));
    }
  }
  if (turn.error !== null) element.append(createElement('p', { class: `${CLASS}__error` }, [turn.error]));
  if (turn.note !== null) element.append(createElement('p', { class: `${CLASS}__note` }, [turn.note]));
  return element;
}

function updateComposer(): void {
  if (ui === null) return;
  const { input, model, send } = ui;
  const thread = active === ASSISTANT ? undefined : agents.get(active);
  const running = thread !== undefined && agentRunning(thread.live, thread.readStatus);
  input.placeholder = active === ASSISTANT ? 'Ask about this pull request…' : running ? 'Steer the running agent…' : 'Message the agent…';
  fillModels(model);
  model.disabled = active === ASSISTANT ? !assistantReady() : running || !cursorUsable();
  model.title = running ? 'A message to a running agent goes into its current turn, on the model that turn uses' : 'Model for the next reply';
  const stopping = active === ASSISTANT && assistantStream !== null;
  const label = stopping ? 'Stop' : running ? 'Steer' : 'Send';
  send.replaceChildren(stopping ? createElement('span', { class: `${CLASS}__stop` }) : icon(ICON_PAPER_AIRPLANE));
  send.setAttribute('aria-label', label);
  send.title = stopping ? 'Stop the reply' : running ? 'Send into the running turn (Enter)' : 'Send (Enter)';
  send.disabled = !stopping && (!canSend() || input.value.trim() === '');
  input.disabled = active === ASSISTANT ? !assistantReady() : !cursorUsable() || thread?.agent?.status === 'ARCHIVED';
}
