import { ITALIC_SLOPE, METRICS, toFontUnits, UPM, WEIGHT_NAMES, type Weight, WEIGHTS, weightParams } from './grid';
import { FAMILY_NAMES, type Family, type Master, type Style } from './master';

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
    openTypeOS2WinAscent: toFontUnits(METRICS.lineAscender),
    openTypeOS2WinDescent: -toFontUnits(METRICS.lineDescender),
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
 */
export function features(master: Master): string {
  const names = new Set(master.glyphs.map((g) => g.name));
  const marks = master.glyphs.filter((g) => g.mark && !g.name.endsWith('.case') && names.has(`${g.name}.case`)).map((g) => g.name);
  const upper = master.glyphs
    .filter((g) => !g.mark && g.unicode !== undefined && /\p{Lu}/u.test(String.fromCodePoint(g.unicode)))
    .map((g) => g.name);
  const above = master.glyphs.filter((g) => g.mark && g.anchors.some((a) => a.name === '_top' || a.name === '_topright')).map((g) => g.name);
  return [
    'languagesystem DFLT dflt;',
    'languagesystem latn dflt;',
    '',
    `@MarksAbove = [${above.join(' ')}];`,
    `@CaseMarks = [${marks.join(' ')}];`,
    `@CaseMarksCase = [${marks.map((m) => `${m}.case`).join(' ')}];`,
    `@Uppercase = [${upper.join(' ')}];`,
    '',
    'feature ccmp {',
    "  sub i' @MarksAbove by dotlessi;",
    "  sub j' @MarksAbove by dotlessj;",
    "  sub @Uppercase @CaseMarks' by @CaseMarksCase;",
    "  sub @CaseMarksCase @CaseMarks' by @CaseMarksCase;",
    '} ccmp;',
    '',
  ].join('\n');
}

/** Every file of one master's UFO, keyed by its path inside the .ufo folder. */
export function ufoFiles(master: Master): Map<string, string> {
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
