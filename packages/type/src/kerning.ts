import type { Contour } from './geometry';
import { flatten, type Master, type MasterGlyph } from './master';
import { ITALIC_SLOPE } from './grid';

/**
 * Kerning, measured the way the spacing is (spacing.ts): two glyphs side by side are read in thin
 * rows across the height where both have ink, and the white between them, each side's share capped
 * at a depth, is compared with the white between two straight stems of the same cases. Kerning
 * takes back part of any excess (T o, A V, L ’) and never brings any part of the two closer than
 * MIN_GAP, accents included: a group pair that would bring one of its members too close gets an
 * exception for that member (Ť ě, ľ ť).
 */

/** Rows are this tall, on one grid shared by every glyph so their profiles line up. */
const ROW = 0.25;
const BOTTOM = -6;
const TOP = 24;
const ROWS = Math.round((TOP - BOTTOM) / ROW);

/** How much of the excess white kerning takes back. */
const STRENGTH = 0.7;
/** How much of a pair's closest approach beyond its usual white kerning takes back. */
const GAP_STRENGTH = 0.5;
/** How deep each side's white counts, by case: deeper than the spacing's, since an open shape's neighbour does move into it. */
const DEPTH = { upper: 5, lower: 4, other: 4 } as const;
/** The rows a glyph's own white is read over: the spacing's zones for letters and figures, a sign's own ink otherwise. */
const ZONE = { upper: [0, 14], lower: [0, 10], figure: [0, 14] } as const;
/**
 * A letter's or figure's norm is the white the spacing aims every side at (master.ts, spacingZone):
 * where the spacing could not get there (A V T hold its least sidebearing), the excess is kerning's to take back.
 */
const SPACING_TARGET = { upper: 1.6, lower: 1.45, figure: 1.3 } as const;
/** No part of a kerned pair comes closer than this. */
export const MIN_GAP = 0.9;
/** Where a mark is one of the two (rows outside its letter's own height), the least gap is this: an acute may come nearer a bar than a stem may. */
export const MIN_MARK_GAP = 0.4;
/** Values are kept in quarter grid units (12.5 font units), and smaller ones than this are left out. */
const QUANTUM = 0.25;
const LEAST = 0.75;
/** Ink this near a glyph's own side may meet its neighbour's unkerned. */
const OVERHANG_READ = 0.05;
/** Letters whose sides are this close in every row share a kerning class. */
const SAME = 0.3;
/** The most any pair is kerned: LT and L’ are kerned no further than T o. */
const MOST = 2.5;
/** How much of an open side's white a word space beside it gives back, and at most: the space is 5 units, and between two open sides (VAT TAYLOR) it keeps 70%. */
const SPACE_STRENGTH = 0.25;
const SPACE_MOST = 0.75;


type Case = keyof typeof DEPTH;

/** Where a glyph's ink starts and ends in each row, from its origin; null where the row has none. */
interface Profile {
  name: string;
  advance: number;
  kind: Case;
  /** Letters and figures kern with signs and each other; signs (punctuation) only with letters and figures. */
  sign: boolean;
  script: string | undefined;
  left: (number | null)[];
  right: (number | null)[];
  /** The glyph's usual white on each side, averaged over its own zone: what a neighbour sees of it where nothing stands out. */
  own: { left: number; right: number };
  /** Rows its marks fill, outside the height of the letter it is built on. */
  mark: boolean[];
}

export interface Kerning {
  /** public.kern1.* (a glyph's right side) and public.kern2.* (its left side), each with its members. */
  groups: Map<string, string[]>;
  /** First (glyph or group) to second to value, in grid units. */
  pairs: Map<string, Map<string, number>>;
}

function crossings(contours: Contour[], y: number): number[] {
  const xs: number[] = [];
  for (const c of contours)
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!;
      const b = c[(i + 1) % c.length]!;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  return xs;
}

