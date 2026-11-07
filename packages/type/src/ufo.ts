import { ITALIC_SLOPE, METRICS, toFontUnits, UPM, WEIGHT_NAMES, type Weight, WEIGHTS, weightParams } from './grid';
import { LOCL, type LoclLanguage } from './glyphs-cyrillic';
import { FIGURE_NAMES, TABULAR_SIGNS } from './glyphs-figures';
import { VIETNAMESE_PAIRS } from './marks';
import type { Kerning } from './kerning';
import { type Alternate, ALTERNATES, alternateName, CIRCLED_NUMERALS, OCTAGONAL_DOTS, STYLISTIC_SETS } from './alternates';
import { CODE_GROUPS, CODE_LIGATURES, CODE_OPERATORS, type CodeGroup, codePieceName } from './code-ligatures';
import { LOCKUP } from './lockup';
import { ARCH_LIGATURES, FAMILY_NAMES, type Family, type Master, type Style, TEXT_LIGATURES } from './master';

const VERSION = { major: 0, minor: 1 };

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

function plistValue(value: PlistValue, indent: string): string {
  if (typeof value === 'string') return `${indent}<string>${escape(value)}</string>`;
  if (typeof value === 'boolean') return `${indent}<${value}/>`;
  if (typeof value === 'number') return Number.isInteger(value) ? `${indent}<integer>${value}</integer>` : `${indent}<real>${value}</real>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<array/>`;
    return [`${indent}<array>`, ...value.map((v) => plistValue(v, `${indent}  `)), `${indent}</array>`].join('\n');
  }
  const entries = Object.entries(value);
  return [
    `${indent}<dict>`,
    ...entries.flatMap(([k, v]) => [`${indent}  <key>${escape(k)}</key>`, plistValue(v, `${indent}  `)]),
    `${indent}</dict>`,
  ].join('\n');
}

export function plist(value: PlistValue): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    plistValue(value, ''),
    '</plist>',
    '',
  ].join('\n');
}

/** UFO's own file name rule: a capital letter is followed by an underscore, so files differ on case-insensitive disks. */
export function glifFileName(name: string): string {
  const base = name.replace(/[A-Z]/g, (c) => `${c}_`).replace(/^\./, '_');
  return `${base}.glif`;
}

export function styleName(weight: Weight, style: Style): string {
  if (style === 'roman') return WEIGHT_NAMES[weight];
  return weight === 400 ? 'Italic' : `${WEIGHT_NAMES[weight]} Italic`;
}

/** Font menus group four styles per family (Regular, Italic, Bold, Bold Italic); every other weight is a family of its own there. */
export function styleMap(family: Family, weight: Weight, style: Style): { familyName: string; styleName: string } {
  const base = FAMILY_NAMES[family];
  const ribbi = weight === 400 || weight === 700;
  const bold = weight === 700;
  const italic = style === 'italic';
  return {
    familyName: ribbi ? base : `${base} ${WEIGHT_NAMES[weight]}`,
    styleName: [bold ? 'bold' : '', italic ? 'italic' : ''].filter(Boolean).join(' ') || 'regular',
  };
}

export function postscriptName(family: Family, weight: Weight, style: Style): string {
  return `${FAMILY_NAMES[family].replace(/\s/g, '')}-${styleName(weight, style).replace(/\s/g, '')}`;
}

export function sourceFileName(family: Family, style: Style, weight: Weight): string {
  return `${FAMILY_NAMES[family].replace(/\s/g, '')}-${style === 'roman' ? 'Roman' : 'Italic'}-${weight}.ufo`;
}

/** Underline and strikeout follow each weight's horizontal stroke, so decorations weigh what the letters do. */
export function decorationMetrics(weight: Weight): { underlinePosition: number; thickness: number; strikeoutPosition: number } {
  const { h } = weightParams(weight);
  const thickness = Math.min(1.5, Math.max(0.5, h * 0.7));
  return {
    underlinePosition: toFontUnits(-1.5),
    thickness: toFontUnits(thickness),
    strikeoutPosition: toFontUnits(METRICS.xHeight / 2 + thickness / 2),
  };
}

