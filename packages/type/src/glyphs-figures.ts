import { diagonal, dot, type DrawContext, type GlyphDef, inPen, level, open, p, shift, SMALL_CAP_BREADTH, withPen } from './draw';
import type { Stroke } from './geometry';
import { METRICS } from './grid';

/** Superiors and inferiors are the figures at this size, drawn a little lighter than scale alone would make them. */
const SMALL = 0.6;
const SMALL_PEN = 0.8;
/** Past SemiBold the small figures lighten further, as the lowercase does, so 6, 8 and 9 stay open at Black. */
export const smallPen = (v: number) => SMALL_PEN - Math.max(0, v - 2) * 0.14;
/** Superiors (and numerators) hang from the cap height; inferiors sit below the baseline. */
const SUPERIOR_RISE = METRICS.cap * (1 - SMALL);
const INFERIOR_DROP = -2;

/** A letter as a modifier letter or superscript: drawn at the superior figures' size and hung from the same height; `lighten` thins letters with two counters as the ordinals are. */
export function superiorOf(def: GlyphDef, name: string, unicode: number, lower = true, lighten = 1): GlyphDef {
  return {
    name,
    unicode,
    lsb: Math.max(0.5, def.lsb * SMALL),
    rsb: Math.max(0.5, def.rsb * SMALL),
    draw: (g) => {
      const small = g.sub(METRICS.cap * SMALL, smallPen(g.v) * lighten, lower);
      return shift(inPen(small, def.draw(small)), 0, SUPERIOR_RISE);
    },
  };
}

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

/** Vulgar fractions as a superior, the fraction slash and a denominator (figures separated by spaces), as `frac` would set them. */
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
  ['oneseventh', 0x2150, 'one', 'seven'],
  ['oneninth', 0x2151, 'one', 'nine'],
  ['onetenth', 0x2152, 'one', 'one zero'],
  ['onefifth', 0x2155, 'one', 'five'],
  ['twofifths', 0x2156, 'two', 'five'],
  ['threefifths', 0x2157, 'three', 'five'],
  ['fourfifths', 0x2158, 'four', 'five'],
  ['onesixth', 0x2159, 'one', 'six'],
  ['fivesixths', 0x215a, 'five', 'six'],
  ['zerothirds', 0x2189, 'zero', 'three'],
];

export const FIGURE_NAMES = NAMES;

/** Oldstyle figures: 0 1 2 stand on the x-height, 6 and 8 rise to the cap height, and 3 4 5 7 9 hang below the baseline by as much. */
const OLDSTYLE_SMALL = new Set(['zero', 'one', 'two']);
const OLDSTYLE_DOWN = new Set(['three', 'four', 'five', 'seven', 'nine']);
const DESCENT = METRICS.cap - METRICS.xHeight;

function oldstyle(draw: GlyphDef['draw'], figure: string): Pick<GlyphDef, 'draw' | 'zone'> {
  if (OLDSTYLE_SMALL.has(figure))
    return {
      draw: (g) => {
        const small = g.sub(METRICS.xHeight, 1, false, SMALL_CAP_BREADTH);
        return inPen(small, draw(small));
      },
      zone: [0, METRICS.xHeight],
    };
  if (OLDSTYLE_DOWN.has(figure)) return { draw: (g) => shift(draw(g), 0, -DESCENT), zone: [-DESCENT, METRICS.xHeight] };
  return { draw, zone: [0, METRICS.cap] };
}

/** The slash and the dot of the alternate zeros, sized to the counter so neither crowds it at Black. */
function zeroMark(g: DrawContext, kind: 'slash' | 'dot'): Stroke[] {
  const w = g.wide(9);
  const counter = w - g.v;
  if (kind === 'dot') {
    const size = Math.max(0.6, Math.min(g.dot, counter - 3.4, g.cap - 2 * g.h - 3.4));
    return [dot({ ...g, dot: size }, w / 2, g.cap / 2 - size / 2)];
  }
  const dx = Math.max(1, (counter - 3.2) * 0.55);
  const dy = Math.min(dx * 1.8, g.cap - g.h * 2 - 3.2);
  return [withPen(level(open(p(w / 2 - dx / 2, g.cap / 2 - dy / 2), p(w / 2 + dx / 2, g.cap / 2 + dy / 2))), g.diag)];
}

