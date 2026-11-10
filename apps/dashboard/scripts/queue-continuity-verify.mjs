import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { configure, fixture } from './design-fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GELD_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.GELD_DESIGN_URL || 'http://localhost:3001';
const browser = await chromium.launch({ executablePath: process.env.GELD_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await configure(context);
const pulls = Array.from({ length: 30 }, (_, index) => ({
  ...fixture.queue.pulls[0],
  ref: { ...fixture.queue.pulls[0].ref, number: index + 1 },
  title: `Change ${index + 1}`,
}));
let releasePage;
let signedOut = false;
const insightReads = new Map();
const errors = [];
await context.route('**/api/session', route => signedOut
  ? route.fulfill({ json: { user: null, configured: true, demo: false } })
  : route.fallback());
await context.route('**/api/queue?*', async route => {
  const params = new URL(route.request().url()).searchParams;
  if (params.get('repositoriesOnly') === 'true') return route.fallback();
  const second = params.get('cursor') === '2';
  if (second && !releasePage) await new Promise(resolve => { releasePage = resolve; });
  await route.fulfill({ json: { ...fixture.queue, pulls: second ? pulls.slice(20) : pulls.slice(0, 20), nextCursor: second ? null : '2' } });
});
await context.route('**/api/queue/insight?*', route => {
  const number = Number(new URL(route.request().url()).searchParams.get('number'));
  insightReads.set(number, (insightReads.get(number) ?? 0) + 1);
  return route.fulfill({ json: {
    headSha: pulls[0].headSha,
    essential: { files: 1, additions: 31 - number, deletions: 0 },
    hidden: { files: 0, additions: 0, deletions: 0 },
    categories: [], digest: null, requesters: [],
  } });
});
try {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.queue-change-counts').length === 20);
  const consent = page.getByRole('button', { name: 'Decline optional', exact: true });
  if (await consent.isVisible()) await consent.click();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.queue-page')?.getAttribute('aria-busy') === 'true');
  assert.equal(await page.locator('.pull-row').count(), 20, 'existing rows remain during pagination');
  assert.ok(await page.evaluate(() => scrollY > 100), 'pagination retains the reading position');
  assert.ok(releasePage);
  releasePage();
  await page.waitForFunction(() => document.querySelectorAll('.queue-change-counts').length === 30);
  assert.equal(await page.getByRole('button', { name: 'Load more', exact: true }).count(), 0);
  assert.equal(insightReads.get(1), 1, 'loading another page does not refetch earlier counts');
  await page.getByRole('combobox', { name: 'Sort pull requests', exact: true }).selectOption('size');
  assert.equal(await page.locator('.pull-title').first().textContent(), 'Change 30');
  await page.getByRole('button', { name: 'Refresh review queue', exact: true }).click();
  await page.locator('.queue-page[aria-busy=false]').waitFor();
  assert.equal(await page.locator('.pull-row').count(), 30, 'refresh keeps all previously loaded pages');
  assert.equal(await page.getByRole('button', { name: 'Load more', exact: true }).count(), 0);
  signedOut = true;
  await page.getByRole('button', { name: 'Refresh review queue', exact: true }).click();
  await page.waitForURL('**/sign-in');
  assert.equal(await page.locator('.pull-row').count(), 0);
  assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS pagination, scroll retention, cached counts, numeric sorting, refresh and sign-out isolation');
} finally {
  await context.close();
  await browser.close();
}
