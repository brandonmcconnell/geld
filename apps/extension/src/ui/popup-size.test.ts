import { describe, expect, it } from 'vitest';
import { popupMaxHeight } from './popup-size';

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
});
