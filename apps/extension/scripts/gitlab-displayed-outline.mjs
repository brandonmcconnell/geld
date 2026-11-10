import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export const GITLAB_DISPLAYED_OUTLINE = {
  path: 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb',
  declarations: [
    { line: 103, title: 'when the list IDs are not lists on the board', additions: 10 },
    { line: 134, title: 'when the list IDs are not lists on the board', additions: 9 },
    { line: 143, title: 'when the user can update the issue but cannot move it', additions: 13 },
  ],
};

/** Retain original native identities and observe real input without changing source or provider state. */
export function gitLabDisplayedOutlineProbe(action = 'read', target = null) {
  const KEY = '__geldGitLabDisplayedOutline';let store = globalThis[KEY];
  if (action === 'cleanup') { store?.cleanup();delete globalThis[KEY];return null; }
  const path = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
  const view = document.defaultView;
  const metric = (value) => Number.isFinite(value) ? value : null;
  const bounds = (rect) => Object.fromEntries(['left', 'right', 'top', 'bottom', 'width', 'height'].map((key) => [key, metric(rect[key])]));
  const safeAttribute = (node, name) => { const value = node.getAttribute(name);return value !== null && /^[a-zA-Z0-9_!@:/ .-]{1,128}$/.test(value) ? value : null; };
  const inspectChain = (start, button) => {
    const nodes = [];let node = start;
    while (node instanceof Element && nodes.length < 8) {
      const style = getComputedStyle(node);const classes = [...node.classList];
      nodes.push({ tag: node.tagName.toLowerCase(), id: safeAttribute(node, 'id'), classes: classes.filter((name) => /^[a-zA-Z0-9_!@:/.-]{1,96}$/.test(name)).slice(0, 16), classesTruncated: classes.length > 16,
        testid: safeAttribute(node, 'data-testid'), qa: safeAttribute(node, 'data-qa'), role: safeAttribute(node, 'role'),
        owned: node.hasAttribute('data-geld-ui'), ownedAncestor: node.closest('[data-geld-ui]') !== null, isButton: node === button, containsButton: node.contains(button),
        style: Object.fromEntries(['position', 'zIndex', 'pointerEvents', 'display', 'visibility', 'overflowX', 'overflowY', 'clipPath', 'contain', 'contentVisibility', 'containIntrinsicSize', 'transform', 'scrollMarginTop', 'scrollPaddingTop'].map((key) => [key, typeof style[key] === 'string' ? style[key].slice(0, 256) : null])),
        bounds: bounds(node.getBoundingClientRect()), scroll: Object.fromEntries(['scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth', 'clientHeight', 'clientWidth'].map((key) => [key, metric(node[key])])) });
      node = node.parentElement;
    }
    return { nodes, truncated: node instanceof Element, maxNodes: 8 };
  };

  const url = new URL(location.href);
  if (url.origin !== 'https://gitlab.com' || url.pathname !== '/gitlab-org/gitlab/-/merge_requests/266334/diffs' || url.search !== '?diff_id=2158520123' || url.username || url.password) return null;
  const native = (node) => node !== null && node.closest('[data-geld-ui]') === null;
  const files = [...document.querySelectorAll('diff-file[data-file-data]')].filter((node) => { try { return native(node) && JSON.parse(node.getAttribute('data-file-data')).new_path === path; } catch { return false; } });
  if (files.length !== 1) return null;
  const root = files[0];
  const attrs = (node) => [...node.attributes].filter((a) => a.name !== 'data-geld-provider-line-hidden').map((a) => [a.name, a.value]);
  const rows = [...root.querySelectorAll('tr.rd-hunk-lines-inline,tr.rd-hunk-lines-parallel')].filter(native);
  if (rows.length === 0 || rows.length > 500) return null;
  let textCount = 0;
  const reading = rows.map((row) => {
    const cells = [...row.querySelectorAll('td.rd-line-content')];const nodes = [];
    for (const cell of cells) { const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);for (let node = walk.nextNode(); node !== null; node = walk.nextNode()) { nodes.push(node);textCount++; } }
    const nextCell = row.classList.contains('rd-hunk-lines-parallel') ? row.querySelector('.rd-line-content[data-position="new"]') : cells[0];
    return { row, parent: row.parentElement, html: row.innerHTML, attributes: attrs(row), cells, nodes, texts: nodes.map((node) => node.data), newText: nextCell?.textContent ?? null,
      old: row.querySelector('.rd-line-number[data-position="old"] a[data-line-number]')?.getAttribute('data-line-number') ?? null,
      next: row.querySelector('.rd-line-number[data-position="new"] a[data-line-number]')?.getAttribute('data-line-number') ?? null,
      code: cells.map((cell) => cell.textContent), ids: [...row.querySelectorAll('[id]')].map((node) => [node, node.id]), links: [...row.querySelectorAll('a[href]')].map((node) => [node, node.getAttribute('href')]) };
  });
  if (textCount > 10000) return null;
  const controls = [...root.querySelectorAll('tr.rd-hunk-header button[data-click="expandLines"][data-expand-direction]')].filter((node) => native(node) && ['up', 'down', 'both'].includes(node.dataset.expandDirection));
  const viewed = [...root.querySelectorAll('input[data-viewed-checkbox], [data-testid="fileReviewCheckbox"] input[type="checkbox"]')].filter(native);
  const nativeHunks = [...root.querySelectorAll('tr.rd-hunk-header[data-hunk-header]')].filter(native);
  const headers = [...document.querySelectorAll('.geld-provider-category-header')];
  // A header runs its count straight after the label ("Tests1"), so its words are the label's.
  const labelOf = (node) => (node.querySelector('.geld-provider-category-label') ?? node).textContent.trim();
  if (action === 'setup') {
    if (store) throw Error('Displayed source observation already exists');
    store = { url: location.href, root, parent: root.parentElement, data: root.getAttribute('data-file-data'), reading, controls: controls.map((node) => ({ node, parent: node.parentElement, html: node.outerHTML })), nativeHunks: nativeHunks.map((node) => ({ node, parent: node.parentElement, html: node.outerHTML })), viewed: viewed.map((node) => ({ node, checked: node.checked, disabled: node.disabled })), events: [], expected: null };
    store.listen = (event) => {
      if (!(event.target instanceof Element)) return;
      if (store.controls.some(({ node }) => node.contains(event.target))) store.events.push({ kind: 'native_context', type: event.type, trusted: event.isTrusted === true });
      if (store.viewed.some(({ node }) => node === event.target)) store.events.push({ kind: 'native_viewed', type: event.type, trusted: event.isTrusted === true });
      if (event.type === 'click' && store.expected?.contains(event.target)) store.lastClick = { trusted: event.isTrusted === true, label: store.expected.getAttribute('aria-label') ?? store.expected.textContent, expanded: store.expected.getAttribute('aria-expanded'), url: location.href };
    };
    for (const type of ['click', 'input', 'change']) document.addEventListener(type, store.listen, true);
    store.cleanup = () => { for (const type of ['click', 'input', 'change']) document.removeEventListener(type, store.listen, true); };
    globalThis[KEY] = store;
  }
  if (!store) return null;
  const rowSame = (row, index) => {
    const old = store.reading[index];return row.row === old.row && row.parent === old.parent && row.html === old.html && JSON.stringify(row.attributes) === JSON.stringify(old.attributes) && row.old === old.old && row.next === old.next
      && row.cells.length === old.cells.length && row.cells.every((node, at) => node === old.cells[at]) && row.nodes.length === old.nodes.length && row.nodes.every((node, at) => node === old.nodes[at] && node.data === old.texts[at])
      && JSON.stringify(row.code) === JSON.stringify(old.code) && row.ids.length === old.ids.length && row.ids.every(([node, id], at) => node === old.ids[at][0] && id === old.ids[at][1]) && row.links.length === old.links.length && row.links.every(([node, href], at) => node === old.links[at][0] && href === old.links[at][1]);
  };
  // Which identity broke, so a refused arm says why rather than "false == true".
  const sameParts = {
    url: location.href === store.url, root: root === store.root, parent: root.parentElement === store.parent, data: root.getAttribute('data-file-data') === store.data,
    rows: reading.length === store.reading.length && reading.every(rowSame),
    controls: controls.length === store.controls.length && controls.every((node, index) => node === store.controls[index].node && node.parentElement === store.controls[index].parent && node.outerHTML === store.controls[index].html),
    hunks: nativeHunks.length === store.nativeHunks.length && nativeHunks.every((node, index) => node === store.nativeHunks[index].node && node.parentElement === store.nativeHunks[index].parent && node.outerHTML === store.nativeHunks[index].html),
    viewed: viewed.length === store.viewed.length && viewed.every((node, index) => node === store.viewed[index].node && node.checked === store.viewed[index].checked && node.disabled === store.viewed[index].disabled),
  };
  const same = Object.values(sameParts).every(Boolean);
  if (action === 'category-button') {
    if (!same || !['Essential', 'Tests'].includes(target)) return null;
    const matches = headers.filter((node) => labelOf(node) === target);return matches.length === 1 ? matches[0] : null;
  }
  const folds = [...root.querySelectorAll('[data-geld-provider-fold-row^="test:"]')].map((row) => {
    const button = row.querySelector('button');const next = row.nextElementSibling;const source = reading.find((line) => line.row === next);
    const body = row.parentElement;const table = body?.parentElement;const cell = button?.parentElement;
    const hunks = body ? [...body.children].filter((node) => native(node) && node.matches('tr.rd-hunk-header[data-hunk-header]')) : [];
    const nativeSpan = body?.matches('tbody.rd-text-view-content') && table?.matches('table.rd-text-view-root') && cell?.matches('td.geld-provider-line-fold__cell[data-geld-ui]')
      ? { sourceBound: source !== undefined && source.parent === body && root.contains(table) && native(body) && native(table) && hunks.length === 1,
        table: { bounds: bounds(table.getBoundingClientRect()), display: getComputedStyle(table).display }, body: { bounds: bounds(body.getBoundingClientRect()), display: getComputedStyle(body).display },
        row: { bounds: bounds(row.getBoundingClientRect()), display: getComputedStyle(row).display },
        cell: { bounds: bounds(cell.getBoundingClientRect()), display: getComputedStyle(cell).display,
          clientLeft: metric(cell.clientLeft), clientWidth: metric(cell.clientWidth),
          style: Object.fromEntries(['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight', 'boxSizing'].map((key) => [key, getComputedStyle(cell)[key]])) },
        hunk: hunks.length === 1 ? { bounds: bounds(hunks[0].getBoundingClientRect()), display: getComputedStyle(hunks[0]).display } : null } : null;
    const rect = button?.getBoundingClientRect();const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
    const control = rect ? { bounds: bounds(rect), nativeSpan, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, inViewport: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= (view?.innerWidth ?? 0) && rect.bottom <= (view?.innerHeight ?? 0), unobscured: hit !== null && button.contains(hit), hitChain: inspectChain(hit, button), buttonChain: inspectChain(button, button) } : null;
    return { row, button, source, control, text: row.textContent, kind: row.dataset.kind, status: row.dataset.status, label: button?.getAttribute('aria-label') ?? '', title: row.querySelector('.geld-provider-line-fold__title')?.textContent ?? '', expanded: button?.getAttribute('aria-expanded') ?? null };
  });
  if (action === 'fold-button') return same ? folds.find((fold) => Number(fold.source?.next) === target)?.button ?? null : null;
  if (action === 'fold-button-current') return same && folds.some((fold) => fold.button === target && fold.source?.next === '103' && fold.row.parentElement === fold.source.parent);
  if (action === 'arm') {
    if (!same) return `changed:${Object.entries(sameParts).filter(([, value]) => !value).map(([key]) => key).join(',')}`;
    if (!(target instanceof HTMLButtonElement) || !headers.includes(target) && !folds.some((fold) => fold.button === target)) return 'not-a-control';
    store.expected = target;store.lastClick = null;return true;
  }
  if (action === 'click-result') return store.lastClick ?? null;
  const rectangle = root.getBoundingClientRect();
  return { url: location.href, path, sameSource: same, sourceHead: { value: null, basis: 'No authoritative source head is read by this bounded displayed-source phase. URL and original native identities/text are retained.' },
    sourceRows: reading.map((row) => ({ old: row.old, next: row.next, code: row.code, newText: row.newText, hidden: row.row.hasAttribute('data-geld-provider-line-hidden') })),
    controls: controls.map((node) => ({ direction: node.dataset.expandDirection, label: node.getAttribute('aria-label') })), viewed: viewed.map((node) => ({ checked: node.checked, disabled: node.disabled })), events: [...store.events],
    headers: headers.map((node) => ({ text: labelOf(node), expanded: node.getAttribute('aria-expanded') })),
    visible: getComputedStyle(root).display !== 'none' && rectangle.width > 0 && rectangle.height > 0,
    viewport: { width: metric(view?.innerWidth), height: metric(view?.innerHeight), scrollX: metric(view?.scrollX), scrollY: metric(view?.scrollY), documentScroll: document.scrollingElement == null ? null : Object.fromEntries(['scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth', 'clientHeight', 'clientWidth'].map((key) => [key, metric(document.scrollingElement?.[key])])) },
    folds: folds.map(({ source, ...fold }) => ({ text: fold.text, kind: fold.kind, status: fold.status, label: fold.label, title: fold.title, expanded: fold.expanded, control: fold.control, sourceLine: source?.next ?? null })) };
}