function profileOf(master: Master, glyph: MasterGlyph, kind: Case, sign: boolean, figure: boolean, script: string | undefined): Profile {
  const contours = flatten(master, glyph);
  const left: (number | null)[] = [];
  const right: (number | null)[] = [];
  for (let i = 0; i < ROWS; i++) {
    const xs = crossings(contours, BOTTOM + (i + 0.5) * ROW);
    left.push(xs.length ? Math.min(...xs) : null);
    right.push(xs.length ? Math.max(...xs) : null);
  }
  const p = { name: glyph.name, advance: glyph.advance, kind, sign, script, left, right, own: { left: 0, right: 0 }, mark: left.map(() => false) };
  const which = figure ? 'figure' : kind === 'upper' ? 'upper' : 'lower';
  const zone = sign ? undefined : ZONE[which];
  const rows = [...left.keys()].filter((i) => left[i] !== null && (!zone || (BOTTOM + (i + 0.5) * ROW >= zone[0] && BOTTOM + (i + 0.5) * ROW <= zone[1])));
  const depth = DEPTH[kind];
  const edgeL = Math.min(...left.map((x) => x ?? Infinity));
  const edgeR = Math.max(...right.map((x) => x ?? -Infinity));
  const mean = (f: (i: number) => number) => rows.reduce((t, i) => t + f(i), 0) / Math.max(1, rows.length);
  p.own = sign
    ? { left: edgeL + mean((i) => Math.min(depth, left[i]! - edgeL)), right: glyph.advance - edgeR + mean((i) => Math.min(depth, edgeR - right[i]!)) }
    : { left: SPACING_TARGET[which], right: SPACING_TARGET[which] };
  return p;
}

/** The glyph an accented glyph is built on, whose classes it joins when its side matches. */
function baseOf(glyph: MasterGlyph, byName: Map<string, MasterGlyph>): string {
  if (glyph.contours.length || !glyph.components.length) return glyph.name;
  const base = glyph.components.find((c) => !byName.get(c.glyph)?.mark);
  return base ? baseOf(byName.get(base.glyph)!, byName) : glyph.name;
}

const NOT_KERNED = /\.(tf|tosf|numr|dnom|sinf|subs|sups)\b|superior$|inferior$|comb(\.case)?$/;
/** The signs that are kerned: those that sit against letters in running text. */
const KERNED_SIGNS = new Set('.,:;!?¡¿…\'"‘’‚“”„‹›«»-–—()[]{}/\\*'.split(''));

/** What kind of glyph this is for kerning, or undefined when it is not kerned (marks, tabular figures, spaces). */
function kindOf(glyph: MasterGlyph, cp: number | undefined, smallcap: boolean): { kind: Case; sign: boolean; figure: boolean; script: string | undefined } | undefined {
  if (glyph.mark || NOT_KERNED.test(glyph.name)) return undefined;
  if (cp === undefined) return undefined;
  const c = String.fromCodePoint(cp);
  const script = ['Latin', 'Greek', 'Cyrillic'].find((s) => new RegExp(`\\p{Script=${s}}`, 'u').test(c));
  if (/\p{L}/u.test(c) && !/\p{Lm}/u.test(c)) return { kind: smallcap || /\p{Ll}/u.test(c) ? 'lower' : 'upper', sign: false, figure: false, script };
  if (/\p{Nd}/u.test(c)) return { kind: 'other', sign: false, figure: true, script: undefined };
  if (KERNED_SIGNS.has(c)) return { kind: 'other', sign: true, figure: false, script: undefined };
  return undefined;
}

/** The kerning of one pair of profiles and the closest they come once kerned, or undefined with no row in common. */
/** The kerning a pair wants, and the most it can take with every row kept its least gap (`least`, negative: as far as it may close). */
function measure(a: Profile, b: Profile): { value: number; least: number } | undefined {
  const depthA = DEPTH[a.kind];
  const depthB = DEPTH[b.kind];
  const edgeA = Math.max(...a.right.map((x) => x ?? -Infinity));
  const edgeB = Math.min(...b.left.map((x) => x ?? Infinity));
  if (a.sign && b.sign) return undefined;
  let white = 0;
  let rows = 0;
  let gap = Infinity;
  let least = -Infinity;
  for (let i = 0; i < ROWS; i++) {
    const ra = a.right[i];
    const lb = b.left[i];
    if (ra == null || lb == null) continue;
    rows++;
    white += Math.min(depthA, edgeA - ra) + (a.advance - edgeA) + Math.min(depthB, lb - edgeB) + edgeB;
    const here = a.advance - ra + lb;
    gap = Math.min(gap, here);
    least = Math.max(least, (a.mark[i] || b.mark[i] ? MIN_MARK_GAP : MIN_GAP) - here);
  }
  if (!rows) return undefined;
  const norm = a.own.right + b.own.left;
  // Parallel diagonals (A V) leave each row its usual white and so read as unkerned by area; the gap all along them is what shows.
  return { value: Math.min(STRENGTH * (norm - white / rows), GAP_STRENGTH * (norm - gap)), least };
}



