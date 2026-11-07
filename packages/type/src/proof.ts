import { WEIGHT_NAMES, WEIGHTS } from './grid';

const SAMPLES = ['HOnoGELD', 'HHOHHOOHOO nnonnoono', 'GOLD LODGE HOLD OLD DOGE', 'noon onno nonono'];

/** A standalone page for reviewing the build: open dist/proof.html from disk. */
export function proofPage(): string {
  const face = (family: string, file: string, style: string) =>
    `@font-face { font-family: '${family}'; src: url('web/${file}.woff2') format('woff2'); font-weight: 100 900; font-style: ${style}; }`;
  const waterfall = WEIGHTS.map(
    (w) => `<div class="row" style="font-weight:${w}"><span class="tag">${w} ${WEIGHT_NAMES[w]}</span><span>${SAMPLES[0]} ${SAMPLES[3]}</span></div>`,
  ).join('\n');
  const sizes = [12, 14, 16, 20, 40, 80]
    .map((s) => `<div class="row" style="font-size:${s}px"><span class="tag">${s}px</span><span>${SAMPLES[2]} ${SAMPLES[3]}</span></div>`)
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
body { margin: 0; font: 14px system-ui, sans-serif; color: #111; background: #fff; }
header { position: sticky; top: 0; display: flex; gap: 24px; align-items: center; padding: 12px 24px; background: #f4f4f4; border-bottom: 1px solid #ddd; }
section { padding: 24px; border-bottom: 1px solid #eee; }
h2 { margin: 0 0 12px; font: 600 12px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; color: #666; }
.sample { font-family: 'Geld Sans'; font-weight: var(--w, 400); font-style: var(--s, normal); }
.dark-family { font-family: 'Geld Dark Sans'; }
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
</header>
<section class="sample"><h2>Strings</h2>${strings}</section>
<section class="sample big"><h2>Large</h2>${SAMPLES[0]}</section>
<section class="sample waterfall"><h2>Weights</h2>${waterfall}</section>
<section class="sample waterfall" style="--s: italic"><h2>Italic</h2>${waterfall}</section>
<section class="sample"><h2>Sizes</h2>${sizes}</section>
<section><h2>Light and dark</h2>
<div class="panels">
  <div class="panel sample"><small>Geld Sans on light</small>${SAMPLES[0]}</div>
  <div class="panel sample on-dark"><small>Geld Sans on dark</small>${SAMPLES[0]}</div>
  <div class="panel sample dark-family on-dark"><small>Geld Dark Sans on dark</small>${SAMPLES[0]}</div>
</div>
</section>
<script>
const w = document.getElementById('w'), wo = document.getElementById('wo'), i = document.getElementById('i');
const apply = () => { document.body.style.setProperty('--w', w.value); document.body.style.setProperty('--s', i.checked ? 'italic' : 'normal'); wo.value = w.value; };
w.oninput = apply; i.onchange = apply; apply();
</script>
</body>
</html>
`;
}
