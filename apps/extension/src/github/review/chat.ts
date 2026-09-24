/**
 * Chat view: an opened conversation as one chat. A review thread's real
 * timeline node is moved into the panel (teleport.ts) and read as messages:
 * the signed-in user's on the right, everyone else's on the left, each with
 * avatar and name, consecutive messages from one author grouped as chat apps
 * group them. Every bubble is the whole comment as GitHub rendered it, with
 * its reactions, its ⋯ menu and its edit form, and the thread's own reply
 * control is the composer at the bottom. Nothing is cloned or rewritten: the
 * layout is attributes on GitHub's nodes (`data-geld-part`, `data-geld-mine`,
 * `data-geld-run`), removed when the nodes go home, and the stylesheet.
 *
 * A top-level comment (a bot's run summary, a person's review body or
 * remark) opens the same way as a one-bubble chat, so everything in the
 * panel opens into the same shape.
 */

import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { authorOf, avatarSrcForLogin } from './crawler';
import { fitPathInto } from './path-fit';
import { ICON_CHECK_CIRCLE_FILL, ICON_CHEVRON_DOWN, ICON_CHEVRON_RIGHT, ICON_CIRCLE, ICON_COPY, ICON_LINK_EXTERNAL, ICON_PIN } from '../ui/icons';
import { ATTR_WHO } from './hovercard';
import { onRestore, teleportInto } from './teleport';

/** On a message: `meta` (author line), `bubble` (the body), `edit` (GitHub's edit form), `reactions`. */
export const ATTR_PART = 'data-geld-part';
const ATTR_MESSAGE = 'data-geld-message';
const ATTR_MINE = 'data-geld-mine';
/** Where a message stands in a run of one author's messages: `only`, `first`, `mid`, `last`. */
const ATTR_RUN = 'data-geld-run';
/** A message standing alone under a line that already names its author (pinned context, a one-bubble chat). */
const ATTR_LONE = 'data-geld-lone';

const BODY_SELECTOR = '.comment-body, .js-comment-body, [data-testid="comment-body"], .markdown-body';
const MESSAGE_SELECTOR = '.timeline-comment, .js-comment, .review-comment, .react-issue-comment, [data-testid="comment-container"], [data-testid="review-thread-comment"], [id^="discussion_r"]';
const META_SELECTOR = '.timeline-comment-header, .timeline-comment-actions, [data-testid="comment-header"], h3, a.author, a[data-testid="author-link"]';
const REACTIONS_SELECTOR = '.comment-reactions, .js-reactions-container, [data-testid="reactions"], [data-testid="comment-reactions"]';
/** The signed-in login, from GitHub's own meta tag (empty when signed out: then nothing is "mine"). */
export function viewerLogin(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content.trim() ?? '';
}

/** The comment (or bot run summary) a thread came from, for the pinned strip at the top of its chat. */
export interface ChatSource {
  /** The comment on the page, moved into the chat when the strip is open. */
  readonly node: HTMLElement;
  readonly anchor: string;
  /** "CodeRabbit's run summary", "chitalian's review". */
  readonly label: string;
  /** Its first line, for the collapsed strip. */
  readonly preview: string;
  readonly avatarSrc: string | null;
  readonly login: string;
  readonly bot: boolean;
}

export interface ChatHandlers {
  readonly pathOf: (thread: HTMLElement) => string;
  readonly onCopy: (text: string) => void;
  /** The comment this thread was posted from, when the page has one. */
  readonly sourceOf: (thread: HTMLElement) => ChatSource | null;
  /** Whether that comment is unfolded at the top of the chat. */
  readonly sourceOpen: (thread: HTMLElement) => boolean;
  readonly onToggleSource: (thread: HTMLElement) => void;
}

/** Focus key of a chat's pinned-context toggle, so a rebuild returns focus to it. */
export function sourceFocusKey(thread: HTMLElement): string {
  return `source:${threadAnchorOf(thread)}`;
}

/** The thread's first comment anchor (its identity across rebuilds). */
export function threadAnchorOf(thread: HTMLElement): string {
  return thread.querySelector('[id^="discussion_r"], [id^="issuecomment-"]')?.id ?? thread.id;
}

function icon(markup: string): SVGElement {
  return svgFromString(markup);
}

/**
 * An item's review threads, one chat each: the file path (fitted, with a
 * copy button and GitHub's link to the diff), the comment the thread came
 * from as a pinned strip, then the thread itself as bubbles with its reply
 * control at the bottom.
 */
