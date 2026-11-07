/**
 * The web package: the unicode-range subsets every web font is cut into, the files they are written to, and the CSS
 * that serves them, with fallback faces sized so text does not move when Geld arrives, and one class per feature.
 */
import { ALTERNATES, STYLISTIC_SETS } from './alternates';
import { CODE_GROUPS } from './code-ligatures';
import { METRICS, toFontUnits, UPM, WEIGHTS, type Weight } from './grid';
import type { Family, Master, Style } from './master';

/** Parses a CSS unicode-range list ("U+0000-00FF, U+0131") into inclusive ranges. */
function parseRanges(text: string): [number, number][] {
  return text.split(',').map((part) => {
    const [from, to] = part.trim().replace(/^U\+/, '').split('-');
    return [parseInt(from!, 16), parseInt(to ?? from!, 16)];
  });
}

/**
 * The subsets, as Google Fonts cuts its families, so a page loads only the scripts it shows. A character may sit in
 * several (combining marks), which costs a few bytes and nothing else. Every character no subset names goes to
 * `symbols`: arrows, box drawing, dingbats and Geld's own emblem.
 */
export const SUBSETS: { name: string; ranges: [number, number][] }[] = [
  {
    name: 'latin',
    ranges: parseRanges(
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    ),
  },
  {
    name: 'latin-ext',
    ranges: parseRanges(
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    ),
  },
  {
    name: 'vietnamese',
    ranges: parseRanges('U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB'),
  },
  { name: 'greek', ranges: parseRanges('U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF') },
  { name: 'greek-ext', ranges: parseRanges('U+1F00-1FFF') },
  { name: 'cyrillic', ranges: parseRanges('U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116') },
  { name: 'cyrillic-ext', ranges: parseRanges('U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F') },
];

export const SYMBOLS = 'symbols';

/** The subsets a font with these characters is cut into, each with the characters it holds; empty ones are left out. */
export function subsetsFor(codepoints: number[]): { name: string; codepoints: number[] }[] {
  const named = new Set<number>();
  const out = SUBSETS.map(({ name, ranges }) => {
    const held = codepoints.filter((cp) => ranges.some(([from, to]) => cp >= from && cp <= to));
    for (const cp of held) named.add(cp);
    return { name, codepoints: held };
  });
  out.push({ name: SYMBOLS, codepoints: codepoints.filter((cp) => !named.has(cp)) });
  return out.filter((subset) => subset.codepoints.length > 0);
}

/** A CSS unicode-range for these characters, runs collapsed: "U+0041-005A, U+00C0". */
export function unicodeRange(codepoints: number[]): string {
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const cp of sorted) {
    const last = runs.at(-1);
    if (last && cp === last[1] + 1) last[1] = cp;
    else runs.push([cp, cp]);
  }
  const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, '0');
  return runs.map(([from, to]) => (from === to ? `U+${hex(from)}` : `U+${hex(from)}-${hex(to)}`)).join(', ');
}

export const familyName = (family: Family) => (family === 'sans' ? 'Geld Sans' : 'Geld Dark Sans');
const slug = (family: Family) => (family === 'sans' ? 'geld-sans' : 'geld-dark-sans');

/** A web font's file: `geld-sans-latin-wght-normal.woff2` for the variable font, `geld-sans-latin-700-italic.woff2` for a static. */
export function webFileName(family: Family, subset: string, weight: Weight | 'wght', style: Style): string {
  return `${slug(family)}-${subset}-${weight}-${style === 'italic' ? 'italic' : 'normal'}.woff2`;
}

/** Arial's advances (2048 units) for a to z and the space, measured from the metric-compatible Liberation Sans. */
const ARIAL_WIDTHS: Record<'regular' | 'bold', number[]> = {
  regular: [1139, 1139, 1024, 1139, 1139, 569, 1139, 1139, 455, 455, 1024, 455, 1706, 1139, 1139, 1139, 1139, 682, 1024, 569, 1139, 1024, 1479, 1024, 1024, 1024, 569],
  bold: [1139, 1251, 1139, 1251, 1139, 682, 1251, 1251, 569, 569, 1139, 569, 1821, 1251, 1251, 1251, 1251, 797, 1139, 682, 1251, 1139, 1593, 1139, 1139, 1024, 569],
};

