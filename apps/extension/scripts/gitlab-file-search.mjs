import assert from 'node:assert/strict';

export const GITLAB_FILE_SEARCH = Object.freeze({
  url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123',
  path: 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb',
  anchor: '1368db605e5982dfe6a6596a37b7cb054d48d61d',
  head: 'd03aadd2c95a94ecbe229896b29c9dcda009a916',
  version: '2158520123',
  review: '019271d5e9aaae129d85f3585c16c1acf7a767cd',
  query: 'issue_move_list_spec.rb',
});

export function gitLabFileSearchSnapshot(fixture, mode = 'snapshot') {
  let app = null;
  try {
    const nodes = [...document.querySelectorAll('[data-rapid-diffs][data-app-data]')];
    if (nodes.length === 1) {
      const native = JSON.parse(nodes[0].getAttribute('data-app-data'));
      app = { path: native.mr_path, iid: native.iid, sourceVersions: native.versions?.source_versions, targetVersions: native.versions?.target_versions };
    }
  } catch { /* Malformed native versions cannot establish the selected source or target. */ }
  const host = document.querySelector('[data-testid="file-tree-container"]');
  const input = host?.querySelector('input[type="search"][data-testid="diff-tree-search"]');
  const nav = host?.querySelector('nav.mr-tree-list[aria-label="File tree"]');
  const own = [...host?.querySelectorAll('[data-geld-category-path]') ?? []].find((row) => row.getAttribute('data-geld-category-path') === fixture.path);
  const control = own?.querySelector('a,button');
  const section = own?.closest('.geld-provider-category');
  const folder = [...section?.querySelectorAll('.geld-provider-category-folder') ?? []].find((node) => node.nextElementSibling?.contains(own));
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
  const bounds = (node) => {
    if (node == null) return null;
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const positive = (rect) => rect !== null && Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0;
  const nativeRows = [...nav?.querySelectorAll('a[data-testid="file-row"][data-file-row]') ?? []].filter((link) => link.closest('[data-geld-ui]') === null).map((link) => {
    let path = null;let scoped = false;
    try {
      const url = new URL(link.href);path = url.searchParams.get('file_path');
      scoped = url.username === '' && url.password === '' && url.origin === location.origin && url.pathname === location.pathname && url.searchParams.get('diff_id') === fixture.version && path !== null && path !== '' && url.hash === `#${link.getAttribute('data-file-row')}`;
    } catch { /* Unknown native links remain included and cannot satisfy exact source matching. */ }
    const row = link.closest('[data-testid="file-row-container"]');
    const view = row?.parentElement;
    const wrapper = view?.parentElement;
    const scroller = wrapper?.parentElement;
    const chain = link.parentElement === row && view?.classList.contains('vue-recycle-scroller__item-view') === true && wrapper?.classList.contains('vue-recycle-scroller__item-wrapper') === true && scroller?.matches('.vue-recycle-scroller.ready.direction-vertical') === true && nav?.contains(scroller) === true;
    const rect = bounds(link);const viewRect = bounds(view);
    const inlineTransform = view?.style.transform ?? null;
    const computedTransform = view == null ? null : getComputedStyle(view).transform;
    let computedParked = false;
    const matrix = /^matrix\(([^)]+)\)$/.exec(computedTransform ?? '');
    const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(computedTransform ?? '');
    if (matrix !== null) computedParked = JSON.stringify(matrix[1].split(',').map(Number)) === '[1,0,0,1,0,-9999]';
    if (matrix3d !== null) computedParked = JSON.stringify(matrix3d[1].split(',').map(Number)) === '[1,0,0,0,0,1,0,0,0,0,1,0,0,-9999,0,1]';
    const clips = [];
    for (let ancestor = link.parentElement; ancestor !== null && host?.contains(ancestor); ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);const x = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);const y = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
      if (!x && !y) continue;
      const outer = bounds(ancestor);
      const clip = positive(outer) && ancestor.clientWidth > 0 && ancestor.clientHeight > 0 ? { left: outer.left + ancestor.clientLeft, top: outer.top + ancestor.clientTop, right: outer.left + ancestor.clientLeft + ancestor.clientWidth, bottom: outer.top + ancestor.clientTop + ancestor.clientHeight } : null;
      clips.push({ nativeWrapper: ancestor === wrapper, nativeScroller: ancestor === scroller, className: ancestor.className, overflowX: style.overflowX, overflowY: style.overflowY, rect: outer, clip, x, y });
    }
    const outside = (rect, clip) => positive(rect) && clip.clip !== null && (clip.x && (rect.right <= clip.clip.left || rect.left >= clip.clip.right) || clip.y && (rect.bottom <= clip.clip.top || rect.top >= clip.clip.bottom));
    const parked = scoped && chain && inlineTransform === 'translateY(-9999px)' && computedParked && clips.some((clip) => (clip.nativeWrapper || clip.nativeScroller) && outside(rect, clip) && outside(viewRect, clip));
    const painted = visible(link) && positive(rect) && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight && !clips.some((clip) => outside(rect, clip));
    const target = scoped && path === fixture.path && link.getAttribute('data-file-row') === fixture.anchor;
    return { link, info: { path: scoped ? path : null, rawPath: path, href: link.href, anchor: link.getAttribute('data-file-row'), scoped, target, included: !parked, reason: parked ? 'verified_native_unused_pool' : !scoped ? 'included_unknown_source' : !chain ? 'included_unknown_pool_chain' : inlineTransform !== 'translateY(-9999px)' ? 'included_not_parked' : !computedParked ? 'included_computed_transform_mismatch' : 'included_unproven_native_clipping', rendered: visible(link), painted, rect, pool: { chain, viewClass: view?.className ?? null, wrapperClass: wrapper?.className ?? null, scrollerClass: scroller?.className ?? null, inlineTransform, inlineTop: view?.style.top ?? null, computedTransform, rect: viewRect, wrapperRect: bounds(wrapper), scrollerRect: bounds(scroller), scrollTop: scroller?.scrollTop ?? null }, clips } };
  });
  const included = nativeRows.filter((row) => row.info.included);
  const targets = included.filter((row) => row.info.target);
  if (mode === 'target') return included.length === 1 && targets.length === 1 ? targets[0].link : null;
  const original = targets.map((row) => row.link);
  const searchBox = input?.closest('.gl-search-box-by-type');
  const code = [...details?.querySelectorAll('.rd-line-text') ?? []].find((node) => node.textContent.trim() !== '' && visible(node));
  const proof = globalThis.__geldFileSearchProof;
  const boxes = [...root?.querySelectorAll('input[type="checkbox"]') ?? []];
  const rect = code?.getBoundingClientRect();
  return {
    url: location.href, app,
    unique: { host: document.querySelectorAll('[data-testid="file-tree-container"]').length, input: host?.querySelectorAll('input[type="search"][data-testid="diff-tree-search"]').length ?? 0, nav: host?.querySelectorAll('nav.mr-tree-list[aria-label="File tree"]').length ?? 0, roots: roots.length },
    search: input == null ? null : { attributes: ['type', 'id', 'data-testid', 'aria-label', 'placeholder'].map((name) => [name, input.getAttribute(name)]), value: input.value, label: input.getAttribute('aria-label'), visible: visible(input), focused: document.activeElement === input },
    native: { rows: nativeRows.map((row) => row.info), paths: included.map((row) => row.info.path), domCount: nativeRows.length, excludedCount: nativeRows.length - included.length, domTargetCount: nativeRows.filter((row) => row.info.target).length, resultCount: targets.length, visible: targets.length === 1 && targets[0].info.painted, href: original[0]?.href ?? null, anchor: original[0]?.getAttribute('data-file-row') ?? null, ariaCurrent: original[0]?.getAttribute('aria-current') ?? null, className: original[0]?.className ?? null, listMarker: nav?.getAttribute('data-geld-provider-category-body') ?? null, model: { navClass: nav?.className ?? null, treeViewSelected: host?.querySelector('[data-testid="tree-view-toggle"]')?.getAttribute('aria-current') ?? null, clearButtons: [...searchBox?.querySelectorAll('.gl-search-box-by-type-clear') ?? []].map((button) => ({ tag: button.tagName, title: button.getAttribute('title'), disabled: button.disabled, rendered: visible(button) })) } },
    owned: { count: host?.querySelectorAll('.geld-provider-categories').length ?? 0, active: section?.getAttribute('data-active') ?? null, current: control?.getAttribute('aria-current') ?? null, folder: folder == null ? null : { label: folder.querySelector('.geld-provider-category-folder-label')?.textContent ?? null, expanded: folder.getAttribute('aria-expanded') }, headers: [...host?.querySelectorAll('.geld-provider-category-header') ?? []].map((button) => ({ text: button.textContent, expanded: button.getAttribute('aria-expanded') })) },
    source: { id: root?.id ?? null, raw: root?.getAttribute('data-file-data') ?? null, path: data?.new_path ?? null, head: data?.diff_refs?.head_sha ?? null, review: data?.code_review_id ?? null, visible: visible(root), open: details?.open ?? false, codeLines: details?.querySelectorAll('.rd-line-text').length ?? 0, codeVisible: visible(code), codeInViewport: rect != null && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth, boxes: boxes.map((box) => ({ id: box.id, checked: box.checked, disabled: box.disabled, attributes: [...box.attributes].map((attr) => [attr.name, attr.value]) })) },
    identity: proof == null ? null : { input: input === proof.input && input?.parentElement === proof.inputParent, host: host === proof.host && host?.parentElement === proof.hostParent, nav: nav === proof.nav && nav?.parentElement === proof.navParent, root: root === proof.root && root?.parentElement === proof.rootParent, boxes: boxes.length === proof.boxes.length && boxes.every((box, index) => box === proof.boxes[index]) },
    events: proof?.events ?? [],
  };
}

