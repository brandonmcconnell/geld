import { accentedFromUnicode, ALIASES, CASE_FORMS, GREEK_TONOS, LATIN_RANGES, PLACED, type PlacedDef, SPACING_ACCENTS } from './composites';
import { type DrawContext, drawContext, type GlyphDef, MATH_AXIS, open, p, smallCapContext } from './draw';
import { measuredSidebearings, type SpacingZone } from './spacing';
import { bounds, type Contour, expandStroke, insetContour, shear, snapJoined, translate, type Vec, winding } from './geometry';
import { GLYPHS, SPACES } from './glyphs';
import { FIGURE_NAMES } from './glyphs-figures';
import { CYRILLIC_LOCL_ACCENTED } from './glyphs-cyrillic';
import { accentedSmallCaps, SMALL_CAP_EXTRA_ACCENTED, SMALL_CAP_PLACED } from './glyphs-smallcaps';
import { ALTERNATES, alternateName } from './alternates';
import { CODE_LIGATURES, codePieceName } from './code-ligatures';
import { LOCKUP, lockupGlyph } from './lockup';
import { DARK_INSET_RATIO, ITALIC_SLOPE, METRICS, toFontUnits, UNIT, type Weight, weightParams } from './grid';
import { type Attachment, BELOW_GAP, MARK_GAP, MARK_HEIGHT, MARKS } from './marks';

/** Italics lean around the middle of the x-height, so a slanted glyph stays centred in its advance. */
const ITALIC_PIVOT = METRICS.xHeight / 2;
/** The text ligatures: pairs whose crossbars would all but touch, drawn as one bar (fi fl fj fb fh fk are clear of each other and need none). */
export const TEXT_LIGATURES = [['f', 'f'], ['f', 't'], ['t', 't']] as const;

/** Ơ Ư ơ ư are wider than O U o u by the horn that reaches out of them. */
const HORN_ROOM = 1.5;
/** The least room right of the horn's tip, so a heavier horn widens its glyph rather than reaching into the next. */
const HORN_SIDE = 0.3;

export type Family = 'sans' | 'dark';
export type Style = 'roman' | 'italic';

export const FAMILY_NAMES: Record<Family, string> = {
  sans: 'Geld Sans',
  dark: 'Geld Dark Sans',
};

export interface Anchor extends Vec {
  name: string;
}

export interface Component {
  glyph: string;
  dx: number;
  dy: number;
}

export interface MasterGlyph {
  name: string;
  unicode?: number;
  /** Advance in grid units. */
  advance: number;
  /** Contours in grid units. */
  contours: Contour[];
  components: Component[];
  anchors: Anchor[];
  mark: boolean;
}

export interface Master {
  family: Family;
  style: Style;
  weight: Weight;
  glyphs: MasterGlyph[];
}

const isUpperChar = (cp: number | undefined) => {
  if (cp === undefined) return false;
  const c = String.fromCodePoint(cp);
  return c !== c.toLowerCase() && c === c.toUpperCase();
};

/**
 * Which spacing zone a drawn glyph is measured in: letters and figures are spaced by their white
 * (spacing.ts); punctuation and symbols keep their hand-set sidebearings.
 */
function spacingZone(def: GlyphDef, g: DrawContext): SpacingZone | undefined {
  const cp = def.unicode ?? def.stands;
  if (cp === undefined) return undefined;
  const c = String.fromCodePoint(cp);
  if (/\p{Nd}/u.test(c)) {
    const [bottom, top] = def.zone ?? [0, METRICS.cap];
    return { bottom, top, target: 1.3, depth: 2.5, min: 0.3 };
  }
  if (!/\p{L}/u.test(c) || /\p{Lm}/u.test(c)) return undefined;
  if (def.lower || /\p{Ll}/u.test(c)) return { bottom: 0, top: METRICS.xHeight, target: 1.45, depth: 2, min: 0.15 };
  return { bottom: 0, top: g.cap, target: 1.6, depth: 2.8, min: 0.2 };
}