export function renderChatView(slot: HTMLElement, threads: readonly HTMLElement[], handlers: ChatHandlers): void {
  const list = createElement('div', { class: 'geld-review__chats' });
  slot.replaceChildren(list);
  const viewer = viewerLogin();
  const pathEls: [HTMLElement, string][] = [];
  for (const thread of threads) {
    const chat = createElement('section', { class: 'geld-review__chat', 'data-geld-chat': 'thread', 'aria-label': 'Conversation' });
    const path = handlers.pathOf(thread);
    if (path !== '') {
      const actions = createElement('span', { class: 'geld-review__chat-head-actions' });
      const copy = createElement('button', { type: 'button', class: 'geld-review__icon geld-review__chat-copy', 'aria-label': 'Copy path', title: 'Copy path' }, [icon(ICON_COPY)]);
      copy.addEventListener('click', () => handlers.onCopy(path));
      actions.append(copy);
      // GitHub's own file link goes to the diff in Files changed; the path text here stays text.
      const fileHref = thread.querySelector<HTMLAnchorElement>('.file-header a[href], review-thread-collapsible a[href*="/files"], a[href*="/files#diff-"], a[href*="/files/"][href*="#diff"]')?.getAttribute('href') ?? null;
      if (fileHref !== null) actions.append(createElement('a', { class: 'geld-review__icon geld-review__chat-open', href: fileHref, 'aria-label': 'Open in Files changed', title: 'Open in Files changed' }, [icon(ICON_LINK_EXTERNAL)]));
      const pathEl = createElement('code', { class: 'geld-review__chat-path' });
      chat.append(createElement('div', { class: 'geld-review__chat-head' }, [pathEl, actions]));
      pathEls.push([pathEl, path]);
    }
    const source = handlers.sourceOf(thread);
    if (source !== null) chat.append(pinnedContext(thread, source, handlers, viewer));
    const body = createElement('div', { class: 'geld-review__chat-body' });
    chat.append(body);
    teleportInto(body, [thread]);
    liftCollapsedBody(thread);
    loadDeferredReplies(thread);
    const messages = messagesIn(thread, true);
    annotateMessages(messages, viewer, false);
    for (const message of messages) hoistMenu(message);
    dressComposer(thread);
    list.append(chat);
  }
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  // Fitted once the chats have their width: file name whole, the start first, "…" for what does not fit.
  for (const [element, path] of pathEls) fitPathInto(element, path);
}

/** Who posted a top-level comment and when, as the crawl read it, for the byline over its bubble. */
export interface ChatByline {
  readonly login: string;
  readonly bot: boolean;
  readonly avatarSrc: string | null;
  readonly time: string;
}

/** A thread a review came with, for the line under the review's bubble that leads to it. */
export interface ChatThreadLink {
  readonly anchor: string;
  readonly path: string;
  /** The line the thread is on, when known: several threads on one file tell apart by it. */
  readonly line?: number;
  /** The thread's first words, shown when several threads share a file and no line tells them apart. */
  readonly preview: string;
  readonly done: boolean;
}

/**
 * A top-level comment (a bot's run summary, a review body, a person's
 * remark) as a chat of one message: a byline with the author's picture, name
 * and time, the whole comment as a bubble under it, its reactions under
 * that. No path, no pinned context and no composer, since GitHub offers no
 * reply on a top-level comment other than the page's own form. A review that
 * came with threads gets a line under the bubble naming each thread's file,
 * leading to the thread where it opens (the threads are rows of their own).
 * The comment's own header stays hidden: its ⋯ is worn by the row above.
 */
