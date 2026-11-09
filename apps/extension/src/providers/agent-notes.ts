import { firstSentence } from '@geld/review';
import { toolBlocksOf } from '../ui/description-tools';

export interface ProviderAgentNote {
  readonly id: string;
  readonly name: string;
  readonly preview: string;
  readonly blocks: readonly Element[];
  readonly content: readonly Element[];
  readonly signature: string;
}

export function providerAgentNotes(host: HTMLElement | null): readonly ProviderAgentNote[] {
  if (host === null || host.closest('[data-geld-ui]') !== null) return [];
  const blocks = [...host.children].filter(block => !block.hasAttribute('data-geld-ui'));
  const notes = new Map<string, { name: string; blocks: Element[]; content: Element[] }>();
  for (const tool of toolBlocksOf(blocks)) {
    const entry = notes.get(tool.id) ?? { name: tool.name, blocks: [], content: [] };
    const range = blocks.slice(tool.start, tool.end + 1);entry.blocks.push(...range);
    entry.content.push(...range.filter((block, offset) => tool.start + offset !== tool.title && block.tagName !== 'HR'));
    notes.set(tool.id, entry);
  }
  return [...notes].map(([id, note]) => {
    const content = note.content.length === 0 ? note.blocks : note.content;
    const signature = JSON.stringify(content.map(block => [block.tagName, block.textContent, [...block.querySelectorAll('a[href], img[src]')].map(node => [node.getAttribute('href'), node.getAttribute('src'), node.getAttribute('alt')])]));
    return { id, ...note, content, signature, preview: firstSentence(content.map(block => block.textContent ?? '').join('\n')) };
  });
}

const TAGS = new Set(['a', 'abbr', 'b', 'bdi', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'samp', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var']);
const DROP = new Set(['script', 'style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg', 'canvas', 'video', 'audio', 'meta', 'link']);

export function renderProviderAgentNote(note: ProviderAgentNote, host: HTMLElement): void {
  const doc = host.ownerDocument;let visited = 0;let limited = false;
  const url = (value: string | null, base: string): string | null => {
    if (value === null) return null;
    try { const parsed = new URL(value, base);return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' ? parsed.href : null; } catch { return null; }
  };
  const copy = (source: Node, depth: number): Node | null => {
    if (++visited > 10_000 || depth > 64) { limited = true;return null; }
    if (source.nodeType === Node.TEXT_NODE) return doc.createTextNode(source.textContent ?? '');
    if (!(source instanceof Element) || source.hasAttribute('data-geld-ui')) return null;
    const name = source.tagName.toLowerCase();if (DROP.has(name)) return null;
    const target = TAGS.has(name) ? doc.createElement(name) : doc.createDocumentFragment();
    if (target instanceof HTMLElement) {
      const classes = [...source.classList].filter(name => /^[\w!:/-]+$/.test(name) && !name.startsWith('geld-'));
      if (classes.length > 0) target.className = classes.join(' ');
      for (const key of ['title', 'aria-label', 'alt']) { const value = source.getAttribute(key);if (value !== null) target.setAttribute(key, value); }
      if (name === 'details' && source.hasAttribute('open')) target.setAttribute('open', '');
      for (const key of ['colspan', 'rowspan', 'width', 'height']) { const value = source.getAttribute(key);if (value !== null && /^\d{1,4}$/.test(value)) target.setAttribute(key, value); }
      if (name === 'a') { const href = url(source.getAttribute('href'), source.ownerDocument.URL);if (href !== null) { target.setAttribute('href', href);target.setAttribute('rel', 'noopener noreferrer');target.setAttribute('target', '_blank'); } }
      if (name === 'img') { const src = url(source.getAttribute('src'), source.ownerDocument.URL);if (src !== null) { target.setAttribute('src', src);target.setAttribute('loading', 'lazy');target.setAttribute('referrerpolicy', 'no-referrer'); } }
    }
    for (const child of source.childNodes) { const cloned = copy(child, depth + 1);if (cloned !== null) target.appendChild(cloned); }
    return target;
  };
  for (const block of note.content) { const cloned = copy(block, 0);if (cloned !== null) host.append(cloned); }
  if (limited) { const notice = doc.createElement('p');notice.textContent = 'Some content could not be displayed. View it in the description.';host.append(notice); }
}
