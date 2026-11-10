import type { ProviderWhitespace } from './whitespace';

export const MAX_WHITESPACE_LINKS = 400;

interface OwnedLink {
  readonly original: string;
  readonly resolved: string;
  readonly written: string;
  readonly document: Document;
}

export class ProviderWhitespaceLinks {
  private readonly links = new Map<HTMLAnchorElement, OwnedLink>();
  private disposed = false;

  constructor(private readonly whitespace: Pick<ProviderWhitespace, 'link'>) {}

  prepare(anchor: HTMLAnchorElement): void {
    if (this.disposed) return;
    this.refresh();
    if (!anchor.isConnected) return;
    const owned = this.links.get(anchor);
    if (owned !== undefined) return;
    const original = anchor.getAttribute('href');
    if (original === null) return;
    let url: URL;
    try { url = new URL(original, anchor.baseURI); } catch { return; }
    const written = this.whitespace.link(url);
    if (written === url.href) return;
    while (this.links.size >= MAX_WHITESPACE_LINKS) {
      const oldest = this.links.entries().next().value;
      if (oldest === undefined) break;
      this.release(oldest[0], oldest[1]);
    }
    this.links.set(anchor, { original, resolved: url.href, written, document: anchor.ownerDocument });
    anchor.setAttribute('href', written);
  }

  refresh(): void {
    for (const [anchor, owned] of this.links) {
      if (anchor.ownerDocument !== owned.document || anchor.getAttribute('href') !== owned.written) {
        this.links.delete(anchor);
      } else if (!anchor.isConnected || !this.sameDestination(anchor, owned) || this.whitespace.link(new URL(owned.resolved)) !== owned.written) {
        this.release(anchor, owned);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const [anchor, owned] of this.links) this.release(anchor, owned);
  }

  private release(anchor: HTMLAnchorElement, owned: OwnedLink): void {
    if (anchor.ownerDocument === owned.document && anchor.getAttribute('href') === owned.written) anchor.setAttribute('href', owned.original);
    this.links.delete(anchor);
  }

  private sameDestination(anchor: HTMLAnchorElement, owned: OwnedLink): boolean {
    try { return new URL(owned.original, anchor.baseURI).href === owned.resolved; } catch { return false; }
  }
}
