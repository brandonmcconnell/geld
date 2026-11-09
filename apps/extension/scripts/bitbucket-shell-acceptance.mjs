import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

const REVIEW = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff';
const REPO = 'atlassian/bitbucket-upload-file';
const FILE = 'bitbucket-pipelines.yml';
const HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHORT_HEAD = /^[a-f0-9]{7,39}$/;
const isHeadRef = (value) => typeof value === 'string' && (HEAD.test(value) || SHORT_HEAD.test(value));
const agreesWithHead = (ref, full) => isHeadRef(ref) && HEAD.test(full) && (HEAD.test(ref) ? ref === full : full.startsWith(ref));
const COMMAND = `if [ ! -d ".changes/next-release" ]; then echo "Next release file missing, make sure to run 'semversioner add-change'"; exit 1; fi`;
const sessions = new WeakMap();

function apiUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    if (url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/')) url.pathname = url.pathname.slice('/!api'.length);
    else if (url.origin !== 'https://api.bitbucket.org' || !url.pathname.startsWith('/2.0/')) return null;
    return url;
  } catch { return null; }
}

/** Preserve optional identity fields, but never turn a malformed present field into absence. */
export function parseObservedBitbucketShellMetadata(body) {
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  assert.ok(record(body), 'Observed current PR metadata must be an object');
  const readSide = (name) => {
    if (!Object.hasOwn(body, name)) return { repo: null, hash: null };
    const side = body[name];assert.ok(record(side), `Malformed present ${name} field`);
    let repo = null;let hash = null;
    if (Object.hasOwn(side, 'repository')) {
      assert.ok(record(side.repository), `Malformed present ${name}.repository field`);
      if (Object.hasOwn(side.repository, 'full_name')) {
        repo = side.repository.full_name;
        assert.ok(typeof repo === 'string' && /^[^/\\\s:?#%\u0000-\u001f]+\/[^/\\\s:?#%\u0000-\u001f]+$/.test(repo), `Malformed present ${name}.repository.full_name field`);
      }
    }
    if (Object.hasOwn(side, 'commit')) {
      assert.ok(record(side.commit), `Malformed present ${name}.commit field`);
      if (Object.hasOwn(side.commit, 'hash')) {
        assert.ok(typeof side.commit.hash === 'string' && isHeadRef(side.commit.hash.toLowerCase()), `Malformed present ${name}.commit.hash field`);
        hash = side.commit.hash.toLowerCase();
      }
    }
    return { repo, hash };
  };
  const source = readSide('source');const destination = readSide('destination');
  let id = null;let state = null;
  if (Object.hasOwn(body, 'id')) { assert.ok(Number.isSafeInteger(body.id) && body.id > 0, 'Malformed present PR id field');id = String(body.id); }
  if (Object.hasOwn(body, 'state')) { assert.ok(typeof body.state === 'string' && body.state !== '', 'Malformed present PR state field');state = body.state; }
  return { id, state, sourceRepo: source.repo, destinationRepo: destination.repo, head: source.hash, base: destination.hash };
}

/** Observe existing browser demand only. No page/API/raw/source fetch is issued by this helper. */
export function observeBitbucketShellFixture(page, item, { safeUrl, extensionId }) {
  const evidence = { metadata: [], partialMetadata: [], commits: [], pins: [], requests: [], mutations: [], errors: [], phase: 'native_navigation' };
  const pending = new Set();
  const request = (value) => {
    const url = apiUrl(value.url());
    if (url === null) return;
    const frames = [];let stack = value.initiator?.()?.stack;
    for (let depth = 0; stack != null && depth < 8; depth += 1) { frames.push(...(stack.callFrames ?? []).map((frame) => frame.url));stack = stack.parent; }
    const observed = { url: safeUrl(value.url()), method: value.method(), at: new Date().toISOString(), phase: evidence.phase,
      extensionInitiator: frames.some((frame) => frame.startsWith(`chrome-extension://${extensionId}/`)) };
    evidence.requests.push(observed);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(value.method())) evidence.mutations.push(observed);
  };
  const response = (value) => {
    const url = apiUrl(value.url());
    if (url === null || value.request().method() !== 'GET') return;
    let path;try { path = decodeURIComponent(url.pathname); } catch { evidence.errors.push({ url: safeUrl(value.url()), error: 'Malformed observed API pathname' });return; }
    const metadata = path === `/2.0/repositories/${REPO}/pullrequests/27`;
    const commit = /^\/2\.0\/repositories\/([^/]+\/[^/]+)\/commit\/([a-f0-9]{7,64})$/i.exec(path);
    const pin = new RegExp(`^/2\\.0/repositories/${REPO}/(diff|diffstat)/([^:]+):([a-f0-9]{40}|[a-f0-9]{64})\\r([a-f0-9]{40}|[a-f0-9]{64})$`, 'i').exec(path);
    if (pin !== null && value.status() === 200 && url.searchParams.get('from_pullrequest_id') === '27' && url.searchParams.get('topic') === 'true') {
      evidence.pins.push({ sourceRepo: pin[2], head: pin[3].toLowerCase(), base: pin[4].toLowerCase(), resource: pin[1], status: 200, url: safeUrl(value.url()) });
    }
    if ((!metadata && commit === null) || value.status() !== 200) return;
    const task = (async () => {
      try {
        if (Number(value.headers()['content-length']) > 128 * 1024) throw new Error('Observed native metadata exceeds128KiB evidence bound');
        const body = await value.json();
        if (metadata) {
          const parsed = parseObservedBitbucketShellMetadata(body);
          const observed = { ...parsed, url: safeUrl(value.url()), status: 200 };
          if (Object.values(parsed).every((field) => field !== null)) evidence.metadata.push(observed);
          else evidence.partialMetadata.push(observed);
        } else if (commit !== null) {
          assert.ok(typeof body?.hash === 'string' && agreesWithHead(commit[2].toLowerCase(), body.hash.toLowerCase()), 'Observed commit response disagrees with its requested hash/ref');
          evidence.commits.push({ repo: commit[1], ref: commit[2].toLowerCase(), hash: body.hash.toLowerCase(), url: safeUrl(value.url()), status: 200 });
        }
      } catch (error) { evidence.errors.push({ url: safeUrl(value.url()), error: error instanceof Error ? error.message : String(error) }); }
    })();
    pending.add(task);void task.finally(() => pending.delete(task));
  };
  const cleanup = () => { page.off('request', request);page.off('response', response);sessions.delete(page); };
  page.on('request', request);page.on('response', response);page.once('close', cleanup);
  sessions.set(page, { evidence, flush: async () => { await Promise.all([...pending]); }, cleanup });
  item.shellNativeSources = evidence;
}

export function currentBitbucketShellHead(evidence) {
  assert.deepEqual(evidence.errors, [], 'Existing native source evidence could not be read');
  assert.deepEqual(evidence.mutations, [], 'Shell verification observed a provider mutation');
  assert.ok(evidence.metadata.length > 0 && evidence.pins.length > 0, 'Need actual current PR metadata and already-issued immutable diff comparison');
  const selected = evidence.pins.at(-1);
  assert.ok(HEAD.test(selected.head) && HEAD.test(selected.base));
  for (const pin of evidence.pins) assert.deepEqual([pin.head, pin.base, pin.sourceRepo], [selected.head, selected.base, selected.sourceRepo], 'Observed immutable comparison changed during this review');
  const resolves = (repo, ref, full) => agreesWithHead(ref, full) && (HEAD.test(ref) || evidence.commits.some((commit) => commit.repo === repo && commit.ref === ref && commit.hash === full && HEAD.test(commit.hash)));
  for (const meta of evidence.metadata) {
    assert.equal(meta.id, '27');assert.equal(meta.state, 'MERGED');assert.equal(meta.destinationRepo, REPO);assert.equal(meta.sourceRepo, selected.sourceRepo);
    assert.ok(resolves(meta.sourceRepo, meta.head, selected.head), 'Current native source commit was not resolved to the exact pinned head');
    assert.ok(resolves(REPO, meta.base, selected.base), 'Current native destination commit was not resolved to the exact pinned base');
  }
  for (const meta of evidence.partialMetadata ?? []) {
    if (meta.id !== null) assert.equal(meta.id, '27');if (meta.state !== null) assert.equal(meta.state, 'MERGED');
    if (meta.sourceRepo != null) { assert.equal(typeof meta.sourceRepo, 'string');assert.equal(meta.sourceRepo, selected.sourceRepo, 'Observed partial source repository changed'); }
    if (meta.destinationRepo != null) { assert.equal(typeof meta.destinationRepo, 'string');assert.equal(meta.destinationRepo, REPO, 'Observed partial destination repository changed'); }
    if (meta.head !== null) assert.ok(agreesWithHead(meta.head, selected.head), 'Observed partial current head changed');
    if (meta.base !== null) assert.ok(agreesWithHead(meta.base, selected.base), 'Observed partial current base changed');
  }
  return { ...selected, metadataObservations: evidence.metadata.length, basis: 'Already observed current native metadata, actual full commit resolution when abbreviated, and matching immutable comparison. No additional read or second HTTP200 count assumed.' };
}

/** Read-only browser instrumentation: references/listeners/observer live outside product DOM. */
export function bitbucketShellProbe(action = 'read', expected = null) {
  const KEY = '__geldBitbucketShellAcceptance';
  const scopes = ['plain', 'keyword', 'built_in', 'literal', 'number', 'string', 'comment', 'variable', 'subst', 'title', 'meta', 'attr'];
  const root = document.getElementById('chg-bitbucket-pipelines.yml')?.parentElement;
  const article = root?.querySelector('article[data-qa="branch-diff-file"]');
  const previous = globalThis[KEY];
  if (action === 'cleanup') { previous?.observer?.disconnect();previous?.cleanupClick?.();delete globalThis[KEY];return null; }
  if (location.href !== 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff' || root === undefined || root === null || article === null || article === undefined) return null;
  const store = previous ?? { ids: new WeakMap(), next: 1, prePaint: null, click: null, observer: null };
  globalThis[KEY] = store;
  const id = (node) => { if (!store.ids.has(node)) store.ids.set(node, store.next++);return store.ids.get(node); };
  const nodesOf = (node) => { const values = [];const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);for (let next = walk.nextNode(); next !== null; next = walk.nextNode()) if (next instanceof Text) values.push(next);return values; };
  const rows = [...article.querySelectorAll('[data-qa="code-line"]')].map((row) => {
    const number = row.querySelector('[data-key="code-line-number"]');const code = row.querySelector('[data-line-type]');
    const numberOf = (name) => { const value = number?.getAttribute(name);return value != null && /^[1-9]\d*$/.test(value) ? Number(value) : null; };
    return { row, code, old: numberOf('data-old-line-number'), next: numberOf('data-new-line-number'), text: code?.textContent ?? '', kind: code?.getAttribute('data-line-type'), nodes: code === null ? [] : nodesOf(code),
      ids: [...row.querySelectorAll('[id]')].map((node) => node.id), links: [...row.querySelectorAll('a[href]')].map((node) => [node.getAttribute('href'), node.getAttribute('aria-label')]) };
  }).filter((row) => row.code !== null && [' ', '+', '-'].includes(row.kind) && (row.old !== null || row.next !== null));
  const prefix = (side) => { const values = rows.filter((row) => row[side] !== null);let end = 0;while (end < values.length && values[end][side] === end + 1) end += 1;return values.slice(0, end); };
  const before = prefix('old');const after = prefix('next');
  const allRanges = [];const invalidRanges = [];
  for (const scope of scopes) for (const range of CSS.highlights?.get('geld-bitbucket-shell-' + scope) ?? []) {
    const row = rows.find((row) => row.code.contains(range.startContainer) && row.code.contains(range.endContainer));
    if (row === undefined || !(range instanceof StaticRange) || !(range.startContainer instanceof Text) || range.startContainer !== range.endContainer) { invalidRanges.push({ scope, connected: range.startContainer.isConnected });continue; }
    let offset = 0;for (const node of row.nodes) { if (node === range.startContainer) break;offset += node.data.length; }
    allRanges.push({ scope, old: row.old, next: row.next, rowId: id(row.row), textId: id(range.startContainer), start: offset + range.startOffset, end: offset + range.endOffset, text: range.startContainer.data.slice(range.startOffset, range.endOffset) });
  }
  const snapshot = () => rows.filter((row) => row.next !== null && row.next <= 37 || row.old !== null && row.old <= 32).map((row) => ({ row: row.row, code: row.code, text: row.text, old: row.old, next: row.next, ids: row.ids, links: row.links,
    nodes: row.nodes.map((node) => ({ node, text: node.data })), font: getComputedStyle(row.code).font }));
  const row34 = rows.find((row) => row.next === 34);
  if (action === 'observe') {
    store.observer?.disconnect();store.prePaint = null;
    const observe = () => {
      const current = globalThis[KEY];if (current === undefined) return;
      // Use this same read probe through the installed callback, never synthesize source or ranges.
      const value = bitbucketShellProbe('baseline');
      if (value?.prefixNext >= 37 && value.ownedCount === 0 && value.actualStep === true) current.prePaint = current.latestBaseline;
    };
    store.observer = new MutationObserver(observe);store.observer.observe(article, { childList: true, characterData: true, subtree: true });
  }
  const actualStep = rows.find((row) => row.next === 30)?.text === 'check-next-release: &check-next-release' && row34?.text.startsWith('    - if [ ! -d ".changes/next-release" ]; then echo ') === true && rows.find((row) => row.next === 37)?.text === 'release-dev: &release-dev';
  if (action === 'baseline') store.latestBaseline = { root, article, rows: snapshot(), permalinks: [...article.querySelectorAll('[data-qa="code-line-permalink"][id]')].map((node) => ({ node, id: node.id })) };
  const pre = store.prePaint;
  const preserved = pre === null ? null : pre.root === root && pre.article === article && pre.permalinks.every((value) => document.getElementById(value.id) === value.node && article.contains(value.node)) && pre.rows.every((old) => {
    const current = rows.find((row) => row.row === old.row);
    return current?.row === old.row && current.old === old.old && current.next === old.next && current.code === old.code && current.text === old.text && JSON.stringify(current.ids) === JSON.stringify(old.ids) && JSON.stringify(current.links) === JSON.stringify(old.links)
      && old.nodes.length === current.nodes.length && old.nodes.every((part, index) => part.node === current.nodes[index] && part.text === current.nodes[index].data) && getComputedStyle(current.code).font === old.font;
  });
  const allElements = [...article.querySelectorAll('*')];
  const controls = [...article.querySelectorAll('button[data-qa="pr-diff-show-more-lines-below"][aria-label="Show more lines below"]')].map((button) => {
    const index = allElements.indexOf(button);const earlier = rows.filter((row) => allElements.indexOf(row.row) < index).at(-1);const later = rows.find((row) => allElements.indexOf(row.row) > index);
    const rect = button.getBoundingClientRect();const style = getComputedStyle(button);const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { button, previous: earlier === undefined ? null : [earlier.old, earlier.next], next: later === undefined ? null : [later.old, later.next],
      visible: button.isConnected && !button.disabled && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && style.display !== 'none' && style.visibility !== 'hidden' && button.closest('[hidden], [inert], [aria-hidden="true"]') === null && hit !== null && button.contains(hit),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  });
  const wanted = expected === null ? null : controls.filter((control) => JSON.stringify(control.previous) === JSON.stringify(expected.previous) && JSON.stringify(control.next) === JSON.stringify(expected.next));
  const control = wanted?.length === 1 ? wanted[0] : null;
  if (action === 'scroll') { control?.button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });return { matches: wanted?.length ?? 0 }; }
  if (action === 'button') return control?.visible ? control.button : null;
  if (action === 'arm') {
    if (control?.visible !== true) throw new Error('Exact bounded native context control is not unobstructed/visible');
    store.cleanupClick?.();let resolve;let reject;const pending = new Promise((done, fail) => { resolve = done;reject = fail; });void pending.catch(() => undefined);
    const capture = (event) => { if (!(event.target instanceof Element) || !control.button.contains(event.target)) return;cleanup();resolve({ trusted: event.isTrusted, url: location.href, qa: control.button.getAttribute('data-qa'), aria: control.button.getAttribute('aria-label'), previous: control.previous, next: control.next }); };
    const cleanup = () => { clearTimeout(timer);document.removeEventListener('click', capture, true); };
    const timer = setTimeout(() => { cleanup();reject(new Error('Trusted native context click was not observed')); }, 5000);
    document.addEventListener('click', capture, true);store.cleanupClick = cleanup;store.click = pending;
    return { matches: wanted.length, previous: control.previous, next: control.next, bounds: control.bounds };
  }
  if (action === 'click-result') return store.click;
  if (action === 'selection-target') {
    if (row34 === undefined) return null;
    row34.code.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    const start = row34.text.indexOf('if [');if (start < 0) return null;const end = start + 'if ['.length;
    const at = (offset) => { let seen = 0;for (const node of row34.nodes) { if (offset <= seen + node.data.length) return { node, offset: offset - seen };seen += node.data.length; }return null; };
    const first = at(start);const last = at(end);if (first === null || last === null) return null;
    const range = document.createRange();range.setStart(first.node, first.offset);range.setEnd(last.node, last.offset);const rect = range.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { text: range.toString(), x1: rect.left + 0.1, x2: rect.right - 0.1, y: rect.top + rect.height / 2, visible: rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight && hit !== null && row34.code.contains(hit) };
  }
  const normalizeColor = (value) => { if (typeof OffscreenCanvas === 'undefined' || !CSS.supports('color', value)) return null;const context = new OffscreenCanvas(1, 1).getContext('2d');if (context === null) return null;context.fillStyle = value;return context.fillStyle; };
  const colors = row34 === undefined ? {} : Object.fromEntries([['keyword', '--ds-text-code-keywords'], ['built_in', '--ds-text-code-functions'], ['string', '--ds-text-code-strings']].map(([scope, token]) => {
    const native = getComputedStyle(row34.code).getPropertyValue(token).trim();const pseudo = getComputedStyle(row34.code, `::highlight(geld-bitbucket-shell-${scope})`).color;
    return [scope, { token, native, pseudo, nativeNormalized: normalizeColor(native), pseudoNormalized: normalizeColor(pseudo) }];
  }));
  const selection = getSelection();
  const selected = selection?.rangeCount === 1 && row34?.code.contains(selection.anchorNode) && row34.code.contains(selection.focusNode)
    ? { text: selection.toString(), anchor: id(selection.anchorNode), anchorOffset: selection.anchorOffset, focus: id(selection.focusNode), focusOffset: selection.focusOffset } : null;
  const serial = (row) => ({ old: row.old, next: row.next, text: row.text, kind: row.kind, rowId: id(row.row), codeId: id(row.code), textIds: row.nodes.map(id), ids: row.ids, links: row.links });
  return { url: location.href, file: document.getElementById('chg-bitbucket-pipelines.yml')?.id, heading: article.querySelector('h2[data-qa="bk-filepath"]')?.textContent.trim() ?? null,
    nativeIds: [...article.querySelectorAll('[data-qa="code-line-permalink"][id]')].map((node) => node.id),
    prefixOld: before.at(-1)?.old ?? 0, prefixNext: after.at(-1)?.next ?? 0, oldSource: before.map(serial), newSource: after.map(serial), rows: rows.map(serial), actualStep,
    ownedCount: allRanges.length + invalidRanges.length, ranges: allRanges, invalidRanges, prePaintSeen: pre !== null, preserved, colors, selection: selected,
    viewed: [...article.querySelectorAll('label')].filter((node) => node.textContent.trim() === 'Viewed').map((node) => ({ checked: node.querySelector('input')?.checked, disabled: node.querySelector('input')?.disabled })),
    controls: controls.map(({ button, ...value }) => value), theme: { selected: document.documentElement.getAttribute('data-theme'), colorMode: document.documentElement.getAttribute('data-color-mode') } };
}

