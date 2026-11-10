import assert from 'node:assert/strict';

export async function verifyProviderUi(page, item, { provider, poll, patchSettings }) {
  const frames = [];
  const frame = async name => {
    const png = await page.screenshot({ encoding: 'base64', fullPage: false });
    console.log(`PROVIDER_UI_IMAGE ${JSON.stringify({ provider, name, png })}`);
    frames.push(name);
  };
  const click = async selector => {
    const target = await page.$(selector);assert.ok(target, `Missing ${selector}`);
    await target.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await target.click();await target.dispose();
  };
  await patchSettings({ enabled: true, digestView: 'digest', reviewOverview: true, reviewQuickActions: false, categories: { tests: true }, groupHidden: true, hideCommentLines: false, hideWhitespace: false, repoConfigs: 'never', aiEnabled: false });
  await poll(() => page.$('.geld-provider-review__header .geld-provider-flow-button'), Boolean, 'Digest toolbar with Flow', 45000);
  const digest = await page.evaluate(() => {
    const panel = document.querySelector('.geld-provider-review');
    const header = panel.querySelector('.geld-provider-review__header');
    const settings = header.querySelector('.geld-provider-review__settings');
    const closed = [...panel.querySelectorAll('[data-geld-review-open="false"] > .geld-provider-review__section-content')];
    return {
      title: header.querySelector('h2')?.textContent,
      hasMetrics: !!panel.querySelector('[data-geld-review-metric]'),
      hasRequestWarning: panel.textContent.includes('Request state unavailable'),
      settingsLabel: settings?.getAttribute('aria-label'), settingsText: settings?.textContent,
      hasCopyIcon: !!header.querySelector('.geld-provider-review__copy svg'),
      closed: closed.length, allClosed: closed.every(el => getComputedStyle(el).display === 'none'),
      family: getComputedStyle(panel).fontFamily, size: getComputedStyle(panel).fontSize,
    };
  });
  assert.equal(digest.title, 'Geld');assert.equal(digest.hasMetrics, false);assert.equal(digest.hasRequestWarning, false);
  assert.equal(digest.settingsLabel, 'Open Geld settings');assert.equal(digest.settingsText, '');assert.ok(digest.hasCopyIcon);
  assert.ok(digest.closed > 0 && digest.allClosed, 'Collapsed rows must conceal their details');
  await page.$eval('.geld-provider-review__header', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));await frame('digest');
  await click('.geld-provider-review__menu:has([data-geld-view-slot]) > summary');
  const combined = await page.$eval('[data-geld-digest-view="digest-timeline"]', el => ({ text: el.textContent.trim(), label: el.getAttribute('aria-label'), icons: el.querySelectorAll('svg').length }));
  assert.equal(combined.text, '+');assert.equal(combined.icons, 2);assert.ok(combined.label.includes(provider === 'gitlab' ? 'GitLab' : 'Bitbucket'));
  await frame('view-menu');await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.geld-provider-review__menu:has([data-geld-view-slot])', el => el.open), false);
  const overview = page.url();
  const changes = provider === 'gitlab' ? `${overview.split('?')[0]}/diffs?diff_id=2158520123` : `${overview.replace(/\/$/, '')}/diff`;
  if (provider === 'bitbucket') {
    const link = await page.$('a#pull-request-tabs-1');assert.ok(link);await link.click();await link.dispose();
  } else await page.goto(changes, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await poll(() => page.$('.geld-provider-category-header'), Boolean, 'File category headings', 45000);
  await poll(() => page.$('.geld-provider-header-stats'), Boolean, 'Adjusted header totals', 15000);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const files = await page.evaluate(() => {
    const rect = el => { const b = el.getBoundingClientRect();return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom, right: b.right }; };
    const nav = document.querySelector('nav[aria-label="Pull request"]:has(> .geld-provider-header-stats)');
    return {
      flowCount: document.querySelectorAll('.geld-provider-flow-button').length,
      categories: [...document.querySelectorAll('.geld-provider-category-header')].map(el => ({ label: el.getAttribute('aria-label'), count: el.querySelector('.geld-provider-category-count')?.textContent, box: rect(el) })),
      ...(nav ? { nav: rect(nav), tabs: rect(nav.querySelector('[role="tablist"]')), totals: rect(nav.querySelector('.geld-provider-header-stats')) } : {}),
    };
  });
  assert.equal(files.flowCount, 0);assert.ok(files.categories.length > 1);
  assert.ok(files.categories.every(el => el.count && el.box.height >= 32));
  if (provider === 'bitbucket') {
    assert.ok(files.nav && files.tabs && files.totals, 'Verified Bitbucket tab-bar count slot');
    assert.ok(files.totals.x >= files.tabs.right - 1, 'Totals sit on the right of tabs');
    assert.ok(files.totals.y >= files.tabs.y - 1 && files.totals.bottom <= files.tabs.bottom + 1, 'Totals share the tab row');
  }
  await frame('files');
  await page.evaluate(() => scrollBy({ top: 650, behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sticky = await page.evaluate(() => {
    const header = document.querySelector('#sticky-header-content');
    if (!header || header.getBoundingClientRect().height === 0 || getComputedStyle(header).visibility === 'hidden' || header.getAttribute('aria-hidden') === 'true') return null;
    const b = header.getBoundingClientRect(), x = b.left + b.width / 2, y = Math.max(0, b.top) + Math.min(20, b.height / 2);
    const front = document.elementFromPoint(x, y);
    return { top: b.top, bottom: b.bottom, headerInFront: !!front && header.contains(front) };
  });
  if (sticky !== null) assert.equal(sticky.headerInFront, true, 'Native sticky header paints in front of the diff');
  await frame('scrolled');
  const tests = await page.$('.geld-provider-category .geld-provider-category-header');assert.ok(tests);await tests.click();await tests.dispose();
  await poll(() => page.$eval('.geld-provider-category .geld-provider-category-header', el => el.getAttribute('aria-expanded')), value => value === 'true', 'Tests expanded');
  await frame('tests');
  item.uiAcceptance = { digest, combined, files, sticky, frames };
  console.log(`PROVIDER_UI_META ${JSON.stringify({ provider, ...item.uiAcceptance })}`);
  return { verified: 'Installed digest toolbar, disclosure, icon view choice, counts, categories and sticky header', uiAcceptance: item.uiAcceptance };
}
