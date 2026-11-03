import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Window } from 'happy-dom';
import { GITLAB_WHITESPACE as F, cleanupGitLabWhitespace, gitLabWhitespaceSettings, observeGitLabWhitespace, verifyGitLabWhitespace, whitespaceReceiptURL } from './gitlab-whitespace-viewed.mjs';
import { gitLabWhitespaceProbe as probe } from './gitlab-whitespace-probe.mjs';

const T = 'c'.repeat(40);
function state() {
  return { qualified: true, anonymous: true, url: F.url, initialShowWhitespace: false, checked: false, other: { fileByFile: false }, open: false, bound: false, events: [], eventOverflow: false,
    nativeStream: { resource: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs_stream', diffId: F.version, view: 'inline', requestSourceHead: 'absent', requestTargetHead: 'absent' },
    app: { path: '/gitlab-org/gitlab/-/merge_requests/266334', iid: 266334, fileByFileMode: false,
      sourceVersions: [{ id: 2158520123, head_sha: F.head, selected: true, is_merge_head: false, href: F.url }],
      targetVersions: [{ id: 2159233785, head_sha: T, selected: true, is_merge_head: true, href: F.url }] },
    files: F.paths.map((path, i) => ({ path, anchor: String(i).repeat(40), head: T, mounted: true, rows: 1, sha256: 'a'.repeat(64), viewed: { checked: false, disabled: true } })) };
}
function evidence() {
  return { responses: [{ id: 'r4', kind: 'versions', status: 'projected', httpStatus: 200, selectionRedacted: false, selection: { diff_id: F.version }, url: `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/versions?diff_id=${F.version}`, projection: { source: { state: 'observed', selectedCount: 1, values: [{ id: F.version, headSha: F.head }] }, target: { state: 'observed', selectedCount: 1, values: [{ id: '2159233785', headSha: T, startSha: 'e'.repeat(40), mergeHead: true }] } } },
    { id: 'r2', kind: 'metadata', status: 'projected', httpStatus: 200, selectionRedacted: false, selection: { diff_id: F.version }, url: `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs_metadata.json?diff_id=${F.version}`, projection: { projectPath: 'gitlab-org/gitlab', diffId: F.version, inventory: { state: 'observed', scanComplete: true, total: 3, uniqueNewPaths: 3, size: 3, realSize: 3, overflow: false, paths: F.paths.map((newPath) => ({ newPath, deleted: false, submodule: false })) } } }] };
}
async function protocol(options = {}) {
  let live = state();let closed = false;let phase = 'baseline';let clicks = 0;let writes = 0;let readinessReads = 0;let binds = 0;let acquisitionReads = 0;let afterChangeReads = 0;let fileFailureActive = false;const order = [];const progress = {};const settingsProgress = {};
  if (options.nativeSelection) { live.app = structuredClone(options.nativeSelection);live.files.forEach((file) => { file.head = live.app.targetVersions.find((version) => version.selected).head_sha; }); }
  if (options.nativeMutation) options.nativeMutation(live);
  if (options.mountPending) live.files.forEach((file) => { file.mounted = false; });
  const original = { sync: { present: true, value: { enabled: false, keep: 'DO_NOT_RETAIN_SETTINGS_CANARY' } }, local: { present: false } };let storage = structuredClone(original);
  const settings = gitLabWhitespaceSettings({ progress: settingsProgress, read: async () => structuredClone(storage), write: async (value) => { writes++;storage = structuredClone(value);order.push(closed ? 'restore-after-close' : 'prepare'); } });
  await settings.prepare();
  const observer = { evidence: { modes: [], nonreads: [], overflow: false }, bind: (value) => assert.deepEqual(value, state().nativeStream),
    phase: (value) => {
      phase = value;if (options.revertBeforeRestore && value === 'restore') live.checked = false;
      if (value === 'restore' && options.closedAfterToggle && options.driftBeforeReopen) { live.qualified = false;live.code = options.driftBeforeReopen === 'actor' ? 'ACTOR_UNQUALIFIED' : 'ORIGINAL_OWNER_CHANGED'; }
    }, dispose: async () => { order.push('observer');if (options.observerFailure) throw Error('DO_NOT_RETAIN_OBSERVER_CANARY'); } };
  const comparisons = { checkpoint: async () => { if (options.checkpointFailure) throw Error('DO_NOT_RETAIN_CHECKPOINT_CANARY'); }, dispose: async () => { order.push('comparisons');if (options.comparisonFailure) throw Error('DO_NOT_RETAIN_COMPARISON_CANARY'); } };
  const page = {
    isClosed: () => closed, close: async () => { order.push('close');if (options.closeFailure) throw Error('DO_NOT_RETAIN_CLOSE_CANARY');closed = true; },
    evaluate: async (fn, action) => {
      assert.equal(fn, probe);
      if (action === 'read' && !live.armed && options.mountPending) {
        readinessReads++;
        if (readinessReads === 2) {
          live.files.forEach((file) => { file.mounted = true; });
          if (options.mountScopeChanged) { live.app.targetVersions[0].head_sha = 'b'.repeat(40);live.files.forEach((file) => { file.head = 'b'.repeat(40); }); }
          if (options.mountUnknownControl) { live.qualified = false;live.code = 'MENU_SCHEMA_UNQUALIFIED'; }
        }
      }
      if (action === 'cleanup') { order.push('release');if (options.probeCleanupFailure) throw Error('DO_NOT_RETAIN_CLEANUP_CANARY');return { released: true }; }
      if (action === 'arm-opener') live.armed = true;
      if (action === 'bind') { live.bound = true;binds++; }
      if (action === 'frame' && phase === 'toggle' && options.closedAfterToggle) live.open = false;
      if (options.snapshotExtras) { live.secret = 'DO_NOT_RETAIN_PROBE_CANARY';live.app.token = 'DO_NOT_RETAIN_BOOTSTRAP_CANARY';live.files[0].secret = 'DO_NOT_RETAIN_FILE_CANARY'; }
      if (options.pairingUnknown && acquisitionReads) return { qualified: false, code: 'MENU_SCHEMA_UNQUALIFIED', secret: 'DO_NOT_RETAIN_UNKNOWN_CANARY' };
      if (options.scopeAfterMatch && acquisitionReads) {
        if (options.scopeAfterMatch === 'target') { live.app.targetVersions[0].head_sha = 'b'.repeat(40);live.files.forEach((file) => { file.head = 'b'.repeat(40); }); }
        else { live.qualified = false;live.code = options.scopeAfterMatch === 'actor' ? 'ACTOR_UNQUALIFIED' : 'ORIGINAL_OWNER_CHANGED'; }
      }
      if (options.pairingTargetDrift && acquisitionReads) { live.app.targetVersions[0].head_sha = 'b'.repeat(40);live.files.forEach((file) => { file.head = 'b'.repeat(40); }); }
      if (options.fileDataAfterToggle && action === 'read') {
        if (phase === 'toggle' && live.events.some((event) => event.kind === 'whitespace') && ++afterChangeReads >= 2) fileFailureActive = true;
        if (fileFailureActive) return { qualified: false, code: 'FILE_DATA_UNQUALIFIED', fileData: options.fileDataAfterToggle, secret: 'DO_NOT_RETAIN_FILE_FAILURE' };
      }
      if (options.unknown) return { qualified: false, code: 'MENU_SCHEMA_UNQUALIFIED' };
      return structuredClone(live);
    },
    evaluateHandle: async (fn, action) => {
      assert.equal(fn, probe);assert.ok(['opener', 'toggle-target'].includes(action));
      return { asElement: () => action === 'toggle-target' && !live.open || action === 'opener' && live.open ? null : ({ evaluate: async () => true, click: async () => {
        assert.equal(live.files.every((file) => file.mounted), true, 'Native action preceded complete source mounting');
        clicks++;if (action === 'opener') {
          live.open = !(phase === 'restore' && options.reopenStaysClosed);live.events.push({ kind: 'opener', type: 'click', trusted: !options.untrustedOpener });
          if (phase === 'restore' && options.driftDuringReopen) { live.qualified = false;live.code = options.driftDuringReopen === 'actor' ? 'ACTOR_UNQUALIFIED' : 'ORIGINAL_OWNER_CHANGED'; }
          return;
        }
        const desired = !live.checked;live.checked = desired;
        if (options.closeImmediatelyAfterChange) live.open = false;
        if (options.loseBindingAfterChange) live.bound = false;
        live.events.push({ kind: 'whitespace', type: 'change', trusted: !options.untrusted, checked: desired });
        observer.evidence.nonreads.push({ method: 'PUT', resource: 'https://gitlab.com/api/v4/user/preferences', status: 401, phase, provenance: 'unattributed_browser_request' });
        if (options.revert && phase === 'toggle') live.checked = !desired;
        else if (options.rejectRestore && phase === 'restore') live.checked = !desired;
        else observer.evidence.modes.push({ phase, eligible: true, nativeFrame: true, extensionFrame: false, ignoreWhitespace: !desired, status: 200, finished: true });
        if (options.authAfterToggle && phase === 'toggle') { live.qualified = false;live.code = 'ACTOR_UNQUALIFIED'; }
        if (options.unknownAfterToggle && phase === 'toggle') { live.qualified = false;live.code = 'MENU_SCHEMA_UNQUALIFIED'; }
        if (options.headAfterToggle && phase === 'toggle') live.app.targetVersions[0].head_sha = 'b'.repeat(40);
      } }), dispose: async () => {} };
    },
  };
  const poll = async (read, accepts) => { for (let i = 0; i < 4; i++) { try { const value = await read();if (accepts(value)) return value; } catch (failure) { if (!options.swallowPollErrors) throw failure; } }throw Object.assign(Error('Unit deadline'), { code: 'OBSERVATION_DEADLINE' }); };
  return { page, progress, settingsProgress, observer, comparisons, order, original, storage: () => storage, clicks: () => clicks, writes: () => writes, readinessReads: () => readinessReads, binds: () => binds,
    run: () => verifyGitLabWhitespace(page, { settings, observer, comparisons, acquisition: () => {
      acquisitionReads++;
      if (options.acquisitionFailure) throw Error('DO_NOT_RETAIN_ACQUISITION_CANARY');
      if (options.noAcquisition || options.pairingUnknown || options.pairingTargetDrift) return {};
      const value = options.acquisitionEvidence ? structuredClone(options.acquisitionEvidence) : evidence();
      if (options.acquisitionSourceMismatch) value.responses[0].projection.source.values[0].headSha = 'b'.repeat(40);
      if (options.acquisitionTargetMismatch) value.responses[0].projection.target.values[0].headSha = 'b'.repeat(40);
      if (options.splitVersions) { const split = structuredClone(value.responses[0]);value.responses[0].projection.target.values[0].headSha = 'b'.repeat(40);split.projection.source.values[0].headSha = 'b'.repeat(40);value.responses.push(split); }
      if (options.incompleteInventory) value.responses[1].projection.inventory.realSize = 4;return value;
    }, poll, progress }), settings };
}

test('actual orchestrator observes natural anonymous401 plus local transition, restores native flag then exact raw keys after close', async () => {
  const f = await protocol();const result = await f.run();assert.equal(result.status, 'discovery');assert.equal(f.progress.nativeRestored, true);assert.equal(f.progress.restoration.snapshot.checked, false);
  assert.equal(f.clicks(), 3);assert.deepEqual(f.observer.evidence.nonreads.map((v) => v.status), [401, 401]);assert.equal(f.progress.nativeMode, 'native_frame_mode_response_observed');
  assert.deepEqual(f.storage(), f.original);assert.equal(f.settingsProgress.restoredAfterPageClose, true);assert.ok(f.order.indexOf('close') < f.order.indexOf('restore-after-close'));
  assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});

function immutableNative() {
  const app = state().app;app.targetVersions = [{ ...app.sourceVersions[0], href: F.url.replace(`?diff_id=${F.version}`, '') }];return app;
}
function observed285() {
  const value = evidence();value.responses[0].projection.target.values = [{ id: '2160390432', headSha: '10a04f986a724a5e7f17a46fadba3ce5b38d8b58', startSha: 'b921bda411b49f7ce5d0a169c065f9f0d2f479c0', mergeHead: true }];return value;
}
test('observed285 identical native nonmerge target is independently verified through its same-response source without adopting the endpoint merge target', async () => {
  const f = await protocol({ nativeSelection: immutableNative(), acquisitionEvidence: observed285() });assert.equal((await f.run()).status, 'discovery');
  assert.deepEqual(f.progress.selection.target, { id: F.version, head: F.head, mergeHead: false });assert.equal(f.progress.baseline.files.every((file) => file.head === F.head), true);
  assert.deepEqual(f.progress.acquisitionMatch, { attempts: 1, source: true, target: false, pairedVersions: false, immutableSourceTarget: true, metadata: true, matched: true,
    proofMode: 'same_immutable_source_version', proofResponseId: 'r4', endpointTarget: { id: '2160390432', head: '10a04f986a724a5e7f17a46fadba3ce5b38d8b58', mergeHead: true } });
  assert.equal(f.progress.restoredStable.app.targetVersions[0].id, Number(F.version));assert.equal(f.clicks(), 3);assert.equal(f.binds(), 1);assert.equal(f.progress.nativeRestored, true);assert.deepEqual(f.storage(), f.original);
});
test('observed282 exact nonmerge endpoint target keeps direct same-response proof', async () => {
  const value = observed285();value.responses[0].projection.target.values = [{ id: F.version, headSha: F.head, startSha: 'e'.repeat(40), mergeHead: false }];
  const f = await protocol({ nativeSelection: immutableNative(), acquisitionEvidence: value });assert.equal((await f.run()).status, 'discovery');
  assert.equal(f.progress.acquisitionMatch.proofMode, 'same_response_selected_target');assert.equal(f.progress.acquisitionMatch.target, true);assert.equal(f.progress.acquisitionMatch.pairedVersions, true);assert.equal(f.progress.acquisitionMatch.immutableSourceTarget, false);
});
test('a distinct native merge target still needs exact same-response source, target and kind', async () => {
  const f = await protocol();assert.equal((await f.run()).status, 'discovery');assert.equal(f.progress.acquisitionMatch.proofMode, 'same_response_selected_target');assert.equal(f.progress.acquisitionMatch.immutableSourceTarget, false);assert.equal(f.progress.selection.target.head, T);
});
for (const [name, mutate] of [
  ['source wrong ID despite matching SHA', (value) => { value.responses[0].projection.source.values[0].id = '2151401827'; }],
  ['source wrong full head', (value) => { value.responses[0].projection.source.values[0].headSha = T; }],
  ['truncated source', (value) => { value.responses[0].projection.source.state = 'truncated'; }],
  ['ambiguous source', (value) => { value.responses[0].projection.source.selectedCount = 2; }],
  ['split source and default target responses', (value) => { const other = structuredClone(value.responses[0]);value.responses[0].projection.target.values = [];other.projection.source.values[0].id = '2151401827';value.responses.push(other); }],
  ['missing default target', (value) => { delete value.responses[0].projection.target; }],
  ['truncated default target', (value) => { value.responses[0].projection.target.state = 'truncated'; }],
  ['ambiguous default target', (value) => { value.responses[0].projection.target.selectedCount = 2; }],
  ['extra default target with false unique count', (value) => { value.responses[0].projection.target.values.push({ ...value.responses[0].projection.target.values[0] }); }],
  ['invalid default target head', (value) => { value.responses[0].projection.target.values[0].headSha = 'short'; }],
  ['invalid default target start SHA', (value) => { value.responses[0].projection.target.values[0].startSha = null; }],
  ['missing default target kind', (value) => { delete value.responses[0].projection.target.values[0].mergeHead; }],
  ['same source ID with conflicting API target head', (value) => { value.responses[0].projection.target.values[0].id = F.version;value.responses[0].projection.target.values[0].mergeHead = false; }],
  ['same source ID with false API merge kind', (value) => { value.responses[0].projection.target.values[0] = { id: F.version, headSha: F.head, startSha: 'e'.repeat(40), mergeHead: true }; }],
  ['arbitrary different nonmerge default target', (value) => { value.responses[0].projection.target.values[0].mergeHead = false; }],
  ['versions wrong round', (value) => { value.responses[0].selection.diff_id = '2151401827'; }],
  ['versions wrong native MR', (value) => { value.responses[0].url = value.responses[0].url.replace('266334', '266335'); }],
  ['versions conflicting ref query', (value) => { value.responses[0].url += `&start_sha=${T}`; }],
  ['metadata wrong round', (value) => { value.responses[1].projection.diffId = '2151401827'; }],
  ['metadata wrong project', (value) => { value.responses[1].projection.projectPath = 'other/project'; }],
  ['metadata missing file', (value) => { value.responses[1].projection.inventory.paths.pop(); }],
]) test(`immutable source proof refuses ${name} before native toggle`, async () => {
  const value = observed285();mutate(value);const f = await protocol({ nativeSelection: immutableNative(), acquisitionEvidence: value });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.acquisitionMatch.matched, false);assert.equal(f.progress.acquisitionMatch.proofMode === 'same_immutable_source_version' && f.progress.acquisitionMatch.metadata, false);
  assert.equal(f.progress.toggleAttempted, false);assert.equal(f.clicks(), 1);assert.equal(f.binds(), 1);assert.equal(f.progress.selection.target.head, F.head);assert.deepEqual(f.observer.evidence.nonreads, []);assert.deepEqual(f.storage(), f.original);
});
for (const [name, mutate] of [
  ['native same head under wrong target ID', (live) => { live.app.targetVersions[0].id = 2151401827; }],
  ['native false merge kind for source ID', (live) => { live.app.targetVersions[0].is_merge_head = true; }],
  ['native wrong full target head', (live) => { live.app.targetVersions[0].head_sha = T;live.files.forEach((file) => { file.head = T; }); }],
  ['one native file head mismatch', (live) => { live.files[0].head = T; }],
  ['native wrong MR', (live) => { live.app.path = '/gitlab-org/gitlab/-/merge_requests/266335'; }],
]) test(`${name} cannot enter immutable source proof`, async () => {
  const f = await protocol({ nativeSelection: immutableNative(), nativeMutation: mutate, acquisitionEvidence: observed285() });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.clicks(), 0);assert.equal(f.binds(), 0);assert.equal(f.progress.selection, undefined);assert.deepEqual(f.storage(), f.original);
});
for (const field of ['id', 'mergeHead']) test(`a distinct native merge target refuses API target ${field} mismatch even with an otherwise matching response`, async () => {
  const value = evidence();value.responses[0].projection.target.values[0][field] = field === 'id' ? '2151401827' : false;
  const f = await protocol({ acquisitionEvidence: value });await assert.rejects(f.run(), AggregateError);assert.equal(f.progress.acquisitionMatch.target, false);assert.equal(f.progress.acquisitionMatch.immutableSourceTarget, false);assert.equal(f.progress.toggleAttempted, false);assert.equal(f.clicks(), 1);assert.deepEqual(f.storage(), f.original);
});
for (const scope of ['target', 'owner', 'actor']) test(`native ${scope} changes after immutable matching cannot be adopted before the first toggle`, async () => {
  const f = await protocol({ nativeSelection: immutableNative(), acquisitionEvidence: observed285(), scopeAfterMatch: scope });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.acquisitionMatch.immutableSourceTarget, true);assert.equal(f.progress.failurePhase, 'NATIVE_TOGGLE');assert.equal(f.progress.toggleAttempted, false);assert.equal(f.clicks(), 1);assert.equal(f.progress.selection.target.head, F.head);assert.deepEqual(f.storage(), f.original);
});


