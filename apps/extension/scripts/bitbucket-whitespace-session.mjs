import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { tsImport } from 'tsx/esm/api';
const { parseUnifiedDiff } = await tsImport('@geld/core', import.meta.url);

export const BITBUCKET_WHITESPACE_URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/diff';
const REPO = 'atlassian/bitbucket-upload-file';
const RESPONSE_CODES = new Set(['RESPONSE_SIZE', 'CACHE_PROVENANCE', 'DIFF_TYPE', 'PR_SOURCE', 'PR_REF', 'COMMIT_REF', 'STAT_COMPLETE', 'STAT_FILE', 'FILE_SET']);
const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REF = /^[a-f0-9]{7,64}$/;
const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };

/** Forecast, not a measured mode-reload cost. No cache discount and no ledger reset. */
export function bitbucketWhitespaceBudget(active, { fullCycle = false } = {}) {
  check(Number.isSafeInteger(active) && active >= 0, 'BUDGET_INPUT');
  const baseline = 8; // Inferred non-own share of actual PR22 run41504744981:16 total minus eight identified own reads.
  const ownModeAcquisitions = fullCycle ? 3 : 1; // True, then optional reapply and false; assume eight each.
  const nativeTransitions = fullCycle ? 4 : 2;
  const nativePerTransition = 7; // Diff + diffstat + conservative one context read for each of five files.
  const demand = baseline + ownModeAcquisitions * 8 + nativeTransitions * nativePerTransition;
  const buffer = 5;const limit = 47;
  return { available: active + demand + buffer <= limit, active, limit, externalReserve: 3, demand, buffer,
    baseline, ownModeAcquisitions, nativeTransitions, nativePerTransition, fullCycle,
    basis: 'PR22 actual16 includes eight identified own reads; disabled baseline8 is an inference. Forecast eight own reads per mode and seven native reads per transition; measure actual baseline before enabling.' };
}

export function bitbucketWhitespaceSettings({ read, write, progress }) {
  let original, expected;
  return {
    async prepare() {
      original = structuredClone(await read());
      check(original && typeof original.present === 'boolean' && (!original.present || original.value && typeof original.value === 'object' && !Array.isArray(original.value)), 'SETTINGS_SCHEMA');
      expected = { present: true, value: { ...(original.present ? original.value : {}), enabled: false, hideWhitespace: false, prOverview: false, quickReview: false, showListStats: false, aiEnabled: false, repoConfigs: 'never', autoViewed: {}, testOutline: false, hideCommentLines: false, hideLargeDiffs: false, groupHidden: true, expandedByDefault: false, categories: { tests: true }, customCategories: [], categoryPatterns: {}, customPatterns: [], repoRules: [], hiddenAuthors: [] } };
      await write(expected);check(isDeepStrictEqual(await read(), expected), 'SETTINGS_PREPARE');progress.prepared = true;
    },
    async current() { const value = await read();check(isDeepStrictEqual(value, expected), 'SETTINGS_CHANGED');return value.value; },
    async hide(value) { check(typeof value === 'boolean', 'SETTINGS_HIDE');await this.current();expected = { present: true, value: { ...expected.value, enabled: true, hideWhitespace: value } };await write(expected);await this.current(); },
    async restore(closed) { check(closed, 'CLOSE_BEFORE_RESTORE');if (!original) return;await write(original);check(isDeepStrictEqual(await read(), original), 'SETTINGS_RESTORE');progress.restored = true;progress.pageClosedBeforeRestore = true; },
  };
}