/** Math operators share one width, their ink centred in it, so a row of + − = × ÷ aligns. */
const MATH_OPERATORS = ['plus', 'minus', 'equal', 'multiply', 'divide', 'less', 'greater', 'approxequal', 'notequal', 'asciitilde', 'plusminus', 'logicalnot', 'lessequal', 'greaterequal'];
const MATH_SIDE = 1.25;
/** Tabular figures are the widest lining figure plus this much each side; every tabular sign is centred in that width. */
const TABULAR_SIDE = 1.25;

/** The rightmost ink a little above the baseline: where an ogonek can hang from the stroke, not from a cut corner. */
function inkEndAtBaseline(contours: Contour[], box: { minX: number; maxX: number }): number {
  const y = 0.3;
  for (let x = box.maxX; x > box.minX; x -= 0.05) if (winding(contours, { x, y }) !== 0) return x;
  return box.maxX;
}

/** Where marks attach to a drawn glyph, from its Geld Sans outline: centred above and below, the ogonek under the last stroke. */
function baseAnchors(contours: Contour[], upper: boolean, v: number, name: string): Anchor[] {
  if (!contours.length) return [];
  const box = bounds(contours);
  const cx = (box.minX + box.maxX) / 2;
  const gap = upper ? MARK_GAP.case : MARK_GAP.lower;
  const topright = name === 'L' ? { x: box.minX + v + 0.9, y: METRICS.cap - 3 } : { x: box.maxX + 0.9, y: Math.max(box.maxY - 3, METRICS.xHeight + 1.25) };
  return [
    { name: 'top', x: cx, y: box.maxY + gap },
    { name: 'bottom', x: box.minY < -1 ? box.minX + (box.maxX - box.minX) * 0.3 : cx, y: 0 },
    { name: 'ogonek', x: inkEndAtBaseline(contours, box) - v / 2, y: 0 },
    { name: 'topright', ...topright },
    { name: 'horn', x: box.maxX - 0.3, y: box.maxY - 2.5 },
    { name: 'center', x: cx, y: (upper ? METRICS.cap : METRICS.xHeight) / 2 },
  ];
}

/**
 * Draws every glyph for one master. Geld Dark Sans starts from the Geld Sans outline, placed and
 * spaced the same, and insets it, so the two families share every advance width. Accented letters
 * are components (a base and its marks), placed by anchors read from the Geld Sans outlines.
 */