/** English letter frequencies (percent) for a to z, then the space: one per 4.7 letters, the average English word. */
const FREQUENCIES = [8.167, 1.492, 2.782, 4.253, 12.702, 2.228, 2.015, 6.094, 6.966, 0.153, 0.772, 4.025, 2.406, 6.749, 7.507, 1.929, 0.095, 5.987, 6.327, 9.056, 2.758, 0.978, 2.36, 0.15, 1.974, 0.074, 21.3];
const RUNNING_TEXT = [...'abcdefghijklmnopqrstuvwxyz', 'space'];

function averageWidth(widths: number[], unitsPerEm: number): number {
  const total = FREQUENCIES.reduce((sum, f) => sum + f, 0);
  return widths.reduce((sum, w, i) => sum + w * FREQUENCIES[i]!, 0) / total / unitsPerEm;
}

/**
 * A fallback face for one style and weight band: Arial scaled to Geld's average width in running text and given
 * Geld's line box, so a page set in it lines and wraps as it will once Geld has loaded.
 */
export function fallbackFace(master: Master, band: 'regular' | 'bold'): string {
  const advance = new Map(master.glyphs.map((g) => [g.name, toFontUnits(g.advance)]));
  const geld = averageWidth(RUNNING_TEXT.map((name) => advance.get(name)!), UPM);
  const sizeAdjust = geld / averageWidth(ARIAL_WIDTHS[band], 2048);
  const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const italic = master.style === 'italic';
  const arial = band === 'bold' ? (italic ? ['Arial Bold Italic', 'Arial-BoldItalicMT', 'Liberation Sans Bold Italic'] : ['Arial Bold', 'Arial-BoldMT', 'Liberation Sans Bold']) : italic ? ['Arial Italic', 'Arial-ItalicMT', 'Liberation Sans Italic'] : ['Arial', 'ArialMT', 'Liberation Sans'];
  return [
    '@font-face {',
    `  font-family: "${familyName(master.family)} Fallback";`,
    `  src: ${arial.map((name) => `local("${name}")`).join(', ')};`,
    `  font-style: ${italic ? 'italic' : 'normal'};`,
    `  font-weight: ${band === 'bold' ? '550 900' : '100 549'};`,
    `  size-adjust: ${percent(sizeAdjust)};`,
    `  ascent-override: ${percent(toFontUnits(METRICS.lineAscender) / UPM / sizeAdjust)};`,
    `  descent-override: ${percent(-toFontUnits(METRICS.lineDescender) / UPM / sizeAdjust)};`,
    '  line-gap-override: 0%;',
    '}',
  ].join('\n');
}

/** Which characters each style's subsets hold: subset name to code points. */
export type SubsetMap = Record<Style, { name: string; codepoints: number[] }[]>;

/**
 * The @font-face rules for one family: the variable fonts (one rule per style and subset, the whole weight range) or
 * the statics (one per style, weight and subset), then the fallback faces.
 */
export function fontFaceCss(family: Family, subsets: SubsetMap, variable: boolean, fallbacks: string[]): string {
  const rules: string[] = [];
  for (const style of ['roman', 'italic'] as const)
    for (const weight of variable ? (['wght'] as const) : WEIGHTS)
      for (const subset of subsets[style])
        rules.push(
          [
            `/* ${subset.name} */`,
            '@font-face {',
            `  font-family: "${familyName(family)}";`,
            `  src: url("./${webFileName(family, subset.name, weight, style)}") format("woff2");`,
            `  font-style: ${style === 'italic' ? 'italic' : 'normal'};`,
            `  font-weight: ${weight === 'wght' ? '100 900' : weight};`,
            '  font-display: swap;',
            `  unicode-range: ${unicodeRange(subset.codepoints)};`,
            '}',
          ].join('\n'),
        );
  return `${[...rules, ...fallbacks].join('\n\n')}\n`;
}

