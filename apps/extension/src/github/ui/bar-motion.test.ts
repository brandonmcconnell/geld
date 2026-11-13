// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_COUNTS_STAND_IN } from '../header-stats';
import { persistentBarStuck } from '../persistent-bar';
import { animateBarGroup, ghostBarDepartures, isGhost, leaveGhost, motionAllowed, PAST_EDGE_ID } from './bar-motion';

const PARTS = `
  <button data-testid="mini-header-tab-switcher-trigger" id="_r_8h_" type="button">Overview</button>
  <div class="divider__x navigationDivider__x" aria-hidden="true"></div>`;
const LABEL = '<span data-component="StateLabel" data-status="pullOpened">Open</span>';

/** GitHub's bar over the new pull request page, stuck or not, written with no whitespace between its parts. */
function bar(stuck = true): HTMLElement {
  document.body.innerHTML = `
    <div data-testid="diff-comparison-viewer-sticky-header-slot" class="StickyHeaderSlotPersistent__x">
      <div data-testid="diff-comparison-viewer-sticky-header-bar"><div class="miniHeaderInner__x">${stuck ? PARTS : ''}<div class="metadata__x">${stuck ? LABEL : ''}<span class="number__x">#1</span><a class="title__x">Title</a></div><div class="actions__x"><span data-geld-counts-stand-in="0|0" id="counts">+0 −0</span><button type="button">Merge status</button></div></div></div>
    </div>`.replace(/>\s+</g, '><');
  return document.querySelector<HTMLElement>('[class*="miniHeaderInner"]')!;
}

function recording(change: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.body, { childList: true, subtree: true });
  change();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

/** What GitHub's React render does as the tabs come back into view: the later sibling first. */
function unstick(): MutationRecord[] {
  return recording(() => {
    const inner = document.querySelector('[class*="miniHeaderInner"]')!;
    inner.querySelector('[class*="navigationDivider"]')?.remove();
    inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')?.remove();
    inner.querySelector('[data-component="StateLabel"]')?.remove();
  });
}

function stick(inner: HTMLElement): void {
  const parts = document.createElement('template');
  parts.innerHTML = PARTS.replace(/>\s+</g, '><').trim();
  inner.prepend(parts.content);
  inner.querySelector('[class*="metadata"]')!.insertAdjacentHTML('afterbegin', LABEL);
}

/**
 * Layout as the block's script reads it: the number stands 100px further right for every part or ghost before it that
 * is not held out of the layout.
 */
function fakeLayout(inner: HTMLElement, sliding: { offset: number } = { offset: 0 }): void {
  const number = inner.querySelector<HTMLElement>('[class*="number"]')!;
  number.getBoundingClientRect = () => {
    const before = [...inner.querySelectorAll('[data-testid="mini-header-tab-switcher-trigger"], [class*="navigationDivider"], [data-component="StateLabel"], [data-geld-ghost="left"]')].filter((part) => !part.hasAttribute('data-geld-bar-hold'));
    // A running slide's translate shows in the box until the slide is cancelled.
    const moving = number.closest('[class*="metadata"]')!.getAnimations().some((animation) => animation.playState !== 'idle');
    return DOMRect.fromRect({ x: 16 + 100 * before.length + (moving ? sliding.offset : 0), y: 0, width: 20, height: 20 });
  };
}

interface Slide {
  readonly element: Element;
  readonly from: string;
  readonly to: string;
  readonly animation: Animation;
}

/** Every animation the block's script starts, the real animation and the translate it runs between. */
function watchAnimations(): () => (Slide & { readonly id: string })[] {
  const spy = vi.spyOn(Element.prototype, 'animate');
  return () =>
    spy.mock.calls.flatMap(([frames, options], index) => {
      const animation = spy.mock.results[index]?.value;
      const element = spy.mock.contexts[index];
      const list = Array.isArray(frames) ? frames : [];
      if (!(animation instanceof Animation) || !(element instanceof Element)) return [];
      const id = typeof options === 'object' ? (options.id ?? '') : '';
      return [{ element, from: String(list[0]?.['translate']), to: String(list[1]?.['translate']), animation, id }];
    });
}

