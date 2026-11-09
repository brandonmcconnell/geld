import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { commitHoverTotal } from './bitbucket-commit-oracle.mjs';

export const BITBUCKET_COMMIT_LIST = 'https://bitbucket.org/atlassian/bitbucket-upload-file/commits/';
export const BITBUCKET_COMMIT_LINK_SETTINGS = { enabled: true, showListStats: true, repoConfigs: 'never', aiEnabled: false };

export function bitbucketCommitLinksSnapshot() {
  const current = new URL(location.href);
  const route = '/atlassian/bitbucket-upload-file/commits/';
  if (current.origin !== 'https://bitbucket.org' || current.pathname !== route || current.search !== '' || current.hash !== '') return { unavailable: 'The original repository commit-list route changed.', links: [], selected: null };
  const forbidden = '[data-geld-ui], form, button, [role="button"], input, textarea, select, [contenteditable], dialog, [role="dialog"], [role="tooltip"], [popover], nav, aside, header, footer';
  const surfaces = [...document.querySelectorAll('main, [role="main"], table, [role="table"]')].filter((node) => node.closest(forbidden) === null);
  const links = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    if (anchor.namespaceURI !== 'http://www.w3.org/1999/xhtml' || anchor.closest(forbidden) !== null || !surfaces.some((surface) => surface.contains(anchor)) || anchor.tabIndex < 0) continue;
    const raw = anchor.getAttribute('href');
    if (raw === null || raw.length > 1024 || /[\u0000-\u0020\u007f]/.test(raw)) continue;
    let url;try { url = new URL(raw, current); } catch { continue; }
    const match = /^\/atlassian\/bitbucket-upload-file\/commits\/([a-f0-9]{7,40}|[a-f0-9]{64})\/?$/i.exec(url.pathname);
    if (url.origin !== current.origin || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || match === null || anchor.textContent.trim() === '') continue;
    const rect = anchor.getBoundingClientRect();const x = rect.left + rect.width / 2;const y = rect.top + rect.height / 2;
    let presented = anchor.isConnected && rect.width > 0 && rect.height > 0 && anchor.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]') === null;
    for (let node = anchor; presented && node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') presented = false;
    }
    const hit = document.elementFromPoint(x, y);
    const visible = presented && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && hit !== null && (hit === anchor || anchor.contains(hit));
    const parts = [];let node = anchor;
    while (node !== null && parts.length < 24) {
      const siblings = node.parentElement === null ? [] : [...node.parentElement.children].filter((sibling) => sibling.localName === node.localName);
      parts.unshift(`${node.localName}:nth-of-type(${siblings.length === 0 ? 1 : siblings.indexOf(node) + 1})`);node = node.parentElement;
    }
    const selector = node === null ? parts.join(' > ') : null;
    const surface = anchor.closest('main, [role="main"], table, [role="table"]');
    links.push({ href: url.href, raw, ref: match[1].toLowerCase(), text: anchor.textContent.trim().slice(0, 512), selector, visible, presented,
      surface: surface === null ? null : { tag: surface.tagName, role: surface.getAttribute('role') },
      bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
    if (links.length >= 100) break;
  }
  const preferred = '9777bca47119a91758bde1209ac14e6076ffbf23';
  const candidates = links.filter((link) => link.visible && link.selector !== null);
  const selected = candidates.find((link) => preferred.startsWith(link.ref)) ?? candidates.find((link) => link.ref.length === 40 || link.ref.length === 64) ?? candidates[0] ?? null;
  return { url: current.href, semanticSurfaces: surfaces.map((node) => ({ tag: node.tagName, role: node.getAttribute('role') })).slice(0, 12), links, selected };
}