export function renderCommentChat(slot: HTMLElement, node: HTMLElement, byline: ChatByline | null = null, threads: readonly ChatThreadLink[] = [], onOpenThread: ((anchor: string) => void) | null = null): void {
  const chat = createElement('section', { class: 'geld-review__chat', 'data-geld-chat': 'comment', 'aria-label': 'Comment' });
  if (byline !== null) {
    const who = byline.login === '' ? {} : byline.bot && /\[bot\]$/i.test(byline.login) ? { [ATTR_WHO]: byline.login } : { 'data-hovercard-type': 'user', 'data-hovercard-url': `/users/${encodeURIComponent(byline.login)}/hovercard` };
    const line = createElement('div', { class: 'geld-review__chat-byline' });
    if (byline.avatarSrc !== null) line.append(createElement('img', { class: 'geld-review__avatar', 'data-kind': byline.bot ? 'bot' : 'user', src: byline.avatarSrc, alt: '', width: '24', height: '24', ...who }));
    line.append(createElement('span', { class: 'geld-review__chat-byline-name', ...who }, [byline.bot ? byline.login.replace(/\[bot\]$/i, '') : byline.login]));
    if (byline.time !== '') line.append(createElement('span', { class: 'geld-review__time' }, [byline.time]));
    chat.append(line);
  }
  const body = createElement('div', { class: 'geld-review__chat-body' });
  chat.append(body);
  if (threads.length > 0 && onOpenThread !== null) {
    const list = createElement('div', { class: 'geld-review__chat-threads', role: 'list', 'aria-label': `${threads.length} thread${threads.length === 1 ? '' : 's'} from this review` });
    list.append(createElement('span', { class: 'geld-review__chat-threads-label' }, [threads.length === 1 ? '1 thread' : `${threads.length} threads`]));
    const fileOf = (thread: ChatThreadLink): string => thread.path.split('/').pop() ?? thread.path;
    for (const thread of threads) {
      const file = fileOf(thread);
      const shared = thread.line === undefined && threads.some((other) => other !== thread && other.line === undefined && fileOf(other) === file);
      const chip = createElement('button', { type: 'button', class: 'geld-review__chat-thread', role: 'listitem', 'data-state': thread.done ? 'done' : 'open', title: thread.line === undefined ? thread.path : `${thread.path}:${thread.line}` }, [
        icon(thread.done ? ICON_CHECK_CIRCLE_FILL : ICON_CIRCLE),
        createElement('code', {}, [thread.line === undefined ? file : `${file}:${thread.line}`]),
        ...(shared && thread.preview !== '' ? [createElement('span', { class: 'geld-review__chat-thread-words' }, [thread.preview])] : []),
        icon(ICON_CHEVRON_RIGHT),
      ]);
      chip.addEventListener('click', () => onOpenThread(thread.anchor));
      list.append(chip);
    }
    chat.append(list);
  }
  slot.replaceChildren(createElement('div', { class: 'geld-review__chats' }, [chat]));
  teleportInto(body, [node]);
  if (body.childElementCount === 0) {
    body.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
    return;
  }
  openMinimized(body);
  annotateMessages(messagesIn(node, false), viewerLogin(), true);
}

/**
 * The strip at the top of a thread's chat naming the comment it came from:
 * its author's picture, "CodeRabbit's run summary", the first line. Open,
 * that comment stands under the strip as one bubble, moved here like the
 * thread (so it is in one place at a time: its own row is closed while this
 * one is open). The reader's choice is kept across rebuilds by the caller.
 */
function pinnedContext(thread: HTMLElement, source: ChatSource, handlers: ChatHandlers, viewer: string): HTMLElement {
  const open = handlers.sourceOpen(thread);
  const children: Node[] = [createElement('span', { class: 'geld-review__chat-pin-glyph', 'aria-hidden': 'true' }, [icon(ICON_PIN)])];
  if (source.avatarSrc !== null) children.push(createElement('img', { class: 'geld-review__avatar', 'data-kind': source.bot ? 'bot' : 'user', src: source.avatarSrc, alt: '', width: '20', height: '20' }));
  children.push(createElement('span', { class: 'geld-review__chat-pin-label' }, [source.label]));
  if (source.preview !== '' && !open) children.push(createElement('span', { class: 'geld-review__chat-pin-preview' }, [source.preview]));
  children.push(icon(ICON_CHEVRON_DOWN));
  const button = createElement('button', { type: 'button', class: 'geld-review__chat-pin', 'aria-expanded': String(open), 'aria-label': `${open ? 'Hide' : 'Show'} ${source.label}`, title: `${open ? 'Hide' : 'Show'} ${source.label}`, 'data-geld-focus': sourceFocusKey(thread) }, children);
  button.addEventListener('click', () => handlers.onToggleSource(thread));
  const wrap = createElement('div', { class: 'geld-review__chat-context', 'data-open': String(open) }, [button]);
  if (open) {
    const body = createElement('div', { class: 'geld-review__chat-context-body' });
    wrap.append(body);
    teleportInto(body, [source.node]);
    openMinimized(body);
    const messages = messagesIn(source.node, false);
    annotateMessages(messages, viewer, true);
    for (const message of messages) hoistMenu(message);
  }
  return wrap;
}

