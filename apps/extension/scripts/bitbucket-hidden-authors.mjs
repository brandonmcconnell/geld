import assert from 'node:assert/strict';
import { bitbucketCountIntentRequests } from './bitbucket-cold-chip.mjs';

const REPO = '/repositories/atlassian/bitbucket-upload-file/pullrequests';
const UUID = '7177c565-3bb4-44d3-b17b-e791dfb8fed8';
const RULE = `bitbucket.org/uuid/${UUID}`;
const FIELDS = 'values.id,values.author.uuid,values.author.display_name';
const REVIEW = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/';
const canonicalUuid = (value) => {
  if (typeof value !== 'string') return null;
  const uuid = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid) ? uuid.toLowerCase() : null;
};

export function isBitbucketAuthorProjection(value) {
  let url;try { url = new URL(value); } catch { return false; }
  if (url.username || url.password || url.hash) return false;
  const path = url.origin === 'https://bitbucket.org' ? `/!api/2.0${REPO}` : url.origin === 'https://api.bitbucket.org' ? `/2.0${REPO}` : null;
  return path !== null && url.pathname === path && url.searchParams.getAll('q').length === 1 && url.searchParams.get('q') === 'state="MERGED"'
    && url.searchParams.getAll('pagelen').length === 1 && url.searchParams.get('pagelen') === '25' && url.searchParams.getAll('fields').length === 1 && url.searchParams.get('fields') === FIELDS
    && [...url.searchParams.keys()].every((key) => ['q', 'pagelen', 'fields'].includes(key));
}

/** Actual response body only; never requests an oracle or infers account identity from a name. */
export function observedBitbucketAuthors(value, visibleIds) {
  assert.ok(value !== null && typeof value === 'object' && Array.isArray(value.values) && value.values.length <= 25, 'Actual author projection must be one bounded collection');
  const wanted = new Set(visibleIds);const seen = new Set();const authors = [];
  for (const entry of value.values) {
    assert.ok(entry !== null && typeof entry === 'object' && Number.isSafeInteger(entry.id) && entry.id > 0 && !seen.has(entry.id), 'Actual author projection contains ambiguous PR identities');
    seen.add(entry.id);
    if (!wanted.has(String(entry.id))) continue;
    authors.push({ id: String(entry.id), uuid: canonicalUuid(entry.author?.uuid), name: typeof entry.author?.display_name === 'string' ? entry.author.display_name : null });
  }
  assert.equal(authors.find((author) => author.id === '27')?.uuid, UUID, 'The observed public PR27 author UUID must match the explicit personal fixture rule');
  return { authors, expectedHiddenIds: authors.filter((author) => author.uuid === UUID).map((author) => author.id) };
}

/** Retain only bounded query-validation facts, never arbitrary JSON fields or login HTML. No new request. */
export async function bitbucketAuthorErrorDiagnostic(response) {
  let text;
  try { text = await response.text(); } catch { return { kind: 'unreadable' }; }
  if (text.length > 4096) return { kind: 'oversized', characters: text.length };
  let value;try { value = JSON.parse(text); } catch { return { kind: 'non-json', characters: text.length }; }
  const record = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  const safe = (item) => typeof item !== 'string' ? null : /\b(?:authorization|bearer|password|secret|access_token|cookie)\b/i.test(item) ? '[credential details omitted]' : item.slice(0, 1024);
  const error = record(value) && record(value.error) ? value.error : null;
  const fields = {};
  if (record(error?.fields)) for (const key of ['pagelen', 'fields', 'q', 'state']) {
    const item = error.fields[key];
    if (typeof item === 'string') fields[key] = safe(item);
    else if (Array.isArray(item)) fields[key] = item.slice(0, 4).map(safe).filter((message) => message !== null);
  }
  return { kind: 'json', message: safe(error?.message), fields };
}