export function bindGitLabFileSearchProof(fixture) {
  const host = document.querySelector('[data-testid="file-tree-container"]');const input = host.querySelector('input[type="search"][data-testid="diff-tree-search"]');const nav = host.querySelector('nav.mr-tree-list[aria-label="File tree"]');const root = document.getElementById(fixture.anchor);
  const proof = { input, inputParent: input.parentElement, host, hostParent: host.parentElement, nav, navParent: nav.parentElement, root, rootParent: root.parentElement, boxes: [...root.querySelectorAll('input[type="checkbox"]')], events: [] };
  proof.listen = (event) => {
    const target = event.target instanceof Element ? event.target : null;const native = target?.closest('a[data-testid="file-row"][data-file-row]');
    const owned = target?.closest('[data-geld-category-path]');
    if (target === input || native !== null && native !== undefined && native.closest('[data-geld-ui]') === null || owned !== null && owned !== undefined) {
      const observation = { type: event.type, trusted: event.isTrusted, input: target === input, native: native?.closest('[data-geld-ui]') === null ? native.getAttribute('data-file-row') : null, nativeHref: native?.closest('[data-geld-ui]') === null ? native.href : null, owned: owned?.getAttribute('data-geld-category-path') ?? null, key: event instanceof KeyboardEvent ? event.key : null, value: target === input ? input.value : null, cancelable: event.cancelable, defaultPrevented: event.defaultPrevented, defaultPreventedFinal: null };
      proof.events.push(observation);queueMicrotask(() => { observation.defaultPreventedFinal = event.defaultPrevented; });
    }
  };
  for (const type of ['click', 'focusin', 'focusout', 'input', 'keydown']) document.addEventListener(type, proof.listen, true);
  globalThis.__geldFileSearchProof = proof;
}