export function buildMaster(family: Family, style: Style, weight: Weight): Master {
  const params = weightParams(weight);
  const upper = drawContext(params.v, params.h);
  const lower = drawContext(params.v, params.hl, true);
  const small = smallCapContext(params.v, params.hl);
  const italic = style === 'italic';
  const slope = italic ? ITALIC_SLOPE : 0;
  const slant = (contours: Contour[]) => (italic ? contours.map((c) => translate(shear(c, ITALIC_SLOPE), -ITALIC_SLOPE * ITALIC_PIVOT)) : contours);
  /** Each glyph's outline before Geld Dark Sans's inset, slanted, for measurements both families must share. */
  const undarkened = new Map<string, Contour[]>();
  const finish = (contours: Contour[], name?: string) => {
    if (name) undarkened.set(name, slant(contours));
    return slant(family === 'dark' ? contours.map((c) => insetContour(c, params.v * DARK_INSET_RATIO)) : contours);
  };
  const place = (p: Vec): Vec => (italic ? { x: p.x + p.y * ITALIC_SLOPE - ITALIC_SLOPE * ITALIC_PIVOT, y: p.y } : p);
  const placeAnchors = (anchors: Anchor[]) => anchors.map((a) => ({ ...a, ...place(a) }));

  const glyphs: MasterGlyph[] = GLYPHS.map((def) => {
    const cursive = italic && def.italic !== undefined;
    const g = def.smallcap && !cursive ? small : def.lower || def.smallcap ? lower : upper;
    const strokes = cursive ? def.italic!(g) : def.draw(g);
    let contours = strokes.flatMap((stroke) => expandStroke(stroke, g.pen, slope));
    if (params.snap && !italic) contours = snapJoined(contours, 0.5);
    const box = bounds(contours);
    const zone = spacingZone(def, g);
    const frame = def.frame?.(g);
    const { lsb, rsb } = frame ? { lsb: box.minX - frame.origin, rsb: 0 } : zone ? measuredSidebearings(contours, box.minX, box.maxX, zone) : { ...def, ...def.sidebearings?.(g) };
    contours = contours.map((c) => translate(c, lsb - box.minX));
    const advance = frame ? frame.advance : lsb + (box.maxX - box.minX) + rsb;
    const anchors = baseAnchors(contours, isUpperChar(def.unicode ?? def.stands), params.v, def.name);
    return {
      name: def.name,
      ...(def.unicode === undefined ? {} : { unicode: def.unicode }),
      advance,
      contours,
      components: [],
      anchors,
      mark: false,
    };
  });

  const inkWidth = (gl: MasterGlyph) => {
    const b = bounds(gl.contours);
    return b.maxX - b.minX;
  };
  const centre = (gl: MasterGlyph, advance: number) => {
    const b = bounds(gl.contours);
    const dx = (advance - (b.maxX - b.minX)) / 2 - b.minX;
    gl.contours = gl.contours.map((c) => translate(c, dx));
    gl.anchors = gl.anchors.map((a) => ({ ...a, x: a.x + dx }));
    gl.advance = advance;
  };
  const operators = glyphs.filter((gl) => MATH_OPERATORS.includes(gl.name));
  const mathAdvance = Math.max(...operators.map(inkWidth)) + 2 * MATH_SIDE;
  for (const gl of operators) centre(gl, mathAdvance);
  const liningFigures = glyphs.filter((gl) => (FIGURE_NAMES as readonly string[]).includes(gl.name));
  const tabularAdvance = Math.max(...liningFigures.map(inkWidth)) + 2 * TABULAR_SIDE;
  glyphs.forEach((gl, i) => {
    if (GLYPHS[i]?.tabular) centre(gl, tabularAdvance);
  });
  // An alternate that would draw as this style's default is only in the other style (the italic's l is tailed already).
  const elsewhere = new Set(ALTERNATES.filter((alt) => alt.only && alt.only !== style).map(alternateName));
  for (let i = glyphs.length - 1; i >= 0; i--) if (elsewhere.has(glyphs[i]!.name)) glyphs.splice(i, 1);
  // An alternate keeps its letter's anchors, so an exit or a tail never moves a horn or an accent off the letter.
  for (const alt of ALTERNATES) {
    const gl = glyphs.find((x) => x.name === alternateName(alt));
    const base = glyphs.find((x) => x.name === alt.glyph);
    if (!gl || !base) continue;
    const dx = bounds(gl.contours).minX - bounds(base.contours).minX;
    gl.anchors = base.anchors.map((a) => ({ ...a, x: a.x + dx }));
  }

  // Where each ligature's letters have their crossbars, read before the slant and the dark inset so the bridge between them takes both.
  const bars = new Map(
    TEXT_LIGATURES.flatMap((parts) => parts).map((name) => {
      const gl = glyphs.find((x) => x.name === name)!;
      const y = METRICS.xHeight - lower.h / 2;
      const xs = gl.contours.flatMap((c) => c.flatMap((a, i) => {
        const b = c[(i + 1) % c.length]!;
        return (a.y <= y && b.y > y) || (b.y <= y && a.y > y) ? [a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)] : [];
      }));
      const [left, right] = [Math.min(...xs), Math.max(...xs)];
      // The bar's own top and bottom near its end, as drawn (SemiBold snaps them to the half unit).
      const at = right - 0.25;
      const ys = gl.contours
        .flatMap((c) => c.flatMap((a, i) => {
          const b = c[(i + 1) % c.length]!;
          return (a.x <= at && b.x > at) || (b.x <= at && a.x > at) ? [a.y + ((at - a.x) / (b.x - a.x)) * (b.y - a.y)] : [];
        }))
        .sort((p, q) => p - q);
      const bottom = Math.max(...ys.filter((v) => v <= y));
      const top = Math.min(...ys.filter((v) => v >= y));
      return [name, { left, right, advance: gl.advance, top, bottom }] as const;
    }),
  );
  const arches = ARCH_LIGATURES.map((parts) => archLigature(parts, glyphs, lower, slope, params.snap && !italic));
  for (const gl of glyphs) {
    gl.contours = finish(gl.contours, gl.name);
    gl.anchors = placeAnchors(gl.anchors);
  }
  // ff ft tt: the two letters with one crossbar, bridged where the two would otherwise all but touch.
  for (const parts of TEXT_LIGATURES) {
    let x = 0;
    const components: Component[] = [];
    const bridges: Contour[] = [];
    const carets: Anchor[] = [];
    parts.forEach((name, i) => {
      const bar = bars.get(name)!;
      // Whole font units, rounded as the UFO writes each letter's advance and the compiler then rounds it (342.49999 to
      // 342.5 to 343): the ligature is exactly as wide as its letters set apart.
      const step = Math.floor(toFontUnits(bar.advance) + 0.5) / UNIT;
      const offset = place({ x, y: 0 });
      const origin = place({ x: 0, y: 0 });
      components.push({ glyph: name, dx: offset.x - origin.x, dy: 0 });
      const next = parts[i + 1];
      if (next) {
        // Into each bar by more than Geld Dark Sans's inset, which trims the bridge's ends too.
        const into = 0.5 + (family === 'dark' ? params.v * DARK_INSET_RATIO : 0);
        const from = x + bar.right - into;
        const to = x + step + bars.get(next)!.left + into;
        const [top, bottom] = [Math.min(bar.top, bars.get(next)!.top), Math.max(bar.bottom, bars.get(next)!.bottom)];
        bridges.push([{ x: from, y: bottom }, { x: to, y: bottom }, { x: to, y: top }, { x: from, y: top }]);
        carets.push({ name: `caret_${i + 1}`, x: x + step, y: 0 });
      }
      x += step;
    });
    glyphs.push({ name: parts.join('_'), advance: x, contours: finish(bridges, parts.join('_')), components, anchors: placeAnchors(carets), mark: false });
  }
  glyphs.push({ name: LOCKUP.name, ...lockupGlyph(family === 'dark'), components: [], mark: false });

  for (const arch of arches) {
    if (!arch) continue;
    const [first, second] = arch.parts;
    const at = place({ x: arch.second, y: 0 });
    const origin = place({ x: 0, y: 0 });
    glyphs.push({
      name: arch.parts.join('_'),
      advance: arch.advance,
      contours: finish(arch.contours, arch.parts.join('_')),
      components: [
        { glyph: first, dx: 0, dy: 0 },
        { glyph: second, dx: at.x - origin.x, dy: 0 },
      ],
      anchors: placeAnchors([{ name: 'caret_1', x: arch.caret, y: 0 }]),
      mark: false,
    });
  }

  const markAttach = new Map<string, Attachment>();
  /** How far right each mark's ink reaches before Geld Dark Sans's inset, which must not change an advance. */
  const markReach = new Map<string, number>();
  for (const def of MARKS)
    for (const form of def.caseForm ? (['lower', 'case'] as const) : (['lower'] as const)) {
      const height = MARK_HEIGHT[form];
      let contours = def.draw(lower, height).flatMap((stroke) => expandStroke(stroke, lower.pen, slope));
      if (def.hang) {
        const top = bounds(contours).maxY;
        contours = contours.map((c) => translate(c, 0, -BELOW_GAP - top));
      }
      if (def.attach === 'top') {
        const bottom = bounds(contours).minY;
        contours = contours.map((c) => translate(c, 0, -bottom));
      }
      const box = bounds(contours);
      const name = form === 'case' ? `${def.name}.case` : def.name;
      const above = def.attach === 'top' || def.attach === 'topright' || def.attach === 'horn';
      const stackGap = form === 'case' ? 0.4 : 0.75;
      const stack: Anchor = above ? { name: def.attach, x: 0, y: box.maxY + stackGap } : { name: def.attach, x: 0, y: box.minY - 0.5 };
      markAttach.set(name, def.attach);
      markReach.set(name, bounds(slant(contours)).maxX);
      glyphs.push({
        name,
        ...(form === 'lower' && def.unicode !== undefined ? { unicode: def.unicode } : {}),
        advance: 0,
        contours: finish(contours, name),
        components: [],
        anchors: placeAnchors([{ name: `_${def.attach}`, x: 0, y: 0 }, stack]),
        mark: true,
      });
    }

  const byName = new Map(glyphs.map((gl) => [gl.name, gl]));
  const names = new Map(glyphs.flatMap((gl) => (gl.unicode === undefined ? [] : [[gl.unicode, gl.name] as const])));
  const caseMarks = new Set(MARKS.filter((m) => m.caseForm).map((m) => m.name));
  const anchorOf = (glyph: MasterGlyph, name: string) => glyph.anchors.find((a) => a.name === name);

  const placeAll = (defs: PlacedDef[]) => {
    for (const def of defs) {
      let x = 0;
      const components: Component[] = [];
      for (const part of def.parts) {
        const glyph = byName.get(part.glyph);
        if (!glyph) throw new Error(`${def.name} needs ${part.glyph}`);
        const offset = place({ x: x + (part.dx ?? 0), y: part.dy ?? 0 });
        const origin = place({ x: 0, y: 0 });
        components.push({ glyph: part.glyph, dx: offset.x - origin.x, dy: offset.y });
        if (part.after) x += glyph.advance + (part.dx ?? 0);
      }
      const advance = def.advance ?? (x || byName.get(def.parts[0]!.glyph)!.advance);
      const only = def.parts.length === 1 ? byName.get(def.parts[0]!.glyph) : undefined;
      const anchors = only ? only.anchors.map((a) => ({ ...a, x: a.x + components[0]!.dx, y: a.y + components[0]!.dy })) : [];
      glyphs.push({ name: def.name, ...(def.unicode === undefined ? {} : { unicode: def.unicode }), advance, contours: [], components, anchors, mark: false });
      byName.set(def.name, glyphs[glyphs.length - 1]!);
      if (def.unicode !== undefined) names.set(def.unicode, def.name);
    }
  };
  placeAll(ALIASES);

  const accented = accentedFromUnicode(LATIN_RANGES, names, caseMarks);
  const smallCapAccents = [...accentedSmallCaps(accented, (name) => byName.has(name)), ...SMALL_CAP_EXTRA_ACCENTED];
  // Accented letters follow their base's alternates: á.ss01 is á on the single-storey a.
  const alternatesOf = (name: string) => ALTERNATES.filter((alt) => alt.glyph === name && byName.has(alternateName(alt)));
  const accentedAlternates = accented.flatMap((def) =>
    alternatesOf(def.base).map((alt) => ({ ...def, name: `${def.name}.${alternateName(alt).split('.')[1]}`, base: alternateName(alt), unicode: undefined })),
  );
  for (const def of [...accented, ...CYRILLIC_LOCL_ACCENTED, ...smallCapAccents, ...accentedAlternates]) {
    const base = byName.get(def.base);
    if (!base) continue;
    const components: Component[] = [{ glyph: def.base, dx: 0, dy: 0 }];
    const reached = new Map<string, Vec>();
    for (const markName of def.marks) {
      const mark = byName.get(markName)!;
      const attach = markAttach.get(markName)!;
      const at = reached.get(attach) ?? anchorOf(base, attach);
      const own = anchorOf(mark, `_${attach}`)!;
      if (!at) throw new Error(`${def.base} has no ${attach} anchor for ${markName}`);
      const dx = at.x - own.x;
      const dy = at.y - own.y;
      components.push({ glyph: markName, dx, dy });
      const next = anchorOf(mark, attach)!;
      reached.set(attach, { x: next.x + dx, y: next.y + dy });
    }
    const hornAt = components.find((c) => c.glyph === 'horncomb');
    const advance = hornAt ? Math.max(base.advance + HORN_ROOM, hornAt.dx + markReach.get('horncomb')! + HORN_SIDE) : base.advance;
    glyphs.push({ name: def.name, ...(def.unicode === undefined ? {} : { unicode: def.unicode }), advance, contours: [], components, anchors: [], mark: false });
    byName.set(def.name, glyphs[glyphs.length - 1]!);
  }

  placeAll([...PLACED, ...GREEK_TONOS, ...SMALL_CAP_PLACED, ...CASE_FORMS]);


  for (const accent of SPACING_ACCENTS) {
    const mark = byName.get(accent.mark)!;
    const own = anchorOf(mark, `_${markAttach.get(accent.mark)}`)!;
    const at = place({ x: 2.5, y: accent.below ? 0 : METRICS.xHeight + MARK_GAP.lower });
    glyphs.push({
      name: accent.name,
      unicode: accent.unicode,
      advance: 5,
      contours: [],
      components: [{ glyph: accent.mark, dx: at.x - own.x, dy: at.y - own.y }],
      anchors: [],
      mark: false,
    });
  }

  for (const space of SPACES) {
    const advance = space.advance === 'tabular' ? tabularAdvance : typeof space.advance === 'number' ? space.advance : byName.get(space.advance.like)!.advance;
    glyphs.push({ name: space.name, unicode: space.unicode, advance, contours: [], components: [], anchors: [], mark: false });
  }
  const master: Master = { family, style, weight, glyphs };
  glyphs.push(...codeLigatureGlyphs(master, place, italic ? ITALIC_SLOPE : 0, undarkened));
  return master;
}

