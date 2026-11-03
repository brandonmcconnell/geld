import assert from 'node:assert/strict';
import { codeRabbitRequestObservation } from './gitlab-coderabbit-acceptance.mjs';

export function tableHeightProbe(anchor) {
  const saved = globalThis.__geldTableHeightProof;
  if (!saved) return null;
  const panel = document.querySelector('.geld-provider-review');
  const note = document.getElementById(anchor);
  const owned = panel?.querySelector(`[data-geld-source="${anchor}"] .geld-provider-review__body > .note-text`);
  const rect = (node) => { const value = node?.getBoundingClientRect();return value ? { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width, height: value.height } : null; };
  const visible = (node) => {
    if (!node?.isConnected || !rect(node)?.width || !rect(node)?.height) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.inert || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
        || parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(node)) return false;
    }
    return true;
  };
  const hit = (node, bounds = rect(node)) => {
    if (!bounds) return null;
    const x = (bounds.left + bounds.right) / 2;const y = (bounds.top + bounds.bottom) / 2;
    let clipped = x < 0 || y < 0 || x >= innerWidth || y >= innerHeight;
    const clips = [];
    for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);const box = rect(parent);
      const clipX = ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX);const clipY = ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY);
      if (!box || !clipX && !clipY) continue;
      const clip = { left: box.left + parent.clientLeft, top: box.top + parent.clientTop, right: box.left + parent.clientLeft + parent.clientWidth, bottom: box.top + parent.clientTop + parent.clientHeight, clipX, clipY };clips.push(clip);
      if (clipX && (x < clip.left || x >= clip.right) || clipY && (y < clip.top || y >= clip.bottom)) clipped = true;
    }
    const top = document.elementFromPoint(x, y);const chain = [];for (let parent = top; parent && chain.length < 12; parent = parent.parentElement) chain.push({ tag: parent.tagName, id: parent.id, className: parent.className });
    return { x, y, clipped, clips, unobscured: !!top && !!node && (top === node || node.contains(top)), chain };
  };
  const summaries = saved.details.map((entry) => { const summary = entry.node.querySelector(':scope > summary');return { same: entry.node.isConnected && panel?.contains(entry.node) && (owned?.contains(entry.node) || entry.node.contains(owned)) && summary === entry.summary, open: entry.node.open, presented: visible(summary), hit: hit(summary), focused: document.activeElement === summary }; });
  const metrics = (scroll, table) => ({ className: scroll?.className, maxHeight: scroll ? getComputedStyle(scroll).maxHeight : null, overflowY: scroll ? getComputedStyle(scroll).overflowY : null,
    clientHeight: scroll?.clientHeight, scrollHeight: scroll?.scrollHeight, tableHeight: table?.offsetHeight, presented: visible(scroll) && visible(table), rect: rect(scroll) });
  const cells = (table) => [...(table?.querySelectorAll('tr') ?? [])].map((row) => [...row.cells].map((cell) => cell.textContent));
  const mappingErrors = [];
  const candidates = [...(note?.querySelectorAll('.note-body .note-text [data-sticky-header][id]') ?? [])].flatMap((native) => {
    if (!/^markdown-table-[1-9]\d*-scroll$/.test(native.id)) return [];
    const table = native.querySelector(':scope > table[data-markdown-table-applied="true"]');const content = cells(table);
    const matches = [...(owned?.querySelectorAll('[class~="gl-overflow-y-auto"]') ?? [])].filter((target) => JSON.stringify(cells(target.querySelector(':scope > table'))) === JSON.stringify(content));
    if (matches.length !== 1 || content.length < 2) { mappingErrors.push({ nativeId: native.id, matches: matches.length, nativeRows: content.length });return []; }
    const target = matches[0];const ownTable = target.querySelector(':scope > table');
    const nativeControls = [...note.querySelectorAll('button[data-testid="markdown-table-height-toggle"]')].filter((button) => button.getAttribute('aria-controls') === native.id);
    const buttons = [...owned.querySelectorAll('[data-geld-table-height] button[aria-controls]')].filter((button) => button.getAttribute('aria-controls') === target.id);
    const button = buttons.length === 1 ? buttons[0] : null;
    const lastRow = ownTable?.rows[ownTable.rows.length - 1];const lastCell = lastRow?.cells[lastRow.cells.length - 1];
    const walker = lastCell ? document.createTreeWalker(lastCell, NodeFilter.SHOW_TEXT) : null;let text;let textRect = null;
    while ((text = walker?.nextNode())) { if (!text.textContent.trim()) continue;const range = document.createRange();range.selectNodeContents(text);textRect = [...range.getClientRects()].find((value) => value.width > 0 && value.height > 0);if (textRect) break; }
    const scrollRect = rect(target);const scrollClip = scrollRect ? { left: scrollRect.left + target.clientLeft, top: scrollRect.top + target.clientTop, right: scrollRect.left + target.clientLeft + target.clientWidth, bottom: scrollRect.top + target.clientTop + target.clientHeight } : null;
    const lastBounds = rect(lastRow);const lastCellHit = hit(lastCell, textRect ?? rect(lastCell));
    return [{ nativeId: native.id, cells: content, native: metrics(native, table), owned: metrics(target, ownTable), nativeControls: nativeControls.map((node) => ({ label: node.textContent.trim(), expanded: node.getAttribute('aria-expanded'), controls: node.getAttribute('aria-controls') })),
      button: button ? { id: button.id, label: button.textContent, expanded: button.getAttribute('aria-expanded'), target: target.id, targetCount: document.querySelectorAll(`[id="${target.id}"]`).length, controlCount: document.querySelectorAll(`[id="${button.id}"]`).length, focused: document.activeElement === button, enabled: !button.disabled, presented: visible(button), rect: rect(button), hit: hit(button), same: !saved.button || saved.button === button } : null,
      scrollClip, lastRow: lastBounds, lastRowPresented: visible(lastRow), lastCellPresented: visible(lastCell), lastCellHit, sameTarget: saved.target ? target === saved.target && ownTable === saved.table && button === saved.button : null }];
  });
  return { head: panel?.dataset.geldReviewHead, sameSource: note === saved.note && note?.parentElement === saved.noteParent && note?.querySelector('.note-body .note-text') === saved.nativeBody,
    sameOwned: owned === saved.owned && owned?.parentElement === saved.ownedParent, nativeBody: saved.nativeBody?.outerHTML, ownedBody: owned?.outerHTML,
    preference: localStorage.getItem('markdown_table_expanded'), height: innerHeight, width: innerWidth, candidates, summaries, mappingErrors, events: saved.events ?? [], nativeEvents: saved.nativeEvents ?? [] };
}
export function actualTableOverflow(value, viewport) {
  const cap = value?.maxHeight?.endsWith('vh') ? Number.parseFloat(value.maxHeight) * viewport / 100 : Number.parseFloat(value?.maxHeight ?? '');
  return value?.presented === true && value.clientHeight > 0 && value.scrollHeight - value.clientHeight > 1 && value.tableHeight > viewport * 70 / 100
    && ['auto', 'scroll'].includes(value.overflowY) && Number.isFinite(cap) && Math.abs(cap - viewport * 70 / 100) <= 1;
}
export function assertTableHeightSource(value, before) {
  assert.ok(value && value.sameSource && value.sameOwned, 'Original table note/body ownership changed.');
  assert.equal(value.head, before.head);assert.equal(value.nativeBody, before.nativeBody);assert.equal(value.preference, before.preference);assert.deepEqual(value.nativeEvents, []);assert.deepEqual(value.mappingErrors, [], 'Native and owned table source rows must match unambiguously.');
}
export function assertTableHeightAction(value, before, nativeId, expanded) {
  assertTableHeightSource(value, before);
  const row = value.candidates.find((candidate) => candidate.nativeId === nativeId);const original = before.candidates.find((candidate) => candidate.nativeId === nativeId);
  assert.ok(row && original && row.sameTarget, 'Original owned table/control was replaced.');assert.deepEqual(row.cells, original.cells);const { rect: _currentPosition, ...currentNative } = row.native;const { rect: _originalPosition, ...originalNative } = original.native;assert.deepEqual(currentNative, originalNative);assert.deepEqual(row.nativeControls, original.nativeControls);
  assert.equal(row.button?.label, expanded ? 'Collapse table' : 'Show full table');assert.equal(row.button.expanded, String(expanded));assert.equal(row.button.targetCount, 1);assert.equal(row.button.controlCount, 1);assert.equal(row.button.focused, true);
  assert.equal(row.owned.className.split(/\s+/).includes('gl-max-h-[70vh]'), !expanded);
  if (expanded) {
    assert.equal(row.owned.maxHeight, 'none', 'Expanded table retains a computed height cap.');
    assert.ok(row.owned.presented && row.owned.clientHeight > 0 && row.owned.tableHeight > 0 && row.owned.scrollHeight > 0
      && row.owned.tableHeight <= row.owned.clientHeight + 2 && row.owned.scrollHeight <= row.owned.clientHeight + 2, 'Expanded owned table remains vertically clipped.');
  } else assert.ok(actualTableOverflow(row.owned, value.height), 'Collapsed table no longer has its proven measured cap/overflow.');
  return row;
}