/** Every kerned glyph's profile in one master. */
export function profilesOf(master: Master): Map<string, Profile> {
  const byName = new Map(master.glyphs.map((g) => [g.name, g]));
  const unicodeOf = (g: MasterGlyph): number | undefined => {
    if (g.unicode !== undefined) return g.unicode;
    const base = byName.get(baseOf(g, byName));
    if (base && base !== g && base.unicode !== undefined) return base.unicode;
    // A ligature (f_f) kerns as its letters: lowercase Latin, like its first.
    return byName.get(g.name.split('.')[0]!.split('_')[0]!)?.unicode;
  };
  const profiles = new Map<string, Profile>();
  for (const g of master.glyphs) {
    // Arrow and code ligature pieces join their neighbours edge to edge: kerning them would break the shape.
    if (g.name.includes('.arrow_') || g.name.includes('.c_')) continue;
    const k = kindOf(g, unicodeOf(g), g.name.endsWith('.sc'));
    if (!k) continue;
    const p = profileOf(master, g, k.kind, k.sign, k.figure, k.script);
    if (p.left.some((x) => x !== null)) profiles.set(g.name, p);
  }
  for (const [name, p] of profiles) {
    const base = profiles.get(baseOf(byName.get(name)!, byName));
    if (!base || base === p) continue;
    const rows = [...base.left.keys()].filter((i) => base.left[i] !== null);
    const [lo, hi] = [Math.min(...rows), Math.max(...rows)];
    p.mark = p.mark.map((_, i) => p.left[i] !== null && (i < lo || i > hi));
  }
  return profiles;
}

/** Kerning classes: right sides (public.kern1) and left sides (public.kern2), each class a base and the members whose side matches it. */
export interface KerningClasses {
  right: Map<string, string[]>;
  left: Map<string, string[]>;
}

/**
 * Classes from one master, used for every weight of its style (the variable fonts need one set): each
 * glyph kerns as the glyph it is built on, and letters with the same side share a class (B D E F H K L
 * P R all start with a stem): every row of the letter itself within SAME of the class's first.
 */
export function kerningClasses(master: Master): KerningClasses {
  const byName = new Map(master.glyphs.map((g) => [g.name, g]));
  const profiles = profilesOf(master);
  const families = new Map<string, string[]>();
  for (const name of profiles.keys()) {
    const base = baseOf(byName.get(name)!, byName);
    const key = profiles.has(base) ? base : name;
    families.set(key, [...(families.get(key) ?? []), name]);
  }
  const cluster = (side: 'left' | 'right') => {
    const classes = new Map<string, string[]>();
    const firsts: [string, (number | null)[], boolean][] = [];
    const add = (key: string, names: string[]) => {
      const b = profiles.get(key)!;
      const w = white(b, side);
      const home = firsts.find(([, v, s]) => s === b.sign && same(v, w))?.[0];
      if (home) classes.get(home)!.push(...names);
      else {
        classes.set(key, [...names]);
        firsts.push([key, w, b.sign]);
      }
    };
    // A member whose mark hangs past this side (ï, ť) clashes where its letter does not: classed apart, its clashes are class pairs.
    const reaching = (p: Profile) => p[side].some((x) => x != null && (side === 'left' ? x < OVERHANG_READ : x > p.advance - OVERHANG_READ));
    const apart: string[] = [];
    for (const [base, names] of families) {
      const own = reaching(profiles.get(base)!) ? names : names.filter((n) => !reaching(profiles.get(n)!));
      apart.push(...names.filter((n) => !own.includes(n)));
      if (own.length) add(own.includes(base) ? base : own[0]!, own);
    }
    for (const n of apart) add(n, [n]);
    return classes;
  };
  return { right: cluster('right'), left: cluster('left') };
}

const white = (p: Profile, side: 'left' | 'right') => p[side].map((x) => (x === null ? null : side === 'left' ? x : p.advance - x));
const same = (p: (number | null)[], q: (number | null)[]) => p.every((x, i) => (x === null ? q[i] === null : q[i] !== null && Math.abs(x - q[i]!) <= SAME));
const quantize = (v: number) => Math.round(v / QUANTUM) * QUANTUM;
/** The least kerning on the quarter grid that keeps a pair its gaps. */
const room = (least: number) => Math.ceil(least / QUANTUM) * QUANTUM;

