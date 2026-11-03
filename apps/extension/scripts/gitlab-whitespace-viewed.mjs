import { isDeepStrictEqual } from 'node:util';
import { GITLAB_FILE_SEARCH, gitLabFileSearchSelection } from './gitlab-file-search.mjs';
import { gitLabWhitespaceProbe } from './gitlab-whitespace-probe.mjs';

export const GITLAB_WHITESPACE = Object.freeze({ ...GITLAB_FILE_SEARCH, paths: ['app/graphql/mutations/boards/issues/issue_move_list.rb', 'app/services/boards/base_item_move_service.rb', GITLAB_FILE_SEARCH.path] });
const error = (code) => Object.assign(new Error(`GitLab whitespace characterization: ${code}`), { code });
const check = (value, code) => { if (!value) throw error(code); };
const code = (value) => typeof value?.code === 'string' && /^[A-Z_]{1,64}$/.test(value.code) ? value.code : 'OPERATION_FAILED';
const cleanups = new WeakMap();

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
  const versions = responses.some((entry) => entry.status === 'projected' && entry.kind === 'versions' && entry.projection?.source?.selectedCount === 1 && entry.projection.target?.selectedCount === 1
    && entry.projection.source.values[0]?.id === selected.source.id && entry.projection.source.values[0]?.headSha === selected.source.head
    && entry.projection.target.values[0]?.id === selected.target.id && entry.projection.target.values[0]?.headSha === selected.target.head);
  const metadata = responses.some((entry) => entry.status === 'projected' && entry.kind === 'metadata' && entry.projection?.projectPath === 'gitlab-org/gitlab' && entry.projection.diffId === GITLAB_WHITESPACE.version
    && entry.projection.inventory?.state === 'observed' && entry.projection.inventory.scanComplete === true && entry.projection.inventory.total === GITLAB_WHITESPACE.paths.length
    && entry.projection.inventory.uniqueNewPaths === GITLAB_WHITESPACE.paths.length && entry.projection.inventory.paths?.length === GITLAB_WHITESPACE.paths.length
    && [3, '3'].includes(entry.projection.inventory.size) && [3, '3'].includes(entry.projection.inventory.realSize) && entry.projection.inventory.overflow === false
    && entry.projection.inventory.paths.every((file) => GITLAB_WHITESPACE.paths.includes(file.newPath) && !file.deleted && !file.submodule));
  return versions && metadata;
}

