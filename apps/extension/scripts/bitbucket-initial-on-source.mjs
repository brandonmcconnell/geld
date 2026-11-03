import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertBitbucketPipelineURL } from './bitbucket-pipeline-visit.mjs';
import { parseObservedBitbucketShellMetadata } from './bitbucket-shell-acceptance.mjs';

const REPO = 'atlassian/bitbucket-upload-file';
const API = `https://bitbucket.org/!api/2.0/repositories/${REPO}`;
const FULL = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REF = /^(?:[a-f0-9]{7,39}|[a-f0-9]{40}|[a-f0-9]{64})$/;
const FILE = 'bitbucket-pipelines.yml';
// Rejector only: independently retained NativeOn210 full comparison, not an input to resolution.
const RETAINED_BASE = 'c522201d16c0142bd10bf7e606e72851d9669eb0';
const MAX_READS = 7, RESTORE_RESERVE = 8, COLD_PRODUCT_ALLOWANCE = 8;
const sessions = new WeakMap();
const retained = JSON.parse(readFileSync(new URL('./fixtures/bitbucket-native-syntax-rows.json', import.meta.url), 'utf8'));
const digest = (text) => createHash('sha256').update(text).digest('hex');
const tuple = (v) => [v.sourceRepo, v.head, v.base];
const semantic = (r) => ({ old: r.old, next: r.next, kind: r.kind, text: r.text });
const retainedRows = retained.original.map(({ semantic: r }) => ({ old: r.numbers[0][0] === null ? null : Number(r.numbers[0][0]), next: r.numbers[0][1] === null ? null : Number(r.numbers[0][1]), kind: r.kind, text: r.text }));
function comparisonURL(resource, head, base) {
  assert.ok(['diff', 'diffstat'].includes(resource) && FULL.test(head) && FULL.test(base));
  const url = new URL(`${API}/${resource}/${REPO}:${head}%0D${base}`);
  url.searchParams.set('from_pullrequest_id', '27');url.searchParams.set('topic', 'true');
  if (resource === 'diffstat') url.searchParams.set('pagelen', '100');
  return url.href;
}
function nativeComparison(value) {
  try {
    const url = new URL(value);if (url.username || url.password || url.hash) return null;
    const path = url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/') ? url.pathname.slice('/!api'.length) : url.origin === 'https://api.bitbucket.org' ? url.pathname : '';
    const match = /^\/2\.0\/repositories\/atlassian\/bitbucket-upload-file\/(diff|diffstat)\/atlassian\/bitbucket-upload-file:([a-f0-9]{7,64})\r([a-f0-9]{7,64})$/.exec(decodeURIComponent(path));
    if (!match || !REF.test(match[2]) || !REF.test(match[3]) || url.searchParams.get('topic') !== 'true') return null;
    if ([...url.searchParams].some(([k, v]) => !['topic','from_pullrequest_id','binary','context','exclude_files_over_limit','allow_partial_diffs','pagelen'].includes(k) || !/^(?:true|false|[0-9]+)$/.test(v))) return null;
    if (url.searchParams.has('from_pullrequest_id') && url.searchParams.get('from_pullrequest_id') !== '27') return null;
    return { resource: match[1], sourceRepo: REPO, head: match[2], base: match[3] };
  } catch { return null; }
}