export function bitbucketWhitespaceResource(value) {
  try {
    const u = new URL(value);if (u.username || u.password || u.hash) return null;
    const path = u.origin === 'https://bitbucket.org' && u.pathname.startsWith('/!api/') ? u.pathname.slice(5) : u.origin === 'https://api.bitbucket.org' ? u.pathname : '';
    const prefix = `/2.0/repositories/${REPO}/`;if (!path.startsWith(prefix)) return null;
    const tail = decodeURIComponent(path.slice(prefix.length));
    if (tail === 'pullrequests/22' && [...u.searchParams.keys()].every(k => k === 'fields')) return { kind: 'pr' };
    const commit = /^commit\/([a-f0-9]{7,64})$/.exec(tail);if (commit && [...u.searchParams.keys()].every(k => k === 'fields')) return { kind: 'resolve', ref: commit[1] };
    const native = /^pullrequests\/22\/(diff|diffstat)$/.exec(tail);
    const pair = /^(diff|diffstat)\/(?:atlassian\/bitbucket-upload-file:)?([a-f0-9]{7,64})\r([a-f0-9]{7,64})$/.exec(tail);
    if (!native && !pair) return null;
    const topics = u.searchParams.getAll('topic'), pullRequests = u.searchParams.getAll('from_pullrequest_id');
    if (topics.length > 1 || topics.some(value => !['true', 'false'].includes(value)) || pullRequests.length > 1 || pullRequests.some(value => !/^[1-9]\d*$/.test(value))) return null;
    const values = u.searchParams.getAll('ignore_whitespace');if (values.length > 1 || values.length === 1 && !['true', 'false'].includes(values[0])) return null;
    return { routeKey: createHash('sha256').update(path).digest('hex'), kind: (native ?? pair)[1], topic: topics[0] ?? null, pullRequest: pullRequests[0] ?? (native ? '22' : null), mode: values[0] === 'true', head: pair?.[2] ?? null, base: pair?.[3] ?? null, nativeRoute: native !== null };
  } catch { return null; }
}
const sameComparison = (a, b) => !!a && !!b && (a.topic == null || b.topic == null || a.topic === b.topic) && (a.pullRequest == null || b.pullRequest == null || a.pullRequest === b.pullRequest);
const requestOwner = (request, id) => {
  let stack = request.initiator?.()?.stack, native = false;
  for (let depth = 0; stack && depth < 8; depth++, stack = stack.parent) {
    for (const frame of (stack.callFrames ?? []).slice(0, 256)) {
      if (typeof frame.url !== 'string') continue;
      if (frame.url.startsWith(`chrome-extension://${id}/`)) return 'extension';
      try { const u = new URL(frame.url);if (!u.username && !u.password && (u.origin === 'https://bitbucket.org' || u.origin === 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net' && u.pathname.startsWith('/assets/') && u.pathname.endsWith('.js'))) native = true; } catch { /* Unknown initiator is not native proof. */ }
    }
  }
  return native ? 'native' : 'unknown';
};
const AUDITED_CONNECT_ASSET = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/app.6ea3303b1b2659fcb5ca5dc82e17933a815f4108.js';
const CONNECT_PATH = '/!api/internal/workspaces/{02b941e3-cfaa-40f9-9a58-cec53e20bdc3}/connect/modules';

function auditedNativeRequest(request) {
  let stack = request.initiator?.()?.stack, audited = false, extension = false;
  for (let depth = 0; stack && depth < 8; depth++, stack = stack.parent) for (const frame of (stack.callFrames ?? []).slice(0, 256)) { audited ||= frame.url === AUDITED_CONNECT_ASSET;extension ||= typeof frame.url === 'string' && frame.url.startsWith('chrome-extension://'); }
  return audited && !extension && requestOwner(request, '__no_extension_id__') === 'native';
}

/** The audited native Connect bulk lookup is a POST read, not a preference or review mutation. */
export function bitbucketConnectRead(request) {
  let url;try { url = new URL(request.url()); } catch { return { allowed: false, code: 'CONNECT_URL' }; }
  if (url.origin !== 'https://bitbucket.org' || url.username || url.password || url.hash || request.method() !== 'POST') return { allowed: false, code: 'CONNECT_TRANSPORT' };
  try { if (decodeURIComponent(url.pathname).toLowerCase() !== CONNECT_PATH) return { allowed: false, code: 'CONNECT_PATH' }; } catch { return { allowed: false, code: 'CONNECT_PATH' }; }
  if (!auditedNativeRequest(request)) return { allowed: false, code: 'CONNECT_INITIATOR' };
  const query = [...url.searchParams];
  if (query.length > 32 || query.some(([key, value]) => !/^(?:app_key|module_key)(?:\[\d{1,2}\])?$/.test(key) || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value))) return { allowed: false, code: 'CONNECT_QUERY' };
  const headers = request.headers?.() ?? {};
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '') || headers.accept !== 'application/json') return { allowed: false, code: 'CONNECT_HEADERS' };
  const raw = request.postData?.();if (typeof raw !== 'string' || Buffer.byteLength(raw) > 128 * 1024) return { allowed: false, code: 'CONNECT_BODY_SIZE' };
  let body;try { body = JSON.parse(raw); } catch { return { allowed: false, code: 'CONNECT_BODY_JSON' }; }
  if (!Array.isArray(body) || body.length < 1 || body.length > 16) return { allowed: false, code: 'CONNECT_BODY_SHAPE' };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const targetPath = value => { try { const link = new URL(value);if (link.username || link.password || link.search || link.hash) return null;return link.origin === 'https://api.bitbucket.org' ? link.pathname.replace(/\/$/, '') : link.origin === 'https://bitbucket.org' && link.pathname.startsWith('/!api/') ? link.pathname.slice(5).replace(/\/$/, '') : null; } catch { return null; } };
  let moduleCount = 0;
  for (const entry of body) {
    if (!object(entry) || Object.keys(entry).sort().join(',') !== 'modules,target' || !object(entry.target) || !Array.isArray(entry.modules) || entry.modules.length > 32) return { allowed: false, code: 'CONNECT_BODY_SHAPE' };
    const target = entry.target, path = targetPath(target.links?.self?.href);
    const repository = target.type === 'repository' && target.full_name === REPO && path === `/2.0/repositories/${REPO}`;
    const pullrequest = target.type === 'pullrequest' && target.id === 22 && path === `/2.0/repositories/${REPO}/pullrequests/22`
      && (target.source?.repository?.full_name === undefined || target.source.repository.full_name === REPO)
      && (target.destination?.repository?.full_name === undefined || target.destination.repository.full_name === REPO);
    if (!repository && !pullrequest) return { allowed: false, code: 'CONNECT_TARGET', diagnostic: {
      targetKind: ['repository', 'pullrequest', 'workspace', 'commit', 'commit_file', 'commit_directory', 'branch'].includes(target.type) ? target.type : 'other',
      selfRepositoryMatches: path === `/2.0/repositories/${REPO}`, selfPullrequestMatches: path === `/2.0/repositories/${REPO}/pullrequests/22`,
      repositoryNameMatches: target.full_name === REPO, pullrequestIdMatches: target.id === 22,
      nestedRepositoryMatches: target.repository?.full_name === REPO, sourceRepositoryMatches: target.source?.repository?.full_name === REPO,
      workspaceUuidMatches: target.uuid === '{02b941e3-cfaa-40f9-9a58-cec53e20bdc3}',
    } };
    if (entry.modules.some(module => typeof module !== 'string' || !/^(?:webItems|webPanels|repoPages|generalPages|associatedAddon)(?::[a-zA-Z0-9_.-]{1,160})?$/.test(module))) return { allowed: false, code: 'CONNECT_MODULES' };
    moduleCount += entry.modules.length;
  }
  return { allowed: true, code: 'AUDITED_CONNECT_METADATA_READ', entries: body.length, moduleCount };
}