function fontInfo(master: Master): PlistValue {
  const { family, style, weight } = master;
  const map = styleMap(family, weight, style);
  const deco = decorationMetrics(weight);
  return {
    familyName: FAMILY_NAMES[family],
    styleName: styleName(weight, style),
    styleMapFamilyName: map.familyName,
    styleMapStyleName: map.styleName,
    postscriptFontName: postscriptName(family, weight, style),
    versionMajor: VERSION.major,
    versionMinor: VERSION.minor,
    copyright: 'Copyright 2026 The Geld Authors',
    openTypeNameDesigner: 'Brandon McConnell',
    openTypeNameManufacturer: 'Geld',
    openTypeNameManufacturerURL: 'https://www.geld.sh',
    unitsPerEm: UPM,
    capHeight: toFontUnits(METRICS.cap),
    xHeight: toFontUnits(METRICS.xHeight),
    ascender: toFontUnits(METRICS.ascender),
    descender: toFontUnits(METRICS.descender),
    italicAngle: style === 'italic' ? -Math.round((Math.atan(ITALIC_SLOPE) * 180) / Math.PI * 100) / 100 : 0,
    openTypeHheaAscender: toFontUnits(METRICS.lineAscender),
    openTypeHheaDescender: toFontUnits(METRICS.lineDescender),
    openTypeHheaLineGap: 0,
    openTypeHheaCaretSlopeRise: style === 'italic' ? 7 : 1,
    openTypeHheaCaretSlopeRun: style === 'italic' ? 1 : 0,
    openTypeOS2TypoAscender: toFontUnits(METRICS.lineAscender),
    openTypeOS2TypoDescender: toFontUnits(METRICS.lineDescender),
    openTypeOS2TypoLineGap: 0,
    openTypeOS2WinAscent: toFontUnits(METRICS.clipAscender),
    openTypeOS2WinDescent: -toFontUnits(METRICS.clipDescender),
    openTypeOS2WeightClass: weight,
    openTypeOS2WidthClass: 5,
    openTypeOS2Selection: [7],
    openTypeOS2Type: [],
    postscriptUnderlinePosition: deco.underlinePosition,
    postscriptUnderlineThickness: deco.thickness,
    openTypeOS2StrikeoutPosition: deco.strikeoutPosition,
    openTypeOS2StrikeoutSize: deco.thickness,
  };
}

