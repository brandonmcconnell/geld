import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

export const BITBUCKET_LOCAL_REVIEW = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
const KEY = 'bitbucket@https://bitbucket.org:atlassian%2Fbitbucket-upload-file!22';
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const REF = /^[a-f0-9]{7,64}$/i;
const SETTINGS = { enabled: true, prOverview: true, compactTimeline: 'off', reviewGrouping: 'type', collapseDescription: false, repoConfigs: 'never', aiEnabled: false };

function resource(value) {
  let url;try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || url.hash) return null;
  if (url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/')) {
    url.hostname = 'api.bitbucket.org';url.pathname = url.pathname.slice('/!api'.length);
  }
  if (url.origin !== 'https://api.bitbucket.org') return null;
  if (url.pathname === '/2.0/repositories/atlassian/bitbucket-upload-file/pullrequests/22' && url.search === '') return { kind: 'review' };
  const commit = /^\/2\.0\/repositories\/atlassian\/bitbucket-upload-file\/commit\/([a-f0-9]{7,64})$/i.exec(url.pathname);
  return commit !== null && [...url.searchParams.keys()].every((key) => key === 'fields') ? { kind: 'commit', ref: commit[1].toLowerCase() } : null;
}

export function createLocalReviewOracle() {
  let generation = 0;let reviews = [];let commits = new Map();let invalid = false;
  return {
    generation: () => generation,
    reset() { generation++;reviews = [];commits = new Map();invalid = false; },
    observe(url, value, epoch = generation) {
      if (epoch !== generation) return;
      const source = resource(url);if (source === null) return;
      if (source.kind === 'commit') {
        if (typeof value?.hash !== 'string' || !SHA.test(value.hash) || !value.hash.toLowerCase().startsWith(source.ref)
          || value.repository !== undefined && value.repository?.full_name !== 'atlassian/bitbucket-upload-file') { invalid = true;return; }
        const prior = commits.get(source.ref);if (prior !== undefined && prior !== value.hash.toLowerCase()) invalid = true;
        commits.set(source.ref, value.hash.toLowerCase());return;
      }
      const ref = value?.source?.commit?.hash;
      if (value?.id !== 22 || typeof ref !== 'string' || !REF.test(ref) || !['MERGED', 'OPEN', 'DECLINED', 'SUPERSEDED'].includes(value.state)
        || value.source.repository?.full_name !== 'atlassian/bitbucket-upload-file' || value.destination?.repository?.full_name !== 'atlassian/bitbucket-upload-file'
        || reviews.length >= 32) { invalid = true;return; }
      reviews.push({ ref: ref.toLowerCase(), state: value.state });
    },
    snapshot() {
      const heads = reviews.map(({ ref }) => SHA.test(ref) ? ref : commits.get(ref));
      const head = heads[0];
      return invalid || reviews.length < 2 || head === undefined || heads.some((candidate) => candidate !== head)
        || reviews.some((review) => review.state !== reviews[0].state)
        ? { status: 'unavailable', observations: reviews.length }
        : { status: 'ready', headSha: head, state: reviews[0].state, observations: reviews.length, basis: 'Already-issued review and commit-resolution responses in this document visit' };
    },
  };
}

export function localReviewWrite(value, method) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  let url;try { url = new URL(value); } catch { return false; }
  return url.origin === 'https://api.bitbucket.org' && url.pathname.startsWith('/2.0/')
    || url.origin === 'https://bitbucket.org' && (url.pathname.startsWith('/!api/2.0/')
      || /^\/atlassian\/bitbucket-upload-file\/pull-requests\/22\/(?:comments|tasks|approve|request-changes|merge|decline)(?:\/|$)/.test(url.pathname));
}

export function observeLocalReview(page, progress, abort) {
  const oracle = createLocalReviewOracle();const pending = new Set();const generations = new WeakMap();let disposed = false;
  Object.assign(progress, { providerWrites: 0, responseReadFailures: 0 });
  const request = (value) => {
    generations.set(value, oracle.generation());
    if (!localReviewWrite(value.url(), value.method())) return;
    progress.providerWrites++;
    if (!abort.signal.aborted) abort.abort(new Error('Local review attempted a provider write'));
    void page.close().catch(() => undefined);
  };
  const response = (value) => {
    if (disposed || resource(value.url()) === null || value.request().method() !== 'GET' || value.status() !== 200) return;
    const epoch = generations.get(value.request());if (epoch === undefined || epoch !== oracle.generation()) return;
    const task = (async () => {
      try { const body = await value.text();if (body.length > 1024 * 1024) throw new Error('Response exceeds bound');oracle.observe(value.url(), JSON.parse(body), epoch); }
      catch { progress.responseReadFailures++; }
    })();
    pending.add(task);void task.finally(() => pending.delete(task));
  };
  page.on('request', request);page.on('response', response);
  return { oracle, async flush() { await Promise.all([...pending]); }, async dispose() { disposed = true;page.off('request', request);page.off('response', response);await Promise.all([...pending]); } };
}

