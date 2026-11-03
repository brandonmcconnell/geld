import { isDeepStrictEqual } from 'node:util';
import { GITLAB_FILE_SEARCH, gitLabFileSearchSelection } from './gitlab-file-search.mjs';
import { gitLabWhitespaceProbe } from './gitlab-whitespace-probe.mjs';

export const GITLAB_WHITESPACE = Object.freeze({ ...GITLAB_FILE_SEARCH, paths: ['app/graphql/mutations/boards/issues/issue_move_list.rb', 'app/services/boards/base_item_move_service.rb', GITLAB_FILE_SEARCH.path] });
const error = (code) => Object.assign(new Error(`GitLab whitespace characterization: ${code}`), { code });
const check = (value, code) => { if (!value) throw error(code); };
const code = (value) => typeof value?.code === 'string' && /^[A-Z_]{1,64}$/.test(value.code) ? value.code : 'OPERATION_FAILED';
const cleanups = new WeakMap();
const probeCodes = new Set(['ACTOR_UNQUALIFIED', 'ANCHOR_UNQUALIFIED', 'ANONYMOUS_WITNESS_MISSING', 'BIND_UNQUALIFIED', 'FILE_DATA_UNQUALIFIED', 'FILE_INVENTORY_UNQUALIFIED', 'MENU_FIELD_UNQUALIFIED', 'MENU_LABEL_UNQUALIFIED', 'MENU_OWNER_PENDING', 'MENU_OWNER_UNQUALIFIED', 'MENU_SCHEMA_UNQUALIFIED', 'MODE_UNQUALIFIED', 'NATIVE_ENDPOINT_UNQUALIFIED', 'OPENER_ARM_UNQUALIFIED', 'OPENER_UNQUALIFIED', 'ORIGINAL_OWNER_CHANGED', 'PINNED_SOURCE_CHANGED', 'PROJECT_SCOPE_UNQUALIFIED', 'ROUTE_UNQUALIFIED', 'SELECTION_UNQUALIFIED', 'SOURCE_BOUND', 'SOURCE_DATA_UNQUALIFIED', 'SOURCE_OWNER_PENDING', 'SOURCE_OWNER_UNQUALIFIED', 'UNKNOWN_PROBE_ACTION', 'UNRELATED_DIALOG_UNQUALIFIED', 'VERSIONS_CHANGED_DURING_READ', 'VERSIONS_UNQUALIFIED', 'VIEWED_UNQUALIFIED']);

function retainedBaseline(value) {
  const versions = (values) => values.map(({ id, selected, is_merge_head, head_sha, href }) => ({ id, selected, is_merge_head, ...(head_sha === undefined ? {} : { head_sha }), href }));
  return { qualified: true, anonymous: true, url: value.url, app: { path: value.app.path, iid: value.app.iid, fileByFileMode: value.app.fileByFileMode,
      sourceVersions: versions(value.app.sourceVersions), targetVersions: versions(value.app.targetVersions) },
    initialShowWhitespace: value.initialShowWhitespace, checked: value.checked, other: { fileByFile: value.other.fileByFile }, open: value.open,
    nativeStream: { resource: value.nativeStream.resource, diffId: value.nativeStream.diffId, view: value.nativeStream.view, requestSourceHead: value.nativeStream.requestSourceHead, requestTargetHead: value.nativeStream.requestTargetHead },
    files: value.files.map(({ path, anchor, head, mounted, rows, sha256, viewed }) => ({ path, anchor, head, mounted, rows, sha256, viewed: { checked: viewed.checked, disabled: viewed.disabled } })),
    displayedCounts: { additions: value.displayedCounts?.additions ?? null, deletions: value.displayedCounts?.deletions ?? null }, armed: value.armed === true, bound: value.bound === true,
    events: value.events.map(({ kind, type, trusted, checked }) => ({ kind, type, trusted, ...(kind === 'whitespace' ? { checked } : {}) })), eventOverflow: value.eventOverflow };
}

