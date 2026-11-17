// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHold, releaseHold } from './hold';
import { keepInPlace } from './row-scroll';

const sticky = vi.hoisted(() => ({ bottom: 0 }));
vi.mock('./sticky', () => ({ stickyHeaderBottomAt: () => sticky.bottom }));

const KEY = 'main:item:a';
/** The row's viewport top, as the layout would report it after each step. */
let rowTop = 0;

function row(): HTMLElement {
  document.body.innerHTML = `<ul><li><button data-geld-focus="${KEY}">Round 2</button></li></ul>`;
  const button = document.querySelector<HTMLElement>(`[data-geld-focus="${KEY}"]`);
  if (button === null) throw new Error('fixture');
  button.getBoundingClientRect = () => new DOMRect(0, rowTop, 900, 40);
  return button;
}

let scrollBy: ReturnType<typeof vi.spyOn>;
let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sticky.bottom = 0;
  rowTop = 0;
  Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true });
  scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  releaseHold();
  vi.restoreAllMocks();
});

describe('keepInPlace', () => {
  it('leaves the page alone when the row is still on screen, however far the toggle moved it', () => {
    row();
    rowTop = 600;
    keepInPlace(KEY, () => {
      rowTop = 200;
    });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('brings a row a tall row above carried off the top back to the top edge', () => {
    row();
    rowTop = 400;
    keepInPlace(KEY, () => {
      rowTop = -300;
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 - 300 - 8, behavior: 'instant' });
  });

  it('brings a row that lands under the sticky header just below it', () => {
    sticky.bottom = 60;
    row();
    rowTop = 400;
    keepInPlace(KEY, () => {
      rowTop = 30;
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 30 - 60 - 8, behavior: 'instant' });
  });

  it('keeps the row where it landed when content arrives above it afterwards', () => {
    row();
    rowTop = 600;
    keepInPlace(KEY, () => {
      rowTop = 200;
    });
    rowTop = 450;
    applyHold();
    expect(scrollBy).toHaveBeenCalledWith({ top: 250, behavior: 'instant' });
  });

  it('does nothing when the toggle took the row away', () => {
    row();
    keepInPlace(KEY, () => {
      document.body.innerHTML = '';
    });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
