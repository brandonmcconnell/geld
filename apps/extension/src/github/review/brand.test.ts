import { describe, expect, it } from 'vitest';
import logomark from '../../../../../assets/brand/geld-logomark.svg?raw';
import { DIGEST_EMBLEMS, emblemFit } from './brand';

const whole = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-9;
const pathOf = (svg: string): string => /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';

describe('digest emblems', () => {
  it('draws every edge on whole units inside its viewBox', () => {
    for (const art of DIGEST_EMBLEMS) {
      expect(art.width).toBeGreaterThan(0);
      const numbers = pathOf(art.svg).match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      expect(numbers.length).toBeGreaterThan(20);
      for (const n of numbers) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(Math.max(art.width, art.height));
      }
    }
  });

  it('is the logomark itself at 1.5x', () => {
    const art = DIGEST_EMBLEMS.find((candidate) => candidate.ratio === 1.5);
    expect(art && pathOf(art.svg)).toBe(pathOf(logomark));
  });
});

describe('emblemFit', () => {
  it('shows each drawing at its own ratio, one device pixel per unit, near 18px', () => {
    for (const art of DIGEST_EMBLEMS) {
      const fit = emblemFit(art.ratio);
      expect(fit.art).toBe(art);
      expect(fit.width).toBeCloseTo(art.width / art.ratio, 9);
      expect(fit.height).toBeCloseTo(art.height / art.ratio, 9);
      expect(Math.abs(fit.height - 18)).toBeLessThanOrEqual(1.4);
    }
  });

  it('keeps any ratio sharp and on whole device pixels, as near centred as that allows', () => {
    for (let ratio = 0.9; ratio <= 4.3; ratio += 0.05) {
      const fit = emblemFit(ratio);
      expect(whole(fit.width * ratio) && whole(fit.height * ratio)).toBe(true);
      expect(whole(fit.left * ratio) && whole(fit.top * ratio)).toBe(true);
      expect(Math.abs(fit.left + fit.width / 2 - 8)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
      expect(Math.abs(fit.top + fit.height / 2 - 8)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
      expect(Math.abs(fit.height - 18)).toBeLessThanOrEqual(2.5);
    }
  });

  it('centres the 18px drawing exactly at 1x', () => {
    expect(emblemFit(1)).toMatchObject({ width: 18, height: 18, left: -1, top: -1 });
  });

  it('scales the nearest drawing to 18px when none fits, as zoomed far out', () => {
    const fit = emblemFit(0.5);
    expect(fit.height).toBe(18);
    expect(fit.top).toBe(-1);
  });

  it('treats a missing ratio as 1x', () => {
    expect(emblemFit(Number.NaN).art.ratio).toBe(1);
  });
});
