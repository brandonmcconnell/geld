import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { configure } from './design-fixtures.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GELD_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.GELD_DESIGN_URL || 'http://localhost:3001';
const browser = await chromium.launch({ executablePath: process.env.GELD_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
async function weight(locator, expected) {
  await locator.waitFor();
  const result = await locator.evaluate((icon) => Object.fromEntries([...icon.children].map((child) => [child.getAttribute('data-icon-weight'), getComputedStyle(child).display])));
  assert.equal(result[expected], 'block');
  assert.equal(result[expected === 'regular' ? 'solid' : 'regular'], 'none');
}
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme });
    await configure(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    const decline = page.getByRole('button', { name: 'Decline optional', exact: true });
    if (await decline.count()) await decline.first().click();
    await weight(page.getByRole('link', { name: 'Review queue', exact: true }).locator('.app-icon'), 'solid');
    await weight(page.getByRole('link', { name: 'Repositories', exact: true }).locator('.app-icon'), 'regular');
    const row = page.locator('.pull-row').first();
    const star = row.locator('.star-button');
    await row.locator('input[type=checkbox]').check();
    await weight(row.locator(':scope > .app-icon'), 'solid');
    await weight(star.locator('.app-icon'), 'regular');
    await row.locator('input[type=checkbox]').uncheck();
    await weight(row.locator(':scope > .app-icon'), 'regular');
    await weight(star.locator('.app-icon'), 'regular');
    await star.hover();
    await star.focus();
    await weight(star.locator('.app-icon'), 'regular');
    await star.click();
    await weight(star.locator('.app-icon'), 'solid');
    await star.click();
    await weight(star.locator('.app-icon'), 'regular');
    await page.getByRole('button', { name: 'Select repository', exact: true }).click();
    const all = page.getByRole('button', { name: 'All repositories', exact: true });
    await weight(all.locator('.app-icon').first(), 'solid');
    const repository = page.getByRole('button', { name: 'acme/platform on github.com', exact: true });
    assert.equal(await repository.locator('.app-icon').first().getAttribute('data-icon'), 'lock');
    await weight(repository.locator('.app-icon').first(), 'regular');
    await repository.click();
    await page.waitForURL('**/github/acme/platform');
    await weight(page.locator('a[aria-current="page"] .app-icon[data-icon="lock"]'), 'solid');
    await page.goto(base + '/settings/providers', { waitUntil: 'networkidle' });
    await weight(page.getByRole('link', { name: 'AI providers', exact: true }).locator('.app-icon'), 'solid');
    await page.goto(base + '/github/acme/platform/pull/128', { waitUntil: 'networkidle' });
    const assistant = page.getByRole('button', { name: 'Toggle assistant', exact: true });
    await weight(assistant.locator('.app-icon'), 'regular');
    await assistant.click();
    await weight(assistant.locator('.app-icon'), 'solid');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS Sharp Regular/Solid navigation, selected scopes, stars, private repositories and assistant states in light and dark themes. Hover/focus remain Regular.');
} finally { await browser.close(); }