export function bitbucketAuthorRowsSnapshot() {
  const rows = [...document.querySelectorAll('tr[data-qa="pull-request-row"]')].filter((row) => row.closest('[data-geld-ui]') === null).map((row) => {
    const native = (node) => node.closest('[data-geld-ui], [role="tooltip"], [popover]') === null;
    const links = [...row.querySelectorAll('a[href]')].filter(native);
    const ids = [...new Set(links.flatMap((link) => { try { const url = new URL(link.href);const match = /^\/atlassian\/bitbucket-upload-file\/pull-requests\/([1-9]\d*)\/?$/.exec(url.pathname);return url.origin === location.origin && match !== null ? [match[1]] : []; } catch { return []; } }))];
    const popups = [...row.querySelectorAll('[role="tooltip"], [popover]')].filter((node) => node.closest('[data-geld-ui]') === null).map((node) => ({ id: node.id, role: node.getAttribute('role'), popover: node.getAttribute('popover'), ids: [node, ...node.querySelectorAll('[id]')].map((child) => child.id).filter(Boolean) }));
    const ariaAssociations = [...row.querySelectorAll('[aria-describedby], [aria-labelledby]')].filter(native).map((node) => ({ tag: node.tagName, id: node.id, describedBy: node.getAttribute('aria-describedby'), labelledBy: node.getAttribute('aria-labelledby'), related: [...new Set(`${node.getAttribute('aria-describedby') ?? ''} ${node.getAttribute('aria-labelledby') ?? ''}`.split(/\s+/).filter(Boolean))].map((id) => { const target = document.getElementById(id);return { id, exists: target !== null, tag: target?.tagName ?? null, role: target?.getAttribute('role') ?? null, popover: target?.getAttribute('popover') ?? null, hidden: target?.hasAttribute('hidden') ?? false }; }) }));
    return { id: ids.length === 1 ? ids[0] : null, hidden: row.hidden, display: getComputedStyle(row).display, marked: row.hasAttribute('data-geld-provider-author-hidden'), inlineStyle: row.getAttribute('style'), transientNativePopups: popups, ariaAssociations,
      nativeIds: [row, ...row.querySelectorAll('[id]')].filter(native).map((node) => node.id).filter(Boolean), nativeLinks: links.map((link) => ({ href: link.getAttribute('href'), qa: link.getAttribute('data-qa') })) };
  });
  const note = document.querySelector('[data-geld-provider-author-note]');const button = note?.querySelector('button');
  const sample = (node) => { if (node === null || node === undefined) return null;const style = getComputedStyle(node);return { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color, background: style.backgroundColor, outline: style.outline }; };
  const active = document.activeElement;
  const Anchor = document.defaultView?.HTMLAnchorElement;
  let focusedHref = null;
  if (Anchor !== undefined && active instanceof Anchor && active.closest('tr[data-qa="pull-request-row"]') !== null && active.closest('[data-geld-ui]') === null) {
    try {
      const url = new URL(active.href);
      if (url.origin === location.origin && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && /^\/atlassian\/bitbucket-upload-file\/pull-requests\/[1-9]\d*$/.test(url.pathname)) focusedHref = url.href;
    } catch { /* Unknown focus does not prove native recovery. */ }
  }
  return { rows, chips: document.querySelectorAll('.geld-provider-list-counts').length, note: note === null ? null : { text: note.textContent, role: note.querySelector('[role="note"]')?.getAttribute('role'), tag: note.tagName, colspan: note.querySelector('td')?.colSpan, buttonLabel: button?.getAttribute('aria-label'), style: sample(button), nativeSmall: sample(document.querySelector('tr[data-qa="pull-request-row"] small')) },
    focusedHref, showEvent: globalThis.__geldAuthorShow?.event ?? null };
}

function sameNative(before, after) {
  assert.deepEqual(after.rows.map((row) => ({ id: row.id, ids: row.nativeIds, links: row.nativeLinks, hidden: row.hidden, style: row.inlineStyle })), before.rows.map((row) => ({ id: row.id, ids: row.nativeIds, links: row.nativeLinks, hidden: row.hidden, style: row.inlineStyle })), 'Author hiding/recovery changed native row identities, links, hidden state or inline styles');
}

export function assertBitbucketAuthorRowsRestored(before, after) {
  sameNative(before, after);
  assert.deepEqual(after.rows.map((row) => ({ id: row.id, display: row.display })), before.rows.map((row) => ({ id: row.id, display: row.display })), 'Author recovery must restore every native row display, including rows beyond the focused title');
}

