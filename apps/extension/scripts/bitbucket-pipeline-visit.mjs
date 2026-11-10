import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export const BITBUCKET_PIPELINE_REVIEW = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff';
const FLAGS = ['prOverview', 'quickReview'];

export function assertBitbucketPipelineURL(value, expected) {
  const current = new URL(value);const review = new URL(BITBUCKET_PIPELINE_REVIEW);
  assert.equal(current.origin, review.origin);assert.equal(current.pathname, review.pathname);assert.equal(current.search, review.search);
  assert.equal(current.username, '');assert.equal(current.password, '');
  if (expected !== undefined) { assertBitbucketPipelineURL(expected);assert.equal(value, expected, 'Pinned native file-selection URL changed'); }
  return value;
}

export function pipelineBudgetPreflight(active, budget) {
  assert.ok(Number.isSafeInteger(active) && active >= 0);assert.equal(budget, 40);
  const allowance = 16;const minimumFree = 5;const remaining = budget - active;
  return { available: remaining >= allowance + minimumFree, active, remaining, budget, allowance, minimumFree,
    basis: 'Measured focused PR240 run41381283702 native_navigation:16 standard API requests at03:07:46.465Z through03:07:49.455Z on2026-11-02, plus five free. Consent, Settings and later selection costs remain unmeasured. This forecast does not reset the rolling ledger or lower its40 cap. Global request, context reserve and429 guards remain authoritative.' };
}

export function pipelineSettingsScope({ readSettings, writeSettings, progress }) {
  let original;let scoped;let captured = false;
  return {
    async prepare() {
      const value = await readSettings();assert.ok(value === undefined || value !== null && typeof value === 'object' && !Array.isArray(value));
      original = structuredClone(value);scoped = { ...original, prOverview: false, quickReview: false };captured = true;
      progress.originalFlags = Object.fromEntries(FLAGS.map((key) => [key, { present: original !== undefined && Object.hasOwn(original, key), ...(original !== undefined && Object.hasOwn(original, key) ? { value: original[key] } : {}) }]));
      progress.rawSettingsPresent = original !== undefined;progress.restoration = 'pending';
      await writeSettings(structuredClone(scoped));assert.ok(isDeepStrictEqual(await readSettings(), scoped), 'Only scoped review flags may change before pipeline navigation');
      progress.status = 'scoped';progress.values = { prOverview: false, quickReview: false };
    },
    async restore(pageClosed) {
      if (!captured) return;
      progress.restoration = 'failed';progress.pageClosedBeforeRestore = pageClosed;
      assert.equal(pageClosed, true, 'Close the pipeline page before restoring settings that can create review demand');
      assert.ok(isDeepStrictEqual(await readSettings(), scoped), 'Scoped settings changed during pipeline verification; do not overwrite unrelated settings');
      await writeSettings(structuredClone(original));assert.ok(isDeepStrictEqual(await readSettings(), original), 'Original raw settings presence and values were not restored exactly');
      progress.restoration = 'restored';
    },
  };
}

/** Observe the original tree link and retain identities, never replace native selection or app state. */
export function bitbucketPipelineVisitProbe(action = 'read') {
  const KEY = '__geldBitbucketPipelineVisit';const previous = globalThis[KEY];
  if (action === 'cleanup') { previous?.cleanup?.();delete globalThis[KEY];return null; }
  const current = new URL(location.href);
  if (current.origin !== 'https://bitbucket.org' || current.pathname !== '/atlassian/bitbucket-upload-file/pull-requests/27/diff' || current.search !== '' || current.username || current.password) return null;
  const forbidden = '[data-geld-ui], [data-testid="comment"], [data-qa="pr-activity"]';
  const links = [...document.querySelectorAll('#file-tree ul[role="list"] li > a[href="#chg-bitbucket-pipelines.yml"]')].filter((node) => node.closest(forbidden) === null);
  const anchor = document.getElementById('chg-bitbucket-pipelines.yml');const root = anchor?.parentElement;
  const articles = root ? [...root.querySelectorAll('article[data-qa="branch-diff-file"]')].filter((node) => node.closest(forbidden) === null) : [];
  if (links.length !== 1 || !anchor || anchor.closest(forbidden) !== null || !root || articles.length !== 1) return null;
  const link = links[0];const article = articles[0];
  const same = previous === undefined || previous.link === link && previous.linkParent === link.parentElement && previous.root === root && previous.rootParent === root.parentElement && previous.anchor === anchor && previous.article === article && previous.articleParent === article.parentElement;
  if (!same || previous?.url !== undefined && previous.url !== location.href) return null;
  const selected = (() => { try { return decodeURIComponent(current.hash.slice(1)) === anchor.id; } catch { return false; } })();
  const store = previous ?? { link, linkParent: link.parentElement, root, rootParent: root.parentElement, anchor, article, articleParent: article.parentElement, click: null };
  globalThis[KEY] = store;
  if (action === 'link') return link;
  if (action === 'arm') {
    store.cleanup?.();store.click = null;
    const listen = (event) => { if (!(event.target instanceof Element) || !link.contains(event.target)) return;store.click = { trusted: event.isTrusted === true, beforeURL: location.href, href: link.getAttribute('href'), sameLink: store.link === link, sameParent: store.linkParent === link.parentElement };store.cleanup(); };
    store.cleanup = () => document.removeEventListener('click', listen, true);document.addEventListener('click', listen, true);
  }
  if (action === 'pin') { if (!selected) return null;store.url = location.href; }
  if (action === 'click-result') return store.click;
  return { url: location.href, selected, sameSource: same, pinned: store.url ?? null, href: link.getAttribute('href'), heading: article.querySelector('h2[data-qa="bk-filepath"]')?.textContent.trim() ?? null };
}

