import { WEIGHT_NAMES, WEIGHTS } from './grid';

const SAMPLES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789 .,:;!?-–—\'"()[]/_+=',
  'The quick brown fox jumps over the lazy dog.',
  'Sphinx of black quartz, judge my vow!',
  'HHOHHOOHOO nnonnoono',
  'Hamburgefonstiv 2026 GELD',
];

/** Kerning texts: the pairs that need it, across the languages, shown kerned and unkerned. */
const KERNING = [
  'AVATAR LT Tea Toy Very Way Your “Quote” ‘A’ P. F, V. Y; 7. 1.',
  'Tomáš Ťava ľúbi Ďáblice Tě Ťa Vítejte Łódź Żółw',
  'Télé Tôt Année VAGUE Yeux Árbol Ñandú',
  'Голова Тула Уход Гора ГОД ТАК',
  'Τα Τόπος Υόρκη ΑΥΤΟ Γάτα',
  'f. r, y. v. w. (J) [f] 11 17 71 74',
  'Geld Settings · 12 files hidden · Request a review · Review bots · CI checks · Previews · Today, 7:41 PM',
];

/** Ligatures: text ligatures, arrows (on by default, then with ss20) and the Geld lockup under dlig. */
const LIGATURES = [
  { text: 'off effort attic fifty fjord', css: '' },
  { text: 'a -> b <- c <-> d --> e <== f ==> g => h ->> i', css: '' },
  { text: 'a -> b <- c <-> d --> e <== f ==> g => h ->> i', css: 'font-feature-settings: "ss20"' },
  { text: 'x <= y >= z <=> w --- x<-1', css: '' },
  { text: 'Made by Geld · Geldern', css: 'font-variant-ligatures: discretionary-ligatures' },
  { text: 'a<=b x!=y a===b a<=>b x|>f a&&b a||b std::vec x:=1 0..<n a<<b x>>=1 // c /* */ ~> <~~', css: 'font-variant-ligatures: discretionary-ligatures' },
  { text: 'a<=b x!=y a===b a<=>b x|>f a&&b a||b std::vec x:=1 0..<n a<<b x>>=1 // c /* */ ~> <~~', css: '' },
  { text: '(c) 2026 Acme(TM) - [x] done [ ] todo 1920x1080 · f(c) http://x', css: 'font-variant-ligatures: discretionary-ligatures' },
  { text: 'A-Z 12:30 a-z · wait -- what --- no', css: 'font-feature-settings: "ss10"' },
];
/** Alternates (6.1, 6.2), swashes (6.3) and symbols (3.7), each line turned on by its feature. */
const ALTERNATE_LINES = [
  { text: 'a g l I 0 1 j 4 6 9 3 R K M', css: 'font-feature-settings: "ss01", "ss02", "ss03", "ss04", "ss05", "ss06"' },
  { text: 'a g l I 0 1 j 4 6 9 3 R K M', css: '' },
  { text: 'i j ! ? : ; ä ż 0123456789', css: 'font-feature-settings: "ss07", "ss17"' },
  { text: 'G J Q W t f 7 $ # \' " * ß % ? ¶ { }', css: 'font-feature-settings: "cv21", "cv22", "cv23", "cv24", "cv25", "cv26", "cv27", "cv28", "cv29", "cv30", "cv31", "cv32", "cv33", "cv34", "cv35", "cv36"' },
  { text: 'Mann lane Jazz Yes · A Q R K g y', css: 'font-feature-settings: "cswh", "swsh"' },
  { text: '■ ◉ ◐ ◓ ◢ ✓ ✔ ✗ ★ ☆ ♥ ⚑ ⚠ ☐ ☑ ┌─┬─┐ │ █▀▄░▒▓ \ue000', css: '' },
];