/**
 * Every optional feature, as `.geld-<tag>` classes that combine: each class sets its own custom property and one rule
 * reads them all, so `class="geld-ss01 geld-cv21"` turns both on and a child's class adds to its parent's.
 */
export function featureCss(): string {
  const sets: Record<string, string> = { ...STYLISTIC_SETS, ss10: CODE_GROUPS.prose.label!, ss18: 'Italic swashes', ss20: 'Plain arrows (turns -> back into two characters)' };
  for (const group of Object.values(CODE_GROUPS)) if (group.feature && group.label) sets[group.feature] = group.label;
  const cvs: Record<string, string> = {};
  for (const alt of ALTERNATES) cvs[alt.cv] ??= alt.label;
  const named: [string, string][] = [
    ['dlig', 'Code ligatures, symbol forms and the Geld lockup'],
    ['hlig', 'Historical ligatures: ct, st, sp'],
    ['salt', 'Each letter’s first alternate'],
    ['swsh', 'Swashes'],
    ['cswh', 'Contextual swashes at word ends'],
    ...Object.entries(sets),
    ...Object.entries(cvs),
  ];
  named.sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
  const classes = named.map(([tag, label]) => `/* ${label} */\n.geld-${tag} { --geld-${tag}: "${tag}" 1; }`);
  const selector = named.map(([tag]) => `.geld-${tag}`).join(',\n');
  const settings = named.map(([tag]) => `var(--geld-${tag}, "${tag}" 0)`).join(',\n    ');
  return `${classes.join('\n')}\n\n${selector} {\n  font-feature-settings:\n    ${settings};\n}\n`;
}

/** The standard features, by the CSS that turns each on: what the package's README tells authors. */
const STANDARD_FEATURES: [string, string][] = [
  ['font-variant-caps: small-caps', 'Small capitals for lowercase (smcp)'],
  ['font-variant-caps: all-small-caps', 'Small capitals for both cases (smcp, c2sc)'],
  ['font-variant-numeric: oldstyle-nums', 'Oldstyle figures (onum)'],
  ['font-variant-numeric: lining-nums', 'Lining figures (lnum, the default)'],
  ['font-variant-numeric: tabular-nums', 'Tabular figures, for columns (tnum)'],
  ['font-variant-numeric: proportional-nums', 'Proportional figures (pnum, the default)'],
  ['font-variant-numeric: diagonal-fractions', 'Fractions from figures and a slash (frac, numr, dnom)'],
  ['font-variant-numeric: ordinal', 'Ordinals: 1st, 2º (ordn)'],
  ['font-variant-numeric: slashed-zero', 'Slashed zero (zero)'],
  ['font-variant-position: super', 'Superiors (sups)'],
  ['font-variant-position: sub', 'Inferiors (subs)'],
  ['font-feature-settings: "sinf"', 'Scientific inferiors, for chemical formulas (sinf)'],
  ['font-variant-ligatures: discretionary-ligatures', 'Code ligatures, symbol forms and the Geld lockup (dlig)'],
  ['font-variant-ligatures: historical-ligatures', 'ct, st and sp (hlig)'],
  ['font-variant-ligatures: no-contextual', 'Turns off contextual forms, the arrows among them (calt)'],
  ['font-feature-settings: "case"', 'Case-sensitive punctuation, for text in capitals (case)'],
  ['font-feature-settings: "cpsp"', 'Capital spacing, for text in capitals (cpsp)'],
  ['font-feature-settings: "swsh"', 'Swashes (swsh; also `.geld-swsh`)'],
  ['font-feature-settings: "ornm"', 'Ornaments for the bullet (ornm)'],
];

