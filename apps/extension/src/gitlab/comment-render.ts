import type { ProviderReviewComment } from '@geld/review';
import { providerReviewUrl } from '@geld/review';
import type { GitLabRenderedNote } from './review';
import { describeGitLabPage } from './page';
import { isProviderReviewPage } from '../providers/types';

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

function nativeBody(comment: ProviderReviewComment, doc: Document): { readonly kind: 'absent' | 'invalid' } | { readonly kind: 'native'; readonly body: HTMLElement } {
  if (!/^[1-9]\d*$/.test(comment.id) || comment.anchor !== `note_${comment.id}`) return { kind: 'invalid' };
  const roots = doc.querySelectorAll(`[id="${comment.anchor}"]`);
  if (roots.length === 0) return { kind: 'absent' };
  const source = roots[0];
  if (roots.length !== 1 || !(source instanceof HTMLElement) || !source.matches('[data-testid="noteable-note-container"]')
    || source.closest('[data-geld-ui], .note-body, [data-testid="description-content"]') !== null) return { kind: 'invalid' };
  const authors = source.querySelectorAll<HTMLAnchorElement>(':scope > .timeline-entry-inner > .timeline-content > .note-header > .note-header-info > a.author-name-link[data-user-id][data-username]');
  const bodies = source.querySelectorAll<HTMLElement>('.note-body .note-text');
  const body = bodies[0];
  return authors.length === 1 && authors[0]?.dataset.userId === comment.author.id && authors[0].dataset.username === comment.author.login
    && bodies.length === 1 && body !== undefined ? { kind: 'native', body } : { kind: 'invalid' };
}

function renderedBody(comment: ProviderReviewComment, evidence: GitLabRenderedNote | undefined, doc: Document): HTMLElement | null {
  if (evidence === undefined || evidence.subject.provider !== 'gitlab' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(evidence.subject.headSha)
    || !/^[1-9]\d*$/.test(evidence.projectId) || !/^[1-9]\d*$/.test(evidence.noteableId)
    || evidence.html.trim() === '' || evidence.html.length > 256 * 1024) return null;
  const previous = evidence.comment;
  const keys = ['id', 'anchor', 'url', 'body', 'createdAt', 'updatedAt'] as const;
  if (keys.some((key) => previous[key] !== comment[key])
    || previous.author.id !== comment.author.id || previous.author.login !== comment.author.login || previous.author.automated !== comment.author.automated) return null;
  try {
    const page = describeGitLabPage(new URL(doc.URL), doc);
    if (page === null || !isProviderReviewPage(page) || page.url !== providerReviewUrl(evidence.subject)
      || comment.url !== `${page.url}#${comment.anchor}` || page.headSha !== null && page.headSha !== evidence.subject.headSha) return null;
  } catch { return null; }
  // Template content is inert; no API fragment is inserted or hydrated as native markup.
  const template = doc.createElement('template');
  try { template.innerHTML = evidence.html; } catch { return null; }
  const source = doc.createElement('div');source.className = 'note-text md';source.append(template.content);
  return source;
}

function nativeSortableHeader(button: Element, source: HTMLElement): Element | null {
  const identity = /^markdown-table-[1-9]\d*-col_(0|[1-9]\d*)-sort$/.exec(button.id);
  const wrapper = button.parentElement;
  const cell = wrapper?.parentElement;
  const row = cell?.parentElement;
  if (identity === null || button.namespaceURI !== 'http://www.w3.org/1999/xhtml' || button.getAttribute('type') !== 'button'
    || [...button.attributes].some((attribute) => !['id', 'type', 'class'].includes(attribute.name))
    || !button.classList.contains('gl-text-inherit') || !button.classList.contains('gl-font-bold')
    || wrapper?.localName !== 'div' || !wrapper.classList.contains('gl-flex') || wrapper.querySelectorAll('button').length !== 1
    || cell?.localName !== 'th' || cell.getAttribute('scope') !== 'col' || !cell.classList.contains('gl-group/markdown-table-header')
    || !['none', 'ascending', 'descending'].includes(cell.getAttribute('aria-sort') ?? '')
    || row?.localName !== 'tr' || row.parentElement?.localName !== 'thead' || row.parentElement.parentElement?.localName !== 'table'
    || [...row.children].indexOf(cell) !== Number(identity[1]) || !source.contains(row.parentElement.parentElement)
    || source.querySelectorAll(`[id="${button.id}"]`).length !== 1) return null;
  const labels = [...button.children].filter((child) => child.localName === 'span' && !child.hasAttribute('aria-hidden'));
  const label = labels[0];
  if (labels.length !== 1 || label === undefined || label.attributes.length !== 0 || !label.textContent?.trim()
    || [...label.childNodes].some((child) => child.nodeType !== Node.TEXT_NODE)) return null;
  return [...button.childNodes].every((child) => child.nodeType === Node.TEXT_NODE ? !child.textContent?.trim()
    : child === label || child instanceof Element && (child.matches('span[aria-hidden="true"]:empty')
      || child.matches('svg[data-sort-icon][aria-hidden="true"]') && !child.textContent?.trim())) ? label : null;
}

