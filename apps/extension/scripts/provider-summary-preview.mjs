import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function verifyProviderSummaryPreview(page, item, { poll, patchSettings, artifacts }) {
  await patchSettings({ enabled: true, prOverview: true, quickReview: false, aiEnabled: false, repoConfigs: 'never', compactTimeline: 'compact', trustedReviewAccounts: ['gitlab.com/whitebox-aero/whitebox greptile 37628862'] });
  const selector = '[data-geld-summary-preview]';
  await poll(() => page.$(selector), Boolean, 'Verified Greptile summary preview', 45000);
  const button = await page.$(selector);
  await button.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await button.hover();
  await poll(() => page.$('.geld-provider-summary-preview'), Boolean, 'Summary hover card', 5000);
  const read = () => page.evaluate(() => {
    const button = document.querySelector('[data-geld-summary-preview]');
    const card = document.querySelector('.geld-provider-summary-preview');
    const section = button.closest('[data-geld-review-key]');
    return {
      label: button.getAttribute('aria-label'), nestedButton: button.parentElement.closest('button') !== null,
      openSection: section.getAttribute('data-geld-review-open'), height: section.getBoundingClientRect().height,
      expanded: button.getAttribute('aria-expanded'), cardRole: card?.getAttribute('role'),
      content: card?.querySelector('.geld-provider-summary-preview__body')?.textContent.trim(),
      liveBodyControls: card?.querySelectorAll('.geld-provider-summary-preview__body :is(button, input, img, video, iframe, [id])').length,
      source: card?.querySelector(':scope > a')?.href,
    };
  });
  const hover = await read();
  assert.equal(hover.nestedButton, false);assert.equal(hover.openSection, 'false');
  assert.equal(hover.expanded, 'true');assert.equal(hover.cardRole, 'dialog');
  assert.ok(hover.content?.length > 30);assert.equal(hover.liveBodyControls, 0);
  assert.match(hover.source, /^https:\/\/gitlab\.com\/whitebox-aero\/whitebox\/-\/merge_requests\/272#note_\d+$/);
  assert.ok(hover.height <= 44, 'Preview controls preserve the compact bot row');
  const png = await page.screenshot({ path: resolve(artifacts, 'gitlab-ui-summary-preview.png'), encoding: 'base64' });
  console.log(`PROVIDER_UI_IMAGE ${JSON.stringify({ provider: 'gitlab', name: 'summary-preview', png })}`);
  await page.keyboard.press('Escape');
  await poll(() => page.$('.geld-provider-summary-preview'), value => value === null, 'Preview Escape dismissal', 5000);
  await button.click();
  await poll(() => page.$('.geld-provider-summary-preview'), Boolean, 'Click opens the same preview', 5000);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-geld-summary-preview')), true);
  await button.dispose();
  item.summaryPreview = hover;
  console.log(`PROVIDER_SUMMARY_PREVIEW ${JSON.stringify(hover)}`);
  return { verified: 'Verified public bot summary hover/click, compact row, Escape and focus', summaryPreview: hover };
}