export function assertTableHeightInput(value, before, nativeId, { keyboard = false, summary } = {}) {
  assertTableHeightSource(value, before);
  const row = value.candidates.find((candidate) => candidate.nativeId === nativeId);
  if (summary === undefined) { assert.ok(row?.sameTarget, 'Current owned table/control identity is unavailable before input.');assert.deepEqual(row.cells, before.candidates.find((candidate) => candidate.nativeId === nativeId)?.cells);assert.equal(row.button?.targetCount, 1);assert.equal(row.button?.controlCount, 1); }
  const control = summary === undefined ? row.button : value.summaries?.[summary];
  assert.ok(control?.same && control.enabled !== false && control.presented && control.hit && !control.hit.clipped && control.hit.unobscured, 'Actual control center is hidden, clipped, covered or replaced.');
  if (keyboard) assert.equal(control.focused, true, 'Keyboard input requires the actual same owned control to retain focus.');
  return control.hit;
}
export function assertTableHeightLastRow(value, before, nativeId) {
  const row = assertTableHeightAction(value, before, nativeId, true);const bounds = row.lastRow;const clip = row.scrollClip;
  assert.ok(row.lastRowPresented && row.lastCellPresented && bounds && clip && bounds.top >= 0 && bounds.bottom <= value.height
    && bounds.top >= clip.top - 1 && bounds.bottom <= clip.bottom + 1
    && (row.lastCellHit?.clips ?? []).every((ancestor) => !ancestor.clipY || bounds.top >= ancestor.top - 1 && bounds.bottom <= ancestor.bottom + 1), 'Actual last row is outside the viewport or owned scroll clip.');
  assert.ok(row.lastCellHit && !row.lastCellHit.clipped && row.lastCellHit.unobscured, 'Actual last cell/text is clipped or covered.');
  return { row: bounds, scrollClip: clip, cellHit: row.lastCellHit };
}
export async function tableHeightPointerInput(page, handle, { read, before, nativeId, summary, inputs, label }) {
  await handle.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const first = await read();const evidence = { input: 'pointer', label, before: first };inputs.push(evidence);assertTableHeightInput(first, before, nativeId, { summary });
  const current = await read();evidence.current = current;const hit = assertTableHeightInput(current, before, nativeId, { summary });
  await page.mouse.click(hit.x, hit.y);evidence.sent = true;
}
export async function tableHeightKeyboardInput(page, key, { read, before, nativeId, inputs }) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const current = await read();const evidence = { input: `keyboard ${key}`, current };inputs.push(evidence);assertTableHeightInput(current, before, nativeId, { keyboard: true });await page.keyboard.press(key);evidence.sent = true;
}

