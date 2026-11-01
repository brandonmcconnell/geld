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
    // GitLab wraps Markdown TH labels in generated sort buttons; keep their typography without the live control.
    const headerLabel = tag === 'button' && !node.hasAttribute('contenteditable') ? nativeSortableHeader(node, source) : null;
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
    if (tag === 'th') {
      const scope = node.getAttribute('scope');
      if (scope !== null && ['col', 'row', 'colgroup', 'rowgroup'].includes(scope)) element.setAttribute('scope', scope);
    }
    for (const child of node.childNodes) {
      const cloned = copy(child, depth + 1);
      if (cloned !== null) element.append(cloned);
    }
    if (tag === 'th' && node.matches('.md [data-sticky-header] > table:not(.code) > thead:first-of-type > tr:first-child > th')
      && source.contains(node.closest('[data-sticky-header]'))
      && element.querySelector(':scope > div > span[data-geld-native-table-header-label]') !== null) element.dataset.geldNativeStickyHeaderCell = '';
    return element;
  };
  const rendered = copy(source, 0);
  if (rendered === null || exceeded) return false;
  if (rendered instanceof HTMLElement) rendered.dataset.geldUi = '';
  host.replaceChildren(rendered);
  host.style.whiteSpace = '';
  return true;
}
