import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { commitHoverTotal } from './bitbucket-commit-oracle.mjs';
import { restoreCategoryPatterns, settingsRequestEvidence } from './three-provider-settings.mjs';

export const BITBUCKET_COMMIT_LIST = 'https://bitbucket.org/atlassian/bitbucket-upload-file/commits/';
export const BITBUCKET_COMMIT_LINK_SETTINGS = { enabled: true, showListStats: true, repoConfigs: 'never', aiEnabled: false };

export function commitLinkFilteredRows(oracle) {
  assert.equal(oracle.status, 'ready', 'Filtered hover requires a complete immutable oracle');
  assert.equal(new Set(oracle.files.map((file) => file.path)).size, oracle.files.length, 'Oracle paths must be unique');
  assert.equal(oracle.files.length, oracle.totals.files);
  for (const key of ['additions', 'deletions']) {
    assert.ok(oracle.files.every((file) => Number.isSafeInteger(file[key]) && file[key] >= 0));
    assert.equal(oracle.files.reduce((sum, file) => sum + file[key], 0), oracle.totals[key]);
  }
  const readme = oracle.files.filter((file) => file.path === 'README.md');
  assert.equal(readme.length, 1, 'Positive category subtraction requires exactly observed README.md');
  assert.ok(readme[0].additions > 0 && readme[0].deletions > 0, 'README must remove both nonzero additions and deletions from Essential');
  const hidden = { files: 1, additions: readme[0].additions, deletions: readme[0].deletions };
  const visible = Object.fromEntries(['files', 'additions', 'deletions'].map((key) => [key, oracle.totals[key] - hidden[key]]));
  const row = (label, totals) => ({ label, files: `${totals.files} ${totals.files === 1 ? 'file' : 'files'}`, additions: `+${totals.additions.toLocaleString('en-US')}`, deletions: `−${totals.deletions.toLocaleString('en-US')}` });
  return [row('Essential', visible), row('Tests', hidden), row('Total', oracle.totals)];
}