/**
 * Each class pair is kerned as its two letters want; a member whose mark or tail would then come
 * closer than its least gap (Ť, ľ, é under a bar) gets an exception, against the other class where
 * the other side is the class's own letter shape, so it is stated once.
 */
export function computeKerning(master: Master, classes: KerningClasses): Kerning {
  const profiles = profilesOf(master);
  const groups = new Map<string, string[]>();
  for (const [key, names] of classes.right) groups.set(`public.kern1.${key}`, names);
  for (const [key, names] of classes.left) groups.set(`public.kern2.${key}`, names);
  const scriptsOf = (names: string[]) => new Set(names.map((n) => profiles.get(n)?.script).filter((x): x is string => x !== undefined));
  const plainOf = (map: Map<string, string[]>, side: 'left' | 'right') => {
    const plain = new Map<string, { plain: string[]; special: string[] }>();
    for (const [key, names] of map) {
      const base = white(profiles.get(key)!, side);
      const split = { plain: [] as string[], special: [] as string[] };
      for (const n of names) {
        const p = profiles.get(n);
        if (!p) continue;
        (!p.mark.some(Boolean) && same(white(p, side), base) ? split.plain : split.special).push(n);
      }
      plain.set(key, split);
    }
    return plain;
  };
  const rights = plainOf(classes.right, 'right');
  const lefts = plainOf(classes.left, 'left');
  // A class's limit is its plain members' together: each within SAME of its letter, so any one of them may be the tightest.
  const hull = (key: string, names: string[], side: 'left' | 'right'): Profile => {
    const ps = names.map((n) => profiles.get(n)!);
    const first = profiles.get(key)!;
    const rows = first[side].map((x, i) => {
      if (x === null) return null;
      const xs = ps.map((p) => (side === 'right' ? p.right[i]! - p.advance : p.left[i]!));
      return side === 'right' ? Math.max(...xs) + first.advance : Math.min(...xs);
    });
    return { ...first, [side]: rows };
  };
  const rightHull = new Map([...rights].map(([k, v]) => [k, hull(k, v.plain, 'right')]));
  const leftHull = new Map([...lefts].map(([k, v]) => [k, hull(k, v.plain, 'left')]));
  const rightScripts = new Map([...classes.right].map(([k, n]) => [k, scriptsOf(n)]));
  const leftScripts = new Map([...classes.left].map(([k, n]) => [k, scriptsOf(n)]));
  const pairs = new Map<string, Map<string, number>>();
  const set = (first: string, second: string, value: number) => {
    if (!pairs.has(first)) pairs.set(first, new Map());
    pairs.get(first)!.set(second, value);
  };
  for (const [first, a] of classes.right) {
    const sa = rightScripts.get(first)!;
    const pa = profiles.get(first)!;
    for (const [second, b] of classes.left) {
      const sb = leftScripts.get(second)!;
      if (sa.size && sb.size && ![...sa].some((s) => sb.has(s))) continue;
      const m = measure(pa, profiles.get(second)!);
      if (!m) continue;
      const limit = measure(rightHull.get(first)!, leftHull.get(second)!)?.least ?? m.least;
      // A pair the spacing set close is left as it is (A.): only an actual clash opens a pair, below.
      const value = Math.min(0, Math.max(quantize(m.value), room(Math.min(0, Math.max(-MOST, m.least, limit)))));
      if (Math.abs(value) < LEAST) continue;
      const k1 = `public.kern1.${first}`;
      const k2 = `public.kern2.${second}`;
      set(k1, k2, value);
      if (value >= 0) continue;
      const { plain: plainA, special: specialA } = rights.get(first)!;
      const { plain: plainB, special: specialB } = lefts.get(second)!;
      const exception = (x: string, y: string) => {
        const least = measure(profiles.get(x)!, profiles.get(y)!)?.least ?? -Infinity;
        return value < least ? Math.max(value, room(Math.min(0, least))) : undefined;
      };
      const tightest = (xs: string[], ys: string[]) => {
        let v: number | undefined;
        for (const x of xs) for (const y of ys) {
          const e = exception(x, y);
          if (e !== undefined) v = Math.max(v ?? -Infinity, e);
        }
        return v;
      };
      for (const x of specialA) {
        const v = tightest([x], plainB);
        if (v !== undefined) set(x, k2, v > -LEAST ? 0 : v);
        for (const y of specialB) {
          const e = exception(x, y);
          if (e !== undefined) set(x, y, e > -LEAST ? 0 : e);
        }
      }
      for (const y of specialB) {
        const v = tightest(plainA, [y]);
        if (v !== undefined) set(k1, y, v > -LEAST ? 0 : v);
      }
      void a;
      void b;
    }
  }
  // Glyphs whose ink reaches past their own side (f's hook, ï's dieresis, j's tail) can meet unkerned:
  // where they would, the pair is opened up to its least gap.
  const byClass = (map: Map<string, string[]>, prefix: string) => new Map([...map].flatMap(([k, names]) => names.map((n) => [n, `${prefix}${k}`] as const)));
  const firstOf = byClass(classes.right, 'public.kern1.');
  const secondOf = byClass(classes.left, 'public.kern2.');
  const current = (x: string, y: string) => pairs.get(x)?.get(y) ?? pairs.get(x)?.get(secondOf.get(y)!) ?? pairs.get(firstOf.get(x)!)?.get(y) ?? pairs.get(firstOf.get(x)!)?.get(secondOf.get(y)!) ?? 0;
  const needs = new Map<string, Map<string, number>>();
  for (const [a, b] of overhangingPairs(profiles)) {
    const least = clash(a, b);
    if (least === undefined || current(a.name, b.name) >= least) continue;
    if (!needs.has(a.name)) needs.set(a.name, new Map());
    needs.get(a.name)!.set(b.name, Math.min(MOST, room(least)));
  }
  // Where every member of a class that can meet a glyph needs opening against it, one glyph-class pair says it,
  // and where every member of a class has such a pair against one class, a class pair.
  const profileOf = (n: string) => profiles.get(n) ?? profiles.get(n.replace(/^public\.kern[12]\./, ''));
  const lift = (classesOf: Map<string, string[]>, prefix: string, flip: boolean) => {
    const byGlyph = new Map<string, Map<string, number>>();
    for (const [a, row] of needs)
      for (const [b, v] of row) {
        const [glyph, member] = flip ? [b, a] : [a, b];
        if (!byGlyph.has(glyph)) byGlyph.set(glyph, new Map());
        byGlyph.get(glyph)!.set(member, v);
      }
    for (const [glyph, row] of byGlyph)
      for (const [k, members] of classesOf) {
        const g = profileOf(glyph);
        const meeting = members.filter((m) => !g || meets(flip ? profiles.get(m)! : g, flip ? g : profiles.get(m)!));
        if (meeting.length < 2 || !meeting.every((m) => row.has(m))) continue;
        const value = Math.max(...meeting.map((m) => row.get(m)!));
        if (flip) set(`${prefix}${k}`, glyph, value);
        else set(glyph, `${prefix}${k}`, value);
        for (const m of meeting) {
          const [a, b] = flip ? [m, glyph] : [glyph, m];
          needs.get(a)!.delete(b);
          if (needs.get(a)!.size === 0) needs.delete(a);
          pairs.get(a)?.delete(b);
        }
      }
  };
  for (const [a, row] of needs) for (const [b, v] of row) if (current(a, b) >= v) row.delete(b);
  const wanted = [...needs].flatMap(([a, row]) => [...row].map(([b, v]) => [a, b, v] as const));
  lift(classes.left, 'public.kern2.', false);
  lift(classes.right, 'public.kern1.', true);
  for (const [a, row] of needs) for (const [b, v] of row) if (current(a, b) < v) set(a, b, v);
  // Glyph-class pairs that cover a whole class become one class pair.
  for (const [k1, members] of classes.right) {
    const seconds = new Map<string, number[]>();
    for (const m of members)
      for (const [s2, v] of pairs.get(m) ?? []) if (s2.startsWith('public.kern2.') && v > 0) seconds.set(s2, [...(seconds.get(s2) ?? []), v]);
    for (const [s2, vs] of seconds) {
      const others = classes.left.get(s2.slice('public.kern2.'.length))!;
      const meeting = members.filter((m) => others.some((o) => meets(profiles.get(m)!, profiles.get(o)!)));
      if (meeting.length < 2 || !meeting.every((m) => pairs.get(m)?.has(s2))) continue;
      set(`public.kern1.${k1}`, s2, Math.max(...vs));
      for (const m of meeting) pairs.get(m)!.delete(s2);
    }
  }
  for (const [k, row] of [...pairs]) if (row.size === 0) pairs.delete(k);
  // A lifted pair can sit behind a glyph's own exception, which the font reads first: there the glyph pair is stated.
  for (const [a, b, v] of wanted) if (current(a, b) < v) set(a, b, v);
  // A word space beside an open side (T, V, Y, L, A) looks wider by the white that side leaves: part of it is taken back.
  // Signs are left alone, so a sentence's space after a period or a quote keeps its width.
  if (master.glyphs.some((g) => g.name === 'space'))
    for (const side of ['right', 'left'] as const)
      for (const [k] of side === 'right' ? classes.right : classes.left) {
        const p = profiles.get(k)!;
        if (p.sign || p.kind === 'other') continue;
        const value = -Math.min(SPACE_MOST, quantize(SPACE_STRENGTH * openness(p, side, master.style === 'italic' ? ITALIC_SLOPE : 0)));
        if (value > -LEAST) continue;
        if (side === 'right') set(`public.kern1.${k}`, 'space', value);
        else set('space', `public.kern2.${k}`, value);
      }
  return { groups, pairs };
}

