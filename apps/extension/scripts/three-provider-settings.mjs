import assert from 'node:assert/strict';

// Independent untouched native totals captured in installed run41348268807; never derived from tabState.all.
export const SHARED_SETTINGS_NATIVE_ORACLES = {
  gitlab: { all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 }, hidden: 1, evidenceRun: '41348268807' },
  github: { all: { files: 18, additions: 93, deletions: 53 }, visible: { files: 12, additions: 42, deletions: 26 }, hidden: 6, evidenceRun: '41348268807' },
};
const equal = (actual, expected) => actual != null && ['files', 'additions', 'deletions'].every((key) => actual[key] === expected[key]);
const withoutPatterns = ({ categoryPatterns: _patterns, ...settings }) => settings;

export function assertPatternOnlySettings(current, original) {
  assert.deepEqual(withoutPatterns(current), withoutPatterns(original), 'Three-site settings verification changed a setting other than categoryPatterns');
  assert.equal(current.enabled, true);
  assert.equal(current.aiEnabled, false);
  assert.deepEqual(current.autoViewed, {});
}

/** Restore exactly one field, retaining every other latest setting and the original presence/absence. */
export function restoreCategoryPatterns(current, original) {
  const next = { ...current };
  if (Object.hasOwn(original, 'categoryPatterns')) next.categoryPatterns = original.categoryPatterns;
  else delete next.categoryPatterns;
  return next;
}

export function settingsRequestEvidence(request, extensionId) {
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (url.username !== '' || url.password !== '' || url.hash !== '') return null;
  const native = url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/');
  if (!native && !(url.origin === 'https://api.bitbucket.org' && url.pathname.startsWith('/2.0/'))) return null;
  const frames = [];
  let stack = request.initiator?.stack;
  for (let depth = 0; stack != null && depth < 20; depth += 1) {
    frames.push(...(stack.callFrames ?? []).map((frame) => frame.url));
    stack = stack.parent;
  }
  const extensionInitiator = frames.some((frame) => typeof frame === 'string' && frame.startsWith(`chrome-extension://${extensionId}/`));
  // These are observed client signatures, not authority to label an unattributed/native request extension-caused.
  const fields = url.searchParams.get('fields');
  const signature = /\/commit\/[a-f0-9]{7,64}$/i.test(url.pathname) && ['hash', 'hash,repository.full_name'].includes(fields) ? 'client-identity-projection'
    : /\/(?:diff|diffstat)\//.test(url.pathname) && url.searchParams.has('from_pullrequest_id') ? 'review-comparison'
    : /\/src\//.test(url.pathname) ? 'repository-source' : null;
  return { url: url.href, method: request.method, transport: native ? 'native-same-origin' : 'logical-api', extensionInitiator, signature,
    attribution: extensionInitiator ? 'extension-frame-observed' : 'native-or-unattributed' };
}

export function sharedSettingsSourceIdentity(dom) {
  const url = new URL(dom.url); url.hash = '';
  return { provider: dom.provider, url: url.href, headerIdentity: dom.headerIdentity,
    files: dom.files.map((file) => ({ path: file.path, id: file.id, anchor: file.anchor ?? null, head: file.head ?? null, ownerTag: file.ownerTag ?? null, ownerPath: file.ownerPath ?? null })).sort((a, b) => a.path.localeCompare(b.path)),
    nativeLinks: dom.nativeLinks ?? null, nativeCheckboxes: dom.nativeCheckboxes ?? null };
}

export function sharedSettingsSampleValid(provider, sample, oracle, mode) {
  const { state, dom } = sample;
  const allHidden = mode === 'all';
  const visible = allHidden ? { files: 0, additions: 0, deletions: 0 } : oracle.visible;
  const hidden = allHidden ? oracle.all.files : oracle.hidden;
  if (provider !== 'github' && (state.repository?.provider !== provider || state.repository?.path !== oracle.repo || state.repository?.origin !== (provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org'))) return false;
  if (dom.provider !== provider || dom.hidden || state.onDiffPage !== true || state.allowed !== true || state.hasDiff !== true || state.repo !== oracle.repo
    || !equal(state.all, oracle.all) || !equal(state.visible, visible) || state.hiddenCount !== hidden
    || dom.files.length !== oracle.all.files || new Set(dom.files.map((file) => file.path)).size !== oracle.all.files
    || dom.files.some((file) => typeof file.id !== 'string' || file.id === '' || typeof file.path !== 'string' || file.path === '')) return false;
  if (provider === 'bitbucket') {
    if (sample.source?.status !== 'ready' || sample.source.sha !== oracle.sha || !equal(sample.source.totals, oracle.all)
      || dom.headers.length !== 2 || !dom.headers.every((header) => header.files === visible.files)
      || !dom.files.every((file) => file.display !== 'none' && file.hidden === (allHidden ? 'open' : null))) return false;
  } else if (dom.headers.length === 0 || !dom.headers.every((header) => equal(header, visible))) return false;
  if (allHidden && (state.expanded !== true || !state.categories.some((category) => category.id === 'tests' && category.count === oracle.all.files)
    || !dom.files.every((file) => file.hidden === (provider === 'github' ? 'hidden' : 'open'))
    || dom.groups.length !== 1 || !dom.groups.every((group) => group.expanded && group.toggleExpanded === 'true' && /^Hide\b/.test(group.toggleLabel ?? '') && (provider !== 'github' || group.sectionExpanded === 'true')))) return false;
  return true;
}