/** Four source-proven native startup metadata reads; every other non-GET stays blocked. */
export function bitbucketNativeReadPost(request) {
  let url;try { url = new URL(request.url()); } catch { return { allowed: false, code: 'NATIVE_POST_URL' }; }
  let path;try { path = decodeURIComponent(url.pathname); } catch { return { allowed: false, code: 'NATIVE_POST_PATH' }; }
  if (path.toLowerCase() === CONNECT_PATH) return bitbucketConnectRead(request);
  const kind = path === `/!api/internal/${REPO}/signature-statuses/` ? 'signature'
    : path === `/!api/internal/repositories/${REPO}/commits/statuses/` ? 'commit_status'
    : path.toLowerCase() === '/!api/internal/repositories/{02b941e3-cfaa-40f9-9a58-cec53e20bdc3}/{e763018c-1ab1-4d2d-ae2b-9feb70af3997}/pipelines-config/run-eligibility' ? 'run_eligibility' : null;
  if (kind === null) return { allowed: false, code: 'NATIVE_POST_PATH' };
  if (url.origin !== 'https://bitbucket.org' || url.username || url.password || url.hash || request.method() !== 'POST') return { allowed: false, code: 'NATIVE_POST_TRANSPORT' };
  if (!auditedNativeRequest(request)) return { allowed: false, code: 'NATIVE_POST_INITIATOR' };
  const headers = request.headers?.() ?? {}, contentType = headers['content-type'] ?? '';
  if (headers['x-requested-with'] !== 'XMLHttpRequest' || headers['x-bitbucket-frontend'] !== 'frontbucket') return { allowed: false, code: 'NATIVE_POST_HEADERS' };
  const fields = '+*.commit_status.updated_on,+*.commit_status.description,+*.commit_status.name';
  if (kind === 'commit_status' ? [...url.searchParams].length !== 1 || url.searchParams.get('fields') !== fields : url.search !== '') return { allowed: false, code: 'NATIVE_POST_QUERY' };
  const raw = request.postData?.();if (typeof raw !== 'string' || Buffer.byteLength(raw) > 128 * 1024) return { allowed: false, code: 'NATIVE_POST_BODY_SIZE' };
  if (kind === 'commit_status') {
    if (!/^(?:text\/plain|application\/x-www-form-urlencoded)(?:;\s*charset=utf-8)?$/i.test(contentType)) return { allowed: false, code: 'NATIVE_POST_HEADERS' };
    const pairs = [...new URLSearchParams(raw)], valid = pairs.filter(([key, value]) => key === 'commits' && REF.test(value));
    if (pairs.length > 100 || pairs.length !== valid.length || raw !== pairs.map(([key, value]) => `${key}=${value}`).join('&')) return { allowed: false, code: 'COMMIT_STATUS_BODY', diagnostic: { pairCount: Math.min(pairs.length, 101), validHashCount: Math.min(valid.length, 101), hasOtherFields: pairs.some(([key]) => key !== 'commits') } };
    return { allowed: true, code: 'AUDITED_COMMIT_STATUS_READ', hashCount: pairs.length };
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) || headers.accept !== 'application/json') return { allowed: false, code: 'NATIVE_POST_HEADERS' };
  let body;try { body = JSON.parse(raw); } catch { return { allowed: false, code: 'NATIVE_POST_JSON', diagnostic: { bodyKind: 'invalid_json' } }; }
  const object = body !== null && typeof body === 'object' && !Array.isArray(body), keys = object ? Object.keys(body) : [];
  const bodyKind = object ? 'object' : Array.isArray(body) ? 'array' : body === null ? 'null' : typeof body;
  if (kind === 'run_eligibility') {
    if (!object || keys.length !== 0) return { allowed: false, code: 'RUN_ELIGIBILITY_BODY', diagnostic: { bodyKind, keyCount: Math.min(keys.length, 101), emptyObject: object && keys.length === 0 } };
    return { allowed: true, code: 'AUDITED_RUN_ELIGIBILITY_READ' };
  }
  const hashes = Array.isArray(body?.hashes) ? body.hashes : [], validHashCount = hashes.filter(value => typeof value === 'string' && REF.test(value)).length;
  if (!object || keys.length !== 1 || keys[0] !== 'hashes' || !Array.isArray(body.hashes) || hashes.length > 100 || validHashCount !== hashes.length) return { allowed: false, code: 'SIGNATURE_BODY', diagnostic: { bodyKind, keyCount: Math.min(keys.length, 101), hashesArray: Array.isArray(body?.hashes), hashCount: Math.min(hashes.length, 101), validHashCount: Math.min(validHashCount, 101) } };
  return { allowed: true, code: 'AUDITED_SIGNATURE_READ', hashCount: hashes.length };
}

const totals = files => ({ files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) });

