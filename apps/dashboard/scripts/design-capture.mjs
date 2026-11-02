import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadModule = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const { chromium } = loadModule(process.env.GELD_PLAYWRIGHT_MODULE || 'playwright');
import { configure, teamId } from './design-fixtures.mjs';
const base = process.env.GELD_DESIGN_URL || 'http://localhost:3001';
const output = path.resolve(__dirname, '../../../docs/dashboard/design/screenshots');
const entries = [];
const errors = [];
const browserWarnings = [];
const pull = '/github/acme/platform/pull/128';
async function create(browser, state = {}, viewport = { width: 1440, height: 1000 }, scheme = 'light') {
  const context = await browser.newContext({
    viewport,
    colorScheme: scheme,
    reducedMotion: 'reduce',
    hasTouch: viewport.width < 761,
    isMobile: viewport.width < 761,
  });
  context.setDefaultTimeout(10000);
  const writes = await configure(context, state);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, writes };
}
async function go(page, url) {
  try {
    await page.goto(base + url, { waitUntil: 'networkidle' });
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) throw error;
    await page.goto(base + url, { waitUntil: 'networkidle' });
  }
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  if (await page.getByRole('region', { name: 'Privacy choices' }).count()) await cancel.first().click();
  await page.evaluate(() => document.fonts.ready);
}
async function shot(page, name, label, group) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, `${group}/${name} has page overflow`);
  const file = `${group}/${name}.png`;
  fs.mkdirSync(path.join(output, group), { recursive: true });
  await page.screenshot({ path: path.join(output, file), fullPage: true });
  entries.push({ name, label, file, group, route: new URL(page.url()).pathname });
  console.log('Captured', file);
}
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.GELD_CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  for (const group of ['desktop', 'mobile']) {
    const viewport = group === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
    const { context, page } = await create(browser, {}, viewport);
    const routes = [
      ['queue', 'Review queue', '/'],
      ['repositories', 'Repositories', '/repositories'],
      ['organization', 'Provider organization', '/github/acme'],
      ['repository', 'Repository queue', '/github/acme/platform'],
      ['repository-settings', 'Repository settings', '/github/acme/platform/~settings'],
      ['organization-settings', 'Organization settings', '/github/acme/~settings'],
      ['teams', 'Teams', '/teams'],
      ['team', 'Team administration', `/teams/${teamId}`],
      ['review-defaults', 'Team review defaults and tracker', `/teams/${teamId}/settings`],
      ['inbox', 'Inbox', '/inbox'],
      ['connect', 'Connections and repository selection', '/connect'],
      ['settings', 'Settings overview', '/settings'],
      ['account', 'Account and identity settings', '/settings/account'],
      ['providers', 'AI providers and local companion', '/settings/providers'],
      ['models', 'Model selection', '/settings/models'],
      ['billing', 'Plans and billing', '/settings/billing'],
      ['security', 'Audit log', '/settings/security'],
      ['enterprise', 'Enterprise instances', '/settings/enterprise'],
      ['preferences', 'Review preferences', '/settings/review'],
      ['privacy', 'Privacy information', '/privacy'],
      ['not-found', 'Page not found', '/not-a-dashboard-page'],
    ];
    for (const [name, label, url] of routes) {
      await go(page, url);
      await shot(page, name, label, group);
    }
    await go(page, '/settings/providers');
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    await shot(page, 'provider-dialog', 'Add AI provider', group);
    await page.getByRole('dialog').locator('select').first().selectOption('claude');
    await page.getByRole('dialog').locator('select').nth(1).selectOption('login');
    await shot(page, 'companion-dialog', 'Add local companion', group);
    await page.getByRole('button', { name: 'Close provider setup' }).click();
    await go(page, '/settings/providers?enable=geld');
    await page.getByRole('dialog').waitFor();
    await shot(page, 'ai-cost-confirmation', 'Geld AI cost confirmation', group);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await go(page, `/teams/${teamId}`);
    await page.getByRole('button', { name: 'Preview team deletion', exact: true }).click();
    await shot(page, 'team-deletion', 'Team deletion preview', group);
    await go(page, `/teams/${teamId}`);
    await page.getByRole('button', { name: 'Audit provider collaborators', exact: true }).click();
    await shot(page, 'collaborator-audit', 'Outside collaborator audit', group);
    await go(page, '/settings/review');
    await page.getByText('Advanced settings document', { exact: true }).click();
    await shot(page, 'advanced-preferences', 'Advanced preferences', group);
    await go(page, pull);
    await page.getByRole('button', { name: 'All changes', exact: true }).waitFor();
    await shot(page, 'guide-start', 'Guided review start', group);
    await page.getByRole('button', { name: 'All changes', exact: true }).click();
    await shot(page, 'changes', 'All changes with file navigation', group);
    await page.getByRole('button', { name: 'Wrap lines', exact: true }).click();
    await shot(page, 'changes-wrap', 'Wrapped code lines', group);
    if (group === 'mobile') {
      await page.getByRole('button', { name: /Changed files/ }).click();
      await shot(page, 'files-menu', 'Changed file navigation', group);
      await page.getByRole('navigation', { name: 'Changed files', exact: true }).getByRole('link').first().click();
    }
    await page.getByRole('button', { name: 'Submit review', exact: false }).click();
    await shot(page, 'review-submit', 'Submit review composer', group);
    await page.getByRole('button', { name: 'Close review composer', exact: true }).click();
    await page
      .getByRole('button', { name: /^Comment on src/ })
      .first()
      .click();
    await shot(page, 'line-comment', 'Comment on a changed line', group);
    await page.getByRole('button', { name: 'Close review composer', exact: true }).click();
    await page.locator('.supporting-section > summary').click();
    await shot(page, 'supporting-changes', 'Expanded supporting changes', group);
    await page.locator('.supporting-section > summary').click();
    await page.getByRole('button', { name: 'Provider actions', exact: true }).click();
    await shot(page, 'provider-actions', 'Provider action menu', group);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await shot(page, 'conversation', 'Pull request conversation', group);
    await page.getByRole('button', { name: 'Assistant', exact: true }).click();
    await shot(page, 'assistant', 'Review assistant', group);
    await page
      .getByRole('button', { name: 'Close assistant', exact: true })
      .click()
      .catch(() => {});
    await go(page, '/');
    await page.getByRole('button', { name: 'Privacy settings', exact: true }).click();
    await shot(page, 'privacy-dialog', 'Privacy preferences', group);
    await page.keyboard.press('Escape');
    await context.close();
    const consent = await create(browser, {}, viewport);
    await consent.page.goto(base + '/', { waitUntil: 'networkidle' });
    await shot(consent.page, 'privacy-banner', 'First visit privacy choices', group);
    await consent.context.close();
    const loading = await create(browser, { queueLoading: true }, viewport);
    await loading.page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await loading.page.locator('.skeleton-row').first().waitFor();
    await shot(loading.page, 'queue-loading', 'Loading review queue', group);
    await loading.context.close();
    const guided = await create(browser, { guided: true }, viewport);
    await go(guided.page, pull);
    await guided.page.getByRole('heading', { name: 'Preserve completed review steps', exact: true }).waitFor();
    await shot(guided.page, 'guided-step', 'Guided review step', group);
    await guided.page.getByRole('button', { name: 'Flag with a note', exact: true }).click();
    await shot(guided.page, 'flag-step', 'Flag a guided review step', group);
    await guided.page.keyboard.press('Escape');
    await guided.page.getByRole('button', { name: 'Accept and next', exact: false }).click();
    await shot(guided.page, 'guide-complete', 'Completed guided review', group);
    await guided.context.close();
    const auth = await create(browser, { signedOut: true }, viewport);
    await go(auth.page, '/sign-in');
    await shot(auth.page, 'sign-in', 'Sign in with email code', group);
    await auth.page.getByRole('button', { name: 'Password', exact: true }).click();
    await shot(auth.page, 'password-sign-in', 'Password sign in', group);
    await auth.page.getByRole('button', { name: 'SSO', exact: true }).click();
    await shot(auth.page, 'sso-sign-in', 'Company SSO sign in', group);
    await auth.page.getByRole('button', { name: 'Magic link', exact: true }).click();
    await auth.page.getByLabel('Email address', { exact: true }).fill('jordan@example.test');
    await auth.page.getByRole('button', { name: 'Send a sign-in link', exact: true }).click();
    await auth.page.getByText('Check your email for a sign-in link.', { exact: true }).waitFor();
    await shot(auth.page, 'magic-link-sent', 'Magic link sent', group);
    await go(auth.page, '/sign-up');
    await shot(auth.page, 'sign-up', 'Create account', group);
    await auth.page.getByLabel('Email address', { exact: true }).fill('jordan@example.test');
    await auth.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
    await auth.page.getByLabel('One-time code', { exact: true }).waitFor();
    await shot(auth.page, 'verify-email', 'Verify email code', group);
    await go(auth.page, '/forgot-password');
    await shot(auth.page, 'forgot-password', 'Password recovery', group);
    await auth.page.getByLabel('Email address', { exact: true }).fill('jordan@example.test');
    await auth.page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await auth.page.getByRole('heading', { name: 'Check your inbox', exact: true }).waitFor();
    await shot(auth.page, 'reset-link-sent', 'Password recovery sent', group);
    await go(auth.page, '/settings/account/reset-password?token=synthetic-only');
    await shot(auth.page, 'reset-password', 'Set new password', group);
    await auth.page.getByLabel('New password', { exact: true }).fill('synthetic-new-password');
    await auth.page.getByRole('button', { name: 'Save password', exact: true }).click();
    await auth.page.getByText('Your password has been saved.', { exact: true }).waitFor();
    await shot(auth.page, 'reset-password-saved', 'Password reset success', group);
    await auth.context.close();
    for (const [name, label, url, state] of [
      ['queue-empty', 'Empty queue', '/', { emptyQueue: true }],
      ['queue-error', 'Queue connection error', '/', { queueError: true }],
      ['pull-error', 'Pull request connection error', pull, { pullError: true }],
      ['models-empty', 'Empty model catalog', '/settings/models', { emptyModels: true }],
      ['models-partial', 'Partial model catalog', '/settings/models', { partialModels: true }],
      ['onboarding', 'Connect your first provider', '/connect', { onboarding: true, emptyQueue: true }],
      ['auth-unavailable', 'Sign-in configuration unavailable', '/sign-in', { signedOut: true, configured: false }],
      ['auth-error', 'Invalid email code', '/sign-in', { signedOut: true, authError: true }],
    ]) {
      const test = await create(browser, state, viewport);
      await go(test.page, url);
      if (name === 'auth-error') {
        await test.page.getByLabel('Email address', { exact: true }).fill('jordan@example.test');
        await test.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
        await test.page.getByLabel('One-time code', { exact: true }).fill('000000');
        await test.page.getByRole('button', { name: 'Verify code', exact: true }).click();
        await test.page.getByText('This code is invalid or has expired.', { exact: true }).waitFor();
      }
      await shot(test.page, name, label, group);
      await test.context.close();
    }
    if (group === 'mobile') {
      const menu = await create(browser, {}, viewport);
      await go(menu.page, '/');
      await menu.page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await shot(menu.page, 'navigation', 'Mobile workspace navigation', group);
      await menu.page.getByRole('button', { name: 'Close navigation', exact: true }).click();
      await menu.context.close();
    }
  }
  for (const [name, url, state] of [
    ['queue', '/', {}],
    ['guided-step', pull, { guided: true }],
    ['changes', pull, {}],
    ['sign-in', '/sign-in', { signedOut: true }],
    ['account', '/settings/account', {}],
    ['providers', '/settings/providers', {}],
    ['billing', '/settings/billing', {}],
  ]) {
    const dark = await create(browser, state, { width: 1440, height: 1000 }, 'dark');
    await go(dark.page, url);
    if (name === 'changes') await dark.page.getByRole('button', { name: 'All changes', exact: true }).click();
    await shot(dark.page, name, 'Dark mode · ' + name, 'dark');
    await dark.context.close();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, '../manifest.json'),
    JSON.stringify(
      {
        note: 'Actual app views with synthetic local fixture responses. No real authentication, provider, AI, billing, or infrastructure operations were performed.',
        entries,
        warnings: browserWarnings,
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
  console.log('All captures passed:', entries.length, 'screenshots; zero runtime errors or page overflow.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
