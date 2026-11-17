import { createElement, svgFromString } from '../github/dom';
import { ICON_GEAR, ICON_SPARKLE_FILL, ICON_SPINNER } from '../github/ui/icons';
import { NO_KEY_REASON } from '../lib/ai-key';
import './chat-fix.css';

/** Where a fix asked for from a chat stands: being written, then in the triage at the top of the digest. */
export type ChatFixState = 'idle' | 'running' | 'done' | 'failed';

export interface ChatFix {
  readonly state: ChatFixState;
  /** Its fix is being applied: asking afresh waits until that lands, or the two would record over each other. */
  readonly applying: boolean;
  /** Why the model gave no answer, said on the control: Fix asks again. */
  readonly error?: string;
  /** No API key on this device: the control leads to Geld's settings instead. */
  readonly needsKey?: boolean;
  readonly onFix: () => void;
  readonly onAddKey: () => void;
}

/** What a comment's Fix asks for: its own findings outside its threads, the threads it came with, or both. */
export type CommentFixScope = 'comment' | 'threads' | 'both';

export interface CommentFix {
  /** Its open threads a fix can be written for: Threads is offered only with one or more. */
  readonly threads: number;
  /** It reports findings outside its threads (or tasks were written from it): This comment is offered only then. */
  readonly comment: boolean;
  readonly state: ChatFixState;
  /** One of its threads' fixes is being applied: Threads and Both wait until that lands. */
  readonly applying: boolean;
  /** The choice being written or last written, so its button is the one that says so. */
  readonly scope: CommentFixScope | null;
  readonly error?: string;
  /** No API key on this device: the row says so with a way to Geld's settings. */
  readonly needsKey?: boolean;
  readonly onFix: (scope: CommentFixScope) => void;
  readonly onAddKey: () => void;
}

/** A host's class names for the Fix controls: GitHub's Rerun box and Primer buttons, a provider's own buttons. */
export interface ChatFixSkin {
  /** The thread chat's Fix, in Rerun's place on the head. */
  readonly thread: string;
  /** Each of a comment's choices. */
  readonly choice: string;
  /** Added to the primary choice. */
  readonly primary: string;
}

export const GITHUB_CHAT_FIX_SKIN: ChatFixSkin = { thread: 'geld-review__rerun', choice: 'btn btn-sm', primary: 'btn-primary' };

const FIX_WORDS: Readonly<Record<ChatFixState, string>> = {
  idle: 'Ask the AI triage for a fix. It appears in the triage at the top of the digest.',
  running: 'The AI triage is writing the fix.',
  done: 'The fix is in the triage at the top of the digest. Fix again to write it afresh.',
  failed: 'The model could not answer. Try again.',
};

/** A thread chat's Fix, in Rerun's box: the sparkle and the word, GitHub's spinner in the sparkle's place while it is written. */
export function threadFixControl(fix: ChatFix, skin: ChatFixSkin): HTMLElement {
  if (fix.state === 'failed' && fix.needsKey === true) {
    const add = createElement('button', { type: 'button', class: `${skin.thread} geld-review__chat-fix`, title: NO_KEY_REASON, 'data-state': 'needs-key' }, [svgFromString(ICON_GEAR), createElement('span', {}, ['Add API key'])]);
    add.addEventListener('click', () => fix.onAddKey());
    return add;
  }
  const running = fix.state === 'running';
  const words = fix.state === 'failed' && fix.error !== undefined ? `The model could not answer: ${fix.error} Fix asks again.` : FIX_WORDS[fix.state];
  const button = createElement('button', { type: 'button', class: `${skin.thread} geld-review__chat-fix`, title: fix.applying ? 'Its fix is being applied' : words, 'data-state': fix.state, ...(running ? { 'data-running': '', disabled: '', 'aria-busy': 'true' } : fix.applying ? { disabled: '' } : {}) }, [svgFromString(ICON_SPARKLE_FILL), svgFromString(ICON_SPINNER), createElement('span', {}, ['Fix'])]);
  button.addEventListener('click', () => fix.onFix());
  return button;
}

/** The choices a comment's Fix offers: This comment for what it reports outside its threads, Threads for its open threads, Both for both. */
export function commentFixScopes(fix: Pick<CommentFix, 'comment' | 'threads'>): readonly CommentFixScope[] {
  if (fix.comment && fix.threads > 0) return ['comment', 'threads', 'both'];
  return fix.comment ? ['comment'] : fix.threads > 0 ? ['threads'] : [];
}

/** A comment chat's Fix row: "Fix:", then This comment, Threads and Both (the primary) as buttons of their own. */
export function commentFixRow(fix: CommentFix, skin: ChatFixSkin): HTMLElement {
  const running = fix.state === 'running';
  const threads = fix.threads === 1 ? 'its thread' : `its ${fix.threads} threads`;
  const words: Readonly<Record<CommentFixScope, readonly [string, string]>> = {
    comment: ['This comment', 'What this comment reports outside its threads (findings outside the diff, failed checks), as tasks for an agent'],
    threads: ['Threads', `A fix for ${threads}, to apply as a suggestion`],
    both: ['Both', `What this comment reports outside its threads and a fix for ${threads}`],
  };
  const choices = commentFixScopes(fix).map((scope) => [scope, ...words[scope]] as const);
  const group = createElement('div', { class: 'geld-review__chat-fix-choices', role: 'group', 'aria-label': 'Fix' });
  for (const [scope, label, title] of choices) {
    const primary = scope === 'both' || choices.length === 1;
    const pressed = running && fix.scope === scope;
    const waits = fix.applying && scope !== 'comment';
    const button = createElement('button', { type: 'button', class: `${skin.choice}${primary ? ` ${skin.primary}` : ''}`, title: waits ? 'A fix for its threads is being applied' : title, ...(running || waits ? { disabled: '' } : {}), ...(pressed ? { 'aria-busy': 'true' } : {}) }, [pressed ? 'Fixing…' : label]);
    button.addEventListener('click', () => fix.onFix(scope));
    group.append(button);
  }
  const row = createElement('div', { class: 'geld-review__chat-fix-row', 'data-state': fix.state }, [createElement('span', { class: 'geld-review__chat-fix-label' }, ['Fix:']), group]);
  if (fix.state === 'failed' && fix.needsKey === true) {
    const add = createElement('button', { type: 'button', class: 'geld-review__chat-fix-link' }, ['Add an API key']);
    add.addEventListener('click', () => fix.onAddKey());
    row.append(createElement('span', { class: 'geld-review__chat-fix-note', 'data-tone': 'danger', role: 'alert' }, [NO_KEY_REASON, ' ', add]));
  } else if (fix.state === 'done' || fix.state === 'failed') row.append(createElement('span', { class: 'geld-review__chat-fix-note', role: 'status' }, [fix.state === 'done' ? 'In the triage at the top of the digest.' : fix.error === undefined ? FIX_WORDS.failed : `The model could not answer: ${fix.error}`]));
  return row;
}

