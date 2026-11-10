import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { configure } from './design-fixtures.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.GELD_PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright',
);
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const entries = [],
  errors = [];
const pull = '/github/acme/platform/pull/128';
try {
  for (const [group, width, scheme] of [
    ['desktop', 1440, 'light'],
    ['mobile', 390, 'light'],
    ['dark', 1440, 'dark'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      colorScheme: scheme,
      reducedMotion: 'reduce',
    });
    await configure(context, {});
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    async function shot(name) {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        document.activeElement instanceof HTMLElement && document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        group + '/' + name + ' overflow',
      );
      const file = group + '-' + name + '.png';
      await page.screenshot({
        path: path.join(output, file),
        fullPage: !(await page.getByRole('dialog').count()),
      });
      entries.push({ group, name, file });
      console.log('Captured', file);
    }
    for (const [name, url] of [
      ['queue', '/'],
      ['repositories', '/repositories'],
      ['organization', '/github/acme'],
      ['providers', '/settings/providers'],
      ['account', '/settings/account'],
      ['billing', '/settings/billing'],
      ['models', '/settings/models'],
      ['security', '/settings/security'],
      ['preferences', '/settings/review'],
      ['teams', '/teams'],
      ['not-found', '/missing-page'],
      ['review', pull],
    ]) {
      await page.goto('http://localhost:3001' + url, { waitUntil: 'networkidle' });
      const banner = page.getByRole('region', { name: 'Privacy choices', exact: true });
      if (await banner.count())
        await page.getByRole('button', { name: 'Decline optional', exact: true }).click();
      if (name === 'queue')
        await page
          .locator('.change-count-placeholder[title="Loading change counts"]')
          .first()
          .waitFor({ state: 'hidden' });
      if (name === 'review') await page.locator('.native-digest[aria-busy=false]').waitFor();
      await shot(name);
      if (name === 'repositories') {
        assert.equal(await page.locator('.repository-index h1').count(), 0);
        await page.keyboard.press('Control+k');
        await page.getByRole('dialog', { name: 'Search workspace' }).waitFor();
        await page.getByRole('combobox', { name: 'Search workspace' }).fill('acme/platform');
        await shot('search');
        await page.getByRole('combobox', { name: 'Search workspace' }).focus();
        await page.keyboard.press('Enter');
        await page.waitForURL('**/github/acme/platform');
        await page.keyboard.press('Control+k');
        await page.getByRole('combobox', { name: 'Search workspace' }).fill('no-such-result');
        await shot('search-empty');
        await page.keyboard.press('Escape');
      }
      if (name === 'providers') {
        await page.getByRole('button', { name: 'Add a provider', exact: true }).click();
        await shot('provider-dialog');
        await page.keyboard.press('Escape');
      }
      if (name === 'review') {
        await page.getByRole('button', { name: 'Timeline', exact: true }).click();
        await shot('timeline');
        await page.getByRole('tab', { name: 'Diff', exact: true }).click();
        await shot('diff');
        await page.getByRole('tab', { name: 'Guide', exact: true }).click();
        await shot('guide');
      }
    }
    await context.close();
    const auth = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme });
    await configure(auth, { signedOut: true });
    const p = await auth.newPage();
    await p.goto('http://localhost:3001/sign-in', { waitUntil: 'networkidle' });
    await p.locator('.auth-shell[aria-busy=false]').waitFor();
    const file = group + '-sign-in.png';
    await p.screenshot({ path: path.join(output, file), fullPage: true });
    entries.push({ group, name: 'sign-in', file });
    await auth.close();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(entries, null, 2));
  const imageEntries = entries.map((e) => ({
    ...e,
    image: 'data:image/png;base64,' + fs.readFileSync(path.join(output, e.file)).toString('base64'),
  }));
  const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Geld workspace review</title><style>body{font:13px system-ui;background:#f5f5f5;margin:24px;color:#222}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}button,input{font:inherit;padding:8px;border:1px solid #ccc;background:white}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}article{background:white;border:1px solid #ddd;padding:10px}img{width:100%;cursor:zoom-in}h2{font-size:13px}dialog{max-width:94vw;max-height:94vh}dialog img{width:auto;max-width:100%}</style><h1>Geld workspace review</h1><p>Actual application views with synthetic data. Select a screenshot to inspect it.</p><nav><button data-group="desktop">Desktop</button><button data-group="mobile">Mobile</button><button data-group="dark">Dark</button><input aria-label="Find view" placeholder="Find view"></nav><main></main><dialog><button onclick="this.parentElement.close()">Close</button><img></dialog><script>const entries=${JSON.stringify(imageEntries)};let group='desktop';function render(){document.querySelector('main').replaceChildren();for(const e of entries.filter(e=>e.group===group&&e.name.includes(document.querySelector('input').value))){const a=document.createElement('article'),h=document.createElement('h2'),i=document.createElement('img');h.textContent=e.name;i.src=e.image;i.alt=e.name;i.onclick=()=>{document.querySelector('dialog img').src=i.src;document.querySelector('dialog').showModal()};a.append(h,i);document.querySelector('main').append(a)}}document.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{group=b.dataset.group;render()});document.querySelector('input').oninput=render;render();</script></html>`;
  fs.writeFileSync(path.join(output, 'preview.html'), html);
  console.log(
    'Verified',
    entries.length,
    'screenshots, keyboard search and zero overflow or runtime errors.',
  );
} finally {
  await browser.close();
}
