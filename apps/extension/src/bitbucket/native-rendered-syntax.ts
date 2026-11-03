import type { ProviderDiffEntry, ProviderDiffView } from '../providers/types';
import { providerNativeSourceElement } from '../providers/source-facts';

const AUTHORED = '[data-testid="comment-content"],[data-qa="pr-activity"]';
const ON = ['__rbb_syntax_highlight', 'code-diff', 'syntax-highlighted'];
const TOKENS = new Set(['token', 'key', 'atrule', 'punctuation', 'number', 'important', 'boolean', 'comment', 'tag']);

function visible(node: HTMLElement, styles: Map<HTMLElement, boolean>, geometry = true): boolean {
  const styleVisible = (current: HTMLElement): boolean => {
    const known = styles.get(current);if (known !== undefined) return known;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    const result = current.isConnected && providerNativeSourceElement(current) && current.closest(AUTHORED) === null && style !== undefined && style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility)
      && style.contentVisibility !== 'hidden' && style.opacity !== '0' && (current.parentElement === null || styleVisible(current.parentElement));
    styles.set(current, result);return result;
  };
  if (!styleVisible(node)) return false;
  if (!geometry) return true;
  const bounds = node.getBoundingClientRect();return bounds.width > 0 && bounds.height > 0;
}

function lineNumber(value: string | null): boolean { return value === null || /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)); }

/** Current native rendering proves only this original file's presentation, never a global preference. */
export function bitbucketNativeRenderedOn(view: ProviderDiffView, entry: ProviderDiffEntry): boolean {
  const root = entry.root;const doc = root.ownerDocument;const styles = new Map<HTMLElement, boolean>();
  if (view.kind !== 'bitbucket-cloud' || entry.path !== 'bitbucket-pipelines.yml' || entry.anchor !== 'chg-bitbucket-pipelines.yml' || root.parentElement !== view.container || !visible(root, styles) || !visible(view.container, styles)
    || view.container.getAttribute('role') !== 'region' || view.container.getAttribute('aria-label') !== 'Diff'
    || doc.querySelectorAll('[role="region"][aria-label="Diff"]').length !== 1 || doc.querySelectorAll('[id="chg-bitbucket-pipelines.yml"]').length !== 1) return false;
  const anchors = root.querySelectorAll(':scope > div[id^="chg-"]');const articles = root.querySelectorAll<HTMLElement>(':scope > div > article[data-qa="branch-diff-file"]');
  const article = articles[0];
  if (anchors.length !== 1 || anchors[0]?.id !== entry.anchor || articles.length !== 1 || article === undefined || article.getAttribute('aria-label') !== 'Diff of file bitbucket-pipelines.yml' || article.parentElement?.attributes.length !== 0 || article.parentElement.children.length !== 1 || !visible(article, styles)) return false;
  const headings = article.querySelectorAll('h2[data-qa="bk-filepath"]');
  if (headings.length !== 1 || headings[0]?.textContent?.trim() !== entry.path) return false;
  const grids = article.querySelectorAll<HTMLElement>('[role="grid"][aria-label="Diff content"]');const grid = grids[0];
  if (grids.length !== 1 || grid === undefined || !visible(grid, styles)) return false;
  const rows = [...grid.querySelectorAll<HTMLElement>('[data-qa="code-line"]')];
  if (rows.length === 0 || rows.length > 2000 || article.querySelectorAll('[data-qa="code-line"]').length !== rows.length) return false;
  let meaningfulToken = false;let textSize = 0;let oldNumber = 0;let newNumber = 0;let spanCount = 0;let previousGroup: HTMLElement | null = null;const groups = new Set<HTMLElement>();
  for (const [index, row] of rows.entries()) {
    const group = row.closest<HTMLElement>('[role="rowgroup"]');const owner = row.closest('[role="row"][data-key="code-line"]');
    const codes = row.querySelectorAll<HTMLElement>('[data-line-type]');const code = codes[0];const numbers = row.querySelectorAll('[data-key="code-line-number"]');const number = numbers[0];
    if (group === null || !grid.contains(group) || !visible(group, styles, false) || owner === null || owner.parentElement?.closest('[role="rowgroup"]') !== group || row.parentElement !== owner
      || codes.length !== 1 || code === undefined || numbers.length !== 1 || number === undefined || number.closest('[role="row"]') !== owner || !visible(row, styles) || !visible(code, styles, false)) return false;
    if (group !== previousGroup) { if (groups.has(group)) return false;groups.add(group);previousGroup = group; }
    const old = number.getAttribute('data-old-line-number');const next = number.getAttribute('data-new-line-number');const kind = code.getAttribute('data-line-type');
    if (!lineNumber(old) || !lineNumber(next) || old === null && next === null || ![' ', '+', '-'].includes(kind ?? '') || kind === '+' && (old !== null || next === null) || kind === '-' && (old === null || next !== null) || kind === ' ' && (old === null || next === null)) return false;
    if (old !== null) { const value = Number(old);if (value <= oldNumber) return false;oldNumber = value; }
    if (next !== null) { const value = Number(next);if (value <= newNumber) return false;newNumber = value; }
    const pre = code.parentElement?.parentElement;
    if (code.tagName !== 'SPAN' || code.getAttribute('role') !== 'gridcell' || [...code.classList].sort().join(' ') !== ON.join(' ')
      || [...code.attributes].map((a) => a.name).sort().join(' ') !== 'aria-label class data-line-type role'
      || code.parentElement?.tagName !== 'DIV' || code.parentElement.attributes.length !== 0 || code.parentElement.children.length !== 2 || code.parentElement.children[1] !== code || code.parentElement.children[0]?.tagName !== 'SPAN' || code.parentElement.children[0]?.className !== 'diff-line-type' || code.parentElement.children[0]?.attributes.length !== 1 || code.parentElement.children[0]?.textContent !== kind || pre?.tagName !== 'PRE' || !pre.classList.contains('code-component') || pre.parentElement !== row
      || code.children.length !== 1 || code.firstElementChild?.tagName !== 'SPAN' || [...code.childNodes].some((node) => node.nodeType !== 1 && (node.nodeType !== 3 || node.textContent !== ''))) return false;
    const raw = code.textContent ?? '';textSize += raw.length;if (textSize > 512_000 || /\r/.test(raw)) return false;
    const continues = rows[index + 1]?.closest('[role="rowgroup"]') === group;
    if (raw.endsWith('\n') !== continues) return false;
    const text = continues ? raw.slice(0, -1) : raw;
    const label = kind === '+' ? 'Added' : kind === '-' ? 'Removed' : 'Unchanged';
    if (text.includes('\n') || code.getAttribute('aria-label') !== `${label}: ${text}`) return false;
    const spans = [...code.querySelectorAll('*')];spanCount += spans.length;if (spanCount > 20_000) return false;
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];if (span === undefined || span.tagName !== 'SPAN' || span.attributes.length !== 1 || !span.hasAttribute('class') || span.classList.length === 0 || [...span.childNodes].some((node) => node.nodeType !== 1 && node.nodeType !== 3)) return false;
      if (i === 0) { if (span.classList.contains('token')) return false; }
      else {
        if (!span.classList.contains('token') || [...span.classList].some((value) => !TOKENS.has(value))) return false;
        if ((span.textContent?.replace(/\n/g, '').trim().length ?? 0) > 0) meaningfulToken = true;
      }
    }
  }
  return meaningfulToken;
}
