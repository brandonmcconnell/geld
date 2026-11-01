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
    const attributes = this.attributes.get(host) ?? new Map<'aria-label' | 'title', ManagedAttribute>();
    const managed = attributes.get(attribute) ?? { original: current, last: current };
    if (current !== managed.last) managed.original = current;
    const text = countText(managed.original, count);
    if (current !== text) host.setAttribute(attribute, text);
    managed.last = text;
    attributes.set(attribute, managed);
    this.attributes.set(host, attributes);
  }

  restore(): void {
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
