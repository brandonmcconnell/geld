import type { Contour } from './geometry';
import { flatten, type Master, type MasterGlyph } from './master';

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
/** Letters whose sides are this close in every row share a kerning class. */
const SAME = 0.3;
/** The most any pair is kerned: LT and L’ are kerned no further than T o. */
const MOST = 2.5;


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
function profilesOf(master: Master): Map<string, Profile> {
  const byName = new Map(master.glyphs.map((g) => [g.name, g]));
  const unicodeOf = (g: MasterGlyph): number | undefined => {
    if (g.unicode !== undefined) return g.unicode;
    const base = byName.get(baseOf(g, byName));
    if (base && base !== g && base.unicode !== undefined) return base.unicode;
    return byName.get(g.name.split('.')[0]!)?.unicode;
  };
  const profiles = new Map<string, Profile>();
  for (const g of master.glyphs) {
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
    for (const [base, names] of families) {
      const b = profiles.get(base)!;
      const w = white(b, side);
      const home = firsts.find(([, v, s]) => s === b.sign && same(v, w))?.[0];
      if (home) classes.get(home)!.push(...names);
      else {
        classes.set(base, [...names]);
        firsts.push([base, w, b.sign]);
      }
    }
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
      const value = Math.min(MOST, Math.max(quantize(m.value), room(Math.max(-MOST, m.least, limit))));
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
  return { groups, pairs };
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
