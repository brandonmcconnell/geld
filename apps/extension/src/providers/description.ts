import type { ProviderAgentNote } from './agent-notes';
import { headingElementOf, headingLevelOf, hiddenBlocks, outlineOf, railsOf } from '../ui/description-outline';
import type { OutlineHeading } from '../ui/description-outline';
import { element } from './dom';
import { svgFromString } from '../github/dom';
import { ICON_CHEVRON_DOWN } from '../github/ui/icons';
import './description.css';

const FOLD = 'data-geld-provider-description-hidden';
const DEPTH = 'data-geld-provider-description-depth';
const RAIL_PROPERTIES = ['depth', 'rails', 'positions', 'sizes', 'gap', 'edge'].map(name => `--geld-provider-description-${name}`);
const CAP = 'data-geld-provider-description-capped';
function property(block: HTMLElement, name: string, value: string): void { if (block.style.getPropertyValue(name) !== value) block.style.setProperty(name, value); }
interface Heading { readonly key: string; readonly block: Element; readonly label: string; readonly outline: OutlineHeading; readonly toggle: HTMLButtonElement }

export class ProviderDescription {
  private host: HTMLElement | null = null;
  private key = '';
  private readonly choices = new Map<string, boolean>();
  private expanded = false;
  private tools = new Map<Element, string>();
  private toolsAway = false;
  private shorten = true;
  private readonly shownTools = new Set<string>();
  private readonly folded = new Map<Element, string | null>();
  private headings: Heading[] = [];
  private blocks: Element[] = [];
  private more: HTMLButtonElement | null = null;
  private observer: ResizeObserver | null = null;
  private frame: number | null = null;

