/** Record real public-page interactions; narration is rendered offline from timed scene receipts. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const pause = ms => new Promise(done => setTimeout(done, ms));
export async function recordProviderWalkthrough(page, item, { provider, artifacts, poll, patchSettings, tabState, optionsUrl, filesOnly = false }) {
  assert.ok(['gitlab', 'bitbucket'].includes(provider));
  const scenes = [], omitted = [];
  const origin = provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org';
  const overview = provider === 'gitlab' ? 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334' : 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  const changes = provider === 'gitlab' ? `${overview}/diffs?diff_id=2158520123` : `${overview}/diff`;
  const file = `${provider}-walkthrough.webm`;
  let recorder, start;
  const snapshot = async () => page.evaluate(() => ({
    url: location.href,
    panel: !!document.querySelector('.geld-provider-review'),
    sections: [...document.querySelectorAll('.geld-provider-review [data-geld-review-key]')].map(n => n.getAttribute('data-geld-review-key')).slice(0, 30),
    categories: [...document.querySelectorAll('.geld-provider-category-header')].map(n => ({ text: n.textContent.trim(), expanded: n.getAttribute('aria-expanded') })),
    counts: [...document.querySelectorAll('.geld-provider-header-line-counts,.geld-provider-header-stats')].map(n => n.textContent.trim()).slice(0, 8),
  }));
  const handle = async (selector, text) => {
    for (const node of await page.$$(selector)) {
      const match = await node.evaluate((n, value) => {
        const b = n.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && getComputedStyle(n).visibility !== 'hidden' && !n.closest('[hidden],[inert],[aria-hidden="true"]') && (value == null || n.textContent.trim().startsWith(value));
      }, text ?? null);
      if (match) return node;
      await node.dispose();
    }
    return null;
  };
  const move = async (selector, text, click = false) => {
    const node = await handle(selector, text);assert.ok(node, `Visible control missing: ${selector} ${text ?? ''}`);
    try {
      await node.evaluate(n => n.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await pause(350);
      const b = await node.boundingBox();assert.ok(b);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
      if (click) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    } finally { await node.dispose(); }
  };
  const scene = async (id, title, narration, action = async () => {}) => {
    const entry = { id, title, narration, start: (performance.now() - start) / 1000 };
    await action();await pause(4000);
    entry.end = (performance.now() - start) / 1000;entry.observed = await snapshot();scenes.push(entry);
    item.walkthrough = { file, scenes, omitted };await writeFile(resolve(artifacts, `${provider}-walkthrough.json`), JSON.stringify(item.walkthrough, null, 2));
  };
  const optional = async (id, title, narration, action) => {
    try { await scene(id, title, narration, action); }
    catch (error) { omitted.push({ id, reason: error instanceof Error ? error.message : String(error) }); }
  };
  await patchSettings({ enabled: true, digestView: 'digest', reviewOverview: !filesOnly, reviewQuickActions: false, categories: { tests: true }, groupHidden: true, hideCommentLines: false, hideWhitespace: false, repoConfigs: 'never', aiEnabled: false });
  if (filesOnly) await poll(() => page.$('.geld-provider-category-header'), Boolean, 'Native file category controls');
  else await poll(() => page.$$eval('.geld-provider-review [data-geld-review-key]', nodes => nodes.length), count => count > 1, 'Installed conversation digest for walkthrough');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));await pause(1000);
  if (provider === 'bitbucket' && filesOnly) {
    const consent = await handle('button', 'Only necessary');
    if (consent) { await consent.dispose();await move('button', 'Only necessary', true);await pause(500); }
  }
  recorder = await page.screencast({ path: resolve(artifacts, file), fps: 24 });start = performance.now();
  try {
    if (!filesOnly) {
    await scene('orientation', `${provider === 'gitlab' ? 'GitLab' : 'Bitbucket'} · Getting oriented`, provider === 'gitlab'
      ? 'GitLab calls a pull request a merge request. This is a real public merge request with the Geld extension enabled.'
      : 'This is a real public Bitbucket pull request. Geld adds review tools while keeping the native page and its styling.');
    await scene('digest', 'Conversation digest', 'Geld brings the review conversation into a compact dashboard. The sections separate review findings, activity, and checks.', async () => move('.geld-provider-review'));
    await optional('digest-section', 'Explore a digest section', 'Open a section to inspect its contents, then fold it away when you are done.', async () => {
      const selector = '.geld-provider-review > [data-geld-review-key] > [data-geld-review-toggle]';
      await move(selector, null, true);await pause(1800);await move(selector, null, true);
    });
    await optional('original', 'The original conversation is retained', 'The combined view brings the original conversation back alongside the digest. Geld keeps those original entries available.', async () => { await move('.geld-provider-review__menu:has([data-geld-view-slot]) > summary', null, true);await move('.geld-provider-view button[data-geld-digest-view="digest-timeline"]', null, true); });
    await optional('digest-return', 'Return to the focused digest', 'Switch back to the digest to reduce the amount of conversation on screen.', async () => { await move('.geld-provider-review__menu:has([data-geld-view-slot]) > summary', null, true);await move('.geld-provider-view button[data-geld-digest-view="digest"]', null, true); });
    if (provider === 'gitlab') await optional('flow', 'Explore changed-file dependencies', 'Flow provides a graph of the changed files and their dependencies. Close it to return to the same digest.', async () => {
      await move('.geld-provider-flow-button', null, true);
      await poll(() => page.$('dialog.geld-provider-flow[open]'), Boolean, 'Visible Flow dialog', 8000);await pause(2500);
      await page.keyboard.press('Escape');
    });
    if (provider === 'bitbucket') {
      await move(`a[href="${changes}"]`, null, true);
      await poll(() => page.url(), url => url === changes, 'Native Files navigation');
    } else await page.goto(changes, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await poll(() => page.$('.geld-provider-category-header'), Boolean, 'Native file category controls');
    await poll(() => tabState(page), value => value.status === 'ready' || value.files !== undefined || value.visible !== undefined, 'Complete diff state for recording', 45000).catch(() => undefined);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));await pause(1200);
    await scene('counts', 'Adjusted change counts', 'These change counts reflect the files included in the current review. Files hidden by your categories are excluded from the adjusted totals.');
    await optional('breakdown', 'Hover for the category breakdown', 'Hover over the adjusted count to see how the changed files are divided between the visible files and hidden categories.', async () => {
      await move('.geld-provider-header-stats,.geld-provider-header-hidden-count');
      await poll(() => page.$('.geld-provider-hover'), Boolean, 'Visible count breakdown', 8000);
    });
    await page.mouse.move(8, 8);
    await scene('tests', 'Open the Tests category', 'The Tests category reveals the test files that were folded away. They keep their original code, file headers, and review controls.', async () => {
      await move('.geld-provider-category-header', 'Tests', true);
      await poll(() => page.evaluate(() => [...document.querySelectorAll('.geld-provider-category-header')].some(n => n.textContent.trim().startsWith('Tests') && n.getAttribute('aria-expanded') === 'true')), Boolean, 'Expanded Tests category', 8000);
    });
    await optional('essential', 'Return to essential files', 'Switch back to Essential to focus on the main change. The category controls let you move between these groups without leaving the review.', async () => move('.geld-provider-category-header', 'Essential', true));
    await scene('restore', 'Restore the full native diff', 'Turn Geld off to restore the original full diff and counts. Turn it back on to return to the same categorised review.', async () => {
      await patchSettings({ enabled: false });await pause(2200);await patchSettings({ enabled: true });await pause(1500);
    });
    await page.goto(optionsUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(() => document.getElementById('provider-access')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await scene('settings', 'One set of Geld settings', 'Geld uses the same preferences across supported sites. Provider access is enabled here, while categories and review preferences stay shared.');
    await scene('finish', 'Walkthrough summary', 'That is the core review flow: adjusted counts, file categories, a conversation digest, and shared settings. This walkthrough used public pages without signing in.');
  } finally {
    await recorder?.stop();
    item.walkthrough = { file, scenes, omitted, origin, complete: scenes.some(s => s.id === 'finish') };
    await writeFile(resolve(artifacts, `${provider}-walkthrough.json`), JSON.stringify(item.walkthrough, null, 2));
  }
  return { verified: 'Recorded actual installed public-page interactions with timed scene receipts', walkthrough: item.walkthrough };
}