export function bitbucketCommitLinkState() {
  const saved = globalThis.__geldCommitLinksProof;
  if (saved === undefined) return null;
  const original = saved.node;
  const nativeCards = [];
  for (let node = original, depth = 0; node !== null && node !== document.body && depth < 4; node = node.parentElement, depth += 1) {
    for (const id of (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id !== '' && id !== 'geld-provider-count-tooltip')) {
      const target = document.getElementById(id);
      nativeCards.push({ id, present: target !== null, role: target?.getAttribute('role') ?? null, popover: target?.hasAttribute('popover') ?? false,
        text: target?.textContent.trim().slice(0, 240) ?? null });
    }
  }
  return { url: location.href, sameNode: document.querySelector(saved.selector) === original && original.isConnected,
    sameParent: original.parentElement === saved.parent, sameText: original.textContent === saved.text, href: original.href, raw: original.getAttribute('href'), text: original.textContent.trim().slice(0, 512),
    events: [...saved.events], nativeCards };
}

export function commitLinkSettingsScope({ readSettings, writeSettings, progress }) {
  let original;
  return {
    async prepare() {
      original = await readSettings();
      assert.ok(original !== null && typeof original === 'object' && !Array.isArray(original), 'Missing real shared settings');
      const expected = { ...original, ...BITBUCKET_COMMIT_LINK_SETTINGS };
      await writeSettings(expected);
      assert.ok(isDeepStrictEqual(await readSettings(), expected), 'Commit-link scoped settings readback differs');
      Object.assign(progress, { status: 'scoped', values: BITBUCKET_COMMIT_LINK_SETTINGS, restoration: 'pending' });
    },
    async restore(pageClosed) {
      if (original === undefined) return;
      progress.restoration = 'failed';
      assert.equal(pageClosed, true, 'Close the provider page before restoring settings that could create source demand');
      await writeSettings(original);
      assert.ok(isDeepStrictEqual(await readSettings(), original), 'Original commit-link settings were not restored exactly');
      progress.restoration = 'restored';progress.pageClosedBeforeRestore = true;
    },
  };
}