export function localReviewStorageScope({ read, write, progress }) {
  let original;
  return {
    async prepare() {
      original = structuredClone(await read());
      assert.equal(original.synchronizedMarks.present, false, 'Device-local marks must not exist in sync storage');
      const value = { ...original, settings: { present: true, value: { ...(original.settings.present ? original.settings.value : {}), ...SETTINGS } }, marks: { present: false } };
      await write(value);assert.ok(isDeepStrictEqual(await read(), value), 'Local review settings preparation differs');
      progress.prepared = true;
    },
    async restore(closed) {
      if (original === undefined) return;
      assert.equal(closed, true, 'Close the Bitbucket page before restoring raw local review storage');
      await write(original);assert.ok(isDeepStrictEqual(await read(), original), 'Raw local review storage restoration differs');
      progress.restored = true;progress.pageClosedBeforeRestore = true;
    },
  };
}

export function localReviewRecord(storage, itemId, head) {
  assert.equal(storage.synchronizedMarks.present, false, 'Local reviewed state leaked to sync storage');
  const entries = storage.marks.present ? storage.marks.value : {};
  assert.ok(entries !== null && typeof entries === 'object' && !Array.isArray(entries), 'Invalid local storage container');
  for (const [key, record] of Object.entries(entries)) {
    assert.ok(record !== null && typeof record === 'object' && !Array.isArray(record)
      && isDeepStrictEqual(Object.keys(record).sort(), ['headSha', 'items', 'reviewKey', 'updatedAt']), 'Invalid local review record shape');
    assert.ok(typeof record.reviewKey === 'string' && key === JSON.stringify([record.reviewKey, record.headSha])
      && typeof record.headSha === 'string' && SHA.test(record.headSha), 'Invalid local review record identity');
    assert.ok(Number.isFinite(record.updatedAt) && record.updatedAt > 0, 'Invalid local review timestamp');
    assert.ok(record.items !== null && typeof record.items === 'object' && !Array.isArray(record.items), 'Invalid local review items');
    for (const [id, fingerprint] of Object.entries(record.items)) {
      assert.ok(/^[a-zA-Z0-9_-]{1,180}$/.test(id) && typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint), 'Invalid local review fingerprint');
    }
  }
  const expected = JSON.stringify([KEY, head]);
  assert.ok(Object.keys(entries).length === 0 || Object.keys(entries).length === 1 && Object.hasOwn(entries, expected)
    && isDeepStrictEqual(Object.keys(entries[expected].items), [itemId]), 'Unexpected local review storage write');
  return entries[expected]?.items[itemId] ?? null;
}