const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A standalone page for reviewing the build: open dist/proof.html from disk. */
export function proofPage(): string {
  const face = (family: string, file: string, style: string) =>
    `@font-face { font-family: '${family}'; src: url('web/${file}.woff2') format('woff2'); font-weight: 100 900; font-style: ${style}; }`;
  const waterfall = WEIGHTS.map(
    (w) => `<div class="row" style="font-weight:${w}"><span class="tag">${w} ${WEIGHT_NAMES[w]}</span><span>${SAMPLES[6]} ${SAMPLES[3]}</span></div>`,
  ).join('\n');
  const sizes = [12, 14, 16, 20, 40, 80]
    .map((s) => `<div class="row" style="font-size:${s}px"><span class="tag">${s}px</span><span>${SAMPLES[3]} ${SAMPLES[4]}</span></div>`)
    .join('\n');
  const strings = SAMPLES.map((s) => `<p>${s}</p>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Geld Sans proof</title>
<style>
${face('Geld Sans', 'GeldSans[wght]', 'normal')}
${face('Geld Sans', 'GeldSans-Italic[wght]', 'italic')}
${face('Geld Dark Sans', 'GeldDarkSans[wght]', 'normal')}
${face('Geld Dark Sans', 'GeldDarkSans-Italic[wght]', 'italic')}
${face('Geld Sans Cut', 'GeldSansCut[wght]', 'normal')}
${face('Geld Sans Cut', 'GeldSansCut-Italic[wght]', 'italic')}
${face('Geld Dark Sans Cut', 'GeldDarkSansCut[wght]', 'normal')}
${face('Geld Dark Sans Cut', 'GeldDarkSansCut-Italic[wght]', 'italic')}
body { margin: 0; font: 14px system-ui, sans-serif; color: #111; background: #fff; }
header { position: sticky; top: 0; display: flex; gap: 24px; align-items: center; padding: 12px 24px; background: #f4f4f4; border-bottom: 1px solid #ddd; }
section { padding: 24px; border-bottom: 1px solid #eee; }
h2 { margin: 0 0 12px; font: 600 12px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; color: #666; }
.sample { font-family: var(--family, 'Geld Sans'); font-weight: var(--w, 400); font-style: var(--s, normal); }
.unkerned { font-kerning: none; color: #999; margin-top: -0.6em; }
.dark-family { font-family: var(--dark-family, 'Geld Dark Sans'); }
.row { display: flex; align-items: baseline; gap: 16px; line-height: 1.2; }
.tag { flex: 0 0 120px; font: 11px ui-monospace, monospace; color: #888; }
.big { font-size: 80px; line-height: 1.2; }
.waterfall .row { font-size: 32px; }
.panels { display: grid; grid-template-columns: repeat(3, 1fr); }
.panel { padding: 24px; font-size: 32px; }
.panel small { display: block; font: 11px ui-monospace, monospace; opacity: 0.6; margin-bottom: 8px; }
.on-dark { background: #0d1117; color: #f0f6fc; }
p { margin: 0 0 8px; font-size: 40px; }
</style>
</head>
<body>
<header>
  <label>Weight <input id="w" type="range" min="100" max="900" step="1" value="400"> <output id="wo">400</output></label>
  <label><input id="i" type="checkbox"> Italic</label>
  <label><input id="c" type="checkbox"> Cut corners</label>
</header>
<section class="sample"><h2>Strings</h2>${strings}</section>
<section class="sample"><h2>Kerning</h2>${KERNING.map((k) => `<p>${k}</p><p class="unkerned">${k}</p>`).join('\n')}</section>
<section class="sample"><h2>Ligatures</h2>${LIGATURES.map((l) => `<p style='${l.css}'>${escape(l.text)}</p>`).join('\n')}</section>
<section class="sample"><h2>Alternates, swashes and symbols</h2>${ALTERNATE_LINES.map((l) => `<p style='${l.css}'>${escape(l.text)}</p>`).join('\n')}</section>
<section class="sample big"><h2>Large</h2>${SAMPLES[0]}<br>${SAMPLES[1]}<br>${SAMPLES[2]}</section>
<section class="sample waterfall"><h2>Weights</h2>${waterfall}</section>
<section class="sample waterfall" style="--s: italic"><h2>Italic</h2>${waterfall}</section>
<section class="sample"><h2>Sizes</h2>${sizes}</section>
<section><h2>Light and dark</h2>
<div class="panels">
  <div class="panel sample"><small>Geld Sans on light</small>${SAMPLES[6]}</div>
  <div class="panel sample on-dark"><small>Geld Sans on dark</small>${SAMPLES[6]}</div>
  <div class="panel sample dark-family on-dark"><small>Geld Dark Sans on dark</small>${SAMPLES[6]}</div>
</div>
</section>
<script>
const w = document.getElementById('w'), wo = document.getElementById('wo'), i = document.getElementById('i'), c = document.getElementById('c');
const apply = () => {
  const s = document.body.style;
  s.setProperty('--w', w.value);
  s.setProperty('--s', i.checked ? 'italic' : 'normal');
  s.setProperty('--family', c.checked ? "'Geld Sans Cut'" : "'Geld Sans'");
  s.setProperty('--dark-family', c.checked ? "'Geld Dark Sans Cut'" : "'Geld Dark Sans'");
  wo.value = w.value;
};
w.oninput = apply; i.onchange = apply; c.onchange = apply; apply();
</script>
</body>
</html>
`;
}
