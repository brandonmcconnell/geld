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
    await page.goto(base + url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) throw error;
    await page.goto(base + url, { waitUntil: 'networkidle', timeout: 30000 });
  }
  const cancel = page.getByRole('button', { name: 'Decline optional', exact: true });
  if (await page.getByRole('region', { name: 'Privacy choices' }).count()) await cancel.first().click();
  await page.evaluate(() => document.fonts.ready);
}
async function shot(page, name, label, group) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, `${group}/${name} has page overflow`);
  for (const dialog of await page.getByRole('dialog').all()) {
    if (!(await dialog.isVisible())) continue;
    const hit = await dialog.evaluate((element) => {
      const content = element.querySelector('.privacy-dialog,[data-geld-consent-card]') ?? element;
      const box = content.getBoundingClientRect();
      const point = document.elementFromPoint(
        box.left + Math.min(box.width / 2, 40),
        box.top + Math.min(box.height / 2, 30),
      );
      return {
        inside: box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
        above: point !== null && element.contains(point),
      };
    });
    assert.equal(hit.inside, true, group + '/' + name + ' dialog outside viewport');
    assert.equal(hit.above, true, group + '/' + name + ' dialog covered by backdrop');
  }
  const file = `${group}/${name}.png`;
  fs.mkdirSync(path.join(output, group), { recursive: true });
  await page.screenshot({ path: path.join(output, file), fullPage: true });
  entries.push({
    name,
    label,
    file,
    group,
    viewport: page.viewportSize(),
    route: new URL(page.url()).pathname + new URL(page.url()).search,
  });
  console.log('Captured', file);
}
let browser;
(async () => {
  browser = await chromium.launch({
    executablePath: process.env.GELD_CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  for (const group of ['desktop', 'mobile']) {
    const viewport = group === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
    const { context, page } = await create(browser, {}, viewport);
    const routes = [
      ['queue', 'Review queue', '/'],
      ['repositories', 'Repositories', '/repositories'],
      ['organization', 'Organization repositories', '/github/acme'],
      ['repository', 'Repository queue', '/github/acme/platform'],
      ['repository-settings', 'Repository settings', '/github/acme/platform/~settings'],
      ['organization-settings', 'Organization settings', '/github/acme/~settings'],
      ['teams', 'Teams', '/teams'],
      ['team', 'Team repositories', '/teams/' + teamId],
      ['team-members', 'Team members', '/teams/' + teamId + '?view=members'],
      ['team-access', 'Team access and permissions', '/teams/' + teamId + '?view=access'],
      ['team-grants', 'Team grant ledger', '/teams/' + teamId + '?view=activity'],
      ['team-sso', 'Team single sign-on', '/teams/' + teamId + '?view=sso'],
      ['team-advanced', 'Advanced team settings', '/teams/' + teamId + '?view=advanced'],
      ['review-defaults', 'Team review defaults and tracker', `/teams/${teamId}/settings`],
      ['inbox', 'Inbox', '/inbox'],
      ['connect', 'Connections and repository selection', '/connect'],
      ['repository-access', 'Repository access and visibility', '/connect?view=repositories'],
      ['settings', 'Settings entry point', '/settings'],
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
    for (const [name, state] of [
      ['queue-digest-stale', { queueDigestStale: true }],
      ['queue-digest-missing', { queueDigestMissing: true }],
      ['queue-digest-partial', { queueDigestPartial: true }],
    ]) {
      const digestState = await create(browser, state, viewport);
      await go(digestState.page, '/');
      await shot(digestState.page, name, name.replaceAll('-', ' '), group);
      await digestState.context.close();
    }
    const short = await create(browser, {}, { width: viewport.width, height: 320 });
    await go(short.page, '/not-a-dashboard-page');
    await shot(short.page, 'not-found-short', 'Page not found on a short screen', group);
    await short.context.close();
    await go(page, '/');
    if (group === 'desktop') {
      const resize = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
      await resize.focus();
      for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowRight');
      await shot(page, 'sidebar-resized', 'Wider workspace navigation', group);
      await resize.dblclick();
      await page.keyboard.press('Control+b');
      await shot(page, 'sidebar-collapsed', 'Collapsed workspace navigation', group);
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    }
    if (group === 'desktop') {
      await page.locator('.pull-row:visible input[type=checkbox]').first().check();
      await shot(page, 'queue-selection', 'Selected review and indeterminate checkbox', group);
      await page.locator('.pull-row:visible input[type=checkbox]').first().uncheck();
    }
    await page.getByRole('tab', { name: 'Requested from me', exact: true }).click();
    await shot(page, 'queue-incoming', 'Review requests received', group);
    await page.getByRole('tab', { name: 'Requested by me', exact: true }).click();
    await shot(page, 'queue-outgoing', 'Review requests sent', group);
    await page.getByRole('tab', { name: /^All/ }).click();
    await page
      .getByRole('button', { name: /^Hidden files:/ })
      .first()
      .click();
    await shot(page, 'queue-hidden-counts', 'Hidden change counts', group);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open a review', exact: true }).click();
    await shot(page, 'open-review', 'Open a pull request by URL', group);
    await page.keyboard.press('Escape');
    await go(page, '/settings/billing');
    await page.getByRole('button', { name: 'Compare plans', exact: true }).click();
    await shot(page, 'billing-plans', 'Plan comparison', group);
    await page.keyboard.press('Escape');
    await go(page, '/teams/' + teamId + '?view=sso');
    await page.locator('summary:visible').filter({ hasText: 'Connect an OIDC provider' }).click();
    await shot(page, 'sso-setup', 'Configure team single sign-on', group);
    await go(page, '/');
    if (group === 'mobile') await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Switch team', exact: true }).click();
    await shot(page, 'team-switcher', 'Search and switch teams', group);
    await page.keyboard.press('Escape');
    if (group === 'mobile' && !(await page.getByRole('button', { name: 'Account menu', exact: true }).isVisible()))
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await shot(page, 'account-menu', 'Account menu', group);
    await page.keyboard.press('Escape');
    if (group === 'mobile') await page.keyboard.press('Escape');
    if (group === 'mobile') await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Open inbox', exact: true }).click();
    await page.getByRole('heading', { name: 'Invitations', exact: true }).waitFor();
    await shot(page, 'inbox-popover', 'Inbox from the account row', group);
    await page.keyboard.press('Escape');
    if (group === 'mobile') await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Select repository', exact: true }).click();
    await page.getByRole('button', { name: 'acme/api on gitlab.com', exact: true }).waitFor();
    await shot(page, 'repository-picker', 'Search and switch repositories', group);
    await page.keyboard.press('Escape');
    for (const [name, state] of [
      ['providers-empty', { emptyProviders: true }],
      ['providers-fallback', { fallbackEnabled: true, geldEnabled: true }],
      ['providers-fallback-unavailable', { fallbackUnavailable: true }],
    ]) {
      const providerState = await create(browser, state, viewport);
      await go(providerState.page, '/settings/providers');
      await shot(providerState.page, name, name.replaceAll('-', ' '), group);
      await providerState.context.close();
    }
    await go(page, '/settings/providers');
    await page.getByRole('button', { name: 'Add a provider', exact: true }).click();
    await shot(page, 'provider-dialog', 'Add AI provider', group);
    await page.getByRole('button', { name: 'Advanced options', exact: true }).click();
    await shot(page, 'provider-advanced', 'Advanced AI provider options', group);
    await page.getByRole('radio', { name: 'Claude', exact: true }).check();
    await page.getByRole('combobox', { name: 'Connect with', exact: true }).selectOption('login');
    await shot(page, 'companion-dialog', 'Add local companion', group);
    await page.getByRole('button', { name: 'Close provider setup' }).click();
    await go(page, '/settings/providers?enable=geld');
    await page.getByRole('dialog').waitFor();
    await shot(page, 'ai-cost-confirmation', 'Geld AI cost confirmation', group);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await go(page, '/teams/' + teamId + '?view=advanced');
    await page.getByRole('button', { name: 'Preview team deletion', exact: true }).click();
    await shot(page, 'team-deletion', 'Team deletion preview', group);
    await go(page, '/teams/' + teamId + '?view=access');
    await page.getByRole('button', { name: 'Audit provider collaborators', exact: true }).click();
    await shot(page, 'collaborator-audit', 'Outside collaborator audit', group);
    await go(page, '/teams/' + teamId + '/settings');
    await page.locator('summary:visible').filter({ hasText: 'Read-only status connection' }).click();
    await shot(page, 'tracker-status', 'Issue tracker status connection', group);
    await go(page, '/settings/review');
    await page.locator('summary:visible').filter({ hasText: 'Advanced settings document' }).click();
    await shot(page, 'advanced-preferences', 'Advanced preferences', group);
    await go(page, pull);
    await page.getByRole('tab', { name: 'Diff', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Guide', exact: true }).click();
    await shot(page, 'guide-start', 'Guided review start', group);
    await page.getByRole('tab', { name: 'Diff', exact: true }).click();
    await shot(page, 'changes', 'Diff with Geld categories', group);
    await page.getByRole('button', { name: 'Wrap lines', exact: true }).click();
    await shot(page, 'changes-wrap', 'Wrapped code lines', group);
    if (group === 'mobile') {
      await page.getByRole('button', { name: /^Files/ }).click();
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
    await page.locator('.supporting-section > summary').first().click();
    await shot(page, 'supporting-changes', 'Expanded supporting changes', group);
    await page.locator('.supporting-section > summary').first().click();
    await page.getByRole('button', { name: 'Pull request actions', exact: true }).click();
    await shot(page, 'provider-actions', 'Pull request actions', group);
    await page.getByRole('dialog').getByRole('combobox', { name: 'Action', exact: true }).selectOption('settings');
    await shot(page, 'repository-actions', 'Repository action controls', group);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Digest', exact: true }).click();
    await shot(page, 'conversation', 'Pull request digest', group);
    await page.getByRole('button', { name: 'Toggle assistant', exact: true }).click();
    await shot(page, 'assistant', 'Review assistant', group);
    await page
      .getByRole('textbox', { name: 'Ask about this review', exact: true })
      .fill('What changed in the progress restore logic?');
    await page.getByRole('button', { name: 'Send to assistant', exact: true }).click();
    await page.locator('.assistant-turn.assistant').waitFor();
    await page.getByRole('button', { name: 'Send to assistant', exact: true }).waitFor();
    await shot(page, 'assistant-response', 'Assistant response in context', group);
    await page
      .getByRole('button', { name: 'Close assistant', exact: true })
      .click()
      .catch(() => {});
    await go(page, '/');
    if (group === 'mobile') await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('button', { name: 'Privacy choices', exact: true }).click();
    await page.getByRole('dialog', { name: 'Privacy settings', exact: true }).waitFor();
    await shot(page, 'privacy-dialog', 'Privacy preferences', group);
    await page.keyboard.press('Escape');
    await context.close();
    const consent = await create(browser, {}, viewport);
    await consent.page.goto(base + '/', { waitUntil: 'networkidle' });
    await shot(consent.page, 'privacy-banner', 'First visit privacy choices', group);
    await consent.context.close();
    const loading = await create(browser, { queueLoading: true }, viewport);
    await loading.page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await loading.page.locator('.skeleton-row:visible').first().waitFor();
    await shot(loading.page, 'queue-loading', 'Loading review queue', group);
    await loading.context.close();
    const guided = await create(browser, { guided: true }, viewport);
    await go(guided.page, pull);
    await guided.page.getByRole('tab', { name: 'Guide', exact: true }).click();
    await guided.page.getByRole('heading', { name: 'Preserve completed review steps', exact: true }).waitFor();
    await shot(guided.page, 'guided-step', 'Guided review step', group);
    await guided.page.getByRole('button', { name: 'Flag with a note', exact: true }).click();
    await shot(guided.page, 'flag-step', 'Flag a guided review step', group);
    await guided.page.keyboard.press('Escape');
    await guided.page.getByRole('button', { name: 'Accept and next', exact: false }).click();
    await guided.page.getByRole('button', { name: 'Accept and next', exact: false }).click();
    await guided.page.getByRole('button', { name: 'Accept and next', exact: false }).click();
    await shot(guided.page, 'guide-complete', 'Completed guided review', group);
    await guided.context.close();
    const stress = await create(browser, { guided: true, largeGuide: true }, viewport);
    await go(stress.page, pull);
    await stress.page.getByRole('tab', { name: 'Guide', exact: true }).click();
    if (group === 'mobile') await stress.page.getByRole('button', { name: /^Step 1 of 200/ }).click();
    await shot(stress.page, 'guide-large', '200-step guide navigation', group);
    await stress.context.close();
    const auth = await create(browser, { signedOut: true }, viewport);
    await go(auth.page, '/sign-in');
    await shot(auth.page, 'sign-in', 'Sign in with email code', group);
    await auth.page.getByRole('button', { name: 'Password', exact: true }).click();
    await shot(auth.page, 'password-sign-in', 'Password sign in', group);
    await auth.page.getByRole('button', { name: 'SSO', exact: true }).click();
    await shot(auth.page, 'sso-sign-in', 'Company SSO sign in', group);
    await auth.page.getByRole('button', { name: 'Magic link', exact: true }).click();
    await auth.page.getByLabel('Email address', { exact: true }).filter({ visible: true }).fill('jordan@example.test');
    await auth.page.getByRole('button', { name: 'Send a sign-in link', exact: true }).click();
    await auth.page
      .getByText('Check your email for a sign-in link.', { exact: true })
      .filter({ visible: true })
      .waitFor();
    await shot(auth.page, 'magic-link-sent', 'Magic link sent', group);
    await go(auth.page, '/sign-up');
    await shot(auth.page, 'sign-up', 'Create account', group);
    await auth.page.getByLabel('Email address', { exact: true }).filter({ visible: true }).fill('jordan@example.test');
    await auth.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
    await auth.page.getByLabel('One-time code', { exact: true }).filter({ visible: true }).waitFor();
    await shot(auth.page, 'verify-email', 'Verify email code', group);
    await go(auth.page, '/forgot-password');
    await shot(auth.page, 'forgot-password', 'Password recovery', group);
    await auth.page.getByLabel('Email address', { exact: true }).filter({ visible: true }).fill('jordan@example.test');
    await auth.page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await auth.page.getByRole('heading', { name: 'Check your inbox', exact: true }).waitFor();
    await shot(auth.page, 'reset-link-sent', 'Password recovery sent', group);
    await go(auth.page, '/settings/account/reset-password?token=synthetic-only');
    await shot(auth.page, 'reset-password', 'Set new password', group);
    await auth.page
      .getByLabel('New password', { exact: true })
      .filter({ visible: true })
      .fill('synthetic-new-password');
    await auth.page.getByRole('button', { name: 'Save password', exact: true }).click();
    await auth.page.getByText('Your password has been saved.', { exact: true }).filter({ visible: true }).waitFor();
    await shot(auth.page, 'reset-password-saved', 'Password reset success', group);
    await auth.context.close();
    for (const [name, label, url, state] of [
      ['review-signed-out', 'Public review before sign-in', pull, { signedOut: true }],
      ['digest-stale', 'Digest with bot reviews from an earlier commit', pull, { staleBot: true }],
      ['team-permission', 'Team admin permission state', '/teams/' + teamId + '?view=advanced', { member: true }],
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
        await test.page
          .getByLabel('Email address', { exact: true })
          .filter({ visible: true })
          .fill('jordan@example.test');
        await test.page.getByRole('button', { name: 'Send a one-time code', exact: true }).click();
        await test.page.getByLabel('One-time code', { exact: true }).filter({ visible: true }).fill('000000');
        await test.page.getByRole('button', { name: 'Verify code', exact: true }).click();
        await test.page
          .getByText('This code is invalid or has expired.', { exact: true })
          .filter({ visible: true })
          .waitFor();
      }
      await shot(test.page, name, label, group);
      await test.context.close();
    }
    for (const [name, state] of [
      ['inbox-empty', { emptyInbox: true }],
      ['inbox-error', { inboxError: true }],
      ['inbox-signed-out', { signedOut: true }],
    ]) {
      const inbox = await create(browser, state, viewport);
      await go(inbox.page, '/');
      if (group === 'mobile') await inbox.page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await inbox.page.getByRole('button', { name: 'Open inbox', exact: true }).click();
      const label =
        name === 'inbox-empty'
          ? 'Empty inbox'
          : name === 'inbox-error'
            ? 'Inbox connection error'
            : 'Inbox before sign-in';
      const wait =
        name === 'inbox-empty'
          ? 'You’re up to date'
          : name === 'inbox-error'
            ? 'Inbox could not be loaded.'
            : 'Sign in to view your inbox';
      await inbox.page.getByText(wait, { exact: true }).filter({ visible: true }).waitFor();
      await shot(inbox.page, name, label, group);
      await inbox.context.close();
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
    ['provider-dialog', '/settings/providers', {}],
    ['queue-selection', '/', {}],
    ['inbox-popover', '/', {}],
    ['not-found', '/not-a-dashboard-page', {}],
  ]) {
    const dark = await create(browser, state, { width: 1440, height: 1000 }, 'dark');
    await go(dark.page, url);
    if (name === 'provider-dialog')
      await dark.page.getByRole('button', { name: 'Add a provider', exact: true }).click();
    if (name === 'queue-selection') await dark.page.locator('.pull-row:visible input[type=checkbox]').first().check();
    if (name === 'inbox-popover') {
      await dark.page.getByRole('button', { name: 'Open inbox', exact: true }).click();
      await dark.page.getByRole('heading', { name: 'Invitations', exact: true }).waitFor();
    }
    if (name === 'guided-step') await dark.page.getByRole('tab', { name: 'Guide', exact: true }).click();
    if (name === 'changes') await dark.page.getByRole('tab', { name: 'Diff', exact: true }).click();
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
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
