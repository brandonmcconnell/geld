import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function verifyProviderUi(page, item, { provider, poll, patchSettings, artifacts }) {
  const frames = [];
  const frame = async name => {
    const png = await page.screenshot({ path: resolve(artifacts, `${provider}-ui-${name}.png`), encoding: 'base64', fullPage: false });
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
      outlineIcons: [...panel.querySelectorAll('svg[data-geld-outline]')].map(svg => ({ fill: getComputedStyle(svg).fill, shapes: [...svg.children].map(shape => getComputedStyle(shape).fill) })),
      closed: closed.length, allClosed: closed.every(el => getComputedStyle(el).display === 'none'),
      family: getComputedStyle(panel).fontFamily, size: getComputedStyle(panel).fontSize,
    };
  });
  console.log(`PROVIDER_UI_STAGE ${JSON.stringify({ provider, stage: 'digest', digest })}`);
  assert.equal(digest.title, 'Geld');assert.equal(digest.hasMetrics, false);assert.equal(digest.hasRequestWarning, false);
  assert.equal(digest.settingsLabel, 'Open Geld settings');assert.equal(digest.settingsText, '');assert.ok(digest.hasCopyIcon);
  assert.ok(digest.closed > 0 && digest.allClosed, 'Collapsed rows must conceal their details');
  assert.ok(digest.outlineIcons.length > 0 && digest.outlineIcons.every(icon => icon.fill === 'none' && icon.shapes.every(fill => fill === 'none')), 'Provider CSS must not fill Geld outline icons');
  await page.$eval('.geld-provider-review__header', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));await frame('digest');
  await click('.geld-provider-review__menu:has([data-geld-view-slot]) > summary');
  const combined = await page.$eval('[data-geld-digest-view="digest-timeline"]', el => ({ text: el.textContent.trim(), label: el.getAttribute('aria-label'), icons: el.querySelectorAll('svg').length }));
  assert.equal(combined.text, '+');assert.equal(combined.icons, 2);assert.ok(combined.label.includes(provider === 'gitlab' ? 'GitLab' : 'Bitbucket'));
  await frame('view-menu');await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.geld-provider-review__menu:has([data-geld-view-slot])', el => el.open), false);
  let focusError;
  try {
    await click('.geld-provider-review__menu:has([data-geld-view-slot]) > summary');
    await click('[data-geld-digest-view="github"]');
    await poll(() => page.$eval('.geld-provider-review', el => el.hidden), Boolean, 'Native timeline selected', 5000);
    await poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-geld-digest-view')), value => value === 'github', 'Focus on the native timeline choice', 5000);
    await click('[data-geld-digest-view="digest"]');
    await poll(() => page.$eval('.geld-provider-review', el => !el.hidden), Boolean, 'Digest selected', 5000);
    await poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-geld-toolbar-control')), value => value === 'eye', 'Focus returns to the digest View control', 5000);
  } catch (error) { focusError = error.message; }
  const focus = await page.evaluate(() => {
    const panel = document.querySelector('.geld-provider-review');
    const target = panel?.querySelector('[data-geld-toolbar-control="eye"]');
    const active = document.activeElement;
    return { active: { tag: active?.tagName, tool: active?.getAttribute('data-geld-toolbar-control'), view: active?.getAttribute('data-geld-digest-view') },
      panel: panel ? { hidden: panel.hidden, inert: panel.inert, height: panel.getBoundingClientRect().height } : null,
      target: target ? { hidden: target.closest('[hidden], [inert]') !== null, display: getComputedStyle(target).display, visibility: getComputedStyle(target).visibility, height: target.getBoundingClientRect().height } : null,
      choices: [...document.querySelectorAll('[data-geld-digest-view]')].map(el => ({ view: el.getAttribute('data-geld-digest-view'), selected: el.getAttribute('aria-pressed') })) };
  });
  console.log(`PROVIDER_UI_STAGE ${JSON.stringify({ provider, stage: 'focus', focus, focusError })}`);
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
  console.log(`PROVIDER_UI_STAGE ${JSON.stringify({ provider, stage: 'files', files })}`);
  await frame('files');
  assert.equal(files.flowCount, 0);assert.ok(files.categories.length > 1);
  assert.ok(files.categories.every(el => el.count && el.box.height >= 32));
  if (provider === 'bitbucket') {
    assert.ok(files.nav && files.tabs && files.totals, 'Verified Bitbucket tab-bar count slot');
    assert.ok(files.totals.x >= files.tabs.right - 1, 'Totals sit on the right of tabs');
    assert.ok(files.totals.y >= files.tabs.y - 1 && files.totals.bottom <= files.tabs.bottom + 1, 'Totals share the tab row');
  }
  const tests = await page.$('.geld-provider-category .geld-provider-category-header');assert.ok(tests);await tests.click();await tests.dispose();
  await poll(() => page.$eval('.geld-provider-category .geld-provider-category-header', el => el.getAttribute('aria-expanded')), value => value === 'true', 'Tests expanded');
  await frame('tests');
  const scroll = await page.evaluate(() => {
    let pane = null;
    for (let el = document.querySelector('article[data-qa="branch-diff-file"], [data-file-path]')?.parentElement; el; el = el.parentElement) {
      if (/^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) pane = el;
    }
    pane ??= document.scrollingElement;
    const before = pane.scrollTop;
    pane.scrollTo({ top: 650, behavior: 'instant' });
    return { tag: pane.tagName, before, after: pane.scrollTop, range: pane.scrollHeight - pane.clientHeight };
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readSticky = () => page.evaluate(() => {
    const header = document.querySelector('#sticky-header-content');
    if (!header) return null;
    const b = header.getBoundingClientRect();
    const style = getComputedStyle(header);
    const hits = [.2, .5, .8].flatMap(x => [.2, .5, .8].map(y => {
      const front = document.elementFromPoint(b.left + b.width * x, b.top + b.height * y);
      return { x, y, headerInFront: !!front && header.contains(front) };
    }));
    const rect = el => { if (!el) return null;const r = el.getBoundingClientRect();return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
    const totals = header.querySelector('nav > .geld-provider-header-stats');
    return { top: b.top, bottom: b.bottom, ariaHidden: header.getAttribute('aria-hidden'),
      visible: b.height > 0 && b.width > 0 && b.top < innerHeight && b.bottom > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
      tabs: rect(header.querySelector('nav > [role="tablist"]')), totals: rect(totals), totalsText: totals?.textContent,
      hits, headerInFront: hits.every(hit => hit.headerInFront) };
  });
  let stickyError;
  if (provider === 'bitbucket') {
    try { await poll(readSticky, value => value?.visible && value.headerInFront && value.totals !== null, 'Compact header has settled with adjusted counts', 5000); }
    catch (error) { stickyError = error.message; }
  }
  const sticky = await readSticky();
  console.log(`PROVIDER_UI_STAGE ${JSON.stringify({ provider, stage: 'sticky', scroll, sticky, stickyError })}`);
  await frame('scrolled');
  if (provider === 'bitbucket') {
    assert.ok(scroll.after > 0, 'Bitbucket native content pane was scrolled');
    assert.ok(sticky?.visible, 'Bitbucket sticky header is visible after scrolling');
    assert.ok(sticky.tabs && sticky.totals, 'Adjusted counts remain in the compact header');
    assert.ok(sticky.totals.x >= sticky.tabs.right - 1 && sticky.totals.y >= sticky.tabs.y - 1 && sticky.totals.bottom <= sticky.tabs.bottom + 1, 'Compact counts share the right of the tab row');
    assert.equal(stickyError, undefined, 'Compact header settles with adjusted counts');
  }
  if (sticky !== null) assert.equal(sticky.headerInFront, true, 'Native sticky header paints in front of the diff');
  item.uiAcceptance = { digest, combined, focus, focusError, files, scroll, sticky, stickyError, frames };
  console.log(`PROVIDER_UI_META ${JSON.stringify({ provider, ...item.uiAcceptance })}`);
  assert.equal(focusError, undefined, 'View changes restore keyboard focus');
  return { verified: 'Installed digest toolbar, disclosure, icon view choice, counts, categories and sticky header', uiAcceptance: item.uiAcceptance };
}