function glif(glyph: Master['glyphs'][number]): string {
  const contours = glyph.contours
    .map((c) =>
      [
        '    <contour>',
        ...c.map((p) => `      <point x="${toFontUnits(p.x)}" y="${toFontUnits(p.y)}" type="line"/>`),
        '    </contour>',
      ].join('\n'),
    )
    .join('\n');
  const components = glyph.components
    .map((c) => `    <component base="${escape(c.glyph)}" xOffset="${toFontUnits(c.dx)}" yOffset="${toFontUnits(c.dy)}"/>`)
    .join('\n');
  const outline = [contours, components].filter(Boolean).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<glyph name="${escape(glyph.name)}" format="2">`,
    `  <advance width="${toFontUnits(glyph.advance)}"/>`,
    ...(glyph.unicode === undefined ? [] : [`  <unicode hex="${glyph.unicode.toString(16).toUpperCase().padStart(4, '0')}"/>`]),
    ...glyph.anchors.map((a) => `  <anchor x="${toFontUnits(a.x)}" y="${toFontUnits(a.y)}" name="${a.name}"/>`),
    outline ? `  <outline>\n${outline}\n  </outline>` : '  <outline/>',
    '</glyph>',
    '',
  ].join('\n');
}

/**
 * The hand-written part of the features; ufo2ft adds `mark`, `mkmk` and `kern` from anchors and kerning.
 * `ccmp` puts dotless i and j under marks above, and the flatter `.case` marks over capitals.
 * `locl` gives Bulgarian, Serbian and Macedonian text their own Cyrillic forms.
 */
const LOCL_LANGUAGES: LoclLanguage[] = ['BGR', 'SRB', 'MKD'];

/**
 * Figure features. Lining proportional figures are the default; `tnum`, `onum` and `zero` combine
 * (tabular oldstyle, slashed tabular zero…), the zero variants carried through every set.
 */
function figureFeatures(names: Set<string>): string[] {
  const set = (suffix: string) => [...FIGURE_NAMES.map((f) => `${f}${suffix}`), `zero${suffix}.zero`, `zero${suffix}.dot`].map((n) => n.replace(/^zero\.(zero|dot)$/, 'zero.$1'));
  const lining = set('');
  const tabular = set('.tf');
  const oldstyle = set('.osf');
  const tabularOldstyle = set('.tosf');
  const signs = Object.keys(TABULAR_SIGNS);
  const tabularSigns = signs.map((s) => `${s}.tf`);
  const subs = (from: string[], to: string[]) =>
    from.flatMap((f, i) => (names.has(f) && names.has(to[i]!) ? [`  sub ${f} by ${to[i]};`] : []));
  const feature = (tag: string, lines: string[]) => (lines.length ? [`feature ${tag} {`, ...lines, `} ${tag};`, ''] : []);
  const scripts = ['plus', 'minus', 'equal', 'parenleft', 'parenright', 'period', 'comma'];
  const superiors = [...FIGURE_NAMES.map((f) => `${f}superior`), ...scripts.map((s) => `${s}superior`)];
  const inferiors = [...FIGURE_NAMES.map((f) => `${f}inferior`), ...scripts.map((s) => `${s}inferior`)];
  const scripted = [...FIGURE_NAMES, ...scripts];
  const numerators = FIGURE_NAMES.map((f) => `${f}superior`);
  const denominators = FIGURE_NAMES.map((f) => `${f}.dnom`);
  return [
    ...feature('pnum', [...subs(tabular, lining), ...subs(tabularOldstyle, oldstyle), ...subs(tabularSigns, signs)]),
    ...feature('tnum', [...subs(lining, tabular), ...subs(oldstyle, tabularOldstyle), ...subs(signs, tabularSigns)]),
    ...feature('lnum', [...subs(oldstyle, lining), ...subs(tabularOldstyle, tabular)]),
    ...feature('onum', [...subs(lining, oldstyle), ...subs(tabular, tabularOldstyle)]),
    ...feature('zero', subs(['zero', 'zero.tf', 'zero.osf', 'zero.tosf'], ['zero.zero', 'zero.tf.zero', 'zero.osf.zero', 'zero.tosf.zero'])),
    ...feature('sups', subs(scripted, superiors)),
    ...feature('subs', subs(scripted, inferiors)),
    ...feature('sinf', subs(scripted, inferiors)),
    ...feature('numr', subs([...FIGURE_NAMES], numerators)),
    ...feature('dnom', subs([...FIGURE_NAMES], denominators)),
    'feature frac {',
    '  lookup FRAC_SLASH { sub slash by fraction; } FRAC_SLASH;',
    `  lookup FRAC_UP { sub [${FIGURE_NAMES.join(' ')}] by [${numerators.join(' ')}]; } FRAC_UP;`,
    `  lookup FRAC_DOWN { sub [fraction ${denominators.join(' ')}] [${numerators.join(' ')}]' by [${denominators.join(' ')}]; } FRAC_DOWN;`,
    '} frac;',
    '',
    ...(names.has('ordfeminine') ? ['feature ordn {', `  sub [${FIGURE_NAMES.join(' ')}] [a o]' by [ordfeminine ordmasculine];`, '} ordn;', ''] : []),
  ];
}

/**
 * Small caps: `smcp` takes lowercase letters to their small capitals, `c2sc` takes capitals (by
 * Unicode's case mapping), figures and & ! ¡. Turkish and Azeri i is the dotted small capital.
 */
