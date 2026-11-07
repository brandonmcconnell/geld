import { accentedFromUnicode, LATIN_RANGES, PLACED, SPACING_ACCENTS } from './composites';
import { drawContext } from './draw';
import { bounds, type Contour, expandStroke, insetContour, shear, snap, translate, type Vec } from './geometry';
import { GLYPHS, SPACES } from './glyphs';
import { DARK_INSET_RATIO, ITALIC_SLOPE, METRICS, type Weight, weightParams } from './grid';
import { type Attachment, MARK_GAP, MARK_HEIGHT, MARKS } from './marks';

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

/** Where marks attach to a drawn glyph, from its Geld Sans outline: centred above and below, the ogonek under the last stroke. */
function baseAnchors(contours: Contour[], upper: boolean, v: number, name: string): Anchor[] {
  if (!contours.length) return [];
  const box = bounds(contours);
  const cx = (box.minX + box.maxX) / 2;
  const gap = upper ? MARK_GAP.case : MARK_GAP.lower;
  const topright = name === 'L' ? { x: box.minX + v + 0.9, y: METRICS.cap - 3 } : { x: box.maxX + 0.9, y: box.maxY - 3 };
  return [
    { name: 'top', x: cx, y: box.maxY + gap },
    { name: 'bottom', x: cx, y: 0 },
    { name: 'ogonek', x: box.maxX - v / 2, y: 0 },
    { name: 'topright', ...topright },
    { name: 'horn', x: box.maxX - 0.3, y: box.maxY - 2.5 },
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
    const g = def.lower ? lower : upper;
    const strokes = italic && def.italic ? def.italic(g) : def.draw(g);
    let contours = strokes.flatMap((stroke) => expandStroke(stroke, g.pen, slope));
    if (params.snap && !italic) contours = contours.map((c) => snap(c, 0.5));
    const box = bounds(contours);
    contours = contours.map((c) => translate(c, def.lsb - box.minX));
    const advance = def.lsb + (box.maxX - box.minX) + def.rsb;
    const anchors = baseAnchors(contours, isUpperChar(def.unicode), params.v, def.name);
    return {
      name: def.name,
      ...(def.unicode === undefined ? {} : { unicode: def.unicode }),
      advance,
      contours: finish(contours),
      components: [],
      anchors: placeAnchors(anchors),
      mark: false,
    };
  });

  const markAttach = new Map<string, Attachment>();
  for (const def of MARKS)
    for (const form of def.caseForm ? (['lower', 'case'] as const) : (['lower'] as const)) {
      const height = MARK_HEIGHT[form];
      const contours = def.draw(lower, height).flatMap((stroke) => expandStroke(stroke, lower.pen, slope));
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

  for (const def of accentedFromUnicode(LATIN_RANGES, names, caseMarks)) {
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
    glyphs.push({ name: def.name, unicode: def.unicode, advance: base.advance + horn, contours: [], components, anchors: [], mark: false });
    byName.set(def.name, glyphs[glyphs.length - 1]!);
  }

  for (const def of PLACED) {
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
    glyphs.push({ name: def.name, unicode: def.unicode, advance, contours: [], components, anchors: [], mark: false });
    byName.set(def.name, glyphs[glyphs.length - 1]!);
  }

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