for (const matches of [true, false]) test(`actual mode-wait file failure retains only whitelisted diagnostic and endpoint-head equality=${matches} without adopting it`, async () => {
  const endpoint = observed285().responses[0].projection.target.values[0].headSha;
  const detail = { reason: 'FILE_HEAD_MISMATCH', pathSlot: 0, knownPath: true, refPresent: true, headValid: true, headMatchesTarget: false, anchorValid: true, candidateHead: matches ? endpoint : 'a'.repeat(40), secret: 'DO_NOT_RETAIN' };
  const f = await protocol({ nativeSelection: immutableNative(), acquisitionEvidence: observed285(), fileDataAfterToggle: detail });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.failurePhase, 'NATIVE_MODE_WAIT');assert.equal(f.progress.primaryFailure, 'FILE_DATA_UNQUALIFIED');
  assert.equal(f.progress.failureProbe.fileData.candidateMatchesEndpointTarget, matches);assert.equal(f.progress.failureProbe.fileData.candidateHead, detail.candidateHead);
  assert.equal(f.progress.lastProbe.fileData.reason, 'FILE_HEAD_MISMATCH');assert.equal(f.progress.selection.target.head, F.head);assert.equal(f.progress.nativeRestored, false);assert.equal(f.clicks(), 2);assert.equal(f.binds(), 1);assert.deepEqual(f.storage(), f.original);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
test('unknown-path candidate and extra diagnostic fields are not retained by the actual orchestrator', async () => {
  const detail = { reason: 'FILE_PATH_UNEXPECTED', pathSlot: null, knownPath: false, refPresent: true, headValid: true, headMatchesTarget: false, anchorValid: true, candidateHead: T, unknownPath: 'DO_NOT_RETAIN_PATH' };
  const f = await protocol({ fileDataAfterToggle: detail });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.failureProbe.fileData.candidateHead, undefined);assert.equal(f.progress.failureProbe.fileData.candidateMatchesEndpointTarget, null);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
for (const detail of [{ reason: 'DO_NOT_RETAIN_REASON' }, { reason: 'FILE_HEAD_MISMATCH', pathSlot: 99, knownPath: true, refPresent: true, headValid: true, headMatchesTarget: false, anchorValid: true, candidateHead: T }]) test('unknown or malformed file diagnostic cannot expand the fixed-code report', async () => {
  const f = await protocol({ fileDataAfterToggle: detail });await assert.rejects(f.run(), AggregateError);assert.deepEqual(f.progress.failureProbe, { qualified: false, code: 'FILE_DATA_UNQUALIFIED' });assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});

test('pairing timeout retains the qualified original baseline and finite setup diagnostics before any toggle', async () => {
  const f = await protocol({ noAcquisition: true, snapshotExtras: true });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.failurePhase, 'INDEPENDENT_ACQUISITION');assert.equal(f.progress.primaryFailure, 'OBSERVATION_DEADLINE');
  assert.deepEqual(f.progress.selection, { source: { id: F.version, head: F.head }, target: { id: '2159233785', head: T, mergeHead: true } });
  assert.equal(f.progress.baseline.bound, true);assert.equal(f.progress.baseline.checked, false);assert.equal(f.progress.lastProbe.bound, true);assert.equal(f.progress.lastCurrentCheck, 'QUALIFIED');
  assert.deepEqual(f.progress.acquisitionMatch, { attempts: 4, source: false, target: false, pairedVersions: false, immutableSourceTarget: false, metadata: false, matched: false, proofMode: 'unverified', proofResponseId: null, endpointTarget: null });
  assert.equal(f.progress.toggleAttempted, false);assert.equal(f.clicks(), 1);assert.equal(f.binds(), 1);assert.deepEqual(f.observer.evidence.nonreads, []);assert.deepEqual(f.storage(), f.original);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
for (const [option, source, target, metadata] of [['acquisitionSourceMismatch', false, true, true], ['acquisitionTargetMismatch', true, false, true], ['splitVersions', true, true, true], ['incompleteInventory', true, true, false]]) test(`${option} reports independent pairing facts without accepting a mismatched or split response`, async () => {
  const f = await protocol({ [option]: true });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.acquisitionMatch.source, source);assert.equal(f.progress.acquisitionMatch.target, target);assert.equal(f.progress.acquisitionMatch.metadata, metadata);
  assert.equal(f.progress.acquisitionMatch.pairedVersions, option === 'incompleteInventory');assert.equal(f.progress.acquisitionMatch.matched, false);
  assert.equal(f.progress.failurePhase, 'INDEPENDENT_ACQUISITION');assert.equal(f.progress.baseline.app.targetVersions[0].head_sha, T);assert.equal(f.progress.toggleAttempted, false);assert.equal(f.clicks(), 1);assert.deepEqual(f.storage(), f.original);
});
for (const [option, expected] of [['pairingTargetDrift', 'SELECTED_TARGET_CHANGED'], ['pairingUnknown', 'MENU_SCHEMA_UNQUALIFIED']]) test(`${option} retains the old baseline and last fixed current failure when polling swallows errors`, async () => {
  const f = await protocol({ [option]: true, swallowPollErrors: true });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.failurePhase, 'INDEPENDENT_ACQUISITION');assert.equal(f.progress.primaryFailure, 'OBSERVATION_DEADLINE');assert.equal(f.progress.lastCurrentCheck, expected);assert.equal(f.progress.failureCurrentCheck, expected);assert.deepEqual(f.progress.failureProbe, f.progress.lastProbe);
  assert.equal(f.progress.selection.target.head, T);assert.equal(f.progress.acquisitionMatch.attempts, 1);assert.equal(f.progress.toggleAttempted, false);assert.equal(f.clicks(), 1);assert.deepEqual(f.storage(), f.original);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
for (const [option, phase] of [['checkpointFailure', 'BEFORE_INTENT_CHECKPOINT'], ['acquisitionFailure', 'INDEPENDENT_ACQUISITION']]) test(`${option} keeps the qualified bound baseline without raw operation errors or unknown fields`, async () => {
  const f = await protocol({ [option]: true, snapshotExtras: true, swallowPollErrors: true });await assert.rejects(f.run(), AggregateError);
  if (option === 'acquisitionFailure') assert.equal(f.progress.lastAcquisitionCheck, 'ACQUISITION_READ_FAILED');
  assert.equal(f.progress.failurePhase, phase);assert.equal(f.progress.baseline.bound, true);assert.equal(f.progress.toggleAttempted, false);assert.equal(f.clicks(), 1);assert.deepEqual(f.storage(), f.original);assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});

test('immediate same-owner close after each trusted checkbox change is observed, reopened once and restored without rebinding', async () => {
  const f = await protocol({ closeImmediatelyAfterChange: true });assert.equal((await f.run()).status, 'discovery');
  assert.equal(f.progress.stages[0].snapshot.open, false);assert.equal(f.progress.afterToggle.open, false);assert.equal(f.progress.restoration.snapshot.open, false);
  assert.equal(f.progress.restorationReopen.status, 'opened_original_menu');assert.equal(f.progress.restoredStable.checked, false);assert.equal(f.progress.nativeRestored, true);
  assert.equal(f.clicks(), 4);assert.equal(f.binds(), 1);assert.deepEqual(f.storage(), f.original);
});
for (const option of ['loseBindingAfterChange', 'headAfterToggle']) test(`immediate menu close cannot bypass ${option} after a trusted change`, async () => {
  const f = await protocol({ closeImmediatelyAfterChange: true, [option]: true });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.clicks(), 2);assert.equal(f.binds(), 1);assert.equal(f.progress.nativeRestored, false);assert.equal(f.progress.restorationReopen, undefined);assert.deepEqual(f.storage(), f.original);
});
test('same original closed menu is reopened once for restoration without rebinding or replacing the baseline', async () => {
  const f = await protocol({ closedAfterToggle: true });assert.equal((await f.run()).status, 'discovery');
  assert.equal(f.progress.afterToggle.open, false);assert.equal(f.progress.baseline.checked, false);assert.equal(f.progress.baseline.open, true);
  assert.equal(f.progress.nativeRestored, true);assert.equal(f.progress.restoredStable.checked, false);assert.equal(f.clicks(), 4);assert.equal(f.binds(), 1);
  assert.equal(f.progress.restorationReopen.attempts, 1);assert.equal(f.progress.restorationReopen.before.open, false);assert.equal(f.progress.restorationReopen.after.open, true);
  assert.deepEqual(f.storage(), f.original);
});
for (const drift of ['owner', 'opener', 'actor']) test(`closed restoration refuses ${drift} drift before any reopening`, async () => {
  const f = await protocol({ closedAfterToggle: true, driftBeforeReopen: drift });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.afterToggle.open, false);assert.equal(f.clicks(), 2);assert.equal(f.binds(), 1);assert.equal(f.progress.restorationReopen, undefined);assert.equal(f.progress.nativeRestored, false);assert.deepEqual(f.storage(), f.original);
});
for (const drift of ['owner', 'opener', 'actor']) test(`one reopen attempt stops immediately on ${drift} drift without a checkbox action or retry`, async () => {
  const f = await protocol({ closedAfterToggle: true, driftDuringReopen: drift });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.clicks(), 3);assert.equal(f.binds(), 1);assert.equal(f.progress.restorationReopen.attempts, 1);assert.equal(f.progress.restorationReopen.status, 'failed');assert.equal(f.progress.nativeRestored, false);assert.deepEqual(f.storage(), f.original);
});
test('a same-owner menu that does not reopen receives no second opener click and retains cleanup failure', async () => {
  const f = await protocol({ closedAfterToggle: true, reopenStaysClosed: true, observerFailure: true });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.clicks(), 3);assert.equal(f.binds(), 1);assert.equal(f.progress.restorationReopen.status, 'failed');assert.equal(f.progress.restorationReopen.failure, 'OBSERVATION_DEADLINE');
  assert.ok(f.progress.cleanup.codes.includes('OBSERVER_CLEANUP_FAILED'));assert.deepEqual(f.storage(), f.original);
});
test('qualified but still mounting source waits for the same pinned inventory before the first native action', async () => {
  const f = await protocol({ mountPending: true });assert.equal((await f.run()).status, 'discovery');assert.ok(f.readinessReads() >= 2);assert.equal(f.clicks(), 3);assert.equal(f.progress.nativeRestored, true);assert.deepEqual(f.storage(), f.original);
});
for (const option of ['mountScopeChanged', 'mountUnknownControl']) test(`mount readiness never retries ${option} or adopts another initial source`, async () => {
  const f = await protocol({ mountPending: true, [option]: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.readinessReads(), 2);assert.equal(f.clicks(), 0);assert.equal(f.progress.baseline, undefined);assert.deepEqual(f.storage(), f.original);
});
test('native revert is characterized without forcing checked state or inventing a successful reload', async () => {
  const f = await protocol({ revert: true });assert.equal((await f.run()).status, 'unavailable');assert.equal(f.clicks(), 2);assert.equal(f.progress.stages[0].status, 'native_reverted');assert.equal(f.progress.propertyVectorRestored, true);assert.equal(f.progress.nativeRestored, false);assert.equal(f.progress.effectiveModeRestored, 'unverified');assert.deepEqual(f.storage(), f.original);
});
test('completed desired-mode GET plus checkbox revert cannot fabricate effective-source restoration or force another toggle', async () => {
  const f = await protocol({ revertBeforeRestore: true });await assert.rejects(f.run(), AggregateError);
  assert.equal(f.progress.stages[0].snapshot.checked, true);assert.equal(f.progress.afterToggle.checked, true);
  assert.equal(f.observer.evidence.modes.some((value) => value.phase === 'toggle' && value.eligible && value.finished && value.status === 200), true);
  assert.equal(f.progress.restoration.status, 'property_already_matches');assert.equal(f.progress.propertyVectorRestored, true);assert.equal(f.progress.effectiveModeRestored, 'unverified');assert.equal(f.progress.nativeRestored, false);
  assert.ok(f.progress.cleanup.codes.includes('EFFECTIVE_MODE_RESTORE_UNVERIFIED'));assert.equal(f.clicks(), 2);assert.deepEqual(f.storage(), f.original);
});
for (const option of ['unknown', 'untrusted', 'untrustedOpener', 'noAcquisition', 'incompleteInventory', 'authAfterToggle', 'headAfterToggle', 'unknownAfterToggle']) test(`${option} refuses capability and still restores raw settings after page close`, async () => {
  const f = await protocol({ [option]: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.page.isClosed(), true);assert.deepEqual(f.storage(), f.original);
  if (option === 'unknown') { assert.equal(f.clicks(), 0);assert.equal(f.progress.baseline, undefined);assert.equal(f.order.includes('release'), false); }
  if (option === 'noAcquisition') assert.equal(f.clicks(), 1);
  if (option === 'incompleteInventory') assert.equal(f.clicks(), 1);
  if (option === 'authAfterToggle' || option === 'headAfterToggle') assert.equal(f.clicks(), 2);
  assert.doesNotMatch(JSON.stringify(f.progress), /DO_NOT_RETAIN/);
});
for (const option of ['observerFailure', 'comparisonFailure', 'probeCleanupFailure']) test(`actual ${option} cannot bypass close-first raw restoration`, async () => {
  const f = await protocol({ [option]: true });await assert.rejects(f.run(), AggregateError);assert.deepEqual(f.storage(), f.original);assert.equal(f.progress.cleanup.rawRestoredAfterClose, true);assert.equal(f.page.isClosed(), true);
});
test('original and native restoration errors remain separate in the actual failure path', async () => {
  const f = await protocol({ authAfterToggle: true, observerFailure: true });await assert.rejects(f.run(), (value) => {
    assert.equal(value instanceof AggregateError, true);assert.ok(value.errors.length >= 2);return true;
  });assert.equal(f.progress.primaryFailure, 'ACTOR_UNQUALIFIED');assert.ok(f.progress.cleanup.codes.includes('OBSERVER_CLEANUP_FAILED'));assert.deepEqual(f.storage(), f.original);
});
test('natural restore refusal fails explicitly instead of claiming cleanup success', async () => {
  const f = await protocol({ rejectRestore: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.progress.nativeRestored, false);assert.ok(f.progress.cleanup.codes.includes('NATIVE_RESTORATION_REJECTED'));assert.deepEqual(f.storage(), f.original);
});
test('page-close failure never restores settings while a provider page is still live', async () => {
  const f = await protocol({ closeFailure: true });await assert.rejects(f.run(), AggregateError);assert.equal(f.writes(), 1);assert.equal(f.progress.cleanup.rawRestoredAfterClose, false);
});
test('navigation/observer setup failure cleanup restores even absent page and preserves missing raw settings key', async () => {
  let storage = { sync: { present: false }, local: { present: true, value: { untouched: 7 } } };const original = structuredClone(storage);const progress = {};
  const settings = gitLabWhitespaceSettings({ read: async () => storage, write: async (value) => { storage = value; }, progress });await settings.prepare();
  const result = await cleanupGitLabWhitespace(undefined, { settings, observer: { evidence: {}, dispose: () => { throw Error('DO_NOT_RETAIN'); } }, progress: {} });
  assert.deepEqual(storage, original);assert.deepEqual(result.codes, ['OBSERVER_CLEANUP_FAILED']);assert.equal(result.rawRestoredAfterClose, true);
});
test('nonread receipts omit queries, body, headers and raw failures while retaining outside-window unattributed requests', () => {
  const page = new EventEmitter();const evidence = {};const observer = observeGitLabWhitespace(page, evidence);
  const request = { method: () => 'POST', url: () => 'https://gitlab.com/api/graphql?account=DO_NOT_RETAIN', postData: () => { throw Error('Must not read body'); }, headers: () => { throw Error('Must not read headers'); } };
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 401 });
  assert.equal(evidence.nonreads[0].resource, 'https://gitlab.com/api/graphql');assert.equal(evidence.nonreads[0].phase, 'navigation');assert.equal(evidence.nonreads[0].provenance, 'unattributed_browser_request');assert.equal(evidence.nonreads[0].status, 401);
  assert.doesNotMatch(JSON.stringify(evidence), /DO_NOT_RETAIN/);observer.dispose();assert.equal(page.listenerCount('request'), 0);
  assert.equal(whitespaceReceiptURL('javascript:DO_NOT_RETAIN'), 'NON_HTTP_RESOURCE');
});
for (const kind of ['native', 'unknown', 'mixed']) test(`${kind} GET provenance and body completion are observed rather than inferred from absent extension frames`, () => {
  const page = new EventEmitter();const evidence = {};const observer = observeGitLabWhitespace(page, evidence);observer.phase('toggle');
  const request = { method: () => 'GET', url: () => 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diff_file?ignore_whitespace_changes=true&unknown=DO_NOT_RETAIN',
    initiator: () => kind === 'unknown' ? {} : { stack: { callFrames: [{ url: 'https://gitlab.com/assets/known.js?secret=DO_NOT_RETAIN' }, ...(kind === 'mixed' ? [{ url: 'chrome-extension://abcdefghijklmnop/file.js' }] : [])] } } };
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 200 });assert.equal(evidence.modes[0].finished, undefined);
  page.emit('requestfinished', request);assert.equal(evidence.modes[0].finished, true);assert.equal(evidence.modes[0].nativeFrame, kind !== 'unknown');assert.equal(evidence.modes[0].extensionFrame, kind === 'mixed');assert.doesNotMatch(JSON.stringify(evidence), /DO_NOT_RETAIN/);
  observer.dispose();for (const name of ['request', 'response', 'requestfailed', 'requestfinished']) assert.equal(page.listenerCount(name), 0);
});
for (const [label, path, query, eligible] of [
  ['exact native stream and round', 'diffs_stream', `diff_id=${F.version}&view=inline&w=0`, true],
  ['wrong round', 'diffs_stream', 'diff_id=2150000000&view=inline&w=0', false],
  ['missing round', 'diffs_stream', 'view=inline&w=0', false],
  ['other MR endpoint', 'widget.json', `diff_id=${F.version}&view=inline&w=0`, false],
  ['unqualified full ref override', 'diffs_stream', `diff_id=${F.version}&view=inline&w=0&start_sha=${T}`, false],
  ['missing native view', 'diffs_stream', `diff_id=${F.version}&w=0`, false],
  ['ambiguous mode', 'diffs_stream', `diff_id=${F.version}&view=inline&w=0&w=1`, false],
]) test(`${label} is retained with truthful request selection eligibility`, () => {
  const page = new EventEmitter();const evidence = {};const observer = observeGitLabWhitespace(page, evidence);observer.bind(state().nativeStream);observer.phase('toggle');
  const request = { method: () => 'GET', url: () => `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/${path}?${query}`, initiator: () => ({ stack: { callFrames: [{ url: 'https://gitlab.com/assets/native.js' }] } }) };
  page.emit('request', request);page.emit('response', { request: () => request, status: () => 200 });page.emit('requestfinished', request);
  assert.equal(evidence.modes.length, 1);assert.equal(evidence.modes[0].eligible, eligible);assert.equal(evidence.modes[0].diffId, label === 'missing round' ? null : label === 'wrong round' ? '2150000000' : F.version);
  assert.equal(evidence.modes[0].requestSourceHead, label === 'unqualified full ref override' ? 'not_qualified' : 'absent');
  assert.equal(evidence.modes[0].requestTargetHead, label === 'unqualified full ref override' ? 'not_qualified' : 'absent');observer.dispose();
});

