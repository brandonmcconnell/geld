import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { tsImport } from 'tsx/esm/api';
import { assertDisplayedOutlineCounts } from './gitlab-displayed-outline.mjs';
import { qualifyGitLabWholeResponse, assertWholeTestMounted, assertSecondWholeTestMounted } from './gitlab-whole-test-context.mjs';

const { normalizeSettings, parseUnifiedDiff } = await tsImport('@geld/core', import.meta.url);
const ORIGIN = 'https://gitlab.com', PROJECT = 'gitlab-org/gitlab';
export const GITLAB_STANDALONE_WHOLE = Object.freeze({
  head: '13215ca460cd4f75d3765a882ef486aa2dacf549', base: '34ef0d2e2808bf3a7347b1b4352ac8babdfb645c',
  path: 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb',
  bodySha256: '3a3823e627ba0eca13d2a97945a97ca18d0225e6b5a85b6bc8d0e6bf0354a84b', bytes: 6616,
  gitBlob: '6c94d283090212a4fee016ae9310312099808756', oracleBodyAcquiredHead: '8a882c3325b0e851b859d78ad11486aa3a24112c',
});
const F = GITLAB_STANDALONE_WHOLE;
export const standaloneWholeURL = (kind) => { assert.ok(['commit', 'compare'].includes(kind));return `${ORIGIN}/${PROJECT}/-/${kind === 'commit' ? `commit/${F.head}` : `compare/${F.base}...${F.head}`}`; };
const rawURL = `${ORIGIN}/${PROJECT}/-/raw/${F.head}/${F.path}`;
const digest = (body) => createHash('sha256').update(body).digest('hex');
const expectedFiles = [
  { path: 'app/graphql/mutations/boards/issues/issue_move_list.rb', additions: 2, deletions: 0 },
  { path: 'app/services/boards/base_item_move_service.rb', additions: 2, deletions: 0 },
  { path: F.path, additions: 32, deletions: 0 },
];
function sourceKind(value, kind) {
  try {
    const url = new URL(value);if (url.origin !== ORIGIN || url.username || url.password || url.hash) return null;
    if (url.pathname.startsWith(`/${PROJECT}/-/raw/`)) return 'raw';
    const prefix = `/${PROJECT}/-/${kind === 'commit' ? `commit/${F.head}` : 'compare'}`;
    const type = url.pathname === `${prefix}/diff_files_metadata` ? 'metadata' : url.pathname === `${prefix}/diffs_stats` ? 'stats' : url.pathname === (kind === 'commit' ? `${prefix}.diff` : `/${PROJECT}/-/compare/${F.base}...${F.head}`) ? 'patch' : null;
    if (!type) return null;
    const allowed = kind === 'commit' ? [] : type === 'patch' ? ['format'] : ['from', 'to'];
    if ([...url.searchParams.keys()].some((key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) return null;
    if (kind === 'compare' && (type === 'patch' ? url.search !== '?format=diff' : url.searchParams.get('from') !== F.base || url.searchParams.get('to') !== F.head)) return null;
    return type;
  } catch { return null; }
}

/** Passive bounded responses already requested by the installed page; never an oracle fetch. */
export function observeStandaloneWhole(page, proof, { kind, extensionId, safeUrl = (url) => url }) {
  proof.requests = [];proof.responses = [];proof.nonReadRequests = [];proof.truncated = false;const pending = new Set();let total = 0, disposed = false;
  const request = (value) => {
    const url = value.url();let parsed;try { parsed = new URL(url); } catch { return; }
    let extension = false, stack;try { stack = value.initiator?.()?.stack; } catch { /* Attribution remains unknown. */ }
    for (let i = 0; stack && i < 8; i++, stack = stack.parent) extension ||= (stack.callFrames ?? []).some((frame) => frame.url?.startsWith(`chrome-extension://${extensionId}/`));
    if (parsed.origin !== ORIGIN && !extension) return;
    const record = { url: safeUrl(url), method: value.method(), kind: sourceKind(url, kind), extensionFrameObserved: extension };
    if (proof.requests.length < 1000) proof.requests.push(record);else proof.truncated = true;
    if (!['GET', 'HEAD'].includes(record.method)) { if (proof.nonReadRequests.length < 100) proof.nonReadRequests.push(record);else proof.truncated = true; }
  };
  const response = (value) => {
    const type = sourceKind(value.url(), kind);if (!type) return;
    if (proof.responses.length + pending.size >= 32) { proof.truncated = true;return; }
    const work = (async () => {
      const item = { kind: type, url: safeUrl(value.url()), status: value.status(), redirected: value.request().redirectChain().length !== 0, fromCache: value.fromCache?.() ?? null, contentType: value.headers()['content-type'] ?? null };
      try {
        const length = value.headers()['content-length'];if (length && (!/^\d+$/.test(length) || Number(length) > 512 * 1024)) throw Error('Observed source response exceeds512KiB');
        const body = await value.buffer();total += body.length;if (body.length > 512 * 1024 || total > 2 * 1024 * 1024) throw Error('Observed source evidence exceeds bounds');
        item.bytes = body.length;item.sha256 = digest(body);const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        if (type === 'raw') { item.lines = text.split(/\r?\n/);item.gitBlob = createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex'); }
        else if (type === 'patch') item.files = parseUnifiedDiff(text).map(({ path, additions, deletions }) => ({ path, additions, deletions }));
        else { const json = JSON.parse(text);item.overflow = json.render_overflow_warning === true;item.projection = type === 'stats' ? json.diffs_stats : Array.isArray(json.diff_files) ? json.diff_files.map((file) => ({ path: file.new_path, oldPath: file.old_path, additions: file.added_lines, deletions: file.removed_lines, deleted: file.deleted_file, submodule: file.submodule })) : null; }
      } catch (error) { item.error = error.message; }
      proof.responses.push(item);
    })();pending.add(work);void work.finally(() => pending.delete(work));
  };
  page.on('request', request);page.on('response', response);
  const checkpoint = async () => { await Promise.all([...pending]);return proof; };
  const acquisition = async () => { await checkpoint();assertStandaloneAcquisition(proof);return { all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 }, basis: 'Observed complete immutable standalone metadata, stats and unified patch agree with the retained original fixture.' }; };
  return { checkpoint, acquisition, raw: async () => { await checkpoint();return proof.responses.filter((item) => item.kind === 'raw'); }, dispose: async () => { if (disposed) return;disposed = true;page.off('request', request);page.off('response', response);await checkpoint();proof.disposed = true; } };
}

export function assertStandaloneAcquisition(proof) {
  assert.equal(proof.truncated, false);assert.equal(proof.nonReadRequests.some((request) => request.extensionFrameObserved), false, 'Extension initiated an unexpected provider write/other non-read request');
  for (const kind of ['metadata', 'stats', 'patch']) {
    const found = proof.responses.filter((item) => item.kind === kind);assert.ok(found.length > 0, `Missing observed standalone ${kind}`);
    for (const item of found) {
      assert.equal(item.status, 200);assert.equal(item.redirected, false);assert.equal(item.error, undefined);assert.notEqual(item.overflow, true);
      if (kind === 'metadata') { assert.ok(Array.isArray(item.projection));assert.deepEqual(item.projection.map(({ path, additions, deletions }) => ({ path, additions, deletions })), expectedFiles);assert.ok(item.projection.every((file) => file.deleted === false && file.submodule === false && file.oldPath === file.path)); }
      if (kind === 'patch') assert.deepEqual(item.files, expectedFiles);
      if (kind === 'stats') for (const [key, expected] of Object.entries({ added_lines: 36, removed_lines: 0, diffs_count: 3, real_size: 3 })) assert.equal(Number(item.projection?.[key]), expected);
    }
  }
}

/** Independent original native standalone projection. No provider/controller calls or source writes. */
export function standaloneWholeProbe(action = 'read', argument = null) {
  const KEY = '__geldStandaloneWhole';let store = globalThis[KEY];
  if (action === 'cleanup') { store?.cleanup();delete globalThis[KEY];return { removed: !Object.hasOwn(globalThis, KEY) }; }
  const head = '13215ca460cd4f75d3765a882ef486aa2dacf549', base = '34ef0d2e2808bf3a7347b1b4352ac8babdfb645c', path = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb', owner = 'gitlab-org/gitlab', origin = 'https://gitlab.com';
  const header = ':scope > article.rd-diff-file > .rd-diff-file-header-sticky > header[data-testid="rd-diff-file-header"] > .rd-diff-file-header-main > h2.rd-diff-file-title > a.rd-diff-file-link';
  const allowed = (node) => node instanceof Element && node.closest('[data-geld-ui],[hidden],[inert],[aria-hidden="true"],form,textarea,button,[role="button"],[contenteditable],dialog,[role="dialog"],[role="tooltip"],[popover],.note,.note-text,.md,[data-testid="noteable-note-container"],[data-testid="description-content"]') === null;
  const plain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  const resource = (value, suffix) => { try { const url = new URL(value, origin);return typeof value === 'string' && url.href === `${origin}/${owner}/-/${suffix}`; } catch { return false; } };
  const currentFrame = () => {
    const url = new URL(location.href), kind = url.pathname === `/${owner}/-/commit/${head}` ? 'commit' : url.pathname === `/${owner}/-/compare/${base}...${head}` ? 'compare' : null;
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !kind) return null;
    const body = document.body, bodyFields = ['data-project-full-path', 'data-project-id', 'data-page', 'data-page-type-id'].map((name) => body.getAttribute(name));
    if (!allowed(body) || !body.isConnected || bodyFields[0] !== owner || bodyFields[1] !== '278964' || bodyFields[2] !== `projects:${kind}:show` || bodyFields[3] !== (kind === 'commit' ? head : null)) return null;
    const apps = [...document.querySelectorAll('[data-rapid-diffs][data-app-data]')].filter(allowed);if (apps.length !== 1) return null;const app = apps[0], serialized = app.getAttribute('data-app-data');let data;try { data = JSON.parse(serialized); } catch { return null; }
    if (!plain(data) || Object.hasOwn(data, 'project_path') || Object.hasOwn(data, 'versions') || Object.hasOwn(data, 'mr_path') || Object.hasOwn(data, 'is_fork') && data.is_fork !== false && data.is_fork !== 'false' || Object.hasOwn(data, 'noteable_type') && (kind !== 'commit' || data.noteable_type !== 'Commit')) return null;
    const route = kind === 'commit' ? `commit/${head}` : 'compare', params = kind === 'commit' ? '' : `?from=${base}&to=${head}`;
    for (const [field, suffix] of Object.entries({ diff_files_endpoint: 'diff_files_metadata', diffs_stats_endpoint: 'diffs_stats', diff_file_endpoint: 'diff_file', reload_stream_url: 'diffs_stream' })) if (!resource(data[field], `${route}/${suffix}${params}`)) return null;
    if (Object.hasOwn(data, 'diffs_stream_url') && data.diffs_stream_url !== null && !resource(data.diffs_stream_url, `compare/diffs_stream?from=${base}&to=${head}&view=inline`)) return null;
    let selection = null;
    if (kind === 'compare') {
      const roots = [...document.querySelectorAll('[data-gitlab-vue3-app="CompareAppRoot"]')].filter(allowed);if (roots.length !== 1) return null;const compare = roots[0], forms = compare.querySelectorAll(':scope > [data-testid="base-layout-content"] > form.js-signature-container'), form = forms[0];
      if (forms.length !== 1 || !(form instanceof HTMLFormElement) || form.hidden || form.inert || form.getAttribute('aria-hidden') === 'true' || !allowed(form.parentElement) || form.method.toUpperCase() !== 'POST' || !resource(form.getAttribute('action'), 'compare')) return null;
      const inputs = [];
      for (const [name, expected] of [['to_project_id', '278964'], ['from_project_id', '278964'], ['to', head], ['from', base]]) { const found = form.querySelectorAll(`input[name="${name}"]`), input = found[0];if (found.length !== 1 || !(input instanceof HTMLInputElement) || input.type !== 'hidden' || input.closest('form') !== form || input.value !== expected) return null;inputs.push(input); }
      const radios = [...form.querySelectorAll('input[name="straight"]')];if (radios.length !== 2 || !radios.every((input) => input instanceof HTMLInputElement && input.type === 'radio' && input.closest('form') === form) || new Set(radios.map((input) => input.value)).size !== 2 || !radios.every((input) => ['false', 'true'].includes(input.value)) || radios.filter((input) => input.checked).length !== 1 || !radios.some((input) => input.checked && input.value === 'false')) return null;
      inputs.push(...radios);selection = { root: compare, parent: compare.parentElement, form, formParent: form.parentElement, formKey: [form.getAttribute('action'), form.getAttribute('method'), form.getAttribute('class')], inputs, values: inputs.map((input) => [input.name, input.type, input.value, input.checked]) };
    }
    const files = [...app.querySelectorAll('diff-file[data-file-data]')].filter((node) => { try { return allowed(node) && JSON.parse(node.getAttribute('data-file-data')).new_path === path; } catch { return false; } });if (files.length !== 1) return null;
    const root = files[0], fileText = root.getAttribute('data-file-data');let file;try { file = JSON.parse(fileText); } catch { return null; }
    if (!plain(file) || file.viewer !== 'text_inline' || file.deleted_file === true || file.submodule === true || file.old_path !== path || !resource(file.diff_lines_path, `blob/${head}/${path}/diff_lines`)) return null;
    if (Object.hasOwn(file, 'blob_raw_path') && !resource(file.blob_raw_path, `raw/${head}/${path}`)) return null;
    if (Object.hasOwn(file, 'diff_refs') && (!plain(file.diff_refs) || file.diff_refs.head_sha !== head || ['base_sha', 'start_sha'].some((key) => Object.hasOwn(file.diff_refs, key) && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(file.diff_refs[key])))) return null;
    const links = root.querySelectorAll(header), link = links[0];if (links.length !== 1 || !(link instanceof HTMLAnchorElement) || !allowed(link) || !resource(link.getAttribute('href'), `blob/${head}/${path}`)) return null;
    return { kind, url: url.href, body, bodyFields, app, appParent: app.parentElement, serialized, selection, root, parent: root.parentElement, fileText, link, linkParent: link.parentElement, href: link.getAttribute('href') };
  };
  const frame = currentFrame();if (!frame) return store ? { sameOriginal: false, frameCurrent: false } : null;
  const root = frame.root;
  const rows = () => [...root.querySelectorAll('tr.rd-hunk-lines-inline,tr.rd-hunk-lines-parallel')].filter(allowed).map((row) => {
    const number = row.querySelector('.rd-line-number[data-position="new"] a[data-line-number]')?.getAttribute('data-line-number'), cell = row.matches('.rd-hunk-lines-parallel') ? row.querySelector('td.rd-line-content[data-position="new"]') : row.querySelector('td.rd-line-content');const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT), texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push([node, node.data]);
    return { node: row, parent: row.parentElement, html: row.innerHTML, attrs: [...row.attributes].filter((attr) => attr.name !== 'data-geld-provider-line-hidden').map((attr) => [attr.name, attr.value]), texts, number: number && /^[1-9]\d*$/.test(number) ? Number(number) : null, text: cell?.querySelector('.rd-line-text')?.textContent?.replace(/\n$/, '') ?? null, ids: [...row.querySelectorAll('[id]')].map((node) => [node, node.id]), links: [...row.querySelectorAll('a[href]')].map((node) => [node, node.getAttribute('href')]) };
  });
  const controls = () => [...root.querySelectorAll('table.rd-text-view-root tr.rd-hunk-header[data-hunk-header] button[data-click="expandLines"][data-expand-direction]')].filter((button) => button.closest('diff-file') === root && allowed(button.parentElement) && !button.closest('tr').querySelector('.rd-line-content') && ['up', 'down', 'both'].includes(button.dataset.expandDirection));
  const gap = (button) => { const sequence = [...root.querySelectorAll('tr')], index = sequence.indexOf(button.closest('tr')), numbered = new Map(rows().map((row) => [row.node, row.number]));return { direction: button.dataset.expandDirection, beforeNew: sequence.slice(0, index).map((row) => numbered.get(row) ?? null).findLast((n) => n !== null) ?? null, afterNew: sequence.slice(index + 1).map((row) => numbered.get(row) ?? null).find((n) => n !== null) ?? null }; };
  const checkboxes = () => [...root.querySelectorAll('input[data-viewed-checkbox],[data-testid="fileReviewCheckbox"] input')].filter((node) => node.closest('[data-geld-ui]') === null);
  const theme = () => ({ classes: [...document.documentElement.classList].filter((name) => /theme|dark|light/.test(name)), osDark: matchMedia('(prefers-color-scheme: dark)').matches, body: ['fontFamily', 'fontSize', 'lineHeight', 'color', 'backgroundColor'].map((key) => getComputedStyle(document.body)[key]) });
  if (action === 'setup') {
    if (store) throw Error('Standalone source observation already exists');const source = rows();if (!source.length || source.length > 500 || source.reduce((n, row) => n + row.texts.length, 0) > 10000) throw Error('Original source row inventory unavailable');
    store = { frame, rows: source, viewed: checkboxes().map((node) => ({ node, checked: node.checked, disabled: node.disabled })), theme: theme(), events: [], expected: null, focus: null };
    store.listen = (event) => { if (!(event.target instanceof Element)) return;if (event.type === 'click' && store.expected?.contains(event.target)) store.lastClick = { trusted: event.isTrusted === true, label: store.expected.getAttribute('aria-label') ?? store.expected.textContent, url: location.href };
      if (root.contains(event.target)) { const button = event.target.closest('button[data-click="expandLines"][data-expand-direction]');if (button) store.events.push({ kind: 'context', type: event.type, trusted: event.isTrusted === true, nativeOwned: controls().includes(button), ...gap(button) });if (store.viewed.some(({ node }) => node === event.target)) store.events.push({ kind: 'viewed', type: event.type, trusted: event.isTrusted === true }); }
    };for (const type of ['click', 'input', 'change']) document.addEventListener(type, store.listen, true);store.cleanup = () => { for (const type of ['click', 'input', 'change']) document.removeEventListener(type, store.listen, true); };globalThis[KEY] = store;
  }
  if (!store) return { eligible: true, kind: frame.kind, headSha: head, path, absentAppOwner: true };
  const before = store.frame, equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sameFrame = ['body', 'app', 'appParent', 'root', 'parent', 'link', 'linkParent', 'url', 'serialized', 'fileText', 'href'].every((key) => before[key] === frame[key]) && equal(before.bodyFields, frame.bodyFields)
    && (before.selection === null ? frame.selection === null : frame.selection !== null && ['root', 'parent', 'form', 'formParent'].every((key) => before.selection[key] === frame.selection[key]) && equal(before.selection.formKey, frame.selection.formKey) && equal(before.selection.values, frame.selection.values) && before.selection.inputs.every((input, i) => input === frame.selection.inputs[i]));
  const now = rows();const sameRows = (store.firstRows ?? store.rows).every((old) => { const row = now.find((entry) => entry.node === old.node);return row && row.parent === old.parent && row.html === old.html && equal(row.attrs, old.attrs) && row.number === old.number && row.text === old.text && row.texts.length === old.texts.length && row.texts.every(([node, text], i) => node === old.texts[i][0] && text === old.texts[i][1]) && row.ids.length === old.ids.length && row.ids.every(([node, id], i) => node === old.ids[i][0] && id === old.ids[i][1]) && row.links.length === old.links.length && row.links.every(([node, href], i) => node === old.links[i][0] && href === old.links[i][1]); });
  const intact = sameFrame && sameRows, viewed = checkboxes(), unchangedViewed = viewed.length === store.viewed.length && store.viewed.every(({ node, checked, disabled }) => viewed.includes(node) && node.checked === checked && node.disabled === disabled);
  const category = (target) => [...document.querySelectorAll('.geld-provider-category-header')].filter((button) => button.closest('[data-geld-ui]') !== null && new RegExp(`^${target}\\b`).test(button.textContent.trim()));
  const intents = root.querySelectorAll('header[data-testid="rd-diff-file-header"] > .rd-diff-file-info > button[data-geld-ui][data-geld-test-boundaries]'), intent = intents.length === 1 ? intents[0] : null;
  const folds = [...root.querySelectorAll('[data-geld-provider-fold-row^="test:"]')].map((row) => ({ button: row.querySelector('button'), key: row.getAttribute('data-geld-provider-fold-row'), kind: row.dataset.kind, status: row.dataset.status, focused: document.activeElement === row.querySelector('button'), title: row.querySelector('.geld-provider-line-fold__title')?.textContent ?? '', start: Number(row.querySelector('.geld-provider-line-fold__line')?.textContent), expanded: row.querySelector('button')?.getAttribute('aria-expanded'), label: row.querySelector('button')?.getAttribute('aria-label') ?? '' }));
  const buttonFor = (target) => { if (!intact || !unchangedViewed) return null;if (target === 'intent') return intent;if (target === 'Tests' || target === 'Essential') { const found = category(target);return found.length === 1 ? found[0] : null; }const found = folds.filter((fold) => fold.start === target);return found.length === 1 ? found[0].button : null; };
  if (action === 'button') return buttonFor(argument);
  if (action === 'arm') { if (!(argument instanceof HTMLButtonElement) || ![intent, ...folds.map((fold) => fold.button), ...category('Tests'), ...category('Essential')].includes(argument) || !intact || !unchangedViewed) return false;store.expected = argument;store.lastClick = null;return true; }
  if (action === 'click-result') return store.lastClick ?? null;
  if (action === 'retain-first') { if (!intact || !unchangedViewed) throw Error('Original source changed before second test');store.firstRows = now; }
  if (action === 'capture-arm') store.focus = document.activeElement;
  if (action === 'guard') {
    const button = argument, rect = button?.getBoundingClientRect(), clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };let presented = button instanceof HTMLButtonElement && button.isConnected && !button.disabled;
    for (let node = button; node instanceof Element; node = node.parentElement) { const css = getComputedStyle(node);if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true' || css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility) || Number(css.opacity) === 0 || css.contentVisibility === 'hidden') presented = false;if (node !== button) { const r = node.getBoundingClientRect();if (/^(auto|scroll|overlay|hidden|clip)$/.test(css.overflowX || css.overflow)) { clip.left = Math.max(clip.left, r.left + node.clientLeft);clip.right = Math.min(clip.right, r.left + node.clientLeft + node.clientWidth); }if (/^(auto|scroll|overlay|hidden|clip)$/.test(css.overflowY || css.overflow)) { clip.top = Math.max(clip.top, r.top + node.clientTop);clip.bottom = Math.min(clip.bottom, r.top + node.clientTop + node.clientHeight); } } }
    const x = rect ? (rect.left + rect.right) / 2 : NaN, y = rect ? (rect.top + rect.bottom) / 2 : NaN, inClip = !!rect && rect.width > 0 && rect.height > 0 && x > clip.left && x < clip.right && y > clip.top && y < clip.bottom, hit = inClip ? document.elementFromPoint(x, y) : null;
    return { sameOriginal: intact, unchangedViewed, frameCurrent: sameFrame, themeUnchanged: equal(theme(), store.theme), currentControl: [intent, ...folds.map((fold) => fold.button), ...category('Tests'), ...category('Essential')].includes(button), presented, inClip, centerHit: hit !== null && button.contains(hit), focused: document.activeElement === button, bounds: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null, clip, hit: hit ? { tag: hit.tagName, owned: hit.closest('[data-geld-ui]') !== null } : null };
  }
  return { kind: frame.kind, url: frame.url, path, headSha: head, rawPath: `/${owner}/-/raw/${head}/${path}`, absentAppOwner: true, frameCurrent: sameFrame, sameOriginal: intact, unchangedViewed, themeUnchanged: equal(theme(), store.theme), focusStable: store.focus === null || document.activeElement === store.focus,
    visible: getComputedStyle(root).display !== 'none' && root.getBoundingClientRect().height > 0, sourceRows: now.map((row) => ({ number: row.number, text: row.text, hidden: row.node.hasAttribute('data-geld-provider-line-hidden') })), folds: folds.map(({ button, ...fold }) => fold), controls: controls().map(gap), events: [...store.events], intent: intent ? { label: intent.textContent, status: intent.dataset.status, disabled: intent.disabled } : null,
    categories: [...document.querySelectorAll('.geld-provider-category-header')].map((button) => ({ text: button.textContent.trim(), expanded: button.getAttribute('aria-expanded') })), originalFrame: { bodyFields: [...frame.bodyFields], appOwnerAbsent: true, appEndpoints: Object.fromEntries(['diff_files_endpoint', 'diffs_stats_endpoint', 'diff_file_endpoint', 'reload_stream_url'].map((name) => [name, JSON.parse(frame.serialized)[name]])), headerHref: frame.href, selection: frame.selection ? { values: frame.selection.values, form: frame.selection.formKey } : null } };
}