function retainedLifecycle(value) {
  if (value === undefined) return undefined;
  const invalid = { status: 'unavailable', code: 'DIAGNOSTIC_SCHEMA_UNQUALIFIED', stateTiming: 'observation_drain', fileReferenceBasis: 'phase_native_files', limit: 128, overflow: false, stopped: false, history: [] };
  if (!['observing', 'unavailable', 'closed', 'incomplete'].includes(value?.status) || !['OBSERVING', 'MARKER_SCHEMA_UNAVAILABLE', 'OBSERVER_UNAVAILABLE', 'OBSERVER_FAILED', 'HISTORY_BOUND', 'CLOSED'].includes(value.code)
    || value.stateTiming !== 'observation_drain' || value.fileReferenceBasis !== 'phase_native_files' || value.limit !== 128 || typeof value.overflow !== 'boolean' || typeof value.stopped !== 'boolean' || !Array.isArray(value.history) || value.history.length > 128) return invalid;
  const history = [];
  for (const entry of value.history) {
    if (entry?.seq !== history.length + 1 || !['baseline', 'toggle', 'restore'].includes(entry.phase) || !['baseline', 'phase', 'overlay', 'loading', 'alert', 'list_structure', 'marker_structure', 'owner_structure', 'file_mounted', 'native_input', 'owner_lost'].includes(entry.kind)
      || !['idle', 'loading', 'unknown'].includes(entry.overlayLoading) || !['ownersCurrent', 'loadingHidden', 'alertEmpty'].every((field) => typeof entry[field] === 'boolean')
      || !['originalConnected', 'originalInRoot', 'originalInList', 'originalParentsSame', 'nativeFilesInList', 'freshFilesInList'].every((field) => Number.isInteger(entry[field]) && entry[field] >= 0 && entry[field] <= GITLAB_WHITESPACE.paths.length + 1)) return invalid;
    const safe = Object.fromEntries(['seq', 'phase', 'kind', 'ownersCurrent', 'overlayLoading', 'loadingHidden', 'alertEmpty', 'originalConnected', 'originalInRoot', 'originalInList', 'originalParentsSame', 'nativeFilesInList', 'freshFilesInList'].map((field) => [field, entry[field]]));
    for (const field of ['before', 'after']) if (entry[field] !== undefined) { if (!['absent', 'present', 'true', 'unknown'].includes(entry[field])) return invalid;safe[field] = entry[field]; }
    for (const field of ['addedNodes', 'removedNodes', 'removedOriginalRefs']) if (entry[field] !== undefined) { if (!Number.isInteger(entry[field]) || entry[field] < 0 || entry[field] > GITLAB_WHITESPACE.paths.length + 1) return invalid;safe[field] = entry[field]; }
    for (const field of ['removedOwnerRefs', 'addedOwnerRefs']) if (entry[field] !== undefined) { if (!Number.isInteger(entry[field]) || entry[field] < 0 || entry[field] > 11) return invalid;safe[field] = entry[field]; }
    for (const field of ['originalFile', 'trusted', 'checked']) if (entry[field] !== undefined) { if (typeof entry[field] !== 'boolean') return invalid;safe[field] = entry[field]; }
    if (entry.knownAnchorSlot !== undefined) { if (!Number.isInteger(entry.knownAnchorSlot) || entry.knownAnchorSlot < -1 || entry.knownAnchorSlot >= GITLAB_WHITESPACE.paths.length) return invalid;safe.knownAnchorSlot = entry.knownAnchorSlot; }
    if (entry.inputType !== undefined) { if (!['click', 'input', 'change'].includes(entry.inputType)) return invalid;safe.inputType = entry.inputType; }
    history.push(safe);
  }
  return { status: value.status, code: value.code, stateTiming: 'observation_drain', fileReferenceBasis: 'phase_native_files', limit: 128, overflow: value.overflow, stopped: value.stopped, history };
}

function retainedNativeFiles(value, boundHead, endpointHead) {
  if (value === undefined) return undefined;
  const invalid = { state: 'schema_unqualified', bootstrapAttributeEqualToBinding: null, slots: [] };
  const full = (head) => typeof head === 'string' && /^[a-f0-9]{40}$/.test(head);
  const version = (entry) => typeof entry?.id === 'string' && /^[1-9]\d{0,15}$/.test(entry.id) && Number.isSafeInteger(Number(entry.id)) && full(entry.head);
  if (!['observed', 'not_bound', 'owner_changed', 'snapshot_changed'].includes(value?.state) || !Array.isArray(value.slots) || value.slots.length > 3) return invalid;
  if (['not_bound', 'owner_changed'].includes(value.state)) return { state: value.state, bootstrapAttributeEqualToBinding: null, slots: [] };
  if (typeof value.bootstrapAttributeEqualToBinding !== 'boolean' || !version(value.currentSelection?.source) || !version(value.currentSelection?.target) || typeof value.currentSelection.target.mergeHead !== 'boolean' || value.currentSelection.source.id !== GITLAB_WHITESPACE.version || value.currentSelection.source.head !== GITLAB_WHITESPACE.head || value.slots.length !== 3) return invalid;
  const currentSelection = { source: { id: value.currentSelection.source.id, head: value.currentSelection.source.head }, target: { id: value.currentSelection.target.id, head: value.currentSelection.target.head, mergeHead: value.currentSelection.target.mergeHead } };
  const slots = [];
  for (const entry of value.slots) {
    if (!['valid_candidate', 'unknown_path', 'oversize_attr', 'json_unreadable', 'missing_refs', 'malformed_refs'].includes(entry?.state) || typeof entry.anchorValid !== 'boolean' || typeof entry.mounted !== 'boolean') return invalid;
    if (entry.slot === null) { if (!['unknown_path', 'oversize_attr', 'json_unreadable'].includes(entry.state)) return invalid;slots.push({ slot: null, state: entry.state, anchorValid: entry.anchorValid, mounted: entry.mounted });continue; }
    if (!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot >= 3 || !['valid_candidate', 'missing_refs', 'malformed_refs'].includes(entry.state) || entry.refs === null || typeof entry.refs !== 'object' || Array.isArray(entry.refs)
      || !['rawPathPresent', 'rawAtOwnHead', 'contextPathPresent', 'contextAtOwnHead'].every((field) => typeof entry[field] === 'boolean')) return invalid;
    const refs = {};
    for (const name of ['base', 'start', 'head']) if (entry.refs[name] !== undefined) { if (!full(entry.refs[name])) return invalid;refs[name] = entry.refs[name]; }
    if ((Object.keys(refs).length === 3) !== (entry.state === 'valid_candidate')) return invalid;
    const knownBound = full(boundHead) ? boundHead : value.bootstrapAttributeEqualToBinding ? currentSelection.target.head : null;
    slots.push({ slot: entry.slot, state: entry.state, anchorValid: entry.anchorValid, mounted: entry.mounted, refs,
      rawPathPresent: entry.rawPathPresent, rawAtOwnHead: refs.head !== undefined && entry.rawPathPresent && entry.rawAtOwnHead, contextPathPresent: entry.contextPathPresent, contextAtOwnHead: refs.head !== undefined && entry.contextPathPresent && entry.contextAtOwnHead,
      headMatchesCurrentTarget: refs.head === undefined ? null : refs.head === currentSelection.target.head, headMatchesBoundTarget: refs.head === undefined || knownBound === null ? null : refs.head === knownBound,
      headMatchesEndpointDefault: refs.head === undefined || !full(endpointHead) ? null : refs.head === endpointHead });
  }
  return { state: value.state, bootstrapAttributeEqualToBinding: value.bootstrapAttributeEqualToBinding, currentSelection, slots };
}

