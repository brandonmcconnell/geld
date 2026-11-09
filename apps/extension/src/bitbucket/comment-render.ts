import type { ProviderReviewComment } from '@geld/review';
import { nativeBitbucketComment } from './conversation';

const ELEMENTS = new Set(['a', 'abbr', 'b', 'bdi', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'button', 'input', 'select', 'textarea', 'audio', 'video', 'canvas', 'svg', 'math']);

function safeUrl(value: string | null, base: string): string | null {
  if (value === null || value.trim() === '') return null;
  try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) && url.username === '' && url.password === '' ? url.href : null; } catch { return null; }
}

export function renderBitbucketComment(comment: ProviderReviewComment, host: HTMLElement, doc: Document): boolean {
  const source = nativeBitbucketComment(comment, doc)?.querySelector<HTMLElement>('[data-testid="comment-content"] .ak-renderer-document');
  if (source === null || source === undefined) return false;
  let remaining = 10_000;
  let exceeded = false;
  const copy = (node: Node, depth: number): Node | null => {
    if (--remaining < 0 || depth > 64) { exceeded = true; return null; }
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '');
    if (!(node instanceof Element) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
    const tag = node.localName;
    if (DROP.has(tag) || node.hasAttribute('contenteditable')) return null;
    const element = ELEMENTS.has(tag) ? doc.createElement(tag) : doc.createDocumentFragment();
    if (element instanceof HTMLElement) {
      element.className = [...node.classList].filter((name) => !name.startsWith('js-')).join(' ');
      for (const name of ['title', 'lang', 'dir', 'aria-label']) { const value = node.getAttribute(name); if (value !== null) element.setAttribute(name, value); }
      for (const name of ['width', 'height', 'colspan', 'rowspan']) { const value = node.getAttribute(name); if (value !== null && /^[1-9]\d{0,4}$/.test(value)) element.setAttribute(name, value); }
      if (tag === 'a') { const href = safeUrl(node.getAttribute('href'), comment.url); if (href !== null) { element.setAttribute('href', href); element.setAttribute('rel', 'noopener noreferrer'); if (new URL(href).origin !== new URL(comment.url).origin || node.getAttribute('target') === '_blank') element.setAttribute('target', '_blank'); } }
      if (tag === 'img') { const src = safeUrl(node.getAttribute('src'), comment.url); if (src === null) return doc.createTextNode(node.getAttribute('alt') ?? ''); element.setAttribute('src', src); element.setAttribute('alt', node.getAttribute('alt') ?? ''); element.setAttribute('loading', 'lazy'); }
      if (tag === 'details' && node.hasAttribute('open')) element.setAttribute('open', '');
      if (tag === 'ol') { const start = node.getAttribute('start'); if (start !== null && /^-?\d{1,6}$/.test(start)) element.setAttribute('start', start); }
    }
    for (const child of node.childNodes) { const cloned = copy(child, depth + 1); if (cloned !== null) element.appendChild(cloned); }
    return element;
  };
  const rendered = copy(source, 0);
  if (rendered === null || exceeded) return false;
  if (rendered instanceof HTMLElement) rendered.dataset.geldUi = '';
  host.replaceChildren(rendered);
  return true;
}