function smallCapFeatures(master: Master, names: Set<string>): string[] {
  const byUnicode = new Map(master.glyphs.flatMap((g) => (g.unicode === undefined ? [] : [[g.unicode, g.name] as const])));
  const lower: string[] = [];
  const upper: string[] = [];
  for (const g of master.glyphs) {
    if (g.unicode === undefined || g.mark) continue;
    const c = String.fromCodePoint(g.unicode);
    if (/\p{Ll}/u.test(c) && names.has(`${g.name}.sc`)) lower.push(`  sub ${g.name} by ${g.name}.sc;`);
    if (!/\p{Lu}/u.test(c)) continue;
    const lc = [...c.toLowerCase()];
    const target = lc.length === 1 ? byUnicode.get(lc[0]!.codePointAt(0)!) : g.name === 'Idotaccent' ? 'idotaccent' : undefined;
    if (target && names.has(`${target}.sc`)) upper.push(`  sub ${g.name} by ${target}.sc;`);
  }
  const others = [...FIGURE_NAMES, 'ampersand', 'exclam', 'exclamdown'].filter((n) => names.has(`${n}.sc`)).map((n) => `  sub ${n} by ${n}.sc;`);
  const turkish = names.has('idotaccent.sc') ? ['  script latn;', ...['TRK', 'AZE'].flatMap((lang) => [`  language ${lang};`, '    sub i.sc by idotaccent.sc;'])] : [];
  if (!lower.length) return [];
  return ['feature smcp {', ...lower, ...turkish, '} smcp;', '', 'feature c2sc {', ...upper, ...others, '} c2sc;', ''];
}

export function features(master: Master): string {
  const names = new Set(master.glyphs.map((g) => g.name));
  const marks = master.glyphs.filter((g) => g.mark && !g.name.endsWith('.case') && names.has(`${g.name}.case`)).map((g) => g.name);
  const upper = master.glyphs
    .filter((g) => !g.mark && g.unicode !== undefined && /\p{Lu}/u.test(String.fromCodePoint(g.unicode)))
    .map((g) => g.name);
  const above = master.glyphs.filter((g) => g.mark && g.anchors.some((a) => a.name === '_top' || a.name === '_topright')).map((g) => g.name);
  const alternates = alternateFeatures(master, names);
  return [
    'languagesystem DFLT dflt;',
    'languagesystem latn dflt;',
    'languagesystem latn TRK;',
    'languagesystem latn AZE;',
    'languagesystem cyrl dflt;',
    ...LOCL_LANGUAGES.map((lang) => `languagesystem cyrl ${lang};`),
    'languagesystem grek dflt;',
    '',
    `@MarksAbove = [${above.join(' ')}];`,
    `@CaseMarks = [${marks.join(' ')}];`,
    `@CaseMarksCase = [${marks.map((m) => `${m}.case`).join(' ')}];`,
    `@Uppercase = [${upper.join(' ')}];`,
    '',
    ...alternates.aalt,
    'feature ccmp {',
    "  sub i' @MarksAbove by dotlessi;",
    "  sub j' @MarksAbove by dotlessj;",
    ...(names.has('i-cy') ? ["  sub i-cy' @MarksAbove by dotlessi;", "  sub je-cy' @MarksAbove by dotlessj;"] : []),
    "  sub @Uppercase @CaseMarks' by @CaseMarksCase;",
    "  sub @CaseMarksCase @CaseMarks' by @CaseMarksCase;",
    ...VIETNAMESE_PAIRS.flatMap(([first, second]) => [
      `  sub ${first} ${second} by ${first}_${second};`,
      `  sub ${first}.case ${second}.case by ${first}_${second}.case;`,
    ]),
    '} ccmp;',
    '',
    'feature locl {',
    '  script cyrl;',
    ...LOCL_LANGUAGES.flatMap((lang) => [
      `  language ${lang} exclude_dflt;`,
      ...LOCL[lang].filter(([from, to]) => names.has(from) && names.has(to)).map(([from, to]) => `    sub ${from} by ${to};`),
    ]),
    '} locl;',
    '',
    ...figureFeatures(names),
    ...smallCapFeatures(master, names),
    // After the small caps, so small-cap text keeps its own f and t.
    '',
    'feature liga {',
    ...TEXT_LIGATURES.filter((parts) => names.has(parts.join('_'))).map((parts) => `  sub ${parts.join(' ')} by ${parts.join('_')};`),
    '} liga;',
    // Historical, not discretionary: dlig is what code turns on, and std must not arch its s into its t.
    ...(ARCH_LIGATURES.some((parts) => names.has(parts.join('_')))
      ? ['feature hlig {', ...ARCH_LIGATURES.filter((parts) => names.has(parts.join('_'))).map((parts) => `  sub ${parts.join(' ')} by ${parts.join('_')};`), '} hlig;']
      : []),
    ...arrowFeatures(names),
    ...codeLigatureFeatures(master, names),
    ...caseFeatures(master, names),
    ...alternates.rest,
    // Only as a word of its own: Geldern, Geldbörse and Gelder keep their letters.
    ...(names.has(LOCKUP.name)
      ? [
          `@GeldWordLetters = [${master.glyphs.filter((g) => g.unicode !== undefined && /\p{L}/u.test(String.fromCodePoint(g.unicode))).map((g) => g.name).join(' ')}];`,
          'feature dlig {',
          `  ignore sub @GeldWordLetters ${LOCKUP.letters.map((l) => `${l}'`).join(' ')};`,
          `  ignore sub ${LOCKUP.letters.map((l) => `${l}'`).join(' ')} @GeldWordLetters;`,
          `  sub ${LOCKUP.letters.map((l) => `${l}'`).join(' ')} by ${LOCKUP.name};`,
          '} dlig;',
        ]
      : []),
  ].join('\n');
}

