import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { ICON_X } from './ui/icons';

/**
 * Geld's copies of GitHub's block dialogs (its Overview's `BlockUserDialog` and `BlockUserFromOrgDialog`, read from its
 * bundles in Nov 2026): the same words, options and defaults, drawn with Primer's Overlay as Geld's other dialogs are.
 * The reader's choices are what the block request sends, so nothing is blocked with settings the reader did not see.
 */

export type BlockScope = 'personal' | 'org';

export type BlockDuration = 'ONE_DAY' | 'THREE_DAYS' | 'SEVEN_DAYS' | 'THIRTY_DAYS' | 'INDEFINITE';

/** The organisation dialog's durations, in its order, with the value its request sends. */
export const BLOCK_DURATIONS: { readonly [D in BlockDuration]: { readonly label: string; readonly value: string } } = {
  ONE_DAY: { label: 'For 1 day', value: '1' },
  THREE_DAYS: { label: 'For 3 days', value: '3' },
  SEVEN_DAYS: { label: 'For 7 days', value: '7' },
  THIRTY_DAYS: { label: 'For 30 days', value: '30' },
  INDEFINITE: { label: 'Until I unblock them', value: '0' },
};

const DURATION_ORDER: readonly BlockDuration[] = ['ONE_DAY', 'THREE_DAYS', 'SEVEN_DAYS', 'THIRTY_DAYS', 'INDEFINITE'];

/** The reasons a hidden comment shows, as GitHub's dialog words them. */
export const HIDE_REASONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'ABUSE', label: 'Abuse' },
  { value: 'OFF_TOPIC', label: 'Off-topic' },
  { value: 'OUTDATED', label: 'Outdated' },
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'LOW_QUALITY', label: 'Low quality' },
];

export interface BlockChoices {
  /** Organisation only. */
  readonly duration: BlockDuration;
  /** At most 250 characters; empty sends none. */
  readonly note: string;
  readonly closeContent: boolean;
  /** Organisation only: a notification and a public timeline entry. */
  readonly notify: boolean;
  /** Organisation only: hide all of their comments with this reason, or null to leave them shown. */
  readonly hideReason: string | null;
}

/** GitHub's defaults: until unblocked, no note, nothing closed, notified, comments left shown. */
export const DEFAULT_BLOCK_CHOICES: BlockChoices = { duration: 'INDEFINITE', note: '', closeContent: false, notify: true, hideReason: null };

const NOTE_LIMIT = 250;

export interface BlockDialogOptions {
  readonly scope: BlockScope;
  readonly login: string;
  readonly org: string;
  /** The pull request the block is about, which the organisation's notice to them links as "this content". */
  readonly contentUrl: string;
  /** Sends the block; answers an error to show, or null once done (the page then reloads). */
  readonly onBlock: (choices: BlockChoices) => Promise<string | null>;
  /** Where focus goes when the dialog closes without blocking. */
  readonly returnFocus: HTMLElement | null;
}

let dialogIds = 0;

function link(href: string, words: string): HTMLElement {
  return createElement('a', { href, target: '_blank', rel: 'noopener noreferrer' }, [words]);
}

function checkbox(id: string, label: string, caption: (string | Node)[], checked: boolean): { readonly row: HTMLElement; readonly input: HTMLInputElement } {
  const input = createElement('input', { type: 'checkbox', id });
  input.checked = checked;
  const row = createElement('div', { class: 'form-checkbox geld-block-dialog__check' }, [
    createElement('label', { for: id }, [input, label]),
    createElement('p', { class: 'note' }, caption),
  ]);
  return { row, input };
}

function frame(titleText: string, body: HTMLElement[], footer: HTMLElement[]): { readonly dialog: HTMLDialogElement; readonly close: HTMLButtonElement } {
  dialogIds += 1;
  const titleId = `geld-block-dialog-${dialogIds}-title`;
  const dialog = createElement('dialog', { class: 'Overlay Overlay-whenNarrow Overlay--motion-scaleFade geld-block-dialog', [OWN_UI_ATTRIBUTE]: '', 'aria-labelledby': titleId });
  const close = createElement('button', { type: 'button', class: 'close-button Overlay-closeButton', 'aria-label': 'Close' }, [svgFromString(ICON_X)]);
  dialog.append(
    createElement('div', { class: 'Overlay-header Overlay-header--divided' }, [
      createElement('div', { class: 'Overlay-headerContentWrap' }, [createElement('div', { class: 'Overlay-titleWrap' }, [createElement('h1', { class: 'Overlay-title', id: titleId }, [titleText])]), createElement('div', { class: 'Overlay-actionWrap' }, [close])]),
    ]),
    createElement('div', { class: 'Overlay-body geld-block-dialog__body' }, body),
    createElement('div', { class: 'Overlay-footer Overlay-footer--alignEnd Overlay-footer--divided' }, footer),
  );
  return { dialog, close };
}

