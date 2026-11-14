import { browser } from 'wxt/browser';
import type { LoadChatUiMessage } from '../lib/messages';
import type { ChatHost, MountOptions } from './mount';

/**
 * The chat's React view is about as large as the rest of the content script, and most pages never open the chat, so
 * it is a script of its own (`entrypoints/chat-ui.ts`), injected into this tab's isolated world the first time the
 * sidebar opens. Scripts in one isolated world share its global, which is how the view hands over `mountChat`.
 */
export interface ChatUiModule {
  readonly mountChat: (options: MountOptions) => ChatHost;
}

const GLOBAL_KEY = '__geldChatUi';

function isChatUi(value: unknown): value is ChatUiModule {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'mountChat') === 'function';
}

export function registerChatUi(module: ChatUiModule): void {
  Reflect.set(globalThis, GLOBAL_KEY, module);
}

function registered(): ChatUiModule | null {
  const value: unknown = Reflect.get(globalThis, GLOBAL_KEY);
  return isChatUi(value) ? value : null;
}

let loading: Promise<ChatUiModule | null> | null = null;

/** The chat's view, injected on first use; null when the background could not inject it. */
export function loadChatUi(): Promise<ChatUiModule | null> {
  const ready = registered();
  if (ready !== null) return Promise.resolve(ready);
  loading ??= (async () => {
    const message: LoadChatUiMessage = { type: 'geld:load-chat-ui' };
    await browser.runtime.sendMessage(message).catch(() => undefined);
    const module = registered();
    if (module === null) loading = null;
    return module;
  })();
  return loading;
}