/** Observed native table hydration can replace a Vue placeholder with this source-bound height control. */
function nativeTableHeightWrapper(wrapper: Element, source: HTMLElement): boolean {
  if (wrapper.localName !== 'div' || wrapper.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    || wrapper.attributes.length !== 1 || wrapper.getAttribute('class') !== 'gl-order-1 gl-mt-2 gl-flex gl-justify-center print:gl-hidden') return false;
  const contents = [...wrapper.childNodes].filter((child) => child.nodeType !== Node.TEXT_NODE || child.textContent?.trim());
  const button = contents[0];
  if (contents.length !== 1 || !(button instanceof Element) || button.localName !== 'button'
    || button.namespaceURI !== 'http://www.w3.org/1999/xhtml' || button.getAttribute('type') !== 'button'
    || button.getAttribute('class') !== 'btn gl-button btn-default btn-sm btn-default-tertiary'
    || button.getAttribute('data-testid') !== 'markdown-table-height-toggle' || button.getAttribute('aria-expanded') !== 'false'
    || [...button.attributes].some((attribute) => !['type', 'class', 'data-testid', 'aria-expanded', 'aria-controls'].includes(attribute.name))) return false;
  const controls = button.getAttribute('aria-controls');
  if (controls === null || !/^markdown-table-[1-9]\d*-scroll$/.test(controls)
    || source.ownerDocument.querySelectorAll(`[id="${controls}"]`).length !== 1
    || source.querySelectorAll(`button[data-testid="markdown-table-height-toggle"][aria-controls="${controls}"]`).length !== 1) return false;
  const scroll = source.querySelector(`[id="${controls}"]`);
  const shadow = scroll?.parentElement;
  const table = scroll?.querySelector(':scope > table[data-markdown-table-applied="true"]');
  if (scroll?.localName !== 'div' || scroll.getAttribute('class') !== 'gl-max-h-[70vh] gl-w-fit gl-max-w-full gl-overflow-x-auto gl-overflow-y-auto print:gl-max-h-none'
    || scroll.getAttribute('data-sticky-header') !== '' || scroll.getAttribute('data-print-scale-container') !== ''
    || [...scroll.attributes].some((attribute) => !['id', 'class', 'data-sticky-header', 'data-print-scale-container'].includes(attribute.name))
    || scroll.children.length !== 1 || table === null || table === undefined
    || shadow?.localName !== 'div' || shadow.getAttribute('class') !== 'gl-table-shadow-overlay'
    || shadow.getAttribute('data-testid') !== 'table-shadow-overlay' || shadow.children.length !== 1
    || shadow.parentElement !== wrapper.parentElement || wrapper.previousElementSibling !== shadow || !source.contains(wrapper)) return false;
  const icon = button.children[0];
  const label = button.children[1];
  const decoration = icon === undefined ? [] : [icon, ...icon.querySelectorAll('*')];
  if (button.children.length !== 2 || icon?.localName !== 'svg' || icon.namespaceURI !== 'http://www.w3.org/2000/svg'
    || icon.getAttribute('aria-hidden') !== 'true' || icon.textContent?.trim()
    || decoration.some((node) => node.namespaceURI !== 'http://www.w3.org/2000/svg' || !['svg', 'g', 'path', 'use'].includes(node.localName)
      || [...node.attributes].some((attribute) => attribute.name.startsWith('on') || ['tabindex', 'contenteditable'].includes(attribute.name)))
    || label?.localName !== 'span' || label.getAttribute('class') !== 'gl-button-text' || label.attributes.length !== 1
    || label.textContent?.trim() !== 'Show full table' || [...label.childNodes].some((child) => child.nodeType !== Node.TEXT_NODE && child.nodeType !== Node.COMMENT_NODE)) return false;
  return [...button.childNodes].every((child) => child === icon || child === label || child.nodeType === Node.COMMENT_NODE
    || child.nodeType === Node.TEXT_NODE && !child.textContent?.trim());
}

