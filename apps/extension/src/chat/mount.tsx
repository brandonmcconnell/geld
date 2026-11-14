import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { OWN_UI_ATTRIBUTE } from '../github/dom';
import { ChatApp, ChatCrashed } from './chat-app';
import chatCss from './chat.css?inline';
import type { ChatActions, ChatView } from './view';

export interface ChatHost {
  readonly unmount: () => void;
  readonly focusComposer: () => void;
}

export interface MountOptions {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getView: () => ChatView;
  readonly actions: ChatActions;
  /** An error the view could not recover from, reported by the content script, whose error capture this bundle does not share. */
  readonly onError: (error: unknown) => void;
}

/** Keys typed in the chat stay in it: past the shadow root GitHub's shortcuts see the host, not a field, and act on them. */
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

let sheet: CSSStyleSheet | null = null;
let propertiesRegistered = false;

function chatSheet(): CSSStyleSheet {
  if (sheet === null) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(chatCss);
  }
  return sheet;
}

/**
 * Tailwind's shadows, rings and transforms read custom properties it registers with `@property`, and a browser takes
 * `@property` from the document's stylesheets only, never a shadow root's. Registered once on the document, they
 * apply in the shadow root too; nothing on GitHub's page uses Tailwind's `--tw-` names.
 */
function registerProperties(): void {
  if (propertiesRegistered) return;
  propertiesRegistered = true;
  const rules = chatCss.match(/@property\s+--tw-[\w-]+\s*\{[^}]*\}/g) ?? [];
  if (rules.length === 0) return;
  const properties = new CSSStyleSheet();
  properties.replaceSync(rules.join('\n'));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, properties];
}

function githubDark(): boolean {
  const mode = document.documentElement.getAttribute('data-color-mode');
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The sidebar's host, docked by the page's stylesheet (`.geld-chat`), with the React view in its shadow root. */
export function mountChat(options: MountOptions): ChatHost {
  const host = document.createElement('div');
  host.className = 'geld-chat';
  host.setAttribute(OWN_UI_ATTRIBUTE, '');
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Geld chat');
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    shadow.adoptedStyleSheets = [chatSheet()];
    registerProperties();
  } catch {
    const style = document.createElement('style');
    style.textContent = chatCss;
    shadow.append(style);
  }
  const container = document.createElement('div');
  container.className = 'h-full';
  const portal = document.createElement('div');
  shadow.append(container, portal);
  const syncScheme = (): void => {
    container.toggleAttribute('data-dark', githubDark());
    portal.toggleAttribute('data-dark', githubDark());
  };
  syncScheme();
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', syncScheme);
  const modeWatch = new MutationObserver(syncScheme);
  modeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode'] });
  const stop = (event: Event): void => event.stopPropagation();
  for (const type of KEY_EVENTS) host.addEventListener(type, stop);
  document.body.append(host);
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      options.onError(error);
      root.render(<ChatCrashed onClose={options.actions.close} />);
    },
  });
  flushSync(() => root.render(<ChatApp subscribe={options.subscribe} getView={options.getView} actions={options.actions} portal={portal} />));
  return {
    unmount: () => {
      media.removeEventListener('change', syncScheme);
      modeWatch.disconnect();
      root.unmount();
      host.remove();
    },
    focusComposer: () => shadow.querySelector('textarea')?.focus({ preventScroll: true }),
  };
}