async function withDOM(run) {
  const w = new Window({ url: F.url, settings: { enableJavaScriptEvaluation: false, enableCSSFileLoading: false, enableImageFileLoading: false } });
  const names = ['document', 'location', 'getComputedStyle'];const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  try {
    Object.assign(globalThis, { document: w.document, location: w.location, getComputedStyle: w.getComputedStyle.bind(w) });w.HTMLElement.prototype.getBoundingClientRect = () => new w.DOMRect(1, 1, 100, 20);
    w.document.body.dataset.projectId = '278964';w.document.body.dataset.projectFullPath = 'gitlab-org/gitlab';
    document.body.innerHTML = '<a data-testid="topbar-signin-button" href="/users/sign_in">Sign in</a><article data-rapid-diffs><header class="rd-app-header" aria-label="View controls"><div class="gl-new-dropdown" aria-label="Preferences"><button type="button" class="js-show-diff-settings" data-testid="base-dropdown-toggle" role="combobox" aria-expanded="true">Preferences</button><div data-testid="base-dropdown-menu"><input type="checkbox" value="true" id="ws" data-testid="show-whitespace"><label for="ws">Show whitespace changes</label><input type="checkbox" value="true" id="fb" data-testid="file-by-file"><label for="fb">Show one file at a time</label></div></div></header></article>';
    const app = document.querySelector('article');const base = state();app.setAttribute('data-app-data', JSON.stringify({ mr_path: base.app.path, iid: 266334, file_by_file_mode: false, diff_view_type: 'inline', reload_stream_url: '/gitlab-org/gitlab/-/merge_requests/266334/diffs_stream?diff_id=2158520123', show_whitespace: false, update_user_endpoint: '/api/v4/user/preferences', versions: { source_versions: base.app.sourceVersions, target_versions: base.app.targetVersions } }));
    for (const [i, path] of F.paths.entries()) { const file = document.createElement('diff-file');file.id = String(i).repeat(40);file.setAttribute('data-file-data', JSON.stringify({ new_path: path, diff_refs: { head_sha: T } }));file.innerHTML = '<input type="checkbox" data-viewed-checkbox disabled><table><tr class="rd-hunk-lines-inline"><td class="rd-line-text">Source canary remains hashed</td></tr></table><diff-file-mounted></diff-file-mounted>';app.append(file); }
    await run({ w, app, menu: document.querySelector('[data-testid="base-dropdown-menu"]'), checkbox: document.querySelector('#ws') });
  } finally { await probe('cleanup');for (const [name, value] of before) { if (value) Object.defineProperty(globalThis, name, value);else delete globalThis[name]; }await w.happyDOM.abort(); }
}

