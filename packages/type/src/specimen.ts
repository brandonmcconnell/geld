/**
 * The specimen: one page in the font package (dist/specimen.html) that shows the family as a reader meets it, with a live
 * tester, every feature as a switch, the character set, the ligature tables and the grid the letters are drawn on. It
 * loads the package's own web CSS, so it shows exactly what ships.
 */
import { ALTERNATES, STYLISTIC_SETS } from './alternates';
import { CODE_GROUPS, CODE_LIGATURES } from './code-ligatures';
import { ALIASES } from './composites';
import { GLYPHS } from './glyphs';
import { METRICS, WEIGHT_NAMES, WEIGHTS } from './grid';
import { featureLabels, SIZE_GUIDE, STANDARD_FEATURES } from './web';

const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Unicode blocks the character set is shown in, in reading order. */
const BLOCKS: [string, number, number][] = [
  ['Basic Latin', 0x20, 0x7f],
  ['Latin-1', 0xa0, 0xff],
  ['Latin Extended-A', 0x100, 0x17f],
  ['Latin Extended-B', 0x180, 0x24f],
  ['IPA', 0x250, 0x2af],
  ['Spacing modifiers', 0x2b0, 0x2ff],
  ['Combining marks', 0x300, 0x36f],
  ['Greek', 0x370, 0x3ff],
  ['Cyrillic', 0x400, 0x52f],
  ['Phonetic extensions', 0x1d00, 0x1dff],
  ['Latin Extended Additional', 0x1e00, 0x1eff],
  ['Punctuation', 0x2000, 0x206f],
  ['Superscripts, currency and letterlike', 0x2070, 0x214f],
  ['Number forms and arrows', 0x2150, 0x21ff],
  ['Mathematical operators', 0x2200, 0x22ff],
  ['Technical and keys', 0x2300, 0x23ff],
  ['Enclosed numerals', 0x2460, 0x24ff],
  ['Box drawing and blocks', 0x2500, 0x259f],
  ['Shapes and dingbats', 0x25a0, 0x27ff],
  ['Supplemental arrows and Latin', 0x2900, 0xa7ff],
  ['Private use: the Geld emblem and lockup', 0xe000, 0xf8ff],
];

/** The glyph sets every font is checked against (scripts/verify.py), as a reader would name them. */
const LANGUAGE_SUPPORT = [
  'Latin: GF Latin Kernel, Core, Plus, Vietnamese, African and Beyond (most languages written in Latin, Vietnamese and the languages of Africa)',
  'Pinyin and Arabic transliteration',
  'Greek: GF Greek Core and Plus (monotonic and polytonic Greek)',
  'Cyrillic: GF Cyrillic Core and Plus (Russian, Ukrainian, Belarusian, Bulgarian with its local forms, Serbian and Macedonian, and the languages of Central Asia and the Caucasus written in Cyrillic)',
  'Phonetics: the full International Phonetic Alphabet (GF Phonetics IPA Standard) and the Americanist alphabet (APA)',
];

const CORNERS_SAMPLE = 'DOB 085 SQUARE Cut corners 2026';
const SAMPLE = 'Geld hides the tests and the noise, so a review reads like the change it is. 0123456789 → ✓';

function charset(codepoints: number[]): string {
  const listed = (cp: number) => BLOCKS.some(([, from, to]) => cp >= from && cp <= to);
  return [...BLOCKS, ['Other', 0, 0x10ffff] as const].map(([name, from, to]) => {
    const chars = codepoints.filter((cp) => cp >= from && cp <= to && (name !== 'Other' || !listed(cp)));
    if (!chars.length) return '';
    const cells = chars.map((cp) => {
      const ch = String.fromCodePoint(cp);
      const shown = cp >= 0x300 && cp <= 0x36f ? `\u25cc${ch}` : ch;
      return `<span title="U+${cp.toString(16).toUpperCase().padStart(4, '0')}">${escape(shown)}</span>`;
    });
    return `<h3>${name} <small>${chars.length}</small></h3>\n<div class="chars">${cells.join('')}</div>`;
  }).join('\n');
}