const REPLY_AREA = '.review-thread-reply, .js-inline-comment-form-container';
const RESOLVE_FORM = 'form.js-resolvable-timeline-thread-form, form[action*="/resolve"], form[action*="/unresolve"]';
/** On GitHub's own label and sentence while Geld's short forms stand in for them. */
const ATTR_SPOKEN_FOR = 'data-geld-spoken-for';

/**
 * The composer's right hand: GitHub's Resolve form, which it renders (for a
 * reader who may resolve) somewhere inside the reply area, wording it
 * "Resolve conversation" and, once resolved, "<name> marked this
 * conversation as resolved." Here it is moved to the end of the reply area
 * (a loan like any other, home on restore), so the field and the form share
 * one line collapsed and the form sits on the editor's action row open, and
 * it speaks the chat's way: the button says "Resolve" or "Unresolve", the
 * sentence is the resolver's picture and "marked resolved". GitHub's own
 * words stay in the node, hidden by an attribute, and it is GitHub's button
 * that is pressed.
 */
function dressComposer(thread: HTMLElement): void {
  const area = thread.querySelector<HTMLElement>('.review-thread-reply') ?? thread.querySelector<HTMLElement>(REPLY_AREA);
  const form = thread.querySelector<HTMLElement>(RESOLVE_FORM);
  if (area === null || form === null || form.closest('.geld-review__composer-side') !== null) return;
  const side = createElement('div', { class: 'geld-review__composer-side' });
  area.append(side);
  teleportInto(side, [form]);
  labelComposer(thread, form, side);
  onRestore(() => {
    // The form goes home through the loan; the side it stood in is Geld's.
    side.remove();
  });
}

/**
 * GitHub answered a Resolve by swapping the form in place (chat.ts moved the
 * old one into the side slot, and the new one took its position there, its
 * loan adopted by the watcher): the new form arrives in GitHub's words, and
 * nothing else rebuilds when only the form changed. Dress it where it is.
 */
export function redressComposer(form: HTMLElement): void {
  const side = form.closest<HTMLElement>('.geld-review__composer-side');
  const thread = form.closest<HTMLElement>('.js-resolvable-timeline-thread-container, [data-testid="review-thread"], .review-thread-component');
  if (side === null || thread === null) return;
  for (const stale of side.querySelectorAll('.geld-review__composer-resolved')) stale.remove();
  labelComposer(thread, form, side);
}

/** The chat's words on GitHub's form: Resolve or Unresolve on the button, the resolver's picture and "marked resolved" for the sentence. */
function labelComposer(thread: HTMLElement, form: HTMLElement, side: HTMLElement): void {
  const button = form.querySelector<HTMLElement>('button[type="submit"], button');
  if (button === null) return;
  // A form dressed on an earlier pass and not undressed (GitHub swapped the thread under it) is dressed afresh.
  for (const stale of form.querySelectorAll('.geld-review__composer-label')) stale.remove();
  for (const stale of form.querySelectorAll(`[${ATTR_SPOKEN_FOR}]`)) stale.removeAttribute(ATTR_SPOKEN_FOR);
  button.removeAttribute(ATTR_SPOKEN_FOR);
  const resolved = thread.getAttribute('data-resolved') === 'true' || /^unresolve/i.test((button.textContent ?? '').trim());
  const label = button.querySelector<HTMLElement>('.Button-label') ?? button;
  const spokenFor: Element[] = [];
  const speakFor = (element: Element): void => {
    element.setAttribute(ATTR_SPOKEN_FOR, '');
    spokenFor.push(element);
  };
  const added: Element[] = [];
  if (label === button) {
    // A bare button holds its words as text: they cannot be hidden alone, so the whole button is sized to the short label drawn over it.
    speakFor(button);
    const short = createElement('span', { class: 'geld-review__composer-label' }, [resolved ? 'Unresolve' : 'Resolve']);
    button.append(short);
    added.push(short);
  } else {
    speakFor(label);
    const short = createElement('span', { class: 'geld-review__composer-label' }, [resolved ? 'Unresolve' : 'Resolve']);
    label.after(short);
    added.push(short);
  }
  const hadTitle = button.getAttribute('title');
  button.setAttribute('title', resolved ? 'Unresolve conversation' : 'Resolve conversation');
  // "<name> marked this conversation as resolved.": the name is the one element in it, the rest is text.
  const name = [...form.querySelectorAll<HTMLElement>('strong, a.author, a[data-hovercard-type="user"]')].find((node) => !button.contains(node)) ?? null;
  if (name !== null) {
    const login = (name.textContent ?? '').replace(/^@/, '').trim();
    const sentence = name.parentElement !== null && name.parentElement !== form ? name.parentElement : name;
    speakFor(sentence);
    const avatar = avatarSrcForLogin(login);
    const who = createElement('span', { class: 'geld-review__composer-resolved', title: `${login} marked this conversation as resolved` });
    if (avatar !== null) who.append(createElement('img', { class: 'geld-review__avatar', 'data-kind': 'user', src: avatar, alt: login, width: '20', height: '20', 'data-hovercard-type': 'user', 'data-hovercard-url': `/users/${encodeURIComponent(login)}/hovercard` }));
    else who.append(createElement('span', { class: 'geld-review__composer-resolved-name' }, [login]));
    who.append(createElement('span', {}, ['marked resolved']));
    side.append(who);
    added.push(who);
  }
  onRestore(() => {
    for (const element of spokenFor) element.removeAttribute(ATTR_SPOKEN_FOR);
    for (const element of added) element.remove();
    if (hadTitle === null) button.removeAttribute('title');
    else button.setAttribute('title', hadTitle);
  });
}