export function assertDisplayedOutlineCounts(before, after) {
  for (const state of [before.runtime, after.runtime]) {
    assert.equal(state.hasDiff, true);assert.equal(state.onDiffPage, true);assert.equal(state.repository?.provider, 'gitlab');assert.equal(state.repository?.origin, 'https://gitlab.com');assert.equal(state.repository?.path, 'gitlab-org/gitlab');
    assert.deepEqual(state.all, { files: 3, additions: 36, deletions: 0 });assert.deepEqual(state.visible, { files: 2, additions: 4, deletions: 0 });assert.equal(state.hiddenCount, 1);
  }
  for (const sample of [before, after]) {
    assert.ok(sample.native.headers.some((row) => row.files === 2 && row.additions === 4 && row.deletions === 0), 'Missing independently presented native corrected header counts');
    assert.deepEqual(sample.runtime.categories?.find((category) => category.id === 'tests')?.paths, [GITLAB_DISPLAYED_OUTLINE.path], 'The hidden category must bind the exact native test source');
  }
  assert.deepEqual(after.native.headers, before.native.headers, 'Displayed test outlines must not change native corrected header counts');
}

export function assertDisplayedOutlineRows(sample) {
  assert.equal(sample.sameSource, true);assert.equal(sample.visible, true);assert.deepEqual(sample.events, []);
  assert.equal(sample.controls.length, 3);assert.equal(sample.folds.length, 3);
  for (const [index, expected] of GITLAB_DISPLAYED_OUTLINE.declarations.entries()) {
    const fold = sample.folds[index];assert.equal(fold.title, expected.title);assert.equal(fold.sourceLine, String(expected.line));assert.equal(fold.kind, 'suite');assert.equal(fold.status, 'added');
    assert.match(fold.label, new RegExp(`from line ${expected.line}\\b`));assert.match(fold.label, new RegExp(`\\+${expected.additions}\\b`));
  }
}