/** The labels of every feature class, for the package's README. */
export function featureLabels(): [string, string][] {
  return [...featureCss().matchAll(/^\/\* (.+) \*\/\n\.geld-([a-z0-9]+) \{/gm)].map((match) => [match[2]!, match[1]!]);
}

/**
 * The published font package, rooted at dist/: the web fonts and CSS, the variable and static fonts. Its licence is
 * left to the owner to add (D16), as every licence change in this repository is.
 */
export function fontPackageJson(version: string): string {
  const css = ['geld-sans', 'geld-sans-static', 'geld-dark-sans', 'geld-dark-sans-static', 'geld-features'];
  return `${JSON.stringify(
    {
      name: '@geld/fonts',
      version,
      description: 'Geld Sans and Geld Dark Sans: variable, static and web fonts, with CSS for the web fonts and their features.',
      files: ['web/*.woff2', 'web/*.css', 'variable/*.ttf', 'ttf/*.ttf', 'otf/*.otf', 'README.md'],
      exports: {
        ...Object.fromEntries(css.map((name) => [`./${name}.css`, `./web/${name}.css`])),
        './web/*': './web/*',
        './variable/*': './variable/*',
        './ttf/*': './ttf/*',
        './otf/*': './otf/*',
      },
      style: './web/geld-sans.css',
      sideEffects: ['*.css'],
    },
    null,
    2,
  )}\n`;
}

/** The package's README: how to load each family and turn its features on. */
export function fontPackageReadme(version: string): string {
  return [
    '# Geld Sans',
    '',
    `Version ${version}. Geld Sans and Geld Dark Sans, its grade for light text on dark backgrounds, drawn on the Geld brand grid in nine weights (100 to 900), roman and italic.`,
    '',
    '## On the web',
    '',
    '```css',
    '@import "@geld/fonts/geld-sans.css"; /* the variable fonts: every weight in one file per style and script */',
    '@import "@geld/fonts/geld-features.css"; /* optional: one class per feature */',
    '',
    'body { font-family: "Geld Sans", "Geld Sans Fallback", sans-serif; }',
    '@media (prefers-color-scheme: dark) { body { font-family: "Geld Dark Sans", "Geld Dark Sans Fallback", sans-serif; } }',
    '```',
    '',
    '`geld-sans-static.css` serves one file per weight instead. Each font is cut by `unicode-range` (latin, latin-ext, vietnamese, greek, cyrillic, cyrillic-ext and symbols), so a page loads only the scripts it shows. The fallback faces are Arial sized to Geld\'s widths and line height, so text does not move when the fonts arrive. Geld Dark Sans has the same widths as Geld Sans, so switching between them never reflows text.',
    '',
    '## Features',
    '',
    'Code arrows (`->` drawn as an arrow, the text unchanged), kerning, ligatures and case-sensitive forms are on by default. Everything else is a class from `geld-features.css`; classes combine, and a child\'s class adds to its parent\'s:',
    '',
    '```html',
    '<code class="geld-dlig">a != b && c >= d</code>',
    '<p class="geld-ss01 geld-cv21">…</p>',
    '```',
    '',
    '| Class | Feature |',
    '| --- | --- |',
    ...featureLabels().map(([tag, label]) => `| \`geld-${tag}\` | ${label.replace(/\|/g, '\\|')} |`),
    '',
    'The same features are available by tag with `font-feature-settings`, for example `font-feature-settings: "ss01", "cv21";`.',
    '',
    '## Standard features in CSS',
    '',
    '| CSS | Feature |',
    '| --- | --- |',
    ...STANDARD_FEATURES.map(([css, feature]) => `| \`${css}\` | ${feature} |`),
    '',
    'Kerning, standard ligatures, contextual alternates (the arrows), mark positioning and composition are on by default. Set `lang` on the page for local forms (Bulgarian, Macedonian and Serbian Cyrillic, Turkish and Azeri i).',
    '',
  ].join('\n');
}