export function assertStandaloneControl(value, keyboard = false) {
  for (const key of ['sameOriginal', 'unchangedViewed', 'frameCurrent', 'themeUnchanged', 'currentControl', 'presented', 'inClip', 'centerHit']) assert.equal(value?.[key], true, `Owned standalone input guard failed: ${key}`);
  if (keyboard) assert.equal(value.focused, true, 'Real Enter requires the exact current focused owned control');
}
/** Follow only the current equivalent control for this exact open leaf/source; never manufacture focus. */
export function assertStandaloneKeyboardFocus(sample, expected) {
  for (const key of ['sameOriginal', 'frameCurrent', 'unchangedViewed', 'themeUnchanged']) assert.equal(sample?.[key], true);
  assert.equal(expected?.start, 96);assert.equal(expected.title, 'generates an error');assert.match(expected.key ?? '', /^test:/);
  const matches = sample.folds.filter((fold) => fold.start === expected.start);assert.equal(matches.length, 1);const current = matches[0];
  assert.equal(current.key, expected.key);assert.equal(current.title, expected.title);assert.equal(current.kind, 'test');assert.equal(current.status, 'unchanged');assert.equal(current.expanded, 'true');assert.equal(current.focused, true, 'Enter-opened standalone leaf96 lost focus to BODY or another control');
}
export function assertStandaloneFirstMounted(sample, response, expected) {
  assertWholeTestMounted(sample, response);assertStandaloneKeyboardFocus(sample, expected);
  const clicks = sample.events.filter((event) => event.kind === 'context' && event.type === 'click');
  assert.equal(clicks[0]?.direction, 'up');assert.equal(clicks[0]?.beforeNew, null);assert.equal(clicks[0]?.afterNew, 100);assert.ok(clicks.every((event) => event.trusted === false), 'The harness must use owned trusted Show, with only product-relayed original native clicks');
}
export function assertStandaloneSettings(current, original, outline) {
  const known = new Set(Object.keys(normalizeSettings({}))), unknown = (settings) => Object.fromEntries(Object.entries(settings).filter(([key]) => !known.has(key)));
  assert.deepEqual(unknown(current), unknown(original), 'Unknown shared settings changed');assert.deepEqual(normalizeSettings(current), normalizeSettings({ ...original, testOutline: outline }), 'Unrelated effective shared preferences changed');
  for (const key of ['trustedReviewAccounts', 'trustedSummaryPublishers']) { assert.equal(Object.hasOwn(current, key), Object.hasOwn(original, key));assert.deepEqual(current[key], original[key]); }
  assert.equal(normalizeSettings(current).aiEnabled, false);return { effectiveEqual: true, otherRawEqual: isDeepStrictEqual({ ...current, testOutline: null }, { ...original, testOutline: null }) };
}
export function qualifyStandaloneRaw(sample, response) {
  assert.equal(sample.absentAppOwner, true);assert.equal(sample.frameCurrent, true);assert.equal(sample.headSha, F.head);assert.equal(response.url, rawURL);assert.equal(response.bytes, F.bytes);assert.equal(response.gitBlob, F.gitBlob);assert.equal(response.error, undefined);assert.match(response.contentType ?? '', /^(?:text\/(?!html\b)[^;]+|application\/octet-stream)(?:;|$)/i);
  const result = qualifyGitLabWholeResponse(sample, response);
  return { ...result, provenance: { runtimeRawHead: F.head, oracleBodyAcquiredHead: F.oracleBodyAcquiredHead, retainedStandaloneDiffNewGitBlob: F.gitBlob, runtimeGitBlob: response.gitBlob, scope: 'Fresh runtime response at13215…; the independently retained8a… body supplies the byte oracle only through identical full Git blob identity.' } };
}

