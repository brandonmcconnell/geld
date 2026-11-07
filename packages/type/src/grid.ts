/** One grid unit in font units: 1 em = 20 grid units, so at 20px a grid unit is 1px. */
export const UNIT = 50;
export const UPM = 20 * UNIT;

/** Vertical metrics in grid units, from the wordmark's 14-unit caps. */
export const METRICS = {
  cap: 14,
  xHeight: 10,
  ascender: 15,
  descender: -4,
  /** Line box: 19 + 5 = 24 units, a 1.2 line height. */
  lineAscender: 19,
  lineDescender: -5,
} as const;

export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type Weight = (typeof WEIGHTS)[number];

export const WEIGHT_NAMES: Record<Weight, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

/** Vertical cap stem per weight, in grid units. SemiBold is the wordmark's 2. */
const STEMS: Record<Weight, number> = {
  100: 0.45,
  200: 0.8,
  300: 1.2,
  400: 1.6,
  500: 1.8,
  600: 2,
  700: 2.4,
  800: 2.85,
  900: 3.3,
};

/** Horizontals thin as the weight grows, so three of them still fit an x-height at Black. */
const CONTRAST: Record<Weight, number> = {
  100: 1,
  200: 1,
  300: 1,
  400: 1,
  500: 1,
  600: 1,
  700: 0.95,
  800: 0.89,
  900: 0.84,
};

/** Lowercase horizontals are lighter than the caps', so three of them fit an x-height. */
export const LOWERCASE_CONTRAST = 0.88;

/** The outer leg a cut aims for, and the least its inner leg may shrink to at heavy weights. */
export const CUT_OUTER = 2;
export const CUT_INNER_MIN = 0.5;

/** Geld Dark Sans insets every edge by a tenth of the stem: 0.2 units at SemiBold, as the dark logo does. */
export const DARK_INSET_RATIO = 0.1;

/** The slope of the italic: 1 unit across for every 7 up, so 14-unit caps lean exactly 2 units. */
export const ITALIC_SLOPE = 1 / 7;

export interface WeightParams {
  weight: Weight;
  /** Vertical stem. */
  v: number;
  /** Horizontal stroke. */
  h: number;
  /** Whether outlines snap to the half-unit grid, which only the grid weight does. */
  snap: boolean;
}

export function weightParams(weight: Weight): WeightParams {
  const v = STEMS[weight];
  return { weight, v, h: v * CONTRAST[weight], snap: weight === 600 };
}

export function toFontUnits(units: number): number {
  return Math.round(units * UNIT * 100) / 100;
}