/** The block's own slides, without the parts' carries past the viewport's edge. */
function watchSlides(): () => Slide[] {
  const all = watchAnimations();
  return () => all().filter((animation) => animation.id !== PAST_EDGE_ID);
}

function rightEdge(element: Element, right: number): void {
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: right - 40, y: 0, width: 40, height: 20 });
}

describe('bar motion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('CSSStartingStyleRule', class {});
    // Each test starts on a page whose bar the block's script has not seen.
    document.body.innerHTML = '';
    animateBarGroup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('puts what GitHub dropped from its bar back as ghosts in their places, which never read as the bar still stuck', () => {
    const inner = bar();
    ghostBarDepartures(unstick());
    expect([...inner.children].map((child) => child.getAttribute('data-geld-ghost'))).toEqual(['left', 'left', null, null]);
    expect(inner.firstElementChild?.tagName).toBe('BUTTON');
    expect(inner.firstElementChild?.getAttribute('data-geld-ghost-kind')).toBe('switcher');
    expect(inner.querySelector('[data-geld-ghost] [id], [data-geld-ghost][id]')).toBeNull();
    expect(persistentBarStuck()).toBe(false);
    const label = inner.querySelector('[class*="metadata"]')!.firstElementChild!;
    expect(isGhost(label)).toBe(true);
    expect(label.getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(700);
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

  it("slides the bar's whole left side in from where its title stood as the parts arrive", () => {
    const inner = bar(false);
    fakeLayout(inner);
    animateBarGroup();
    const slidesNow = watchSlides();
    stick(inner);
    animateBarGroup();
    const slides = slidesNow();
    // Three parts arrived before the number: the block starts 300px left, every piece of it on one offset.
    expect(slides.map((slide) => slide.element.className || slide.element.tagName)).toEqual(['BUTTON', 'divider__x navigationDivider__x', 'metadata__x']);
    expect(new Set(slides.map((slide) => `${slide.from} → ${slide.to}`))).toEqual(new Set(['-300px 0 → 0px 0']));
    expect(inner.querySelector('[data-geld-bar-hold]')).toBeNull();
  });

  it('carries the ghosts out with the block and drops them in the frame it lands', () => {
    const inner = bar();
    fakeLayout(inner);
    animateBarGroup();
    const slidesNow = watchSlides();
    ghostBarDepartures(unstick());
    animateBarGroup();
    const slides = slidesNow();
    expect(new Set(slides.map((slide) => `${slide.from} → ${slide.to}`))).toEqual(new Set(['0px 0 → -300px 0']));
    expect(slides).toHaveLength(3);
    expect(inner.querySelectorAll('[data-geld-ghost="left"]')).toHaveLength(3);
    slides[0]?.animation.dispatchEvent(new Event('finish'));
    expect(inner.querySelector('[data-geld-ghost]')).toBeNull();
  });

  it("carries the arriving and leaving parts past the row's edge, where the block alone left them in the bar's padding", async () => {
    const inner = bar(false);
    fakeLayout(inner);
    animateBarGroup();
    const all = watchAnimations();
    stick(inner);
    // The label ends 6px before the number, which rests at 16px: started 300px left, it would show from -100 to 10.
    rightEdge(inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')!, 96);
    rightEdge(inner.querySelector('[class*="navigationDivider"]')!, 110);
    rightEdge(inner.querySelector('[data-component="StateLabel"]')!, 310);
    animateBarGroup();
    const arriving = all().filter((animation) => animation.id === PAST_EDGE_ID);
    expect(arriving).toHaveLength(3);
    expect(new Set(arriving.map((animation) => `${animation.from} → ${animation.to}`))).toEqual(new Set(['-10px 0 → 0px 0']));
    // GitHub's metadata clips its overflow, and the label is carried out of its box on the left while it slides.
    const metadata = inner.querySelector('[class*="metadata"]')!;
    expect(metadata.hasAttribute('data-geld-bar-reach')).toBe(true);
    all()
      .find((animation) => animation.id !== PAST_EDGE_ID)
      ?.animation.dispatchEvent(new Event('finish'));

    const before = all().length;
    ghostBarDepartures(unstick());
    for (const ghost of inner.querySelectorAll('[data-geld-ghost="left"]')) rightEdge(ghost, ghost.getAttribute('data-geld-ghost-kind') === 'label' ? 310 : 100);
    animateBarGroup();
    const leaving = all()
      .slice(before)
      .filter((animation) => animation.id === PAST_EDGE_ID);
    expect(leaving.map((animation) => isGhost(animation.element))).toEqual([true, true, true]);
    expect(new Set(leaving.map((animation) => `${animation.from} → ${animation.to}`))).toEqual(new Set(['0px 0 → -10px 0']));
    expect(metadata.hasAttribute('data-geld-bar-reach')).toBe(true);
    for (const animation of all().filter((each) => each.id === PAST_EDGE_ID)) animation.animation.cancel();
    await Promise.resolve();
    await Promise.resolve();
    expect(metadata.hasAttribute('data-geld-bar-reach')).toBe(false);
  });

  it('hands a part GitHub replaces mid-slide the rest of its carry past the edge', () => {
    const inner = bar(false);
    fakeLayout(inner);
    animateBarGroup();
    const all = watchAnimations();
    stick(inner);
    rightEdge(inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')!, 96);
    rightEdge(inner.querySelector('[class*="navigationDivider"]')!, 110);
    rightEdge(inner.querySelector('[data-component="StateLabel"]')!, 310);
    animateBarGroup();
    const old = inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')!;
    const carry = all().find((animation) => animation.id === PAST_EDGE_ID && animation.element === old)!;
    vi.spyOn(carry.animation.effect!, 'getComputedTiming').mockReturnValue({ progress: 0.5 });
    const fresh = document.createElement('button');
    fresh.setAttribute('data-testid', 'mini-header-tab-switcher-trigger');
    ghostBarDepartures(recording(() => old.replaceWith(fresh)));
    animateBarGroup();
    const handed = all().filter((animation) => animation.id === PAST_EDGE_ID && animation.element === fresh);
    expect(handed.map((animation) => `${animation.from} → ${animation.to}`)).toEqual(['-5px 0 → 0px 0']);
    expect(carry.animation.playState).toBe('idle');
  });

  it('moves nothing when GitHub re-renders its bar with the same parts', () => {
    const inner = bar();
    fakeLayout(inner);
    animateBarGroup();
    const slidesNow = watchSlides();
    const records = recording(() => {
      unstick();
      stick(inner);
    });
    ghostBarDepartures(records);
    animateBarGroup();
    expect(slidesNow()).toHaveLength(0);
    expect(inner.querySelector('[data-geld-ghost]')).toBeNull();
  });

  it('takes a part GitHub replaces mid-slide along from where the slide has got to', () => {
    const inner = bar(false);
    const sliding = { offset: 0 };
    fakeLayout(inner, sliding);
    animateBarGroup();
    stick(inner);
    animateBarGroup();
    const slidesNow = watchSlides();
    sliding.offset = -120;
    const fresh = document.createElement('button');
    fresh.setAttribute('data-testid', 'mini-header-tab-switcher-trigger');
    ghostBarDepartures(recording(() => inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')!.replaceWith(fresh)));
    animateBarGroup();
    const slides = slidesNow();
    expect(slides.map((slide) => slide.element)).toContain(fresh);
    expect(new Set(slides.map((slide) => `${slide.from} → ${slide.to}`))).toEqual(new Set(['-120px 0 → 0px 0']));
    expect(inner.querySelector('[data-geld-ghost]')).toBeNull();
  });

  it('keeps a replacement still when the bar is at rest', () => {
    const inner = bar();
    fakeLayout(inner);
    animateBarGroup();
    const slidesNow = watchSlides();
    const fresh = document.createElement('button');
    fresh.setAttribute('data-testid', 'mini-header-tab-switcher-trigger');
    ghostBarDepartures(recording(() => inner.querySelector('[data-testid="mini-header-tab-switcher-trigger"]')!.replaceWith(fresh)));
    animateBarGroup();
    expect(slidesNow()).toHaveLength(0);
    expect(inner.querySelector('[data-geld-ghost]')).toBeNull();
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