/**
 * The white a side leaves beyond its outermost ink where it opens from the top or the bottom of its case's height
 * (under T's bar, over L's foot, along V's diagonal), each row capped at the case's depth, as a share of that height.
 * White an arm closes off on both ends (between E's arms) does not count.
 */
function openness(p: Profile, side: 'left' | 'right', slope: number): number {
  const which = p.kind === 'upper' ? 'upper' : 'lower';
  const [bottom, top] = ZONE[which];
  const depth = DEPTH[which];
  // Read upright: italic's slant would make E's lower arm look shorter than its upper one.
  const xs = p[side].map((x, i) => (x == null ? null : x - slope * (BOTTOM + (i + 0.5) * ROW)));
  const rows = [...xs.keys()].filter((i) => BOTTOM + (i + 0.5) * ROW >= bottom && BOTTOM + (i + 0.5) * ROW <= top);
  // The edge within the case's height: a descender's tail (Җ) is below the word space's reach.
  const inked = rows.map((i) => xs[i]).filter((x): x is number => x != null);
  if (!inked.length) return 0;
  const edge = side === 'left' ? Math.min(...inked) : Math.max(...inked);
  const white = rows.map((i) => (xs[i] == null ? depth : Math.min(depth, Math.abs(xs[i]! - edge))));
  const run = (ws: number[]) => {
    let t = 0;
    for (const w of ws) {
      if (w < 1) break;
      t += w;
    }
    return t;
  };
  return Math.max(run(white), run([...white].reverse())) / Math.max(1, rows.length);
}