/** Passive already-issued traffic only. Response bodies stay private in the observer, receipts are bounded. */
export function observeBitbucketWhitespace(page, progress, extensionId, abort) {
  const pending = new Set(), records = [], requests = new WeakMap();let released = false, phase = 'baseline', responseSequence = 0;
  Object.assign(progress, { requests: [], failures: [], providerWrites: 0, blockedWrites: [], nativeReadPosts: [], overflow: false });
  const request = r => {
    let url;try { url = new URL(r.url()); } catch { return; }
    const api = url.origin === 'https://api.bitbucket.org' && url.pathname.startsWith('/2.0/') || url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/');
    if (api && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
      const read = bitbucketNativeReadPost(r), owner = requestOwner(r, extensionId);
      if (read.allowed && owner === 'native') {
        if (progress.nativeReadPosts.length < 32) progress.nativeReadPosts.push({ origin: url.origin, path: url.pathname.slice(0, 256), method: 'POST', owner, phase, ...read });
        else { progress.overflow = true;abort.abort(new Error('TRAFFIC_BOUND'));void page.close().catch(() => {}); }
      } else {
        progress.providerWrites++;if (progress.blockedWrites.length < 8) progress.blockedWrites.push({ origin: url.origin, path: url.pathname.slice(0, 256), method: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) ? r.method() : 'OTHER', owner, phase, code: read.code, ...(read.diagnostic ? { diagnostic: read.diagnostic } : {}) });
        abort.abort(new Error('NATIVE_WRITE'));void page.close().catch(() => {});
      }
    }
    const resource = bitbucketWhitespaceResource(r.url());if (!resource) return;
    if (records.length >= 80) { progress.overflow = true;abort.abort(new Error('TRAFFIC_BOUND'));return; }
    const chain = r.redirectChain?.() ?? [];const first = chain[0] ?? r;
    const firstSource = bitbucketWhitespaceResource(first.url());
    const record = { ...resource, requestKey: createHash('sha256').update(r.url()).digest('hex'), sequence: records.length, phase, requestedAt: new Date().toISOString(), owner: requestOwner(first, extensionId), method: r.method(), redirected: chain.length > 0,
      validChain: chain.length <= 3 && chain.every(v => v.method() === 'GET' && bitbucketWhitespaceResource(v.url())?.mode === resource.mode && sameComparison(bitbucketWhitespaceResource(v.url()), resource)), firstNativeRoute: firstSource?.nativeRoute === true };
    requests.set(r, record);records.push(record);progress.requests.push(record);
    if (phase === 'hide' && record.owner === 'extension' && ['diff', 'diffstat'].includes(record.kind) && !record.mode) { record.error = 'WRONG_MODE_STARTUP';abort.abort(new Error('WRONG_MODE_STARTUP'));void page.close().catch(() => {}); }
  };
  const response = r => {
    const record = requests.get(r.request());if (!record || released) return;
    record.status = r.status();record.responseSequence = responseSequence++;if (r.status() === 429) { abort.abort(new Error('RATE_LIMIT'));return; }
    if (![200, 304].includes(r.status())) return;
    const task = (async () => {
      let failureCode = 'RESPONSE_READ_FAILED';
      try {
        const declared = r.headers()['content-length'];check(declared === undefined || /^\d+$/.test(declared) && Number(declared) <= 512 * 1024, 'RESPONSE_SIZE');
        failureCode = 'RESPONSE_BUFFER_FAILED';const body = await r.buffer();check(body.length > 0 && body.length <= 512 * 1024, 'RESPONSE_SIZE');
        record.bytes = body.length;record.sha256 = createHash('sha256').update(body).digest('hex');
        if (record.status === 304) { check(records.some(prior => prior.sequence < record.sequence && prior.responseSequence < record.responseSequence && prior.status === 200 && prior.qualified && prior.owner === record.owner && prior.requestKey === record.requestKey && prior.sha256 === record.sha256), 'CACHE_PROVENANCE');record.cacheBasis = 'same_key_prior200_same_body'; }
        failureCode = 'RESPONSE_UTF8_FAILED';const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        if (record.kind === 'diff') {
          check(/^(?:text\/(?!html\b)[^;]+|application\/octet-stream)(?:;|$)/i.test(r.headers()['content-type'] ?? ''), 'DIFF_TYPE');
          record.files = parseUnifiedDiff(text).map(f => ({ path: f.path, additions: f.additions, deletions: f.deletions }));
        } else {
          failureCode = 'RESPONSE_JSON_FAILED';const value = JSON.parse(text);
          if (record.kind === 'pr') { check(value.id === 22 && value.source?.repository?.full_name === REPO && value.destination?.repository?.full_name === REPO, 'PR_SOURCE');record.sourceRef = value.source.commit.hash;record.baseRef = value.destination.commit.hash;check(REF.test(record.sourceRef) && REF.test(record.baseRef), 'PR_REF');record.nativeLinks = ['diff', 'diffstat'].map(kind => { const link = bitbucketWhitespaceResource(value.links?.[kind]?.href ?? '');return link?.kind === kind ? { kind, routeKey: link.routeKey, topic: link.topic, pullRequest: link.pullRequest } : null; }).filter(Boolean); }
          if (record.kind === 'resolve') { check(HASH.test(value.hash) && value.hash.startsWith(record.ref), 'COMMIT_REF');record.hash = value.hash; }
          if (record.kind === 'diffstat') { check(Array.isArray(value.values) && value.values.length <= 100 && value.next == null, 'STAT_COMPLETE');record.files = value.values.map(f => { const path = f.new?.path ?? f.old?.path;check(typeof path === 'string' && path.length <= 1024 && Number.isSafeInteger(f.lines_added) && f.lines_added >= 0 && Number.isSafeInteger(f.lines_removed) && f.lines_removed >= 0, 'STAT_FILE');return { path, additions: f.lines_added, deletions: f.lines_removed }; }); }
        }
        if (record.files) { check(record.files.length > 0 && record.files.length <= 100 && new Set(record.files.map(f => f.path)).size === record.files.length, 'FILE_SET');record.totals = totals(record.files); }
        record.qualified = true;
      } catch (failure) { record.error = RESPONSE_CODES.has(failure?.code) ? failure.code : failureCode;progress.failures.push({ phase: record.phase, kind: record.kind, code: record.error }); }
    })();pending.add(task);void task.finally(() => pending.delete(task));
  };
  page.on('request', request);page.on('response', response);
  return { evidence: progress, phase(value) { check(['baseline', 'hide', 'open', 'cancel', 'show'].includes(value), 'PHASE');phase = value; }, async flush() { await Promise.all([...pending]); },
    records: () => records, idle: () => ({ pending: pending.size, observed: records.length }),
    async dispose() { released = true;page.off('request', request);page.off('response', response);await Promise.all([...pending]);progress.released = true; },
  };
}