function keyOf(node) { return isScalar(node) && typeof node.value === 'string' ? node.value : null; }
function field(node, key) { return isMap(node) ? node.items.find((pair) => keyOf(pair.key) === key)?.value : undefined; }
export function verifyBitbucketShellSource(probe) {
  assert.equal(probe.url, REVIEW);assert.equal(probe.file, 'chg-' + FILE);assert.equal(probe.heading, FILE);
  assert.ok(probe.prefixOld >= 32 && probe.prefixNext >= 37 && probe.actualStep === true, 'Actual continuous native prefix and following declaration boundary required');
  const source = probe.newSource.map((row) => row.text).join('\n') + '\n';
  const parsed = parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(parsed.errors.map((error) => error.message), [], 'Expanded actual YAML is incomplete');assert.deepEqual(parsed.warnings, []);
  const declaration = field(parsed.contents, 'check-next-release');const step = field(declaration, 'step');const script = field(step, 'script');
  assert.ok(isMap(declaration) && declaration.anchor === 'check-next-release' && isMap(step) && isSeq(script));
  assert.ok(field(step, 'runs-on') === undefined && field(step, '<<') === undefined, 'This fixture must retain its actual declared hosted shell context');
  assert.equal(script.items.length, 1);const command = script.items[0];
  assert.ok(isScalar(command) && command.type === 'PLAIN');assert.equal(command.value, COMMAND);
  assert.equal(probe.rows.find((row) => row.next === 34)?.text, '    - ' + COMMAND);
  assert.deepEqual(probe.invalidRanges, []);assert.equal(probe.prePaintSeen, true);assert.equal(probe.preserved, true, 'Syntax painting changed actual native source references/text/IDs/links/fonts');
  assert.ok(probe.nativeIds.includes('Lbitbucket-pipelines.ymlT34'));
  const row = probe.rows.find((value) => value.next === 34);assert.ok(row.links.some((link) => link[0] === '#Lbitbucket-pipelines.ymlT34' && link[1] === 'To line 34'));const ranges = probe.ranges.filter((range) => range.rowId === row.rowId);
  const covered = (scope, start, end) => { for (let offset = start; offset < end; offset += 1) if (!ranges.some((range) => range.scope === scope && range.start <= offset && range.end > offset)) return false;return true; };
  for (const [scope, word, index] of [['keyword', 'if', 0], ['keyword', 'then', COMMAND.indexOf('then')], ['keyword', 'fi', COMMAND.length - 2], ['built_in', 'echo', COMMAND.indexOf('echo')], ['built_in', 'exit', COMMAND.indexOf('exit')]]) {
    assert.equal(covered(scope, 6 + index, 6 + index + word.length), true, `Actual new34 ${word} has missing native Text StaticRange coverage`);
  }
  assert.ok(ranges.every((range) => range.start >= 6 && range.end <= row.text.length), 'YAML command prefix acquired shell ranges');
  for (const range of probe.ranges) {
    const target = probe.rows.find((value) => value.rowId === range.rowId);assert.ok(target !== undefined);
    assert.doesNotMatch(target.text, /^\s*(?:-\s+)?(?:script|after-script|pipe|variables|runs-on):/, 'YAML/Pipe configuration acquired shell ranges');
  }
  for (const [side, sourceRows] of [['old', probe.oldSource], ['next', probe.newSource]]) {
    const text = sourceRows.map((row) => row.text).join('\n') + '\n';const syntax = parseDocument(text, { uniqueKeys: true });
    assert.deepEqual(syntax.errors.map((error) => error.message), []);assert.deepEqual(syntax.warnings, []);
    const allowed = [];const protectedSpans = [];
    const walk = (node) => {
      if (isMap(node)) for (const pair of node.items) {
        if (isScalar(pair.key) && pair.key.range != null) protectedSpans.push(pair.key.range);
        const key = keyOf(pair.key);
        if (key === 'pipe' && node.range != null) protectedSpans.push(node.range);
        if (key === 'variables' && pair.value?.range != null) protectedSpans.push(pair.value.range);
        if (['script', 'after-script'].includes(key) && isSeq(pair.value)) for (const command of pair.value.items) {
          if (isScalar(command) && typeof command.value === 'string' && ['PLAIN', 'BLOCK_LITERAL'].includes(command.type) && command.range != null) allowed.push(command.range);
        }
        walk(pair.value);
      }
      else if (isSeq(node)) for (const child of node.items) walk(child);
    };
    walk(syntax.contents);
    const starts = new Map();let offset = 0;for (const row of sourceRows) { starts.set(row[side], offset);offset += row.text.length + 1; }
    for (const range of probe.ranges) {
      const target = probe.rows.find((row) => row.rowId === range.rowId);const number = target[side];if (number === null) continue;
      assert.ok(starts.has(number), 'Owned range escaped the actual continuous native source prefix');
      const start = starts.get(number) + range.start;const end = starts.get(number) + range.end;
      assert.ok(allowed.some((span) => start >= span[0] && end <= span[1]), 'Owned range touches YAML instead of an actual supported command scalar');
      assert.ok(protectedSpans.every((span) => end <= span[0] || start >= span[1]), 'Owned range touches native YAML key/Pipe/variables configuration');
    }
  }
  assert.deepEqual(Object.keys(probe.colors).sort(), ['built_in', 'keyword', 'string'], 'Actual native pseudo-highlight color samples are required');
  for (const [scope, value] of Object.entries(probe.colors)) {
    assert.ok(ranges.some((range) => range.scope === scope), `No actual ${scope} range to compare`);
    assert.ok(value.nativeNormalized !== null && value.native !== '', 'Native ADS code token unavailable');
    assert.equal(value.pseudoNormalized, value.nativeNormalized, `Actual ${scope} pseudo-highlight differs from native ADS code token`);
  }
  return { prefixOld: probe.prefixOld, prefixNext: probe.prefixNext, declaredAnchor: 'check-next-release', command: COMMAND, sourceFingerprint: createHash('sha256').update(source).digest('hex'), rangeCount: ranges.length,
    colors: probe.colors, theme: probe.theme, shell: 'Actual declared hosted /bin/sh context only; later anchor callsite overrides and a native Bash-renderer palette comparison are not inferred.' };
}