/**
 * The arrow sequences (5.3, D13: on by default in calt), longest first, each as the pieces its characters become.
 * A sequence only stands whole: not inside a longer run of hyphens, equals or brackets (--->, <=>, ->>), and <= is
 * never a fat arrow (a fat left arrow is <==).
 */
const ARROWS: [string, string[]][] = [
  ['<-->', ['less.arrow_head', 'hyphen.arrow_middle', 'hyphen.arrow_middle', 'greater.arrow_head']],
  ['<==>', ['less.arrow_dblhead', 'equal.arrow_middle', 'equal.arrow_middle', 'greater.arrow_dblhead']],
  ['<->', ['less.arrow_head', 'hyphen.arrow_middle', 'greater.arrow_head']],
  ['-->', ['hyphen.arrow_start', 'hyphen.arrow_middle', 'greater.arrow_head']],
  ['<--', ['less.arrow_head', 'hyphen.arrow_middle', 'hyphen.arrow_end']],
  ['==>', ['equal.arrow_start', 'equal.arrow_middle', 'greater.arrow_dblhead']],
  ['<==', ['less.arrow_dblhead', 'equal.arrow_middle', 'equal.arrow_end']],
  ['->>', ['hyphen.arrow_start', 'greater.arrow_inner', 'greater.arrow_head']],
  ['<<-', ['less.arrow_head', 'less.arrow_inner', 'hyphen.arrow_end']],
  ['=>>', ['equal.arrow_start', 'greater.arrow_dblinner', 'greater.arrow_dblhead']],
  ['->', ['hyphen.arrow_start', 'greater.arrow_head']],
  ['<-', ['less.arrow_head', 'hyphen.arrow_end']],
  ['=>', ['equal.arrow_start', 'greater.arrow_dblhead']],
];
const ARROW_CHARS: Record<string, string> = { '-': 'hyphen', '=': 'equal', '<': 'less', '>': 'greater' };

