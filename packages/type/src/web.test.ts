import { describe, expect, it } from 'vitest';
import { buildMaster } from './master';
import { features } from './ufo';
import { fallbackFace, featureCss, fontFaceCss, SUBSETS, subsetsFor, SYMBOLS, unicodeRange, webFileName } from './web';

const BANDS: ('regular' | 'bold')[] = ['regular', 'bold'];
const roman = buildMaster('sans', 'roman', 400);
const italic = buildMaster('sans', 'italic', 400);
const codepoints = (master: typeof roman) => master.glyphs.flatMap((g) => (g.unicode === undefined ? [] : [g.unicode]));

describe('web subsets', () => {
  it('put every character in a subset, Latin in latin, and nothing else in symbols', () => {
    for (const master of [roman, italic]) {
      const subsets = subsetsFor(codepoints(master));
      expect(new Set(subsets.flatMap((s) => s.codepoints))).toEqual(new Set(codepoints(master)));
      expect(subsets.find((s) => s.name === 'latin')!.codepoints).toEqual(expect.arrayContaining([...'Az09'].map((c) => c.codePointAt(0)!)));
      const named = SUBSETS.flatMap((s) => s.ranges);
      for (const cp of subsets.find((s) => s.name === SYMBOLS)!.codepoints) expect(named.some(([from, to]) => cp >= from && cp <= to)).toBe(false);
    }
  });

  it('collapse runs in a unicode-range', () => {
    expect(unicodeRange([0x41, 0x42, 0x43, 0xc0, 0x2192, 0x2191])).toBe('U+0041-0043, U+00C0, U+2191-2192');
  });

  it('name each file by family, subset, weight and style, and serve each from one @font-face', () => {
    expect(webFileName('dark', 'latin-ext', 700, 'italic')).toBe('geld-dark-sans-latin-ext-700-italic.woff2');
    const subsets = { roman: subsetsFor(codepoints(roman)), italic: subsetsFor(codepoints(italic)) };
    const variable = fontFaceCss('sans', subsets, true, []);
    expect(variable.match(/@font-face/g)).toHaveLength(subsets.roman.length + subsets.italic.length);
    expect(variable).toContain('url("./geld-sans-latin-wght-normal.woff2")');
    expect(variable).toContain('font-weight: 100 900;');
    expect(fontFaceCss('sans', subsets, false, []).match(/@font-face/g)).toHaveLength(9 * (subsets.roman.length + subsets.italic.length));
  });
});

describe('web CSS', () => {
  it('has a class for every stylistic set and character variant the fonts define, and only those beside the named features', () => {
    const defined = new Set([roman, italic].flatMap((m) => [...features(m).matchAll(/^feature ((?:ss|cv)\d\d) \{/gm)].map((match) => match[1]!)));
    const classes = new Set([...featureCss().matchAll(/^\.geld-([a-z0-9]+) \{/gm)].map((match) => match[1]!));
    expect(new Set([...classes].filter((tag) => /^(ss|cv)\d\d$/.test(tag)))).toEqual(defined);
    for (const tag of ['dlig', 'hlig', 'salt', 'swsh', 'cswh']) expect(classes).toContain(tag);
  });

  it('sizes the fallback near Geld and gives it Geld’s 1.25 line box', () => {
    for (const master of [roman, italic])
      for (const band of BANDS) {
        const face = fallbackFace(master, band);
        const adjust = Number(/size-adjust: ([\d.]+)%/.exec(face)![1]);
        const ascent = Number(/ascent-override: ([\d.]+)%/.exec(face)![1]);
        const descent = Number(/descent-override: ([\d.]+)%/.exec(face)![1]);
        expect(adjust).toBeGreaterThan(85);
        expect(adjust).toBeLessThan(120);
        expect(((ascent + descent) * adjust) / 100 / 100).toBeCloseTo(1.25, 3);
      }
  });
});