export function assertDisplayedOutlineControl(sample) {
  const control = sample.folds.find((fold) => fold.sourceLine === '103')?.control;
  assert.equal(control?.inViewport, true, 'The actual first outline control must be visible in the viewport');
  assert.equal(control?.unobscured, true, 'The actual outline control is covered at its click point.');
  for (const fold of sample.folds) {
    const span = fold.control?.nativeSpan;
    assert.equal(span?.sourceBound, true, 'Outline width must bind to the original native Rapid body and hunk.');
    assert.equal(span.table.display, 'block');assert.equal(span.body.display, 'block');assert.equal(span.row.display, 'block');assert.equal(span.cell.display, 'block');
    for (const rect of [span.body.bounds, span.row.bounds, span.cell.bounds, span.hunk?.bounds]) {
      for (const key of ['left', 'right', 'width']) assert.ok(Number.isFinite(rect?.[key]), 'Outline width geometry must be finite.');
      assert.ok(rect.width > 0, 'Outline width must be positive.');
      assert.ok(Math.abs(rect.right - rect.left - rect.width) <= 1, 'Outline width geometry must be internally consistent.');
      for (const key of ['left', 'right', 'width']) assert.ok(Math.abs(rect[key] - span.body.bounds[key]) <= 1, 'Outline row and cell border boxes must fill the actual native Rapid hunk/body span.');
    }
    const px = (value) => typeof value === 'string' && /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : NaN;
    const leftBorder = px(span.cell.style?.borderLeftWidth), rightBorder = px(span.cell.style?.borderRightWidth);
    const leftPadding = px(span.cell.style?.paddingLeft), rightPadding = px(span.cell.style?.paddingRight);
    for (const value of [span.cell.clientLeft, span.cell.clientWidth, leftBorder, rightBorder, leftPadding, rightPadding]) assert.ok(Number.isFinite(value) && value >= 0, 'Actual cell client/border/padding metrics must be finite and nonnegative.');
    assert.ok(Math.abs(span.cell.clientLeft - leftBorder) <= 1, 'Cell client edge must agree with its actual border.');
    assert.ok(Math.abs(span.cell.bounds.width - span.cell.clientWidth - leftBorder - rightBorder) <= 1, 'Cell border box must agree with its measured client width and borders.');
    const content = { left: span.cell.bounds.left + span.cell.clientLeft + leftPadding, width: span.cell.clientWidth - leftPadding - rightPadding };
    content.right = content.left + content.width;assert.ok(content.width > 0);
    const button = fold.control.bounds;
    for (const key of ['left', 'right', 'width']) assert.ok(Number.isFinite(button?.[key]) && Math.abs(button[key] - content[key]) <= 1, 'Outline button must fill the actual cell content box within one CSS pixel.');
    assert.ok(Math.abs(button.right - button.left - button.width) <= 1, 'Button geometry must be internally consistent.');
  }
}

