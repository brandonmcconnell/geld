// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_COUNTS_STAND_IN } from '../header-stats';
import { persistentBarStuck } from '../persistent-bar';
import { ghostBarDepartures, isGhost, leaveGhost, motionAllowed } from './bar-motion';

/** GitHub's bar over the new pull request page, stuck: its tab switcher, divider and state label on the left. */
function bar(): void {
  document.body.innerHTML = `
    <div data-testid="diff-comparison-viewer-sticky-header-slot" class="StickyHeaderSlotPersistent__x">
      <div data-testid="diff-comparison-viewer-sticky-header-bar"><div class="miniHeaderInner__x">
        <button data-testid="mini-header-tab-switcher-trigger" id="_r_8h_" type="button">Overview</button>
        <div class="divider__x navigationDivider__x" aria-hidden="true"></div>
        <div class="metadata__x"><span data-component="StateLabel" data-status="pullOpened">Open</span><span class="number__x">#1</span></div>
        <div class="actions__x"><span data-geld-counts-stand-in="0|0" id="counts">+0 −0</span><button type="button">Merge status</button></div>
      </div></div>
    </div>`;
}

/** What GitHub's React render does as the tabs come back into view, as the controller's observer reports it. */
function unstick(): MutationRecord[] {
  // Without the markup's whitespace, so no text node stands between the parts to anchor a ghost by.
  for (const node of document.querySelectorAll('[class*="miniHeaderInner"], [class*="metadata"]')) for (const text of [...node.childNodes]) if (text.nodeType === Node.TEXT_NODE) text.remove();
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.body, { childList: true, subtree: true });
  const inner = document.querySelector('[class*="miniHeaderInner"]')!;
  // In React's order: the later sibling first.
  inner.querySelector('[class*="navigationDivider"]')?.remove();
  inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')?.remove();
  inner.querySelector('[data-component="StateLabel"]')?.remove();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

describe('bar motion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('CSSStartingStyleRule', class {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('puts what GitHub dropped from its bar back as ghosts in their places, which never read as the bar still stuck', () => {
    bar();
    ghostBarDepartures(unstick());
    const inner = document.querySelector('[class*="miniHeaderInner"]')!;
    expect([...inner.children].map((child) => child.getAttribute('data-geld-ghost'))).toEqual(['left', 'left', null, null]);
    expect(inner.querySelector('[data-geld-ghost] [id], [data-geld-ghost][id]')).toBeNull();
    expect(persistentBarStuck()).toBe(false);
    // The switcher, which has content, goes whole in a box of Geld's; the empty divider is its own ghost.
    expect(inner.firstElementChild?.tagName).toBe('SPAN');
    expect(inner.firstElementChild?.firstElementChild?.tagName).toBe('BUTTON');
    expect(inner.children[1]?.className).toContain('navigationDivider');
    const label = inner.querySelector('[class*="metadata"]')!.firstElementChild!;
    expect(isGhost(label)).toBe(true);
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(label.firstElementChild?.getAttribute('data-component')).toBe('StateLabel');
    vi.advanceTimersByTime(400);
    expect(document.querySelector('[data-geld-ghost]')).toBeNull();
  });

  it('leaves a label Geld hides behind its pill alone: the pill leaves as a ghost of its own', () => {
    bar();
    document.querySelector('[data-component="StateLabel"]')!.setAttribute('data-geld-status-hidden', '');
    ghostBarDepartures(unstick());
    expect(document.querySelector('[class*="metadata"] [data-geld-ghost]')).toBeNull();
  });

  it("leaves a ghost of Geld's own counts in place, keeping the mark the stylesheet spaces it by", () => {
    bar();
    const counts = document.getElementById('counts')!;
    leaveGhost(counts, 'down');
    const ghost = counts.previousElementSibling!;
    expect(ghost.getAttribute('data-geld-ghost')).toBe('down');
    expect(ghost.hasAttribute('data-geld-counts-stand-in')).toBe(true);
    expect(ghost.hasAttribute('id')).toBe(false);
    expect(ghost.hasAttribute('data-geld-ui')).toBe(true);
    expect(document.querySelectorAll(LIVE_COUNTS_STAND_IN)).toHaveLength(1);
  });

  it('moves nothing out where entries do not slide in, or the reader asks for less motion', () => {
    bar();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    expect(motionAllowed()).toBe(false);
    ghostBarDepartures(unstick());
    expect(document.querySelector('[data-geld-ghost]')).toBeNull();
    vi.unstubAllGlobals();
    expect(motionAllowed()).toBe(false);
  });
});
