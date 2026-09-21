import { describe, expect, it } from 'vitest';
import { popupMaxHeight, popupNeedsScroll } from './popup-size';

describe('popupMaxHeight', () => {
  it('uses three quarters of the available display on shorter viewports', () => {
    expect(popupMaxHeight(720)).toBe(540);
    expect(popupMaxHeight(800)).toBe(600);
  });

  it('respects browser and usability bounds', () => {
    expect(popupMaxHeight(1440)).toBe(600);
    expect(popupMaxHeight(240)).toBe(240);
    expect(popupMaxHeight(Number.NaN)).toBe(600);
  });

  it('only enables scrolling when content exceeds the constrained height', () => {
    expect(popupNeedsScroll(500, 540)).toBe(false);
    expect(popupNeedsScroll(540.5, 540)).toBe(false);
    expect(popupNeedsScroll(542, 540)).toBe(true);
  });
});