export function tableHeightRequestObservation(request, extensionId) {
  let url;try { url = new URL(request.url); } catch { return null; }
  if (request.method !== 'GET' || !['https:', 'http:'].includes(url.protocol)) return null;
  const classified = codeRabbitRequestObservation(request, extensionId);
  let stack = request.initiator?.stack;let extension = false;
  for (let depth = 0; stack && depth < 20; depth += 1, stack = stack.parent) if ((stack.callFrames ?? []).some((frame) => extensionId && frame.url?.startsWith(`chrome-extension://${extensionId}/`))) extension = true;
  const nativeSource = url.origin === 'https://gitlab.com' && (/\/(?:diffs_metadata|diffs?|discussions)(?:[/.]|$)/.test(url.pathname) || /\/-\/raw\//.test(url.pathname) || /\.diff$/.test(url.pathname));
  return { method: 'GET', url: url.origin + url.pathname, source: classified?.source === true || nativeSource || extension,
    attribution: extension ? 'extension_frame_observed' : classified?.attribution ?? 'native_or_unattributed', recognizedCodeRabbitRequest: classified !== null, nativeSource };
}

export async function verifyGitLabTableHeights(page, proof, { anchor, head, poll, capture, extensionId }) {
  const progress = { status: 'running', actions: [], inputs: [], requests: [], sourceGets: [], otherGets: [], scope: 'Genuine owned pointer/keyboard height interaction on a measured collapsed native table; recognized source/extension GETs must stay empty, all other HTTP GETs are retained separately. No native toggle or global preference write.' };proof.tableHeight = progress;
  const request = (value) => { const seen = tableHeightRequestObservation({ url: value.url(), method: value.method(), initiator: value.initiator?.() }, extensionId);if (seen) { progress.requests.push(seen);(seen.source ? progress.sourceGets : progress.otherGets).push(seen); } };
  let held = false;let initial;let selected;let listener = false;let primary;let trustedPointer;
  const read = () => page.evaluate(tableHeightProbe, anchor);
  trustedPointer = (handle, label, summary) => tableHeightPointerInput(page, handle, { read, before: initial, nativeId: selected, summary, inputs: progress.inputs, label });
  page.on('request', request);
  try {
    await page.evaluate((id) => {
      const note = document.getElementById(id);const nativeBody = note?.querySelector('.note-body .note-text');const owned = document.querySelector(`.geld-provider-review [data-geld-source="${id}"] .geld-provider-review__body > .note-text`);
      if (!note || !nativeBody || !owned) throw new Error('Actual native and owned table source unavailable.');
      const first = owned.querySelector('table');const details = [];for (let parent = first?.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement && owned.closest('.geld-provider-review')?.contains(parent)) details.push({ node: parent, summary: parent.querySelector(':scope > summary'), open: parent.open });
      globalThis.__geldTableHeightProof = { note, noteParent: note.parentElement, nativeBody, owned, ownedParent: owned.parentElement, details, events: [], nativeEvents: [] };
      const held = globalThis.__geldTableHeightProof;held.nativeListen = (event) => held.nativeEvents.push(event.detail);window.addEventListener('gl-markdown-table-expanded', held.nativeListen);
    }, anchor);held = true;initial = await read();assert.equal(initial.head, head);assertTableHeightSource(initial, initial);progress.initial = initial;
    progress.opened = 0;
    for (let index = initial.summaries.length - 1; index >= 0; index -= 1) {
      if (initial.summaries[index].open) continue;
      const summary = await page.evaluateHandle((index) => globalThis.__geldTableHeightProof.details[index].summary, index);
      try { await trustedPointer(summary, 'open owned disclosure', index);progress.opened += 1; } finally { await summary.dispose(); }
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    let before = await read();assertTableHeightSource(before, initial);
    const needed = before.candidates.filter((row) => actualTableOverflow(row.native, before.height) && actualTableOverflow(row.owned, before.height)
      && row.nativeControls.length === 1 && row.nativeControls[0].expanded === 'false' && row.nativeControls[0].label === 'Show full table');
    if (needed.length === 0) { progress.status = 'unavailable';progress.reason = 'This actual visit has no source-bound collapsed table with demonstrated native and owned vertical overflow.';progress.measurement = before;return progress; }
    selected = needed[0].nativeId;
    before = await poll(read, (value) => value?.candidates.some((row) => row.nativeId === selected && row.button?.label === 'Show full table'), 'Measured native and owned overflowing table receives its owned local control');assertTableHeightSource(before, initial);
    const candidate = before.candidates.find((row) => row.nativeId === selected);assert.ok(candidate?.button?.id);
    await page.evaluate(({ buttonId, nativeId }) => {
      const held = globalThis.__geldTableHeightProof;const button = document.getElementById(buttonId);const target = document.getElementById(button?.getAttribute('aria-controls'));if (!button || !target) throw new Error('Unique owned table control unavailable.');
      held.button = button;held.target = target;held.table = target.querySelector(':scope > table');held.nativeId = nativeId;
      held.listen = (event) => { if (event.target === button || button.contains(event.target)) held.events.push({ type: event.type, trusted: event.isTrusted, detail: event.detail ?? null, key: event.key ?? null }); };
      button.addEventListener('click', held.listen, true);button.addEventListener('keydown', held.listen, true);
    }, { buttonId: candidate.button.id, nativeId: selected });listener = true;
    before = await read();progress.before = before;
    const trustedKeyboard = (key) => tableHeightKeyboardInput(page, key, { read, before: initial, nativeId: selected, inputs: progress.inputs });
    // Cleanup uses the same source/geometry/hit guards as the action phase.
    const buttonHandle = await page.$(`[id="${candidate.button.id}"]`);assert.ok(buttonHandle);
    try {
      await trustedPointer(buttonHandle, 'expand');
      let value = await poll(read, (value) => value?.candidates.some((row) => row.nativeId === selected && row.button?.expanded === 'true'), 'Owned pointer expands actual table');assertTableHeightAction(value, before, selected, true);progress.actions.push({ input: 'pointer', expanded: true, snapshot: value });
      await page.evaluate(() => { const table = globalThis.__geldTableHeightProof.table;const row = table.rows[table.rows.length - 1];row.cells[row.cells.length - 1].scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); });value = await read();progress.lastRow = assertTableHeightLastRow(value, before, selected);
      await buttonHandle.evaluate((button) => button.scrollIntoView({ block: 'center', behavior: 'instant' }));await trustedKeyboard('Enter');value = await read();assertTableHeightAction(value, before, selected, false);progress.actions.push({ input: 'keyboard Enter', expanded: false, snapshot: value });
      await trustedKeyboard('Space');value = await read();assertTableHeightAction(value, before, selected, true);progress.actions.push({ input: 'keyboard Space', expanded: true, snapshot: value });
      await trustedPointer(buttonHandle, 'collapse');value = await read();assertTableHeightAction(value, before, selected, false);assert.equal(value.ownedBody, before.ownedBody);progress.actions.push({ input: 'pointer', expanded: false, snapshot: value });
      assert.equal(value.events.filter((event) => event.type === 'click').length, 4);assert.ok(value.events.every((event) => event.trusted));
      progress.artifacts = await capture(page, 'gitlab-coderabbit-table-height');const afterCapture = await read();assertTableHeightAction(afterCapture, before, selected, false);assert.equal(afterCapture.ownedBody, before.ownedBody);assert.deepEqual(progress.sourceGets, [], 'Table interaction issued a recognized source or extension-attributed GET; other GET traffic is recorded separately.');progress.status = 'passed';
    } finally { await buttonHandle.dispose(); }
  } catch (error) { primary = error;progress.status = 'failed';progress.error = String(error);throw error; }
  finally {
    const errors = [];
    if (held) {
      try {
        const expanded = await page.evaluate(() => globalThis.__geldTableHeightProof?.button?.getAttribute('aria-expanded') === 'true');
        if (expanded) { const button = await page.evaluateHandle(() => globalThis.__geldTableHeightProof.button);try { assert.ok(trustedPointer);await trustedPointer(button, 'cleanup collapse'); } finally { await button.dispose(); } }
        const count = await page.evaluate(() => globalThis.__geldTableHeightProof.details.length);
        for (let i = 0; i < count; i += 1) {
          const differs = await page.evaluate((index) => { const entry = globalThis.__geldTableHeightProof.details[index];return entry.node.open !== entry.open; }, i);
          if (differs) { const summary = await page.evaluateHandle((index) => globalThis.__geldTableHeightProof.details[index].node.querySelector(':scope > summary'), i);try { assert.ok(trustedPointer);await trustedPointer(summary, 'cleanup disclosure', i); } finally { await summary.dispose(); } }
        }
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const restored = await read();assertTableHeightSource(restored, initial);assert.equal(restored.ownedBody, initial.ownedBody, 'Owned table body did not restore byte-exactly before command guards.');progress.restored = true;
      } catch (error) { errors.push(error); }
      try { progress.listenerDisposed = await page.evaluate(() => { const held = globalThis.__geldTableHeightProof;if (held?.listen && held.button) { held.button.removeEventListener('click', held.listen, true);held.button.removeEventListener('keydown', held.listen, true); }if (held?.nativeListen) window.removeEventListener('gl-markdown-table-expanded', held.nativeListen);delete globalThis.__geldTableHeightProof;return globalThis.__geldTableHeightProof === undefined; }); } catch (error) { errors.push(error); }
    }
    page.off('request', request);
    try { assert.deepEqual(progress.sourceGets, [], 'Table interaction issued a recognized source or extension-attributed GET; other GET traffic is recorded separately.'); } catch (error) { errors.push(error); }
    if (errors.length > 0) { progress.status = 'failed';progress.cleanupErrors = errors.map(String);throw new AggregateError(primary ? [primary, ...errors] : errors, 'Owned table height cleanup failed'); }
    if (listener) assert.equal(progress.listenerDisposed, true);
  }
  return progress;
}