/** Every figure set: tabular (`.tf`), proportional and tabular oldstyle (`.osf`, `.tosf`), and the slashed (`.zero`) and dotted (`.dot`) zeros in each. */
export function figureSets(figures: GlyphDef[]): GlyphDef[] {
  const zero = figures.find((f) => f.name === 'zero')!;
  const zeros: [string, GlyphDef['draw']][] = [
    ['zero', (g) => [...zero.draw(g), ...zeroMark(g, 'slash')]],
    ['dot', (g) => [...zero.draw(g), ...zeroMark(g, 'dot')]],
  ];
  const out: GlyphDef[] = [];
  const sets = (base: string, figure: string, stands: number, lsb: number, rsb: number, draw: GlyphDef['draw'], suffix = '') => {
    const variant = suffix ? `.${suffix}` : '';
    if (suffix) out.push({ name: `${base}${variant}`, stands, lsb, rsb, draw });
    out.push({ name: `${base}.tf${variant}`, stands, lsb, rsb, tabular: true, draw });
    const osf = oldstyle(draw, figure);
    out.push({ name: `${base}.osf${variant}`, stands, lsb, rsb, ...osf });
    out.push({ name: `${base}.tosf${variant}`, stands, lsb, rsb, tabular: true, draw: osf.draw });
  };
  for (const name of NAMES) {
    const fig = figures.find((f) => f.name === name);
    if (fig) sets(name, name, fig.unicode!, fig.lsb, fig.rsb, fig.draw);
  }
  for (const [suffix, draw] of zeros) sets('zero', 'zero', 0x30, zero.lsb, zero.rsb, draw, suffix);
  return out;
}

/** Signs that take the tabular width under `tnum`, so columns of prices and sums line up; the number condenses those wider than a figure (same stroke, less width). */
export const TABULAR_SIGNS: Record<string, number> = {
  dollar: 1,
  cent: 1,
  sterling: 1,
  currency: 1,
  yen: 0.95,
  Euro: 0.88,
  rupeeindian: 1,
  ruble: 0.97,
  lira: 1,
  hryvnia: 0.97,
  naira: 0.9,
  peso: 0.97,
  dong: 1,
  sheqel: 0.9,
  colonmonetary: 1,
  tenge: 1,
  manat: 1,
  lari: 1,
  bitcoin: 1,
  cedi: 1,
  guarani: 1,
  kip: 1,
  tugrik: 1,
  won: 0.7,
  baht: 1,
  percent: 0.9,
};

export function tabularSigns(defs: GlyphDef[]): GlyphDef[] {
  return Object.entries(TABULAR_SIGNS).flatMap(([name, squeeze]) => {
    const def = defs.find((d) => d.name === name);
    if (!def) return [];
    const { unicode: _unicode, italic: _italic, ...rest } = def;
    return [{ ...rest, name: `${name}.tf`, tabular: true, draw: (g: DrawContext) => def.draw(squeeze === 1 ? g : { ...g, wide: (n) => g.wide(n * squeeze) }) }];
  });
}

/** Superior and inferior signs that go with the figures under `sups`, `subs` and `sinf`: + − = ( ) and, unencoded, . and ,. */
const SIGN_SCRIPTS: [string, number | undefined, number | undefined][] = [
  ['plus', 0x207a, 0x208a],
  ['minus', 0x207b, 0x208b],
  ['equal', 0x207c, 0x208c],
  ['parenleft', 0x207d, 0x208d],
  ['parenright', 0x207e, 0x208e],
  ['period', undefined, undefined],
  ['comma', undefined, undefined],
];

export function signScripts(defs: GlyphDef[]): GlyphDef[] {
  return SIGN_SCRIPTS.flatMap(([name, up, down]) => {
    const def = defs.find((d) => d.name === name);
    if (!def) return [];
    const make = (suffix: string, unicode: number | undefined, dy: number): GlyphDef => ({
      name: `${name}${suffix}`,
      ...(unicode === undefined ? {} : { unicode }),
      lsb: def.lsb * SMALL,
      rsb: def.rsb * SMALL,
      draw: (g) => {
        const small = g.sub(METRICS.cap * SMALL, smallPen(g.v));
        return shift(inPen(small, def.draw(small)), 0, dy);
      },
    });
    return [make('superior', up, SUPERIOR_RISE), make('inferior', down, INFERIOR_DROP)];
  });
}
