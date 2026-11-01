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

export class ProviderCounts {
  private readonly managed = new Map<HTMLElement, ManagedCount>();

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
    const text = managed.original.replace(/\d[\d,\u00a0\u202f]*/, new Intl.NumberFormat('en-US').format(count))
      .replace(/\b(files?|additions?|deletions?)\b/gi, (word) => {
        const singular = word.replace(/s$/i, '');
        return count === 1 ? singular : `${singular}s`;
      });
    if (managed.node.data !== text) managed.node.data = text;
    managed.last = text;
  }

  restore(): void {
    for (const value of this.managed.values()) {
      if (value.node.data === value.last) value.node.data = value.original;
    }
    this.managed.clear();
  }
}