export async function prepareBitbucketPipelineVisit(page, { poll, progress, guardBudget, assertHead }) {
  progress.status = 'selecting';progress.beforeURL = assertBitbucketPipelineURL(page.url());progress.budget = guardBudget();assertHead();
  const initial = await page.evaluate(bitbucketPipelineVisitProbe);assert.ok(initial?.sameSource && initial.heading === 'bitbucket-pipelines.yml', 'No unique original native Pipeline file link/source');progress.initial = initial;
  assert.equal((await page.evaluate(bitbucketPipelineVisitProbe, 'arm'))?.sameSource, true);
  const handle = await page.evaluateHandle(bitbucketPipelineVisitProbe, 'link');
  try { const link = handle.asElement();assert.ok(link !== null);progress.immediateBudget = guardBudget();assertHead();await link.click(); } finally { await handle.dispose(); }
  progress.input = await page.evaluate(bitbucketPipelineVisitProbe, 'click-result');
  assert.equal(progress.input?.trusted, true);assert.equal(progress.input?.sameLink, true);assert.equal(progress.input?.sameParent, true);assert.equal(progress.input?.href, '#chg-bitbucket-pipelines.yml');
  const selected = await poll(() => page.evaluate(bitbucketPipelineVisitProbe), (value) => value?.selected === true && value.sameSource, 'Trusted native Pipeline file selection');
  const pinned = await page.evaluate(bitbucketPipelineVisitProbe, 'pin');assert.ok(pinned?.pinned && pinned.url === selected.url);assertHead();
  progress.url = assertBitbucketPipelineURL(pinned.url);progress.selected = pinned;progress.status = 'pinned';return progress.url;
}


/** Passive metadata for already observed first-party scripts, before HTML sanitization. */
export function bitbucketPipelineAssetMetadata() {
  const origins = new Set(['https://bitbucket.org', 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net']);
  const records = new Map();let characters = 0;let truncated = false;let examined = 0;
  const observe = (value, basis) => {
    examined += 1;
    if (typeof value !== 'string' || value.length > 2048) return;
    let url;try { url = new URL(value); } catch { return; }
    if (!origins.has(url.origin) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/assets\/[A-Za-z0-9_./-]+\.m?js$/.test(url.pathname)) return;
    const previous = records.get(url.href);
    if (previous !== undefined) { if (!previous.basis.includes(basis)) previous.basis.push(basis);return; }
    if (records.size >= 100 || characters + url.href.length > 60_000) { truncated = true;return; }
    characters += url.href.length;records.set(url.href, { url: url.href, basis: [basis] });
  };
  const scripts = document.querySelectorAll('script[src]');
  for (const node of [...scripts].slice(0, 1000)) if (node.closest('[data-geld-ui], [data-testid="comment"], [data-qa="pr-activity"]') === null) observe(node.src, 'Current native document script.src');
  const resources = performance.getEntriesByType('resource');
  for (const entry of resources.slice(0, 1000)) if (entry.initiatorType === 'script') observe(entry.name, 'Already issued ResourceTiming script entry');
  return { scope: 'Observed URL metadata only. No fetching, source extraction, script execution or module/preference acceptance.', records: [...records.values()], examined, characters, truncated: truncated || scripts.length > 1000 || resources.length > 1000, maxRecords: 100, maxURLCharacters: 2048, maxTotalURLCharacters: 60_000 };
}
