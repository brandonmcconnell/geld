import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const BITBUCKET_UI_PR = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
export const BITBUCKET_UI_PATH = 'test/test.py';
const REPOSITORY = 'atlassian/bitbucket-upload-file';

/** Read only the extension's complete-result cache, never request a new source. */
export async function bitbucketUiSourceCache() {
  const values = await chrome.storage.local.get(Array.from({ length: 64 }, (_, index) => `providerDiffCache:${index}`));
  return Object.values(values).filter(value => {
    try { return value?.schema === 2 && JSON.parse(value.key)[1] === 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22'; }
    catch { return false; }
  });
}

export function assertBitbucketUiSource(entries, state) {
  assert.equal(entries.length, 1, 'One complete cached PR22 source is required');
  const source = entries[0];
  const key = JSON.parse(source.key);
  assert.deepEqual(JSON.parse(key[0]), ['bitbucket', 'https://bitbucket.org', REPOSITORY]);
  assert.equal(key[1], BITBUCKET_UI_PR);
  const facts = source.sourceFacts;
  assert.equal(facts?.subject?.url, BITBUCKET_UI_PR);
  assert.deepEqual(facts.subject.repository, { provider: 'bitbucket', origin: 'https://bitbucket.org', path: REPOSITORY });
  assert.equal(facts.subject.version, key[2]);
  assert.equal(facts.subject.headSha, key[3]);
  assert.equal(facts?.comparison?.kind, 'bitbucket-review');
  assert.equal(facts.comparison.topic, true);
  assert.match(facts.comparison.headSha, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  assert.match(facts.comparison.baseSha, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  assert.equal(source.revision, `${facts.comparison.baseSha}..${facts.comparison.headSha}`);
  assert.ok(Array.isArray(source.files) && source.files.length >= 2);
  assert.equal(new Set(source.files.map(file => file.path)).size, source.files.length);
  assert.ok(source.files.some(file => file.path === BITBUCKET_UI_PATH), 'The observed source must contain test/test.py');
  const totals = source.files.reduce((sum, file) => {
    assert.equal(typeof file.path, 'string');
    for (const key of ['additions', 'deletions']) assert.ok(Number.isSafeInteger(file[key]) && file[key] >= 0);
    return { files: sum.files + 1, additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions };
  }, { files: 0, additions: 0, deletions: 0 });
  assert.equal(state.repository?.provider, 'bitbucket');
  assert.equal(state.repository?.origin, 'https://bitbucket.org');
  assert.equal(state.repository?.path, REPOSITORY);
  assert.equal(state.hasDiff, true);
  assert.deepEqual(state.all, totals, 'Rendered state must agree with the complete cached inventory');
  return source;
}

/** Install one document-bound lease for the actual visible Files tab and its trusted input. */
export function prepareBitbucketUiTransition() {
  const key = '__geldBitbucketUiContinuity';
  if (globalThis[key] !== undefined) throw Error('Continuity lease already exists');
  const base = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  if (![base, `${base}/overview`].includes(location.href)) throw Error('Not the original PR22 overview');
  const candidates = [...document.querySelectorAll('a#pull-request-tabs-1[role="tab"]')].filter(link => {
    const rect = link.getBoundingClientRect();
    return link.href === `${base}/diff` && link.closest('[data-geld-ui],[hidden],[inert],[aria-hidden="true"]') === null
      && rect.width > 0 && rect.height > 0 && getComputedStyle(link).visibility === 'visible';
  });
  if (candidates.length !== 1) throw Error('One visible native PR22 Files tab is required');
  const link = candidates[0];
  const lease = { document, link, href: link.href, clicks: [] };
  lease.listener = event => {
    if (event.target instanceof Element && event.target.closest('a') === link) lease.clicks.push({ trusted: event.isTrusted, href: link.href, same: document === lease.document && link.isConnected });
  };
  document.addEventListener('click', lease.listener, true);
  globalThis[key] = lease;
  return { href: lease.href };
}

export function bitbucketUiTransitionState(cleanup = false) {
  const key = '__geldBitbucketUiContinuity';
  const lease = globalThis[key];
  if (!lease) return { sameDocument: false, clicks: [] };
  const value = { sameDocument: lease.document === document, url: location.href, clicks: lease.clicks, href: lease.href };
  if (cleanup) { lease.document.removeEventListener('click', lease.listener, true);delete globalThis[key]; }
  return value;
}

/** Native nodes and links remain the authority for what actually rendered after the SPA transition. */
export function bitbucketUiNativeInventory(remember = false) {
  const lease = globalThis.__geldBitbucketUiContinuity;
  if (!lease || lease.document !== document) return null;
  const container = [...document.querySelectorAll('[role="region"][aria-label="Diff"]')].find(node => node.closest('[data-geld-ui]') === null);
  if (!container) return null;
  const roots = [...container.querySelectorAll(':scope > div > div[id^="chg-"]')].filter(node => node.closest('[data-geld-ui]') === null);
  const nodes = roots.map(anchor => {
    const path = anchor.id.slice(4);
    const links = [...document.querySelectorAll('#file-tree ul[role="list"] a[href^="#chg-"]')].filter(link => {
      if (link.closest('[data-geld-ui]')) return false;
      try { return decodeURIComponent(new URL(link.href).hash.slice(5)) === path; } catch { return false; }
    });
    const link = links.length === 1 ? links[0] : null;
    const root = anchor.parentElement;
    const checkbox = [...root?.querySelectorAll('article[data-qa="branch-diff-file"] label') ?? []].find(label => label.textContent.trim() === 'Viewed')?.querySelector('input[type="checkbox"]') ?? null;
    return { path, anchor, root, link, checkbox };
  });
  if (remember) lease.rows = nodes;
  const mismatches = { anchor: 0, root: 0, link: 0, checkbox: 0 };
  const hydratedControls = [];
  for (const [index, entry] of nodes.entries()) {
    const saved = lease.rows?.[index];
    for (const key of ['anchor', 'root', 'link']) if (saved?.[key] !== entry[key]) mismatches[key]++;
    if (saved?.checkbox === entry.checkbox) continue;
    if (saved?.checkbox === null && entry.checkbox !== null && !entry.checkbox.checked) hydratedControls.push(entry.path);
    else mismatches.checkbox++;
  }
  return {
    sameNative: lease.rows?.length === nodes.length && Object.values(mismatches).every(count => count === 0),
    mismatches, hydratedControls,
    files: nodes.map(entry => ({ path: entry.path, anchor: entry.anchor.id, href: entry.link?.getAttribute('href') ?? null, viewed: entry.checkbox?.checked ?? null })),
  };
}

/** One installed page and one native navigation; every failed half remains explicitly incomplete. */
export async function verifyBitbucketUiContinuity(page, item, context) {
  const result = item.uiContinuity = { status: 'incomplete', digest: { status: 'pending' }, diff: { status: 'pending' }, navigationAttempts: 0 };
  const checkpoint = async () => { result.quota = context.quota();await context.checkpoint(); };
  try {
    assert.ok([BITBUCKET_UI_PR, `${BITBUCKET_UI_PR}/overview`].includes(page.url()));
    await context.verifyDigest(page, item);
    result.digest = { status: 'passed', checkpoint: 'before_native_files_navigation' };
    await checkpoint();
    const digestHead = await page.$eval('.geld-provider-review[data-provider="bitbucket"]', node => node.getAttribute('data-geld-review-head'));
    const state = await context.readState(page);
    const cached = await context.poll(context.readSource, entries => Array.isArray(entries) && entries.length === 1, 'Complete cached PR22 source receipt', 3000);
    const source = assertBitbucketUiSource(cached, state);
    assert.equal(source.sourceFacts.comparison.headSha, digestHead, 'Digest and cached diff must describe the same head');
    result.source = { repository: REPOSITORY, review: 22, head: source.sourceFacts.comparison.headSha, base: source.sourceFacts.comparison.baseSha, files: source.files.length, selectedPath: BITBUCKET_UI_PATH, totals: state.all, fingerprint: createHash('sha256').update(JSON.stringify(source)).digest('hex') };
    await checkpoint();
    context.guard();
    result.nativeTab = await page.evaluate(prepareBitbucketUiTransition);
    const handle = await page.evaluateHandle(() => globalThis.__geldBitbucketUiContinuity?.link ?? null);
    try {
      const link = handle.asElement();
      assert.ok(link !== null, 'The leased native tab is required');
      result.navigationAttempts += 1;await link.click();
    } finally { await handle.dispose(); }
    result.transition = await context.poll(() => page.evaluate(bitbucketUiTransitionState), value => value.sameDocument && value.url === `${BITBUCKET_UI_PR}/diff`, 'Same-document native PR22 Files transition');
    assert.deepEqual(result.transition.clicks, [{ trusted: true, href: `${BITBUCKET_UI_PR}/diff`, same: true }]);
    const diffState = await context.poll(() => context.readState(page), value => value.onDiffPage === true && value.hasDiff === true, 'PR22 diff adapter after native transition');
    const diffSource = assertBitbucketUiSource(await context.readSource(), diffState);
    assert.ok(isDeepStrictEqual(diffSource, source), 'The same complete cached source must survive the native tab transition');
    const inventory = await context.poll(() => page.evaluate(bitbucketUiNativeInventory, true), value => value !== null && value.files.length === source.files.length && value.files.every(file => file.href !== null), 'Complete native PR22 file inventory');
    assert.deepEqual(inventory.files.map(file => file.path).sort(), source.files.map(file => file.path).sort());
    await context.verifyFiltering(page, item, { source, originalState: diffState });
    const restoredInventory = await page.evaluate(bitbucketUiNativeInventory);
    result.inventoryRestoration = restoredInventory;
    assert.equal(restoredInventory?.sameNative, true, `Native source nodes changed during category filtering: ${JSON.stringify(restoredInventory?.mismatches)}`);
    const expectedFiles = inventory.files.map(file => file.viewed === null && restoredInventory.hydratedControls?.includes(file.path) ? { ...file, viewed: false } : file);
    assert.deepEqual(restoredInventory.files, expectedFiles, 'Native paths, links or Viewed flags changed during filtering');
    result.nativeInventory = { files: inventory.files.length, preserved: true, fingerprint: createHash('sha256').update(JSON.stringify(inventory.files)).digest('hex') };
    const finalSource = assertBitbucketUiSource(await context.readSource(), await context.readState(page));
    assert.ok(isDeepStrictEqual(finalSource, source), 'Filtering must retain the same complete source');
    result.cacheIdentityPreserved = true;
    result.diff = { status: 'passed' };
    result.status = 'passed';
    await checkpoint();
    return { status: 'passed', verified: 'PR22 native digest, same-document Files navigation, visible filtered counts, compact popover and category navigation with one complete source.' };
  } catch (error) {
    result.diff = { ...result.diff, status: result.diff.status === 'passed' ? 'passed' : 'incomplete' };
    result.status = 'incomplete';
    await checkpoint().catch(() => {});
    throw error;
  } finally {
    if (!page.isClosed()) await page.evaluate(bitbucketUiTransitionState, true).catch(() => {});
  }
}