export function whitespaceReceiptURL(value) {
  try { const url = new URL(value);return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}${url.pathname.replace(/\/(?:token|secret|password|authorization|signature|nonce|key)\/[^/]+/gi, '/[redacted]')}` : 'NON_HTTP_RESOURCE'; }
  catch { return 'UNAVAILABLE_RESOURCE'; }
}

export function observeGitLabWhitespace(page, evidence) {
  Object.assign(evidence, { nonreads: [], modes: [], overflow: false, attribution: 'Event-window correlation alone does not establish a native emitter or server preference persistence.' });
  let phase = 'navigation';let sequence = 0;const ids = new WeakMap();const entries = new WeakMap();let disposed = false;let bound;
  const identify = (request) => { if (!ids.has(request)) ids.set(request, `request-${++sequence}`);return ids.get(request); };
  const request = (value) => {
    if (disposed) return;
    try {
      const method = value.method();const url = new URL(value.url());let entry;
      if (!['GET', 'HEAD'].includes(method)) {
        if (evidence.nonreads.length >= 128) { evidence.overflow = true;return; }
        entry = { id: identify(value), method: /^[A-Z]{1,16}$/.test(method) ? method : 'UNKNOWN', resource: whitespaceReceiptURL(url.href), phase, status: null, provenance: 'unattributed_browser_request' };
        evidence.nonreads.push(entry);
      } else if (url.origin === 'https://gitlab.com' && url.pathname.startsWith('/gitlab-org/gitlab/-/merge_requests/266334/')) {
        const w = url.searchParams.getAll('w');const ignored = url.searchParams.getAll('ignore_whitespace_changes');
        const mode = w.length === 1 && /^[01]$/.test(w[0]) ? w[0] === '1' : ignored.length === 1 && /^(true|false)$/.test(ignored[0]) ? ignored[0] === 'true' : null;
        if (w.length === 0 && ignored.length === 0) return;
        if (evidence.modes.length >= 64) { evidence.overflow = true;return; }
        let nativeFrame = false;let extensionFrame = false;
        try {
          const inspect = (stack, depth = 0) => {
            if (!stack || depth > 8) return;
            for (const frame of (Array.isArray(stack.callFrames) ? stack.callFrames : []).slice(0, 20)) { try { const source = new URL(frame.url);nativeFrame ||= source.origin === 'https://gitlab.com' && source.pathname.startsWith('/assets/');extensionFrame ||= source.protocol === 'chrome-extension:'; } catch { /* Unknown initiator remains unattributed. */ } }
            inspect(stack.parent, depth + 1);
          };inspect(value.initiator?.()?.stack);
        } catch { /* No native provenance is inferred from a missing stack. */ }
        const resource = whitespaceReceiptURL(url.href);const pins = url.searchParams.getAll('diff_id');
        const pin = pins.length === 1 && /^[1-9]\d{0,15}$/.test(pins[0]) ? pins[0] : null;
        const expected = bound && resource === bound.resource;
        const exactQuery = [...url.searchParams].length === 3 && ['diff_id', 'view', 'w'].every((name) => url.searchParams.getAll(name).length === 1)
          && url.searchParams.get('view') === bound?.view && /^[01]$/.test(url.searchParams.get('w') ?? '');
        const eligible = expected === true && pin === bound.diffId && exactQuery && mode !== null;
        entry = { id: identify(value), method, resource, phase, ignoreWhitespace: mode, nativeFrame, extensionFrame, status: null, diffId: pin,
          eligible, selectionCode: !bound ? 'NO_BOUND_ENDPOINT' : !expected ? 'OTHER_ENDPOINT' : pin !== bound.diffId ? 'ROUND_PIN_MISMATCH' : !exactQuery ? 'SELECTION_NOT_EXACT' : 'EXACT_NATIVE_ENDPOINT_ROUND',
          requestSourceHead: [...url.searchParams.keys()].some((name) => !['diff_id', 'view', 'w'].includes(name)) ? 'not_qualified' : 'absent',
          requestTargetHead: [...url.searchParams.keys()].some((name) => !['diff_id', 'view', 'w'].includes(name)) ? 'not_qualified' : 'absent' };
        evidence.modes.push(entry);
      }
      if (entry) entries.set(value, entry);
    } catch { evidence.overflow = true; }
  };
  const response = (value) => { try { const entry = entries.get(value.request());if (entry) { const status = value.status();entry.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null; } } catch { evidence.overflow = true; } };
  const failed = (value) => { const entry = entries.get(value);if (entry) entry.failed = true; };
  const finished = (value) => { const entry = entries.get(value);if (entry) entry.finished = true; };
  page.on('request', request);page.on('response', response);page.on('requestfailed', failed);page.on('requestfinished', finished);
  return { evidence, bind(value) {
      check(!bound && value?.resource === 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs_stream' && value.diffId === GITLAB_WHITESPACE.version
        && ['inline', 'parallel'].includes(value.view) && value.requestSourceHead === 'absent' && value.requestTargetHead === 'absent', 'NATIVE_ENDPOINT_UNQUALIFIED');
      bound = { ...value };evidence.nativeEndpoint = { ...bound };
    }, phase(value) { check(['baseline', 'toggle', 'restore', 'viewed', 'cleanup'].includes(value), 'UNKNOWN_PHASE');phase = value; },
    dispose() { disposed = true;page.off('request', request);page.off('response', response);page.off('requestfailed', failed);page.off('requestfinished', finished);evidence.listenersRemoved = true; } };
}

export function gitLabWhitespaceSettings({ read, write, progress }) {
  let original;let prepared;let cleanup;
  return {
    async prepare() {
      const saved = await read();
      check(saved && typeof saved.sync?.present === 'boolean' && typeof saved.local?.present === 'boolean', 'SETTINGS_SNAPSHOT_UNAVAILABLE');
      check(!saved.sync.present || saved.sync.value !== null && typeof saved.sync.value === 'object' && !Array.isArray(saved.sync.value), 'SETTINGS_SHAPE_UNQUALIFIED');
      original = saved;
      prepared = { ...saved, sync: { present: true, value: { ...(saved.sync.present ? saved.sync.value : {}), enabled: true, hideWhitespace: false, autoViewed: {}, aiEnabled: false, repoConfigs: 'never', autoUpdatePatterns: false } } };
      await write(prepared);check(isDeepStrictEqual(await read(), prepared), 'SETTINGS_PREPARE_MISMATCH');progress.prepared = true;
    },
    async current() { check(prepared && isDeepStrictEqual(await read(), prepared), 'EXTENSION_SETTINGS_CHANGED'); },
    restore(closed) {
      if (cleanup) return cleanup;
      cleanup = (async () => {
        if (!original) { progress.restoration = 'not_modified';return; }
        check(closed, 'PAGE_MUST_CLOSE_BEFORE_SETTINGS_RESTORE');
        await write(original);check(isDeepStrictEqual(await read(), original), 'RAW_SETTINGS_RESTORE_MISMATCH');
        progress.restoration = 'exact_raw_presence_and_values_restored';progress.restoredAfterPageClose = true;
      })();return cleanup;
    },
  };
}

export function cleanupGitLabWhitespace(page, { settings, observer, comparisons, progress }) {
  if (cleanups.has(settings)) return cleanups.get(settings);
  const cleanup = (async () => {
    const codes = [...progress.nativeCleanupCodes ?? []];
    try { if (page && !page.isClosed()) await page.close(); } catch { codes.push('PAGE_CLOSE_FAILED'); }
    try { await observer?.dispose(); } catch { codes.push('OBSERVER_CLEANUP_FAILED'); }
    try { await comparisons?.dispose(); } catch { codes.push('COMPARISON_CLEANUP_FAILED'); }
    let restored = false;
    try { await settings.restore(page === undefined || page.isClosed());restored = true; } catch { codes.push('RAW_SETTINGS_RESTORE_FAILED'); }
    if (observer?.evidence.overflow) codes.push('TRAFFIC_EVIDENCE_OVERFLOW');
    progress.cleanup = { codes, pageClosed: page === undefined || page.isClosed(), rawRestoredAfterClose: restored };
    return progress.cleanup;
  })();cleanups.set(settings, cleanup);return cleanup;
}

function selection(snapshot) {
  check(snapshot?.qualified === true && snapshot.anonymous === true, snapshot?.code ?? 'NATIVE_SCOPE_UNQUALIFIED');
  let value;try { value = gitLabFileSearchSelection(snapshot, GITLAB_WHITESPACE); } catch { throw error('NATIVE_VERSION_SCOPE_CHANGED'); }
  check(snapshot.files.length === GITLAB_WHITESPACE.paths.length && snapshot.files.every((file) => GITLAB_WHITESPACE.paths.includes(file.path) && file.head === value.target.head_sha && file.mounted === true), 'NATIVE_FILE_SCOPE_CHANGED');
  check(snapshot.eventOverflow === false && snapshot.other?.fileByFile === false, 'NATIVE_MENU_CHANGED');
  return { source: { id: String(value.source.id), head: value.source.head_sha }, target: { id: String(value.target.id), head: value.target.head_sha, mergeHead: value.target.is_merge_head } };
}

function acquisitionMatches(snapshot, evidence) {
  const selected = selection(snapshot);const responses = evidence?.responses ?? [];
  const fullHead = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  const version = (value, target) => value?.state === 'observed' && value.selectedCount === 1 && Array.isArray(value.values) && value.values.length === 1
    && typeof value.values[0]?.id === 'string' && /^[1-9]\d{0,15}$/.test(value.values[0].id) && Number.isSafeInteger(Number(value.values[0].id)) && fullHead(value.values[0].headSha)
    && (!target || typeof value.values[0].mergeHead === 'boolean' && fullHead(value.values[0].startSha));
  const pinned = (entry, kind) => {
    if (entry.status !== 'projected' || entry.kind !== kind || entry.httpStatus !== 200 || entry.selectionRedacted !== false
      || entry.selection?.diff_id !== GITLAB_WHITESPACE.version || Object.keys(entry.selection).length !== 1) return false;
    try {
      const url = new URL(entry.url);return url.origin === 'https://gitlab.com' && url.pathname === `/gitlab-org/gitlab/-/merge_requests/266334/${kind === 'versions' ? 'versions' : 'diffs_metadata.json'}`
        && !url.username && !url.password && !url.hash && [...url.searchParams].length === 1 && url.searchParams.get('diff_id') === GITLAB_WHITESPACE.version;
    } catch { return false; }
  };
  const source = (entry) => pinned(entry, 'versions') && version(entry.projection?.source, false)
    && entry.projection.source.values[0].id === selected.source.id && entry.projection.source.values[0].headSha === selected.source.head;
  const target = (entry) => pinned(entry, 'versions') && version(entry.projection?.target, true)
    && entry.projection.target.values[0].id === selected.target.id && entry.projection.target.values[0].headSha === selected.target.head && entry.projection.target.values[0].mergeHead === selected.target.mergeHead;
  const consistentDefault = (entry) => version(entry.projection?.target, true) && (entry.projection.target.values[0].id === selected.source.id
    ? entry.projection.target.values[0].headSha === selected.source.head && entry.projection.target.values[0].mergeHead === false : entry.projection.target.values[0].mergeHead === true);
  const paired = responses.find((entry) => source(entry) && target(entry) && consistentDefault(entry));
  const immutable = paired === undefined && selected.target.mergeHead === false && selected.target.id === selected.source.id && selected.target.head === selected.source.head
    ? responses.find((entry) => source(entry) && consistentDefault(entry)) : undefined;
  const proof = paired ?? immutable;
  const metadata = responses.some((entry) => pinned(entry, 'metadata') && entry.projection?.projectPath === 'gitlab-org/gitlab' && entry.projection.diffId === GITLAB_WHITESPACE.version
    && entry.projection.inventory?.state === 'observed' && entry.projection.inventory.scanComplete === true && entry.projection.inventory.total === GITLAB_WHITESPACE.paths.length
    && entry.projection.inventory.uniqueNewPaths === GITLAB_WHITESPACE.paths.length && entry.projection.inventory.paths?.length === GITLAB_WHITESPACE.paths.length
    && [3, '3'].includes(entry.projection.inventory.size) && [3, '3'].includes(entry.projection.inventory.realSize) && entry.projection.inventory.overflow === false
    && entry.projection.inventory.paths.every((file) => GITLAB_WHITESPACE.paths.includes(file.newPath) && !file.deleted && !file.submodule));
  return { source: responses.some(source), target: responses.some(target), pairedVersions: paired !== undefined, immutableSourceTarget: immutable !== undefined, metadata, matched: proof !== undefined && metadata,
    proofMode: paired ? 'same_response_selected_target' : immutable ? 'same_immutable_source_version' : 'unverified',
    proofResponseId: typeof proof?.id === 'string' && /^r[1-9]\d{0,8}$/.test(proof.id) ? proof.id : null,
    endpointTarget: proof ? { id: proof.projection.target.values[0].id, head: proof.projection.target.values[0].headSha, mergeHead: proof.projection.target.values[0].mergeHead } : null };
}

export async function verifyGitLabWhitespace(page, { settings, observer, comparisons, acquisition, poll, progress }) {
  const p = progress;Object.assign(p, { status: 'running', stages: [], propertyVectorRestored: false, effectiveModeRestored: 'unverified', nativeRestored: false,
    artifacts: { suppressed: 'Report only. No HTML, AX, PNG, arbitrary field values or raw bootstrap.' } });
  let baseline;let bound = false;let installed = false;let toggleAttempted = false;let primary;const cleanupErrors = [];
  p.setupPhase = 'BASELINE_READINESS';
  const observed = async (action) => {
    try {
      const value = await page.evaluate(gitLabWhitespaceProbe, action, GITLAB_WHITESPACE);
      const nativeFilesDiagnostic = retainedNativeFiles(value?.nativeFilesDiagnostic, p.selection?.target.head, p.acquisitionMatch?.endpointTarget?.head);
      const lifecycle = retainedLifecycle(value?.lifecycle);if (lifecycle !== undefined) p.lifecycle = lifecycle;
      p.lastProbe = value?.qualified === true ? { qualified: true, anonymous: value.anonymous === true, armed: value.armed === true, bound: value.bound === true, open: value.open === true,
        mountedFiles: Array.isArray(value.files) ? Math.min(GITLAB_WHITESPACE.paths.length, value.files.filter((file) => file.mounted === true).length) : 0 }
        : { qualified: false, code: probeCodes.has(value?.code) ? value.code : 'NATIVE_PROBE_UNQUALIFIED' };
      if (nativeFilesDiagnostic !== undefined) p.lastProbe.nativeFilesDiagnostic = nativeFilesDiagnostic;
      const detail = value?.fileData;
      if (value?.code === 'FILE_DATA_UNQUALIFIED' && ['FILE_JSON_UNREADABLE', 'FILE_PATH_UNEXPECTED', 'FILE_REF_MISSING', 'FILE_HEAD_INVALID', 'FILE_HEAD_MISMATCH', 'FILE_ANCHOR_INVALID'].includes(detail?.reason)
        && ['knownPath', 'refPresent', 'headValid', 'headMatchesTarget', 'anchorValid'].every((field) => typeof detail[field] === 'boolean')
        && (detail.knownPath ? Number.isInteger(detail.pathSlot) && detail.pathSlot >= 0 && detail.pathSlot < GITLAB_WHITESPACE.paths.length : detail.pathSlot === null)) {
        const candidate = detail.knownPath && detail.headValid && typeof detail.candidateHead === 'string' && /^[a-f0-9]{40}$/.test(detail.candidateHead) ? detail.candidateHead : null;
        p.lastProbe.fileData = { reason: detail.reason, pathSlot: detail.pathSlot, knownPath: detail.knownPath, refPresent: detail.refPresent, headValid: detail.headValid, headMatchesTarget: detail.headMatchesTarget, anchorValid: detail.anchorValid,
          ...(candidate === null ? {} : { candidateHead: candidate }), candidateMatchesEndpointTarget: candidate !== null && typeof p.acquisitionMatch?.endpointTarget?.head === 'string' ? candidate === p.acquisitionMatch.endpointTarget.head : null };
      }
      return { ...value, ...(lifecycle === undefined ? {} : { lifecycle }), ...(nativeFilesDiagnostic === undefined ? {} : { nativeFilesDiagnostic }) };
    } catch (failure) { p.lastProbe = { qualified: false, code: 'PROBE_OPERATION_FAILED' };throw failure; }
  };
  const read = () => observed('read');
  const current = async (action = 'read') => {
    try {
      await settings.current();const value = await observed(action);const chosen = selection(value);
      if (baseline) { check(value.bound === true, 'ORIGINAL_OWNER_CHANGED');check(isDeepStrictEqual(chosen, selection(baseline)), 'SELECTED_TARGET_CHANGED');check(value.url === baseline.url && value.initialShowWhitespace === baseline.initialShowWhitespace, 'NATIVE_ROUTE_OR_BOOTSTRAP_CHANGED'); }
      p.lastCurrentCheck = 'QUALIFIED';return value;
    } catch (failure) {
      const fixed = code(failure);p.lastCurrentCheck = probeCodes.has(fixed) || ['NATIVE_SCOPE_UNQUALIFIED', 'NATIVE_VERSION_SCOPE_CHANGED', 'NATIVE_FILE_SCOPE_CHANGED', 'NATIVE_MENU_CHANGED', 'SELECTED_TARGET_CHANGED', 'NATIVE_ROUTE_OR_BOOTSTRAP_CHANGED', 'EXTENSION_SETTINGS_CHANGED'].includes(fixed) ? fixed : 'CURRENT_CHECK_FAILED';throw failure;
    }
  };
  const click = async (action) => {
    await current();const handle = await page.evaluateHandle(gitLabWhitespaceProbe, action, GITLAB_WHITESPACE);
    try {
      const node = handle.asElement();check(node !== null, 'ORIGINAL_NATIVE_CONTROL_UNAVAILABLE');
      await node.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));await current();
      check(await node.evaluate((element) => { const r = element.getBoundingClientRect();const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);return element.isConnected && hit !== null && (hit === element || element.contains(hit)); }), 'NATIVE_CONTROL_OCCLUDED');
      await node.click();
    }
    finally { await handle.dispose(); }
  };
  const transition = async (desired, phase) => {
    observer.phase(phase);let before = await current(phase === 'toggle' ? 'mark-toggle' : 'mark-restore');
    if (phase === 'toggle') check(before.checked === baseline.checked, 'NATIVE_PROPERTY_CHANGED_BEFORE_TOGGLE');
    if (before.checked === desired) return { status: 'property_already_matches', snapshot: before };
    if (phase === 'restore' && before.open === false) {
      check(p.restorationReopen === undefined, 'RESTORE_REOPEN_ALREADY_ATTEMPTED');
      const previous = before;const start = before.events.length;
      const reopen = { attempts: 1, action: 'original_native_opener', status: 'attempted', before: { qualified: before.qualified, bound: before.bound, open: before.open, checked: before.checked } };
      p.restorationReopen = reopen;
      try {
        await click('opener');
        const opened = await poll(async () => {
          try { return { ok: true, value: await current() }; } catch (failure) { return { ok: false, code: code(failure) }; }
        }, (result) => !result.ok || result.value.open && result.value.events.slice(start).some((event) => event.kind === 'opener' && event.type === 'click' && event.trusted === true), 'Same original Preferences menu reopens for restoration');
        check(opened.ok, opened.code ?? 'RESTORE_REOPEN_UNQUALIFIED');
        check(opened.value.checked === previous.checked && isDeepStrictEqual(opened.value.other, previous.other), 'RESTORE_REOPEN_CHANGED_PREFERENCES');
        reopen.status = 'opened_original_menu';reopen.after = { qualified: opened.value.qualified, bound: opened.value.bound, open: opened.value.open, checked: opened.value.checked };
        reopen.events = opened.value.events.slice(start).filter((event) => event.kind === 'opener');before = opened.value;
      } catch (failure) { reopen.status = 'failed';reopen.failure = code(failure);throw failure; }
    }
    const prior = before.events.length;
    if (phase === 'toggle') { toggleAttempted = true;p.toggleAttempted = true; }
    await click('toggle-target');
    const value = await poll(current, (next) => next.events.slice(prior).some((event) => event.kind === 'whitespace' && event.type === 'change' && event.trusted === true && event.checked === desired), 'Original native whitespace property and trusted change');
    check(value.bound, 'NATIVE_MENU_OWNER_LOST');
    return { status: value.checked === desired ? 'native_property_transition_observed' : 'native_reverted', snapshot: value };
  };
  const modeWitnesses = (phase, checked) => observer.evidence.modes.filter((entry) => entry.phase === phase && entry.eligible === true && entry.nativeFrame && !entry.extensionFrame && entry.status === 200 && entry.finished === true && entry.ignoreWhitespace === !checked);
  const settled = async () => poll(async () => {
    const before = await current();await page.evaluate(gitLabWhitespaceProbe, 'frame', GITLAB_WHITESPACE);const after = await current();
    return { stable: isDeepStrictEqual(before.files, after.files) && before.checked === after.checked, snapshot: after };
  }, (value) => value.stable, 'Native source is mounted and stable across animation frames');
  try {
    observer.phase('baseline');await settings.current();
    let readyScope;
    const ready = await poll(async () => {
      const value = await read();
      if (value.qualified) {
        const next = { url: value.url, source: value.app.sourceVersions, target: value.app.targetVersions, stream: value.nativeStream, files: value.files.map(({ path, anchor, head }) => [path, anchor, head]) };
        if (readyScope && !isDeepStrictEqual(next, readyScope)) return { qualified: false, code: 'BASELINE_SOURCE_CHANGED' };
        readyScope ??= next;
      }
      return value;
    }, (value) => value.qualified === true ? value.files.length === GITLAB_WHITESPACE.paths.length && value.files.every((file) => file.mounted === true)
      : !['SOURCE_OWNER_PENDING', 'MENU_OWNER_PENDING'].includes(value.code), 'Original anonymous GitLab native preferences and mounted pinned source');
    selection(ready);
    p.setupPhase = 'ARM_ORIGINAL_OPENER';
    const armed = await observed('arm-opener');installed = armed?.armed === true;selection(armed);check(installed, 'OPENER_ARM_UNQUALIFIED');
    p.setupPhase = 'OPEN_ORIGINAL_MENU';
    await click('opener');await poll(read, (value) => value.qualified && value.open, 'Original native Preferences opens');
    p.setupPhase = 'BIND_ORIGINAL_MENU';
    const value = await observed('bind');bound = value?.bound === true;selection(value);check(value.bound && value.open, 'NATIVE_BASELINE_UNQUALIFIED');
    check(value.events.some((event) => event.kind === 'opener' && event.type === 'click' && event.trusted === true) && !value.events.some((event) => event.kind !== 'opener'), 'TRUSTED_OPENER_UNVERIFIED');baseline = value;
    p.baseline = retainedBaseline(baseline);if (value.nativeFilesDiagnostic !== undefined) p.nativeFilesBaseline = value.nativeFilesDiagnostic;p.selection = selection(baseline);p.toggleAttempted = false;p.setupPhase = 'BEFORE_INTENT_CHECKPOINT';
    await comparisons.checkpoint('beforeIntent', {});
    p.setupPhase = 'INDEPENDENT_ACQUISITION';p.acquisitionMatch = { attempts: 0, source: false, target: false, pairedVersions: false, immutableSourceTarget: false, metadata: false, matched: false, proofMode: 'unverified', proofResponseId: null, endpointTarget: null };
    await poll(async () => {
      await current();
      try {
        const match = acquisitionMatches(baseline, acquisition());
        p.acquisitionMatch = { attempts: Math.min(p.acquisitionMatch.attempts + 1, 65535), ...match };p.lastAcquisitionCheck = match.matched ? 'MATCHED' : 'MISMATCH';return match.matched;
      } catch (failure) { p.lastAcquisitionCheck = 'ACQUISITION_READ_FAILED';throw failure; }
    }, (value) => value === true, 'Already-issued independent source and target version evidence');
    p.setupPhase = 'BIND_NATIVE_ENDPOINT';observer.bind(baseline.nativeStream);
    p.setupPhase = 'VIEWED_SANITY';
    check(baseline.files.every((file) => file.viewed.disabled === true), 'ANONYMOUS_VIEWED_UNEXPECTEDLY_ENABLED');
    p.viewed = { status: 'disabled_native_values_preserved', count: baseline.files.length, nodeIdentityAcrossReload: 'not_asserted', positiveWriteAcceptance: false };
    p.setupPhase = 'NATIVE_TOGGLE';
    const toggled = await transition(!baseline.checked, 'toggle');p.stages.push({ phase: 'toggle', ...toggled });
    // Native preference rejection and native reload are recorded independently, never coerced into success.
    if (toggled.status === 'native_property_transition_observed') {
      p.setupPhase = 'NATIVE_MODE_WAIT';
      try { await poll(async () => { await current();return modeWitnesses('toggle', !baseline.checked).length > 0; }, (ready) => ready === true, 'Already-issued native whitespace-mode response'); }
      catch { p.modeEvidence = 'no_complete_native_mode_witness';await current(); }
    }
    p.setupPhase = 'AFTER_TOGGLE_STABILITY';
    p.afterToggle = (await settled()).snapshot;
    const modes = modeWitnesses('toggle', !baseline.checked);
    p.nativeMode = modes.length > 0 ? 'native_frame_mode_response_observed' : 'property_only_native_source_mode_unverified';
    p.status = modes.length > 0 ? 'bounded_anonymous_characterization' : 'partial';
    p.setupPhase = 'COMPLETE';
    p.counts = 'No whitespace-only delta or wrong Geld counts inferred from this additive fixture.';
  } catch (failure) { primary = error(code(failure));p.primaryFailure = code(failure);p.failurePhase = p.setupPhase;p.failureProbe = p.lastProbe;p.failureCurrentCheck = p.lastCurrentCheck;p.failureLifecycle = p.lifecycle;p.status = baseline ? 'failed' : 'unavailable'; }
  finally {
    if (baseline && bound && toggleAttempted && !page.isClosed()) {
      try {
        const restored = await transition(baseline.checked, 'restore');p.restoration = restored;
        check(restored.snapshot.checked === baseline.checked, 'NATIVE_RESTORATION_REJECTED');
        p.propertyVectorRestored = isDeepStrictEqual(restored.snapshot.other, baseline.other)
          && isDeepStrictEqual(restored.snapshot.files.map((file) => [file.path, file.viewed]), baseline.files.map((file) => [file.path, file.viewed]));
        check(p.propertyVectorRestored, 'NATIVE_PROPERTY_VECTOR_NOT_RESTORED');
        if (restored.status === 'native_property_transition_observed') {
          await poll(async () => { await current();return modeWitnesses('restore', baseline.checked).length > 0; }, (ready) => ready === true, 'Original native mode response completed during restoration');
        }
        p.restoredStable = (await settled()).snapshot;
        check(p.restoredStable.checked === baseline.checked, 'NATIVE_RESTORATION_REJECTED');
        check(isDeepStrictEqual(p.restoredStable.other, baseline.other), 'OTHER_NATIVE_PREFERENCE_CHANGED');
        check(isDeepStrictEqual(p.restoredStable.files.map((file) => [file.path, file.viewed]), baseline.files.map((file) => [file.path, file.viewed])), 'NATIVE_VIEWED_CHANGED');
        p.propertyVectorRestored = true;
        p.effectiveModeRestored = restored.status === 'native_property_transition_observed' && modeWitnesses('restore', baseline.checked).length > 0 ? 'observed_baseline_mode_response' : 'unverified';
        p.nativeRestored = p.effectiveModeRestored === 'observed_baseline_mode_response';
        if (!p.nativeRestored && modeWitnesses('toggle', !baseline.checked).length > 0) cleanupErrors.push('EFFECTIVE_MODE_RESTORE_UNVERIFIED');
      } catch (failure) { cleanupErrors.push(code(failure));p.nativeRestored = false; }
    }
    if (baseline && page.isClosed()) { p.nativeRestored = false;cleanupErrors.push('NATIVE_RESTORE_PAGE_CLOSED'); }
    if (installed && !page.isClosed()) try { const released = await page.evaluate(gitLabWhitespaceProbe, 'cleanup', GITLAB_WHITESPACE);const lifecycle = retainedLifecycle(released?.lifecycle);if (lifecycle !== undefined) p.lifecycle = lifecycle;check(released?.released === true, 'PROBE_CLEANUP_FAILED'); } catch { cleanupErrors.push('PROBE_CLEANUP_FAILED'); }
    p.nativeCleanupCodes = [...cleanupErrors];
    const cleanup = await cleanupGitLabWhitespace(page, { settings, observer, comparisons, progress: p });
    cleanupErrors.splice(0, cleanupErrors.length, ...cleanup.codes);
  }
  if (primary || cleanupErrors.length) { if (cleanupErrors.length) p.status = 'failed';throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors.map(error)], 'GitLab native whitespace characterization or cleanup failed'); }
  return { status: p.status === 'bounded_anonymous_characterization' ? 'discovery' : 'unavailable', featureParity: 'not_evaluated', reason: 'Anonymous native property and bounded source-mode characterization only. No authenticated persistence, native Viewed write, automatic redirect or whitespace-only count acceptance.' };
}
