import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export const EXPANDED_DIGEST_MR = 'https://gitlab.com/gitlab-org/quality/triage-ops/-/merge_requests/4544';

export async function verifyExpandedGitLabDigest(page, item, { poll, patchSettings, artifacts }) {
  await patchSettings({ enabled: true, prOverview: true, compactTimeline: 'compact', digestAboveDescription: false, aiEnabled: false, repoConfigs: 'never' });
  await page.goto(EXPANDED_DIGEST_MR, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await poll(() => page.$('[data-geld-automated-reviewer="21826781"]'), Boolean, 'GitLab Duo review row', 60000);
  await poll(() => page.$('[data-geld-merge-checks]'), Boolean, 'Native merge requirements in digest', 30000);
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
      checks: panel.querySelector('[data-geld-merge-checks]')?.textContent,
      nativeChecks: [...document.querySelectorAll('#widget-state [data-testid="merge-checks-full"] [data-testid="merge-check"]')].map(row => row.querySelector('.gl-w-full.gl-min-w-0')?.textContent.trim()).filter(Boolean),
      commentRows: panel.querySelectorAll('[data-geld-comment-row]').length,
      body: panel.querySelector('[data-geld-source="note_4200027701"] .geld-provider-review__body')?.textContent,
      itemTitle: [...panel.querySelectorAll('[data-geld-round-group] .geld-provider-review__item-title')].map(title => title.textContent).join('\n'),
      rounds: [...panel.querySelectorAll('[data-geld-round-group] > [data-geld-review-toggle]')].map(toggle => toggle.textContent.trim()),
      represented: represented.map(note => ({ id: note.id, folded: !!note.closest('[data-geld-provider-native-find="folded"][hidden="until-found"]') })),
      activityGroups: [...panel.querySelectorAll('[data-geld-review-key^="activity:"]')].map(row => row.getAttribute('data-geld-review-key')),
      rawHtml: [...panel.querySelectorAll('.geld-provider-review__event .geld-provider-review__body')].some(body => /<\/?(?:a|p|span|div)\b/i.test(body.textContent)),
    };
  });
  item.expandedDigest = { expanded };
  console.log(`EXPANDED_DIGEST_STATE ${JSON.stringify(expanded)}`);
  await page.$eval('.geld-provider-review', panel => panel.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const png = await page.screenshot({ path: resolve(artifacts, 'gitlab-expanded-digest.png'), fullPage: true, encoding: 'base64' });
  console.log(`PROVIDER_UI_IMAGE ${JSON.stringify({ provider: 'gitlab', name: 'expanded-digest', png })}`);
  assert.match(expanded.duo ?? '', /Approved/);
  assert.doesNotMatch(expanded.humanReviews ?? '', /GitLabDuo|GitLab Duo/);
  assert.ok(expanded.nativeChecks.length > 0, 'The native widget supplies current merge requirements');
  for (const label of expanded.nativeChecks) assert.ok(expanded.checks?.includes(label), `The digest represents the current native requirement: ${label}`);
  assert.ok(expanded.commentRows >= 3, 'Each represented comment has a nested disclosure');
  assert.match(expanded.body ?? '', /👋/);
  assert.doesNotMatch(expanded.itemTitle ?? '', /:wave:/);
  assert.ok(expanded.rounds.length > 0, 'Threads and comments are grouped into rounds');
  assert.ok(expanded.represented.length >= 3);
  assert.ok(expanded.represented.every(note => note.folded), 'Digest mode folds every represented native entry');
  assert.ok(expanded.activityGroups.length > 1, 'Native activity is separated by type');
  assert.equal(expanded.rawHtml, false, 'System activity uses rendered native markup');
  // An explicit Digest choice must override a previous request to reveal originals.
  await page.evaluate(() => { location.hash = 'note_4200027701'; });
  await poll(() => page.$eval('#note_4200027701', note => note.closest('[data-geld-provider-native-find="folded"]') === null), Boolean, 'Original thread restored through its native link', 15000);
  await page.click('[data-geld-toolbar-control="eye"]');
  await page.click('[data-geld-digest-view="digest"]');
  await poll(() => page.$eval('#note_4200027701', note => note.closest('[data-geld-provider-native-find="folded"]') !== null), Boolean, 'Digest choice folds the revealed thread again', 15000);
  const description = await page.evaluate(() => {
    const heading = document.querySelector('[data-geld-provider-description-heading]');
    if (!heading) return null;
    const toggle = heading.querySelector('.geld-provider-description-section');
    const before = toggle.getAttribute('aria-expanded');
    heading.click();
    const toggled = toggle.getAttribute('aria-expanded') !== before;
    if (toggle.getAttribute('aria-expanded') === 'false') heading.click();
    return { toggled, capped: !!heading.closest('[data-geld-provider-description-capped]'), rails: document.querySelectorAll('[data-geld-provider-description-depth]').length };
  });
  console.log(`EXPANDED_DESCRIPTION_STATE ${JSON.stringify(description)}`);
  assert.ok(description?.toggled, 'Clicking heading text toggles its section');
  assert.equal(description.capped, false);
  assert.ok(description.rails > 0);
  const menu = await page.evaluate(() => {
    const panel = document.querySelector('.geld-provider-review');
    const position = panel.querySelector('[data-geld-digest-position]');
    const view = panel.querySelector('[data-geld-digest-view="digest"]');
    return { isolation: getComputedStyle(panel).isolation, positionRadius: getComputedStyle(position).borderRadius, viewRadius: getComputedStyle(view).borderRadius, emptyStatus: getComputedStyle(panel.querySelector('.geld-provider-view__status')).display };
  });
  console.log(`EXPANDED_MENU_STATE ${JSON.stringify(menu)}`);
  assert.equal(menu.isolation, 'isolate');assert.equal(menu.positionRadius, menu.viewRadius);assert.equal(menu.emptyStatus, 'none');
  item.expandedDigest = { expanded, description, menu };
  return { verified: 'Expanded GitLab digest, bot classification, merge blockers, native timeline restore/refold and description interactions', expandedDigest: item.expandedDigest };
}
