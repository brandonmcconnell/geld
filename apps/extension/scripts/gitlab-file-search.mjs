import assert from 'node:assert/strict';

export const GITLAB_FILE_SEARCH = Object.freeze({
  url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123',
  path: 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb',
  anchor: '1368db605e5982dfe6a6596a37b7cb054d48d61d',
  head: '13215ca460cd4f75d3765a882ef486aa2dacf549',
  version: '2158520123',
  review: '019271d5e9aaae129d85f3585c16c1acf7a767cd',
  query: 'issue_move_list_spec.rb',
});

export function gitLabFileSearchSnapshot(fixture) {
  const host = document.querySelector('[data-testid="file-tree-container"]');
  const input = host?.querySelector('input[type="search"][data-testid="diff-tree-search"]');
  const nav = host?.querySelector('nav.mr-tree-list[aria-label="File tree"]');
  const own = [...host?.querySelectorAll('[data-geld-category-path]') ?? []].find((row) => row.getAttribute('data-geld-category-path') === fixture.path);
  const control = own?.querySelector('a,button');
  const section = own?.closest('.geld-provider-category');
  const folder = [...section?.querySelectorAll('.geld-provider-category-folder') ?? []].find((node) => node.nextElementSibling?.contains(own));
  const original = [...nav?.querySelectorAll('a[data-testid="file-row"][data-file-row]') ?? []].filter((link) => {
    if (link.closest('[data-geld-ui]') !== null) return false;
    try { const url = new URL(link.href);return url.origin === location.origin && url.pathname === location.pathname && url.searchParams.get('file_path') === fixture.path && url.searchParams.get('diff_id') === fixture.version && url.hash === `#${fixture.anchor}`; } catch { return false; }
  });
  const roots = [...document.querySelectorAll('diff-file[data-file-data]')].filter((node) => {
    try { return JSON.parse(node.getAttribute('data-file-data')).new_path === fixture.path; } catch { return false; }
  });
  const root = roots[0];
  const details = root?.querySelector('details[data-file-body]');
  let data = null;
  try { data = JSON.parse(root?.getAttribute('data-file-data') ?? 'null'); } catch { /* Unknown native source must fail scope checks. */ }
  const visible = (node) => {
    if (node == null || node.closest('[hidden],[aria-hidden="true"],[inert]') !== null) return false;
    for (let ancestor = node; ancestor !== null; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    const rect = node.getBoundingClientRect();return rect.width > 0 && rect.height > 0;
  };
  const code = [...details?.querySelectorAll('.rd-line-text') ?? []].find((node) => node.textContent.trim() !== '' && visible(node));
  const proof = globalThis.__geldFileSearchProof;
  const boxes = [...root?.querySelectorAll('input[type="checkbox"]') ?? []];
  const rect = code?.getBoundingClientRect();
  return {
    url: location.href,
    unique: { host: document.querySelectorAll('[data-testid="file-tree-container"]').length, input: host?.querySelectorAll('input[type="search"][data-testid="diff-tree-search"]').length ?? 0, nav: host?.querySelectorAll('nav.mr-tree-list[aria-label="File tree"]').length ?? 0, roots: roots.length },
    search: input == null ? null : { attributes: ['type', 'id', 'data-testid', 'aria-label', 'placeholder'].map((name) => [name, input.getAttribute(name)]), value: input.value, label: input.getAttribute('aria-label'), visible: visible(input), focused: document.activeElement === input },
    native: { paths: [...nav?.querySelectorAll('a[data-testid="file-row"][data-file-row]') ?? []].filter((link) => link.closest('[data-geld-ui]') === null && visible(link)).map((link) => { try { return new URL(link.href).searchParams.get('file_path'); } catch { return null; } }), resultCount: original.length, visible: visible(original[0]), href: original[0]?.href ?? null, anchor: original[0]?.getAttribute('data-file-row') ?? null, ariaCurrent: original[0]?.getAttribute('aria-current') ?? null, className: original[0]?.className ?? null, listMarker: nav?.getAttribute('data-geld-provider-category-body') ?? null },
    owned: { count: host?.querySelectorAll('.geld-provider-categories').length ?? 0, active: section?.getAttribute('data-active') ?? null, current: control?.getAttribute('aria-current') ?? null, folder: folder == null ? null : { label: folder.querySelector('.geld-provider-category-folder-label')?.textContent ?? null, expanded: folder.getAttribute('aria-expanded') }, headers: [...host?.querySelectorAll('.geld-provider-category-header') ?? []].map((button) => ({ text: button.textContent, expanded: button.getAttribute('aria-expanded') })) },
    source: { id: root?.id ?? null, raw: root?.getAttribute('data-file-data') ?? null, path: data?.new_path ?? null, head: data?.diff_refs?.head_sha ?? null, review: data?.code_review_id ?? null, visible: visible(root), open: details?.open ?? false, codeLines: details?.querySelectorAll('.rd-line-text').length ?? 0, codeVisible: visible(code), codeInViewport: rect != null && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth, boxes: boxes.map((box) => ({ id: box.id, checked: box.checked, disabled: box.disabled, attributes: [...box.attributes].map((attr) => [attr.name, attr.value]) })) },
    identity: proof == null ? null : { input: input === proof.input && input?.parentElement === proof.inputParent, host: host === proof.host && host?.parentElement === proof.hostParent, nav: nav === proof.nav && nav?.parentElement === proof.navParent, root: root === proof.root && root?.parentElement === proof.rootParent, boxes: boxes.length === proof.boxes.length && boxes.every((box, index) => box === proof.boxes[index]) },
    events: proof?.events ?? [],
  };
}

export function assertGitLabFileSearchScope(snapshot, fixture = GITLAB_FILE_SEARCH) {
  const url = new URL(snapshot.url);const expected = new URL(fixture.url);
  assert.equal(url.origin, expected.origin, 'Native search left the original provider');
  assert.equal(url.pathname, expected.pathname, 'Native search left the original MR diff');
  assert.equal(url.searchParams.get('diff_id'), fixture.version, 'Native search changed selected revision');
  assert.deepEqual(snapshot.unique, { host: 1, input: 1, nav: 1, roots: 1 }, 'Search needs unique original native surfaces');
  assert.equal(snapshot.source.id, fixture.anchor);
  assert.equal(snapshot.source.path, fixture.path);
  assert.equal(snapshot.source.head, fixture.head);
  assert.equal(snapshot.source.review, fixture.review);
  assert.ok(snapshot.search?.label && snapshot.search.visible, 'Original accessible native search input is missing');
  if (snapshot.identity !== null) assert.ok(Object.values(snapshot.identity).every(Boolean), 'Original native nodes, parents or checkboxes changed');
}

export async function verifyGitLabFileSearch(page, { poll, capture, totals, progress }) {
  const fixture = GITLAB_FILE_SEARCH;
  const read = () => page.evaluate(gitLabFileSearchSnapshot, fixture);
  const selectors = {
    header: '.geld-provider-category-header',
    file: `[data-geld-category-path="${fixture.path}"] .geld-provider-category-native-row`,
    input: 'input[type="search"][data-testid="diff-tree-search"]',
    native: `a[data-testid="file-row"][data-file-row="${fixture.anchor}"]`,
  };
  const click = async (selector) => {
    await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const target = await page.$eval(selector, (node, selector) => { const rect = node.getBoundingClientRect();return { unique: document.querySelectorAll(selector).length, unobstructed: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }; }, selector);
    assert.equal(target.unique, 1, 'Native search action target is ambiguous');assert.equal(target.unobstructed, true, 'Native search action target is obstructed');
    await page.click(selector);
  };
  const unchanged = (value, baseline) => {
    assertGitLabFileSearchScope(value);
    assert.equal(value.source.raw, baseline.source.raw, 'Native immutable file payload changed');
    assert.deepEqual(value.source.boxes, baseline.source.boxes, 'Native checkbox state or attributes changed');
    assert.deepEqual(value.search.attributes, baseline.search.attributes, 'Original native search semantics changed');
  };
  let cleanupError;
  try {
    progress.before = await read();assertGitLabFileSearchScope(progress.before);
    assert.equal(progress.before.search.value, '', 'Native search must start empty');
    await page.click(selectors.header);
    await page.keyboard.press('End');await page.keyboard.press('Enter');
    progress.tests = await poll(read, (value) => value.owned.active === 'true' && value.source.visible && value.owned.headers.some((header) => /^Tests\s*\(1 test\)/.test(header.text) && header.expanded === 'true'), 'Native search begins with Tests selected');
    await page.evaluate((fixture) => {
      const host = document.querySelector('[data-testid="file-tree-container"]');const input = host.querySelector('input[type="search"][data-testid="diff-tree-search"]');const nav = host.querySelector('nav.mr-tree-list[aria-label="File tree"]');const root = document.getElementById(fixture.anchor);
      const proof = { input, inputParent: input.parentElement, host, hostParent: host.parentElement, nav, navParent: nav.parentElement, root, rootParent: root.parentElement, boxes: [...root.querySelectorAll('input[type="checkbox"]')], events: [] };
      proof.listen = (event) => {
        const target = event.target instanceof Element ? event.target : null;const native = target?.closest('a[data-testid="file-row"][data-file-row]');
        const owned = target?.closest('[data-geld-category-path]');
        if (target === input || native !== null && native !== undefined && native.closest('[data-geld-ui]') === null || owned !== null && owned !== undefined) proof.events.push({ type: event.type, trusted: event.isTrusted, input: target === input, native: native?.closest('[data-geld-ui]') === null ? native.getAttribute('data-file-row') : null, owned: owned?.getAttribute('data-geld-category-path') ?? null, key: event instanceof KeyboardEvent ? event.key : null });
      };
      for (const type of ['click', 'focusin', 'focusout', 'input', 'keydown']) document.addEventListener(type, proof.listen, true);
      globalThis.__geldFileSearchProof = proof;
    }, fixture);
    await click(selectors.file);
    progress.selected = await poll(read, (value) => value.owned.current === 'true' && new URL(value.url).hash === `#${fixture.anchor}` && value.source.open && value.source.codeVisible && value.source.codeInViewport, 'Owned test row reveals exact original native file');
    unchanged(progress.selected, progress.before);
    const folder = `.geld-provider-category[data-active="true"] .geld-provider-category-folder`;
    await click(folder);
    progress.collapsed = await poll(read, (value) => value.owned.folder?.expanded === 'false' && value.owned.current === 'true', 'Custom collapsed folder and current file are established before native search');
    assert.equal(progress.collapsed.owned.folder.label, fixture.path.slice(0, fixture.path.lastIndexOf('/')));
    await click(selectors.input);
    await page.keyboard.press('Tab');
    assert.equal((await read()).search.focused, false, 'Real Tab did not leave original search input');
    await page.keyboard.down('Shift');try { await page.keyboard.press('Tab'); } finally { await page.keyboard.up('Shift'); }
    assert.equal((await read()).search.focused, true, 'Real Shift+Tab did not return to original search input');
    await page.keyboard.type(fixture.query);
    progress.search = await poll(read, (value) => value.search?.value === fixture.query && value.owned.count === 0 && value.native.listMarker === null && value.native.resultCount === 1 && value.native.visible, 'Original native search filters the native tree while the owned accordion is suspended');
    unchanged(progress.search, progress.before);
    assert.deepEqual(progress.search.native.paths, [fixture.path], 'Native filename search left unrelated original file results');
    assert.ok(progress.search.events.some((event) => event.type === 'input' && event.input && event.trusted), 'Typing must produce a trusted native input event');
    progress.searchArtifacts = await capture(page, 'gitlab-file-search-native-results');
    await click(selectors.native);
    progress.activated = await poll(read, (value) => new URL(value.url).hash === `#${fixture.anchor}` && new URL(value.url).searchParams.get('file_path') === fixture.path && value.source.open && value.source.codeVisible && value.source.codeInViewport, 'Real native search result selects and reveals the exact immutable file');
    unchanged(progress.activated, progress.before);
    assert.ok(progress.activated.events.some((event) => event.type === 'click' && event.native === fixture.anchor && event.trusted), 'Native result activation needs an original trusted click');
    await click(selectors.input);await page.keyboard.down('Control');try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }await page.keyboard.press('Backspace');
    progress.restored = await poll(read, (value) => value.search?.value === '' && value.owned.count === 1 && value.owned.active === 'true' && value.owned.folder?.expanded === 'false' && value.owned.current === 'true' && value.native.listMarker === 'native' && value.source.open && value.source.codeVisible, 'Clearing native search restores Tests, custom folder collapse and current file');
    unchanged(progress.restored, progress.before);
    assert.equal(progress.restored.owned.folder.label, progress.collapsed.owned.folder.label);
    progress.totals = await totals();
    progress.restoredArtifacts = await capture(page, 'gitlab-file-search-restored');
    progress.afterCapture = await read();unchanged(progress.afterCapture, progress.before);
    assert.equal(progress.afterCapture.owned.folder.expanded, 'false');assert.equal(progress.afterCapture.owned.current, 'true');
    assert.equal(progress.afterCapture.owned.active, 'true');assert.equal(progress.afterCapture.search.value, '');assert.equal(progress.afterCapture.native.listMarker, 'native');
    assert.equal(progress.afterCapture.source.visible, true);assert.equal(progress.afterCapture.source.open, true);assert.equal(progress.afterCapture.source.codeVisible, true);
    progress.proof = 'Original native file search with trusted pointer, Tab, typing and result selection. Not browser Ctrl+F. Native hydration demand is observed by the existing request guards without a zero-traffic claim.';
    return progress;
  } finally {
    if (!page.isClosed()) {
      try {
        const current = await read();
        const currentURL = new URL(current.url);const expectedURL = new URL(fixture.url);
        if (currentURL.origin === expectedURL.origin && currentURL.pathname === expectedURL.pathname && currentURL.searchParams.get('diff_id') === fixture.version && current.search?.value) {
          await click(selectors.input);await page.keyboard.down('Control');try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }await page.keyboard.press('Backspace');
          await poll(read, (value) => value.search?.value === '', 'Native search finally cleanup');
        }
      } catch (error) { cleanupError = error;progress.cleanupError = String(error); }
      await page.evaluate(() => { const proof = globalThis.__geldFileSearchProof;if (proof !== undefined) for (const type of ['click', 'focusin', 'focusout', 'input', 'keydown']) document.removeEventListener(type, proof.listen, true);delete globalThis.__geldFileSearchProof; });
    }
    if (cleanupError !== undefined) throw cleanupError;
  }
}
