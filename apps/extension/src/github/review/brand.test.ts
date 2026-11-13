import { describe, expect, it } from 'vitest';
import { brandFit } from './brand';

describe('brandFit', () => {
  it.each([
    [1, 14],
    [1.25, 16.8],
    [1.5, 56 / 3],
    [1.75, 16],
    [2, 17.5],
    [2.5, 16.8],
    [3, 49 / 3],
  ])('at %sx draws the mark at %spx', (ratio, size) => {
    expect(brandFit(ratio).size).toBeCloseTo(size, 6);
  });

  it('puts every cell edge and the mark’s corner on whole device pixels', () => {
    for (const ratio of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4]) {
      const { size, shift } = brandFit(ratio);
      const cell = (size / 7) * ratio;
      expect(Math.abs(cell - Math.round(cell))).toBeLessThan(1e-9);
      const offset = shift * ratio;
      expect(Math.abs(offset - Math.round(offset))).toBeLessThan(1e-9);
      expect(Math.abs(shift + size / 2 - 8)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
    }
  });

  it('treats a missing ratio as 1x', () => {
    expect(brandFit(Number.NaN)).toEqual({ size: 14, shift: 1 });
    expect(brandFit(0)).toEqual({ size: 14, shift: 1 });
  });
});