/** Whether two glyphs can stand side by side: the same script, and a small cap never beside a lowercase letter (smcp turns them all). */
function meets(a: Profile, b: Profile): boolean {
  const small = (p: Profile) => p.name.includes('.sc');
  return !(a.script && b.script && a.script !== b.script) && !(small(a) !== small(b) && (small(a) ? b : a).kind === 'lower');
}

/** Every same-script letter pair in which either glyph's ink reaches past its side toward the other (f's hook, ï's dieresis, j's tail). */
function* overhangingPairs(profiles: Map<string, Profile>): Generator<[Profile, Profile]> {
  const all = [...profiles.values()].filter((p) => !p.sign);
  const right = new Set(all.filter((p) => p.right.some((x) => x != null && x > p.advance - OVERHANG_READ)));
  const left = new Set(all.filter((p) => p.left.some((x) => x != null && x < OVERHANG_READ)));
  for (const a of all) for (const b of right.has(a) ? all : left) if (meets(a, b)) yield [a, b];
}

/** How far a pair must open to stop colliding: ink overlapping, or a mark within MIN_MARK_GAP of its neighbour; undefined when it does not. */
export function clash(a: Profile, b: Profile): number | undefined {
  let least = -Infinity;
  for (let i = 0; i < ROWS; i++) {
    const ra = a.right[i];
    const lb = b.left[i];
    if (ra == null || lb == null) continue;
    least = Math.max(least, (a.mark[i] || b.mark[i] ? MIN_MARK_GAP : 0) - (a.advance - ra + lb));
  }
  return least > 0 ? least : undefined;
}