/**
 * The pieces of each code ligature (code-ligatures.ts): a blank spacer for every character but the last, and the last
 * drawing the whole shape, as components, back over them. The shape is its parts set with `joint` of white between
 * their ink, so the whole is narrower than the characters set apart; shares are whole font units, as the compiler rounds.
 */
function codeLigatureGlyphs(master: Master, place: (p: Vec) => Vec, slope: number, undarkened: Map<string, Contour[]>): MasterGlyph[] {
  // Joints are measured on the upright drawing before Geld Dark Sans's inset, so the italic's bars meet as the roman's
  // do and both families get the same widths.
  const upright = (contours: Contour[]) => bounds(contours.map((c) => c.map((q) => ({ x: q.x - slope * (q.y - ITALIC_PIVOT), y: q.y }))));
  const all = new Map(master.glyphs.map((g) => [g.name, g]));
  const ink = (g: MasterGlyph, dx = 0, dy = 0): Contour[] => [
    ...(undarkened.get(g.name) ?? g.contours).map((c) => translate(c, dx, dy)),
    ...g.components.flatMap((cmp) => ink(all.get(cmp.glyph)!, dx + cmp.dx, dy + cmp.dy)),
  ];
  const byName = new Map(master.glyphs.map((g) => [g.name, g]));
  const byChar = new Map(master.glyphs.flatMap((g) => (g.unicode === undefined ? [] : [[String.fromCodePoint(g.unicode), g.name] as const])));
  const out: MasterGlyph[] = [];
  for (const lig of CODE_LIGATURES) {
    const chars = [...lig.text].map((ch) => byChar.get(ch));
    const parts = lig.whole ? [{ glyph: lig.whole }] : (lig.parts ?? []);
    if (chars.some((n) => !n) || parts.some((part) => !byName.has(part.glyph))) continue;
    const placed: Component[] = [];
    let right = 0;
    let total = 0;
    parts.forEach((part, i) => {
      const glyph = byName.get(part.glyph)!;
      const box = upright(ink(glyph));
      const dy = 'centre' in part && part.centre ? MATH_AXIS - (box.minY + box.maxY) / 2 : 0;
      const dx = i === 0 ? 0 : right + (lig.joint ?? 0) - box.minX;
      const at = place({ x: dx, y: dy });
      const origin = place({ x: 0, y: 0 });
      placed.push({ glyph: part.glyph, dx: at.x - origin.x, dy });
      right = dx + box.maxX;
      total = dx + glyph.advance;
    });
    const n = chars.length;
    const share = Math.floor((total / n) * UNIT) / UNIT;
    chars.forEach((charName, i) => {
      const last = i === n - 1;
      const back = share * (n - 1);
      out.push({
        name: codePieceName(charName!, lig, i),
        advance: last ? total - back : share,
        contours: [],
        components: last ? placed.map((cmp) => ({ ...cmp, dx: cmp.dx - back })) : [],
        anchors: [],
        mark: false,
      });
    });
  }
  return out;
}