export function renderGitLabComment(comment: ProviderReviewComment, host: HTMLElement, doc: Document = document, evidence?: GitLabRenderedNote): boolean {
  const native = nativeBody(comment, doc);
  const commentUrl = safeUrl(comment.url, doc.URL);
  if (native.kind === 'invalid' || commentUrl === null) return false;
  const documentUrl = new URL(doc.URL);
  if (['https:', 'http:'].includes(documentUrl.protocol) && documentUrl.origin !== new URL(commentUrl).origin) return false;
  const url = new URL(commentUrl);
  const page = describeGitLabPage(documentUrl, doc);
  if (page === null || !isProviderReviewPage(page) || page.url !== `${url.origin}${url.pathname}` || url.search !== '' || url.hash !== `#${comment.anchor}`) return false;
  const source = native.kind === 'native' ? native.body : renderedBody(comment, evidence, doc);
  if (source === null) return false;
  const api = native.kind === 'absent';
  let remaining = MAX_NODES;
  let exceeded = false;

  const copy = (node: Node, depth: number): Node | null => {
    remaining -= 1;
    if (remaining < 0 || depth > MAX_DEPTH) { exceeded = true; return null; }
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '');
    if (!(node instanceof Element)) return null;
    const tag = node.localName.toLowerCase();
    // Its live button is already dropped; omit only the verified generated wrapper as well.
    if (!api && tag === 'div' && nativeTableHeightWrapper(node, source)) return null;
    // GitLab wraps Markdown TH labels in generated sort buttons; keep their typography without the live control.
    const headerLabel = !api && tag === 'button' && !node.hasAttribute('contenteditable') ? nativeSortableHeader(node, source) : null;
    if (headerLabel !== null) {
      const fragment = doc.createDocumentFragment();
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) fragment.append(doc.createTextNode(child.textContent ?? ''));
        else if (child === headerLabel) {
          const label = doc.createElement('span');
          label.className = 'gl-font-bold gl-text-inherit';
          label.dataset.geldNativeTableHeaderLabel = '';
          label.textContent = child.textContent;
          fragment.append(label);
        }
      }
      return fragment;
    }
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
    const classes = [...node.classList].filter((name) => api
      ? ['note-text', 'md', 'code', 'highlight', 'line', 'markdown-code-block'].includes(name) || /^language-[a-z0-9][\w.+-]{0,40}$/i.test(name)
      : !name.startsWith('js-')).join(' ');
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
      if (api) return doc.createTextNode(node.getAttribute('alt') ?? '');
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
    if (tag === 'th') {
      const scope = node.getAttribute('scope');
      if (scope !== null && ['col', 'row', 'colgroup', 'rowgroup'].includes(scope)) element.setAttribute('scope', scope);
    }
    for (const child of node.childNodes) {
      const cloned = copy(child, depth + 1);
      if (cloned !== null) element.append(cloned);
    }
    if (!api && tag === 'th' && node.matches('.md [data-sticky-header] > table:not(.code) > thead:first-of-type > tr:first-child > th')
      && source.contains(node.closest('[data-sticky-header]'))
      && element.querySelector(':scope > div > span[data-geld-native-table-header-label]') !== null) element.dataset.geldNativeStickyHeaderCell = '';
    return element;
  };
  const rendered = copy(source, 0);
  if (rendered === null || exceeded || api && !rendered.textContent?.trim()) return false;
  if (rendered instanceof HTMLElement) { rendered.dataset.geldUi = '';if (api) rendered.dataset.geldRenderedSource = 'api'; }
  host.replaceChildren(rendered);
  host.style.whiteSpace = '';
  return true;
}
