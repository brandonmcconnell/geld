import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { configure } from './design-fixtures.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GELD_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.GELD_CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const base = process.env.GELD_DESIGN_URL || 'http://localhost:3001';
const errors = [];
try {
  for (const [width, colorScheme] of [
    [320, 'light'],
    [390, 'light'],
    [768, 'light'],
    [1440, 'light'],
    [1440, 'dark'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      colorScheme,
      reducedMotion: 'reduce',
    });
    await configure(context, { noSummary: true });
    const page = await context.newPage();
    const requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().includes('/api/pull/activity')) requests.push(r.url());
    });
    await page.goto(base + '/github/acme/platform/pull/128', { waitUntil: 'networkidle' });
    const decline = page.getByRole('button', { name: 'Decline optional', exact: true });
    if (await decline.count()) await decline.first().click();
    await page.locator('.native-digest[aria-busy=false]').waitFor();
    assert.equal(await page.locator('.digest-check-row').count(), 5);
    await page.getByText('1 approved', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Review summary', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: /full timeline/i }).count(), 0);
    assert.ok(
      await page.getByRole('link', { name: 'Open original pull request on GitHub' }).getAttribute('href'),
    );
    await page.getByRole('button', { name: 'Read Greptile review', exact: true }).click();
    await page
      .locator('.digest-bot-evidence')
      .getByText('No actionable issues found.', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Read Greptile review', exact: true }).click();
    const style = await page
      .getByRole('button', { name: 'Review changes', exact: true })
      .evaluate((el) => ({
        background: getComputedStyle(el).backgroundImage,
        shadow: getComputedStyle(el).boxShadow,
      }));
    assert.ok(style.background.includes('gradient'));
    assert.notEqual(style.shadow, 'none');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
      `${width} ${colorScheme} overflow`,
    );
    const requestsBeforeSwitch = requests.length;
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    await page.getByText('added a commit', { exact: true }).waitFor();
    await page.getByText('requested a review from jordan', { exact: true }).waitFor();
    assert.equal(await page.locator('.native-timeline table').count(), 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
      `${width} timeline overflow`,
    );
    assert.equal(requests.length, requestsBeforeSwitch, 'Switching views does not refetch activity');
    await context.close();
    console.log(
      `PASS native Digest, internal timeline, bot evidence, material buttons and Markdown at ${width}px / ${colorScheme}`,
    );
  }
  const partial = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await configure(partial, { noSummary: true, feedPartial: true });
  const page = await partial.newPage();
  await page.goto(base + '/github/acme/platform/pull/128', { waitUntil: 'networkidle' });
  await page.locator('.native-digest[aria-busy=false]').waitFor();
  assert.equal(await page.locator('.digest-check-row').count(), 5);
  await page.getByText('Some checks could not be loaded. Available results are shown.', { exact: true }).waitFor();
  await partial.close();
  console.log('PASS partial checks remain marked partial after later pages load');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