/** A feature's row, its sample off and on; a form only the italic has is shown in the italic. */
function row(tag: string, label: string, text: string, italic: boolean): string {
  const style = italic ? 'font-style: italic; ' : '';
  return `<tr><td><code>${tag}</code></td><td>${escape(label)}</td><td class="sample" style="${style}">${text}</td><td class="sample" style="${style}font-feature-settings: '${tag}'">${text}</td></tr>`;
}

function alternates(): string {
  const rows: string[] = [];
  for (const [tag, label] of Object.entries(STYLISTIC_SETS)) {
    const members = ALTERNATES.filter((alt) => alt.set === tag);
    const text = SET_SAMPLES[tag] ?? charsOf(members.map((alt) => alt.glyph));
    rows.push(row(tag, label, text, members.length > 0 && members.every((alt) => alt.only === 'italic')));
  }
  const seen = new Set<string>();
  for (const alt of ALTERNATES) {
    if (seen.has(alt.cv)) continue;
    seen.add(alt.cv);
    const members = ALTERNATES.filter((a) => a.cv === alt.cv);
    rows.push(row(alt.cv, alt.label, charsOf(members.map((a) => a.glyph)), members.every((a) => a.only === 'italic')));
  }
  return `<table><thead><tr><th>Feature</th><th>Name</th><th>Off</th><th>On</th></tr></thead><tbody>${rows.join('\n')}</tbody></table>`;
}

/** What a set changes, as text to show it on. */
const SET_SAMPLES: Record<string, string> = {
  ss07: 'i j ä ö ! ? : ;',
  ss17: '1 2 3 4 5 6 7 8 9',
};
/** A glyph's character, from its name. */
const CHARS = new Map([...GLYPHS, ...ALIASES].flatMap((def) => (def.unicode === undefined ? [] : [[def.name, String.fromCodePoint(def.unicode)] as const])));
const charsOf = (glyphs: string[]) => escape(glyphs.map((name) => CHARS.get(name) ?? name).join(' '));

function ligatures(): string {
  const groups = new Map<string, string[]>();
  for (const lig of CODE_LIGATURES) {
    const group = CODE_GROUPS[lig.group];
    const name = group.label ?? 'Symbol forms';
    const tag = group.dlig ? `dlig${group.feature ? `, ${group.feature}` : ''}` : group.feature!;
    const key = `${name}|${tag}`;
    groups.set(key, [...(groups.get(key) ?? []), lig.text]);
  }
  const rows = [...groups].map(([key, texts]) => {
    const [name, tag] = key.split('|');
    const feature = tag!.split(', ').at(-1)!;
    const text = escape(texts.join('  '));
    return `<tr><td>${escape(name!)}</td><td><code>${tag}</code></td><td class="code">${text}</td><td class="code" style="font-feature-settings: '${feature}'">${text}</td></tr>`;
  });
  rows.unshift(`<tr><td>Arrows (on by default; <code>ss20</code> turns them off)</td><td><code>calt</code></td><td class="code" style="font-feature-settings: 'ss20'">-&gt; &lt;- &lt;-&gt; =&gt; ==&gt; &lt;== --&gt; -&gt;&gt;</td><td class="code">-&gt; &lt;- &lt;-&gt; =&gt; ==&gt; &lt;== --&gt; -&gt;&gt;</td></tr>`);
  rows.unshift(`<tr><td>Text ligatures</td><td><code>liga</code></td><td style="font-variant-ligatures: no-common-ligatures">off effort attic fifty</td><td>off effort attic fifty</td></tr>`);
  return `<table><thead><tr><th>Group</th><th>Feature</th><th>Off</th><th>On</th></tr></thead><tbody>${rows.join('\n')}</tbody></table>`;
}