export async function verifyBitbucketHiddenAuthors({ page, patchSettings, poll, pause, capture, original, extensionId, onProgress = () => undefined }) {
  assert.deepEqual(original.hiddenAuthors ?? [], [], 'The isolated author fixture must start without personal author filters');
  const requests = [];const responses = [];const pending = new Set();let responseError = null;
  const progress = { status: 'pending', rule: RULE, requests };onProgress(progress);
  const request = (item) => {
    let url;try { url = new URL(item.url()); } catch { return; }
    if (!(url.origin === 'https://api.bitbucket.org' && url.pathname.startsWith('/2.0/')) && !(url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/'))) return;
    const frames = [];let stack = item.initiator?.()?.stack;for (let index = 0; stack !== null && stack !== undefined && index < 8; index += 1) { frames.push(...(stack.callFrames ?? []).map((frame) => frame.url));stack = stack.parent; }
    const projection = isBitbucketAuthorProjection(item.url());
    requests.push({ url: projection ? item.url() : `${url.origin}${url.pathname}`, requestedAt: new Date().toISOString(), method: item.method(), projection, extensionInitiator: frames.some((frame) => frame.startsWith(`chrome-extension://${extensionId}/`)) });
    if (requests.filter((request) => request.projection).length > 1) responseError = 'Author filtering attempted more than one collection request';
  };
  const response = (item) => {
    if (!isBitbucketAuthorProjection(item.url())) return;
    const task = (async () => {
      progress.response = { url: item.url(), observedAt: new Date().toISOString(), status: item.status() };
      assert.equal(item.request().method(), 'GET');
      if (item.status() !== 200) progress.response.errorBody = await bitbucketAuthorErrorDiagnostic(item);
      assert.equal(item.status(), 200, 'Actual author collection must be readable');
      const body = await item.json();responses.push(body);
      progress.response.values = Array.isArray(body?.values) ? body.values.slice(0, 25).map((entry) => ({ id: Number.isSafeInteger(entry?.id) ? entry.id : null, uuid: canonicalUuid(entry?.author?.uuid), name: typeof entry?.author?.display_name === 'string' ? entry.author.display_name : null })) : null;
    })().catch((error) => { responseError = String(error); });
    pending.add(task);void task.finally(() => pending.delete(task));
  };
  page.on('request', request);page.on('response', response);
  let before;
  let evidence = null;
  const read = () => page.evaluate(bitbucketAuthorRowsSnapshot);
  try {
    await patchSettings({ showListStats: false, hiddenAuthors: ['', ' #comment', ' @ '] });
    before = await poll(read, (value) => value.rows.some((row) => row.id === '27') && value.chips === 0 && value.rows.every((row) => !row.marked) && value.note === null, 'Stats-off native list remains visible without author demand for semanticempty rules');
    progress.before = before;
    await pause(250);
    assert.equal(requests.filter((request) => request.projection).length, 0, 'Semantically empty author rules must perform zero author reads');
    await patchSettings({ hiddenAuthors: [RULE] });
    const outcome = await poll(async () => ({ failure: responseError, snapshot: await read() }), (value) => value.failure !== null || responses.length === 1 && value.snapshot.rows.find((row) => row.id === '27')?.marked && value.snapshot.rows.find((row) => row.id === '27')?.display === 'none' && value.snapshot.note !== null, 'One observed collection response hides only the public PR27 durable author identity');
    if (outcome.failure !== null) throw new Error(outcome.failure);
    const hidden = outcome.snapshot;
    progress.hidden = hidden;
    await Promise.all([...pending]);
    const observed = observedBitbucketAuthors(responses[0], before.rows.flatMap((row) => row.id === null ? [] : [row.id]));
    progress.observed = observed;
    const expected = new Set(observed.expectedHiddenIds);
    assert.deepEqual(hidden.rows.filter((row) => row.marked).map((row) => row.id).sort(), [...expected].sort(), 'Only positively observed matching UUID authors may be hidden');
    for (const row of hidden.rows) if (!expected.has(row.id)) assert.equal(row.display, before.rows.find((native) => native.id === row.id)?.display, 'Unknown and nonmatching author rows must remain under native visibility');
    sameNative(before, hidden);assert.equal(hidden.chips, 0, 'Author filtering with stats off must not mount count demand');
    assert.equal(hidden.note.tag, 'TR');assert.equal(hidden.note.role, 'note');assert.ok(hidden.note.colspan > 0);
    const name = observed.authors.find((author) => author.id === '27')?.name?.trim() || 'Unknown account';assert.ok(hidden.note.text.includes(name), 'The readable note must use observed authorName or an explicit unknown-account label');assert.ok(!hidden.note.text.includes(RULE), 'Opaque matching identity must not replace its display name');
    for (const property of ['fontFamily', 'fontSize', 'lineHeight']) assert.equal(hidden.note.style?.[property], hidden.note.nativeSmall?.[property], `Show must retain native small-text ${property}`);
    const artifacts = await capture(page, 'bitbucket-hidden-authors-hidden');
    await page.evaluate(() => {
      const listener = (event) => { globalThis.__geldAuthorShow.event = { trusted: event.isTrusted, ownedShow: event.target instanceof Element && event.target.closest('[data-geld-provider-author-note] button') !== null }; };
      globalThis.__geldAuthorShow = { listener, event: null };document.addEventListener('click', listener, { capture: true, once: true });
    });
    await page.focus('[data-geld-provider-author-note] button');await page.keyboard.press('Enter');
    const shown = await poll(read, (value) => value.note === null && value.rows.every((row) => !row.marked), 'Real keyboard Enter on Show restores the actual native rows');
    progress.shown = shown;
    const firstHidden = before.rows.find((row) => expected.has(row.id))?.id;
    assertBitbucketAuthorRowsRestored(before, shown);assert.deepEqual(shown.showEvent, { trusted: true, ownedShow: true });assert.equal(shown.focusedHref, `${REVIEW}${firstHidden}`);assert.equal(shown.chips, 0);
    await patchSettings({ hiddenAuthors: [] });
    const cleared = await poll(read, (value) => value.note === null && value.rows.every((row) => !row.marked) && value.chips === 0, 'Removing the personal rule clears the author filter without diff demand');
    progress.cleared = cleared;
    assertBitbucketAuthorRowsRestored(before, cleared);
    assert.equal(requests.filter((request) => request.projection).length, 1, 'The author slice may acquire at most one collection response');
    assert.deepEqual(bitbucketCountIntentRequests(requests.filter((request) => !request.projection)), [], 'Author metadata must not acquire count/config resources or unrelated extension-attributed sources');
    evidence = Object.assign(progress, { status: 'verifying_cleanup', identityBasis: 'Observed current collection PR ID→native UUID, separate display_name; no nickname/account_id inference or oracle GET', shown, cleared, artifacts, completeness: 'Only exact returned current IDs; omitted/unknown rows remain visible, no pagination or complete-list claim', keyboardMechanism: 'Real Enter on the focused owned Show control, then native-title focus recovery' });
    return evidence;
  } catch (error) {
    progress.status = 'failed';progress.error = String(error);throw error;
  } finally {
    try {
      await patchSettings({ hiddenAuthors: original.hiddenAuthors ?? [], showListStats: original.showListStats ?? true });
      if (evidence !== null) {
        assert.equal(page.isClosed(), false, 'Author fixture closed before cleanup could be verified');
        evidence.cleanup = await poll(read, (value) => value.rows.every((row) => !row.marked) && value.note === null && ((original.showListStats ?? true) ? value.chips > 0 : value.chips === 0), 'Author fixture restores personal settings and native row visibility');
        assertBitbucketAuthorRowsRestored(before, evidence.cleanup);
        assert.equal(requests.filter((request) => request.projection).length, 1, 'Settings cleanup must not repeat author acquisition');
        assert.deepEqual(bitbucketCountIntentRequests(requests.filter((request) => !request.projection)), [], 'Settings cleanup must not create unrelated extension/count demand');
        evidence.status = 'passed';
      }
    } catch (error) {
      progress.status = 'failed';progress.cleanupError = String(error);throw error;
    } finally {
      if (!page.isClosed()) await page.evaluate(() => { const observation = globalThis.__geldAuthorShow;if (observation !== undefined) document.removeEventListener('click', observation.listener, true);delete globalThis.__geldAuthorShow; }).catch(() => undefined);
      page.off('request', request);page.off('response', response);
    }
  }
}
