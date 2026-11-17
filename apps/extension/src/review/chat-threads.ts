import type { AgentStreamUpdate, CursorMessage } from '@geld/review';
import { isRunActive, toolLine } from '@geld/review';

/** One tool call of an agent's turn, as one line. */
export interface ChatTool {
  readonly callId: string;
  readonly line: string;
  readonly done: boolean;
}

export interface ChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly tools: readonly ChatTool[];
  readonly streaming: boolean;
  readonly error: string | null;
  /** Sent from this sidebar and not yet read back from the provider's own record of the conversation. */
  readonly local: boolean;
  /** A short muted line under the turn: the model that wrote it, or how a message to a running agent landed. */
  readonly note: string | null;
}

export function chatTurn(role: ChatTurn['role'], text: string, overrides: Partial<ChatTurn> = {}): ChatTurn {
  return { id: overrides.id ?? `${role}-${Math.random().toString(36).slice(2)}`, role, text, tools: [], streaming: false, error: null, local: false, note: null, ...overrides };
}

/**
 * An agent's conversation as Cursor keeps it. While a run is under way its replies so far are left out: the live
 * stream plays that run again from its start, and both would show the same words twice.
 */
export function turnsFromHistory(messages: readonly CursorMessage[], runActive: boolean): ChatTurn[] {
  let end = messages.length;
  if (runActive) {
    const lastUser = messages.map((message) => message.role).lastIndexOf('user');
    end = lastUser === -1 ? 0 : lastUser + 1;
  }
  return messages.slice(0, end).map((message) => chatTurn(message.role, message.text, { id: message.id }));
}

/** What the agent is doing now: its current turn, as streamed, and its run's status. */
export interface AgentLive {
  readonly turn: ChatTurn | null;
  readonly status: string | null;
  /** The run ended since the last reading of the conversation, which should be read again. */
  readonly finished: boolean;
}

export const IDLE_LIVE: AgentLive = { turn: null, status: null, finished: false };

const liveTurn = (): ChatTurn => chatTurn('assistant', '', { id: `live-${Date.now()}`, streaming: true });

export function agentLiveStep(live: AgentLive, update: AgentStreamUpdate): AgentLive {
  switch (update.kind) {
    case 'status': {
      if (isRunActive(update.status)) return { turn: live.turn?.streaming === true ? live.turn : liveTurn(), status: update.status, finished: false };
      return { turn: live.turn === null ? null : { ...live.turn, streaming: false }, status: update.status, finished: live.turn !== null || live.finished };
    }
    case 'assistant': {
      const turn = live.turn ?? liveTurn();
      return { ...live, turn: { ...turn, text: turn.text + update.text, streaming: true } };
    }
    case 'thinking':
      return live.turn === null ? { ...live, turn: liveTurn() } : live;
    case 'tool': {
      const turn = live.turn ?? liveTurn();
      const line = toolLine(update.name, update.detail);
      const known = turn.tools.some((tool) => tool.callId === update.callId);
      const tools = known ? turn.tools.map((tool) => (tool.callId === update.callId ? { ...tool, line, done: update.status === 'completed' } : tool)) : [...turn.tools, { callId: update.callId, line, done: update.status === 'completed' }];
      return { ...live, turn: { ...turn, tools, streaming: true } };
    }
    case 'result': {
      const turn = live.turn ?? liveTurn();
      return { turn: { ...turn, text: update.text ?? turn.text, streaming: false }, status: update.status, finished: true };
    }
    case 'error':
      return { turn: live.turn === null ? null : { ...live.turn, streaming: false, error: update.message }, status: live.status, finished: true };
    case 'done':
      return live;
  }
}

/** Whether the agent's run is under way, from the stream when it has said, else from the last reading. */
export function agentRunning(live: AgentLive, readStatus: string | null): boolean {
  const status = live.status ?? readStatus;
  return status !== null && isRunActive(status);
}