/** The comment's own ⋯ menu, most specific first; the reaction trigger is a `details` too and must not be taken for it. */
const COMMENT_MENU = 'details.js-comment-header-actions-menu, .timeline-comment-actions details:not(.js-add-reaction):not(.js-reaction-popover-container), [data-testid="comment-header"] button[aria-label="Show options" i], button[aria-label="Comment actions" i]';

/**
 * The message strip on a bubble's top edge is GitHub's reactions row: the
 * pills always, the picker on hover. The comment's ⋯ lives in its author line,
 * a different part of the message, so it is moved into the row (a loan, home
 * on restore) between the picker and the pills: the strip is then one flex
 * row and the pills, farthest out, never move when the controls appear. A
 * menu already worn by a panel row (a single comment's line wears its own)
 * is left there: `teleportInto` skips a node on loan.
 */
function hoistMenu(message: HTMLElement): void {
  const meta = message.querySelector<HTMLElement>(`:scope > [${ATTR_PART}='meta']`);
  const reactions = message.querySelector<HTMLElement>(`[${ATTR_PART}='reactions']`);
  if (meta === null || reactions === null) return;
  const menu = meta.querySelector<HTMLElement>(COMMENT_MENU);
  if (menu === null || menu.closest('[data-geld-teleported]') === menu) return;
  const row = reactions.matches('.comment-reactions, .js-reactions-container') ? reactions : (reactions.querySelector<HTMLElement>('.comment-reactions, .js-reactions-container') ?? reactions);
  const slot = createElement('span', { class: 'geld-review__msg-actions', [OWN_UI_ATTRIBUTE]: '' });
  const picker = row.querySelector(':scope > reactions-menu, :scope > details.js-add-reaction');
  if (picker !== null) picker.after(slot);
  else row.prepend(slot);
  teleportInto(slot, [menu]);
  // Not moved (worn by a row already): no empty slot, which would still take the row's gap.
  if (slot.childElementCount === 0) {
    slot.remove();
    return;
  }
  onRestore(() => slot.remove());
}

/** A minimized comment opens here (the row is the reader's choice to look); GitHub's state comes back with the node. */
export function openMinimized(root: HTMLElement): void {
  // Only the minimizing <details> itself: a comment's ⋯ menu and reaction picker are <details> too.
  for (const details of root.querySelectorAll<HTMLDetailsElement>('.minimized-comment > details, details.minimized-comment')) {
    if (details.open) continue;
    details.open = true;
    onRestore(() => {
      details.open = false;
    });
  }
}

/** A resolved thread arrives collapsed (GitHub's own header plus a hidden body); the chat shows the body. */
function liftCollapsedBody(thread: HTMLElement): void {
  for (const hidden of thread.querySelectorAll<HTMLElement>('[data-target="review-thread-collapsible.body"][hidden], .js-resolvable-timeline-thread-container > [hidden]')) {
    hidden.removeAttribute('hidden');
    onRestore(() => hidden.setAttribute('hidden', ''));
  }
}