// Runs inside the page, keeping original native identities in memory without modifying them.
export function localReviewProbe(operation = 'read') {
  const key = '__geldLocalReviewAcceptance';
  if (operation === 'dispose') { const saved = globalThis[key];if (saved !== undefined) document.removeEventListener('click', saved.listener, true);delete globalThis[key];return null; }
  if (location.href !== 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22') return null;
  const natives = document.querySelectorAll('#comment-471253038[data-testid="comment"]');
  const native = natives.length === 1 ? natives[0] : null;
  const body = native?.querySelector('[data-testid="comment-content"] .ak-renderer-document');
  const link = native?.querySelector('[data-testid="comment-header"] a[href]');
  const activity = native?.closest('[data-qa="pull-request-overview-activity-content"]');
  const header = activity?.querySelector('[data-qa="bk-file__header"][data-testid="file-header"]');
  const bootstraps = document.head.querySelectorAll('meta#bb-bootstrap[data-current-user]');
  const bootstrap = bootstraps.length === 1 ? bootstraps[0] : null;
  let anonymous = false;try { anonymous = JSON.parse(bootstrap?.getAttribute('data-current-user') ?? 'null')?.isAuthenticated === false; } catch { /* No anonymous evidence. */ }
  const panel = document.querySelector('.geld-provider-review');
  const sources = panel?.querySelectorAll('[data-geld-source="comment-471253038"]') ?? [];
  const source = sources.length === 1 ? sources[0] : null;
  const item = source?.closest('[data-geld-item]');
  const buttons = item?.querySelectorAll('[data-geld-local-reviewed]') ?? [];
  const button = buttons.length === 1 ? buttons[0] : null;
  if (!anonymous || native === null || body == null || link == null || header == null || native.closest('[data-geld-ui]') !== null
    || !['ready', 'partial'].includes(panel?.getAttribute('data-state')) || source === null || item == null || button?.tagName !== 'BUTTON'
    || button.getAttribute('data-geld-local-reviewed') !== item.getAttribute('data-geld-item')) return null;
  const destination = new URL(link.href);
  if (destination.origin !== 'https://bitbucket.org' || !/^\/atlassian\/bitbucket-upload-file\/pull-requests\/22(?:\/(?:_\/)?diff)?$/.test(destination.pathname)
    || destination.hash !== '#comment-471253038' || destination.username || destination.password || destination.search) return null;
  const nativeState = {
    id: native.id, text: body.textContent.trim(), link: link.href,
    path: header.querySelector('[data-qa="bk-filepath"]')?.textContent ?? null,
    outdated: [...header.querySelectorAll('span')].some((node) => node.children.length === 0 && node.textContent.trim() === 'Outdated'),
  };
  if (operation === 'install') {
    if (globalThis[key] !== undefined) throw new Error('Duplicate local review lease');
    const saved = { native, parent: native.parentElement, body, link, header, bootstrap, bootstrapValue: bootstrap.getAttribute('data-current-user'), nativeState: JSON.stringify(nativeState), trustedClicks: 0, untrustedClicks: 0 };
    saved.listener = (event) => {
      const target = event.target?.closest?.('[data-geld-local-reviewed]');
      if (target === null || target === undefined || target.closest('[data-geld-item]')?.querySelector('[data-geld-source="comment-471253038"]') == null) return;
      if (event.isTrusted) saved.trustedClicks++;else saved.untrustedClicks++;
    };
    document.addEventListener('click', saved.listener, true);globalThis[key] = saved;
  }
  const saved = globalThis[key];
  const state = {
    native: nativeState, nativeUnchanged: saved !== undefined && saved.native === native && saved.parent === native.parentElement
      && saved.body === body && saved.link === link && saved.header === header && saved.bootstrap === bootstrap
      && saved.bootstrapValue === bootstrap.getAttribute('data-current-user') && saved.nativeState === JSON.stringify(nativeState),
    itemId: item.getAttribute('data-geld-item'), pressed: button.getAttribute('aria-pressed'), disabled: button.disabled,
    state: item.getAttribute('data-state'), group: item.closest('[data-geld-review-group]')?.getAttribute('data-geld-review-group'),
    notice: item.querySelector('[data-geld-local-review-notice]')?.textContent ?? null,
    body: source.querySelector('.geld-provider-review__body .ak-renderer-document')?.textContent.trim() ?? null,
    links: [...source.querySelectorAll('.geld-provider-review__byline > a[href]')].map((node) => node.href),
    checks: [...panel.querySelectorAll('.geld-provider-review__check')].map((node) => [node.getAttribute('data-state'), node.textContent]),
    bots: [...panel.querySelectorAll('[data-geld-review-bot]')].map((node) => [node.getAttribute('data-geld-review-bot'), node.getAttribute('data-state'), node.textContent]),
    quickActions: document.querySelectorAll('.geld-provider-actions button').length, aiControls: panel.querySelectorAll('[data-geld-ai-run]').length,
    trustedClicks: saved?.trustedClicks ?? 0, untrustedClicks: saved?.untrustedClicks ?? 0,
  };
  return state;
}

export async function verifyBitbucketLocalReview(page, item, { observer, readStorage, poll, openReviewAncestors, budget }) {
  const proof = { status: 'pending', scope: 'Local review persistence for one actual anonymous native outdated comment, not provider resolution or authenticated review submission' };
  item.localReviewed = proof;
  const read = () => page.evaluate(localReviewProbe);
  const ready = (value) => value !== null && value.itemId !== null && /^[a-zA-Z0-9_-]{1,180}$/.test(value.itemId) && !value.disabled && value.native.outdated && value.state === 'outdated';
  await poll(read, ready, 'Actual Bitbucket inline item and local review control', 15000);
  const original = await page.evaluate(localReviewProbe, 'install');assert.ok(ready(original));proof.original = original;
  assert.equal(original.nativeUnchanged, true);assert.equal(original.pressed, 'false');assert.equal(original.notice, null);
  assert.match(original.native.text, /Internal maintenance: Update tests to access token auth\./);
  assert.equal(original.native.path, '.changes/next-release/patch-20240213112019723332.json');
  assert.equal(original.body, original.native.text);assert.equal(new URL(original.native.link).hash, '#comment-471253038');
  assert.ok(original.links.includes(`${BITBUCKET_LOCAL_REVIEW}/_/diff#comment-471253038`));
  assert.equal(original.quickActions, 0);assert.equal(original.aiControls, 0);
  const identity = await poll(() => observer.oracle.snapshot(), (value) => value.status === 'ready', 'Already-issued immutable Bitbucket review identity', 8000);
  proof.identity = identity;
  assert.equal(localReviewRecord(await readStorage(), original.itemId, identity.headSha), null);
  const selector = `.geld-provider-review [data-geld-local-reviewed="${original.itemId}"]`;
  const unchanged = (value) => {
    assert.ok(value !== null);assert.equal(value.nativeUnchanged, true);assert.deepEqual(value.native, original.native);
    assert.equal(value.itemId, original.itemId);assert.equal(value.body, original.body);assert.deepEqual(value.links, original.links);
    assert.deepEqual(value.checks, original.checks);assert.deepEqual(value.bots, original.bots);assert.equal(value.quickActions, 0);assert.equal(value.aiControls, 0);
    assert.equal(value.state, 'outdated');assert.equal(value.group, original.group);assert.equal(value.untrustedClicks, 0);
  };
  await openReviewAncestors(page, selector);await page.click(selector);
  proof.marked = await poll(read, (value) => value?.pressed === 'true' && !value.disabled && value.notice === 'Reviewed on this device. Native status: Outdated.', 'Local review mark is visible', 8000);
  unchanged(proof.marked);assert.equal(proof.marked.trustedClicks, 1);
  const fingerprint = localReviewRecord(await readStorage(), original.itemId, identity.headSha);assert.match(fingerprint, /^[a-f0-9]{64}$/);proof.fingerprint = fingerprint;
  await observer.flush();assert.equal(item.localReviewTraffic.providerWrites, 0);assert.ok(budget().available, 'Insufficient remaining Bitbucket budget for reload');
  await page.evaluate(localReviewProbe, 'dispose');observer.oracle.reset();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await poll(read, (value) => ready(value) && value.pressed === 'true', 'Local review mark survives a real document reload', 15000);
  proof.reloaded = await page.evaluate(localReviewProbe, 'install');unchanged(proof.reloaded);
  assert.equal(proof.reloaded.notice, 'Reviewed on this device. Native status: Outdated.');
  const afterIdentity = await poll(() => observer.oracle.snapshot(), (value) => value.status === 'ready', 'Reloaded Bitbucket review identity', 8000);
  assert.equal(afterIdentity.headSha, identity.headSha);assert.equal(afterIdentity.state, identity.state);proof.reloadedIdentity = afterIdentity;
  assert.equal(localReviewRecord(await readStorage(), original.itemId, identity.headSha), fingerprint);
  await openReviewAncestors(page, selector);await page.click(selector);
  proof.undone = await poll(read, (value) => value?.pressed === 'false' && !value.disabled && value.notice === null, 'Undo clears only the local review mark', 8000);
  unchanged(proof.undone);assert.equal(proof.undone.trustedClicks, 1);
  assert.equal(localReviewRecord(await readStorage(), original.itemId, identity.headSha), null);
  await observer.flush();assert.equal(item.localReviewTraffic.providerWrites, 0);
  proof.nativeFingerprint = createHash('sha256').update(JSON.stringify(original.native)).digest('hex');proof.status = 'passed';
  await page.evaluate(localReviewProbe, 'dispose');
  return { status: 'passed', verified: 'Real Bitbucket local mark survives reload and Undo, preserving native outdated status/source and local-only fingerprint storage. No provider write or helper fetch.' };
}
