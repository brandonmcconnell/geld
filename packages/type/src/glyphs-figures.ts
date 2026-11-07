import { diagonal, type GlyphDef, inPen, shift } from './draw';
import { METRICS } from './grid';

/** Superiors and inferiors are the figures at this size, drawn a little lighter than scale alone would make them. */
const SMALL = 0.6;
const SMALL_PEN = 0.8;
/** Past SemiBold the small figures lighten further, as the lowercase does, so 6, 8 and 9 stay open at Black. */
export const smallPen = (v: number) => SMALL_PEN - Math.max(0, v - 2) * 0.14;
/** Superiors (and numerators) hang from the cap height; inferiors sit below the baseline. */
const SUPERIOR_RISE = METRICS.cap * (1 - SMALL);
const INFERIOR_DROP = -2;

const NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const SUPERSCRIPTS = [0x2070, 0xb9, 0xb2, 0xb3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079];

/** Superior, inferior and denominator figures derived from the figures, and the fraction slash that joins them. */
export function figureVariants(figures: GlyphDef[]): GlyphDef[] {
  const out: GlyphDef[] = [];
  const variant = (fig: GlyphDef, name: string, unicode: number | undefined, dy: number): GlyphDef => ({
    name,
    ...(unicode === undefined ? {} : { unicode }),
    lsb: fig.lsb * SMALL,
    rsb: fig.rsb * SMALL,
    draw: (g) => {
      const small = g.sub(METRICS.cap * SMALL, smallPen(g.v));
      return shift(inPen(small, fig.draw(small)), 0, dy);
    },
  });
  NAMES.forEach((name, i) => {
    const fig = figures.find((f) => f.name === name);
    if (!fig) return;
    out.push(variant(fig, `${name}superior`, SUPERSCRIPTS[i], SUPERIOR_RISE));
    out.push(variant(fig, `${name}inferior`, 0x2080 + i, INFERIOR_DROP));
    out.push(variant(fig, `${name}.dnom`, undefined, 0));
  });
  out.push({
    name: 'fraction',
    unicode: 0x2044,
    lsb: -1,
    rsb: -1,
    draw: (g) => [{ ...diagonal(g, 0, 0, 5.5, METRICS.cap), pen: { v: g.diag.v * SMALL_PEN, h: g.diag.h * SMALL_PEN } }],
  });
  return out;
}

/** Vulgar fractions as a superior, the fraction slash and a denominator, as `frac` would set them. */
export const FRACTIONS: [string, number, string, string][] = [
  ['onequarter', 0xbc, 'one', 'four'],
  ['onehalf', 0xbd, 'one', 'two'],
  ['threequarters', 0xbe, 'three', 'four'],
  ['onethird', 0x2153, 'one', 'three'],
  ['twothirds', 0x2154, 'two', 'three'],
  ['oneeighth', 0x215b, 'one', 'eight'],
  ['threeeighths', 0x215c, 'three', 'eight'],
  ['fiveeighths', 0x215d, 'five', 'eight'],
  ['seveneighths', 0x215e, 'seven', 'eight'],
];
