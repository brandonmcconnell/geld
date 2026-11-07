import { describe, expect, it } from 'vitest';
import { computeKerning, kerningClasses, kerningCollisions, resolvedValue } from './kerning';
import { buildMaster } from './master';

const STYLES = ['roman', 'italic'] as const;

describe('kerning', () => {
  for (const style of STYLES) {
    const classes = kerningClasses(buildMaster('sans', style, 400));
    for (const weight of [100, 400, 900] as const) {
      const master = buildMaster('sans', style, weight);
      const kerning = computeKerning(master, classes);
      it(`${style} ${weight}: kerns the pairs that need it and leaves straight and round sides alone`, () => {
        const value = (a: string, b: string) => resolvedValue(kerning, a, b);
        for (const [a, b] of [['H', 'H'], ['n', 'n'], ['o', 'o'], ['H', 'O'], ['n', 'o'], ['H', 'space'], ['E', 'space'], ['period', 'space'], ['quoteright', 'space'], ['space', 'H']]) expect(value(a!, b!), `${a}${b}`).toBe(0);
        for (const [a, b] of [['T', 'space'], ['Y', 'space'], ['L', 'space'], ['space', 'T'], ['space', 'V']]) expect(value(a!, b!), `${a} ${b}`).toBeLessThanOrEqual(-0.75);
        for (const [a, b] of [['T', 'o'], ['A', 'V'], ['L', 'T'], ['P', 'period'], ['Y', 'o'], ['quoteleft', 'A'], ['Ge-cy', 'o-cy']]) expect(value(a!, b!), `${a}${b}`).toBeLessThanOrEqual(-1);
      });
      it(`${style} ${weight}: keeps values on quarter units within ±2.5, and kerns no tabular figure or mark`, () => {
        for (const row of kerning.pairs.values())
          for (const v of row.values()) {
            expect(Math.abs(v * 4 - Math.round(v * 4))).toBeLessThan(1e-9);
            expect(Math.abs(v)).toBeLessThanOrEqual(2.5);
          }
        const grouped = [...kerning.groups.values()].flat();
        expect(grouped.filter((n) => /\.(tf|tosf)\b|comb(\.case)?$/.test(n))).toEqual([]);
      });
      it(`${style} ${weight}: brings no pair closer than the least gap, accents included`, () => {
        expect(kerningCollisions(master, kerning)).toEqual([]);
      }, 120_000);
    }
  }
});
