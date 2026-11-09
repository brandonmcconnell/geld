import { pluralize } from '@geld/core';
import type { ChangeTotals } from '@geld/core';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.setAttribute('data-geld-ui', '');
  if (text !== '') node.textContent = text;
  if (className !== '') node.className = className;
  return node;
}

interface ManagedCount {
  readonly node: Text;
  original: string;
  last: string;
}

interface ManagedAttribute { original: string; last: string }

function countText(original: string, count: number): string {
  return original.replace(/\d[\d,\u00a0\u202f]*/, new Intl.NumberFormat('en-US').format(count))
    .replace(/\b(files?|additions?|deletions?|lines?)\b/gi, (word) => {
      const singular = word.replace(/s$/i, '');
      return count === 1 ? singular : `${singular}s`;
    });
}

export class ProviderCounts {
  private readonly managed = new Map<HTMLElement, ManagedCount>();
  private readonly attributes = new Map<HTMLElement, Map<'aria-label' | 'title', ManagedAttribute>>();
  private readonly summaries = new Map<HTMLElement, HTMLElement>();

  writeSummary(host: HTMLElement, totals: ChangeTotals): void {
    let summary = this.summaries.get(host);
    if (summary === undefined || summary.parentElement !== host) {
      summary?.remove();
      summary = element('span', '', 'geld-provider-accessible-counts');
      host.append(summary);
      this.summaries.set(host, summary);
    }
    const text = `${pluralize(totals.files, 'file', 'files')} changed. Added ${pluralize(totals.additions, 'line', 'lines')}. Removed ${pluralize(totals.deletions, 'line', 'lines')}.`;
    if (summary.textContent !== text) summary.textContent = text;
  }

  write(host: HTMLElement | null, count: number): void {
    if (host === null) return;
    let managed = this.managed.get(host);
    if (managed !== undefined && !host.contains(managed.node)) {
      this.managed.delete(host);
      managed = undefined;
    }
    if (managed === undefined) {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let child = walker.nextNode();
      while (child !== null && !/\d/.test(child.textContent ?? '')) child = walker.nextNode();
      if (!(child instanceof Text)) return;
      managed = { node: child, original: child.data, last: child.data };
      this.managed.set(host, managed);
    }
    if (managed.node.data !== managed.last) managed.original = managed.node.data;
    const text = countText(managed.original, count);
    if (managed.node.data !== text) managed.node.data = text;
    managed.last = text;
  }

  writeAttribute(host: HTMLElement, attribute: 'aria-label' | 'title', count: number): void {
    const current = host.getAttribute(attribute);
    if (current === null || (current.match(/\d[\d,\u00a0\u202f]*/g)?.length ?? 0) !== 1) return;
    this.writeManagedAttribute(host, attribute, (original) => countText(original, count));
  }

  writeLineAttribute(host: HTMLElement, attribute: 'aria-label' | 'title', totals: Pick<ChangeTotals, 'additions' | 'deletions'>): void {
    const current = host.getAttribute(attribute);
    if (current === null || (current.match(/\d[\d,\u00a0\u202f]*/g)?.length ?? 0) !== 2
      || !/\bAdded\s+\d[\d,\u00a0\u202f]*\s+lines?\b/i.test(current) || !/\bRemoved\s+\d[\d,\u00a0\u202f]*\s+lines?\b/i.test(current)) return;
    this.writeManagedAttribute(host, attribute, (original) => original.replace(/\b(Added|Removed)\s+\d[\d,\u00a0\u202f]*\s+lines?\b/gi, (phrase, verb: string) => countText(phrase, verb.toLowerCase() === 'added' ? totals.additions : totals.deletions)));
  }

  private writeManagedAttribute(host: HTMLElement, attribute: 'aria-label' | 'title', format: (original: string) => string): void {
    const current = host.getAttribute(attribute);
    if (current === null) return;
    const attributes = this.attributes.get(host) ?? new Map<'aria-label' | 'title', ManagedAttribute>();
    const managed = attributes.get(attribute) ?? { original: current, last: current };
    if (current !== managed.last) managed.original = current;
    const text = format(managed.original);
    if (current !== text) host.setAttribute(attribute, text);
    managed.last = text;
    attributes.set(attribute, managed);
    this.attributes.set(host, attributes);
  }

  restore(): void {
    for (const summary of this.summaries.values()) summary.remove();
    this.summaries.clear();
    for (const value of this.managed.values()) {
      if (value.node.data === value.last) value.node.data = value.original;
    }
    this.managed.clear();
    for (const [host, attributes] of this.attributes) for (const [attribute, value] of attributes) {
      if (host.getAttribute(attribute) === value.last) host.setAttribute(attribute, value.original);
    }
    this.attributes.clear();
  }
}
