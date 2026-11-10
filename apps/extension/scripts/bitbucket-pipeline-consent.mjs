import assert from 'node:assert/strict';
import { assertBitbucketPipelineURL } from './bitbucket-pipeline-visit.mjs';
import { bitbucketSyntaxSettingsProbe } from './bitbucket-syntax-settings.mjs';

/** Exact public PR240 native banner contract, not a generic consent/modal handler. */
export function bitbucketPipelineConsentProbe(action = 'read') {
  const KEY = '__geldBitbucketPipelineConsent';const store = globalThis[KEY];
  if (action === 'cleanup') { store?.cleanup();delete globalThis[KEY];return null; }
  if (action === 'click-result') return store?.event ?? null;
  const url = new URL(location.href);
  if (url.origin !== 'https://bitbucket.org' || url.pathname !== '/atlassian/bitbucket-upload-file/pull-requests/27/diff' || url.search !== '' || url.username || url.password) return { status: 'unavailable', reason: 'Different native review route' };
  const excluded = '[data-geld-ui], form, .ak-renderer-document, [data-qa="comment-content"], [data-testid="comment-content"], [data-testid="expanded-CommitCard"]';
  const visible = (node) => {
    if (!node?.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let parent = node; parent !== null; parent = parent.parentElement) { const style = getComputedStyle(parent);if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden') return false; }
    const rect = node.getBoundingClientRect();return rect.width > 0 && rect.height > 0;
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
  if (dialogs.length === 0) return { status: 'not_present', url: location.href };
  const selector = '#unsafe-design-system-page-layout-root > [data-layout-slot="true"] [role="dialog"][aria-labelledby="cookiesTrackingNoticeLink"]';
  const layouts = [...document.querySelectorAll('#unsafe-design-system-page-layout-root')];
  const matches = [...document.querySelectorAll(selector)].filter((node) => node.closest(excluded) === null && visible(node));
  if (layouts.length !== 1 || dialogs.length !== 1 || matches.length !== 1 || matches[0] !== dialogs[0]) return { status: 'unavailable', reason: 'Changed or ambiguous native dialog', dialogCount: dialogs.length };
  let anonymous = false;
  const bootstrap = [...document.head.querySelectorAll('meta#bb-bootstrap[data-current-user]')];
  if (bootstrap.length === 1) {
    const raw = bootstrap[0].getAttribute('data-current-user');
    if (raw.length <= 4096) try { anonymous = JSON.parse(raw)?.isAuthenticated === false; } catch { /* Unknown identity must not authorize an action. */ }
  }
  const dialog = matches[0];const slot = dialog.closest('[data-layout-slot="true"]');
  const buttons = [...dialog.querySelectorAll('button[data-testid="only-necessary-button"]')];
  const legal = [...dialog.querySelectorAll('a[href]')].filter((link) => link.getAttribute('href') === 'https://www.atlassian.com/legal/cookies');
  const button = buttons.length === 1 ? buttons[0] : null;
  const controlSelector = selector + ' button[data-testid="only-necessary-button"]';
  if (!anonymous || slot?.parentElement !== layouts[0] || legal.length === 0 || !button || button.textContent.trim() !== 'Only necessary' || button.type !== 'button' || button.closest(excluded) !== null || document.querySelectorAll(controlSelector).length !== 1
    || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.closest('fieldset[disabled]') !== null || !visible(button)) return { status: 'unavailable', reason: 'Native anonymous identity or exact enabled consent contract unavailable', anonymous };
  const rect = button.getBoundingClientRect();const x = rect.left + rect.width / 2;const y = rect.top + rect.height / 2;const hit = document.elementFromPoint(x, y);
  const unobscured = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && hit !== null && button.contains(hit);
  const same = store !== undefined && store.url === location.href && store.layout === layouts[0] && store.dialog === dialog && store.slot === slot && store.button === button && store.legal.length === legal.length && legal.every((node, i) => node === store.legal[i]);
  const result = { status: unobscured ? 'ready' : 'unavailable', ...(unobscured ? {} : { reason: 'Exact native consent control is covered or outside the viewport' }), url: location.href, anonymous, label: button.textContent.trim(), legalUrl: legal[0].href, selector: controlSelector, sameControl: same,
    bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, point: { x, y }, hit: hit === null ? null : { tag: hit.tagName, id: hit.id, testid: hit.getAttribute('data-testid'), owned: hit.closest('[data-geld-ui]') !== null } };
  if (action === 'arm') {
    if (!unobscured || store !== undefined) throw new Error('Exact native consent cannot be armed');
    const next = { url: location.href, layout: layouts[0], dialog, slot, button, legal, event: null };
    const listen = (event) => { if (event.target instanceof Element && button.contains(event.target)) next.event = { trusted: event.isTrusted, detail: event.detail, url: location.href, nativeButton: event.currentTarget === document && button.isConnected && dialog.contains(button), label: button.textContent.trim() }; };
    next.cleanup = () => document.removeEventListener('click', listen, true);document.addEventListener('click', listen, true);globalThis[KEY] = next;return { ...result, sameControl: true };
  }
  if (action === 'button') return same && unobscured ? button : null;
  return result;
}

/** Only the explicitly fresh anonymous focused visit may use the observed native action. */
export async function prepareBitbucketPipelineConsent(page, { progress, poll, guardBudget, flush, assertCurrent, readState, assertState, safeUrl, freshAnonymousProfile }) {
  progress.status = 'preparing';progress.trafficWindow = { startedAt: new Date().toISOString() };progress.traffic = [];progress.actions = [];progress.limitations = ['Only necessary operates native cookie consent only. No Diff Settings control is operated or hidden preference value established. Later native request costs remain unmeasured.'];
  const request = (value) => {
    if (!/^https?:\/\//.test(value.url())) return;
    if (progress.traffic.length >= 1000) { progress.trafficTruncated = true;return; }
    progress.traffic.push({ kind: 'request', url: safeUrl(value.url()).slice(0, 2048), method: value.method(), at: new Date().toISOString() });
  };
  const response = (value) => {
    if (!/^https?:\/\//.test(value.url())) return;
    if (progress.traffic.length >= 1000) { progress.trafficTruncated = true;return; }
    progress.traffic.push({ kind: 'response', url: safeUrl(value.url()).slice(0, 2048), status: value.status(), at: new Date().toISOString() });
  };
  const sourceProof = (value) => { assert.equal(value?.sameSource, true, 'Original native source, Text, line links or Viewed state changed during consent preparation');assert.ok(Number.isSafeInteger(value.sourceRows) && value.sourceRows > 0, 'Consent source identity needs nonempty native rows');assert.deepEqual(value.events, [], 'Native preference input or submission occurred during consent preparation');return { url: value.url, sameSource: value.sameSource, sourceRows: value.sourceRows, viewed: value.viewed, events: value.events }; };
  page.on('request', request);page.on('response', response);
  try {
    assert.equal(freshAnonymousProfile, true, 'Cookie preparation requires the explicitly fresh anonymous browser profile');
    await flush();progress.headBefore = assertCurrent();guardBudget();
    progress.before = await readState();progress.sourceBefore = sourceProof(await poll(() => page.evaluate(bitbucketSyntaxSettingsProbe, 'setup'), (value) => value !== null, 'Nonempty original native Pipeline rows before consent', 5000));
    progress.nativeBefore = await page.evaluate(bitbucketPipelineConsentProbe);
    if (progress.nativeBefore.status !== 'not_present') {
      assert.equal(progress.nativeBefore.status, 'ready', progress.nativeBefore.reason ?? 'Native consent unavailable');
      await flush();assertCurrent();guardBudget();
      progress.armed = await page.evaluate(bitbucketPipelineConsentProbe, 'arm');assert.equal(progress.armed.status, 'ready');
      const handle = await page.evaluateHandle(bitbucketPipelineConsentProbe, 'button');
      try {
        const button = handle.asElement();assert.ok(button !== null, 'Original native consent control disappeared');
        await flush();assertCurrent();sourceProof(await page.evaluate(bitbucketSyntaxSettingsProbe));
        const current = await page.evaluate(bitbucketPipelineConsentProbe);assert.equal(current.status, 'ready');assert.equal(current.sameControl, true, 'Native consent control identity changed before click');
        const budget = guardBudget();assertCurrent();await button.click();
        const event = await page.evaluate(bitbucketPipelineConsentProbe, 'click-result');
        progress.actions.push({ kind: 'only_necessary', budget, event });assert.equal(event?.trusted, true);assert.equal(event.detail, 1);assert.equal(event.nativeButton, true);assert.equal(event.label, 'Only necessary');assertBitbucketPipelineURL(event.url, progress.nativeBefore.url);
      } finally { await handle.dispose(); }
      progress.nativeAfter = await poll(() => page.evaluate(bitbucketPipelineConsentProbe), (value) => value?.status === 'not_present', 'Exact native cookie dialog dismissed after Only necessary', 5000);
    } else progress.nativeAfter = progress.nativeBefore;
    progress.after = await readState();await flush();progress.headAfter = assertCurrent();guardBudget();
    progress.sourceAfter = sourceProof(await page.evaluate(bitbucketSyntaxSettingsProbe));await flush();progress.headAfter = assertCurrent();assertState(progress.before, progress.after);
    assert.deepEqual(progress.sourceAfter, progress.sourceBefore);assert.equal(progress.trafficTruncated, undefined, 'Native consent HTTP evidence exceeded its fixed bound');
    progress.status = progress.actions.length === 0 ? 'not_present' : 'prepared';
    return progress;
  } catch (error) { progress.status = 'failed';progress.error = error instanceof Error ? error.message : String(error);throw error;
  } finally {
    page.off('request', request);page.off('response', response);progress.trafficWindow.endedAt = new Date().toISOString();
    const errors = [];
    if (!page.isClosed()) for (const probe of [bitbucketPipelineConsentProbe, bitbucketSyntaxSettingsProbe]) try { await page.evaluate(probe, 'cleanup'); } catch (error) { errors.push(error); }
    progress.listenersRemoved = true;
    if (errors.length > 0) { progress.status = 'failed';progress.cleanupErrors = errors.map((error) => error instanceof Error ? error.message : String(error));throw new AggregateError(errors, 'Native consent observation cleanup failed'); }
  }
}