export async function verifyGitLabWhitespace(page, { settings, observer, comparisons, acquisition, poll, progress }) {
  const p = progress;Object.assign(p, { status: 'running', stages: [], propertyVectorRestored: false, effectiveModeRestored: 'unverified', nativeRestored: false,
    artifacts: { suppressed: 'Report only. No HTML, AX, PNG, arbitrary field values or raw bootstrap.' } });
  let baseline;let bound = false;let installed = false;let toggleAttempted = false;let primary;const cleanupErrors = [];
  const read = () => page.evaluate(gitLabWhitespaceProbe, 'read', GITLAB_WHITESPACE);
  const current = async () => {
    await settings.current();const value = await read();const chosen = selection(value);
    if (baseline) { check(isDeepStrictEqual(chosen, selection(baseline)), 'SELECTED_TARGET_CHANGED');check(value.url === baseline.url && value.initialShowWhitespace === baseline.initialShowWhitespace, 'NATIVE_ROUTE_OR_BOOTSTRAP_CHANGED'); }
    return value;
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
    observer.phase(phase);const before = await current();
    if (phase === 'toggle') check(before.checked === baseline.checked, 'NATIVE_PROPERTY_CHANGED_BEFORE_TOGGLE');
    if (before.checked === desired) return { status: 'property_already_matches', snapshot: before };
    const prior = before.events.length;
    if (phase === 'toggle') toggleAttempted = true;
    await click('toggle-target');
    const value = await poll(current, (next) => next.events.slice(prior).some((event) => event.kind === 'whitespace' && event.type === 'change' && event.trusted === true && event.checked === desired), 'Original native whitespace property and trusted change');
    check(value.bound && value.open, 'NATIVE_MENU_OWNER_LOST');
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
    const armed = await page.evaluate(gitLabWhitespaceProbe, 'arm-opener', GITLAB_WHITESPACE);installed = armed?.armed === true;selection(armed);check(installed, 'OPENER_ARM_UNQUALIFIED');
    await click('opener');await poll(read, (value) => value.qualified && value.open, 'Original native Preferences opens');
    const value = await page.evaluate(gitLabWhitespaceProbe, 'bind', GITLAB_WHITESPACE);bound = value?.bound === true;selection(value);check(value.bound && value.open, 'NATIVE_BASELINE_UNQUALIFIED');
    check(value.events.some((event) => event.kind === 'opener' && event.type === 'click' && event.trusted === true) && !value.events.some((event) => event.kind !== 'opener'), 'TRUSTED_OPENER_UNVERIFIED');baseline = value;
    await comparisons.checkpoint('beforeIntent', {});
    await poll(async () => { await current();return acquisitionMatches(baseline, acquisition()); }, (value) => value === true, 'Already-issued independent source and target version evidence');
    observer.bind(baseline.nativeStream);
    p.baseline = baseline;p.selection = selection(baseline);
    check(baseline.files.every((file) => file.viewed.disabled === true), 'ANONYMOUS_VIEWED_UNEXPECTEDLY_ENABLED');
    p.viewed = { status: 'disabled_native_values_preserved', count: baseline.files.length, nodeIdentityAcrossReload: 'not_asserted', positiveWriteAcceptance: false };
    const toggled = await transition(!baseline.checked, 'toggle');p.stages.push({ phase: 'toggle', ...toggled });
    // Native preference rejection and native reload are recorded independently, never coerced into success.
    if (toggled.status === 'native_property_transition_observed') {
      try { await poll(async () => { await current();return modeWitnesses('toggle', !baseline.checked).length > 0; }, (ready) => ready === true, 'Already-issued native whitespace-mode response'); }
      catch { p.modeEvidence = 'no_complete_native_mode_witness';await current(); }
    }
    p.afterToggle = (await settled()).snapshot;
    const modes = modeWitnesses('toggle', !baseline.checked);
    p.nativeMode = modes.length > 0 ? 'native_frame_mode_response_observed' : 'property_only_native_source_mode_unverified';
    p.status = modes.length > 0 ? 'bounded_anonymous_characterization' : 'partial';
    p.counts = 'No whitespace-only delta or wrong Geld counts inferred from this additive fixture.';
  } catch (failure) { primary = error(code(failure));p.primaryFailure = code(failure);p.status = baseline ? 'failed' : 'unavailable'; }
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
    if (installed && !page.isClosed()) try { check((await page.evaluate(gitLabWhitespaceProbe, 'cleanup', GITLAB_WHITESPACE))?.released === true, 'PROBE_CLEANUP_FAILED'); } catch { cleanupErrors.push('PROBE_CLEANUP_FAILED'); }
    p.nativeCleanupCodes = [...cleanupErrors];
    const cleanup = await cleanupGitLabWhitespace(page, { settings, observer, comparisons, progress: p });
    cleanupErrors.splice(0, cleanupErrors.length, ...cleanup.codes);
  }
  if (primary || cleanupErrors.length) { if (cleanupErrors.length) p.status = 'failed';throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors.map(error)], 'GitLab native whitespace characterization or cleanup failed'); }
  return { status: p.status === 'bounded_anonymous_characterization' ? 'discovery' : 'unavailable', featureParity: 'not_evaluated', reason: 'Anonymous native property and bounded source-mode characterization only. No authenticated persistence, native Viewed write, automatic redirect or whitespace-only count acceptance.' };
}
