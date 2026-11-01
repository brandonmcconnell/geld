import type { ProviderReviewComment } from '@geld/review';

const ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'samp', 'small',
  'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var',
]);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'button', 'input', 'select', 'textarea', 'option', 'audio', 'video', 'canvas', 'svg', 'math']);
const MAX_NODES = 10_000;
const MAX_DEPTH = 64;

function safeUrl(value: string | null, base: string): string | null {
  if (value === null || value.trim() === '') return null;
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && url.username === '' && url.password === '' ? url.href : null;
  } catch {
    return null;
  }
}

function nativeBody(comment: ProviderReviewComment, doc: Document): HTMLElement | null {
  if (!/^[1-9]\d*$/.test(comment.id) || comment.anchor !== `note_${comment.id}`) return null;
  const source = doc.getElementById(comment.anchor);
  if (!(source instanceof HTMLElement) || !source.matches('[data-testid="noteable-note-container"]') || source.closest('[data-geld-ui]') !== null) return null;
  return source.querySelector<HTMLElement>('.note-body .note-text');
}

export function renderGitLabComment(comment: ProviderReviewComment, host: HTMLElement, doc: Document = document): boolean {
  const source = nativeBody(comment, doc);
  const commentUrl = safeUrl(comment.url, doc.URL);
  if (source === null || commentUrl === null) return false;
  const documentUrl = new URL(doc.URL);
  if (['https:', 'http:'].includes(documentUrl.protocol) && documentUrl.origin !== new URL(commentUrl).origin) return false;
  let remaining = MAX_NODES;
  let exceeded = false;

  const copy = (node: Node, depth: number): Node | null => {
    remaining -= 1;
    if (remaining < 0 || depth > MAX_DEPTH) { exceeded = true; return null; }
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '');
    if (!(node instanceof Element)) return null;
    const tag = node.localName.toLowerCase();
    if (node.hasAttribute('contenteditable') || DROP.has(tag)) {
      return tag === 'input' && node.getAttribute('type') === 'checkbox' && node.hasAttribute('disabled')
        ? doc.createTextNode(node.hasAttribute('checked') ? '☑ ' : '☐ ')
        : null;
    }
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
    if (!ELEMENTS.has(tag)) {
      const fragment = doc.createDocumentFragment();
      for (const child of node.childNodes) {
        const cloned = copy(child, depth + 1);
        if (cloned !== null) fragment.append(cloned);
      }
      return fragment;
    }
    const element = doc.createElement(tag);
    for (const attribute of ['title', 'lang', 'dir', 'aria-label']) {
      const value = node.getAttribute(attribute);
      if (value !== null) element.setAttribute(attribute, value);
    }
    const classes = [...node.classList].filter((name) => !name.startsWith('js-')).join(' ');
    if (classes !== '') element.className = classes;
    for (const attribute of ['data-lang', 'data-language']) {
      const value = node.getAttribute(attribute);
      if (value !== null && /^[a-z][\w.+-]{0,40}$/i.test(value)) element.setAttribute(attribute, value);
    }
    if (tag === 'a') {
      const href = safeUrl(node.getAttribute('href'), commentUrl);
      if (href !== null) {
        element.setAttribute('href', href);
        element.setAttribute('rel', 'noopener noreferrer');
        if (node.getAttribute('target') === '_blank' || new URL(href).origin !== new URL(commentUrl).origin) element.setAttribute('target', '_blank');
      }
    }
    if (tag === 'img') {
      const src = safeUrl(node.getAttribute('src'), commentUrl);
      if (src === null) return doc.createTextNode(node.getAttribute('alt') ?? '');
      element.setAttribute('src', src);
      element.setAttribute('alt', node.getAttribute('alt') ?? '');
      element.setAttribute('loading', 'lazy');
    }
    for (const attribute of ['width', 'height', 'colspan', 'rowspan']) {
      const value = node.getAttribute(attribute);
      if (value !== null && /^[1-9]\d{0,4}$/.test(value)) element.setAttribute(attribute, value);
    }
    if (tag === 'details' && node.hasAttribute('open')) element.setAttribute('open', '');
    if (tag === 'ol') {
      const start = node.getAttribute('start');
      if (start !== null && /^-?\d{1,6}$/.test(start)) element.setAttribute('start', start);
      if (node.hasAttribute('reversed')) element.setAttribute('reversed', '');
    }
    if (tag === 'td' || tag === 'th') {
      const align = node.getAttribute('align');
      if (align !== null && ['left', 'center', 'right'].includes(align)) element.setAttribute('align', align);
    }
    for (const child of node.childNodes) {
      const cloned = copy(child, depth + 1);
      if (cloned !== null) element.append(cloned);
    }
    return element;
  };
  const rendered = copy(source, 0);
  if (rendered === null || exceeded) return false;
  if (rendered instanceof HTMLElement) rendered.dataset.geldUi = '';
  host.replaceChildren(rendered);
  host.style.whiteSpace = '';
  return true;
}