/** Trusted owned intent and Show only; no native direct click, provider fetch, fake row or runtime injection. */
export async function verifyStandaloneWhole(page, progress, { kind, observer, poll, capture, readSettings, writeSettings, readState }) {
  progress.status = 'running';progress.kind = kind;progress.actions = [];let original, setup = false, prepared = false, confirmed = false, failure;
  const read = () => page.evaluate(standaloneWholeProbe);
  const intact = (sample) => { for (const key of ['sameOriginal', 'frameCurrent', 'unchangedViewed', 'themeUnchanged']) assert.equal(sample?.[key], true, `Standalone source changed: ${key}`); };
  const counts = async () => { const state = await readState();assertDisplayedOutlineCounts(progress.beforeCounts ?? state, state);return state; };
  const checked = async () => { const sample = await read();intact(sample);assertStandaloneSettings(await readSettings(), original, prepared ? true : normalizeSettings(original).testOutline);await counts();assertStandaloneAcquisition(await observer.checkpoint());return sample; };
  const click = async (target, keyboard = false) => {
    const action = { target, mode: keyboard ? 'Enter' : 'pointer', status: 'running' };progress.actions.push(action);const handle = await page.evaluateHandle(standaloneWholeProbe, 'button', target);
    try { const button = handle.asElement();assert.ok(button, 'Current original owned standalone control unavailable');await button.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }));if (keyboard) await button.focus();await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));action.guard = await page.evaluate(standaloneWholeProbe, 'guard', button);assertStandaloneControl(action.guard, keyboard);await checked();assert.equal(await page.evaluate(standaloneWholeProbe, 'arm', button), true);if (keyboard) await page.keyboard.press('Enter');else await button.click();action.event = await page.evaluate(standaloneWholeProbe, 'click-result');assert.equal(action.event?.trusted, true);action.status = 'input_observed';return action; }
    finally { await handle.dispose(); }
  };
  const captureChecked = async (name, validate) => { const entry = { name: `${kind}-standalone-${name}`, fullPage: false, status: 'preparing', stages: [] };(progress.captures ??= []).push(entry);try { const before = await checked();await validate(before);const armed = await page.evaluate(standaloneWholeProbe, 'capture-arm');intact(armed);await validate(armed);entry.status = 'armed';const files = await capture(page, entry.name, { fullPage: false, onStage: async (stage) => { entry.stages.push(stage);const value = await checked();assert.equal(value.focusStable, true, 'Viewport capture changed original focus');await validate(value); } });entry.files = files;const after = await checked();assert.equal(after.focusStable, true);await validate(after);entry.status = 'complete';return { files, after }; } catch (error) { entry.status = 'failed';entry.error = error.message;throw error; } };
  try {
    original = structuredClone(await readSettings());assert.equal(normalizeSettings(original).testOutline, false);assert.equal(normalizeSettings(original).enabled, true);assert.equal(normalizeSettings(original).aiEnabled, false);
    try { const observed = await poll(async () => { try { return { available: true, value: await observer.acquisition() }; } catch (error) { return { available: false, reason: error.message }; } }, (value) => value.available, 'Actual complete immutable standalone source responses', 15_000);progress.acquisition = observed.value; } catch (error) { progress.status = 'unavailable';progress.reason = `Fresh complete standalone acquisition unavailable: ${error.message}`; }
    if (progress.status !== 'unavailable') {
      const preview = await page.evaluate(standaloneWholeProbe);if (!preview?.eligible || preview.kind !== kind) { progress.status = 'unavailable';progress.reason = 'Current original absent-owner standalone body/app/header/selection format is unavailable.'; }
      else {
        progress.beforeCounts = await counts();progress.initial = await page.evaluate(standaloneWholeProbe, 'setup');setup = true;intact(progress.initial);assert.equal(progress.initial.intent, null);assert.equal(progress.initial.folds.length, 0);
        const present = new Set(progress.initial.sourceRows.map((row) => row.number));if (![100, 131].every((n) => present.has(n)) || [96, 97, 98, 99, 125, 126, 127, 128, 129, 130].some((n) => present.has(n))) { progress.status = 'unavailable';progress.reason = 'The retained genuinely partial leaves are not partial in this original native visit.'; }
        else {
          confirmed = true;progress.fixtureConfirmed = true;assert.equal((await observer.raw()).length, 0);assert.equal((await observer.checkpoint()).requests.filter((request) => request.kind === 'raw').length, 0, 'No raw source before genuine file intent');
          await click('Tests');await poll(read, (sample) => { intact(sample);return sample.visible; }, 'Original Tests source shown', 8000);
          prepared = true;await writeSettings({ ...structuredClone(original), testOutline: true });assertStandaloneSettings(await readSettings(), original, true);
          progress.beforeIntent = await poll(read, (sample) => { intact(sample);return sample.folds.length === 3 && sample.intent !== null; }, 'New absent-owner standalone branch mounts idle Find', 8000);assert.equal(progress.beforeIntent.intent.status, 'idle');assert.equal(progress.beforeIntent.intent.disabled, false);assert.equal((await observer.raw()).length, 0);
          progress.find = await click('intent');progress.found = await poll(read, (sample) => { intact(sample);if (sample.intent?.status === 'failed') throw Error('Installed standalone whole-file source failed');return sample.intent?.status === 'ready'; }, 'Actual standalone immutable whole-body acquisition', 20_000);
          const responses = await observer.raw();assert.equal(responses.length, 1);progress.source = qualifyStandaloneRaw(progress.beforeIntent, responses[0]);const body = responses[0];progress.find.status = 'complete';
          progress.beforeUnfold = await checked();for (const [start, title] of [[96, 'generates an error'], [125, 'moves and repositions issue']]) { const fold = progress.beforeUnfold.folds.find((row) => row.start === start);assert.equal(fold?.title, title);assert.equal(fold.expanded, 'false');assert.match(fold.label, /Only displayed lines are available/); }assert.deepEqual(progress.beforeUnfold.events, [], 'Find must never activate original context');
          progress.boundariesCapture = await captureChecked('boundaries', (sample) => { assert.deepEqual(sample.events, []); });
          progress.keyboardLeaf = progress.beforeUnfold.folds.find((fold) => fold.start === 96);progress.first = await click(96, true);progress.firstMounted = await poll(read, (sample) => { intact(sample);try { assertStandaloneFirstMounted(sample, body, progress.keyboardLeaf);return true; } catch { return false; } }, 'First original standalone test mounted with its own retained keyboard focus', 30_000);assertStandaloneFirstMounted(progress.firstMounted, body, progress.keyboardLeaf);progress.first.postInputFocus = 'current owned leaf96';progress.first.status = 'complete';progress.firstLeafStatus = 'passed';progress.firstCapture = await captureChecked('first-test', (sample) => assertStandaloneFirstMounted(sample, body, progress.keyboardLeaf));
          progress.firstCheckpoint = await page.evaluate(standaloneWholeProbe, 'retain-first');assertWholeTestMounted(progress.firstCheckpoint, body);progress.beforeSecond = await checked();assert.equal(progress.beforeSecond.controls.filter((control) => control.direction === 'both' && control.beforeNew === 115 && control.afterNew === 131).length, 1);
          progress.second = await click(125);progress.secondMounted = await poll(read, (sample) => { intact(sample);try { assertSecondWholeTestMounted(sample, body, progress.beforeSecond);return true; } catch { return false; } }, 'Second original standalone BOTH test fully mounted', 30_000);assertSecondWholeTestMounted(progress.secondMounted, body, progress.beforeSecond);progress.second.status = 'complete';progress.secondLeafStatus = 'passed';progress.secondCapture = await captureChecked('both-tests', (sample) => assertSecondWholeTestMounted(sample, body, progress.beforeSecond));
          assert.equal((await observer.raw()).length, 1);assert.equal((await observer.checkpoint()).requests.filter((request) => request.kind === 'raw').length, 1, 'Both tests must reuse one exact raw response in this content runtime');progress.afterCounts = await counts();progress.status = 'passed';
        }
      }
    }
  } catch (error) { failure = error;progress.status = 'failed';progress.error = error.message; }
  finally {
    try {
      if (original !== undefined) { const current = await readSettings();assertStandaloneSettings(current, original, prepared ? true : normalizeSettings(original).testOutline);if (prepared) await writeSettings(structuredClone(original));prepared = false;const restored = await readSettings();assertStandaloneSettings(restored, original, normalizeSettings(original).testOutline);assert.equal(Object.hasOwn(restored, 'testOutline'), Object.hasOwn(original, 'testOutline'));assert.deepEqual(restored.testOutline, original.testOutline);progress.settingsRestored = true; }
      if (setup) { if (page.isClosed()) throw Error('Original standalone source closed before restoration');progress.restored = await poll(read, (sample) => { intact(sample);return sample.intent === null && sample.folds.length === 0 && sample.sourceRows.every((row) => !row.hidden); }, 'Owned standalone outline controls restored', 8000);if (!progress.restored.categories.some((category) => /^Essential\b/.test(category.text) && category.expanded === 'true')) await click('Essential');progress.closed = await poll(read, (sample) => { intact(sample);return !sample.visible && sample.categories.some((category) => /^Essential\b/.test(category.text) && category.expanded === 'true'); }, 'Original Essential category restored', 8000);progress.restoredCounts = await counts(); }
      if (progress.status === 'unavailable') { assert.equal(confirmed, false);assert.equal((await observer.raw()).length, 0);assert.equal((await observer.checkpoint()).requests.filter((request) => request.kind === 'raw').length, 0); }
    } catch (error) { progress.cleanupError ??= error.message;(progress.cleanupErrors ??= []).push(error.message);failure ??= error;progress.status = 'failed'; }
    finally { if (setup && !page.isClosed()) { try { progress.cleanup = await page.evaluate(standaloneWholeProbe, 'cleanup');assert.equal(progress.cleanup.removed, true); } catch (error) { progress.cleanupError ??= error.message;(progress.cleanupErrors ??= []).push(error.message);failure ??= error;progress.status = 'failed'; } }progress.observedTraffic = await observer.checkpoint();progress.limitations = ['One complete runtime13215… raw response per fresh content runtime; other-head retained body is only the Git-blob-qualified byte oracle.', 'Only the actual two new-side unchanged leaves and original UP/BOTH expansions are covered; no old-side/deleted/fork/short-ref claim.', 'Provider-owned context expansion is retained; no Viewed/provider write or native preference action is performed. Native or unattributed background non-read requests are recorded separately, not described as zero HTTP.']; }
  }
  if (failure) throw failure;return progress;
}