for (const [name, mutate, reason, candidate] of [
  ['missing ref', (file, data) => { delete data.diff_refs; }, 'FILE_REF_MISSING', undefined],
  ['invalid head', (file, data) => { data.diff_refs.head_sha = 'DO_NOT_RETAIN_HEAD'; }, 'FILE_HEAD_INVALID', undefined],
  ['wrong valid head', (file, data) => { data.diff_refs.head_sha = 'a'.repeat(40); }, 'FILE_HEAD_MISMATCH', 'a'.repeat(40)],
  ['unknown path', (file, data) => { data.new_path = 'DO_NOT_RETAIN_PATH';data.diff_refs.head_sha = 'a'.repeat(40); }, 'FILE_PATH_UNEXPECTED', undefined],
  ['invalid anchor', (file) => { file.id = 'DO_NOT_RETAIN_ANCHOR'; }, 'FILE_ANCHOR_INVALID', T],
]) test(`native file diagnostic distinguishes ${name} without code, unknown path or raw data`, async () => withDOM(async () => {
  const file = document.querySelector('diff-file');const data = JSON.parse(file.getAttribute('data-file-data'));data.secret = 'DO_NOT_RETAIN_JSON';mutate(file, data);file.setAttribute('data-file-data', JSON.stringify(data));
  const before = document.body.innerHTML;const value = await probe('read', F);assert.equal(value.qualified, false);assert.equal(value.code, 'FILE_DATA_UNQUALIFIED');assert.equal(value.fileData.reason, reason);assert.equal(value.fileData.candidateHead, candidate);
  assert.equal(value.fileData.pathSlot, name === 'unknown path' ? null : 0);assert.equal(value.fileData.knownPath, name !== 'unknown path');assert.equal(value.fileData.refPresent, name !== 'missing ref');assert.equal(value.fileData.headValid, !['missing ref', 'invalid head'].includes(name));assert.equal(value.fileData.headMatchesTarget, name === 'invalid anchor');assert.equal(value.fileData.anchorValid, name !== 'invalid anchor');
  assert.doesNotMatch(JSON.stringify(value), /DO_NOT_RETAIN|Source canary/);assert.equal(document.body.innerHTML, before);
}));
test('unreadable file JSON is diagnosed without returning the raw attribute', async () => withDOM(async () => {
  document.querySelector('diff-file').setAttribute('data-file-data', '{DO_NOT_RETAIN_JSON');const value = await probe('read', F);assert.equal(value.fileData.reason, 'FILE_JSON_UNREADABLE');assert.equal(value.fileData.pathSlot, null);assert.equal(value.fileData.candidateHead, undefined);assert.doesNotMatch(JSON.stringify(value), /DO_NOT_RETAIN/);
}));
test('actor and project guards refuse before reading or retaining malformed file evidence', async () => withDOM(async () => {
  document.querySelector('diff-file').setAttribute('data-file-data', '{DO_NOT_RETAIN_JSON');document.body.dataset.projectId = 'other';assert.deepEqual(await probe('read', F), { qualified: false, code: 'PROJECT_SCOPE_UNQUALIFIED' });document.body.dataset.projectId = '278964';
  document.body.insertAdjacentHTML('afterbegin', `<div id="js-vue-mr-discussions" data-current-user-data='{"id":7}'></div>`);assert.deepEqual(await probe('read', F), { qualified: false, code: 'ACTOR_UNQUALIFIED' });
}));