export function bitbucketCommitLinksSnapshot() {
  const current = new URL(location.href);
  const route = '/atlassian/bitbucket-upload-file/commits/';
  const nativeMasterRoute = `${route}branch/master`;
  const actualURL = current.href;
  if (current.origin !== 'https://bitbucket.org' || current.username !== '' || current.password !== '' || ![route, nativeMasterRoute].includes(current.pathname) || current.search !== '' || current.hash !== '') return { actualURL, url: actualURL, unavailable: 'The original repository commit-list route changed.', links: [], selected: null };
  const forbidden = '[data-geld-ui], form, button, [role="button"], input, textarea, select, [contenteditable], dialog, [role="dialog"], [role="tooltip"], [popover], nav, aside, header, footer';
  const surfaces = [...document.querySelectorAll('main, [role="main"], table, [role="table"]')].filter((node) => node.closest(forbidden) === null);
  // Run41366452688 records this exact native ref selector and canonical document route.
  const refSelector = '[data-qa="commit-list-filters"] [data-qa="ref-selector"] button[data-testid="ref-selector-trigger"]';
  const branchSelector = `${refSelector}[aria-label="Filter by ref: master"]`;
  const refButtons = [...document.querySelectorAll(refSelector)];
  const branchButtons = [...document.querySelectorAll(branchSelector)];
  const branchForbidden = '[data-geld-ui], form, input, textarea, select, [contenteditable], dialog, [role="dialog"], [role="tooltip"], [popover], nav, aside, header, footer';
  const nativeBranch = refButtons.length === 1 && branchButtons.length === 1 && branchButtons[0].closest(branchForbidden) === null && surfaces.some((surface) => surface.contains(branchButtons[0]))
    && branchButtons[0].type === 'button' && !branchButtons[0].disabled && branchButtons[0].getAttribute('aria-disabled') !== 'true'
    && branchButtons[0].getAttribute('aria-haspopup') === 'true' && branchButtons[0].textContent.trim() === 'master' ? branchButtons[0] : null;
  const branch = nativeBranch === null ? null : { selector: branchSelector, label: nativeBranch.getAttribute('aria-label'), text: nativeBranch.textContent.trim() };
  if ((current.pathname === nativeMasterRoute || refButtons.length > 0) && branch === null) return { actualURL, url: actualURL, unavailable: 'The exact native master listing requires its original master ref selector.', branch, links: [], selected: null };
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
  return { actualURL, url: actualURL, branch, semanticSurfaces: surfaces.map((node) => ({ tag: node.tagName, role: node.getAttribute('role') })).slice(0, 12), links, selected };
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
    focused: document.activeElement === original || original.contains(document.activeElement),
    activeElement: document.activeElement === null ? null : { tag: document.activeElement.tagName, id: document.activeElement.id, testid: document.activeElement.getAttribute('data-testid'), href: document.activeElement.getAttribute('href'), text: document.activeElement.textContent.trim().slice(0, 120) },
    branch: saved.branch == null ? null : { unique: document.querySelectorAll(saved.branch.selector).length === 1, sameNode: document.querySelector(saved.branch.selector) === saved.branch.node && saved.branch.node.isConnected, sameParent: saved.branch.node.parentElement === saved.branch.parent, label: saved.branch.node.getAttribute('aria-label'), text: saved.branch.node.textContent.trim() },
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

export async function verifyBitbucketCommitLinks(page, item, { oracle, poll, installedHover, guardBudget, readSettings, writeSettings, extensionId }) {
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
  const nativeUnchanged = (state) => {
    assert.equal(state?.url, discovery.actualURL);assert.equal(state.sameNode, true);assert.equal(state.sameParent, true);assert.equal(state.sameText, true);
    assert.equal(state.href, selected.href);assert.equal(state.raw, selected.raw);assert.equal(state.text, selected.text);
    if (discovery.branch != null) { assert.equal(state.branch?.unique, true);assert.equal(state.branch.sameNode, true);assert.equal(state.branch.sameParent, true);assert.equal(state.branch.label, discovery.branch.label);assert.equal(state.branch.text, discovery.branch.text); }
  };
  const accessibleHover = (value) => {
    assert.equal(value.described, true);assert.equal(value.escapeDismissed, true);
    assert.equal(value.visibility?.beforeScreenshot?.unobscured, true);assert.equal(value.visibility?.afterScreenshot?.unobscured, true);
  };
  try {
    await page.evaluate((selected, actualURL, branch) => {
      if (location.href !== actualURL) throw new Error('Native commit-list document changed before verification');
      const node = document.querySelector(selected.selector);
      if (node === null || node.href !== selected.href || node.getAttribute('href') !== selected.raw || node.textContent.trim().slice(0, 512) !== selected.text) throw new Error('Native commit link changed before verification');
      const branchNode = branch === null ? null : document.querySelector(branch.selector);
      if (branch !== null && (branchNode === null || document.querySelectorAll(branch.selector).length !== 1 || branchNode.getAttribute('aria-label') !== branch.label || branchNode.textContent.trim() !== branch.text)) throw new Error('Native commit-list ref selection changed before verification');
      const saved = { node, parent: node.parentElement, selector: selected.selector, text: node.textContent, events: [], branch: branchNode === null ? null : { ...branch, node: branchNode, parent: branchNode.parentElement } };
      saved.listener = (event) => { if (saved.events.length < 12) saved.events.push({ type: event.type, trusted: event.isTrusted }); };
      node.addEventListener('mouseover', saved.listener, true);node.addEventListener('focusin', saved.listener, true);node.addEventListener('focusout', saved.listener, true);
      globalThis.__geldCommitLinksProof = saved;
    }, selected, discovery.actualURL, discovery.branch ?? null);
    proof.before = await page.evaluate(bitbucketCommitLinkState);
    nativeUnchanged(proof.before);
    try { proof.pointer = await installedHover(page, selected.selector, 'pointer', 'bitbucket-commit-link-pointer', undefined, { verifyUnobscured: true }); }
    catch (error) {
      if (page.isClosed()) throw error;
      proof.afterPointer = await page.evaluate(bitbucketCommitLinkState);
      nativeUnchanged(proof.afterPointer);
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
    const filteredRows = commitLinkFilteredRows(proof.oracle);
    const original = await readSettings();
    const pattern = { status: 'running', scope: 'Pattern-only real chrome.storage.sync override, derived from the already-issued immutable per-file oracle. No explicit source or oracle fetch.', path: 'README.md', expectedRows: filteredRows, requests: [], extensionRequests: [], nativeOrUnattributedRequests: [], sourceGetCount: 0, originalSettings: original, restoration: 'pending' };
    proof.categorySubtraction = pattern;
    const request = (value) => {
      if (value.method() !== 'GET') return;
      const observed = settingsRequestEvidence({ url: value.url(), method: value.method(), initiator: value.initiator?.() }, extensionId);
      if (observed !== null) {
        if (pattern.requests.length < 100) pattern.requests.push({ ...observed, observedAt: new Date().toISOString() });
        else pattern.requestEvidenceOverflow = true;
        pattern.extensionRequests = pattern.requests.filter((request) => request.extensionInitiator);
        pattern.nativeOrUnattributedRequests = pattern.requests.filter((request) => !request.extensionInitiator);
        pattern.sourceGetCount = pattern.requests.length;
      }
    };
    const check = async (rows, phase) => {
      nativeUnchanged(await page.evaluate(bitbucketCommitLinkState));
      assert.deepEqual(oracle.snapshot(selected.ref), proof.oracle, 'Pattern change altered the immutable source oracle');
      const result = {};
      pattern[phase] = result;
      for (const input of ['pointer', 'keyboard']) {
        const reserve = guardBudget();assert.equal(reserve.available, true, 'Eight observed requests must remain before each filtered/restored hover intent');
        await page.evaluate(() => { globalThis.__geldCommitLinksProof.events.length = 0; });
        if (input === 'pointer') {
          const departure = { before: await page.evaluate(bitbucketCommitLinkState), status: 'checking' };
          result.pointerDeparture = departure;nativeUnchanged(departure.before);
          assert.equal(typeof departure.before.focused, 'boolean', 'Native focus evidence is required before pointer reentry');
          if (departure.before.focused) {
            departure.input = ['Shift down', 'Tab', 'Shift up'];
            await page.keyboard.down('Shift');
            try { await page.keyboard.press('Tab'); }
            finally { await page.keyboard.up('Shift'); }
            departure.after = await page.evaluate(bitbucketCommitLinkState);nativeUnchanged(departure.after);
            assert.equal(departure.after.focused, false, 'Real Shift+Tab must leave the original native source before pointer reentry');
            assert.ok(departure.after.events.some((event) => event.type === 'focusout' && event.trusted), 'Original source requires a trusted focusout from actual keyboard departure');
            departure.status = 'departed';
          } else departure.status = 'source_not_focused';
        }
        result[input] = await installedHover(page, selected.selector, input, `bitbucket-commit-link-${phase}-${input}`, undefined, { verifyUnobscured: true, expectedRows: rows });
        accessibleHover(result[input]);assert.deepEqual(result[input].rows, rows, `${phase} ${input} category rows disagree with the per-file oracle`);
        if (input === 'keyboard') { assert.equal(result[input].keyboardNavigation?.started, true);assert.equal(result[input].keyboardNavigation?.stops.at(-1)?.target, true); }
        result.after = await page.evaluate(bitbucketCommitLinkState);nativeUnchanged(result.after);
        assert.ok(result.after.events.some((event) => event.type === (input === 'pointer' ? 'mouseover' : 'focusin') && event.trusted));
        assert.deepEqual(oracle.snapshot(selected.ref), proof.oracle, 'Hover altered the immutable source oracle');
        assert.notEqual(pattern.requestEvidenceOverflow, true, 'Pattern-phase source request evidence exceeded its bounded capacity');
      }
    };
    page.on('request', request);
    try {
      const expected = { ...original, categoryPatterns: { ...original.categoryPatterns, tests: ['README.md'] } };
      await writeSettings(expected);
      pattern.filteredSettings = await readSettings();assert.deepEqual(pattern.filteredSettings, expected, 'Only categoryPatterns may change for filtered commit hover');
      await check(filteredRows, 'filtered');
    } finally {
      try {
        const latest = await readSettings();
        const restored = restoreCategoryPatterns(latest, original);
        await writeSettings(restored);
        pattern.restoredSettings = await readSettings();
        assert.deepEqual(pattern.restoredSettings, original, 'Original scoped settings and categoryPatterns presence must be restored exactly');
        pattern.restoration = 'restored';
      } catch (error) { pattern.restoration = 'failed';pattern.cleanupError = error instanceof Error ? error.message : String(error);throw error; }
      finally { page.off('request', request); }
    }
    // Include restored hover requests in the same evidence scope too.
    page.on('request', request);
    try {
      await check(proof.pointer.rows, 'restored');
      pattern.extensionRequests = pattern.requests.filter((request) => request.extensionInitiator);
      pattern.nativeOrUnattributedRequests = pattern.requests.filter((request) => !request.extensionInitiator);
      pattern.sourceGetCount = pattern.requests.length;
      assert.deepEqual(pattern.extensionRequests, [], 'Pattern-only commit hover caused another positively extension-attributed source GET');
      assert.deepEqual(await readSettings(), original, 'Restored hover changed the real shared settings');
      pattern.status = 'passed';
    } finally { page.off('request', request); }
    proof.status = 'passed';
    return { status: 'passed', verified: 'The genuine native repository-list commit link retains its source/ref identity through baseline, nonzero README category subtraction and restoration, each by trusted pointer and real Tab against its own complete immutable diffstat with accessible ownership, Escape and unobscured cell assertions.' };
  } catch (error) { proof.status = 'failed';if (proof.categorySubtraction !== undefined) proof.categorySubtraction.status = 'failed';proof.reason = error instanceof Error ? error.message : String(error);throw error; }
  finally {
    if (!page.isClosed()) await page.evaluate(() => {
      const saved = globalThis.__geldCommitLinksProof;
      if (saved !== undefined) { saved.node.removeEventListener('mouseover', saved.listener, true);saved.node.removeEventListener('focusin', saved.listener, true);saved.node.removeEventListener('focusout', saved.listener, true); }
      delete globalThis.__geldCommitLinksProof;
    });
  }
}