function arrowFeatures(names: Set<string>): string[] {
  const used = ARROWS.filter(([, pieces]) => pieces.every((n) => names.has(n)));
  if (!used.length) return [];
  const rules: string[] = [];
  for (const [text, pieces] of used) {
    const chars = [...text].map((c) => ARROW_CHARS[c]!);
    rules.push(`  ignore sub [hyphen equal less] ${chars.map((c, i) => (i === 0 ? `${c}'` : c)).join(' ')};`);
    rules.push(`  ignore sub ${chars.map((c, i) => (i === 0 ? `${c}'` : c)).join(' ')} [hyphen equal greater];`);
    chars.forEach((c, i) => rules.push(`  sub ${[...pieces.slice(0, i), `${c}'`, ...chars.slice(i + 1)].join(' ')} by ${pieces[i]};`));
  }
  const pieces = [...new Set(used.flatMap(([, ps]) => ps))].sort();
  return [
    'feature calt {',
    '  lookup arrows {',
    ...rules.map((r) => `  ${r}`),
    '  } arrows;',
    '} calt;',
    // After calt, so it maps the pieces calt made back to their characters.
    'feature ss20 {',
    '  featureNames { name "No arrow ligatures"; };',
    `  sub [${pieces.join(' ')}] by [${pieces.map((n) => n.split('.')[0]).join(' ')}];`,
    '} ss20;',
  ];
}

/**
 * One lookup per code ligature group, used by dlig (all of them) and by the group's own stylistic set, longest first.
 * A sequence never touches another operator character, so a::::b and http:// stay as typed; #! is followed by a path.
 */
function codeLigatureFeatures(master: Master, names: Set<string>): string[] {
  const byChar = new Map(master.glyphs.flatMap((g) => (g.unicode === undefined ? [] : [[String.fromCodePoint(g.unicode), g.name] as const])));
  const operators = [...CODE_OPERATORS].map((ch) => byChar.get(ch)).filter((n): n is string => n !== undefined);
  const lookups: string[] = [];
  const used: CodeGroup[] = [];
  for (const group of Object.keys(CODE_GROUPS) as CodeGroup[]) {
    const ligs = CODE_LIGATURES.filter((l) => l.group === group && [...l.text].every((ch, i) => names.has(codePieceName(byChar.get(ch) ?? '', l, i))));
    if (!ligs.length) continue;
    used.push(group);
    lookups.push(`lookup code_${group} {`);
    for (const lig of ligs) {
      const chars = [...lig.text].map((ch) => byChar.get(ch)!);
      const pieces = chars.map((n, i) => codePieceName(n, lig, i));
      const marked = chars.map((n, i) => (i === 0 ? `${n}'` : n)).join(' ');
      const apart = { operators: '@CodeOperators', hyphens: 'hyphen', words: '@CodeWordChars' }[CODE_GROUPS[group].apart];
      if (apart && !lig.free) lookups.push(`  ignore sub ${apart} ${marked};`);
      if (apart && !lig.free && lig.text !== '#!') lookups.push(`  ignore sub ${marked} ${apart};`);
      chars.forEach((n, i) => lookups.push(`  sub ${[...pieces.slice(0, i), `${n}'`, ...chars.slice(i + 1)].join(' ')} by ${pieces[i]};`));
    }
    if (group === 'symbols' && names.has('multiply')) lookups.push('  sub @CodeFigures x\' @CodeFigures by multiply;');
    lookups.push(`} code_${group};`);
  }
  if (!used.length) return [];
  const figures = master.glyphs.filter((g) => g.unicode !== undefined && g.unicode >= 0x30 && g.unicode <= 0x39).map((g) => g.name);
  return [
    `@CodeOperators = [${operators.join(' ')}];`,
    `@CodeFigures = [${figures.join(' ')}];`,
    `@CodeWordChars = [${master.glyphs.filter((g) => g.unicode !== undefined && /[\p{L}\p{Nd}]/u.test(String.fromCodePoint(g.unicode))).map((g) => g.name).join(' ')}];`,
    ...lookups,
    'feature dlig {',
    ...used.filter((g) => CODE_GROUPS[g].dlig).map((g) => `  lookup code_${g};`),
    '} dlig;',
    ...used.flatMap((g) => {
      const { feature, label } = CODE_GROUPS[g];
      return feature ? [`feature ${feature} {`, `  featureNames { name "${label}"; };`, `  lookup code_${g};`, `} ${feature};`] : [];
    }),
  ];
}

/**
 * Contextual punctuation (calt, on): the hyphen raised between capitals (A-Z) and the colon between figures (12:30),
 * and the same forms for case-sensitive text (`case`).
 */
function caseFeatures(master: Master, names: Set<string>): string[] {
  const forms = ['hyphen', 'endash', 'emdash', 'colon'].filter((n) => names.has(`${n}.case`));
  if (!forms.length) return [];
  const upper = master.glyphs.filter((g) => !g.mark && g.unicode !== undefined && /\p{Lu}/u.test(String.fromCodePoint(g.unicode))).map((g) => g.name);
  const figures = master.glyphs.filter((g) => g.unicode !== undefined && g.unicode >= 0x30 && g.unicode <= 0x39).map((g) => g.name);
  const tabular = figures.map((n) => `${n}.tf`).filter((n) => names.has(n));
  return [
    `@CaseCapitals = [${upper.join(' ')}];`,
    `@CaseFigures = [${[...figures, ...tabular].join(' ')}];`,
    'feature calt {',
    '  lookup case_context {',
    '    sub @CaseCapitals hyphen\' @CaseCapitals by hyphen.case;',
    '    sub @CaseFigures colon\' @CaseFigures by colon.case;',
    '  } case_context;',
    '} calt;',
    'feature case {',
    ...forms.map((n) => `  sub ${n} by ${n}.case;`),
    '} case;',
  ];
}

/**
 * The alternates' features (alternates.ts): each stylistic set and character variant with its name, `salt` with every
 * glyph's first alternate, and `aalt` (first, as the spec asks) with all of them. Accented letters go with their base.
 */
function alternateFeatures(master: Master, names: Set<string>): { aalt: string[]; rest: string[] } {
  const owned = new Map<Alternate, [string, string][]>();
  for (const alt of ALTERNATES) {
    const name = alternateName(alt);
    if (!names.has(name)) continue;
    const suffix = name.slice(alt.glyph.length);
    const accented = master.glyphs
      .filter((g) => g.name.endsWith(suffix) && g.components[0]?.glyph === name && names.has(g.name.slice(0, -suffix.length)))
      .map((g) => [g.name.slice(0, -suffix.length), g.name] as [string, string]);
    owned.set(alt, [[alt.glyph, name], ...accented]);
  }
  if (!owned.size && !names.has(`period.${OCTAGONAL_DOTS}`)) return { aalt: [], rest: [] };
  const subs = (pairs: [string, string][]) => pairs.map(([a, b]) => `  sub ${a} by ${b};`);
  const rest: string[] = [];
  // Octagonal dots are drawn for every glyph with dots rather than listed (master.ts).
  const dotted = [...names].filter((n) => n.endsWith(`.${OCTAGONAL_DOTS}`) && names.has(n.slice(0, -OCTAGONAL_DOTS.length - 1)) && !/\.(ss|cv)\d\d\./.test(n));
  for (const [tag, label] of Object.entries(STYLISTIC_SETS)) {
    const pairs = [
      ...[...owned].filter(([alt]) => alt.set === tag).flatMap(([, ps]) => ps),
      ...(tag === OCTAGONAL_DOTS ? dotted.map((n) => [n.slice(0, -OCTAGONAL_DOTS.length - 1), n] as [string, string]) : []),
      ...(tag === CIRCLED_NUMERALS ? FIGURE_NAMES.filter((f) => names.has(`${f}circle`)).map((f) => [f, `${f}circle`] as [string, string]) : []),
    ];
    if (pairs.length) rest.push(`feature ${tag} {`, `  featureNames { name "${label}"; };`, ...subs(pairs), `} ${tag};`);
  }
  for (const [alt, pairs] of owned) rest.push(`feature ${alt.cv} {`, `  cvParameters { FeatUILabelNameID { name "${alt.label}"; }; };`, ...subs(pairs), `} ${alt.cv};`);
  const all = new Map<string, string[]>();
  for (const pairs of owned.values()) for (const [a, b] of pairs) all.set(a, [...(all.get(a) ?? []), b]);
  rest.push('feature salt {', ...[...all].map(([a, bs]) => `  sub ${a} by ${bs[0]};`), '} salt;');
  return { aalt: ['feature aalt {', ...[...all].map(([a, bs]) => `  sub ${a} from [${bs.join(' ')}];`), '} aalt;', ''], rest };
}

/** Every file of one master's UFO, keyed by its path inside the .ufo folder. */
export function ufoFiles(master: Master, kerning?: Kerning): Map<string, string> {
  const files = new Map<string, string>();
  files.set('metainfo.plist', plist({ creator: 'sh.geld.type', formatVersion: 3 }));
  files.set('fontinfo.plist', plist(fontInfo(master)));
  files.set('layercontents.plist', plist([['public.default', 'glyphs']]));
  files.set(
    'lib.plist',
    plist({
      'public.glyphOrder': master.glyphs.map((g) => g.name),
      'public.openTypeCategories': Object.fromEntries(master.glyphs.map((g) => [g.name, g.mark ? 'mark' : 'base'])),
    }),
  );
  files.set('features.fea', features(master));
  if (kerning) {
    const names = new Set(master.glyphs.map((g) => g.name));
    files.set('groups.plist', plist(Object.fromEntries([...kerning.groups].map(([group, members]) => [group, members.filter((n) => names.has(n))]))));
    files.set(
      'kerning.plist',
      plist(Object.fromEntries([...kerning.pairs].map(([first, row]) => [first, Object.fromEntries([...row].map(([second, value]) => [second, Math.round(toFontUnits(value))]))]))),
    );
  }
  const contents: Record<string, string> = {};
  for (const glyph of master.glyphs) {
    const file = glifFileName(glyph.name);
    contents[glyph.name] = file;
    files.set(`glyphs/${file}`, glif(glyph));
  }
  files.set('glyphs/contents.plist', plist(contents));
  return files;
}

/** One designspace per family: weight is continuous, italic a discrete axis, so it compiles to a roman and an italic variable font. */
export function designspace(family: Family): string {
  const base = FAMILY_NAMES[family];
  const compact = base.replace(/\s/g, '');
  const loc = (weight: Weight, style: Style) =>
    `      <location>\n        <dimension name="Weight" xvalue="${weight}"/>\n        <dimension name="Italic" xvalue="${style === 'italic' ? 1 : 0}"/>\n      </location>`;
  const styles: Style[] = ['roman', 'italic'];
  const sources = styles.flatMap((style) =>
    WEIGHTS.map(
      (weight) =>
        `    <source filename="${sourceFileName(family, style, weight)}" name="${base} ${styleName(weight, style)}" familyname="${base}" stylename="${styleName(weight, style)}">\n${loc(weight, style)}\n    </source>`,
    ),
  );
  const instances = styles.flatMap((style) =>
    WEIGHTS.map((weight) => {
      const map = styleMap(family, weight, style);
      return `    <instance familyname="${base}" stylename="${styleName(weight, style)}" postscriptfontname="${postscriptName(family, weight, style)}" stylemapfamilyname="${map.familyName}" stylemapstylename="${map.styleName}" filename="instances/${postscriptName(family, weight, style)}.ufo">\n${loc(weight, style)}\n    </instance>`;
    }),
  );
  const labels = WEIGHTS.map((w) =>
    w === 400
      ? `        <label uservalue="400" name="Regular" elidable="true" linkeduservalue="700"/>`
      : `        <label uservalue="${w}" name="${WEIGHT_NAMES[w]}"/>`,
  );
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    '<designspace format="5.0">',
    '  <axes>',
    '    <axis tag="wght" name="Weight" minimum="100" maximum="900" default="400">',
    '      <labels>',
    ...labels,
    '      </labels>',
    '    </axis>',
    '    <axis tag="ital" name="Italic" values="0 1" default="0">',
    '      <labels>',
    '        <label uservalue="0" name="Roman" elidable="true" linkeduservalue="1"/>',
    '        <label uservalue="1" name="Italic"/>',
    '      </labels>',
    '    </axis>',
    '  </axes>',
    '  <sources>',
    ...sources,
    '  </sources>',
    '  <variable-fonts>',
    `    <variable-font name="${compact}" filename="${compact}[wght]">`,
    '      <axis-subsets>\n        <axis-subset name="Weight"/>\n        <axis-subset name="Italic" uservalue="0"/>\n      </axis-subsets>',
    '    </variable-font>',
    `    <variable-font name="${compact}-Italic" filename="${compact}-Italic[wght]">`,
    '      <axis-subsets>\n        <axis-subset name="Weight"/>\n        <axis-subset name="Italic" uservalue="1"/>\n      </axis-subsets>',
    '    </variable-font>',
    '  </variable-fonts>',
    '  <instances>',
    ...instances,
    '  </instances>',
    '</designspace>',
    '',
  ].join('\n');
}