export function gitLabFileSearchSelection(snapshot, fixture = GITLAB_FILE_SEARCH) {
  const app = snapshot.app;
  const expected = new URL(fixture.url);
  const mrPath = expected.pathname.replace(/\/diffs$/, '');
  assert.equal(app?.path, mrPath, 'Native versions belong to another MR');
  const id = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null;
  assert.equal(id(app?.iid), mrPath.split('/').at(-1));
  const selected = (versions, kind) => {
    assert.ok(Array.isArray(versions) && versions.length > 0, `Missing native ${kind} versions`);
    const seen = new Set();
    for (const version of versions) {
      assert.ok(version !== null && typeof version === 'object' && !Array.isArray(version) && id(version.id) !== null && typeof version.selected === 'boolean', `Malformed native ${kind} version`);
      assert.equal(seen.has(id(version.id)), false, `Duplicate native ${kind} version ID`);seen.add(id(version.id));
      assert.equal(typeof version.is_merge_head, 'boolean', `Malformed native ${kind} kind`);
      if (kind === 'source' || version.head_sha !== undefined) assert.match(version.head_sha ?? '', /^[0-9a-f]{40}$/, `Malformed native ${kind} head`);
    }
    const chosen = versions.filter((version) => version.selected);
    assert.equal(chosen.length, 1, `Ambiguous native selected ${kind} version`);
    const version = chosen[0];assert.match(version.head_sha ?? '', /^[0-9a-f]{40}$/, `Missing native selected ${kind} head`);
    const link = new URL(version.href, expected.origin);
    assert.equal(link.username, '');assert.equal(link.password, '');assert.equal(link.hash, '');
    assert.equal(link.origin, expected.origin);assert.equal(link.pathname, expected.pathname);
    if (link.searchParams.has('diff_id')) assert.equal(link.searchParams.get('diff_id'), fixture.version);
    return version;
  };
  const source = selected(app.sourceVersions, 'source');const target = selected(app.targetVersions, 'target');
  for (const version of app.targetVersions) {
    const matching = app.sourceVersions.find((candidate) => id(candidate.id) === id(version.id));
    if (matching !== undefined) {
      assert.equal(version.is_merge_head, matching.is_merge_head, 'One native version ID has conflicting source and target kinds');
      if (version.head_sha !== undefined) assert.equal(version.head_sha, matching.head_sha, 'One native version ID has conflicting source and target heads');
    }
  }
  assert.equal(id(source.id), fixture.version, 'Pinned source version changed');
  assert.equal(source.head_sha, fixture.head, 'Pinned source head changed');
  assert.equal(source.is_merge_head, false, 'Pinned source is not a native source revision');
  assert.equal(new URL(source.href, expected.origin).searchParams.get('diff_id'), fixture.version, 'Native source link does not pin the selected revision');
  assert.equal(typeof target.is_merge_head, 'boolean', 'Unknown native target kind');
  if (id(target.id) === id(source.id)) assert.equal(target.head_sha, source.head_sha, 'One native version ID has conflicting source and target heads');
  else assert.equal(target.is_merge_head, true, 'Unexpected native target revision for the pinned source');
  return { source, target };
}