/** Require consecutive real-frame measurements; identity/count/settings guards never retry. */
export async function waitDisplayedOutlineControl(page, { read, validate, progress }) {
  progress.samples = [];let previous;let stable = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.evaluate(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Actual animation frames did not arrive for outline readiness.')), 1000);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer);resolve(); }));
    }));
    const sample = await read();progress.latest = sample;
    // These checks fail immediately, even if a later sample would recover.
    await validate(sample);
    let ready = true;let reason = null;
    try { assertDisplayedOutlineControl(sample); } catch (error) { ready = false;reason = error.message; }
    const signature = JSON.stringify(sample.folds.map((fold) => ({ sourceLine: fold.sourceLine, expanded: fold.expanded, control: { bounds: fold.control?.bounds, nativeSpan: fold.control?.nativeSpan, inViewport: fold.control?.inViewport, unobscured: fold.control?.unobscured } })));
    stable = ready ? signature === previous ? stable + 1 : 1 : 0;previous = signature;
    progress.samples.push({ attempt, ready, reason, stable, sample });if (progress.samples.length > 8) progress.samples.shift();
    if (stable >= 2) { progress.attempts = attempt + 1;return sample; }
  }
  assertDisplayedOutlineControl(progress.latest);
  throw Error('Actual first outline native geometry did not settle across consecutive frame measurements.');
}

