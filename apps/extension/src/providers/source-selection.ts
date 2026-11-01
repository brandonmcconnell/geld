import type { ProviderReviewComment } from '@geld/review';

export type ProviderSourceSelection = { readonly kind: 'unavailable' } | {
  readonly kind: 'excerpt';
  readonly sourceId: string;
  readonly anchor: string;
  readonly url: string;
  readonly body: HTMLElement;
  readonly range: Range;
  readonly text: string;
  readonly fullText: string;
  readonly start: number;
  readonly end: number;
};

export interface ProviderSourceActionContext {
  readonly selection?: ProviderSourceSelection;
  readonly current?: () => boolean;
}

function offset(body: HTMLElement, node: Node, position: number): number {
  const range = body.ownerDocument.createRange();
  range.selectNodeContents(body);
  range.setEnd(node, position);
  return range.toString().length;
}

export function captureProviderSourceSelection(comment: ProviderReviewComment, body: HTMLElement): ProviderSourceSelection | undefined {
  const selection = body.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed || selection.toString().trim() === '') return undefined;
  if (selection.rangeCount !== 1) return { kind: 'unavailable' };
  const range = selection.getRangeAt(0).cloneRange();
  const editor = (node: Node): boolean => (node instanceof Element ? node : node.parentElement)?.closest('input,textarea,select,[contenteditable]') !== null;
  if (!body.contains(range.startContainer) || !body.contains(range.endContainer) || editor(range.startContainer) || editor(range.endContainer)) return { kind: 'unavailable' };
  return { kind: 'excerpt', sourceId: comment.id, anchor: comment.anchor, url: comment.url, body, range, text: range.toString(), fullText: body.textContent ?? '', start: offset(body, range.startContainer, range.startOffset), end: offset(body, range.endContainer, range.endOffset) };
}

/** Exact positions in equal complete bodies keep repeated words and native markup unambiguous. */
export function mapProviderSourceSelection(selection: ProviderSourceSelection, original: HTMLElement, sourceId: string, anchor: string, url: string): Range | null {
  if (selection.kind !== 'excerpt') return null;
  const { body, range, text, fullText, start, end } = selection;
  const article = body.closest<HTMLElement>('article[data-geld-source]');
  if (selection.sourceId !== sourceId || selection.anchor !== anchor || selection.url !== url || !body.isConnected || !original.isConnected
    || body.ownerDocument !== original.ownerDocument || article?.dataset.geldSource !== anchor || article.dataset.geldSourceId !== sourceId || article.dataset.geldSourceUrl !== url
    || article.closest('[data-geld-ui]') === null || !body.contains(range.startContainer) || !body.contains(range.endContainer)
    || text.trim() === '' || text.length > 100_000 || fullText.length > 1_000_000 || body.textContent !== fullText || original.textContent !== fullText
    || range.toString() !== text || start !== offset(body, range.startContainer, range.startOffset) || end !== offset(body, range.endContainer, range.endOffset)) return null;
  const walker = original.ownerDocument.createTreeWalker(original, NodeFilter.SHOW_TEXT);
  const mapped = original.ownerDocument.createRange();
  let position = 0;
  let started = false;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < position + length) { mapped.setStart(node, start - position); started = true; }
    if (started && end <= position + length) {
      mapped.setEnd(node, end - position);
      return mapped.toString() === text ? mapped : null;
    }
    position += length;
  }
  return null;
}

export function selectionRanges(doc: Document): readonly Range[] {
  const selection = doc.getSelection();
  return selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
}

export function selectionMatches(doc: Document, ranges: readonly Range[]): boolean {
  const selection = doc.getSelection();
  return selection !== null && selection.rangeCount === ranges.length && ranges.every((range, index) => {
    const current = selection.getRangeAt(index);
    return current.startContainer === range.startContainer && current.startOffset === range.startOffset && current.endContainer === range.endContainer && current.endOffset === range.endOffset;
  });
}