export function qualifyBitbucketWhitespace(records, phase, mode, { own = true, expected = null } = {}) {
  const good = records.filter(r => r.qualified && r.method === 'GET' && [200, 304].includes(r.status) && r.validChain);
  check(!records.some(r => r.error), 'RESPONSE_FAILURE');
  const pair = owner => ['diff', 'diffstat'].map(kind => good.findLast(r => r.phase === phase && r.owner === owner && r.kind === kind && r.mode === mode));
  const native = pair('native');check(native.every(Boolean), 'NATIVE_PAIR');
  const nativeMetadata = good.filter(r => r.kind === 'pr' && r.owner === 'native');
  check(native.every(r => r.firstNativeRoute || nativeMetadata.some(m => m.sequence < r.sequence && m.nativeLinks?.some(link => link.kind === r.kind && link.routeKey === r.routeKey && sameComparison(link, r)))), 'NATIVE_ADVERTISED_PAIR');
  check(sameComparison(native[0], native[1]) && native.every(r => r.pullRequest == null || r.pullRequest === '22'), 'NATIVE_COMPARISON');
  check(isDeepStrictEqual(native[0].files, native[1].files), 'NATIVE_FILES');
  const result = { paths: native[0].files.map(file => file.path).sort(), native: native.map(({ sequence, sha256, mode, totals }) => ({ sequence, sha256, mode, totals })), totals: native[0].totals };
  const resolves = good.filter(r => r.kind === 'resolve');
  const resolved = new Map();
  for (const value of resolves) { check(HASH.test(value.hash ?? '') && value.hash.startsWith(value.ref) && (!resolved.has(value.ref) || resolved.get(value.ref) === value.hash), 'RESOLUTION_CONFLICT');resolved.set(value.ref, value.hash); }
  const full = ref => HASH.test(ref ?? '') ? ref : resolved.get(ref);
  if (expected !== null) {
    check(HASH.test(expected.head) && HASH.test(expected.base), 'EXPECTED_SOURCE');
    check(good.filter(r => r.kind === 'pr').every(r => full(r.sourceRef) === expected.head && full(r.baseRef) === expected.base), 'METADATA_CHANGED');
    check(native.every(r => r.head === null || expected.head.startsWith(r.head) && expected.base.startsWith(r.base)), 'NATIVE_REFS');
  }
  if (!own) return result;
  const ext = pair('extension');check(ext.every(Boolean) && ext.every(r => HASH.test(r.head ?? '') && HASH.test(r.base ?? '') && !r.redirected), 'OWN_PAIR');
  check(ext.every(r => (r.pullRequest == null || r.pullRequest === '22') && native.every(n => sameComparison(n, r))) && sameComparison(ext[0], ext[1]), 'OWN_COMPARISON');
  check(ext[0].head === ext[1].head && ext[0].base === ext[1].base && isDeepStrictEqual(ext[0].files, ext[1].files) && isDeepStrictEqual(ext[0].files, native[0].files), 'OWN_FILES');
  const metadata = good.filter(r => r.phase === phase && r.owner === 'extension' && r.kind === 'pr' && full(r.sourceRef) === ext[0].head && full(r.baseRef) === ext[0].base);
  check(good.filter(r => r.kind === 'pr').every(r => full(r.sourceRef) === ext[0].head && full(r.baseRef) === ext[0].base), 'METADATA_CHANGED');
  check(!records.some(r => r.phase === phase && r.owner === 'extension' && ['diff', 'diffstat'].includes(r.kind) && r.mode !== mode), 'OWN_WRONG_MODE');
  check(metadata.some(r => r.sequence < ext[0].sequence) && metadata.some(r => r.sequence > ext[1].sequence), 'OWN_BEFORE_AFTER');
  check(native.every(r => r.head === null || ext[0].head.startsWith(r.head) && ext[0].base.startsWith(r.base)), 'NATIVE_REFS');
  return { ...result, head: ext[0].head, base: ext[0].base, own: ext.map(({ sequence, sha256, mode, totals }) => ({ sequence, sha256, mode, totals })) };
}

