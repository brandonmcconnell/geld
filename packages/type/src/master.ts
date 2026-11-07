import { accentedFromUnicode, ALIASES, GREEK_TONOS, LATIN_RANGES, PLACED, type PlacedDef, SPACING_ACCENTS } from './composites';
import { type DrawContext, drawContext, type GlyphDef, smallCapContext } from './draw';
import { measuredSidebearings, type SpacingZone } from './spacing';
import { bounds, type Contour, expandStroke, insetContour, shear, snap, translate, type Vec, winding } from './geometry';
import { GLYPHS, SPACES } from './glyphs';
import { CYRILLIC_LOCL_ACCENTED } from './glyphs-cyrillic';
import { DARK_INSET_RATIO, ITALIC_SLOPE, METRICS, type Weight, weightParams } from './grid';
import { type Attachment, BELOW_GAP, MARK_GAP, MARK_HEIGHT, MARKS } from './marks';

/** Italics lean around the middle of the x-height, so a slanted glyph stays centred in its advance. */
const ITALIC_PIVOT = METRICS.xHeight / 2;
/** Ơ Ư ơ ư are wider than O U o u by the horn that reaches out of them. */
const HORN_ROOM = 1.5;

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
  if (/\p{Nd}/u.test(c)) return { bottom: 0, top: g.cap, target: 1.3, depth: 2.5, min: 0.3 };
  if (!/\p{L}/u.test(c) || /\p{Lm}/u.test(c)) return undefined;
  if (def.lower || /\p{Ll}/u.test(c)) return { bottom: 0, top: METRICS.xHeight, target: 1.45, depth: 2, min: 0.15 };
  return { bottom: 0, top: g.cap, target: 1.6, depth: 2.8, min: 0.2 };
}

/** Math operators share one width, their ink centred in it, so a row of + − = × ÷ aligns. */
const MATH_OPERATORS = ['plus', 'minus', 'equal', 'multiply', 'divide', 'less', 'greater', 'approxequal', 'notequal', 'asciitilde', 'plusminus', 'logicalnot', 'lessequal', 'greaterequal'];
const MATH_SIDE = 1.25;

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
  const finish = (contours: Contour[]) => {
    let out = contours;
    if (family === 'dark') out = out.map((c) => insetContour(c, params.v * DARK_INSET_RATIO));
    if (italic) out = out.map((c) => translate(shear(c, ITALIC_SLOPE), -ITALIC_SLOPE * ITALIC_PIVOT));
    return out;
  };
  const place = (p: Vec): Vec => (italic ? { x: p.x + p.y * ITALIC_SLOPE - ITALIC_SLOPE * ITALIC_PIVOT, y: p.y } : p);
  const placeAnchors = (anchors: Anchor[]) => anchors.map((a) => ({ ...a, ...place(a) }));

  const glyphs: MasterGlyph[] = GLYPHS.map((def) => {
    const cursive = italic && def.italic !== undefined;
    const g = def.smallcap && !cursive ? small : def.lower || def.smallcap ? lower : upper;
    const strokes = cursive ? def.italic!(g) : def.draw(g);
    let contours = strokes.flatMap((stroke) => expandStroke(stroke, g.pen, slope));
    if (params.snap && !italic) contours = contours.map((c) => snap(c, 0.5));
    const box = bounds(contours);
    const zone = spacingZone(def, g);
    const { lsb, rsb } = zone ? measuredSidebearings(contours, box.minX, box.maxX, zone) : def;
    contours = contours.map((c) => translate(c, lsb - box.minX));
    const advance = lsb + (box.maxX - box.minX) + rsb;
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

  const operators = glyphs.filter((gl) => MATH_OPERATORS.includes(gl.name));
  const inkWidth = (gl: MasterGlyph) => {
    const b = bounds(gl.contours);
    return b.maxX - b.minX;
  };
  const mathAdvance = Math.max(...operators.map(inkWidth)) + 2 * MATH_SIDE;
  for (const gl of operators) {
    const b = bounds(gl.contours);
    const dx = (mathAdvance - (b.maxX - b.minX)) / 2 - b.minX;
    gl.contours = gl.contours.map((c) => translate(c, dx));
    gl.anchors = gl.anchors.map((a) => ({ ...a, x: a.x + dx }));
    gl.advance = mathAdvance;
  }
  for (const gl of glyphs) {
    gl.contours = finish(gl.contours);
    gl.anchors = placeAnchors(gl.anchors);
  }

  const markAttach = new Map<string, Attachment>();
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
      glyphs.push({
        name,
        ...(form === 'lower' && def.unicode !== undefined ? { unicode: def.unicode } : {}),
        advance: 0,
        contours: finish(contours),
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
      glyphs.push({ name: def.name, unicode: def.unicode, advance, contours: [], components, anchors, mark: false });
      byName.set(def.name, glyphs[glyphs.length - 1]!);
      names.set(def.unicode, def.name);
    }
  };
  placeAll(ALIASES);

  for (const def of [...accentedFromUnicode(LATIN_RANGES, names, caseMarks), ...CYRILLIC_LOCL_ACCENTED]) {
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
    const horn = def.marks.includes('horncomb') ? HORN_ROOM : 0;
    glyphs.push({ name: def.name, ...(def.unicode === undefined ? {} : { unicode: def.unicode }), advance: base.advance + horn, contours: [], components, anchors: [], mark: false });
    byName.set(def.name, glyphs[glyphs.length - 1]!);
  }

  placeAll([...PLACED, ...GREEK_TONOS]);


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

  for (const space of SPACES)
    glyphs.push({ name: space.name, unicode: space.unicode, advance: space.advance, contours: [], components: [], anchors: [], mark: false });
  return { family, style, weight, glyphs };
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
