import { CORRUPTED_SETTINGS_COPY } from '@geld/core';
import { RECONNECT_COPY } from '@geld/github';
import { browser } from 'wxt/browser';
import type { AuthFlowState, GitHubAccount, SyncState } from '../lib/account';
import { accountItem, authFlowItem, EMPTY_SYNC_STATE, syncStateItem } from '../lib/account';
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
  let sync: SyncState = EMPTY_SYNC_STATE;
  let localError: string | null = null;

  const act = async (action: AccountActionMessage['action']): Promise<void> => {
    localError = await send(action);
    render();
  };

  function render(): void {
    host.replaceChildren();
    for (const stale of promptHost.querySelectorAll('.geld-account__prompt, .geld-account__error, .geld-alert')) stale.remove();

    renderDialog();

    if (account === null) {
      if (flow.status === 'pending') {
        host.append(
          el('div', 'geld-account__pending', [
            el('span', 'geld-account__hint', ['Signing in…']),
            button(['Show code'], 'geld-button--small', () => openDialog()),
          ]),
        );
        return;
      }
      const label = options.variant === 'compact' ? 'Sign in' : 'Sign in with GitHub';
      const signIn = button([svg(GITHUB_MARK), label], 'geld-button--small geld-account__signin', () => {
        dialogWanted = true;
        void act('sign-in');
      });
      signIn.title = 'Sign in with GitHub to sync your settings';
      host.append(signIn);
      if (localError !== null && flow.status !== 'error') promptHost.append(el('p', 'geld-status geld-account__error', [localError]));
      return;
    }

    const avatar = el('img', 'geld-account__avatar');
    avatar.src = account.avatarUrl;
    avatar.alt = '';
    avatar.width = 20;
    avatar.height = 20;
    const status =
      account.auth === 'oauth'
        ? RECONNECT_COPY.title
        : sync.remoteInvalid !== null
        ? 'Sync paused: settings on GitHub are corrupted'
        : sync.lastError !== null
          ? `Sync error: ${sync.lastError}`
          : sync.pendingChoice !== null
            ? 'Waiting for your choice'
            : sync.lastSyncedAt !== null
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

    if (account.auth === 'oauth') {
      // Not dismissable on purpose: the old token keeps working, but only the
      // App can be refreshed and used beyond the gist. Sign-in replaces it.
      const alert = el('div', 'geld-alert geld-alert--notice', [
        el('p', 'geld-alert__title', [RECONNECT_COPY.title]),
        el('p', 'geld-alert__text', [RECONNECT_COPY.body]),
        el('div', 'geld-alert__actions', [
          button([svg(GITHUB_MARK), RECONNECT_COPY.action], 'geld-button--small geld-button--primary', () => {
            dialogWanted = true;
            void act('sign-in');
          }),
        ]),
      ]);
      alert.setAttribute('role', 'status');
      promptHost.append(alert);
    }

    const invalid = sync.remoteInvalid;
    if (invalid !== null) {
      const openGist = el('a', 'geld-button geld-button--small geld-button--primary', [CORRUPTED_SETTINGS_COPY.openGist]);
      openGist.href = invalid.gistUrl;
      openGist.target = '_blank';
      openGist.rel = 'noreferrer';
      const alert = el('div', 'geld-alert geld-alert--error', [
        el('p', 'geld-alert__title', [CORRUPTED_SETTINGS_COPY.title]),
        el('p', 'geld-alert__text', [CORRUPTED_SETTINGS_COPY.body]),
      ]);
      alert.setAttribute('role', 'alert');
      if (invalid.issues.length > 0) {
        alert.append(
          el(
            'ul',
            'geld-alert__list',
            // `$` means the whole file; a chip saying so would only puzzle people.
            invalid.issues.map((issue) => el('li', '', issue.path === '$' ? [issue.message] : [el('code', 'geld-alert__path', [issue.path]), ' ', issue.message])),
          ),
        );
      }
      alert.append(
        el('div', 'geld-alert__actions', [
          openGist,
          button([CORRUPTED_SETTINGS_COPY.reset], 'geld-button--small', () => void act('reset-remote')),
          button([CORRUPTED_SETTINGS_COPY.recheck], 'geld-button--small geld-button--link', () => void act('sync-now')),
        ]),
      );
      promptHost.append(alert);
    }

    const choice = sync.pendingChoice;
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

  /* ---- Sign-in dialog -------------------------------------------------- */
  let dialog: HTMLDialogElement | null = null;
  let dialogWanted = false;
  let lastFlowStatus: AuthFlowState['status'] = 'idle';

  function ensureDialog(): HTMLDialogElement {
    if (dialog !== null && dialog.isConnected) return dialog;
    dialog = el('dialog', `geld-dialog geld-dialog--${options.variant}`);
    dialog.setAttribute('aria-labelledby', 'geld-signin-title');
    dialog.addEventListener('close', () => {
      dialogWanted = false;
    });
    document.body.append(dialog);
    return dialog;
  }

  function openDialog(): void {
    dialogWanted = true;
    renderDialog();
  }

  function renderDialog(): void {
    // Auto-open when a sign-in starts or fails; auto-close once signed in.
    if (flow.status !== lastFlowStatus) {
      if (flow.status === 'pending' || flow.status === 'error') dialogWanted = true;
      lastFlowStatus = flow.status;
    }
    // An OAuth App account is signed in *and* mid-reconnect; keep its dialog open.
    if (account !== null && account.auth !== 'oauth') dialogWanted = false;
    const node = ensureDialog();
    if (!dialogWanted || (flow.status !== 'pending' && flow.status !== 'error')) {
      if (node.open) node.close();
      return;
    }

    const title = el('h2', 'geld-dialog__title', ['Sign in with GitHub']);
    title.id = 'geld-signin-title';
    const children: Node[] = [el('div', 'geld-dialog__brand', [svg(GITHUB_MARK), title])];

    if (flow.status === 'pending') {
      const code = el('code', 'geld-dialog__code', [flow.userCode]);
      const copy = button(['Copy'], 'geld-button--small', () => {
        void navigator.clipboard?.writeText(flow.status === 'pending' ? flow.userCode : '').then(() => {
          copy.textContent = 'Copied';
          setTimeout(() => (copy.textContent = 'Copy'), 1200);
        });
      });
      const open = el('a', 'geld-button geld-button--primary geld-dialog__open', ['Open GitHub']);
      open.href = flow.verificationUri;
      open.target = '_blank';
      open.rel = 'noreferrer';
      const minutesLeft = Math.max(1, Math.round((flow.expiresAt - Date.now()) / 60000));
      children.push(
        el('p', 'geld-dialog__text', ['Enter this one-time code on GitHub to connect your account. Geld keeps your settings in a secret gist on it; nothing else is read or written until you use a feature that needs it.']),
        el('div', 'geld-dialog__code-row', [code, copy]),
        el('div', 'geld-dialog__actions', [open, button(['Cancel'], 'geld-button--link', () => void act('cancel-sign-in'))]),
        el('p', 'geld-dialog__note', [`Waiting for GitHub… this closes by itself once you approve. The code is valid for about ${minutesLeft} min.`]),
      );
    } else if (flow.status === 'error') {
      children.push(
        el('p', 'geld-dialog__text geld-dialog__text--error', [flow.message]),
        el('div', 'geld-dialog__actions', [
          button(['Try again'], 'geld-button--primary', () => void act('sign-in')),
          button(['Close'], 'geld-button--link', () => {
            dialogWanted = false;
            void authFlowItem.setValue({ status: 'idle' });
          }),
        ]),
      );
    }
    node.replaceChildren(...children);
    if (!node.open) node.showModal();
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
      sync = { ...EMPTY_SYNC_STATE, ...value };
      render();
    }),
  ];
  void Promise.all([accountItem.getValue(), authFlowItem.getValue(), syncStateItem.getValue()]).then(([a, f, s]) => {
    account = a;
    flow = f;
    // State saved by an older version may lack newer fields.
    sync = { ...EMPTY_SYNC_STATE, ...s };
    render();
    // Pick up changes made on other devices whenever the UI opens (this also
    // re-validates a corrupted gist the user may have fixed meanwhile).
    if (a !== null && sync.pendingChoice === null) void send('sync-now');
  });

  return () => unwatchers.forEach((unwatch) => unwatch());
}