/** The specimen page; `codepoints` are the characters every style of the family maps. */
export function specimenPage(version: string, codepoints: number[]): string {
  const features = [...featureLabels().map(([tag, label]) => [tag, label] as const), ...STANDARD_FEATURES.map(([, label]) => [/\((\w{4})/.exec(label)?.[1] ?? '', label.replace(/ \(.*\)$/, '')] as const).filter(([tag]) => tag && !['lnum', 'pnum', 'calt'].includes(tag))];
  const switches = features.filter(([tag], i) => features.findIndex(([other]) => other === tag) === i).map(([tag, label]) => `<label title="${escape(label)}"><input type="checkbox" value="${tag}"> <code>${tag}</code> ${escape(label)}</label>`).join('\n');
  const waterfall = WEIGHTS.map((w) => `<div class="row" style="font-weight:${w}"><span class="tag">${w} ${WEIGHT_NAMES[w]}</span><span>${escape(SAMPLE)}</span></div>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Geld Sans ${version}</title>
<link rel="stylesheet" href="web/geld-sans.css">
<link rel="stylesheet" href="web/geld-dark-sans.css">
<link rel="stylesheet" href="web/geld-sans-cut.css">
<link rel="stylesheet" href="web/geld-dark-sans-cut.css">
<link rel="stylesheet" href="web/geld-features.css">
<style>
  :root { color-scheme: light dark; --ink: light-dark(#111, #eee); --muted: light-dark(#666, #999); --line: light-dark(#ddd, #333); }
  body { margin: 0 auto; max-width: 1100px; padding: 40px 24px 120px; font: 16px/1.5 "Geld Sans", "Geld Sans Fallback", sans-serif; color: var(--ink); }
  @media (prefers-color-scheme: dark) { body { font-family: "Geld Dark Sans", "Geld Dark Sans Fallback", sans-serif; } }
  h1 { font-size: 96px; font-weight: 800; line-height: 1; margin: 0 0 8px; letter-spacing: -0.01em; }
  h2 { font-size: 28px; margin: 64px 0 16px; padding-top: 16px; border-top: 1px solid var(--line); }
  h3 { font-size: 15px; margin: 24px 0 8px; color: var(--muted); font-weight: 500; }
  small, .tag { color: var(--muted); font-size: 13px; }
  .row { display: flex; gap: 16px; align-items: baseline; font-size: 28px; white-space: nowrap; overflow: hidden; }
  .row .tag { width: 140px; flex: none; font-weight: 400; }
  .controls { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; margin-bottom: 16px; font-size: 14px; }
  .switches { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 4px 16px; font-size: 13px; margin: 16px 0; }
  #tester { font-size: 48px; line-height: 1.25; outline: none; border: 1px solid var(--line); padding: 16px; min-height: 2.5em; }
  .chars { display: flex; flex-wrap: wrap; font-size: 28px; }
  .chars span { min-width: 48px; padding: 0 6px; box-sizing: border-box; height: 56px; display: grid; place-items: center; border: 1px solid var(--line); margin: -1px 0 0 -1px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: baseline; }
  td.sample, td.code { font-size: 24px; }
  td.code { font-variant-ligatures: no-discretionary-ligatures; }
  .grid { font-size: 15px; }
  .grid dt { font-weight: 700; margin-top: 12px; }
  .grid dd { margin: 0; }
</style>
</head>
<body>
<h1>Geld Sans</h1>
<p>Version ${version}. Nine weights, roman and italic, in two corner styles drawn on the Geld brand grid: Geld Sans, square-cornered, and Geld Sans Cut, its corners cut at 45° as the wordmark's are. Each has a dark grade for light text on dark backgrounds, with the same widths so switching never reflows text.</p>

<h2>Weights</h2>
${waterfall}
<div class="row" style="font-style: italic; font-weight: 400"><span class="tag">Italic</span><span>${escape(SAMPLE)}</span></div>

<h2>Corners</h2>
${[400, 800].map((w) => `<div class="row" style="font-weight:${w}"><span class="tag">Geld Sans</span><span>${escape(CORNERS_SAMPLE)}</span></div>\n<div class="row" style="font-weight:${w}; font-family: 'Geld Sans Cut'"><span class="tag">Geld Sans Cut</span><span>${escape(CORNERS_SAMPLE)}</span></div>`).join('\n')}

<h2>Sizes</h2>
${[12, 14, 16, 20, 28, 40, 64].map((size) => `<div class="row" style="font-size:${size}px"><span class="tag">${size}px</span><span>${escape(SAMPLE)}</span></div>`).join('\n')}
<ul>${SIZE_GUIDE.map(([weights, advice]) => `<li><strong>${escape(weights)}</strong>: ${escape(advice)}</li>`).join('')}</ul>

<h2>Tester</h2>
<div class="controls">
  <label>Family <select id="family"><option value="Geld Sans">Geld Sans</option><option value="Geld Dark Sans">Geld Dark Sans</option><option value="Geld Sans Cut">Geld Sans Cut</option><option value="Geld Dark Sans Cut">Geld Dark Sans Cut</option></select></label>
  <label><input type="checkbox" id="italic"> Italic</label>
  <label>Weight <input type="range" id="weight" min="100" max="900" step="1" value="400"> <span id="weight-value">400</span></label>
  <label>Size <input type="range" id="size" min="10" max="160" step="1" value="48"> <span id="size-value">48</span>px</label>
</div>
<div id="tester" contenteditable spellcheck="false">${escape(SAMPLE)}</div>
<div class="switches">
${switches}
</div>

<h2>Stylistic sets and character variants</h2>
<p>Every set and variant is named in the font, so apps that list features show these names. On the web each has a class in <code>geld-features.css</code>.</p>
${alternates()}

<h2>Ligatures</h2>
<p>The text stays as typed: a ligature is only drawn, so copying, searching and the caret see every character.</p>
${ligatures()}

<h2>Language support</h2>
<ul>${LANGUAGE_SUPPORT.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>

<h2>Character set <small>${codepoints.length} characters</small></h2>
${charset(codepoints)}

<h2>Construction</h2>
<dl class="grid">
  <dt>The grid</dt><dd>Letters are drawn on the Geld wordmark's grid: an em of 20 units, capitals ${METRICS.cap} units tall, an x-height of ${METRICS.xHeight}, ascenders at ${METRICS.ascender} and descenders at ${METRICS.descender}, a line of 25 units.</dd>
  <dt>The stroke</dt><dd>Every letter is a skeleton of strokes expanded by one pen: 2 units at SemiBold, as the wordmark's, thinner and heavier from Thin to Black. SemiBold, the wordmark's own weight, has every edge on the half-unit grid.</dd>
  <dt>The cut</dt><dd>In Geld Sans Cut, where a traditional sans has a curve, the corner is cut at 45°, the wordmark's cut; straight joins stay square. Outer corners cut 2 units deep, lowercase corners 1.5, so small counters keep straight walls.</dd>
  <dt>The square</dt><dd>Geld Sans draws the same skeletons with square corners. It keeps a cut only where the cut tells two glyphs apart: D's bowl against O, a single-storey a's against o, and 0, 5 and 8 against O, S and B. Octagons standing in for circles stay octagons, and a tilde keeps its wave. Square corners carry more ink at a letter's edges, so each style is spaced for its own corners.</dd>
  <dt>The italic</dt><dd>A true italic: the roman sheared by 1 in 7, so a capital leans exactly 2 units, with its own cursive forms where Latin and Cyrillic italics differ from the roman.</dd>
  <dt>The dark grade</dt><dd>Geld Dark Sans is every outline inset by a tenth of the stem (0.2 units at SemiBold), as the dark logo is, with the same advance widths, spacing and kerning, so light text on dark backgrounds reads at the same weight as dark on light.</dd>
  <dt>Decoration metrics</dt><dd>Underline and strikethrough thickness and position are font metrics, set for each weight, so <code>text-decoration-thickness: from-font</code> follows the stroke.</dd>
</dl>

<h2>Downloads</h2>
<ul>
  <li>Variable fonts: <a href="variable/">variable/</a> (one file per family and style, weights 100 to 900)</li>
  <li>Static fonts: <a href="otf/">otf/</a> and <a href="ttf/">ttf/</a> (hinted)</li>
  <li>Web fonts and CSS: <a href="web/">web/</a>, split by script with <code>unicode-range</code>; see the README</li>
</ul>

<script>
  const tester = document.getElementById('tester');
  const read = () => {
    const tags = [...document.querySelectorAll('.switches input:checked')].map((input) => '"' + input.value + '"');
    tester.style.fontFamily = '"' + document.getElementById('family').value + '"';
    tester.style.fontStyle = document.getElementById('italic').checked ? 'italic' : 'normal';
    tester.style.fontWeight = document.getElementById('weight').value;
    tester.style.fontSize = document.getElementById('size').value + 'px';
    tester.style.fontFeatureSettings = tags.length ? tags.join(', ') : 'normal';
    document.getElementById('weight-value').textContent = document.getElementById('weight').value;
    document.getElementById('size-value').textContent = document.getElementById('size').value;
  };
  document.querySelectorAll('select, input').forEach((el) => el.addEventListener('input', read));
  read();
</script>
</body>
</html>
`;
}
