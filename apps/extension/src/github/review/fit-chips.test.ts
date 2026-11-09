// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fitChips, stopFittingChips } from './fit-chips';
import { ATTR_FIT_TOOLS } from './panel';

/** A browser reports an observed element's size in the first frame after `observe`; this one reports it at once. */
class ReportingObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    const entry = { target, contentRect: new DOMRect(0, 0, 600, 100), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] };
    this.callback([entry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ReportingObserver);
});

/** A Geld row whose summary and tools are `summary` and `tools` (words) or `toolsIcons` (marks alone) wide. */
function geldRow(roomWidth: number, summary: number, tools: number, toolsIcons: number): HTMLElement {
  document.body.innerHTML = `
    <section class="geld-review">
      <div class="geld-review__head" ${ATTR_FIT_TOOLS}="" style="column-gap: 12px; padding-left: 16px; padding-right: 8px">
        <div class="geld-review__summary"></div>
        <div class="geld-review__tools"></div>
      </div>
    </section>`;
  const head = document.querySelector<HTMLElement>('.geld-review__head');
  const summaryEl = document.querySelector<HTMLElement>('.geld-review__summary');
  const toolsEl = document.querySelector<HTMLElement>('.geld-review__tools');
  if (head === null || summaryEl === null || toolsEl === null) throw new Error('fixture');
  Object.defineProperty(head, 'clientWidth', { value: roomWidth + 24 });
  const box = (width: number): DOMRect => new DOMRect(0, 0, width, 28);
  summaryEl.getBoundingClientRect = () => box(summary);
  toolsEl.getBoundingClientRect = () => box(head.getAttribute(ATTR_FIT_TOOLS) === 'icons' ? toolsIcons : tools);
  return head;
}

describe('Geld row fitting', () => {
  afterEach(() => stopFittingChips());

  it('keeps the words when everything fits on one line', () => {
    const head = geldRow(600, 300, 280, 140);
    fitChips(document.querySelector<HTMLElement>('.geld-review') ?? head);
    expect(head.getAttribute(ATTR_FIT_TOOLS)).toBe('');
  });

  it('drops to marks alone when the words would wrap', () => {
    const head = geldRow(600, 300, 300, 140);
    fitChips(document.querySelector<HTMLElement>('.geld-review') ?? head);
    expect(head.getAttribute(ATTR_FIT_TOOLS)).toBe('icons');
  });

  it('counts the gap and leaves out the padding', () => {
    // 300 + 12 + 288 = 600 fits a 600px content box exactly; the 24px of padding is not room.
    const fits = geldRow(600, 300, 288, 140);
    fitChips(document.querySelector<HTMLElement>('.geld-review') ?? fits);
    expect(fits.getAttribute(ATTR_FIT_TOOLS)).toBe('');
    const over = geldRow(600, 300, 290, 140);
    fitChips(document.querySelector<HTMLElement>('.geld-review') ?? over);
    expect(over.getAttribute(ATTR_FIT_TOOLS)).toBe('icons');
  });
});
