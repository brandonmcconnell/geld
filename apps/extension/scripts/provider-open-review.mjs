import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export const OPEN_REVIEW_SOURCES = {
  gitlab: ['gitlab-org/quality/triage-ops', 'gitlab-org/gitlab'].map(repository => ({ repository, url: `https://gitlab.com/api/v4/projects/${encodeURIComponent(repository)}/merge_requests?state=opened&per_page=5` })),
  bitbucket: ['blaze-lib/blaze', 'fenics-project/dolfin', 'multicoreware/x265_git', 'atlassian/bitbucket-upload-file'].map(repository => ({ repository, url: `https://api.bitbucket.org/2.0/repositories/${repository}/pullrequests?state=OPEN&pagelen=5` })),
};

export async function verifyOpenProviderReview(page, item, { provider, poll, patchSettings, artifacts }) {
  let request, repository;
  item.openDiscovery = [];
  for (const [index, source] of OPEN_REVIEW_SOURCES[provider].entries()) {
    if (index > 0) {
      const response = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (response?.status() === 404) { item.openDiscovery.push({ repository: source.repository, status: 404 });continue; }
      assert.equal(response?.status(), 200, 'Public request discovery succeeds');
    }
    const listing = await page.evaluate(() => JSON.parse(document.body.innerText));
    const candidates = provider === 'gitlab' ? listing : listing.values;
    assert.ok(Array.isArray(candidates), 'Native API returned a request list');
    item.openDiscovery.push({ repository: source.repository, candidates: candidates.length });
    request = candidates.find(candidate => candidate.state === (provider === 'gitlab' ? 'opened' : 'OPEN'));
    if (request) { repository = source.repository;break; }
  }
  assert.ok(request, 'The public repository has an open request');
  const href = provider === 'gitlab' ? request.web_url : request.links?.html?.href;
  const url = new URL(href);
  assert.equal(url.origin, provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org');
  const id = provider === 'gitlab' ? request.iid : request.id;
  assert.ok(Number.isSafeInteger(id) && id > 0);
  assert.equal(url.pathname.replace(/\/$/, ''), provider === 'gitlab' ? `/${repository}/-/merge_requests/${id}` : `/${repository}/pull-requests/${id}`);
  await patchSettings({ enabled: true, prOverview: true, quickReview: true, compactTimeline: 'compact', digestAboveDescription: false, aiEnabled: false, repoConfigs: 'never' });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await poll(() => page.$('.geld-provider-review__header'), Boolean, 'Open request digest', 45000);
  const state = await page.evaluate(provider => {
    const native = provider === 'gitlab'
      ? document.querySelector('.merge-request-sticky-header .detail-page-description .gl-badge[aria-label]')
      : document.querySelector('[data-testid="pr-header"] [data-qa="pr-branches-and-state-styles"]');
    const authenticated = provider === 'gitlab'
      ? !!document.querySelector('meta[name="current-user-id"][content]:not([content=""])')
      : JSON.parse(document.querySelector('meta#bb-bootstrap')?.getAttribute('data-current-user') || '{}').isAuthenticated === true;
    return {
      nativeStatus: native?.getAttribute('aria-label') || native?.textContent?.trim(), authenticated,
      actions: [...document.querySelectorAll('[data-geld-review-action]')].map(button => button.getAttribute('aria-label')),
      ownedStatus: document.querySelector('.geld-provider-status')?.getAttribute('aria-label') ?? null,
      digestState: document.querySelector('.geld-provider-review')?.getAttribute('data-state'),
      hiddenRequestWarning: document.querySelector('.geld-provider-review')?.textContent.includes('Request state unavailable'),
    };
  }, provider);
  assert.match(state.nativeStatus ?? '', /open|draft/i, 'The rendered native request is still open');
  assert.equal(state.authenticated, false, 'Public acceptance uses an anonymous browser');
  assert.deepEqual(state.actions, [], 'Anonymous visitors receive no invented review authority');
  assert.equal(state.ownedStatus, null, 'Anonymous native status is preserved');
  assert.equal(state.hiddenRequestWarning, false);
  await page.$eval('.geld-provider-review__header', element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const png = await page.screenshot({ path: resolve(artifacts, `${provider}-ui-open-review.png`), encoding: 'base64' });
  console.log(`PROVIDER_UI_IMAGE ${JSON.stringify({ provider, name: 'open-review', png })}`);
  item.openReview = { url: url.href, nativeId: provider === 'gitlab' ? request.iid : request.id, ...state, writesTested: false };
  console.log(`PROVIDER_OPEN_REVIEW ${JSON.stringify({ provider, ...item.openReview })}`);
  return { verified: 'Public open request digest and anonymous review/status permission gating', openReview: item.openReview };
}