/** The value the kerning gives a glyph pair, as the font resolves it: glyph pairs, then glyph and class, then classes. */
export function resolvedValue(kerning: Kerning, x: string, y: string): number {
  const first = [...kerning.groups].find(([k, n]) => k.startsWith('public.kern1.') && n.includes(x))?.[0];
  const second = [...kerning.groups].find(([k, n]) => k.startsWith('public.kern2.') && n.includes(y))?.[0];
  for (const [f, s2] of [[x, y], [x, second], [first, y], [first, second]] as const) {
    const v = f && s2 ? kerning.pairs.get(f)?.get(s2) : undefined;
    if (v !== undefined) return v;
  }
  return 0;
}

/**
 * Every glyph pair the kerning brings closer than its least gap (and closer than it stood unkerned),
 * member by member: a check on what the exceptions promise.
 */
export function kerningCollisions(master: Master, kerning: Kerning): string[] {
  const profiles = profilesOf(master);
  const found: string[] = [];
  const index = new Map<string, [string | undefined, string | undefined]>();
  for (const [g, names] of kerning.groups) for (const n of names) {
    const at = index.get(n) ?? [undefined, undefined];
    at[g.startsWith('public.kern1.') ? 0 : 1] = g;
    index.set(n, at);
  }
  const resolve = (x: string, y: string) => {
    const [first, second] = [index.get(x)?.[0], index.get(y)?.[1]];
    for (const [f, s2] of [[x, y], [x, second], [first, y], [first, second]] as const) {
      const v = f && s2 ? kerning.pairs.get(f)?.get(s2) : undefined;
      if (v !== undefined) return v;
    }
    return 0;
  };
  for (const [first, row] of kerning.pairs) {
    if (!first.startsWith('public.')) continue;
    for (const [second] of row) {
      if (!second.startsWith('public.')) continue;
      for (const x of kerning.groups.get(first) ?? [])
        for (const y of kerning.groups.get(second) ?? []) {
          const a = profiles.get(x);
          const b = profiles.get(y);
          if (!a || !b) continue;
          const value = resolve(x, y);
          if (value >= 0) continue;
          const least = measure(a, b)?.least ?? -Infinity;
          if (value < Math.min(0, least) - 1e-6) found.push(`${x} ${y}: ${value} past ${least.toFixed(2)}`);
        }
    }
  }
  for (const [a, b] of overhangingPairs(profiles)) {
    const least = clash(a, b);
    const value = resolve(a.name, b.name);
    if (least !== undefined && value < Math.min(MOST, least) - 1e-6) found.push(`${a.name} ${b.name}: ${value} clashes, needs ${least.toFixed(2)}`);
  }
  return found;
}

/**
 * The kerning of every weight of a style with the same pairs stated in each: an exception one weight
 * needs is stated in all, at each weight's own resolved value, so nothing falls back to a class value
 * in some masters and not others as the variable font interpolates.
 */
export function alignKerning(kernings: Kerning[]): Kerning[] {
  const exceptions = new Set<string>();
  for (const k of kernings) for (const [f, row] of k.pairs) for (const s of row.keys()) if (!(f.startsWith('public.') && s.startsWith('public.'))) exceptions.add(`${f}\u0000${s}`);
  return kernings.map((k) => {
    const groupOf = (name: string, prefix: string) => (name.startsWith('public.') ? name : [...k.groups].find(([g, n]) => g.startsWith(prefix) && n.includes(name))?.[0]);
    const pairs = new Map([...k.pairs].map(([f, row]) => [f, new Map(row)]));
    for (const key of exceptions) {
      const [f, s] = key.split('\u0000') as [string, string];
      if (pairs.get(f)?.has(s)) continue;
      const [g1, g2] = [groupOf(f, 'public.kern1.'), groupOf(s, 'public.kern2.')];
      const own = !f.startsWith('public.') && g2 ? pairs.get(f)?.get(g2) : undefined;
      const theirs = !s.startsWith('public.') && g1 ? pairs.get(g1)?.get(s) : undefined;
      const value = own ?? theirs ?? (g1 && g2 ? pairs.get(g1)?.get(g2) : undefined) ?? 0;
      if (!pairs.has(f)) pairs.set(f, new Map());
      pairs.get(f)!.set(s, value);
    }
    return { groups: k.groups, pairs };
  });
}