  update(host: HTMLElement | null, key: string, notes: readonly ProviderAgentNote[] = [], toolsAway = false, shorten = true): void {
    if (key !== this.key) { this.clear();this.choices.clear();this.shownTools.clear();this.expanded = false;this.key = key; }
    if (host !== this.host) {
      this.clear();this.host = host;
      if (host !== null) {
        host.addEventListener('beforematch', this.beforeMatch);
        host.addEventListener('click', this.clicked);
        host.addEventListener('load', this.schedule, true);
        host.addEventListener('toggle', this.detailsToggle, true);
        host.addEventListener('scroll', this.scrolled);
        window.addEventListener('resize', this.schedule);
        if (typeof ResizeObserver !== 'undefined') { this.observer = new ResizeObserver(this.schedule);this.observer.observe(host); }
      }
    }
    if (host === null) return;
    this.tools = new Map(notes.flatMap(note => note.blocks.map(block => [block, note.id] as const)));this.toolsAway = toolsAway;this.shorten = shorten;
    const blocks = [...host.children].filter((block) => !block.hasAttribute('data-geld-ui'));
    const levels = blocks.map((block) => !shorten || this.tools.has(block) || this.label(block) === '' ? null : headingLevelOf(block));
    const resets = new Set(blocks.flatMap((block, index) => this.tools.has(block) !== this.tools.has(blocks[index - 1] ?? block) ? [index] : []));
    const outline = outlineOf(blocks, resets, levels);
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
        heading.setAttribute('data-geld-provider-description-heading', '');
      }
      return [{ key, block, label, outline: entry, toggle }];
    });
    for (const item of previous) if (!this.headings.some((next) => next.toggle === item.toggle)) this.removeHeading(item);
    for (const block of this.blocks) if (!blocks.includes(block)) this.clearRails(block);
    this.blocks = blocks;this.apply();
  }

  reveal(target: Element): void {
    if (this.host === null || !this.host.contains(target)) return;
    const index = this.blocks.findIndex((block) => block === target || block.contains(target));
    for (const item of this.headings) if (item.outline.index < index && index < item.outline.end) this.choices.set(item.key, true);
    const block = this.blocks[index];const tool = block === undefined ? undefined : this.tools.get(block);if (tool !== undefined) this.shownTools.add(tool);
    this.expanded = true;this.apply();this.measure();
  }

  clear(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);this.frame = null;
    this.observer?.disconnect();this.observer = null;
    this.host?.removeEventListener('beforematch', this.beforeMatch);
    this.host?.removeEventListener('click', this.clicked);
    this.host?.removeEventListener('load', this.schedule, true);
    this.host?.removeEventListener('toggle', this.detailsToggle, true);
    this.host?.removeEventListener('scroll', this.scrolled);
    window.removeEventListener('resize', this.schedule);
    this.host?.removeAttribute(CAP);
    for (const item of this.headings) this.removeHeading(item);this.headings = [];
    for (const block of this.blocks) this.clearRails(block);
    for (const block of [...this.folded.keys()]) this.restore(block);
    this.more?.remove();this.more = null;this.blocks = [];this.host = null;
  }

  private removeHeading(item: Heading): void { item.toggle.parentElement?.removeAttribute('data-geld-provider-description-heading');item.toggle.remove(); }

  private clearRails(block: Element): void {
    block.removeAttribute(DEPTH);
    if (block instanceof HTMLElement) for (const name of RAIL_PROPERTIES) block.style.removeProperty(name);
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
      const tool = this.tools.get(block);
      if (hidden.has(index) || tool !== undefined && this.toolsAway && !this.shownTools.has(tool)) {
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
    const rails = railsOf(this.blocks.length, this.headings.map(item => item.outline), hidden, outline => this.headings.some(item => item.outline === outline && this.open(item)));
    this.blocks.forEach((block, index) => {
      const value = rails.get(index);
      if (!(block instanceof HTMLElement) || value === undefined) { this.clearRails(block);return; }
      if (block.getAttribute(DEPTH) !== String(value.depth)) block.setAttribute(DEPTH, String(value.depth));
      property(block, '--geld-provider-description-depth', String(value.depth));
      property(block, '--geld-provider-description-rails', value.rails.map(() => 'linear-gradient(var(--geld-provider-border), var(--geld-provider-border))').join(', '));
      property(block, '--geld-provider-description-positions', value.rails.map(rail => `${rail.level * 28 + 11.5}px ${rail.kind === 'own' ? '1em' : '0'}`).join(', '));
      property(block, '--geld-provider-description-sizes', value.rails.map(rail => rail.kind === 'through' ? '1px 100%' : rail.kind === 'own' ? '1px calc(100% - 1em)' : '1px calc(100% - var(--geld-provider-description-gap) - 1px)').join(', '));
    });
    this.schedule();
  }

  private restore(block: Element): void {
    if (!this.folded.has(block)) return;
    const original = this.folded.get(block);
    if (block.getAttribute('hidden') === 'until-found') { if (original === null || original === undefined) block.removeAttribute('hidden');else block.setAttribute('hidden', original); }
    block.removeAttribute(FOLD);this.folded.delete(block);
  }

  private readonly clicked = (event: MouseEvent): void => {
    if (!(event.target instanceof Element) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || this.host?.ownerDocument.getSelection()?.toString()) return;
    const item = this.headings.find(item => headingElementOf(item.block)?.contains(event.target instanceof Node ? event.target : null));
    if (item !== undefined && (item.toggle.contains(event.target) || event.target.closest('a, button, input, select, textarea, [contenteditable]') === null)) {
      this.choices.set(item.key, !this.open(item));this.expanded = true;this.apply();this.measure();
    } else if (event.target.closest('summary') !== null) { this.expanded = true;this.measure(); }
  };

  private readonly beforeMatch = (event: Event): void => { if (event.target instanceof Element) this.reveal(event.target); };
  private readonly detailsToggle = (event: Event): void => { if (event.target instanceof HTMLDetailsElement) this.reveal(event.target); };
  private readonly scrolled = (): void => { if (this.host !== null && this.host.scrollTop > 0) { this.expanded = true;this.measure(); } };
  private readonly schedule = (): void => { if (this.frame === null) this.frame = requestAnimationFrame(() => { this.frame = null;this.measure(); }); };
  private measure(): void {
    const host = this.host;if (host === null || !host.isConnected) return;
    const visible = this.blocks.filter(block => !block.hasAttribute('hidden'));
    visible.forEach((block, index) => {
      if (!(block instanceof HTMLElement) || !block.hasAttribute(DEPTH)) return;
      const next = visible[index + 1];
      const gap = next === undefined ? 0 : Math.max(0, next.getBoundingClientRect().top - block.getBoundingClientRect().bottom);
      property(block, '--geld-provider-description-gap', `${gap}px`);
      property(block, '--geld-provider-description-edge', getComputedStyle(block).borderLeftWidth || '0px');
    });
    const long = this.shorten && (this.toolsAway || this.tools.size === 0) && host.scrollHeight > 580;
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