export function assertGitLabFileSearchScope(snapshot, fixture = GITLAB_FILE_SEARCH) {
  const url = new URL(snapshot.url);const expected = new URL(fixture.url);
  assert.equal(url.origin, expected.origin, 'Native search left the original provider');
  assert.equal(url.pathname, expected.pathname, 'Native search left the original MR diff');
  assert.equal(url.searchParams.get('diff_id'), fixture.version, 'Native search changed selected revision');
  assert.deepEqual(snapshot.unique, { host: 1, input: 1, nav: 1, roots: 1 }, 'Search needs unique original native surfaces');
  assert.equal(snapshot.source.id, fixture.anchor);
  assert.equal(snapshot.source.path, fixture.path);
  const selection = gitLabFileSearchSelection(snapshot, fixture);
  assert.equal(snapshot.source.head, selection.target.head_sha, 'Rendered native file head conflicts with selected target version');
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
  };
  const click = async (selector) => {
    await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const target = await page.$eval(selector, (node, selector) => { const rect = node.getBoundingClientRect();return { unique: document.querySelectorAll(selector).length, unobstructed: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }; }, selector);
    assert.equal(target.unique, 1, 'Native search action target is ambiguous');assert.equal(target.unobstructed, true, 'Native search action target is obstructed');
    await page.click(selector);
  };
  const clickNativeResult = async () => {
    const handle = await page.evaluateHandle(gitLabFileSearchSnapshot, fixture, 'target');
    try {
      const target = handle.asElement();assert.ok(target !== null, 'Native search needs one included original target');
      await target.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      progress.nativeClick = { before: await read() };unchanged(progress.nativeClick.before, progress.before);
      assert.deepEqual(progress.nativeClick.before.native.paths, [fixture.path]);assert.equal(progress.nativeClick.before.native.resultCount, 1);
      progress.nativeClick.node = await target.evaluate((node) => {
        const rect = node.getBoundingClientRect();const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { connected: node.isConnected && node.ownerDocument === document, original: node.closest('[data-geld-ui]') === null, href: node.href, anchor: node.getAttribute('data-file-row'), rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height }, inViewport: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth, unobstructed: hit !== null && node.contains(hit) };
      });
      const node = progress.nativeClick.node;
      assert.equal(node.connected, true);assert.equal(node.original, true);assert.equal(node.inViewport, true);assert.equal(node.unobstructed, true);
      assert.equal(node.anchor, fixture.anchor);assert.equal(node.href, progress.nativeClick.before.native.href);
      assert.equal(progress.nativeClick.before.native.visible, true, 'Included native target is clipped or hidden');
      await target.click();
    } finally { await handle.dispose(); }
  };
  const unchanged = (value, baseline) => {
    assertGitLabFileSearchScope(value);
    if (bound) assert.notEqual(value.identity, null, 'Native search proof was lost during the interaction');
    assert.deepEqual(gitLabFileSearchSelection(value), gitLabFileSearchSelection(baseline), 'Native selected source or target changed during file search');
    assert.equal(value.source.raw, baseline.source.raw, 'Native immutable file payload changed');
    assert.deepEqual(value.source.boxes, baseline.source.boxes, 'Native checkbox state or attributes changed');
    assert.deepEqual(value.search.attributes, baseline.search.attributes, 'Original native search semantics changed');
  };
  const sameScope = (value) => {
    const current = new URL(value.url);const expected = new URL(fixture.url);
    return current.origin === expected.origin && current.pathname === expected.pathname && current.searchParams.get('diff_id') === fixture.version;
  };
  const recovered = (value) => value.search?.value === '' && value.owned.count === 1 && value.owned.active === 'true' && value.owned.folder?.expanded === 'false' && value.owned.current === 'true' && value.native.listMarker === 'native' && value.source.open && value.source.codeVisible;
  const clear = async (phase) => {
    const record = { status: 'pending', before: await read() };progress[phase] = record;
    unchanged(record.before, progress.before);
    const offset = record.before.events.length;
    await click(selectors.input);await page.keyboard.down('Control');try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }await page.keyboard.press('Backspace');
    record.after = await poll(read, (value) => value.search?.value === '', 'Real keyboard clears the original native search');
    unchanged(record.after, progress.before);
    record.events = record.after.events.slice(offset);
    assert.ok(record.events.some((event) => event.type === 'keydown' && event.input && event.trusted && event.key === 'Backspace'), 'Native clear needs a trusted Backspace event');
    assert.ok(record.events.some((event) => event.type === 'input' && event.input && event.trusted && event.value === ''), 'Native clear needs a trusted empty-value input event');
    record.status = 'verified';
    return record.after;
  };
  let bound = false;
  let typed = false;
  let failure;
  try {
    progress.before = await read();assertGitLabFileSearchScope(progress.before);
    assert.equal(progress.before.search.value, '', 'Native search must start empty');
    await page.click(selectors.header);
    await page.keyboard.press('End');await page.keyboard.press('Enter');
    progress.tests = await poll(read, (value) => value.owned.active === 'true' && value.source.visible && value.owned.headers.some((header) => /^Tests\s*\(1 test\)/.test(header.text) && header.expanded === 'true'), 'Native search begins with Tests selected');
    await page.evaluate(bindGitLabFileSearchProof, fixture);
    bound = true;
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
    typed = true;await page.keyboard.type(fixture.query);
    progress.search = await poll(async () => {
      const value = await read();progress.searchLatest = value;
      unchanged(value, progress.before);
      if (value.native.paths.length !== 1 || value.native.paths[0] !== fixture.path) progress.searchPending ??= value;
      return value;
    }, (value) => value.search?.value === fixture.query && value.owned.count === 0 && value.native.listMarker === null && value.native.resultCount === 1 && value.native.visible && value.native.paths.length === 1 && value.native.paths[0] === fixture.path, 'Original native search settles to the exact unique file result while the owned accordion is suspended');
    unchanged(progress.search, progress.before);
    assert.deepEqual(progress.search.native.paths, [fixture.path], 'Native filename search left unrelated original file results');
    assert.ok(progress.search.events.some((event) => event.type === 'input' && event.input && event.trusted), 'Typing must produce a trusted native input event');
    progress.searchArtifacts = await capture(page, 'gitlab-file-search-native-results');
    await clickNativeResult();
    progress.activated = await poll(read, (value) => new URL(value.url).hash === `#${fixture.anchor}` && new URL(value.url).searchParams.get('file_path') === fixture.path && value.source.open && value.source.codeVisible && value.source.codeInViewport, 'Real native search result selects and reveals the exact immutable file');
    unchanged(progress.activated, progress.before);
    assert.ok(progress.activated.events.some((event) => event.type === 'click' && event.native === fixture.anchor && event.nativeHref === progress.nativeClick.node.href && event.trusted), 'Native result activation needs an original trusted click');
    await clear('clear');
    progress.restored = await poll(read, recovered, 'Clearing native search restores Tests, custom folder collapse and current file');
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
  } catch (error) {
    failure = error;
    if (bound && !page.isClosed()) {
      try {
        progress.failureBeforeCleanup = await read();
        if (sameScope(progress.failureBeforeCleanup)) progress.failureArtifacts = await capture(page, 'gitlab-file-search-before-cleanup');
      } catch (diagnosticError) { progress.failureDiagnosticError = String(diagnosticError); }
    }
    throw error;
  }
  finally {
    const errors = [];
    progress.cleanup = { status: 'pending' };
    if (page.isClosed()) progress.cleanup.status = 'page_closed';
    else {
      try {
        const current = await read();progress.cleanup.before = current;
        if (!sameScope(current)) progress.cleanup.status = 'skipped_changed_scope';
        else if (current.search?.value && !typed) progress.cleanup.status = 'skipped_unowned_query';
        else {
          if (current.search?.value) await clear('cleanupClear');
          const after = bound && progress.collapsed !== undefined ? await poll(read, recovered, 'Native search finally cleanup preserves custom category preferences') : await read();
          progress.cleanup.after = after;
          assert.equal(after.search?.value, '', 'Native query remains after cleanup');
          if (bound) { assert.notEqual(after.identity, null, 'Native search proof was lost before cleanup');unchanged(after, progress.before); }
          progress.cleanup.status = 'verified';
        }
      } catch (error) { errors.push(error);progress.cleanup.status = 'failed';progress.cleanupError = String(error); }
      try {
        progress.cleanup.listeners = await page.evaluate(() => {
          const proof = globalThis.__geldFileSearchProof;
          const types = ['click', 'focusin', 'focusout', 'input', 'keydown'];
          if (proof !== undefined) for (const type of types) document.removeEventListener(type, proof.listen, true);
          delete globalThis.__geldFileSearchProof;
          return { hadProof: proof !== undefined, removedTypes: proof === undefined ? [] : types, proofAbsent: !Object.hasOwn(globalThis, '__geldFileSearchProof') };
        });
        assert.equal(progress.cleanup.listeners.proofAbsent, true, 'Native search instrumentation remains after cleanup');
      } catch (error) { errors.push(error);progress.cleanup.status = 'failed';progress.cleanupError = String(error); }
    }
    if (errors.length > 0) throw new AggregateError(failure === undefined ? errors : [failure, ...errors], 'Native file-search cleanup failed');
  }
}
