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
      if (parent.hidden || parent.inert || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden' || style.opacity === '0'
        || parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(node)) return false;
    }
    return true;
  };
  const hiddenReasons = (node) => {
    const reasons = [];
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);const reason = parent.hidden ? `hidden:${parent.getAttribute('hidden')}` : parent.inert ? 'inert' : parent.getAttribute('aria-hidden') === 'true' ? 'aria-hidden' : style.display === 'none' ? 'display:none' : ['hidden', 'collapse'].includes(style.visibility) ? `visibility:${style.visibility}` : style.opacity === '0' ? 'opacity:0' : style.contentVisibility === 'hidden' ? 'content-visibility:hidden' : parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(node) ? 'closed details' : null;
      if (reason) reasons.push({ tag: parent.tagName, id: parent.id, reason });
    }
    return reasons;
  };
  const qualifiedIntent = (native, table, controls) => {
    const source = note?.querySelector('.note-body .note-text');const button = controls[0];const wrapper = button?.parentElement;const shadow = native.parentElement;
    if (!source || controls.length !== 1 || !button || !wrapper || !shadow || !source.contains(wrapper) || document.querySelectorAll(`[id="${native.id}"]`).length !== 1
      || native.className !== 'gl-max-h-[70vh] gl-w-fit gl-max-w-full gl-overflow-x-auto gl-overflow-y-auto print:gl-max-h-none'
      || native.getAttribute('data-sticky-header') !== '' || native.getAttribute('data-print-scale-container') !== ''
      || [...native.attributes].some((attr) => !['id', 'class', 'data-sticky-header', 'data-print-scale-container'].includes(attr.name))
      || native.children.length !== 1 || native.firstElementChild !== table || table?.getAttribute('data-markdown-table-applied') !== 'true' || table.closest('.note-text') !== source || table.querySelector('table')
      || shadow.className !== 'gl-table-shadow-overlay' || shadow.getAttribute('data-testid') !== 'table-shadow-overlay' || shadow.children.length !== 1
      || wrapper.previousElementSibling !== shadow || wrapper.parentElement !== shadow.parentElement || wrapper.attributes.length !== 1
      || !['gl-order-1 gl-mt-2 gl-flex gl-justify-center print:gl-hidden', 'gl-mt-2 gl-flex gl-justify-center print:gl-hidden'].includes(wrapper.className)
      || [...wrapper.childNodes].filter((child) => child.nodeType !== Node.TEXT_NODE || child.textContent.trim()).some((child) => child !== button)
      || button.localName !== 'button' || button.getAttribute('type') !== 'button' || button.className !== 'btn gl-button btn-default btn-sm btn-default-tertiary'
      || button.getAttribute('data-testid') !== 'markdown-table-height-toggle' || button.getAttribute('aria-controls') !== native.id || button.getAttribute('aria-expanded') !== 'false'
      || [...button.attributes].some((attr) => !['type', 'class', 'data-testid', 'aria-expanded', 'aria-controls'].includes(attr.name))) return false;
    const icon = button.children[0];const label = button.children[1];
    if (button.children.length !== 2 || icon?.localName !== 'svg' || icon.namespaceURI !== 'http://www.w3.org/2000/svg' || icon.getAttribute('aria-hidden') !== 'true' || icon.textContent.trim()
      || [icon, ...icon.querySelectorAll('*')].some((node) => node.namespaceURI !== 'http://www.w3.org/2000/svg' || !['svg', 'g', 'path', 'use'].includes(node.localName) || [...node.attributes].some((attr) => attr.name.startsWith('on') || ['tabindex', 'contenteditable'].includes(attr.name)))
      || label?.localName !== 'span' || label.className !== 'gl-button-text' || label.attributes.length !== 1 || label.textContent.trim() !== 'Show full table'
      || [...label.childNodes].some((child) => child.nodeType !== Node.TEXT_NODE && child.nodeType !== Node.COMMENT_NODE)) return false;
    return [...button.childNodes].every((child) => child === icon || child === label || child.nodeType === Node.COMMENT_NODE || child.nodeType === Node.TEXT_NODE && !child.textContent.trim());
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
    const nativeControls = [...note.querySelectorAll('.note-body .note-text button[aria-controls]')].filter((button) => button.getAttribute('aria-controls') === native.id);
    const buttons = [...owned.querySelectorAll('[data-geld-table-height] button[aria-controls]')].filter((button) => button.getAttribute('aria-controls') === target.id);
    const button = buttons.length === 1 ? buttons[0] : null;
    const lastRow = ownTable?.rows[ownTable.rows.length - 1];const lastCell = lastRow?.cells[lastRow.cells.length - 1];
    const walker = lastCell ? document.createTreeWalker(lastCell, NodeFilter.SHOW_TEXT) : null;let text;let textRect = null;
    while ((text = walker?.nextNode())) { if (!text.textContent.trim()) continue;const range = document.createRange();range.selectNodeContents(text);textRect = [...range.getClientRects()].find((value) => value.width > 0 && value.height > 0);if (textRect) break; }
    const scrollRect = rect(target);const scrollClip = scrollRect ? { left: scrollRect.left + target.clientLeft, top: scrollRect.top + target.clientTop, right: scrollRect.left + target.clientLeft + target.clientWidth, bottom: scrollRect.top + target.clientTop + target.clientHeight } : null;
    const lastBounds = rect(lastRow);const lastCellHit = hit(lastCell, textRect ?? rect(lastCell));
    return [{ nativeId: native.id, cells: content, native: metrics(native, table), nativeHiddenReasons: hiddenReasons(native), nativeIntentQualified: qualifiedIntent(native, table, nativeControls), sameNativeControl: saved.nativeControl === undefined ? null : (nativeControls[0] ?? null) === saved.nativeControl, owned: metrics(target, ownTable), ownedAuthority: button?.parentElement?.dataset.geldTableHeightAuthority ?? null, nativeControls: nativeControls.map((node) => ({ label: node.textContent.trim(), expanded: node.getAttribute('aria-expanded'), controls: node.getAttribute('aria-controls') })),
      button: button ? { id: button.id, label: button.textContent, expanded: button.getAttribute('aria-expanded'), target: target.id, targetCount: document.querySelectorAll(`[id="${target.id}"]`).length, controlCount: document.querySelectorAll(`[id="${button.id}"]`).length, focused: document.activeElement === button, enabled: !button.disabled, presented: visible(button), rect: rect(button), hit: hit(button), same: !saved.button || saved.button === button } : null,
      scrollClip, lastRow: lastBounds, lastRowPresented: visible(lastRow), lastCellPresented: visible(lastCell), lastCellHit, sameTarget: saved.target ? target === saved.target && ownTable === saved.table && button === saved.button : null }];
  });
  const active = document.activeElement;const safe = (value, limit) => typeof value === 'string' && /^[a-zA-Z0-9_!@:/ .-]*$/.test(value) && value.length <= limit ? value : null;
  const activeElement = active ? { tag: active.tagName, id: safe(active.id, 128), classes: [...active.classList].slice(0, 16).map((value) => safe(value, 96)).filter((value) => value !== null), classesTruncated: active.classList.length > 16, isConnected: active.isConnected, insideCurrentButton: !!saved.button && (saved.button === active || saved.button.contains(active)), insideOwnedSource: !!owned && owned.contains(active) } : null;
  return { activeElement, head: panel?.dataset.geldReviewHead, sameSource: note === saved.note && note?.parentElement === saved.noteParent && note?.querySelector('.note-body .note-text') === saved.nativeBody,
    sameOwned: owned === saved.owned && owned?.parentElement === saved.ownedParent, nativeBody: saved.nativeBody?.outerHTML, ownedBody: owned?.outerHTML,
    preference: localStorage.getItem('markdown_table_expanded'), height: innerHeight, width: innerWidth, candidates, summaries, mappingErrors, events: saved.events ?? [], nativeEvents: saved.nativeEvents ?? [] };
}
export function actualTableOverflow(value, viewport) {
  const cap = value?.maxHeight?.endsWith('vh') ? Number.parseFloat(value.maxHeight) * viewport / 100 : Number.parseFloat(value?.maxHeight ?? '');
  return value?.presented === true && value.clientHeight > 0 && value.scrollHeight - value.clientHeight > 1 && value.tableHeight > viewport * 70 / 100
    && ['auto', 'scroll'].includes(value.overflowY) && Number.isFinite(cap) && Math.abs(cap - viewport * 70 / 100) <= 1;
}
export function tableHeightAuthority(row, viewport) {
  if (actualTableOverflow(row?.native, viewport)) return 'actual-native-geometry';
  return row?.nativeIntentQualified === true && row.native?.presented === false && row.nativeHiddenReasons?.length > 0 ? 'hidden-native-generated-control' : null;
}