/**
 * The historical ligatures ct, st and sp (hlig): the first letter's top terminal rises as a stem and crosses, squared
 * with the font's 45° cuts, to the second letter's stem, flush with t's top or over the x-height into p's. The second
 * letter moves right just enough to leave an open counter under the arch, as wide as the weight needs.
 */
export const ARCH_LIGATURES = [['c', 't'], ['s', 't'], ['s', 'p']] as const;

function archLigature(parts: readonly [string, string], glyphs: MasterGlyph[], g: DrawContext, slope: number, snap: boolean) {
  const [a, b] = parts.map((n) => glyphs.find((x) => x.name === n));
  if (!a || !b) return undefined;
  const xsAt = (gl: MasterGlyph, y: number) =>
    gl.contours.flatMap((c) => c.flatMap((p0, i) => {
      const p1 = c[(i + 1) % c.length]!;
      return (p0.y <= y && p1.y > y) || (p1.y <= y && p0.y > y) ? [p0.x + ((y - p0.y) / (p1.y - p0.y)) * (p1.x - p0.x)] : [];
    }));
  const barY = METRICS.xHeight - g.h / 2;
  const rise = { x: Math.max(...xsAt(a, barY)) - g.v / 2, y: barY };
  const bBox = bounds(b.contours);
  const stemY = b.name === 't' ? bBox.maxY - 0.5 : METRICS.xHeight - g.h - 0.5;
  const stem = Math.min(...xsAt(b, stemY));
  const counter = Math.max(2, 1.2 * g.v);
  const step = (n: number) => Math.floor(toFontUnits(n) + 0.5) / UNIT;
  const shift = step(Math.max(0, rise.x + g.v / 2 + counter - (a.advance + stem)));
  const second = step(a.advance) + shift;
  const end = second + stem + g.v / 2;
  const top = b.name === 't' ? bBox.maxY - g.h / 2 : METRICS.xHeight + Math.max(2.5, g.v + 1);
  const path = b.name === 't'
    ? open(p(rise.x, rise.y), p(rise.x, top, true), p(end, top))
    : open(p(rise.x, rise.y), p(rise.x, top, true), p(end, top, true), p(end, METRICS.xHeight - g.h - g.v));
  return {
    parts,
    second,
    caret: step(a.advance) + shift / 2,
    advance: second + step(b.advance),
    contours: snap ? snapJoined(expandStroke(path, g.pen, slope), 0.5) : expandStroke(path, g.pen, slope),
  };
}

/** A glyph's outline with its components drawn in, for tests and checks. */
export function flatten(master: Master, glyph: MasterGlyph): Contour[] {
  const byName = new Map(master.glyphs.map((g) => [g.name, g]));
  const walk = (g: MasterGlyph, dx: number, dy: number): Contour[] => [
    ...g.contours.map((c) => translate(c, dx, dy)),
    ...g.components.flatMap((c) => walk(byName.get(c.glyph)!, dx + c.dx, dy + c.dy)),
  ];
  return walk(glyph, 0, 0);
}
