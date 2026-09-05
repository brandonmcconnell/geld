/** Attribute that marks every element Geld creates, so we can ignore our own mutations. */
export const OWN_UI_ATTRIBUTE = 'data-geld-ui';

export function isHTMLElement(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement;
}

export function queryAll<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function query<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T | null {
  return root.querySelector<T>(selector);
}

/** Strip bidi isolation marks GitHub wraps file paths in, plus whitespace. */
export function cleanText(text: string | null | undefined): string {
  return (text ?? '').replace(/[\u200e\u200f\u2066-\u2069]/g, '').trim();
}

export interface LineStats {
  readonly additions: number;
  readonly deletions: number;
}

const STATS_TEXT = /(\d[\d,]*)\s+additions?\s*(?:&|and)\s*(\d[\d,]*)\s+deletions?/i;

/**
 * Parse GitHub's screen-reader summaries, which come in a few flavours:
 * - "15 changes: 8 additions & 7 deletions" (legacy file header)
 * - "Lines changed: 8 additions & 7 deletions" (React file header / PR header)
 * - "Showing 18 changed files with 93 additions and 53 deletions" (compare)
 */
export function parseLineStats(text: string | null | undefined): LineStats | null {
  if (text === null || text === undefined) return null;
  const match = STATS_TEXT.exec(text);
  if (match === null) return null;
  const additions = Number.parseInt((match[1] ?? '').replace(/,/g, ''), 10);
  const deletions = Number.parseInt((match[2] ?? '').replace(/,/g, ''), 10);
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return null;
  return { additions, deletions };
}

/** Walk up from `start` until reaching a direct child of `container`. */
export function directChildOf(container: Element, start: Element): HTMLElement | null {
  let current: Element | null = start;
  while (current !== null && current.parentElement !== container) {
    current = current.parentElement;
  }
  return isHTMLElement(current) ? current : null;
}

/** Most frequent element in a list, or `null` when empty. */
export function mostCommon<T>(items: readonly T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const item of items) {
    const count = (counts.get(item) ?? 0) + 1;
    counts.set(item, count);
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Update the visible text of an element while keeping the original around so
 * it can be restored. When the element holds a single text node we mutate it
 * in place, which keeps React's reference to the node valid.
 */
export function setManagedText(element: HTMLElement, text: string): void {
  if (!element.hasAttribute('data-geld-original')) {
    element.setAttribute('data-geld-original', element.textContent ?? '');
  }
  if (element.textContent === text) return;
  const only = element.childNodes.length === 1 ? element.firstChild : null;
  if (only !== null && only.nodeType === Node.TEXT_NODE) {
    only.nodeValue = text;
  } else {
    element.textContent = text;
  }
}

export function restoreManagedText(element: HTMLElement): void {
  const original = element.getAttribute('data-geld-original');
  if (original === null) return;
  if (element.textContent !== original) element.textContent = original;
  element.removeAttribute('data-geld-original');
}

/** Return the remembered original text, defaulting to the current text. */
export function originalText(element: HTMLElement): string {
  return element.getAttribute('data-geld-original') ?? element.textContent ?? '';
}

export function isOwnElement(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  return element?.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null && element !== null;
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>> = {},
  children: ReadonlyArray<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  for (const child of children) {
    element.append(child);
  }
  return element;
}

/** Parse an SVG string into an element (used for octicons). */
export function svgFromString(markup: string): SVGElement {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  const svg = template.content.firstElementChild;
  if (!(svg instanceof SVGElement)) throw new Error('Expected SVG markup');
  return svg;
}
