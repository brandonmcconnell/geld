// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_COUNTS_STAND_IN } from '../header-stats';
import { persistentBarStuck } from '../persistent-bar';
import { animateBarGroup, ghostBarDepartures, isGhost, leaveGhost, motionAllowed } from './bar-motion';

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

/** Every slide the block's script starts, the real animation and the translate it runs between. */
function watchSlides(): () => Slide[] {
  const spy = vi.spyOn(Element.prototype, 'animate');
  return () =>
    spy.mock.calls.flatMap(([frames], index) => {
      const animation = spy.mock.results[index]?.value;
      const element = spy.mock.contexts[index];
      const list = Array.isArray(frames) ? frames : [];
      if (!(animation instanceof Animation) || !(element instanceof Element)) return [];
      return [{ element, from: String(list[0]?.['translate']), to: String(list[1]?.['translate']), animation }];
    });
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

  it("clips the row at the block's resting left edge only while it slides, so nothing shows in the bar's padding", () => {
    const inner = bar(false);
    fakeLayout(inner);
    inner.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 48 });
    animateBarGroup();
    const slidesNow = watchSlides();
    stick(inner);
    inner.querySelector<HTMLElement>('[data-testid="mini-header-tab-switcher-trigger"]')!.getBoundingClientRect = () => DOMRect.fromRect({ x: 16, y: 0, width: 80, height: 32 });
    animateBarGroup();
    expect(inner.hasAttribute('data-geld-bar-clip')).toBe(true);
    expect(inner.style.getPropertyValue('--geld-bar-edge')).toBe('16px');
    slidesNow()[0]?.animation.dispatchEvent(new Event('finish'));
    expect(inner.hasAttribute('data-geld-bar-clip')).toBe(false);
    expect(inner.style.getPropertyValue('--geld-bar-edge')).toBe('');

    const entering = slidesNow().length;
    ghostBarDepartures(unstick());
    animateBarGroup();
    expect(inner.hasAttribute('data-geld-bar-clip')).toBe(true);
    slidesNow()[entering]?.animation.dispatchEvent(new Event('finish'));
    expect(inner.hasAttribute('data-geld-bar-clip')).toBe(false);
    expect(inner.querySelector('[data-geld-ghost]')).toBeNull();
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
