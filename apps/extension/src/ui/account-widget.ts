import { browser } from 'wxt/browser';
import type { AuthFlowState, GitHubAccount, SyncState } from '../lib/account';
import { accountItem, authFlowItem, syncStateItem } from '../lib/account';
import type { AccountActionMessage } from '../lib/messages';
import { isAccountActionResponse } from '../lib/messages';

/**
 * The account control shown top-right in the popup and options page:
 * "Sign in with GitHub" → device code → avatar + sync status, plus the
 * one-time "which settings win?" prompt after signing in.
 */

const GITHUB_MARK =
  '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>';

export interface AccountWidgetOptions {
  /** Compact renders a single button/avatar row (popup); full adds explanations (options). */
  readonly variant: 'compact' | 'full';
  /** Where to render the conflict prompt; defaults to right under the widget. */
  readonly promptHost?: HTMLElement;
}

async function send(action: AccountActionMessage['action']): Promise<string | null> {
  const message: AccountActionMessage = { type: 'geld:account', action };
  try {
    const response: unknown = await browser.runtime.sendMessage(message);
    if (isAccountActionResponse(response) && !response.ok) return response.message;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', children: ReadonlyArray<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
}

function button(label: ReadonlyArray<Node | string>, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', `geld-button ${className}`, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function svg(markup: string): Element {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content.firstElementChild ?? document.createElement('span');
}

function relative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function mountAccountWidget(host: HTMLElement, options: AccountWidgetOptions): () => void {
  const promptHost = options.promptHost ?? host;
  let account: GitHubAccount | null = null;
  let flow: AuthFlowState = { status: 'idle' };
  let sync: SyncState | null = null;
  let localError: string | null = null;

  const act = async (action: AccountActionMessage['action']): Promise<void> => {
    localError = await send(action);
    render();
  };

  function render(): void {
    host.replaceChildren();
    for (const stale of promptHost.querySelectorAll('.geld-account__prompt, .geld-account__error')) stale.remove();

    if (account === null) {
      if (flow.status === 'pending') {
        const code = el('code', 'geld-account__code', [flow.userCode]);
        const open = el('a', 'geld-button geld-button--small', ['Open GitHub']);
        open.href = flow.verificationUri;
        open.target = '_blank';
        open.rel = 'noreferrer';
        host.append(
          el('div', 'geld-account__pending', [
            el('span', 'geld-account__hint', ['Enter this code on GitHub:']),
            code,
            open,
            button(['Cancel'], 'geld-button--small geld-button--link', () => void act('cancel-sign-in')),
          ]),
        );
        return;
      }
      const label = options.variant === 'compact' ? 'Sign in' : 'Sign in with GitHub';
      const signIn = button([svg(GITHUB_MARK), label], 'geld-button--small geld-account__signin', () => void act('sign-in'));
      signIn.title = 'Sign in with GitHub to sync your settings';
      host.append(signIn);
      const message = flow.status === 'error' ? flow.message : localError;
      if (message !== null) promptHost.append(el('p', 'geld-status geld-account__error', [message]));
      return;
    }

    const avatar = el('img', 'geld-account__avatar');
    avatar.src = account.avatarUrl;
    avatar.alt = '';
    avatar.width = 20;
    avatar.height = 20;
    const status =
      sync?.lastError !== null && sync?.lastError !== undefined
        ? `Sync error: ${sync.lastError}`
        : sync?.pendingChoice !== null && sync?.pendingChoice !== undefined
          ? 'Waiting for your choice'
          : sync?.lastSyncedAt !== null && sync?.lastSyncedAt !== undefined
            ? `Synced ${relative(sync.lastSyncedAt)}`
            : 'Syncing…';
    const details = el('details', 'geld-account__menu');
    const summary = el('summary', 'geld-account__summary', [avatar, el('span', 'geld-account__login', [account.login])]);
    summary.title = status;
    const menu = el('div', 'geld-account__menu-body', [
      el('p', 'geld-account__status', [status]),
      button(['Sync now'], 'geld-button--small', () => void act('sync-now')),
      button(['Sign out'], 'geld-button--small geld-button--link', () => void act('sign-out')),
    ]);
    details.append(summary, menu);
    host.append(details);
    if (localError !== null) promptHost.append(el('p', 'geld-status geld-account__error', [localError]));

    const choice = sync?.pendingChoice ?? null;
    if (choice !== null) {
      const when = new Date(choice.remoteUpdatedAt).toLocaleString();
      promptHost.append(
        el('div', 'geld-account__prompt', [
          el('p', 'geld-account__prompt-text', [
            `Your GitHub account already has Geld settings (saved ${when}) that differ from this device's. Which should win?`,
          ]),
          el('div', 'geld-account__prompt-actions', [
            button(['Use account settings'], 'geld-button--small geld-button--primary', () => void act('resolve-remote')),
            button(['Keep mine (overwrite account)'], 'geld-button--small', () => void act('resolve-local')),
          ]),
        ]),
      );
    }
  }

  const unwatchers = [
    accountItem.watch((value) => {
      account = value;
      render();
    }),
    authFlowItem.watch((value) => {
      flow = value;
      render();
    }),
    syncStateItem.watch((value) => {
      sync = value;
      render();
    }),
  ];
  void Promise.all([accountItem.getValue(), authFlowItem.getValue(), syncStateItem.getValue()]).then(([a, f, s]) => {
    account = a;
    flow = f;
    sync = s;
    render();
    // Pick up changes made on other devices whenever the UI opens.
    if (a !== null && s.pendingChoice === null) void send('sync-now');
  });

  return () => unwatchers.forEach((unwatch) => unwatch());
}