/** Case-only HTTP receipts. It never adds full pins to the passive shell observer. */
export function observeInitialOnSource(page, item, { identifyRequest, extensionId }) {
  assert.ok(!sessions.has(page));
  const proof = { boundary: 'CASE-ONLY EXPLICIT PUBLIC API QUALIFICATION, NOT NATIVE FULL-HEAD AUTHORITY', requests: [], comparisons: [], responses: [], cleanup: 'pending' };
  item.initialOnSourceQualification = proof;
  let active = null;let counter = 0;const mainFrame = page.mainFrame();
  const requests = new WeakMap();
  const request = (r) => {
    let url;try { url = new URL(r.url()); } catch { return; }
    if (!(url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/') || url.origin === 'https://api.bitbucket.org' && url.pathname.startsWith('/2.0/'))) return;
    if (active?.url !== r.url() && nativeComparison(r.url()) === null) return;
    const frames = [];let stack = r.initiator?.()?.stack;
    for (let i = 0; stack && i < 8; i++) { frames.push(...(stack.callFrames ?? []).map((f) => f.url));stack = stack.parent; }
    const record = { requestId: identifyRequest?.(r) ?? ++counter, url: r.url(), method: r.method(), at: new Date().toISOString(), purpose: active?.url === r.url() ? active.purpose : null, extensionInitiator: frames.some((f) => typeof f === 'string' && f.startsWith(`chrome-extension://${extensionId}/`)) };
    let frame = null, resourceType = null, redirects = null;
    try { frame = r.frame(); } catch { /* Unknown frame is never eligible for an explicit read. */ }
    try { resourceType = r.resourceType(); } catch { /* Unknown resource type declines explicit proof. */ }
    try { const chain = r.redirectChain();if (Array.isArray(chain)) redirects = chain.length; } catch { /* Actual redirect provenance is required. */ }
    Object.assign(record, { mainFrame: frame !== null && frame === mainFrame, resourceType, redirectChainKnown: redirects !== null, redirects });
    record.attribution = record.purpose === null ? 'No native actor inference from absent extension frames' : 'Explicit harness read matched to actual browser request ID';
    if (proof.requests.length >= 80) { proof.overflow = true;return; }
    requests.set(r, record);proof.requests.push(record);
  };
  const response = (r) => {
    const req = requests.get(r.request());if (!req) return;
    const comparison = nativeComparison(r.url());
    const entry = { requestId: req.requestId, url: r.url(), status: r.status(), purpose: req.purpose, method: req.method, redirected: req.redirects === null ? null : req.redirects !== 0 };
    if (proof.responses.length >= 80) { proof.overflow = true;return; }
    proof.responses.push(entry);
    if (comparison !== null) proof.comparisons.push({ ...entry, ...comparison });
  };
  const cleanup = () => { page.off('request', request);page.off('response', response);sessions.delete(page);proof.cleanup = 'detached_on_page_close'; };
  page.on('request', request);page.on('response', response);page.once('close', cleanup);
  const session = { proof, setActive: (value) => { assert.equal(active, null, 'No overlapping qualifier reads');active = value; }, clearActive: () => { active = null; } };
  sessions.set(page, session);return session;
}

/** A browser-local actor lease, with no file/article prerequisite and no serialized bootstrap. */
export function initialOnActorProbe(action = 'read') {
  const key = '__geldInitialOnSourceActor';
  const url = new URL(location.href);
  const route = url.origin === 'https://bitbucket.org' && url.pathname === '/atlassian/bitbucket-upload-file/pull-requests/27/diff' && !url.search && !url.username && !url.password;
  const nodes = [...document.head.querySelectorAll('meta#bb-bootstrap[data-current-user][data-target-workspace-uuid]')].filter((n) => !n.closest('[data-geld-ui]'));
  let actor = null;
  if (route && nodes.length === 1) {
    const node = nodes[0], user = node.getAttribute('data-current-user'), workspace = node.getAttribute('data-target-workspace-uuid');
    try { if (user?.length <= 16384 && JSON.parse(user)?.isAuthenticated === false && workspace) actor = { node, user, workspace }; } catch { /* No usable anonymous actor. */ }
  }
  if (action === 'cleanup') { delete globalThis[key];return true; }
  if (action === 'begin') { if (!actor || globalThis[key]) return false;globalThis[key] = actor; }
  const prior = globalThis[key];return !!actor && !!prior && prior.node === actor.node && prior.user === actor.user && prior.workspace === actor.workspace;
}

/** Executed in the actual observed page, never Node fetch. Fixed same-origin public GET only. */
export async function initialOnBrowserRead({ url, maxBytes, json }) {
  const route = new URL(location.href), target = new URL(url);
  if (route.origin !== 'https://bitbucket.org' || route.pathname !== '/atlassian/bitbucket-upload-file/pull-requests/27/diff' || route.search || target.origin !== route.origin || target.username || target.password || target.hash) throw Error('Qualifier browser scope changed');
  const repo = '/!api/2.0/repositories/atlassian/bitbucket-upload-file/';
  const path = decodeURIComponent(target.pathname.slice(repo.length));
  const fixed = target.pathname.startsWith(repo) && (/^commit\/[a-f0-9]{7,40}$/.test(path) || /^commit\/[a-f0-9]{64}$/.test(path) || path === 'pullrequests/27' || /^(diff|diffstat)\/atlassian\/bitbucket-upload-file:(?:[a-f0-9]{40}|[a-f0-9]{64})\r(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(path));
  const expectedQuery = path.startsWith('commit/') ? ['fields=hash', 'fields=hash%2Crepository.full_name'] : path === 'pullrequests/27' ? ['fields=id%2Cstate%2Csource.repository.full_name%2Csource.commit.hash%2Cdestination.repository.full_name%2Cdestination.commit.hash'] : path.startsWith('diffstat/') ? ['from_pullrequest_id=27&topic=true&pagelen=100'] : ['from_pullrequest_id=27&topic=true'];
  if (!expectedQuery.includes(target.searchParams.toString())) throw Error('Qualifier query rejected');
  if (!fixed || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw Error('Qualifier resource rejected');
  const controller = new AbortController();const timeout = setTimeout(() => controller.abort(), 15000);let reader;
  try {
    const response = await globalThis.fetch.call(globalThis, target.href, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: controller.signal, headers: { Accept: json ? 'application/json' : 'text/plain' } });
    if (response.status !== 200 || response.redirected || response.url !== target.href || Number(response.headers.get('content-length')) > maxBytes || !response.body) throw Error(`Qualifier response rejected (HTTP${response.status})`);
    const contentType = response.headers.get('content-type') ?? '';
    if (json ? !/^application\/json(?:;|$)/i.test(contentType) : !/^(?:text\/plain|text\/x-diff|text\/x-patch)(?:;|$)/i.test(contentType)) throw Error('Qualifier response content type rejected');
    reader = response.body.getReader();let length = 0;const chunks = [];
    while (true) { const part = await reader.read();if (part.done) break;length += part.value.byteLength;if (length > maxBytes) throw Error('Qualifier response exceeds bound');chunks.push(part.value); }
    const bytes = new Uint8Array(length);let offset = 0;for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.byteLength; }
    return { url: response.url, status: response.status, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes: length };
  } finally { controller.abort();clearTimeout(timeout);if (reader) { try { await reader.cancel(); } finally { reader.releaseLock(); } } }
}

/** Strict fixture-subset parser: incomplete hunks, binary/rename/quoted paths decline. */
export function parseInitialOnPatch(text) {
  assert.ok(typeof text === 'string' && text.endsWith('\n') && !text.includes('\r') && !text.includes('\u0000'));
  const files = [];let file = null, hunk = null, lastRow = null;
  const finish = () => { if (hunk) assert.deepEqual([hunk.old, hunk.next], [hunk.oldEnd, hunk.nextEnd], 'Pinned comparison hunk is incomplete');hunk = null;lastRow = null; };
  for (const line of text.slice(0, -1).split('\n')) {
    const start = /^diff --git a\/(\S+) b\/\1$/.exec(line);
    if (start) { finish();file = { path: start[1], additions: 0, deletions: 0, rows: [], oldHeader: false, newHeader: false, hunks: 0, noNewline: { old: false, next: false } };assert.ok(!files.some((f) => f.path === file.path));files.push(file);continue; }
    assert.ok(file, 'Pinned patch must start with an actual file header');
    if (line === '\\ No newline at end of file') {
      assert.ok(hunk && lastRow, 'Orphan or duplicate no-newline annotation');
      for (const side of ['old', 'next']) if (lastRow[side] !== null) { assert.equal(file.noNewline[side], false, 'Duplicate no-newline side annotation');file.noNewline[side] = true; }
      lastRow = null;continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (header) { finish();assert.ok(file.oldHeader && file.newHeader);const [old, oldCount, next, nextCount] = [Number(header[1]), Number(header[2] ?? 1), Number(header[3]), Number(header[4] ?? 1)];assert.ok([old, oldCount, next, nextCount].every(Number.isSafeInteger));hunk = { old, next, oldEnd: old + oldCount, nextEnd: next + nextCount };file.hunks++;continue; }
    if (hunk && [' ', '+', '-'].includes(line[0]) && (hunk.old < hunk.oldEnd || hunk.next < hunk.nextEnd)) {
      const kind = line[0], old = kind === '+' ? null : hunk.old++, next = kind === '-' ? null : hunk.next++;
      assert.ok(hunk.old <= hunk.oldEnd && hunk.next <= hunk.nextEnd);for (const side of ['old', 'next']) if ((side === 'old' ? old : next) !== null) assert.equal(file.noNewline[side], false, 'Code followed an end-of-file no-newline annotation');
      lastRow = { old, next, kind, text: line.slice(1) };file.rows.push(lastRow);if (kind === '+') file.additions++;if (kind === '-') file.deletions++;continue;
    }
    finish();assert.ok(/^(?:index [a-f0-9]+\.\.[a-f0-9]+(?: \d+)?|(?:new|deleted) file mode \d+)$/.test(line) || line === `--- a/${file.path}` || line === '--- /dev/null' || line === `+++ b/${file.path}` || line === '+++ /dev/null', 'Unsupported or truncated pinned comparison');
    if (line.startsWith('--- ')) { assert.equal(file.oldHeader, false);file.oldHeader = true; }if (line.startsWith('+++ ')) { assert.equal(file.newHeader, false);file.newHeader = true; }
  }
  finish();assert.ok(files.length > 0 && files.every((f) => f.hunks > 0));
  for (const f of files) for (const side of ['old', 'next']) { const numbers = f.rows.map((r) => r[side]).filter((n) => n !== null);assert.ok(numbers.every((n, i) => n > 0 && (i === 0 || n > numbers[i - 1])), 'Overlapping or unordered pinned hunks'); }
  return files;
}
export function reconcileInitialOnInventory(patch, stat) {
  assert.ok(stat && Array.isArray(stat.values) && stat.values.length === 5 && (stat.next === undefined || stat.next === null), 'One complete five-file diffstat page required');
  if (stat.size !== undefined) assert.equal(stat.size, 5);if (stat.page !== undefined) assert.equal(stat.page, 1);if (stat.pagelen !== undefined) assert.ok(Number.isSafeInteger(stat.pagelen) && stat.pagelen >= stat.values.length && stat.pagelen <= 100);
  const files = stat.values.map((v) => { const path = v?.new?.path ?? v?.old?.path;assert.ok(typeof path === 'string' && path && Number.isSafeInteger(v.lines_added) && v.lines_added >= 0 && Number.isSafeInteger(v.lines_removed) && v.lines_removed >= 0);return { path, additions: v.lines_added, deletions: v.lines_removed }; });
  assert.equal(new Set(files.map((f) => f.path)).size, 5);const sorted = (v) => v.slice().sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(sorted(patch.map(({ path, additions, deletions }) => ({ path, additions, deletions }))), sorted(files));
  assert.deepEqual(files.reduce((n, f) => [n[0] + f.additions, n[1] + f.deletions], [0, 0]), [46, 29]);return files;
}

export function createInitialOnSourceQualifier(page, item, { guardBudget, settings, tabState, flush, signal, poll }) {
  const session = sessions.get(page);assert.ok(session, 'Case-only observer must start before navigation');const proof = session.proof;
  let reads = 0, identity = null, pipeline = null, failed = false, rechecked = false, actorStarted = false, qualificationAttempted = false, recheckAttempted = false, enableAttempted = false;
  const metadata = () => {
    const e = item.shellNativeSources;if (!enableAttempted) assert.equal((e.requests ?? []).some((r) => r.extensionInitiator === true && ['GET', 'HEAD'].includes(r.method)), false, 'Product source demand occurred before first enable');assert.deepEqual(e.errors, []);assert.deepEqual(e.mutations, []);assert.ok(e.metadata.length > 0 && !proof.overflow);
    const meta = e.metadata.at(-1);assert.equal(meta.id, '27');assert.equal(meta.state, 'MERGED');assert.equal(meta.sourceRepo, REPO);assert.equal(meta.destinationRepo, REPO);assert.ok(REF.test(meta.head) && REF.test(meta.base));
    for (const m of [...e.metadata, ...(e.partialMetadata ?? [])]) for (const k of ['id', 'state', 'sourceRepo', 'destinationRepo', 'head', 'base']) if (m[k] != null) assert.ok(k === 'head' || k === 'base' ? m[k].startsWith(meta[k]) || meta[k].startsWith(m[k]) : m[k] === meta[k], 'Observed native comparison metadata changed');
    return meta;
  };
  const current = () => {
    signal?.throwIfAborted();assert.ok(!failed && identity, 'Explicit comparison not qualified');assertBitbucketPipelineURL(page.url());const m = metadata();assert.ok(identity.head.startsWith(m.head) && identity.base.startsWith(m.base));
    for (const r of proof.comparisons) { assert.equal(r.sourceRepo, REPO);assert.ok(identity.head.startsWith(r.head) && identity.base.startsWith(r.base), 'Observed native comparison tuple changed'); }
    for (const r of proof.reads ?? []) if (r.status === 'qualified') assert.equal(proof.requests.filter((v) => v.purpose === r.purpose).length, 1, 'Competing browser request invalidates explicit provenance');
    return identity;
  };
  const browserCurrent = async () => { signal?.throwIfAborted();assertBitbucketPipelineURL(page.url());await settings.current(false);await flush(page);assert.equal(await page.evaluate(initialOnActorProbe, actorStarted ? 'read' : 'begin'), true, 'Original anonymous native actor changed');actorStarted = true;const state = await tabState(page);assert.equal(state.allowed, false);assert.equal(state.hasDiff, false); };
  const capacity = () => { const b = guardBudget();assert.equal(b.budget, 40);assert.ok(40 - b.observedWithinRollingHour >= MAX_READS - reads + RESTORE_RESERVE + COLD_PRODUCT_ALLOWANCE, 'Qualifier needs remaining reads plus eight restore and eight cold-product slots');return b; };
  const read = async (purpose, url, json = true) => {
    await browserCurrent();if (identity) current();const budget = capacity();assert.ok(reads < MAX_READS);reads++;const record = { purpose, url, budget, ordinal: reads, status: 'pending', initiator: 'explicit harness page.evaluate fetch, not passive native demand' };(proof.reads ??= []).push(record);session.setActive({ purpose, url });
    try {
      signal?.throwIfAborted();const result = await page.evaluate(initialOnBrowserRead, { url, maxBytes: json ? 128 * 1024 : 2 * 1024 * 1024, json });signal?.throwIfAborted();
      assert.equal(result.status, 200);assert.equal(result.url, url);assert.ok(typeof result.text === 'string' && result.bytes === Buffer.byteLength(result.text));
      const requests = proof.requests.filter((r) => r.purpose === purpose);assert.equal(requests.length, 1, 'Exactly one original browser request per explicit read required');assert.equal(requests[0].mainFrame, true, 'Explicit read must belong to the original main frame');assert.equal(requests[0].resourceType, 'fetch');assert.equal(requests[0].redirectChainKnown, true);assert.equal(requests[0].redirects, 0);
      const receipts = session.proof.responses.filter((r) => r.purpose === purpose);assert.equal(receipts.length, 1, 'Exactly one observed browser response per qualifier read required');const receipt = receipts[0];assert.equal(receipt.status, 200);assert.equal(receipt.url, url);assert.equal(receipt.method, 'GET');assert.equal(receipt.redirected, false);
      record.requestId = receipt.requestId;record.bytes = result.bytes;record.sha256 = digest(result.text);record.status = 'qualified';if (!json) return result.text;
      try { return JSON.parse(result.text); } catch { throw Error('Explicit JSON response was malformed'); }
    } catch (error) { failed = true;record.status = 'failed';record.error = signal?.aborted ? 'Explicit browser read aborted' : 'Explicit browser read or bounded response validation failed';throw new Error(record.error); }
    finally { session.clearActive(); }
  };
  const resolve = async (ref, purpose) => { assert.ok(REF.test(ref));const body = await read(purpose, `${API}/commit/${ref}?fields=hash,repository.full_name`);assert.ok(typeof body?.hash === 'string' && FULL.test(body.hash) && body.hash.startsWith(ref));if (body.repository !== undefined) assert.ok(body.repository?.full_name === REPO, 'Resolved commit repository changed');return body.hash; };
  return {
    current,
    async qualify() {
      assert.equal(qualificationAttempted, false, 'No qualification retry');qualificationAttempted = true;assert.equal(identity, null);
      await poll(async () => { await browserCurrent();const e = item.shellNativeSources;return e.metadata.length > 0 && ['diff', 'diffstat'].every((resource) => proof.comparisons.some((r) => r.purpose === null && r.status === 200 && !r.redirected && r.method === 'GET' && r.resource === resource)); }, (ready) => ready === true, 'Original anonymous actor, inactive product and native comparison HTTP200 receipts before explicit qualification');
      const m = metadata();const comparisons = proof.comparisons.filter((r) => r.purpose === null && r.status === 200 && !r.redirected && r.method === 'GET');
      for (const resource of ['diff', 'diffstat']) assert.ok(comparisons.some((r) => r.resource === resource && r.head === m.head && r.base === m.base), 'Already-issued native abbreviated comparison HTTP200 receipts required');
      const head = await resolve(m.head, 'initial_source_resolution'), base = await resolve(m.base, 'initial_base_resolution');
      identity = { sourceRepo: REPO, head, base, basis: proof.boundary };current();assert.equal(head, retained.source.head, 'Unexpected fixture head, never supplied by caller');assert.equal(base, RETAINED_BASE, 'Unexpected fixture base for the retained old-context oracle');
      const patch = parseInitialOnPatch(await read('initial_pinned_diff', comparisonURL('diff', head, base), false));const stat = await read('initial_pinned_diffstat', comparisonURL('diffstat', head, base));proof.files = reconcileInitialOnInventory(patch, stat);pipeline = patch.find((f) => f.path === FILE);assert.ok(pipeline?.rows.length > 0);proof.identity = identity;proof.status = 'api_tuple_qualified_before_native_file_selection';return current();
    },
    reconcile(probe) {
      current();assert.equal(probe.file, 'chg-' + FILE);assert.equal(probe.heading, FILE);assert.equal(probe.rows.length, 55);assert.equal(probe.ownedCount, 0);const rows = probe.rows.map(semantic);assert.deepEqual(rows, retainedRows, 'Native source differs from retained exact55-row fixture at independently resolved head');
      for (const r of pipeline.rows) assert.equal(rows.filter((v) => JSON.stringify(v) === JSON.stringify(r)).length, 1, 'Pinned API hunk row lacks one exact native coordinate/kind/text');
      proof.sourceRelation = { patchRows: pipeline.rows.length, nativeRows: rows.length, additionalNativeContextRows: rows.length - pipeline.rows.length, retainedNativeVectorSha256: digest(JSON.stringify(retainedRows)), limitation: 'API hunk rows match the original native source. Extra native context is checked against retained native fixture text, not claimed as API-proven raw content. No product whole-file authority.' };proof.status = 'api_tuple_and_original_native_rows_qualified';
    },
    async beforeEnable() {
      assert.ok(!recheckAttempted && proof.sourceRelation, 'No recheck retry');recheckAttempted = true;await browserCurrent();current();const fresh = parseObservedBitbucketShellMetadata(await read('pre_enable_pr_recheck', `${API}/pullrequests/27?fields=id,state,source.repository.full_name,source.commit.hash,destination.repository.full_name,destination.commit.hash`));assert.equal(fresh.id, '27');assert.equal(fresh.state, 'MERGED');assert.equal(fresh.sourceRepo, REPO);assert.equal(fresh.destinationRepo, REPO);
      const head = await resolve(fresh.head, 'pre_enable_source_resolution'), base = await resolve(fresh.base, 'pre_enable_base_resolution');assert.deepEqual([REPO, head, base], tuple(identity), 'Current API tuple changed before first product enable');assert.equal(reads, MAX_READS);current();capacity();rechecked = true;proof.status = 'rechecked_before_first_enable';proof.readCount = reads;
    },
    assertEnableReserve() { assert.ok(rechecked && !enableAttempted);current();const budget = capacity();enableAttempted = true;proof.enableBoundary = { status: 'guarded_attempt', budget, observedHelperReads: reads };return budget; },
  };
}