function show(dialog: HTMLDialogElement, close: HTMLButtonElement, returnFocus: HTMLElement | null, busy: () => boolean): () => void {
  const dismiss = (): void => {
    if (busy()) return;
    if (dialog.open) dialog.close();
  };
  close.addEventListener('click', dismiss);
  // A click on the backdrop lands on the dialog element itself, outside its children.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('cancel', (event) => {
    if (busy()) event.preventDefault();
  });
  // GitHub's page stops Escape's keydown on its way down through the document, so neither the dialog's own cancel nor a
  // listener on it ever hears it: the window hears it first, while the dialog is open.
  const keys = new AbortController();
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    },
    { capture: true, signal: keys.signal },
  );
  dialog.addEventListener('close', () => {
    keys.abort();
    dialog.remove();
    returnFocus?.focus({ preventScroll: true });
  });
  document.body.append(dialog);
  dialog.showModal();
  return dismiss;
}

/** GitHub's block dialog for `options.scope`, with its options; blocking sends the reader's choices. */
export function openBlockDialog(options: BlockDialogOptions): HTMLDialogElement {
  const { scope, login, org } = options;
  const id = `geld-block-${dialogIds + 1}`;
  const note = createElement('textarea', { id: `${id}-note`, class: 'form-control geld-block-dialog__note', rows: '3', maxlength: String(NOTE_LIMIT), name: 'note' });
  const close = checkbox(
    `${id}-close`,
    'Close all open issues, pull requests, and discussions opened by this user',
    [scope === 'personal' ? 'Content in all repositories owned by your account will be closed.' : 'Content in repositories owned by this organization where you have write access will be closed.'],
    DEFAULT_BLOCK_CHOICES.closeContent,
  );
  const error = createElement('p', { class: 'geld-block-dialog__error', role: 'alert', hidden: '' });
  const submit = createElement('button', { type: 'button', class: 'btn btn-danger' }, [scope === 'personal' ? 'Block user' : 'Block user from organization']);
  const body: HTMLElement[] = [];
  let duration: HTMLSelectElement | null = null;
  let notify: HTMLInputElement | null = null;
  let hide: HTMLInputElement | null = null;
  let reason: HTMLSelectElement | null = null;

  if (scope === 'personal') {
    body.push(
      createElement('p', { class: 'geld-block-dialog__text' }, [
        'Blocking ',
        createElement('strong', {}, [`@${login}`]),
        ' prevents them from interacting with your repositories, such as opening or commenting on pull requests or issues, starring, forking, or watching. Learn more about ',
        link('https://docs.github.com/articles/blocking-a-user-from-your-personal-account/', 'blocking a user'),
        '.',
      ]),
      close.row,
    );
  } else {
    duration = createElement(
      'select',
      { id: `${id}-duration`, class: 'form-select' },
      DURATION_ORDER.map((key) => createElement('option', { value: key }, [BLOCK_DURATIONS[key].label])),
    );
    duration.value = DEFAULT_BLOCK_CHOICES.duration;
    const notifyBox = checkbox(
      `${id}-notify`,
      'Send user a notification and show activity in timeline',
      [
        `You can notify `,
        createElement('strong', {}, [login]),
        ` as to why they're being blocked. A public timeline entry will show that this user was blocked. They will receive an email notification and a notice when they try to comment with the following message:`,
        createElement('blockquote', { class: 'geld-block-dialog__quote' }, [
          `A maintainer of the @${org} organization has blocked you because of `,
          link(options.contentUrl, 'this content'),
          '. For more information please see ',
          link('https://docs.github.com/site-policy/github-terms/github-community-guidelines', 'the community guidelines'),
          '.',
        ]),
      ],
      DEFAULT_BLOCK_CHOICES.notify,
    );
    const hideBox = checkbox(
      `${id}-hide`,
      "Hide this user's comments",
      ['All of their comments in this organization ', link('https://docs.github.com/communities/moderating-comments-and-conversations/managing-disruptive-comments#hiding-a-comment', 'will be hidden'), ' to all users and will display a reason.'],
      DEFAULT_BLOCK_CHOICES.hideReason !== null,
    );
    reason = createElement('select', { id: `${id}-reason`, class: 'form-select geld-block-dialog__reason', 'aria-label': 'Reason for hiding their comments', disabled: '' }, [
      createElement('option', { value: '' }, ['Choose a reason']),
      ...HIDE_REASONS.map((entry) => createElement('option', { value: entry.value }, [entry.label])),
    ]);
    notify = notifyBox.input;
    hide = hideBox.input;
    body.push(
      createElement('p', { class: 'geld-block-dialog__text' }, [
        'Blocking a user prevents them from interacting with repositories of this organization, such as opening or commenting on pull requests or issues. Learn more about ',
        link('https://docs.github.com/communities/maintaining-your-safety-on-github/blocking-a-user-from-your-organization', 'blocking a user'),
        '.',
      ]),
      createElement('div', { class: 'form-group geld-block-dialog__field' }, [createElement('label', { for: duration.id, class: 'geld-block-dialog__label' }, ['Block a user']), duration]),
    );
    body.push(noteField(note, 'All org admins and moderators can see this note.'));
    body.push(createElement('h4', { class: 'geld-block-dialog__heading' }, ['More options']), close.row, notifyBox.row, hideBox.row, reason);
  }
  if (scope === 'personal') body.push(noteField(note, 'This note will only be visible to you.'));
  body.push(error);

  const ready = (): boolean => hide === null || !hide.checked || (reason !== null && reason.value !== '');
  const sync = (): void => {
    if (reason !== null && hide !== null) reason.disabled = !hide.checked;
    submit.disabled = !ready();
  };
  hide?.addEventListener('change', sync);
  reason?.addEventListener('change', sync);

  const { dialog, close: closeButton } = frame(scope === 'personal' ? `Block @${login}` : `Block ${login} from ${org}`, body, [submit]);
  let sending = false;
  show(dialog, closeButton, options.returnFocus, () => sending);
  submit.addEventListener('click', () => {
    if (sending || !ready()) return;
    const choices: BlockChoices = {
      duration: duration === null ? DEFAULT_BLOCK_CHOICES.duration : durationOf(duration.value),
      note: note.value.slice(0, NOTE_LIMIT),
      closeContent: close.input.checked,
      notify: notify?.checked ?? false,
      hideReason: hide?.checked === true && reason !== null && reason.value !== '' ? reason.value : null,
    };
    sending = true;
    submit.disabled = true;
    submit.textContent = 'Blocking user…';
    error.hidden = true;
    void options.onBlock(choices).then((failure) => {
      if (failure === null) return;
      sending = false;
      submit.textContent = scope === 'personal' ? 'Block user' : 'Block user from organization';
      sync();
      error.textContent = failure;
      error.hidden = false;
    });
  });
  sync();
  (duration ?? close.input).focus({ preventScroll: true });
  return dialog;
}

