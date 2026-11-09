import { headingElementOf, headingLevelOf, hiddenBlocks, outlineOf } from '../ui/description-outline';
import type { OutlineHeading } from '../ui/description-outline';
import { element } from './dom';
import { svgFromString } from '../github/dom';
import { ICON_CHEVRON_DOWN } from '../github/ui/icons';
import './description.css';

const FOLD = 'data-geld-provider-description-hidden';
const CAP = 'data-geld-provider-description-capped';
interface Heading { readonly key: string; readonly block: Element; readonly label: string; readonly outline: OutlineHeading; readonly toggle: HTMLButtonElement }

export class ProviderDescription {
  private host: HTMLElement | null = null;
  private key = '';
  private readonly choices = new Map<string, boolean>();
  private expanded = false;
  private readonly folded = new Map<Element, string | null>();
  private headings: Heading[] = [];
  private blocks: Element[] = [];
  private more: HTMLButtonElement | null = null;
  private observer: ResizeObserver | null = null;
  private frame: number | null = null;

  update(host: HTMLElement | null, key: string): void {
    if (key !== this.key) { this.clear();this.choices.clear();this.expanded = false;this.key = key; }
    if (host !== this.host) {
      this.clear();this.host = host;
      if (host !== null) {
        host.addEventListener('beforematch', this.beforeMatch);
        host.addEventListener('load', this.schedule, true);
        host.addEventListener('toggle', this.detailsToggle, true);
        host.addEventListener('scroll', this.scrolled);
        window.addEventListener('resize', this.schedule);
        if (typeof ResizeObserver !== 'undefined') { this.observer = new ResizeObserver(this.schedule);this.observer.observe(host); }
      }
    }
    if (host === null) return;
    const blocks = [...host.children].filter((block) => !block.hasAttribute('data-geld-ui'));
    const levels = blocks.map((block) => this.label(block) === '' ? null : headingLevelOf(block));
    const outline = outlineOf(blocks, new Set(), levels);
    const counts = new Map<string, number>();
    const previous = this.headings;
    this.headings = outline.flatMap((entry) => {
      const block = blocks[entry.index];
      const heading = block === undefined ? null : headingElementOf(block);
      if (block === undefined || heading === null) return [];
      const label = this.label(block);
      const base = `${entry.level}:${label}`;const occurrence = counts.get(base) ?? 0;counts.set(base, occurrence + 1);
      const key = `${base}:${occurrence}`;
      const existing = previous.find((item) => item.block === block && item.key === key && item.toggle.parentElement === heading);
      const toggle = existing?.toggle ?? element('button', '', 'geld-provider-description-section');
      if (existing === undefined) {
        toggle.type = 'button';toggle.append(svgFromString(ICON_CHEVRON_DOWN));heading.prepend(toggle);
        toggle.addEventListener('click', () => { const item = this.headings.find((item) => item.toggle === toggle);if (item === undefined) return;this.choices.set(item.key, !this.open(item));this.apply(); });
      }
      return [{ key, block, label, outline: entry, toggle }];
    });
    for (const item of previous) if (!this.headings.some((next) => next.toggle === item.toggle)) item.toggle.remove();
    this.blocks = blocks;this.apply();
  }

  reveal(target: Element): void {
    if (this.host === null || !this.host.contains(target)) return;
    const index = this.blocks.findIndex((block) => block === target || block.contains(target));
    for (const item of this.headings) if (item.outline.index < index && index < item.outline.end) this.choices.set(item.key, true);
    this.expanded = true;this.apply();this.measure();
  }

  clear(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);this.frame = null;
    this.observer?.disconnect();this.observer = null;
    this.host?.removeEventListener('beforematch', this.beforeMatch);
    this.host?.removeEventListener('load', this.schedule, true);
    this.host?.removeEventListener('toggle', this.detailsToggle, true);
    this.host?.removeEventListener('scroll', this.scrolled);
    window.removeEventListener('resize', this.schedule);
    this.host?.removeAttribute(CAP);
    for (const item of this.headings) item.toggle.remove();this.headings = [];
    for (const block of [...this.folded.keys()]) this.restore(block);
    this.more?.remove();this.more = null;this.blocks = [];this.host = null;
  }

  private label(block: Element): string {
    const heading = headingElementOf(block);if (heading === null) return '';
    const copy = heading.cloneNode(true);if (!(copy instanceof Element)) return '';
    for (const extra of copy.querySelectorAll('[data-geld-ui], a.anchor')) extra.remove();
    return (copy.textContent ?? '').replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, ' ').trim();
  }

  private open(item: Heading): boolean { return this.choices.get(item.key) ?? (item.outline.index === 0 || item.outline.hasSubheadings); }

  private apply(): void {
    const hidden = hiddenBlocks(this.headings.map((item) => item.outline), (outline) => { const item = this.headings.find((item) => item.outline === outline);return item !== undefined && this.open(item); });
    this.blocks.forEach((block, index) => {
      if (hidden.has(index)) {
        if (!this.folded.has(block)) this.folded.set(block, block.getAttribute('hidden'));
        if (!block.hasAttribute('hidden')) block.setAttribute('hidden', 'until-found');
        if (!block.hasAttribute(FOLD)) block.setAttribute(FOLD, '');
      } else this.restore(block);
    });
    for (const block of [...this.folded.keys()]) if (!this.blocks.includes(block)) this.restore(block);
    for (const item of this.headings) {
      const open = this.open(item);
      item.toggle.setAttribute('aria-expanded', String(open));
      item.toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${item.label}`);
    }
    this.schedule();
  }

  private restore(block: Element): void {
    if (!this.folded.has(block)) return;
    const original = this.folded.get(block);
    if (block.getAttribute('hidden') === 'until-found') { if (original === null || original === undefined) block.removeAttribute('hidden');else block.setAttribute('hidden', original); }
    block.removeAttribute(FOLD);this.folded.delete(block);
  }

  private readonly beforeMatch = (event: Event): void => { if (event.target instanceof Element) this.reveal(event.target); };
  private readonly detailsToggle = (event: Event): void => { if (event.target instanceof HTMLDetailsElement && event.target.open) this.reveal(event.target); };
  private readonly scrolled = (): void => { if (this.host !== null && this.host.scrollTop > 0) { this.expanded = true;this.measure(); } };
  private readonly schedule = (): void => { if (this.frame === null) this.frame = requestAnimationFrame(() => { this.frame = null;this.measure(); }); };
  private measure(): void {
    const host = this.host;if (host === null || !host.isConnected) return;
    const long = host.scrollHeight > 580;
    if (long && this.more === null) {
      this.more = element('button', '', 'geld-provider-toggle geld-provider-description-toggle');this.more.type = 'button';
      this.more.addEventListener('click', () => { this.expanded = !this.expanded;host.removeAttribute(CAP);this.measure(); });host.after(this.more);
    }
    host.toggleAttribute(CAP, long && !this.expanded);
    if (this.more !== null) {
      this.more.hidden = !long;this.more.textContent = this.expanded ? 'Collapse description' : 'Show full description';this.more.setAttribute('aria-expanded', String(this.expanded));
    }
  }
}