export function assertBitbucketShellCounts(beforeCounts, beforeState, afterCounts, afterState) {
  for (const key of ['files', 'additions', 'deletions']) assert.equal(afterCounts[key], beforeCounts[key], `Native ${key} changed during shell verification`);
  assert.equal(beforeState.hasDiff, true);assert.equal(afterState.hasDiff, true, 'Real tab lost its complete diff adapter');
  assert.equal(beforeState.onDiffPage, true);assert.equal(afterState.onDiffPage, true, 'Real tab lost its current diff route');
  for (const key of ['all', 'visible', 'hiddenCount', 'repository', 'repo']) assert.deepEqual(afterState[key], beforeState[key], `Real tab ${key} changed during shell verification`);
}

export async function verifyBitbucketShell(page, item, { poll, pause, tabState, bitbucketDom, capture, guardBudget }) {
  const session = sessions.get(page);assert.ok(session !== undefined, 'Shell native observer must start before actual navigation');
  const { evidence } = session;const proof = { status: 'running', clicks: [], default: null, expanded: null, selection: null, mutations: evidence.mutations };
  item.shellSyntax = proof;
  const assertHead = (head) => { const value = currentBitbucketShellHead(evidence);assert.deepEqual([value.head, value.base, value.sourceRepo], [head.head, head.base, head.sourceRepo], 'Current source identity changed during native context verification');return value; };
  const sameCounts = (actual, expected) => ['files', 'additions', 'deletions'].every((key) => actual[key] === expected[key]);
  try {
    await session.flush();const head = currentBitbucketShellHead(evidence);proof.head = head;
    assert.equal(page.url(), REVIEW);
    const baseline = await poll(() => page.evaluate(bitbucketShellProbe), (value) => value !== null && value.heading === FILE && value.rows.some((row) => row.next === 34), 'Actual native Pipelines file context');
    assert.equal(baseline.rows.find((row) => row.old === 18 && row.next === 16)?.text, '          - docker');
    assert.equal(baseline.rows.find((row) => row.old === 29 && row.next === 27)?.text, '          - pipe: atlassian/git-secrets-scan:3.0.0');
    assert.equal(baseline.rows.find((row) => row.next === 34)?.text, '    - ' + COMMAND);
    assert.equal(baseline.prefixOld, 18);assert.equal(baseline.prefixNext, 16);assert.equal(baseline.ownedCount, 0, 'Default incomplete native prefix must have no owned shell ranges');
    proof.default = { prefixOld: baseline.prefixOld, prefixNext: baseline.prefixNext, ownedCount: baseline.ownedCount, viewed: baseline.viewed };
    const initialCounts = await bitbucketDom(page);const initialState = await tabState(page);
    assert.ok(sameCounts(initialCounts, { files: 5, additions: 46, deletions: 29 }));
    assert.ok(sameCounts(initialState.all, initialState.visible) && sameCounts(initialState.all, { files: 5, additions: 46, deletions: 29 }));
    await page.evaluate(bitbucketShellProbe, 'observe');evidence.phase = 'native_context_expansion';
    let expanded = baseline;
    for (let click = 0; expanded.prefixNext < 37 && click < 2; click += 1) {
      const budget = guardBudget();await session.flush();assertHead(head);
      const bounds = { previous: [expanded.prefixOld, expanded.prefixNext], next: [29, 27] };
      assert.ok(bounds.previous[0] >= 18 && bounds.previous[0] < 29 && bounds.previous[1] >= 16 && bounds.previous[1] < 27);
      assert.equal((await page.evaluate(bitbucketShellProbe, 'scroll', bounds))?.matches, 1);
      await poll(() => page.evaluate(bitbucketShellProbe), (value) => value.controls.some((control) => control.visible && JSON.stringify(control.previous) === JSON.stringify(bounds.previous) && JSON.stringify(control.next) === JSON.stringify(bounds.next)), 'Exact bounded context button unobstructed', 5000);
      await session.flush();assertHead(head);
      const armed = await page.evaluate(bitbucketShellProbe, 'arm', bounds);
      const handle = await page.evaluateHandle(bitbucketShellProbe, 'button', bounds);const button = handle.asElement();assert.ok(button !== null);
      const immediateBudget = guardBudget();
      try { await button.click(); } finally { await handle.dispose(); }
      const event = await page.evaluate(bitbucketShellProbe, 'click-result');assert.equal(event.trusted, true);assert.equal(event.url, REVIEW);assert.equal(event.qa, 'pr-diff-show-more-lines-below');assert.equal(event.aria, 'Show more lines below');
      assert.deepEqual(event.previous, bounds.previous);assert.deepEqual(event.next, bounds.next);
      proof.clicks.push({ budget, immediateBudget, armed, event });
      const previousPrefix = expanded.prefixNext;
      expanded = await poll(() => page.evaluate(bitbucketShellProbe), (value) => value !== null && value.prefixNext > previousPrefix, 'Genuine provider-rendered context advances native prefix', 20_000);
      await session.flush();assertHead(head);
    }
    assert.ok(expanded.prefixNext >= 37, 'Native context did not reach the real step boundary within two trusted clicks');
    const painted = await poll(() => page.evaluate(bitbucketShellProbe), (value) => value !== null && value.actualStep && value.ownedCount > 0 && value.prePaintSeen && value.preserved, 'Actual original source gets shell ranges after native context expansion');
    proof.expanded = verifyBitbucketShellSource(painted);
    assert.deepEqual(painted.viewed, baseline.viewed, 'Native Viewed state changed during shell coloring');
    evidence.phase = 'native_source_selection';
    const target = await page.evaluate(bitbucketShellProbe, 'selection-target');assert.ok(target?.visible);assert.equal(target.text, 'if [');
    await page.mouse.move(target.x1, target.y);await page.mouse.down();await page.mouse.move(target.x2, target.y, { steps: 12 });await page.mouse.up();
    const selected = await poll(() => page.evaluate(bitbucketShellProbe), (value) => value?.selection?.text === 'if [', 'Real pointer selection in original source');
    verifyBitbucketShellSource(selected);await pause(350);
    const stable = await page.evaluate(bitbucketShellProbe);verifyBitbucketShellSource(stable);assert.deepEqual(stable.selection, selected.selection, 'Native source selection changed while shell ranges remained active');
    assert.deepEqual(stable.viewed, baseline.viewed);
    proof.selection = { mechanism: 'Real Puppeteer mouse drag over original native source', before: selected.selection, after: stable.selection };
    const finalCounts = await bitbucketDom(page);const finalState = await tabState(page);
    proof.counts = { before: initialCounts, after: finalCounts, tabStateBefore: initialState, tabStateAfter: finalState, all: finalState.all, visible: finalState.visible };
    assertBitbucketShellCounts(initialCounts, initialState, finalCounts, finalState);
    await session.flush();assertHead(head);assert.deepEqual(evidence.mutations, []);
    proof.artifacts = await capture(page, 'bitbucket-pipeline-shell');
    const afterCapture = await page.evaluate(bitbucketShellProbe);verifyBitbucketShellSource(afterCapture);assert.deepEqual(afterCapture.selection, selected.selection);assert.deepEqual(afterCapture.viewed, baseline.viewed);
    const captureCounts = await bitbucketDom(page);const captureState = await tabState(page);
    proof.counts.afterCapture = captureCounts;proof.counts.tabStateAfterCapture = captureState;
    assertBitbucketShellCounts(initialCounts, initialState, captureCounts, captureState);
    await session.flush();assertHead(head);assert.deepEqual(evidence.mutations, []);proof.status = 'passed';
    proof.limitations = ['Native context was expanded through genuine user input; no automatic product fetch/reveal.', 'ADS pseudo-highlight token equality is measured for the actual selected theme. Native Bash-renderer scope equivalence and unselected dark themes remain unverified.'];
    return proof;
  } finally {
    if (!page.isClosed()) await page.evaluate(bitbucketShellProbe, 'cleanup');
    evidence.phase = 'after_shell_verification';
  }
}