function noteField(note: HTMLTextAreaElement, visibility: string): HTMLElement {
  const left = (): string => `${NOTE_LIMIT - note.value.length} characters remaining`;
  const counter = createElement('p', { class: 'note geld-block-dialog__counter', 'aria-live': 'polite' }, [left()]);
  note.addEventListener('input', () => {
    counter.textContent = left();
  });
  return createElement('div', { class: 'form-group geld-block-dialog__field' }, [
    createElement('label', { for: note.id, class: 'geld-block-dialog__label' }, ['Add an optional note']),
    note,
    counter,
    createElement('p', { class: 'note' }, [`Maximum ${NOTE_LIMIT} characters. Please don't include any personal information such as legal names or email addresses. Markdown is supported. ${visibility}`]),
  ]);
}

function durationOf(value: string): BlockDuration {
  return DURATION_ORDER.find((key) => key === value) ?? DEFAULT_BLOCK_CHOICES.duration;
}

export interface UnblockDialogOptions {
  readonly scope: BlockScope;
  readonly login: string;
  readonly org: string;
  readonly onUnblock: () => Promise<string | null>;
  readonly returnFocus: HTMLElement | null;
}

/** GitHub's unblock confirmation, in its words. */
export function openUnblockDialog(options: UnblockDialogOptions): HTMLDialogElement {
  const { scope, login, org } = options;
  const error = createElement('p', { class: 'geld-block-dialog__error', role: 'alert', hidden: '' });
  const cancel = createElement('button', { type: 'button', class: 'btn' }, ['Cancel']);
  const submit = createElement('button', { type: 'button', class: 'btn btn-danger' }, ['Unblock user']);
  const words: (string | Node)[] = scope === 'personal' ? ['Are you sure you want to unblock ', createElement('strong', {}, [`@${login}`]), '?'] : ['Are you sure you want to unblock ', createElement('strong', {}, [login]), ' from ', createElement('strong', {}, [org]), '?'];
  const { dialog, close } = frame(scope === 'personal' ? `Unblock @${login}` : `Unblock ${login} from ${org}`, [createElement('p', { class: 'geld-block-dialog__text' }, words), error], [cancel, submit]);
  let sending = false;
  const dismiss = show(dialog, close, options.returnFocus, () => sending);
  cancel.addEventListener('click', dismiss);
  submit.addEventListener('click', () => {
    if (sending) return;
    sending = true;
    submit.disabled = true;
    cancel.disabled = true;
    error.hidden = true;
    void options.onUnblock().then((failure) => {
      if (failure === null) return;
      sending = false;
      submit.disabled = false;
      cancel.disabled = false;
      error.textContent = failure;
      error.hidden = false;
    });
  });
  cancel.focus({ preventScroll: true });
  return dialog;
}
