import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { configure, teamId } from './design-fixtures.mjs';
const loadModule = createRequire(import.meta.url);
const { chromium } = loadModule(process.env.GELD_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.GELD_DESIGN_URL || 'http://localhost:3001';
const pull = '/github/acme/platform/pull/128';
const browser = await chromium.launch({
  executablePath: process.env.GELD_CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const errors = [];
async function open(state = {}, width = 1440, url = '/', dismiss = true) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    hasTouch: width < 761,
    isMobile: width < 761,
    reducedMotion: 'reduce',
  });
  context.setDefaultTimeout(10000);
  const writes = await configure(context, state);
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + url, { waitUntil: 'networkidle' });
  if (dismiss && (await page.getByRole('region', { name: 'Privacy choices', exact: true }).count()))
    await page.getByRole('button', { name: 'Decline optional', exact: true }).click();
  return { context, page, writes, requests };
}
async function tab(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
}
async function privacy(page) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Privacy choices', exact: true }).click();
  await page.getByRole('dialog', { name: 'Privacy settings', exact: true }).waitFor();
}
try {
  const q = await open();
  await q.page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  assert.equal(await q.page.getByRole('link', { name: 'Review queue', exact: true }).count(), 1);
  assert.equal(await q.page.getByRole('link', { name: 'Repositories', exact: true }).count(), 1);
  await q.page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await q.page.keyboard.press('/');
  assert.equal(
    await q.page.getByRole('textbox', { name: 'Filter pull requests' }).evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(await q.page.locator('.pull-row').count(), 5);
  assert.equal(await q.page.locator('.draft-icon').count(), 1);
  await q.page.getByRole('textbox', { name: 'Filter pull requests' }).fill('author:alex');
  assert.equal(await q.page.locator('.pull-row').count(), 1);
  await q.page.getByRole('textbox', { name: 'Filter pull requests' }).fill('');
  await tab(q.page, 'Requested from me');
  assert.equal(await q.page.locator('.pull-row').count(), 2);
  await tab(q.page, 'Requested by me');
  assert.equal(await q.page.locator('.pull-row').count(), 1);
  await q.page.getByRole('tab', { name: /^All/ }).click();
  const second = await q.page.locator('.pull-row').nth(1).locator('.pull-title').textContent();
  await q.page.locator('.pull-row').nth(1).getByRole('button', { name: 'Star pull request', exact: true }).click();
  assert.equal(await q.page.locator('.pull-row').first().locator('.pull-title').textContent(), second);
  await q.page.reload({ waitUntil: 'networkidle' });
  assert.equal(await q.page.locator('.pull-row').first().locator('.pull-title').textContent(), second);
  await q.page.getByRole('checkbox', { name: 'Select visible pull requests', exact: true }).check();
  await q.page.getByRole('button', { name: 'Star', exact: true }).click();
  assert.equal(await q.page.locator('.star-button[aria-pressed=true]').count(), 5);
  await q.page
    .getByRole('button', { name: /hidden$/ })
    .first()
    .click();
  await q.page.getByRole('heading', { name: 'Hidden from your review', exact: true }).waitFor();
  assert.equal(await q.page.locator('.counts-popover dl > div').count(), 4);
  await q.page.keyboard.press('Escape');
  await q.page.getByRole('button', { name: 'Open a review', exact: true }).click();
  await q.page
    .getByLabel('Pull request URL', { exact: true })
    .filter({ visible: true })
    .fill('https://github.com/acme/platform/pull/128');
  await q.page.getByRole('button', { name: 'Open review', exact: true }).click();
  await q.page.waitForURL('**' + pull);
  await q.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await q.page.getByRole('link', { name: 'Review queue', exact: true }).click();
  await q.page.getByRole('button', { name: 'Switch team', exact: true }).click();
  await q.page.getByRole('button', { name: 'Platform engineering', exact: true }).click();
  await q.context.route('**/api/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: null, configured: true, demo: false }),
    }),
  );
  await q.context.route('**/api/teams', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Signed out' }) }),
  );
  await q.page.getByRole('button', { name: 'Refresh review queue', exact: true }).click();
  await q.page.locator('.account-name:visible').filter({ hasText: 'Sign in' }).waitFor();
  assert.equal(await q.page.locator('.pull-row').count(), 0);
  await q.page.getByRole('button', { name: 'Switch team', exact: true }).click();
  assert.equal(await q.page.getByRole('button', { name: 'Platform engineering', exact: true }).count(), 0);
  await q.context.close();
  console.log(
    'PASS queue readiness, both request directions, filtering, persistent pinning, bulk stars, hidden counts and URL navigation',
  );
  const review = await open({ guided: true }, 1440, pull);
  await tab(review.page, 'Guide');
  await review.page.getByRole('button', { name: 'Reply', exact: true }).click();
  await review.page.getByRole('textbox', { name: 'Reply to this thread', exact: true }).fill('Local draft only.');
  await review.page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(review.writes.filter((write) => write.path === '/api/review').length, 0);
  await review.page.getByRole('button', { name: /Accept and next/ }).click();
  await review.page.getByRole('heading', { name: 'Keep saved progress inside the account', exact: true }).waitFor();
  await review.page.getByRole('button', { name: 'Flag with a note', exact: true }).click();
  await review.page
    .getByRole('textbox', { name: 'What needs another look?', exact: true })
    .fill('Check storage migration.');
  await review.page.getByRole('button', { name: /Flag and continue/ }).click();
  await review.page.getByRole('heading', { name: 'Compare the changed code', exact: true }).waitFor();
  await review.page.getByRole('button', { name: /Accept and next/ }).click();
  await review.page.getByRole('heading', { name: 'Guide complete', exact: true }).waitFor();
  await review.page.reload({ waitUntil: 'networkidle' });
  await tab(review.page, 'Guide');
  await review.page.getByRole('heading', { name: 'Guide complete', exact: true }).waitFor();
  await tab(review.page, 'Diff');
  await review.page.getByRole('button', { name: 'Wrap lines', exact: true }).click();
  assert.equal(
    await review.page
      .locator('.diff-code pre')
      .first()
      .evaluate((e) => getComputedStyle(e).whiteSpace),
    'pre-wrap',
  );
  assert.equal(
    await review.page
      .locator('.diff-table')
      .first()
      .evaluate(
        (e) => e.querySelector('.diff-code').getBoundingClientRect().width > e.getBoundingClientRect().width * 0.6,
      ),
    true,
  );
  await review.page
    .getByRole('navigation', { name: 'Changed files', exact: true })
    .getByRole('link')
    .filter({ hasText: 'docs/review-guides.md' })
    .click();
  assert.equal(await review.page.locator('.supporting-section[open]').count(), 1);
  assert.equal(
    await review.page.evaluate(() => !!document.getElementById(decodeURIComponent(location.hash.slice(1)))),
    true,
  );
  await review.page.getByRole('button', { name: /Submit review/ }).click();
  await review.page
    .getByLabel('Review summary', { exact: true })
    .filter({ visible: true })
    .fill('Reviewed the unchanged progress case.');
  await review.page.getByRole('button', { name: 'Submit comment review', exact: true }).click();
  await review.page.getByRole('dialog').waitFor({ state: 'hidden' });
  const write = review.writes.find((w) => w.path === '/api/review');
  assert.ok(write);
  assert.equal(JSON.parse(write.body).headSha.length > 0, true);
  await review.context.close();
  console.log(
    'PASS guide accept/flag progression and persistence, completion, categorized hidden-file navigation, code width and actual review payload',
  );
  const staleDigest = await open({ staleBot: true }, 1440, pull);
  assert.equal(await staleDigest.page.locator('.digest-status-list [data-stale=true]').count(), 2);
  assert.equal(await staleDigest.page.locator('.digest-verdict').filter({ hasText: '5/5' }).count(), 0);
  await staleDigest.context.close();
  const untrusted = await open({ untrustedDigest: true }, 1440, pull);
  assert.equal(await untrusted.page.locator('.digest-status').count(), 0);
  await untrusted.page.getByText('untrusted-author', { exact: true }).filter({ visible: true }).waitFor();
  await untrusted.context.close();
  const mobileGuide = await open({ guided: true }, 390, pull);
  await tab(mobileGuide.page, 'Guide');
  assert.equal(await mobileGuide.page.locator('#guide-steps').isVisible(), false);
  await mobileGuide.page.getByRole('button', { name: /^Step 1 of 3/ }).click();
  await mobileGuide.page.getByRole('button', { name: /Keep saved progress inside the account/ }).click();
  assert.equal(await mobileGuide.page.locator('#guide-steps').isVisible(), false);
  await mobileGuide.page
    .getByRole('heading', { name: 'Keep saved progress inside the account', exact: true })
    .waitFor();
  await mobileGuide.context.close();
  const stress = await open({ guided: true, largeGuide: true }, 1440, pull);
  await tab(stress.page, 'Guide');
  assert.equal(
    await stress.page.locator('.step-sidebar ol').evaluate((e) => e.scrollHeight > e.clientHeight * 3),
    true,
  );
  await stress.page.getByLabel('Find a step', { exact: true }).filter({ visible: true }).fill('200.');
  await stress.page.locator('.step-link:visible').click();
  assert.match(await stress.page.locator('.step-story h2').textContent(), /^200\./);
  await stress.context.close();
  const settings = await open({}, 1440, '/settings/providers');
  assert.equal(await settings.page.getByRole('link', { name: 'AI providers', exact: true }).count(), 1);
  assert.equal(await settings.page.locator('a[aria-current=page]').count(), 1);
  assert.equal(await settings.page.locator('.workspace-header,.settings-navigation').count(), 0);
  await settings.page.goto(base + '/github/acme/platform', { waitUntil: 'networkidle' });
  assert.equal(await settings.page.locator('.breadcrumbs').count(), 0);
  assert.equal(await settings.page.locator('.page:visible').count(), 1);
  await settings.page.getByRole('link', { name: 'Repository settings', exact: true }).click();
  await settings.page.getByRole('navigation', { name: 'Settings navigation', exact: true }).waitFor();
  await settings.page.goto(base + '/github/acme', { waitUntil: 'networkidle' });
  await settings.page.getByRole('link', { name: 'Organization settings', exact: true }).click();
  await settings.page.getByRole('navigation', { name: 'Settings navigation', exact: true }).waitFor();
  await settings.page.goto(base + '/teams/' + teamId + '?view=members', { waitUntil: 'networkidle' });
  await settings.page.getByRole('heading', { name: 'Members', exact: true }).first().waitFor();
  assert.equal(await settings.page.locator('.settings-card:visible').count(), 2);
  await settings.page.goto(base + '/settings/billing', { waitUntil: 'networkidle' });
  await settings.page.getByRole('button', { name: 'Compare plans', exact: true }).click();
  assert.equal(await settings.page.locator('.pricing-card').count(), 3);
  await settings.context.close();
  console.log('PASS long-guide navigation, contextual settings and Model A plan comparison');
  const consent = await open({ measurement: true }, 1440, '/', false);
  await consent.page.getByRole('button', { name: 'Decline optional', exact: true }).click();
  assert.equal(consent.requests.filter((url) => url.includes('/api/measurement/')).length, 0);
  await privacy(consent.page);
  await consent.page.getByRole('checkbox', { name: 'Usage measurement', exact: false }).check();
  const request = consent.page.waitForRequest('**/api/measurement/config');
  await consent.page.getByRole('button', { name: 'Save choices', exact: true }).click();
  await request;
  await consent.page.waitForFunction(() =>
    window.__geldMeasurement?.events.some((event) => event.event === 'route_visit'),
  );
  await privacy(consent.page);
  await consent.page.getByRole('checkbox', { name: 'Usage measurement', exact: false }).uncheck();
  await consent.page.getByRole('button', { name: 'Save choices', exact: true }).click();
  await consent.page.waitForFunction(() => window.__geldMeasurement?.optedOut > 0);
  const before = await consent.page.evaluate(() => window.__geldMeasurement.events.length);
  await consent.page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('geld:measurement', {
        detail: { event: 'feature_usage', properties: { feature: 'assistant', stage: 'started' } },
      }),
    ),
  );
  assert.equal(await consent.page.evaluate(() => window.__geldMeasurement.events.length), before);
  await consent.context.close();
  const gpc = await open({ gpc: true, measurement: true }, 1440, '/', false);
  await privacy(gpc.page);
  assert.equal(await gpc.page.getByRole('checkbox', { name: 'Usage measurement', exact: false }).isDisabled(), true);
  await gpc.page.getByRole('button', { name: 'Save choices', exact: true }).click();
  assert.equal(gpc.requests.filter((url) => url.includes('/api/measurement/')).length, 0);
  await gpc.context.close();
  const auth = await open({ signedOut: true }, 390, '/sign-up');
  await auth.page.getByLabel('Email address', { exact: true }).filter({ visible: true }).fill('invalid-address');
  await auth.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
  assert.equal(auth.writes.length, 0);
  await auth.page.getByLabel('Email address', { exact: true }).filter({ visible: true }).fill('jordan@example.test');
  await auth.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
  await auth.page.getByLabel('One-time code', { exact: true }).filter({ visible: true }).waitFor();
  await auth.page.getByRole('button', { name: 'Use a different email', exact: true }).click();
  assert.equal(
    await auth.page.getByLabel('Email address', { exact: true }).filter({ visible: true }).isEnabled(),
    true,
  );
  await auth.page.goto(base + '/settings/account/reset-password?token=synthetic-only', { waitUntil: 'networkidle' });
  await auth.page.getByLabel('New password', { exact: true }).filter({ visible: true }).fill('synthetic-new-password');
  await auth.page.getByRole('button', { name: 'Save password', exact: true }).click();
  await auth.page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor();
  assert.equal(await auth.page.locator('input[type=password]').count(), 0);
  await auth.context.close();
  console.log('PASS c15t opt-in and revocation, email validation, account code flow and password clearing');
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    const test = await open({}, width);
    for (const url of [
      '/',
      pull,
      '/settings/account',
      '/settings/providers',
      '/connect',
      '/teams/' + teamId + '?view=members',
    ]) {
      await test.page.goto(base + url, { waitUntil: 'networkidle' });
      if (url === pull) await tab(test.page, 'Diff');
      assert.equal(
        await test.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        url + ' overflows at ' + width,
      );
    }
    if (width < 1024) {
      await test.page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await test.page.keyboard.press('Escape');
      await test.page.getByRole('dialog', { name: 'Navigation', exact: true }).waitFor({ state: 'hidden' });
    }
    await test.context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS 320–1920px layouts, keyboard navigation dismissal and zero runtime errors');
} finally {
  await browser.close();
}
