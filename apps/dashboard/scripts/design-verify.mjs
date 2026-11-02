import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { configure } from './design-fixtures.mjs';
const loadModule = createRequire(import.meta.url);
const { chromium } = loadModule(process.env.GELD_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.GELD_DESIGN_URL || 'http://localhost:3001';
const pull = '/github/acme/platform/pull/128';
const browser = await chromium.launch({
  executablePath: process.env.GELD_CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const errors = [];
async function open(state = {}, width = 1440, url = '/') {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    hasTouch: width < 761,
    isMobile: width < 761,
  });
  context.setDefaultTimeout(10000);
  const writes = await configure(context, state);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + url, { waitUntil: 'networkidle' });
  if (await page.getByRole('region', { name: 'Privacy choices' }).count())
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  return { context, page, writes };
}
try {
  const queue = await open();
  await queue.page.keyboard.press('/');
  assert.equal(
    await queue.page
      .getByRole('textbox', { name: 'Filter pull requests' })
      .evaluate((e) => document.activeElement === e),
    true,
  );
  await queue.page.getByRole('textbox', { name: 'Filter pull requests' }).fill('expired');
  assert.equal(await queue.page.locator('.pull-row').count(), 1);
  await queue.page.getByRole('textbox', { name: 'Filter pull requests' }).fill('');
  await queue.page.getByRole('button', { name: 'Star pull request', exact: true }).first().click();
  await queue.page.getByRole('tab', { name: 'Starred', exact: true }).click();
  assert.equal(await queue.page.locator('.pull-row').count(), 1);
  await queue.page.reload({ waitUntil: 'networkidle' });
  await queue.page.getByRole('tab', { name: 'Starred', exact: true }).click();
  assert.equal(await queue.page.locator('.pull-row').count(), 1);
  await queue.context.close();
  console.log('PASS queue search shortcut, filtering and persistent stars');
  const review = await open({ guided: true }, 1440, pull);
  await review.page.getByRole('heading', { name: 'Preserve completed review steps', exact: true }).waitFor();
  await review.page.getByRole('button', { name: 'Accept and next', exact: false }).click();
  await review.page.locator('.review-finish').waitFor();
  await review.page.reload({ waitUntil: 'networkidle' });
  await review.page.locator('.review-finish').waitFor();
  await review.page.getByRole('button', { name: 'All changes', exact: true }).click();
  await review.page.getByRole('button', { name: 'Wrap lines', exact: true }).click();
  assert.equal(
    await review.page
      .locator('.diff-files')
      .first()
      .evaluate((e) => e.classList.contains('diff-wrap')),
    true,
  );
  assert.equal(
    await review.page
      .locator('.diff-code pre')
      .first()
      .evaluate((e) => getComputedStyle(e).whiteSpace),
    'pre-wrap',
  );
  await review.page.getByRole('navigation', { name: 'Changed files', exact: true }).getByRole('link').first().click();
  assert.match(review.page.url(), /#diff-/);
  assert.equal(
    await review.page.evaluate(() => document.getElementById(decodeURIComponent(location.hash.slice(1))) !== null),
    true,
  );
  assert.equal(
    await review.page
      .locator('.diff-table')
      .first()
      .evaluate(
        (table) =>
          table.querySelector('.diff-code').getBoundingClientRect().width > table.getBoundingClientRect().width * 0.6,
      ),
    true,
  );
  await review.page.getByRole('button', { name: 'Submit review', exact: false }).click();
  await review.page.getByLabel('Review summary', { exact: true }).fill('The unchanged progress case looks good.');
  await review.page.getByRole('button', { name: 'Submit comment review', exact: true }).click();
  await review.page.getByRole('dialog').waitFor({ state: 'hidden' });
  const write = review.writes.find((w) => w.path === '/api/review');
  assert(write);
  assert.equal(JSON.parse(write.body).body, 'The unchanged progress case looks good.');
  await review.context.close();
  console.log('PASS guided progress persistence, wrapping, file navigation and review submission');
  const auth = await open({ signedOut: true }, 390, '/sign-up');
  await auth.page.getByLabel('Email address', { exact: true }).fill('invalid-address');
  await auth.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
  assert.equal(auth.writes.length, 0);
  await auth.page.getByLabel('Email address', { exact: true }).fill('jordan@example.test');
  await auth.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
  await auth.page.getByLabel('One-time code', { exact: true }).waitFor();
  assert.equal(JSON.parse(auth.writes.at(-1).body).email, 'jordan@example.test');
  await auth.page.getByRole('button', { name: 'Use a different email', exact: true }).click();
  assert.equal(await auth.page.getByLabel('Email address', { exact: true }).isEnabled(), true);
  await auth.page.goto(base + '/settings/account/reset-password?token=synthetic-only', { waitUntil: 'networkidle' });
  await auth.page.getByLabel('New password', { exact: true }).fill('synthetic-new-password');
  await auth.page.getByRole('button', { name: 'Save password', exact: true }).click();
  await auth.page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor();
  assert.equal(await auth.page.locator('input[type=password]').count(), 0);
  await auth.context.close();
  console.log('PASS email validation, account creation code stage, change-email recovery and password reset success');
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    const test = await open({}, width);
    for (const url of ['/', pull, '/settings/account', '/connect']) {
      await test.page.goto(base + url, { waitUntil: 'networkidle' });
      if (url === pull) await test.page.getByRole('button', { name: 'All changes', exact: true }).click();
      assert.equal(
        await test.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        `${url} overflows at ${width}`,
      );
    }
    if (width < 1024) {
      await test.page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await test.page.getByRole('dialog', { name: 'Navigation', exact: true }).waitFor();
      await test.page.keyboard.press('Escape');
      await test.page.getByRole('dialog', { name: 'Navigation', exact: true }).waitFor({ state: 'hidden' });
    }
    await test.context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS 320–1920px layout boundaries, keyboard navigation dismissal, zero page overflow and zero runtime errors',
  );
} finally {
  await browser.close();
}