test('actual DOM probe reads current checked property rather than absent HTML attribute and never exposes code text', async () => withDOM(async ({ checkbox }) => {
  checkbox.checked = true;assert.equal(checkbox.hasAttribute('checked'), false);const value = await probe('read', F);assert.equal(value.qualified, true);assert.equal(value.checked, true);assert.equal(value.initialShowWhitespace, false);assert.doesNotMatch(JSON.stringify(value), /Source canary/);
}));
for (const shape of ['input', 'select', 'textarea', 'form', 'editable']) test(`unknown ${shape} schema yields only fixed diagnostics with no field values`, async () => withDOM(async ({ menu }) => {
  const node = document.createElement(shape === 'editable' ? 'div' : shape);node.setAttribute('name', 'DO_NOT_RETAIN_AUTH');node.setAttribute('value', 'DO_NOT_RETAIN_VALUE');if (shape === 'editable') node.contentEditable = 'true';menu.append(node);
  assert.deepEqual(await probe('read', F), { qualified: false, code: 'MENU_SCHEMA_UNQUALIFIED' });
}));
test('bound original native field replacement is rejected rather than adopted', async () => withDOM(async ({ checkbox }) => {
  assert.equal((await probe('bind', F)).bound, true);checkbox.replaceWith(checkbox.cloneNode(true));assert.deepEqual(await probe('read', F), { qualified: false, code: 'ORIGINAL_OWNER_CHANGED' });
}));
test('closed same-owner probe exposes only its original opener and retains the original binding', async () => withDOM(async ({ menu, checkbox }) => {
  const opener = document.querySelector('button');assert.equal((await probe('bind', F)).bound, true);opener.setAttribute('aria-expanded', 'false');menu.hidden = true;
  const closed = await probe('read', F);assert.equal(closed.qualified, true);assert.equal(closed.bound, true);assert.equal(closed.open, false);
  assert.equal(await probe('opener', F), opener);assert.equal(await probe('toggle-target', F), null);assert.equal(checkbox.checked, false);
  assert.deepEqual(await probe('bind', F), { qualified: false, code: 'BIND_UNQUALIFIED' });
}));
for (const drift of ['owner', 'opener', 'actor']) test(`actual closed-menu probe declines a changed ${drift} instead of exposing a replacement opener`, async () => withDOM(async ({ menu }) => {
  assert.equal((await probe('bind', F)).bound, true);const opener = document.querySelector('button');opener.setAttribute('aria-expanded', 'false');menu.hidden = true;
  if (drift === 'owner') { const owner = document.querySelector('.gl-new-dropdown');owner.replaceWith(owner.cloneNode(true)); }
  if (drift === 'opener') opener.replaceWith(opener.cloneNode(true));
  if (drift === 'actor') document.body.insertAdjacentHTML('afterbegin', '<div id="js-vue-mr-discussions" data-current-user-data=\'{"id":7}\'></div>');
  const value = await probe('opener', F);assert.deepEqual(value, { qualified: false, code: drift === 'actor' ? 'ACTOR_UNQUALIFIED' : 'ORIGINAL_OWNER_CHANGED' });
}));
test('numeric native actor refuses before menu values or arbitrary authored content is returned', async () => withDOM(async () => {
  document.body.insertAdjacentHTML('afterbegin', '<div id="js-vue-mr-discussions" data-current-user-data=\'{"id":7,"secret":"DO_NOT_RETAIN"}\'></div>');
  assert.deepEqual(await probe('read', F), { qualified: false, code: 'ACTOR_UNQUALIFIED' });
}));
test('actual probe commands return the original associated label and mark synthetic events untrusted', async () => withDOM(async ({ w, menu, checkbox }) => {
  const opener = document.querySelector('button');opener.setAttribute('aria-expanded', 'false');menu.hidden = true;
  assert.equal((await probe('arm-opener', F)).armed, true);assert.equal(await probe('opener', F), opener);opener.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  opener.setAttribute('aria-expanded', 'true');menu.hidden = false;
  const bound = await probe('bind', F);assert.equal(bound.bound, true);assert.deepEqual(bound.events, [{ kind: 'opener', type: 'click', trusted: false }]);
  assert.equal(await probe('toggle-target', F), document.querySelector('label[for="ws"]'));assert.equal(checkbox.checked, false);
  assert.deepEqual(await probe('invented-command', F), { qualified: false, code: 'UNKNOWN_PROBE_ACTION' });
}));
test('an unrelated native auth dialog yields only a fixed diagnostic before any menu values', async () => withDOM(async () => {
  document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><input type="password" value="DO_NOT_RETAIN_AUTH"></div>');assert.deepEqual(await probe('read', F), { qualified: false, code: 'UNRELATED_DIALOG_UNQUALIFIED' });
}));
test('a duplicated field ID cannot redirect the trusted native label click to another input', async () => withDOM(async () => {
  document.body.insertAdjacentHTML('afterbegin', '<input id="ws" type="password" value="DO_NOT_RETAIN_AUTH">');assert.deepEqual(await probe('read', F), { qualified: false, code: 'MENU_LABEL_UNQUALIFIED' });
}));
