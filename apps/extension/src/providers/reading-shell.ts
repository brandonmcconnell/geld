import { digestIcon } from './digest-icons';
import { element } from './dom';

/** How far the bar stands after `ms` of reading: quick at first, then slower, never full until the review lands. */
export function readingProgress(ms: number): number {
  return 0.9 * (1 - Math.exp(-Math.max(0, ms) / 2500));
}

/**
 * The digest's own Geld bar while the review is read, standing where the digest will: the emblem and "Geld", what it is
 * doing, and a thin bar along its top edge, as GitHub's digest shows while it reads the timeline. It is replaced by
 * the digest when the review lands, or says why when it cannot be read.
 */
export class ProviderReadingShell {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly words: HTMLElement;
  private readonly started = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(doc: Document) {
    this.element = element('section', '', 'geld-provider-review-shell');
    this.element.dataset.state = 'reading';
    this.element.setAttribute('aria-label', 'Geld review digest');
    this.element.setAttribute('aria-busy', 'true');
    const bar = element('div', '', 'geld-provider-review__reading');
    bar.setAttribute('aria-hidden', 'true');
    this.fill = element('div', '', 'geld-provider-review__reading-fill');
    bar.append(this.fill);
    const header = element('div', '', 'geld-provider-review__header');
    const brand = element('div', '', 'geld-provider-review__brand');
    brand.append(digestIcon('geld', doc), element('h2', 'Geld'));
    this.words = element('span', 'Reading the review…', 'geld-provider-review__muted');
    this.words.setAttribute('role', 'status');
    header.append(brand, this.words);
    this.element.append(bar, header);
    this.tick();
    this.timer = setInterval(() => this.tick(), 250);
  }

  /** The read failed: the bar goes, the words say why, and the host's own timeline stands. */
  failed(message: string): void {
    this.stop();
    this.element.removeAttribute('aria-busy');
    this.element.dataset.state = 'unavailable';
    this.fill.style.setProperty('--geld-progress', '0');
    const words = `Review unavailable: ${message}`;
    if (this.words.textContent !== words) this.words.textContent = words;
  }

  reading(): void {
    if (this.timer === null) {
      this.element.dataset.state = 'reading';
      this.element.setAttribute('aria-busy', 'true');
      if (this.words.textContent !== 'Reading the review…') this.words.textContent = 'Reading the review…';
      this.timer = setInterval(() => this.tick(), 250);
    }
  }

  remove(): void {
    this.stop();
    this.element.remove();
  }

  private tick(): void {
    this.fill.style.setProperty('--geld-progress', readingProgress(Date.now() - this.started).toFixed(3));
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
