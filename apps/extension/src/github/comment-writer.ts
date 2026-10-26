/**
 * GitHub's own comment writer (the conversation's "Add a comment" box:
 * Write and Preview, the Markdown toolbar, mentions, references, saved
 * replies and file uploads), for Geld's comment box on any tab. It is
 * server-rendered into the conversation page with the preview and upload
 * tokens it needs, and GitHub's behaviours drive it wherever it stands on
 * the site (verified Oct 2026 on the Files changed tab: the toolbar, the
 * preview request and its rendering). On the conversation the page's own
 * box is copied; elsewhere the conversation's HTML is fetched once per pull
 * request, on intent. A copy is re-id'd, since the toolbar, its hotkeys and
 * tooltips find their textarea and buttons by id and would otherwise reach
 * the page's own box.
 */

export interface CommentWriter {
  readonly element: HTMLElement;
  readonly field: HTMLTextAreaElement;
}

const WRITER = 'form#new_comment_form .js-previewable-comment-form';

/** Attributes that name another element by id. */
const ID_REFS = ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'data-hotkey-scope', 'popovertarget', 'list'];

const templates = new Map<string, Promise<Element | null>>();
const fetched = new Map<string, Element>();
let copies = 0;

async function fetchTemplate(pullPath: string): Promise<Element | null> {
  try {
    const response = await fetch(pullPath, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    if (!response.ok) return null;
    return new DOMParser().parseFromString(await response.text(), 'text/html').querySelector(WRITER);
  } catch {
    return null;
  }
}

function liveTemplate(pullPath: string): Element | null {
  return window.location.pathname.replace(/\/$/, '') === pullPath ? document.querySelector(WRITER) : null;
}

/** The page's own writer when it is this pull request's conversation, else a fetch of it (once, kept for the page's life). */
function templateFor(pullPath: string): Promise<Element | null> {
  const live = liveTemplate(pullPath);
  if (live !== null) return Promise.resolve(live);
  let pending = templates.get(pullPath);
  if (pending === undefined) {
    pending = fetchTemplate(pullPath);
    templates.set(pullPath, pending);
    void pending.then((template) => {
      if (template === null) templates.delete(pullPath);
      else fetched.set(pullPath, template);
    });
  }
  return pending;
}

/** Start reading the writer for `pullPath` (the reader is heading for the box). */
export function prefetchWriter(pullPath: string): void {
  void templateFor(pullPath);
}

function reid(root: Element): void {
  copies += 1;
  const renamed = new Map<string, string>();
  for (const element of [root, ...root.querySelectorAll('[id]')]) {
    if (element.id === '') continue;
    const next = `${element.id}-geld-${copies}`;
    renamed.set(element.id, next);
    element.id = next;
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const name of ID_REFS) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      const mapped = value
        .split(/\s+/)
        .map((token) => renamed.get(token) ?? token)
        .join(' ');
      if (mapped !== value) element.setAttribute(name, mapped);
    }
  }
}

const FOOT_WORDS = /^\s*(?:markdown is supported|paste, drop, or click to add files)\s*$/i;

/**
 * The writer's foot ("Markdown is supported", "Paste, drop, or click to add
 * files") says what the toolbar and the field already offer: hidden, with
 * whatever holds both and nothing else (the attach button and dropping onto
 * the field still upload, the file input staying in the page). Found by its
 * words, since nothing in GitHub's markup names the row.
 */
function hideFoot(root: HTMLElement, field: HTMLTextAreaElement): void {
  const marks = [...root.querySelectorAll<HTMLElement>('*')].filter((element) => FOOT_WORDS.test(element.textContent ?? '') && ![...element.children].some((child) => FOOT_WORDS.test(child.textContent ?? '')));
  if (marks.length === 0) return;
  let row = marks[0]?.parentElement ?? null;
  while (row !== null && row !== root && !marks.every((mark) => row?.contains(mark))) row = row.parentElement;
  const targets = row === null || row === root || row.contains(field) ? marks : [row];
  for (const target of targets) target.setAttribute('data-geld-writer-foot', '');
}

function writerFrom(template: Element, text: string): CommentWriter | null {
  const element = document.importNode(template, true);
  if (!(element instanceof HTMLElement)) return null;
  // A copy of the page's own box comes as the reader left it: back to an empty Write tab.
  element.classList.remove('preview-selected');
  element.classList.add('write-selected');
  for (const preview of element.querySelectorAll('.js-preview-body')) preview.replaceChildren();
  reid(element);
  const field = element.querySelector('textarea.js-comment-field') ?? element.querySelector('textarea');
  if (!(field instanceof HTMLTextAreaElement)) return null;
  // GitHub's session resume would keep this copy's words under an id no page has again.
  field.classList.remove('js-session-resumable');
  field.value = text;
  hideFoot(element, field);
  // GitHub's preview finds the writer's form (without one it answers "Error rendering preview"); its Ctrl+Enter submits
  // that form, which must never go anywhere: the box sends the words itself.
  const form = document.createElement('form');
  form.className = 'geld-comment-writer';
  // The field is `required` for GitHub's own form: a submit here (Ctrl+Enter, a toolbar button) showed the browser's
  // "Please fill out this field" bubble over the toolbar, though the box decides what may be sent.
  form.noValidate = true;
  form.addEventListener('submit', (event) => event.preventDefault());
  form.append(element);
  return { element: form, field };
}

/** A writer for `pullPath` holding `text`, now if GitHub's form is already at hand, else null (see `loadWriter`). */
export function writerNow(pullPath: string, text: string): CommentWriter | null {
  const template = liveTemplate(pullPath) ?? fetched.get(pullPath) ?? null;
  return template === null ? null : writerFrom(template, text);
}

/** A writer for `pullPath` holding `text` once GitHub's form is read, or null when it cannot be. */
export async function loadWriter(pullPath: string, text: string): Promise<CommentWriter | null> {
  const template = await templateFor(pullPath);
  return template === null ? null : writerFrom(template, text);
}
