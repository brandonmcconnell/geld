import { bounds, type Contour, expandStroke, insetContour, shear, snap, translate } from './geometry';
import { drawContext, GLYPHS, SPACES } from './glyphs';
import { DARK_INSET_RATIO, ITALIC_SLOPE, METRICS, type Weight, weightParams } from './grid';

/** Italics lean around the middle of the x-height, so a slanted glyph stays centred in its advance. */
const ITALIC_PIVOT = METRICS.xHeight / 2;

export type Family = 'sans' | 'dark';
export type Style = 'roman' | 'italic';

export const FAMILY_NAMES: Record<Family, string> = {
  sans: 'Geld Sans',
  dark: 'Geld Dark Sans',
};

export interface MasterGlyph {
  name: string;
  unicode?: number;
  /** Advance in grid units. */
  advance: number;
  /** Contours in grid units. */
  contours: Contour[];
}

export interface Master {
  family: Family;
  style: Style;
  weight: Weight;
  glyphs: MasterGlyph[];
}

/**
 * Draws every glyph for one master. Geld Dark Sans starts from the Geld Sans outline, placed and
 * spaced the same, and insets it, so the two families share every advance width.
 */
export function buildMaster(family: Family, style: Style, weight: Weight): Master {
  const params = weightParams(weight);
  const upper = drawContext(params.v, params.h);
  const lower = drawContext(params.v, params.hl, true);
  const glyphs: MasterGlyph[] = GLYPHS.map((def) => {
    const g = def.lower ? lower : upper;
    const italic = style === 'italic';
    const strokes = italic && def.italic ? def.italic(g) : def.draw(g);
    let contours = strokes.flatMap((stroke) => expandStroke(stroke, g.pen, italic ? ITALIC_SLOPE : 0));
    if (params.snap && !italic) contours = contours.map((c) => snap(c, 0.5));
    const box = bounds(contours);
    contours = contours.map((c) => translate(c, def.lsb - box.minX));
    const advance = def.lsb + (box.maxX - box.minX) + def.rsb;
    if (family === 'dark') contours = contours.map((c) => insetContour(c, params.v * DARK_INSET_RATIO));
    if (italic) contours = contours.map((c) => translate(shear(c, ITALIC_SLOPE), -ITALIC_SLOPE * ITALIC_PIVOT));
    return { name: def.name, ...(def.unicode === undefined ? {} : { unicode: def.unicode }), advance, contours };
  });
  for (const space of SPACES) glyphs.push({ name: space.name, unicode: space.unicode, advance: space.advance, contours: [] });
  return { family, style, weight, glyphs };
}