/**
 * GitHub loads a resolved thread's replies only when its own toggle runs, by
 * giving the placeholder inside the body its URL; showing the body directly
 * would leave that placeholder spinning forever.
 */
function loadDeferredReplies(thread: HTMLElement): void {
  const deferred = thread.getAttribute('data-deferred-content-url') ?? thread.querySelector('[data-deferred-content-url]')?.getAttribute('data-deferred-content-url') ?? null;
  if (deferred === null) return;
  for (const fragment of thread.querySelectorAll('include-fragment:not([src])')) {
    if (fragment.closest('.dropdown-menu, details-menu, action-menu, [popover]') !== null) continue;
    fragment.setAttribute('src', deferred);
    break;
  }
}

/**
 * The messages inside a moved node, outermost first: in a thread, each
 * `discussion_r` comment (its comments are siblings, but GitHub repeats ids
 * on wrappers and permalinks); elsewhere the comment cards. A message holds
 * a body and is not part of a form.
 */
function messagesIn(root: HTMLElement, thread: boolean): readonly HTMLElement[] {
  const selector = thread ? '[id^="discussion_r"], [data-testid="review-thread-comment"]' : MESSAGE_SELECTOR;
  const candidates = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll<HTMLElement>(selector)];
  const all = candidates.filter((node) => node.closest('form') === null && node.querySelector(BODY_SELECTOR) !== null);
  return all.filter((node) => !all.some((other) => other !== node && other.contains(node)));
}

/** The message's direct child holding `inner`, or null when `inner` is not inside it. */
function partHolding(message: HTMLElement, inner: Element | null): HTMLElement | null {
  let cursor: Element | null = inner;
  while (cursor !== null && cursor.parentElement !== message) cursor = cursor.parentElement;
  return cursor instanceof HTMLElement && cursor !== message ? cursor : null;
}

/**
 * Read each message as parts the stylesheet lays out (author line, bubble,
 * edit form, reactions), decide whose it is and where it stands in a run of
 * one author's messages. Marks only; every attribute goes when the node
 * goes home.
 */
function annotateMessages(messages: readonly HTMLElement[], viewer: string, pinned: boolean): void {
  const marked: [Element, string][] = [];
  const mark = (element: Element, name: string, value: string): void => {
    element.setAttribute(name, value);
    marked.push([element, name]);
  };
  const logins = messages.map((message) => (authorOf(message)?.login ?? '').toLowerCase());
  messages.forEach((message, index) => {
    mark(message, ATTR_MESSAGE, '');
    if (pinned) mark(message, ATTR_LONE, '');
    const login = logins[index] ?? '';
    if (!pinned && viewer !== '' && login === viewer.toLowerCase()) mark(message, ATTR_MINE, '');
    const before = !pinned && index > 0 && logins[index - 1] === login;
    const after = !pinned && index < messages.length - 1 && logins[index + 1] === login;
    mark(message, ATTR_RUN, before && after ? 'mid' : before ? 'last' : after ? 'first' : 'only');
    const bubble = partHolding(message, message.querySelector(BODY_SELECTOR));
    const reactionsRow = message.querySelector<HTMLElement>(REACTIONS_SELECTOR);
    const reactionsHolder = partHolding(message, reactionsRow);
    const meta = partHolding(message, message.querySelector(META_SELECTOR));
    if (meta !== null && meta !== bubble) mark(meta, ATTR_PART, 'meta');
    if (bubble !== null) mark(bubble, ATTR_PART, 'bubble');
    // Review comments keep their reactions in a wrapper of their own beside the body's; an issue comment nests
    // them inside the body's wrapper. The part is the row itself then, so it lays out and floats the same way.
    if (reactionsHolder !== null && reactionsHolder !== bubble && reactionsHolder !== meta) mark(reactionsHolder, ATTR_PART, 'reactions');
    else if (reactionsRow !== null && reactionsRow !== bubble && !reactionsRow.matches('[data-geld-part]')) mark(reactionsRow, ATTR_PART, 'reactions');
    for (const form of message.querySelectorAll<HTMLFormElement>(':scope > form.js-comment-update, :scope > form[data-testid="comment-edit-form"]')) mark(form, ATTR_PART, 'edit');
  });
  onRestore(() => {
    for (const [element, name] of marked) element.removeAttribute(name);
  });
}