export function assertTableHeightSource(value, before) {
  assert.ok(value, 'Table source measurement is unavailable.');assert.equal(value.sameSource, true, 'Original native table note/body ownership changed.');assert.equal(value.sameOwned, true, 'Original owned table note/body ownership changed.');
  assert.equal(value.head, before.head, 'Current table source head changed.');assert.equal(value.nativeBody, before.nativeBody, 'Original native table body changed.');assert.equal(value.preference, before.preference, 'Native table preference changed.');assert.deepEqual(value.nativeEvents, [], 'Native table events were emitted.');assert.deepEqual(value.mappingErrors, [], 'Native and owned table source rows must match unambiguously.');
}
export function assertTableHeightAction(value, before, nativeId, expanded) {
  assertTableHeightSource(value, before);
  const row = value.candidates.find((candidate) => candidate.nativeId === nativeId);const original = before.candidates.find((candidate) => candidate.nativeId === nativeId);
  assert.ok(row && original && row.sameTarget && row.sameNativeControl, 'Original native intent or owned table/control was replaced.');assert.equal(row.ownedAuthority, tableHeightAuthority(row, value.height));assert.notEqual(row.ownedAuthority, null);assert.deepEqual(row.cells, original.cells);const { rect: _currentPosition, ...currentNative } = row.native;const { rect: _originalPosition, ...originalNative } = original.native;assert.deepEqual(currentNative, originalNative);assert.deepEqual(row.nativeControls, original.nativeControls);
  assert.equal(row.button?.label, expanded ? 'Collapse table' : 'Show full table');assert.equal(row.button.expanded, String(expanded));assert.equal(row.button.targetCount, 1);assert.equal(row.button.controlCount, 1);assert.equal(row.button.focused, true, 'Actual owned table control lost focus.');
  assert.equal(row.owned.className.split(/\s+/).includes('gl-max-h-[70vh]'), !expanded, 'Owned table height-cap class disagrees with its requested expanded state.');
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
  if (summary === undefined) { assert.ok(row?.sameTarget, 'Current owned table/control identity is unavailable before input.');assert.deepEqual(row.cells, before.candidates.find((candidate) => candidate.nativeId === nativeId)?.cells);assert.equal(row.button?.targetCount, 1);assert.equal(row.button?.controlCount, 1);assert.equal(row.sameNativeControl, true);assert.equal(row.ownedAuthority, tableHeightAuthority(row, value.height));assert.notEqual(row.ownedAuthority, null); }
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

/** Observation only: no focus, DOM mutation, continuous polling or mutator interception. */
export function tableFocusTrace(action = 'read', phase = null) {
  const held = globalThis.__geldTableHeightProof;
  if (!held) return null;
  if (action === 'setup') {
    if (held.trace) throw Error('Table focus trace already installed.');
    if (!held.button?.isConnected || !held.owned?.contains(held.button)) throw Error('Current owned table button unavailable for tracing.');
    const button = held.button, controls = button.parentElement, owned = held.owned;
    const ancestors = [];for (let node = button.parentElement; node && ancestors.length < 24; node = node.parentElement) ancestors.push(node);
    const watched = new Set([button, controls, owned, held.target, held.table, ...ancestors]);
    const safe = (value, limit = 128) => typeof value === 'string' && value.length <= limit && /^[a-zA-Z0-9_!@:/ .-]*$/.test(value) ? value : null;
    const number = (value) => Number.isFinite(value) ? value : null;
    const classes = (value) => typeof value === 'string' ? value.split(/\s+/).filter(Boolean).slice(0, 16).map((name) => safe(name, 96)).filter((name) => name !== null) : [];
    const describe = (node) => node instanceof Element ? { tag: node.tagName, id: safe(node.id), classes: classes(node.getAttribute('class')), isConnected: node.isConnected,
      sameButton: node === button, sameControls: node === controls, sameOwned: node === owned, retainedAncestor: ancestors.includes(node), containsButtonNow: node.contains(button), insideOwnedNow: owned.contains(node) } : null;
    const trace = { records: [], dropped: 0, phase: 'mounted', frame: null, stopped: false, previous: null };
    const push = (kind, data = {}) => { if (trace.stopped) return;const row = { at: number(performance.now()), phase: trace.phase, kind, ...data };if (trace.records.length < 128) trace.records.push(row);else trace.dropped++; };
    const metric = (node) => { if (!node) return null;const style = getComputedStyle(node);return { isConnected: node.isConnected, clientHeight: number(node.clientHeight), scrollHeight: number(node.scrollHeight), offsetHeight: number(node.offsetHeight),
        maxHeight: safe(style.maxHeight), overflowY: safe(style.overflowY), display: safe(style.display), visibility: safe(style.visibility), opacity: safe(style.opacity), contentVisibility: safe(style.contentVisibility), fontSize: safe(style.fontSize), lineHeight: safe(style.lineHeight), fontWeight: safe(style.fontWeight) }; };
    const viewport = () => ({ width: number(innerWidth), height: number(innerHeight), visualHeight: number(window.visualViewport?.height), visualWidth: number(window.visualViewport?.width), visualScale: number(window.visualViewport?.scale) });
    const instant = () => ({ viewport: viewport(), button: describe(button), controls: describe(controls), buttonMetrics: metric(button), ownedMetrics: metric(held.target), authority: safe(controls?.dataset.geldTableHeightAuthority) });
    const snapshot = (reason) => {
      const state = { active: describe(document.activeElement), button: describe(button), focused: document.activeElement === button, authority: safe(controls?.dataset.geldTableHeightAuthority),
        viewport: viewport(),
        owned: metric(held.target), table: metric(held.table), nativeScroll: metric(held.nativeBody?.querySelector(`[id="${held.nativeId}"]`)), nativeTable: metric(held.nativeBody?.querySelector(`[id="${held.nativeId}"] > table`)),
        ancestors: ancestors.slice(0, 8).map((node) => ({ node: describe(node), hidden: node.hasAttribute('hidden'), inert: node.hasAttribute('inert'), ariaHidden: node.getAttribute('aria-hidden') === 'true', open: node instanceof HTMLDetailsElement ? node.open : null, metrics: metric(node) })) };
      const signature = JSON.stringify(state);if (signature !== trace.previous) { trace.previous = signature;push('state', { reason, state }); }
    };
    const schedule = (reason) => { if (!trace.stopped && trace.frame === null) trace.frame = requestAnimationFrame(() => { trace.frame = null;snapshot(reason); }); };
    const relevant = (node) => node instanceof Element && (watched.has(node) || node.contains(button) || node.contains(owned));
    const mutations = (records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          const removed = [...record.removedNodes].filter(relevant), added = [...record.addedNodes].filter(relevant);
          if (!removed.length && !added.length) continue;
          push('childList', { target: describe(record.target), removed: removed.slice(0, 8).map(describe), added: added.slice(0, 8).map(describe), removedCount: removed.length, addedCount: added.length });schedule('owned-childList');
        } else if (watched.has(record.target)) {
          const name = record.attributeName;
          const old = name === 'class' ? { classes: classes(record.oldValue) } : ['hidden', 'inert', 'open', 'aria-hidden', 'data-geld-table-height-authority'].includes(name) ? { present: record.oldValue !== null, token: safe(record.oldValue, 32) } : null;
          push('attribute', { target: describe(record.target), name, old });schedule('owned-attribute');
        }
      }
    };
    const observer = new MutationObserver(mutations);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'open', 'aria-hidden', 'data-geld-table-height-authority'] });
    const focus = (event) => {
      if (!(event.target instanceof Element) || !(event.target === button || button.contains(event.target) || event.relatedTarget === button || event.relatedTarget instanceof Element && button.contains(event.relatedTarget))) return;
      const callbackFrames = [...(new Error().stack ?? '').matchAll(/(?:https?:\/\/|chrome-extension:\/\/)[^\s)]+/g)].slice(0, 4).flatMap(([href]) => { try { const url = new URL(href);return /\.(?:m?js|ts)(?::\d+){0,2}$/.test(url.pathname) ? [url.protocol + '//' + url.host + url.pathname.slice(0, 256)] : []; } catch { return []; } });
      push(event.type, { target: describe(event.target), related: describe(event.relatedTarget), active: describe(document.activeElement), trusted: event.isTrusted === true, instant: instant(), callbackFrames });schedule('owned-focus');
    };
    const resize = () => { push('viewport-event', { active: describe(document.activeElement), instant: instant() });schedule('viewport-event'); };
    for (const type of ['focusin', 'focusout', 'blur']) document.addEventListener(type, focus, true);
    window.addEventListener('resize', resize);window.visualViewport?.addEventListener('resize', resize);window.visualViewport?.addEventListener('scroll', resize);
    trace.snapshot = (reason) => { mutations(observer.takeRecords());snapshot(reason); };
    trace.cleanup = () => { mutations(observer.takeRecords());snapshot('cleanup');observer.disconnect();for (const type of ['focusin', 'focusout', 'blur']) document.removeEventListener(type, focus, true);window.removeEventListener('resize', resize);window.visualViewport?.removeEventListener('resize', resize);window.visualViewport?.removeEventListener('scroll', resize);if (trace.frame !== null) cancelAnimationFrame(trace.frame);trace.frame = null;trace.stopped = true; };
    held.trace = trace;snapshot('mounted');
  }
  const trace = held.trace;if (!trace) return null;
  if (typeof phase === 'string' && /^[a-z_-]{1,64}$/.test(phase)) trace.phase = phase;
  if (action === 'stage') trace.snapshot('capture-stage');
  if (action === 'cleanup') trace.cleanup();
  return { records: [...trace.records], dropped: trace.dropped, stopped: trace.stopped, framePending: trace.frame !== null, limit: 128,
    scope: 'Event-driven focus, reference-identity mutations and measured states only; callback frames are not the DOM mutator stack. No cause is inferred from final state.' };
}

