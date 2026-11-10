import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export const EXPANDED_DIGEST_MR = 'https://gitlab.com/gitlab-org/quality/triage-ops/-/merge_requests/4544';

export async function verifyExpandedGitLabDigest(page, item, { poll, patchSettings, artifacts }) {
  await patchSettings({ enabled: true, prOverview: true, compactTimeline: 'compact', digestAboveDescription: false, aiEnabled: false, repoConfigs: 'never' });
  await page.goto(EXPANDED_DIGEST_MR, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await poll(() => page.$('[data-geld-automated-reviewer="21826781"]'), Boolean, 'GitLab Duo nested review', 60000);
  await poll(() => page.$('[data-geld-review-key="requirements"]'), Boolean, 'Native merge requirements in digest', 30000);
  await page.$$eval('.geld-provider-review [data-geld-review-toggle]', buttons => {
    for (const button of buttons) if (button.getAttribute('aria-expanded') === 'false') button.click();
  });
  const expanded = await page.evaluate(() => {
    const panel = document.querySelector('.geld-provider-review');
    const sources = [...panel.querySelectorAll('[data-geld-source]')].map(source => source.getAttribute('data-geld-source'));
    const represented = [...document.querySelectorAll('.issuable-discussion [id^="note_"]')].filter(note => !note.closest('[data-geld-ui]') && (sources.includes(note.id) || panel.querySelector(`[data-geld-event="${note.id.slice(5)}"]`)));
    return {
      humanReviews: panel.querySelector('[data-geld-review-key="reviewers"]')?.textContent,
      duo: panel.querySelector('[data-geld-automated-reviewer="21826781"]')?.textContent,
      checks: panel.querySelector('[data-geld-review-key="requirements"]')?.textContent,
      commentRows: panel.querySelectorAll('[data-geld-comment-row]').length,
      body: panel.querySelector('[data-geld-source="note_4200027701"] .geld-provider-review__body')?.textContent,
      itemTitle: panel.querySelector('[data-geld-automated-reviewer="1786152"] .geld-provider-review__item-title')?.textContent,
      represented: represented.map(note => ({ id: note.id, folded: !!note.closest('[data-geld-provider-native-find="folded"][hidden="until-found"]') })),
      activityGroups: [...panel.querySelectorAll('[data-geld-review-key^="activity:"]')].map(row => row.getAttribute('data-geld-review-key')),
      rawHtml: [...panel.querySelectorAll('.geld-provider-review__event .geld-provider-review__body')].some(body => /<\/?(?:a|p|span|div)\b/i.test(body.textContent)),
    };
  });
  assert.match(expanded.duo ?? '', /Approved/);
  assert.doesNotMatch(expanded.humanReviews ?? '', /GitLabDuo|GitLab Duo/);
  assert.match(expanded.checks ?? '', /Open threads must be resolved/);
  assert.match(expanded.checks ?? '', /All required approvals must be given/);
  assert.ok(expanded.commentRows >= 3, 'Each represented comment has a nested disclosure');
  assert.match(expanded.body ?? '', /👋/);
  assert.doesNotMatch(expanded.itemTitle ?? '', /:wave:/);
  assert.ok(expanded.represented.length >= 3);
  assert.ok(expanded.represented.every(note => note.folded), 'Digest mode folds every represented native entry');
  assert.ok(expanded.activityGroups.length > 1, 'Native activity is separated by type');
  assert.equal(expanded.rawHtml, false, 'System activity uses rendered native markup');
  await page.$eval('.geld-provider-review', panel => panel.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: resolve(artifacts, 'gitlab-expanded-digest.png'), fullPage: true });
  // An explicit Digest choice must override a previous request to reveal originals.
  await page.evaluate(() => { location.hash = 'note_4200027701'; });
  await poll(() => page.$eval('#note_4200027701', note => note.closest('[data-geld-provider-native-find="folded"]') === null), Boolean, 'Original thread restored through its native link', 15000);
  await page.$eval('[data-geld-digest-view="digest"]', button => button.click());
  await poll(() => page.$eval('#note_4200027701', note => note.closest('[data-geld-provider-native-find="folded"]') !== null), Boolean, 'Digest choice folds the revealed thread again', 15000);
  const description = await page.evaluate(() => {
    const heading = document.querySelector('[data-geld-provider-description-heading]');
    if (!heading) return null;
    const toggle = heading.querySelector('.geld-provider-description-section');
    const before = toggle.getAttribute('aria-expanded');
    heading.click();
    return { toggled: toggle.getAttribute('aria-expanded') !== before, capped: !!heading.closest('[data-geld-provider-description-capped]'), rails: document.querySelectorAll('[data-geld-provider-description-depth]').length };
  });
  assert.ok(description?.toggled, 'Clicking heading text toggles its section');
  assert.equal(description.capped, false);
  assert.ok(description.rails > 0);
  const menu = await page.evaluate(() => {
    const panel = document.querySelector('.geld-provider-review');
    const position = panel.querySelector('[data-geld-digest-position]');
    const view = panel.querySelector('[data-geld-digest-view="digest"]');
    return { isolation: getComputedStyle(panel).isolation, positionRadius: getComputedStyle(position).borderRadius, viewRadius: getComputedStyle(view).borderRadius, emptyStatus: getComputedStyle(panel.querySelector('.geld-provider-view__status')).display };
  });
  assert.equal(menu.isolation, 'isolate');assert.equal(menu.positionRadius, menu.viewRadius);assert.equal(menu.emptyStatus, 'none');
  item.expandedDigest = { expanded, description, menu };
  return { verified: 'Expanded GitLab digest, bot classification, merge blockers, native timeline restore/refold and description interactions', expandedDigest: item.expandedDigest };
}