export async function verifyGitLabDisplayedOutline(page, { progress, poll, pollStable, capture, readSettings, writeSettings, readState, safeUrl, extensionId }) {
  progress.status = 'running';progress.scope = 'Displayed native test/suite rows only. No whole-file extent, hidden source acquisition, native expansion or inferred source head.';
  const original = structuredClone(await readSettings());assert.ok(original && typeof original === 'object' && original.testOutline === false);
  progress.settings = { originalTestOutline: { present: Object.hasOwn(original, 'testOutline'), value: original.testOutline }, restoration: 'pending' };
  const enabled = { ...original, testOutline: true };let prepared = false;let setup = false;let failure;
  const requests = [];
  const request = (value) => {
    let url;try { url = new URL(value.url()); } catch { return; }if (url.origin !== 'https://gitlab.com') return;
    const frames = [];let stack = value.initiator?.()?.stack;for (let level = 0; stack && level < 8; level++) { frames.push(...(stack.callFrames ?? []).map((frame) => frame.url));stack = stack.parent; }
    requests.push({ url: safeUrl(value.url()), method: value.method(), extensionInitiator: frames.some((frame) => frame.startsWith(`chrome-extension://${extensionId}/`)) });
  };
  const read = () => page.evaluate(gitLabDisplayedOutlineProbe);
  const click = async (action, target) => {
    const handle = await page.evaluateHandle(gitLabDisplayedOutlineProbe, action, target);
    try { const button = handle.asElement();assert.ok(button !== null);assert.equal(await page.evaluate(gitLabDisplayedOutlineProbe, 'arm', button), true);await button.click(); }
    finally { await handle.dispose(); }
    const event = await page.evaluate(gitLabDisplayedOutlineProbe, 'click-result');assert.equal(event?.trusted, true);return event;
  };
  try {
    progress.beforeCounts = await readState();assertDisplayedOutlineCounts(progress.beforeCounts, progress.beforeCounts);
    progress.initial = await page.evaluate(gitLabDisplayedOutlineProbe, 'setup');setup = progress.initial !== null;
    assert.equal(progress.initial?.sameSource, true);assert.equal(progress.initial.sourceRows.length, 44);assert.equal(progress.initial.controls.length, 3);assert.equal(progress.initial.folds.length, 0);
    assert.equal(progress.initial.headers.filter((row) => row.expanded === 'true').length, 1);assert.match(progress.initial.headers.find((row) => row.expanded === 'true').text, /^Essential\b/);
    page.on('request', request);
    progress.openCategoryInput = await click('category-button', 'Tests');
    progress.openCategory = await poll(read, (sample) => sample?.sameSource && sample.visible && sample.headers.filter((h) => h.expanded === 'true').length === 1 && sample.headers.some((h) => /^Tests\b/.test(h.text) && h.expanded === 'true'), 'Actual Tests category presents original displayed source', 8000);
    for (const declaration of GITLAB_DISPLAYED_OUTLINE.declarations) assert.ok(progress.openCategory.sourceRows.some((row) => Number(row.next) === declaration.line && row.newText?.trim() === `context '${declaration.title}' do`), 'Native declaration no longer matches retained source');
    prepared = true;await writeSettings(structuredClone(enabled));assert.ok(isDeepStrictEqual(await readSettings(), enabled), 'Only testOutline may change in real settings');
    progress.outlined = await pollStable(read, (sample) => { try { assertDisplayedOutlineRows(sample);return true; } catch { return false; } }, 'Actual displayed native outlines remain stable', 8000, (sample) => JSON.stringify(sample.folds));
    assertDisplayedOutlineRows(progress.outlined);progress.outlinedCounts = await readState();assertDisplayedOutlineCounts(progress.beforeCounts, progress.outlinedCounts);
    const visibleHandle = await page.evaluateHandle(gitLabDisplayedOutlineProbe, 'fold-button', 103);
    try {
      const button = visibleHandle.asElement();assert.ok(button !== null);await button.scrollIntoView();
      const validate = async (sample) => {
        assertDisplayedOutlineRows(sample);
        assert.equal(await page.evaluate(gitLabDisplayedOutlineProbe, 'fold-button-current', button), true, 'Original actual line 103 control was replaced.');
        assert.ok(isDeepStrictEqual(await readSettings(), enabled), 'Settings changed while awaiting actual outline readiness.');
        const state = await readState();assertDisplayedOutlineCounts(progress.beforeCounts, state);progress.readinessCounts = state;
      };
      progress.initialScrolled = await read();await validate(progress.initialScrolled);
      progress.initialArtifacts = await capture(page, 'gitlab-displayed-outline-initial', { fullPage: false });
      progress.initialAfterCapture = await read();await validate(progress.initialAfterCapture);
      progress.readiness = {};
      progress.beforeCapture = await waitDisplayedOutlineControl(page, { read, validate, progress: progress.readiness });
      progress.outlinedArtifacts = await capture(page, 'gitlab-displayed-outline', { fullPage: false });progress.afterCapture = await read();await validate(progress.afterCapture);
      assertDisplayedOutlineControl(progress.beforeCapture);assertDisplayedOutlineControl(progress.afterCapture);
      progress.beforeInput = await read();await validate(progress.beforeInput);assertDisplayedOutlineControl(progress.beforeInput);
      assert.equal(await page.evaluate(gitLabDisplayedOutlineProbe, 'arm', button), true);await button.click();
      progress.openFoldInput = await page.evaluate(gitLabDisplayedOutlineProbe, 'click-result');assert.equal(progress.openFoldInput?.trusted, true);
    } finally { await visibleHandle.dispose(); }
    progress.opened = await poll(read, (sample) => sample?.sameSource && sample.folds.find((fold) => fold.sourceLine === '103')?.expanded === 'true', 'Trusted Show opens currently mounted original suite rows', 8000);
    assertDisplayedOutlineRows(progress.opened);assert.equal(progress.opened.sourceRows.find((row) => row.next === '104')?.hidden, false);
    progress.openedArtifacts = await capture(page, 'gitlab-displayed-outline-open', { fullPage: false });progress.openedAfterCapture = await read();assertDisplayedOutlineRows(progress.openedAfterCapture);assertDisplayedOutlineControl(progress.openedAfterCapture);assert.equal(progress.openedAfterCapture.folds.find((fold) => fold.sourceLine === '103')?.expanded, 'true');
    progress.status = 'passed';
  } catch (error) { failure = error;progress.status = 'failed';progress.error = error.message; }
  finally {
    try {
      const currentSettings = await readSettings();
      if (prepared && isDeepStrictEqual(currentSettings, enabled)) await writeSettings(structuredClone(original));
      else assert.ok(isDeepStrictEqual(currentSettings, original), 'Settings changed during outline phase; do not overwrite them');
      assert.ok(isDeepStrictEqual(await readSettings(), original), 'Raw testOutline presence and unrelated settings must restore exactly');
      progress.settings.restoration = 'restored';
      if (setup && page.isClosed()) throw Error('Native page closed before displayed-outline restoration could be verified');
      if (setup && !page.isClosed()) {
        progress.restored = await poll(read, (sample) => sample?.sameSource && sample.folds.length === 0 && sample.sourceRows.every((row) => !row.hidden), 'Disabling displayed outlines restores original rows', 8000);
        if (!progress.restored.headers.some((row) => /^Essential\b/.test(row.text) && row.expanded === 'true')) progress.restoreCategoryInput = await click('category-button', 'Essential');
        progress.closed = await poll(read, (sample) => sample?.sameSource && !sample.visible && sample.headers.filter((h) => h.expanded === 'true').length === 1 && sample.headers.some((h) => /^Essential\b/.test(h.text) && h.expanded === 'true'), 'Original Essential category restored', 8000);
        assert.deepEqual(progress.closed.events, []);progress.afterCounts = await readState();assertDisplayedOutlineCounts(progress.beforeCounts, progress.afterCounts);
      }
    } catch (error) { failure = error;progress.status = 'failed';progress.cleanupError = error.message;if (progress.settings.restoration !== 'restored') progress.settings.restoration = 'failed'; }
    finally {
      page.off('request', request);progress.requests = requests;progress.limitations = ['No whole-file or full-test expansion acceptance. Native source head remains unknown in this phase.', 'Network initiator attribution is observational; an absent extension stack is not native-only proof.'];
      try { if (setup && !page.isClosed()) await page.evaluate(gitLabDisplayedOutlineProbe, 'cleanup'); }
      catch (error) { failure = error;progress.status = 'failed';progress.cleanupError = error.message;if (progress.settings.restoration !== 'restored') progress.settings.restoration = 'failed'; }
    }
  }
  try { assert.equal(requests.filter((r) => r.extensionInitiator).length, 0, 'Displayed outlining issued a new extension-origin GitLab read'); }
  catch (error) { failure = error;progress.status = 'failed';progress.error = error.message; }
  if (failure) throw failure;return progress;
}