export async function verifyGitLabTableHeights(page, proof, { anchor, head, poll, capture, extensionId }) {
  const progress = { status: 'running', actions: [], inputs: [], requests: [], sourceGets: [], otherGets: [], scope: 'Genuine owned pointer/keyboard height interaction on measured owned overflow, with native authority mode recorded separately; recognized source/extension GETs must stay empty, all other HTTP GETs are retained separately. No native toggle or global preference write.' };proof.tableHeight = progress;
  const request = (value) => { const seen = tableHeightRequestObservation({ url: value.url(), method: value.method(), initiator: value.initiator?.() }, extensionId);if (seen) { progress.requests.push(seen);(seen.source ? progress.sourceGets : progress.otherGets).push(seen); } };
  let held = false;let initial;let selected;let listener = false;let tracing = false;let primary;let trustedPointer;
  const read = () => page.evaluate(tableHeightProbe, anchor);
  trustedPointer = async (handle, label, summary) => { if (tracing) await page.evaluate(tableFocusTrace, 'stage', `pointer_${label.replace(/[^a-z]+/g, '_')}`);return tableHeightPointerInput(page, handle, { read, before: initial, nativeId: selected, summary, inputs: progress.inputs, label }); };
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
    const needed = before.candidates.filter((row) => tableHeightAuthority(row, before.height) !== null && actualTableOverflow(row.owned, before.height));
    if (needed.length === 0) { progress.status = 'unavailable';progress.reason = 'This actual visit has no measured owned overflow supported by actual native geometry or an exact hidden native generated height control.';progress.measurement = before;return progress; }
    selected = needed[0].nativeId;progress.authorityMode = tableHeightAuthority(needed[0], before.height);progress.nativeOriginalPresented = needed[0].native.presented;progress.nativeHiddenReasons = needed[0].nativeHiddenReasons;progress.nativeIntentQualified = needed[0].nativeIntentQualified;
    before = await poll(read, (value) => value?.candidates.some((row) => row.nativeId === selected && row.button?.label === 'Show full table'), 'Measured owned overflow with verified native authority receives its owned local control');assertTableHeightSource(before, initial);
    const candidate = before.candidates.find((row) => row.nativeId === selected);assert.ok(candidate?.button?.id);
    await page.evaluate(({ buttonId, nativeId }) => {
      const held = globalThis.__geldTableHeightProof;const button = document.getElementById(buttonId);const target = document.getElementById(button?.getAttribute('aria-controls'));if (!button || !target) throw new Error('Unique owned table control unavailable.');
      held.button = button;held.target = target;held.table = target.querySelector(':scope > table');held.nativeId = nativeId;held.nativeControl = [...held.nativeBody.querySelectorAll('button[aria-controls]')].find((node) => node.getAttribute('aria-controls') === nativeId) ?? null;
      held.listen = (event) => { if (event.target === button || button.contains(event.target)) held.events.push({ type: event.type, trusted: event.isTrusted, detail: event.detail ?? null, key: event.key ?? null }); };
      button.addEventListener('click', held.listen, true);button.addEventListener('keydown', held.listen, true);
    }, { buttonId: candidate.button.id, nativeId: selected });listener = true;
    tracing = true;progress.focusTrace = await page.evaluate(tableFocusTrace, 'setup');assert.ok(progress.focusTrace?.records.length > 0, 'Bounded focus trace did not mount.');
    before = await read();progress.before = before;
    const trustedKeyboard = async (key) => { await page.evaluate(tableFocusTrace, 'stage', `keyboard_${key.toLowerCase()}`);return tableHeightKeyboardInput(page, key, { read, before: initial, nativeId: selected, inputs: progress.inputs }); };
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
      progress.captureStages = [];
      progress.focusTrace = await page.evaluate(tableFocusTrace, 'stage', 'before_capture');
      progress.artifacts = await capture(page, 'gitlab-coderabbit-table-height', { onStage: async (stage) => { const sample = { stage };progress.captureStages.push(sample);sample.trace = await page.evaluate(tableFocusTrace, 'stage', stage);sample.snapshot = await read(); } });
      progress.focusTrace = await page.evaluate(tableFocusTrace, 'stage', 'after_capture');progress.afterCapture = await read();assert.deepEqual(progress.captureStages.map((sample) => sample.stage), ['after_screenshot', 'after_dom_read', 'after_accessibility_read'], 'Table capture-stage observations are incomplete.');assertTableHeightAction(progress.afterCapture, before, selected, false);assert.equal(progress.afterCapture.ownedBody, before.ownedBody, 'Owned table body changed after capture.');assert.deepEqual(progress.sourceGets, [], 'Table interaction issued a recognized source or extension-attributed GET; other GET traffic is recorded separately.');progress.status = 'passed';
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
      if (tracing) { try { progress.focusTrace = await page.evaluate(tableFocusTrace, 'cleanup', 'finally');progress.traceDisposed = progress.focusTrace?.stopped === true && progress.focusTrace?.framePending === false;assert.equal(progress.traceDisposed, true, 'Focus trace cleanup was not verified.'); } catch (error) { errors.push(error); } }
      try { progress.listenerDisposed = await page.evaluate(() => { const held = globalThis.__geldTableHeightProof;if (held?.listen && held.button) { held.button.removeEventListener('click', held.listen, true);held.button.removeEventListener('keydown', held.listen, true); }if (held?.nativeListen) window.removeEventListener('gl-markdown-table-expanded', held.nativeListen);delete globalThis.__geldTableHeightProof;return globalThis.__geldTableHeightProof === undefined; }); } catch (error) { errors.push(error); }
    }
    page.off('request', request);
    try { assert.deepEqual(progress.sourceGets, [], 'Table interaction issued a recognized source or extension-attributed GET; other GET traffic is recorded separately.'); } catch (error) { errors.push(error); }
    if (errors.length > 0) { progress.status = 'failed';progress.cleanupErrors = errors.map(String);throw new AggregateError(primary ? [primary, ...errors] : errors, 'Owned table height cleanup failed'); }
    if (listener) assert.equal(progress.listenerDisposed, true);
  }
  return progress;
}
