import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/dashboard/design');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const rows = new Map();
for (const entry of manifest.entries) {
  const row = rows.get(entry.name) || {
    name: entry.name,
    label: entry.label.replace(/^Dark mode · /, ''),
    route: entry.route,
  };
  row[entry.group] = entry.file;
  rows.set(entry.name, row);
}
const md = [
  '# Dashboard interface review',
  '',
  'This gallery shows the actual Geld dashboard with synthetic local fixture responses.',
  'It covers app-owned routes, sign-in and account creation, password recovery, connection setup, review modes, dialogs, and empty, loading and error states.',
  'No real provider login, email, AI generation, billing or infrastructure operation was performed.',
  '',
  'Open [the visual gallery](./index.html) to filter screenshots by device and view.',
  'The production application follows the operating system’s color scheme.',
  '',
  'The shared navigation uses [shadcn/ui’s Base UI sidebar](https://ui.shadcn.com/docs/components/base/sidebar) composition and Vega spacing, with Geld theme tokens.',
  'Drag the sidebar edge to resize or collapse it. The team picker opens from its chevrons, the repository picker lives in the top bar, and Inbox sits beside the account menu.',
  'Controls, panels and navigation states use square corners. Brand buttons retain two beveled corners. The 404 uses tabular numerals, centers within the available workspace and scrolls naturally on short screens.',
  '',
  'The dashboard uses Font Awesome Sharp Regular. Selected controls and navigation switch to Sharp Solid. Private repositories use a lock, and discussion threads use square message icons.',
  '',
  'Queue rows show current Digest findings, replies needed, approvals and bot results. Earlier summaries are marked outdated, and partial summaries use lower-bound counts.',
  'Navigation, pagination and refresh retain cached rows and change counts. Descriptions, discussion and assistant messages render Markdown. The diff offers revision-bound source links and expandable context.',
  '',
  '## Screenshots',
  '',
  '| View | Route | Desktop | Mobile | Dark |',
  '| --- | --- | --- | --- | --- |',
  ...[...rows.values()].map(
    (r) =>
      `| ${r.label} | \`${r.route}\` | ${r.desktop ? `[View](./screenshots/${r.desktop})` : '—'} | ${r.mobile ? `[View](./screenshots/${r.mobile})` : '—'} | ${r.dark ? `[View](./screenshots/${r.dark})` : '—'} |`,
  ),
  '',
  '## Reproduce',
  '',
  'Start the dashboard locally on port 3001.',
  'Run the capture script from the repository root with Playwright available to Node.',
  'The script intercepts API requests with the included fixtures and verifies that screenshots have no page overflow or browser runtime errors.',
  '',
  '```sh',
  'export GELD_PLAYWRIGHT_MODULE=/path/to/playwright',
  'export GELD_CHROMIUM_PATH=/path/to/chromium',
  'node apps/dashboard/scripts/design-icons-verify.mjs',
  'node apps/dashboard/scripts/design-verify.mjs',
  'node apps/dashboard/scripts/queue-continuity-verify.mjs',
  'node apps/dashboard/scripts/design-capture.mjs',
  'node apps/dashboard/scripts/design-gallery.mjs',
  '```',
  '',
  '`GELD_DESIGN_URL` optionally selects a different local server URL.',
  'The two module and executable overrides are optional when Playwright and Chromium are already available at the default locations.',
  'Only synthetic responses are used during capture.',
  'Review actions, sign-in operations and billing interactions in these captures never reach their real services.',
  '',
  'Projects and roadmap remain disabled feature stubs and are not part of the enabled dashboard views.',
  'Git provider and identity-provider pages outside Geld are not included.',
  'The app’s `/privacy` route redirects to the [website privacy policy](https://www.geld.sh/privacy).',
  '',
];
fs.writeFileSync(path.join(root, 'README.md'), md.join('\n'));
const data = JSON.stringify(manifest).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Geld · Interface review</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#191c21;font:14px/1.6 system-ui,sans-serif}header{padding:36px 5vw 24px;background:white;border-bottom:1px solid #15191f15}header>p{color:#616875;margin:0 0 6px;font-size:12px}h1{font-size:28px;letter-spacing:-1px;margin:0 0 12px;font-weight:600}header>div{max-width:75ch;color:#616875}nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:18px 5vw;position:sticky;top:0;background:#fffffff5;border-bottom:1px solid #15191f15;z-index:1}button,input{font:inherit;min-height:40px;padding:7px 12px;border:1px solid #15191f20;background:white;color:inherit}button{cursor:pointer}button[aria-pressed=true]{background:#191c21;color:white}input{margin-left:auto;min-width:min(100%,280px)}main{padding:24px 5vw;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:24px}article{background:white;border:1px solid #15191f15;min-width:0}article>a{display:block;background:#eef0f3;height:260px;overflow:hidden;border-bottom:1px solid #15191f15}article img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}article>div{padding:16px}h2{font-size:14px;margin:0;font-weight:600}article p{margin:5px 0 0;color:#616875;font:11px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}a{color:inherit}#count{font-size:12px;color:#616875;padding-left:8px}footer{padding:12px 5vw 36px;color:#616875;font-size:12px}@media(max-width:600px){header{padding-top:24px}input{width:100%;margin:0}nav{position:static}main{gap:16px}article>a{height:320px}}</style><header><p>GELD / DESIGN REVIEW</p><h1>Dashboard design review</h1><div>Actual app screenshots with local fixture responses. All accounts, repositories and responses are synthetic. No live sign-in, AI, provider or billing operations were performed.</div></header><nav aria-label="Screenshot filters"><button type="button" data-group="desktop" aria-pressed="true">Desktop</button><button type="button" data-group="mobile" aria-pressed="false">Mobile</button><button type="button" data-group="dark" aria-pressed="false">Dark mode</button><input id="search" type="search" placeholder="Find a view or flow" aria-label="Find a screenshot"><span id="count" role="status"></span></nav><main id="screenshots"></main><footer>Click any screenshot to see the full view. <a href="README.md">Route and state index</a></footer><script>const manifest=${data};let group='desktop';const grid=document.querySelector('#screenshots'),search=document.querySelector('#search');function render(){grid.replaceChildren();const matches=manifest.entries.filter(e=>e.group===group&&(e.name+' '+e.label+' '+e.route).toLowerCase().includes(search.value.toLowerCase()));document.querySelector('#count').textContent=matches.length+' views';for(const entry of matches){const card=document.createElement('article'),link=document.createElement('a'),img=document.createElement('img'),body=document.createElement('div'),heading=document.createElement('h2'),route=document.createElement('p');link.href='screenshots/'+entry.file;link.target='_blank';link.rel='noopener';img.src=link.href;img.alt=entry.label;img.loading='lazy';heading.textContent=entry.label;route.textContent=entry.route;link.append(img);body.append(heading,route);card.append(link,body);grid.append(card);}}search.addEventListener('input',render);for(const button of document.querySelectorAll('[data-group]'))button.addEventListener('click',()=>{group=button.dataset.group;for(const sibling of document.querySelectorAll('[data-group]'))sibling.setAttribute('aria-pressed',String(sibling===button));render();});render();</script></html>`;
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Generated gallery:', manifest.entries.length, 'screenshots;', rows.size, 'distinct views and states.');