/** Browser-side original-node and native-input evidence; never reads a private app store. */
export function bitbucketWhitespaceProbe(action = 'read', argument = null) {
  const KEY = '__geldBitbucketWhitespaceAcceptance';let saved = globalThis[KEY];
  if (action === 'dispose') { saved?.stop();delete globalThis[KEY];return { released: true }; }
  if (action === 'diagnostic') {
    const bounded = selector => Math.min(document.querySelectorAll(selector).length, 101);
    return { exactURL: location.href === 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/diff',
      panelCount: bounded('#pull-request-tabs-1-tab[role="tabpanel"]'), openerCount: bounded('#pull-request-tabs-1-tab button[aria-live="polite"][type="button"]'),
      fileAnchorCount: bounded('[role="region"][aria-label="Diff"] > div > div[id^="chg-"]'), articleCount: bounded('article[data-qa="branch-diff-file"]'),
      placeholderCount: bounded('[data-testid="pr-diff-placeholder-wrapper"]'), progressCount: bounded('[role="progressbar"]'),
      busy: document.querySelector('#pull-request-tabs-1-tab[aria-busy="true"]') !== null,
      dialogCount: bounded('[role="dialog"]'), checkboxCount: bounded('input#diff-settings-ignore-whitespace-toggle'),
      bound: saved !== undefined, generation: saved?.generation ?? null, transition: saved?.transition?.phase ?? null };
  }
  if (location.href !== 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/diff') return null;
  const native = node => node instanceof Element && node.isConnected && !node.closest('[data-geld-ui],.ak-renderer-document,[contenteditable]');
  const visible = node => { if (!native(node) || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;const r = node.getBoundingClientRect();return r.width > 0 && r.height > 0 && getComputedStyle(node).display !== 'none'; };
  const panels = [...document.querySelectorAll('#pull-request-tabs-1-tab[role="tabpanel"]')].filter(native);
  const actors = [...document.head.querySelectorAll('meta#bb-bootstrap[data-current-user]')].filter(native);
  if (panels.length !== 1 || actors.length !== 1) return null;
  let anonymous = false;try { const raw = actors[0].getAttribute('data-current-user');anonymous = raw.length <= 16384 && JSON.parse(raw).isAuthenticated === false; } catch { return null; }
  if (!anonymous) return null;
  const panel = panels[0];const openers = [...panel.querySelectorAll('button[aria-live="polite"][type="button"]')].filter(n => native(n) && ['Global diff settings', 'Global diff view settings'].includes(n.textContent.trim()));
  if (openers.length !== 1) return null;
  const opener = openers[0];
  const anchors = [...panel.querySelectorAll('[role="region"][aria-label="Diff"] > div > div[id^="chg-"]')].filter(native);
  if (action === 'bind' && !anchors.length || anchors.length > 10 || new Set(anchors.map(n => n.id)).size !== anchors.length) return null;
  const files = anchors.map(anchor => {
    const root = anchor.parentElement, article = root.querySelector('article[data-qa="branch-diff-file"]');
    const viewed = article ? [...article.querySelectorAll('label')].filter(n => n.textContent.trim() === 'Viewed').flatMap(n => [...n.querySelectorAll('input[type="checkbox"]')]) : [];
    const rows = article ? [...article.querySelectorAll('[data-qa="code-line"]')].slice(0, 1000).map(node => ({ node, text: node.textContent })) : [];
    return { anchor, root, article, viewed: viewed.map(n => ({ node: n, checked: n.checked, disabled: n.disabled })), rows, path: anchor.id.slice(4) };
  });
  if (action === 'bind' && !files.some(f => f.article !== null)) return null;
  if (action === 'bind') {
    if (saved) return null;
    saved = { panel, actor: actors[0], actorValue: actors[0].getAttribute('data-current-user'), opener, files, originalSemantics: files.map(f => ({ path: f.path, viewed: f.viewed.map(v => ({ checked: v.checked, disabled: v.disabled })) })), generation: 0, transition: null, events: [], forbiddenInputs: 0, expected: null, overflow: false };
    saved.listen = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (event.type === 'click' && saved.expected?.contains(target)) {
        if (saved.events.length >= 8) saved.overflow = true;
        else saved.events.push({ control: saved.expected === saved.opener ? 'opener' : 'cancel', trusted: event.isTrusted, focused: document.activeElement === saved.expected });
      }
      if (['input', 'change', 'submit'].includes(event.type) && target.closest('[role="dialog"]')) saved.forbiddenInputs++;
    };
    for (const type of ['click', 'input', 'change', 'submit']) document.addEventListener(type, saved.listen, true);
    saved.stop = () => { for (const type of ['click', 'input', 'change', 'submit']) document.removeEventListener(type, saved.listen, true); };
    globalThis[KEY] = saved;
  }
  if (!saved || saved.panel !== panel || saved.actor !== actors[0] || saved.actorValue !== actors[0].getAttribute('data-current-user') || saved.opener !== opener) return null;
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
  const dialog = dialogs.length === 1 ? dialogs[0] : null;
  const fields = dialog ? [...dialog.querySelectorAll('input#diff-settings-ignore-whitespace-toggle')].filter(native) : [];
  const field = fields.length === 1 ? fields[0] : null;
  const labels = field ? [...new Set(field.labels ?? [])] : [];
  const checkbox = field && field.type === 'checkbox' && field.name === 'shouldIgnoreWhitespace' && field.getAttribute('value') === 'shouldIgnoreWhitespace' && !field.disabled && labels.length === 1 && labels[0].id === 'diff-settings-ignore-whitespace-toggle-label' && labels[0].textContent.trim() === 'Whitespace changes' && visible(labels[0]) ? { checked: field.checked, defaultChecked: field.defaultChecked, type: field.type, id: field.id } : null;
  const cancels = dialog ? [...dialog.querySelectorAll('button[type="button"]')].filter(n => visible(n) && !n.disabled && n.textContent.trim() === 'Cancel') : [];
  if (action === 'target') {
    const target = argument === 'opener' && dialogs.length === 0 ? opener : argument === 'cancel' && cancels.length === 1 ? cancels[0] : null;
    if (!target || !visible(target)) return null;saved.expected = target;return target;
  }
  const pathSet = files.map(f => f.path).sort();
  const samePaths = JSON.stringify(pathSet) === JSON.stringify(saved.originalSemantics.map(f => f.path).sort());
  const viewedSemanticsPreserved = samePaths && saved.originalSemantics.every(old => {
    const file = files.find(f => f.path === old.path);
    return file && (old.viewed.length === 0 || old.viewed.length === file.viewed.length && old.viewed.every((v, i) => v.checked === file.viewed[i].checked && v.disabled === file.viewed[i].disabled));
  });
  const viewedPreserved = saved.files.every(old => {
    const file = files.find(f => f.path === old.path);
    return file && old.viewed.length === file.viewed.length && old.viewed.every((v, i) => v.node === file.viewed[i].node && v.checked === file.viewed[i].checked && v.disabled === file.viewed[i].disabled);
  });
  const settledMounted = saved.files.every(old => old.article === null || files.some(file => file.path === old.path && file.article !== null));
  const originalsPreserved = saved.files.every(old => { const file = files.find(f => f.path === old.path);return file && file.anchor === old.anchor && file.root === old.root && file.article === old.article; });
  const rowsPreserved = saved.files.every(old => { const file = files.find(f => f.path === old.path);return file && old.rows.length === file.rows.length && old.rows.every((r, i) => r.node === file.rows[i].node && r.text === file.rows[i].text); });
  const equalFiles = (before, after) => before.length === after.length && before.every(old => {
    const file = after.find(value => value.path === old.path);
    return file && old.anchor === file.anchor && old.root === file.root && old.article === file.article
      && old.viewed.length === file.viewed.length && old.viewed.every((value, index) => value.node === file.viewed[index].node && value.checked === file.viewed[index].checked && value.disabled === file.viewed[index].disabled)
      && old.rows.length === file.rows.length && old.rows.every((value, index) => value.node === file.rows[index].node && value.text === file.rows[index].text);
  });
  if (action === 'candidate') {
    if (!saved.transition || !samePaths || !viewedSemanticsPreserved || !settledMounted || panel.getAttribute('aria-busy') === 'true') { saved.candidate = null;return { stable: false }; }
    const stable = saved.candidate?.generation === saved.generation && equalFiles(saved.candidate.files, files);
    saved.candidate = { generation: saved.generation, files, stable };return { stable, generation: saved.generation };
  }
  if (action === 'begin') {
    if (saved.transition !== null || !originalsPreserved || !rowsPreserved || !viewedPreserved || !['hide', 'open', 'cancel', 'show'].includes(argument)) return null;
    saved.candidate = null;saved.transition = { phase: argument, generation: saved.generation };return { begun: true, generation: saved.generation };
  }
  if (action === 'rebind') {
    if (!saved.transition || saved.transition.phase !== argument?.phase || saved.transition.generation !== argument.generation || !samePaths || !viewedSemanticsPreserved || !settledMounted || panel.getAttribute('aria-busy') === 'true'
      || saved.candidate?.stable !== true || saved.candidate?.generation !== saved.generation || !equalFiles(saved.candidate.files, files) || !Array.isArray(argument.paths) || JSON.stringify(pathSet) !== JSON.stringify([...argument.paths].sort()) || files.some(file => file.viewed.length > 1)) return null;
    saved.files = files;saved.generation++;saved.transition = null;saved.candidate = null;return { rebound: true, generation: saved.generation, originalsReplaced: !originalsPreserved, rowsReplaced: !rowsPreserved, viewedReplaced: !viewedPreserved };
  }
  const number = node => { const text = node?.textContent.trim().replaceAll(',', '') ?? '';return /^[+−-]?\d+$/.test(text) ? Math.abs(Number(text.replace('−', '-'))) : null; };
  const tab = document.querySelector('a#pull-request-tabs-1[role="tab"]');
  const heading = [...document.querySelectorAll('#file-tree h5')].find(n => n.textContent.trim() === 'Lines updated');
  const leaves = [...(heading?.parentElement?.parentElement?.querySelectorAll('span') ?? [])].filter(n => n.children.length === 0);
  return { anonymous, originalPage: true, generation: saved.generation, transition: saved.transition?.phase ?? null, samePaths, viewedSemanticsPreserved, settledMounted, busy: panel.getAttribute('aria-busy') === 'true', originalsPreserved, rowsPreserved, viewedPreserved, files: files.map(f => ({ path: f.path, mounted: f.article !== null, viewed: f.viewed.map(v => ({ checked: v.checked, disabled: v.disabled })) })),
    totals: { files: number(tab?.querySelector(':scope > div > span > span')), additions: number(leaves.find(n => /^\+\s*[\d,]+$/.test(n.textContent.trim()))), deletions: number(leaves.find(n => /^[-−]\s*[\d,]+$/.test(n.textContent.trim()))) },
    dialogCount: dialogs.length, checkbox, cancelAvailable: cancels.length === 1, events: [...saved.events], forbiddenInputs: saved.forbiddenInputs, overflow: saved.overflow };
}

/** Public scope intentionally ends with Settings open; Cancel/re-disable is unit-only until separately budgeted. */
export async function verifyBitbucketWhitespace(page, { settings, observer, progress, poll, readState, guardBudget, fullCycle = false }) {
  let installed = false, error, transition = null, expected = null;
  const read = () => page.evaluate(bitbucketWhitespaceProbe);
  const current = async () => {
    await settings.current();const value = await read();
    progress.lastNative = value === null ? { available: false } : Object.fromEntries(['originalPage', 'generation', 'transition', 'samePaths', 'viewedSemanticsPreserved', 'settledMounted', 'busy', 'originalsPreserved', 'rowsPreserved', 'viewedPreserved', 'dialogCount', 'forbiddenInputs', 'overflow'].map(key => [key, value[key]]));
    check(value?.originalPage && !value.forbiddenInputs && !value.overflow, 'NATIVE_SOURCE_CHANGED');
    if (transition === null) check(value.viewedPreserved && value.originalsPreserved && value.rowsPreserved, 'SETTLED_NATIVE_CHANGED');
    return value;
  };
  const begin = async phase => {
    await current();const value = await page.evaluate(bitbucketWhitespaceProbe, 'begin', phase);
    check(value?.begun === true, 'TRANSITION_BEGIN');transition = { phase, generation: value.generation };
  };
  const input = async which => {
    guardBudget(which);const handle = await page.evaluateHandle(bitbucketWhitespaceProbe, 'target', which);
    try {
      const element = handle.asElement();check(element, 'NATIVE_INPUT_UNAVAILABLE');
      await element.evaluate(n => n.scrollIntoView({ block: 'center', behavior: 'instant' }));
      check(await element.evaluate(n => { const r = n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }), 'NATIVE_INPUT_OCCLUDED');
      const before = (await current()).events.length;await element.click();
      const after = await current();check(after.events.length === before + 1 && after.events.at(-1).trusted && after.events.at(-1).control === which, 'NATIVE_TRUSTED_INPUT');
      return after;
    } finally { await handle.dispose(); }
  };
  const proof = async (phase, mode, own) => poll(async () => {
    await observer.flush();try { const value = qualifyBitbucketWhitespace(observer.records(), phase, mode, { own, expected });progress.lastProof = { phase, mode, own, qualified: true };return value; }
    catch (failure) { progress.lastProof = { phase, mode, own, qualified: false, code: /^[A-Z_]{1,80}$/.test(failure?.code ?? '') ? failure.code : 'UNQUALIFIED' };return null; }
  }, v => v !== null, `Independent ${phase} native response pair`, 10000);
  const settle = async result => {
    check(transition !== null, 'TRANSITION_MISSING');
    await poll(async () => {
      await current();
      const painted = await page.evaluate(() => new Promise(resolve => {
        let done = false;const finish = value => { if (!done) { done = true;clearTimeout(timer);resolve(value); } };
        const timer = setTimeout(() => finish(false), 1000);requestAnimationFrame(() => requestAnimationFrame(() => finish(true)));
      }));check(painted === true, 'NATIVE_RENDER_TICKS');
      return page.evaluate(bitbucketWhitespaceProbe, 'candidate');
    }, value => value?.stable === true, 'Two stable native mode DOM samples after fresh responses', 5000);
    const rebound = await page.evaluate(bitbucketWhitespaceProbe, 'rebind', { ...transition, paths: result.paths });
    check(rebound?.rebound === true, 'TRANSITION_REBIND');(progress.generations ??= []).push({ phase: transition.phase, ...rebound });transition = null;await current();
  };
  const counts = async result => {
    const state = await poll(readState, v => v?.hasDiff && isDeepStrictEqual(v.all, result.totals), 'Geld totals match independent current response', 10000);
    const value = await current();check(isDeepStrictEqual(value.totals, state.visible), 'NATIVE_COUNTS');return { all: state.all, visible: state.visible, native: value.totals };
  };
  progress.stage = 'baseline';progress.status = 'running';progress.scope = fullCycle ? 'unit_full_cycle' : 'first_activation_and_native_settings_restore';progress.phases = [];
  try {
    await poll(() => page.evaluate(bitbucketWhitespaceProbe, 'bind'), v => v?.originalPage, 'Original public PR22 source', 10000);installed = true;
    progress.baseline = await current();
    progress.nativeBaseline = await proof('baseline', false, false);
    check(isDeepStrictEqual(progress.baseline.totals, progress.nativeBaseline.totals), 'NATIVE_BASELINE_COUNTS');
    progress.stage = 'baseline_settings';await input('opener');const baseline = await poll(current, v => v.dialogCount === 1 && v.checkbox !== null && v.cancelAvailable, 'Native initial whitespace checkbox', 4000);
    check(baseline.checkbox.checked === true, 'NATIVE_BASELINE_NOT_SHOW');progress.baselineCheckbox = baseline.checkbox;
    await input('cancel');await poll(current, v => v.dialogCount === 0, 'Native baseline Cancel', 4000);
    progress.stage = 'activation';let previousIdle = null;
    await poll(async () => { await observer.flush();const state = observer.idle();const stable = state.pending === 0 && previousIdle === state.observed;previousIdle = state.observed;return stable; }, value => value === true, 'Current native baseline idle', 4000);
    check(!observer.records().some(r => r.owner === 'extension'), 'OWN_REQUEST_BEFORE_ACTIVATION');
    progress.activationBudget = guardBudget('hide');await begin('hide');observer.phase('hide');await settings.hide(true);
    progress.stage = 'hidden_responses';const hidden = await proof('hide', true, true);expected = { head: hidden.head, base: hidden.base };await settle(hidden);progress.phases.push({ phase: 'hide', ...hidden, counts: await counts(hidden) });
    progress.stage = 'settings_restore';await begin('open');observer.phase('open');await input('opener');const opened = await poll(current, v => v.dialogCount === 1 && v.checkbox !== null, 'Native original checkbox after override restoration', 4000);
    check(opened.checkbox.checked === baseline.checkbox.checked, 'NATIVE_CHECKBOX_OVERRIDE_LEAK');progress.opened = opened;
    const restored = await proof('open', false, false);await settle(restored);progress.phases.push({ phase: 'open', ...restored });
    if (fullCycle) {
      await begin('cancel');observer.phase('cancel');await input('cancel');await poll(current, v => v.dialogCount === 0, 'Native Cancel reapply', 4000);
      const reapplied = await proof('cancel', true, false);await settle(reapplied);progress.phases.push({ phase: 'cancel', ...reapplied });
      await begin('show');observer.phase('show');guardBudget('show');await settings.hide(false);
      const shown = await proof('show', false, true);await settle(shown);progress.phases.push({ phase: 'show', ...shown, counts: await counts(shown) });
    }
    progress.stage = 'final';progress.final = await current();check(observer.evidence.providerWrites === 0 && !observer.evidence.overflow, 'TRAFFIC_UNQUALIFIED');
    progress.status = 'passed';
    progress.limitations = ['Actual fixture may contain no whitespace-only hunk; request mode, initial native checkbox and current-response counts are proven independently.', ...(fullCycle ? [] : ['Cancel/reapply and disabling are unit-tested only; this public case closes the page while Settings remains open and baseline native mode is restored.'])];
  } catch (failure) { error = /^[A-Z_]{1,80}$/.test(failure?.code ?? '') ? failure.code : 'WHITESPACE_ACCEPTANCE_UNAVAILABLE';progress.status = installed ? 'failed' : 'unavailable';progress.failure = observer.evidence.blockedWrites?.length ? 'BLOCKED_PROVIDER_WRITE' : error;try { if (!page.isClosed()) progress.readiness = await page.evaluate(bitbucketWhitespaceProbe, 'diagnostic'); } catch { progress.readiness = { unavailable: 'DIAGNOSTIC_READ_FAILED' }; } }
  finally {
    const failures = [];
    if (installed && !page.isClosed()) try { progress.beforeClose = await current();check((await page.evaluate(bitbucketWhitespaceProbe, 'dispose')).released, 'PROBE_DISPOSE'); } catch { failures.push('PROBE_CLEANUP'); }
    try { if (!page.isClosed()) await page.close(); } catch { if (!page.isClosed()) failures.push('PAGE_CLOSE'); }
    try { await observer.dispose(); } catch { failures.push('OBSERVER_RELEASE'); }
    try { await settings.restore(page.isClosed()); } catch { failures.push('SETTINGS_RESTORE'); }
    progress.cleanup = { failures, pageClosed: page.isClosed() };if (failures.length) { progress.status = 'failed';error ??= 'CLEANUP_FAILED'; }
  }
  if (error) check(false, error);
  return { status: 'passed', verified: 'First activation native whitespace requests and independent checkbox baseline restoration, matching current-response counts; exact raw settings restored after page closure.' };
}