export async function verifyBitbucketCommitLinks(page, item, { oracle, poll, installedHover, guardBudget }) {
  const proof = { status: 'pending', scope: 'Actual original repository commit-list link. Global settings, no repository configuration, AI or provider writes. Metadata and complete diffstat are observed responses only.', nativeCards: 'Independently sampled native ARIA associations are not a native card feature pass.' };
  item.commitLinks = proof;
  let discovery;
  try {
    discovery = await poll(async () => { const value = await page.evaluate(bitbucketCommitLinksSnapshot);proof.discovery = value;return value; }, (value) => value.selected !== null, 'A visible original commit link within a native main/table surface', 8000);
  } catch (error) {
    if (page.isClosed()) throw error;
    proof.status = 'unavailable';proof.reason = 'No supported visible native commit-list link was observed. No alternative URL or source probe was attempted.';
    return { status: proof.status, reason: proof.reason };
  }
  const selected = discovery.selected;
  proof.budgetBeforeIntent = guardBudget();
  if (!proof.budgetBeforeIntent.available) {
    proof.status = 'unavailable';proof.reason = 'Fewer than eight observed requests remain before source intent. No hover or alternative source acquisition attempted.';
    return { status: proof.status, reason: proof.reason };
  }
  await page.evaluate((selected) => {
    const node = document.querySelector(selected.selector);
    if (node === null || node.href !== selected.href || node.getAttribute('href') !== selected.raw || node.textContent.trim().slice(0, 512) !== selected.text) throw new Error('Native commit link changed before verification');
    const saved = { node, parent: node.parentElement, selector: selected.selector, text: node.textContent, events: [] };
    saved.listener = (event) => { if (saved.events.length < 12) saved.events.push({ type: event.type, trusted: event.isTrusted }); };
    node.addEventListener('mouseover', saved.listener, true);node.addEventListener('focusin', saved.listener, true);
    globalThis.__geldCommitLinksProof = saved;
  }, selected);
  const nativeUnchanged = (state) => {
    assert.equal(state?.url, BITBUCKET_COMMIT_LIST);assert.equal(state.sameNode, true);assert.equal(state.sameParent, true);assert.equal(state.sameText, true);
    assert.equal(state.href, selected.href);assert.equal(state.raw, selected.raw);assert.equal(state.text, selected.text);
  };
  const accessibleHover = (value) => {
    assert.equal(value.described, true);assert.equal(value.escapeDismissed, true);
    assert.equal(value.visibility?.beforeScreenshot?.unobscured, true);assert.equal(value.visibility?.afterScreenshot?.unobscured, true);
  };
  try {
    proof.before = await page.evaluate(bitbucketCommitLinkState);
    nativeUnchanged(proof.before);
    try { proof.pointer = await installedHover(page, selected.selector, 'pointer', 'bitbucket-commit-link-pointer', undefined, { verifyUnobscured: true }); }
    catch (error) {
      if (page.isClosed()) throw error;
      proof.afterPointer = await page.evaluate(bitbucketCommitLinkState);
      if (error?.code === 'ERR_ASSERTION') throw error;
      proof.status = 'unavailable';proof.reason = error instanceof Error ? error.message : String(error);
      return { status: proof.status, reason: proof.reason };
    }
    proof.afterPointer = await page.evaluate(bitbucketCommitLinkState);
    nativeUnchanged(proof.afterPointer);accessibleHover(proof.pointer);
    assert.ok(proof.afterPointer?.events.some((event) => event.type === 'mouseover' && event.trusted), 'Original commit link requires trusted pointer input');
    try { proof.oracle = await poll(() => oracle.snapshot(selected.ref), (value) => value.status === 'ready', 'Already-issued metadata and complete diffstat for this exact native commit', 3000); }
    catch (error) {
      if (page.isClosed()) throw error;
      proof.status = 'unavailable';proof.reason = 'Already-issued responses did not establish a complete immutable commit oracle.';proof.oracle = oracle.snapshot(selected.ref);
      return { status: proof.status, reason: proof.reason };
    }
    assert.deepEqual(commitHoverTotal(proof.pointer.rows), proof.oracle.totals, 'Original commit-link pointer counts disagree with its own complete diffstat');
    proof.keyboard = await installedHover(page, selected.selector, 'keyboard', 'bitbucket-commit-link-keyboard', undefined, { verifyUnobscured: true });
    proof.after = await page.evaluate(bitbucketCommitLinkState);
    nativeUnchanged(proof.after);accessibleHover(proof.keyboard);
    assert.equal(proof.keyboard.keyboardNavigation?.started, true);assert.equal(proof.keyboard.keyboardNavigation?.stops.at(-1)?.target, true);
    assert.ok(proof.after?.events.some((event) => event.type === 'focusin' && event.trusted), 'Original commit link requires trusted native keyboard focus');
    assert.deepEqual(commitHoverTotal(proof.keyboard.rows), proof.oracle.totals, 'Original commit-link keyboard counts disagree with its own complete diffstat');
    assert.deepEqual(proof.pointer.rows, proof.keyboard.rows, 'Pointer and real Tab breakdowns disagree');
    proof.status = 'passed';
    return { status: 'passed', verified: 'The genuine native repository-list commit link keeps its original identity and shows its own observed immutable diffstat through trusted pointer and real Tab, with accessible ownership, Escape and unobscured cell assertions.' };
  } catch (error) { proof.status = 'failed';proof.reason = error instanceof Error ? error.message : String(error);throw error; }
  finally {
    if (!page.isClosed()) await page.evaluate(() => {
      const saved = globalThis.__geldCommitLinksProof;
      if (saved !== undefined) { saved.node.removeEventListener('mouseover', saved.listener, true);saved.node.removeEventListener('focusin', saved.listener, true); }
      delete globalThis.__geldCommitLinksProof;
    });
  }
}
