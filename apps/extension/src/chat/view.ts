/**
 * What the chat sidebar shows, as plain data: the store in `review/chat-sidebar.ts` builds it from its state, and the
 * React view in `chat-app.tsx` renders it and calls the actions back. Neither side reaches into the other.
 */

export interface ChatToolView {
  readonly callId: string;
  readonly line: string;
  readonly done: boolean;
}

export interface ChatTurnView {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  /** Who wrote an assistant turn: the byline's name and mark. */
  readonly author: 'assistant' | 'cursor';
  readonly text: string;
  readonly tools: readonly ChatToolView[];
  readonly streaming: boolean;
  readonly error: string | null;
  readonly note: string | null;
}

export interface ChatTabView {
  readonly id: string;
  readonly kind: 'assistant' | 'cursor';
  readonly label: string;
  readonly title: string;
  readonly running: boolean;
}

export type ChatActionView = { readonly kind: 'settings'; readonly label: string } | { readonly kind: 'link'; readonly label: string; readonly href: string };

export type ChatBodyView =
  | { readonly kind: 'loading'; readonly text: string }
  | { readonly kind: 'empty'; readonly title: string; readonly text: string; readonly actions: readonly ChatActionView[]; readonly prompts: readonly string[] }
  | {
      readonly kind: 'turns';
      readonly turns: readonly ChatTurnView[];
      /** A line for a turn that has not begun to show: "Starting…", "Sending…". */
      readonly pending: string | null;
      readonly notices: readonly string[];
    };

export interface ChatModelOption {
  readonly value: string;
  readonly label: string;
}

export interface ChatComposerView {
  readonly placeholder: string;
  readonly models: readonly ChatModelOption[];
  readonly model: string;
  readonly modelDisabled: boolean;
  readonly modelTitle: string;
  /** What the button does: send, send into the running turn, or stop the assistant's reply. */
  readonly mode: 'send' | 'steer' | 'stop';
  readonly canSend: boolean;
  readonly disabled: boolean;
}

export interface ChatBarView {
  readonly text: string | null;
  readonly status: { readonly words: string; readonly running: boolean } | null;
  readonly link: { readonly label: string; readonly href: string } | null;
}

export interface ChatView {
  readonly tabs: readonly ChatTabView[];
  readonly active: string;
  readonly bar: ChatBarView;
  readonly body: ChatBodyView;
  readonly canClear: boolean;
  readonly composer: ChatComposerView;
}

export interface ChatActions {
  readonly selectThread: (id: string) => void;
  readonly submit: (text: string) => void;
  readonly sendPrompt: (text: string) => void;
  readonly stop: () => void;
  readonly chooseModel: (value: string) => void;
  readonly clear: () => void;
  readonly close: () => void;
  readonly openSettings: () => void;
  /** Whether the composer holds text, so discovery never switches the thread under a draft. */
  readonly draftChanged: (empty: boolean) => void;
}
