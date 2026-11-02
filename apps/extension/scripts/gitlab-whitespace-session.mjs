import { isDeepStrictEqual } from 'node:util';
import { GITLAB_WHITESPACE, acquisitionMatches, cleanupGitLabWhitespace, retainedBaseline } from './gitlab-whitespace-viewed.mjs';
import { gitLabWhitespaceProbe } from './gitlab-whitespace-probe.mjs';

export const GITLAB_WHITESPACE_SESSION = Object.freeze({ ...GITLAB_WHITESPACE, url: `${GITLAB_WHITESPACE.url}&w=1` });
const check = (value, code) => { if (!value) throw Object.assign(new Error(`GitLab whitespace session: ${code}`), { code }); };
const fixed = (failure) => typeof failure?.code === 'string' && /^[A-Z_]{1,64}$/.test(failure.code) ? failure.code : 'OPERATION_FAILED';

export function gitLabWhitespaceSessionPresentation(paths) {
  const count = (node, files = false) => {
    if (node === null) return { present: false, recognized: !files, format: files ? 'absent' : 'absent_zero', value: files ? null : 0 };
    const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
    const invalid = { present: true, recognized: false, format: 'unrecognized', value: null };
    if (text.length > 64) return invalid;
    const digits = '(0|[1-9]\\d*|[1-9]\\d{0,2}(?:,\\d{3})+)';
    const match = new RegExp(files ? `^${digits}(?: (file|files))?$` : `^([+−-])? ?${digits}$`).exec(text);
    if (match === null) return invalid;
    const value = Number(match[files ? 1 : 2].replaceAll(',', ''));
    if (!Number.isSafeInteger(value) || value > 1_000_000_000 || files && (match[2] === 'file' && value !== 1 || match[2] === 'files' && value === 1)) return invalid;
    return { present: true, recognized: true, format: files ? match[2] ? 'file_label' : 'bare' : match[1] === '−' ? 'signed_unicode' : match[1] ? 'signed_ascii' : 'unsigned', value };
  };
  const roots = [...document.querySelectorAll('.diff-stats.inline-parallel-buttons .diff-stats-contents')];
  const headers = roots.slice(0, 4).map((root) => {
    const parsed = { files: count(root.querySelector(':scope > .diff-stats-group > span'), true), additions: count(root.querySelector('[data-testid="js-file-addition-line"]')), deletions: count(root.querySelector('[data-testid="js-file-deletion-line"]')) };
    return { files: parsed.files.value, additions: parsed.additions.value, deletions: parsed.deletions.value, parsed };
  });
  const nativeFiles = [...document.querySelectorAll('diff-file[data-file-data]')];
  const layout = (node) => {
    if (node === null) return null;
    const known = (value, choices) => choices.includes(value) ? value : 'other';
    const style = getComputedStyle(node);
    return {
      kind: node.matches('[data-diffs-list]') ? 'diff_list' : node.matches('[data-stream-remaining-diffs]') ? 'stream_holder' : node.tagName === 'STREAMING-ELEMENT' ? 'stream' : known(node.localName, ['diff-file', 'div', 'article', 'section', 'main', 'body', 'html']),
      display: known(style.display, ['none', 'contents', 'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'table-row', 'table-cell']),
      position: known(style.position, ['', 'static', 'relative', 'absolute', 'fixed', 'sticky']),
      inlinePosition: known(node.style.position, ['', 'static', 'relative', 'absolute', 'fixed', 'sticky']),
      transformed: node.style.transform !== '' && node.style.transform !== 'none',
      grouped: node.classList.contains('geld-provider-diffs'),
      flowWrapper: node.hasAttribute('data-geld-provider-flow-wrapper'),
    };
  };
  const files = nativeFiles.slice(0, paths.length + 1).map((root) => {
    let data;try { const raw = root.getAttribute('data-file-data');if (raw !== null && raw.length <= 16384) data = JSON.parse(raw); } catch { /* Only a known slot is returned. */ }
    const slot = paths.indexOf(data?.new_path);
    const mode = root.getAttribute('data-geld-provider-hidden');
    const ancestors = [];for (let node = root.parentElement; node !== null && ancestors.length < 4; node = node.parentElement) ancestors.push(layout(node));
    return { slot: slot < 0 ? null : slot, hidden: getComputedStyle(root).display === 'none',
      hiddenMode: mode === null ? 'absent' : ['open', 'closed'].includes(mode) ? mode : 'other', inline: root.hasAttribute('data-geld-provider-inline'),
      mounted: root.lastElementChild?.tagName === 'DIFF-FILE-MOUNTED', groupedAncestor: root.closest('.geld-provider-diffs') !== null, layout: layout(root), ancestors };
  });
  return { headers, headerOverflow: roots.length > 4, files, fileCount: Math.min(nativeFiles.length, paths.length + 1), fileOverflow: nativeFiles.length > paths.length,
    exactKnownPaths: files.length === paths.length && files.every(({ slot }) => slot !== null) && new Set(files.map(({ slot }) => slot)).size === paths.length };
}

export async function verifyGitLabWhitespaceSessionProduct(page, { phase, progress, readState, poll }) {
  const observations = progress.productObservations ??= [];
  check(['baseline', 'toggle', 'restore'].includes(phase) && observations.length < 3, 'PRODUCT_OBSERVATION_SCOPE_UNQUALIFIED');
  const observation = { phase, entryPhase: { baseline: 'BASELINE_PRODUCT_TOTALS', toggle: 'TOGGLE_PRODUCT_TOTALS', restore: 'RESTORE_PRODUCT_TOTALS' }[phase], stage: 'TAB_TOTALS', tabReads: 0, nativeReads: 0 };observations.push(observation);
  const stage = (name) => { observation.stage = name;progress.phase = name; };
  const number = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
  const totals = (value) => ({ files: number(value?.files), additions: number(value?.additions), deletions: number(value?.deletions) });
  const equal = (value, expected) => ['files', 'additions', 'deletions'].every((name) => value[name] === expected[name]);
  const projected = (value) => {
    const category = Array.isArray(value?.categories) ? value.categories.find((entry) => entry?.id === 'tests') : undefined;
    const paths = Array.isArray(category?.paths) ? category.paths : [];
    return { hasDiff: typeof value?.hasDiff === 'boolean' ? value.hasDiff : null, all: totals(value?.all), visible: totals(value?.visible), hiddenCount: number(value?.hiddenCount),
      tests: { present: category !== undefined, count: number(category?.count), pathCount: Math.min(paths.length, 4), knownSlots: paths.slice(0, 4).map((path) => { const slot = GITLAB_WHITESPACE.paths.indexOf(path);return slot < 0 ? null : slot; }), exactKnownPath: paths.length === 1 && paths[0] === GITLAB_WHITESPACE.paths[2] } };
  };
  stage('TAB_TOTALS');
  const state = await poll(async () => {
    observation.tabReads = Math.min(observation.tabReads + 1, 65535);let value;
    try { value = await readState();observation.tabReadError = null; } catch { observation.tabReadError = 'TAB_STATE_READ_UNAVAILABLE';check(false, 'TAB_STATE_READ_UNAVAILABLE'); }
    observation.lastTab = projected(value);return observation.lastTab;
  }, (value) => value.hasDiff === true && equal(value.all, { files: 3, additions: 36, deletions: 0 }) && equal(value.visible, { files: 2, additions: 4, deletions: 0 }) && value.hiddenCount === 1, 'Installed whitespace session exact complete totals');
  stage('TEST_CATEGORY');check(state.tests.present && state.tests.count === 1 && state.tests.exactKnownPath, 'PRODUCT_TEST_CATEGORY_MISMATCH');
  stage('NATIVE_PRESENTATION');
  const native = await poll(async () => {
    observation.nativeReads = Math.min(observation.nativeReads + 1, 65535);
    try { observation.lastNative = await page.evaluate(gitLabWhitespaceSessionPresentation, GITLAB_WHITESPACE.paths);observation.nativeReadError = null; } catch { observation.nativeReadError = 'NATIVE_PRESENTATION_READ_UNAVAILABLE';check(false, 'NATIVE_PRESENTATION_READ_UNAVAILABLE'); }
    return observation.lastNative;
  }, (value) => !value.headerOverflow && value.headers.some((header) => header.files === 2 && header.additions === 4 && header.deletions === 0)
    && !value.fileOverflow && value.fileCount === 3 && value.exactKnownPaths && value.files.every((file) => file.hidden === (file.slot === 2)), 'Native whitespace session corrected counts and exact hidden file');
  observation.stage = 'VERIFIED';return { all: state.all, visible: state.visible, hiddenCount: state.hiddenCount, tests: state.tests, native };
}

export function gitLabWhitespaceSessionSettings({ read, write, progress }) {
  const key = JSON.stringify(['gitlab', 'https://gitlab.com', '/gitlab-org/gitlab/-/merge_requests/266334/diffs']);
  let original;let prepared;let baseline;let expected;let pending;let cleanup;
  const map = (saved) => saved.local.present ? saved.local.value : {};
  const valid = (saved) => saved && typeof saved.sync?.present === 'boolean' && typeof saved.local?.present === 'boolean'
    && (!saved.sync.present || saved.sync.value !== null && typeof saved.sync.value === 'object' && !Array.isArray(saved.sync.value))
    && (!saved.local.present || saved.local.value !== null && typeof saved.local.value === 'object' && !Array.isArray(saved.local.value)
      && Object.values(saved.local.value).every((at) => Number.isFinite(at)));
  const other = (saved) => Object.fromEntries(Object.entries(map(saved)).filter(([name]) => name !== key));
  return {
    async prepare() {
      original = await read();check(valid(original), 'SETTINGS_SCHEMA_UNQUALIFIED');
      prepared = { ...original, sync: { present: true, value: { ...(original.sync.present ? original.sync.value : {}), enabled: true, categories: { tests: true }, groupHidden: true,
        expandedByDefault: false, categoryPatterns: {}, customPatterns: [], hideCommentLines: false, testOutline: false, hideWhitespace: true, hideLargeDiffs: false, repoRules: [], hiddenAuthors: [],
        prOverview: false, quickReview: false, autoViewed: {}, aiEnabled: false, repoConfigs: 'never', autoUpdatePatterns: false } } };
      await write(prepared);check(isDeepStrictEqual(await read(), prepared), 'SETTINGS_PREPARE_MISMATCH');progress.prepared = true;
    },
    async bind() {
      baseline = await read();check(valid(baseline) && isDeepStrictEqual(baseline.sync, prepared.sync) && isDeepStrictEqual(other(baseline), other(original)) && map(baseline)[key] === undefined, 'INITIAL_URL_POLICY_UNQUALIFIED');
      expected = baseline.local;progress.initialUrlPolicy = 'explicit_w1_without_opt_out';
    },
    intent(show) { check(typeof show === 'boolean' && pending === undefined, 'SETTINGS_INTENT_OVERLAP');pending = { show, at: Date.now() }; },
    async current() {
      const value = await read();check(valid(value) && isDeepStrictEqual(value.sync, prepared.sync) && isDeepStrictEqual(other(value), other(original)), 'EXTENSION_SETTINGS_CHANGED');
      if (baseline === undefined) return;
      if (pending !== undefined) {
        const at = map(value)[key];
        if (pending.show ? Number.isFinite(at) && at >= pending.at - 2000 && at <= Date.now() + 2000 : at === undefined) {
          expected = value.local;progress.observedChoices ??= [];progress.observedChoices.push({ showWhitespace: pending.show, optOutPresent: at !== undefined, timestampQualified: at === undefined ? null : true });pending = undefined;
        } else check(isDeepStrictEqual(value.local, expected), 'UNEXPECTED_OPT_OUT_CHANGE');
      } else check(isDeepStrictEqual(value.local, expected), 'UNEXPECTED_OPT_OUT_CHANGE');
    },
    async choiceComplete() { await this.current();check(pending === undefined, 'NATIVE_INTENT_NOT_PERSISTED'); },
    restore(closed) {
      if (cleanup) return cleanup;
      cleanup = (async () => { if (original === undefined) return;check(closed, 'PAGE_MUST_CLOSE_BEFORE_SETTINGS_RESTORE');await write(original);check(isDeepStrictEqual(await read(), original), 'RAW_SETTINGS_RESTORE_MISMATCH');progress.restoration = 'exact_raw_presence_and_values_restored';progress.restoredAfterPageClose = true; })();return cleanup;
    },
  };
}

/** Independent installed-test observer. It never reads the product's session or source-frame state. */
export async function gitLabWhitespaceSessionProbe(action, fixture) {
  const key = '__geldNativeWhitespaceSessionProof';
  if (action === 'cleanup') { const prior = globalThis[key];prior?.stop?.();delete globalThis[key];return { released: true }; }
  if (action === 'frame') { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));action = 'read'; }
  const bad = (code) => ({ qualified: false, code, ...(code === 'SESSION_HISTORY_BOUND' ? { history: { observed: Math.min(globalThis[key]?.records ?? 0, 4097), limit: 4096, phase: globalThis[key]?.budgetPhase ?? 'baseline' } } : {}),
    ...(code === 'ANONYMOUS_WITNESS_MUTATED' && globalThis[key]?.witnessMutation ? { witnessMutation: globalThis[key].witnessMutation } : {}) });
  const excluded = '[data-geld-ui],.note,.md,[data-testid="noteable-note-container"],[data-testid="description-content"],form,[contenteditable],dialog,[role="dialog"]';
  const native = (node) => node?.isConnected === true && node.closest(excluded) === null;
  const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  const shown = (node) => {
    if (!native(node) || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let p = node; p; p = p.parentElement) { const s = getComputedStyle(p);if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0') return false; }
    const rect = node.getBoundingClientRect();return rect.width > 0 && rect.height > 0;
  };
  let p = globalThis[key];
  if (action === 'install') {
    if (p !== undefined) return bad('SESSION_ALREADY_INSTALLED');
    const prior = globalThis.__geldWhitespaceProof;
    if (prior?.bound !== true) return bad('STRICT_BASELINE_MISSING');
    const r = prior.references;const root = r.root;
    const one = (selector) => { const nodes = [...root.querySelectorAll(selector)].filter(native);return nodes.length === 1 ? nodes[0] : null; };
    const list = one('[data-diffs-list]'), overlay = one('[data-diffs-overlay]'), loading = one('[data-list-loading]'), alert = one('[data-diffs-list-alert]');
    const actors = [...document.querySelectorAll('#js-vue-mr-discussions[data-current-user-data]')].filter(native);
    if ([list, overlay, loading, alert].includes(null) || actors.length !== 1) return bad('SESSION_OWNER_UNQUALIFIED');
    const signIn = [...document.querySelectorAll('a[data-testid="topbar-signin-button"]')].find((node) => {
      try { const url = new URL(node.href);return shown(node) && url.origin === 'https://gitlab.com' && url.pathname === '/users/sign_in' && !url.username && !url.password; } catch { return false; }
    });
    if (signIn === undefined || [...document.querySelectorAll('.js-mr-title-actions[data-is-signed-in="true"]')].some(native)) return bad('ANONYMOUS_WITNESS_UNQUALIFIED');
    const actor = actors[0];const actorData = actor.getAttribute('data-current-user-data');
    let app;try { app = JSON.parse(root.getAttribute('data-app-data'));if (JSON.parse(actorData ?? 'null')?.id != null) return bad('ACTOR_UNQUALIFIED'); } catch { return bad('SESSION_OWNER_UNQUALIFIED'); }
    if (app.is_fork !== false && app.is_fork !== 'false' || app.project_path !== 'gitlab-org/gitlab') return bad('SESSION_PROJECT_UNQUALIFIED');
    if (root.getAttribute('data-app-data') !== prior.bootstrapAttribute) return bad('STRICT_BOOTSTRAP_CHANGED');
    const labels = [...r.menu.querySelectorAll('label[for]')].filter((node) => [r.field.id, r.other.id].includes(node.htmlFor));
    const signInAncestors = [];for (let node = signIn; node; node = node.parentElement) signInAncestors.push(node);
    p = { r, root, list, overlay, loading, alert, actor, actorData, labels, signIn, signInHref: signIn.getAttribute('href'), signInResolved: signIn.href, signInAncestors, app: root.getAttribute('data-app-data'), url: location.href, owners: [...Object.values(r), ...labels, list, overlay, loading, alert, actor, signIn, signIn.parentElement].filter((node) => node?.nodeType === 1).map((node) => ({ node, parent: node.parentNode })),
      fieldId: r.field.id, otherId: r.other.id, otherChecked: r.other.checked, initialChecked: r.field.checked, phase: 'baseline', epoch: null, ready: null, baseline: null, events: [], failure: null, records: 0, stopped: false };
    globalThis[key] = p;
  }
  if (p === undefined) return bad('SESSION_NOT_INSTALLED');
  const invalidate = (code) => { p.failure ??= code;p.ready = null; };
  const owns = () => {
    const r = p.r;
    if (location.href !== p.url || document.body.dataset.projectId !== '278964' || document.body.dataset.projectFullPath !== 'gitlab-org/gitlab' || p.root.getAttribute('data-app-data') !== p.app
      || p.actor.getAttribute('data-current-user-data') !== p.actorData || !p.owners.every(({ node, parent }) => native(node) && node.parentNode === parent) || document.querySelectorAll('[data-rapid-diffs][data-app-data]').length !== 1) return false;
    if (!shown(p.signIn) || p.signIn.getAttribute('href') !== p.signInHref || p.signIn.href !== p.signInResolved || p.signIn.getAttribute('data-testid') !== 'topbar-signin-button'
      || [...document.querySelectorAll('.js-mr-title-actions[data-is-signed-in="true"]')].some(native)) return false;
    const actors = [...document.querySelectorAll('#js-vue-mr-discussions[data-current-user-data]')].filter(native);if (actors.length !== 1 || actors[0] !== p.actor) return false;
    for (const [node, id, testid, text] of [[r.field, p.fieldId, 'show-whitespace', 'Show whitespace changes'], [r.other, p.otherId, 'file-by-file', 'Show one file at a time']]) {
      if (node.id !== id || node.type !== 'checkbox' || node.getAttribute('data-testid') !== testid || node.getAttribute('value') !== 'true' || node.disabled || node.readOnly || node.closest('[inert],[aria-disabled="true"],[aria-readonly="true"]') || document.getElementById(id) !== node
        || [...document.querySelectorAll('[id]')].filter((candidate) => candidate.id === id).length !== 1) return false;
      const labels = [...r.menu.querySelectorAll('label[for]')].filter((label) => label.htmlFor === id);if (labels.length !== 1 || !native(labels[0]) || labels[0].textContent.replace(/\s+/g, ' ').trim() !== text) return false;
    }
    return r.opener.matches('button.js-show-diff-settings[data-testid="base-dropdown-toggle"][role="combobox"]') && r.opener.type === 'button' && !r.opener.disabled && r.opener.getAttribute('aria-disabled') !== 'true'
      && ['true', 'false'].includes(r.opener.getAttribute('aria-expanded')) && r.owner.getAttribute('aria-label') === 'Preferences'
      && r.other.checked === p.otherChecked && p.otherChecked === false && r.menu.querySelectorAll('input,select,textarea,form,[contenteditable],button,a').length === 2
      && ![...document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]')].some((node) => node.closest('[data-geld-ui],.note,.md') === null && node.closest('[hidden],[inert],[aria-hidden="true"]') === null && getComputedStyle(node).display !== 'none');
  };
  const idle = () => !p.overlay.hasAttribute('data-loading') && p.loading.hidden && p.alert.childNodes.length === 0;
  const nodes = () => [...p.root.querySelectorAll('diff-file[data-file-data]')].filter(native);
  const snapshot = () => {
    const files = nodes();if (files.length !== fixture.paths.length || files.some((file) => !p.list.contains(file))) return null;
    const paths = new Set();const result = [];let bytes = 0;
    for (const file of files) {
      const serialized = file.getAttribute('data-file-data');if (serialized === null || serialized.length > 16384 || new TextEncoder().encode(serialized).length > 16384) return null;
      let data;try { data = JSON.parse(serialized); } catch { return null; }
      const slot = fixture.paths.indexOf(data?.new_path);const refs = data?.diff_refs;
      if (slot < 0 || paths.has(slot) || file.closest('[hidden],[inert],[aria-hidden="true"]') || !sha(file.id) || [...document.querySelectorAll('[id]')].filter((node) => node.id === file.id).length !== 1 || file.lastElementChild?.tagName !== 'DIFF-FILE-MOUNTED'
        || !refs || ![refs.base_sha, refs.start_sha, refs.head_sha].every(sha)) return null;
      for (const [name, raw] of [['blob_raw_path', true], ['diff_lines_path', false]]) {
        try { const url = new URL(data[name], location.origin);const path = fixture.paths[slot].split('/').map(encodeURIComponent).join('/');if (typeof data[name] !== 'string' || url.href !== url.origin + url.pathname || url.origin !== 'https://gitlab.com' || url.pathname !== `/gitlab-org/gitlab/-/${raw ? 'raw' : 'blob'}/${refs.head_sha}/${path}${raw ? '' : '/diff_lines'}`) return null; } catch { return null; }
      }
      const boxes = [...file.querySelectorAll('input[data-viewed-checkbox][type="checkbox"]')].filter(native);if (boxes.length !== 1 || !boxes[0].disabled) return null;
      const codes = [...file.querySelectorAll('.rd-line-text')];bytes += codes.reduce((sum, node) => sum + node.textContent.length, 0);if (codes.length > 4000 || bytes > 256000) return null;
      const texts = [];for (const code of codes) { const walker = document.createTreeWalker(code, 4);let text;while ((text = walker.nextNode()) !== null) texts.push({ node: text, data: text.data }); }
      result.push({ root: file, serialized, slot, anchor: file.id, refs: { base: refs.base_sha, start: refs.start_sha, head: refs.head_sha }, viewed: { checked: boxes[0].checked, disabled: boxes[0].disabled }, viewedNode: boxes[0], texts,
        nodes: [...codes, ...file.querySelectorAll('[id],a[href],input[data-viewed-checkbox]')].map((node) => ({ node, id: node.id, href: node.getAttribute('href'), text: codes.includes(node) ? node.textContent : null })) });paths.add(slot);
    }
    return result.every((file) => ['head', 'base', 'start'].every((name) => file.refs[name] === result[0].refs[name])) ? result : null;
  };
  const invariant = (files) => files !== null && files.every((file) => native(file.root) && p.list.contains(file.root) && file.root.id === file.anchor && file.root.getAttribute('data-file-data') === file.serialized
    && file.viewedNode.checked === file.viewed.checked && file.viewedNode.disabled === file.viewed.disabled && file.texts.every(({ node, data }) => node.isConnected && file.root.contains(node) && node.data === data)
    && file.nodes.every(({ node, id, href, text }) => node.isConnected && file.root.contains(node) && node.id === id && node.getAttribute('href') === href && (text === null || node.textContent === text)))
    && nodes().length === files.length && nodes().every((node) => files.some((file) => file.root === node));
  const contains = (node, target) => node === target || node.contains(target);
  const contradictory = (node) => node.nodeType === 1 && (node.matches('.js-mr-title-actions[data-is-signed-in="true"]') && node.closest(excluded) === null
    || [...node.querySelectorAll('.js-mr-title-actions[data-is-signed-in="true"]')].some((candidate) => candidate.closest(excluded) === null));
  const process = (records) => {
    if (p.failure || p.stopped) return;
    if (!owns()) { invalidate('ORIGINAL_SESSION_OWNER_CHANGED');return; }
    for (let index = 0; index < records.length; index++) {
      const mutation = records[index];if (++p.records > 4096) { invalidate('SESSION_HISTORY_BOUND');break; }
      if (mutation.type === 'attributes' && (mutation.target === p.root && mutation.attributeName === 'data-app-data' || mutation.target === p.actor && mutation.attributeName === 'data-current-user-data'
        || mutation.target === document.body && ['data-project-id', 'data-project-full-path'].includes(mutation.attributeName))) { invalidate('SESSION_IDENTITY_MUTATED');break; }
      let concealedWitness = false;
      if (mutation.type === 'attributes' && mutation.attributeName === 'style' && p.signInAncestors.includes(mutation.target)) {
        const previous = document.createElement('span').style;previous.cssText = mutation.oldValue ?? '';
        concealedWitness = previous.display === 'none' || ['hidden', 'collapse'].includes(previous.visibility) || previous.opacity === '0';
      }
      const changedDestination = mutation.type === 'attributes' && mutation.target === p.signIn
        && (mutation.attributeName === 'href' && mutation.oldValue !== p.signInHref
          || mutation.attributeName === 'data-testid' && mutation.oldValue !== 'topbar-signin-button');
      const hiddenWitness = mutation.type === 'attributes' && p.signInAncestors.includes(mutation.target) && (['hidden', 'inert'].includes(mutation.attributeName)
        || mutation.attributeName === 'aria-hidden' && (mutation.oldValue === 'true' || mutation.target.getAttribute('aria-hidden') === 'true'));
      if (concealedWitness || changedDestination || hiddenWitness) {
        p.witnessMutation = { attribute: mutation.attributeName, target: mutation.target === p.signIn ? 'sign_in' : 'ancestor', currentlyVisible: shown(p.signIn), oldValueMatchesCurrent: mutation.oldValue === mutation.target.getAttribute(mutation.attributeName) };
        invalidate('ANONYMOUS_WITNESS_MUTATED');break;
      }
      if (mutation.type === 'childList' && mutation.target.closest?.(excluded) === null && [...mutation.addedNodes, ...mutation.removedNodes].some(contradictory)
        || mutation.type === 'attributes' && mutation.target.closest(excluded) === null && (mutation.attributeName === 'data-is-signed-in' && mutation.target.classList.contains('js-mr-title-actions')
          || mutation.attributeName === 'class' && mutation.target.getAttribute('data-is-signed-in') === 'true')) { invalidate('ANONYMOUS_ACTOR_CONTRADICTION');break; }
      if (mutation.type === 'attributes' && [p.r.field, p.r.other].includes(mutation.target) && ['id', 'type', 'name', 'value', 'data-testid', 'disabled', 'readonly', 'aria-disabled', 'aria-readonly'].includes(mutation.attributeName)) { invalidate('NATIVE_FIELD_MUTATED');break; }
      if (p.labels.some((label) => mutation.target === label || label.contains(mutation.target)) && (mutation.type === 'childList' || mutation.type === 'attributes' && mutation.attributeName === 'for')) { invalidate('NATIVE_LABEL_MUTATED');break; }
      if (mutation.type === 'childList' && (mutation.target === p.r.menu || p.r.menu.contains(mutation.target)) && [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node.nodeType === 1 && (node.matches('input,select,textarea,form,[contenteditable],label') || node.querySelector('input,select,textarea,form,[contenteditable],label')))) { invalidate('NATIVE_MENU_STRUCTURE_MUTATED');break; }
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-geld-ui' && p.owners.some(({ node }) => mutation.target === node || mutation.target.contains(node))) { invalidate('NATIVE_OWNERSHIP_MUTATED');break; }
      if (mutation.type === 'childList' && [...mutation.removedNodes].some((node) => p.owners.some(({ node: owner }) => contains(node, owner)))) { invalidate('ORIGINAL_SESSION_OWNER_REMOVED');break; }
      if (mutation.type === 'childList' && (mutation.target === p.alert || p.alert.contains(mutation.target)) && mutation.addedNodes.length) { invalidate('NATIVE_RELOAD_ALERT');break; }
      if (mutation.type === 'childList' && [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node.nodeType === 1 && (node.matches('dialog,[role="dialog"],[aria-modal="true"],[data-diffs-list],[data-diffs-overlay],[data-list-loading],[data-diffs-list-alert]') || node.querySelector('dialog,[role="dialog"],[aria-modal="true"],[data-diffs-list],[data-diffs-overlay],[data-list-loading],[data-diffs-list-alert]')))) { invalidate('NATIVE_MARKER_OR_DIALOG_CHANGED');break; }
      const epoch = p.epoch;if (epoch === null) continue;
      if (mutation.type === 'attributes' && (mutation.target === p.overlay && mutation.attributeName === 'data-loading' || mutation.target === p.loading && mutation.attributeName === 'hidden')) {
        const later = records.slice(index + 1).find((next) => next.type === 'attributes' && next.target === mutation.target && next.attributeName === mutation.attributeName);
        const after = later ? later.oldValue : mutation.target.getAttribute(mutation.attributeName);
        if (mutation.target === p.overlay && mutation.oldValue === null && after === 'true' && epoch.stage === 'input') epoch.stage = 'overlay';
        else if (mutation.target === p.overlay && mutation.oldValue === 'true' && after === null && epoch.stage === 'cleared') epoch.overlayCleared = true;
        else if (mutation.target === p.loading && mutation.oldValue !== null && after === null && epoch.stage === 'cleared' && epoch.overlayCleared) epoch.stage = 'streaming';
        else if (mutation.target === p.loading && mutation.oldValue === null && after !== null && epoch.stage === 'streaming') epoch.stage = 'finished';
        else { invalidate('NATIVE_RELOAD_ORDER_UNQUALIFIED');break; }
      }
      if (mutation.type === 'childList') {
        if (epoch.stage === 'overlay') { for (const file of epoch.original) if ([...mutation.removedNodes].some((node) => contains(node, file.root))) epoch.removed.add(file.root);if (epoch.removed.size === epoch.original.length) epoch.stage = 'cleared'; }
        if (epoch.stage !== 'input' && epoch.stage !== 'overlay' && [...mutation.addedNodes].some((node) => epoch.original.some((file) => contains(node, file.root)))) { invalidate('ORIGINAL_FILES_REUSED');break; }
      }
    }
  };
  const drain = () => process(p.observer.takeRecords());
  if (action === 'install') {
    if (!owns() || !idle()) return bad('BASELINE_SESSION_UNQUALIFIED');p.baseline = snapshot();if (p.baseline === null) return bad('BASELINE_NATIVE_FRAME_UNQUALIFIED');
    p.listen = (event) => {
      if (p.stopped || p.failure) return;
      const target = event.target;const label = p.r.label;
      if (event.type === 'change' && event.isTrusted === true && target !== p.r.field && target?.closest?.('[data-geld-ui]') === null && p.root.querySelector(':scope > header.rd-app-header')?.contains(target)) { invalidate('COMPETING_NATIVE_VIEW_CHOICE');return; }
      if (event.type === 'click' && (target === p.r.field || label.contains(target))) { drain();clearTimeout(p.gestureTimer);p.gesture = event.isTrusted === true;p.gestureTimer = setTimeout(() => { p.gesture = false; }, 0);return; }
      if (event.type !== 'change' || target !== p.r.field) return;
      drain();if (!p.gesture || event.isTrusted !== true || p.epoch !== null || !idle() || !invariant(p.ready ?? p.baseline) || p.events.length >= 2) { invalidate('NATIVE_INPUT_UNQUALIFIED');return; }
      p.gesture = false;clearTimeout(p.gestureTimer);p.events.push({ phase: p.phase, trusted: true, checked: p.r.field.checked });p.records = 0;p.budgetPhase = p.phase;
      p.epoch = { stage: 'input', desired: p.r.field.checked, original: p.ready ?? p.baseline, removed: new Set(), overlayCleared: false };p.ready = null;
    };
    p.observer = new document.defaultView.MutationObserver(process);p.observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
    document.addEventListener('click', p.listen, true);document.addEventListener('change', p.listen, true);
    p.stop = () => { drain();p.stopped = true;clearTimeout(p.gestureTimer);p.observer.disconnect();document.removeEventListener('click', p.listen, true);document.removeEventListener('change', p.listen, true); };
  }
  drain();
  if (!owns()) invalidate('ORIGINAL_SESSION_OWNER_CHANGED');
  if (p.failure) return bad(p.failure);
  if (action === 'mark-toggle' || action === 'mark-restore') {
    if (p.epoch !== null || !idle() || !invariant(p.ready ?? p.baseline) || p.events.length !== (action === 'mark-toggle' ? 0 : 1)) return bad('NATIVE_PHASE_UNQUALIFIED');p.phase = action === 'mark-toggle' ? 'toggle' : 'restore';
  }
  if (p.epoch?.stage === 'finished') {
    const current = snapshot();if (current === null || !idle() || p.r.field.checked !== p.epoch.desired || current.some((file) => p.epoch.original.some((old) => old.root === file.root))) { invalidate('COMPLETED_NATIVE_FRAME_UNQUALIFIED');return bad(p.failure); }
    p.ready = current;p.completed = (p.completed ?? 0) + 1;p.epoch = null;
  }
  if (p.epoch === null && !invariant(p.ready ?? p.baseline)) { invalidate('CURRENT_NATIVE_FRAME_CHANGED');return bad(p.failure); }
  if (action === 'opener') return p.epoch === null && shown(p.r.opener) && p.r.opener.getAttribute('aria-expanded') === 'false' ? p.r.opener : null;
  if (action === 'toggle-target') return p.epoch === null && p.events.length < 2 && shown(p.r.menu) && shown(p.r.label) && p.r.opener.getAttribute('aria-expanded') === 'true' ? p.r.label : null;
  if (!['install', 'read', 'mark-toggle', 'mark-restore'].includes(action)) return bad('UNKNOWN_SESSION_ACTION');
  const files = p.ready ?? p.baseline;
  return { qualified: true, model: p.epoch !== null ? 'native_reload_pending' : p.ready ? 'completed_native_reload' : 'initial_selected_target', phase: p.phase, pending: p.epoch !== null, stage: p.epoch?.stage ?? 'idle', completed: p.completed ?? 0,
    bootstrapUnchanged: true, ownerUnchanged: true, checked: p.r.field.checked, other: { fileByFile: p.r.other.checked }, open: p.r.opener.getAttribute('aria-expanded') === 'true' && shown(p.r.menu), events: p.events,
    files: files.map(({ slot, anchor, refs, viewed }) => ({ slot, anchor, refs, viewed })), preservedNativeNodes: p.epoch === null && invariant(files) };
}

export async function verifyGitLabWhitespaceSession(page, { settings, observer, comparisons, acquisition, poll, totals, progress }) {
  const p = progress;Object.assign(p, { status: 'running', phase: 'STRICT_BASELINE', artifacts: { suppressed: 'Report only. No HTML, AX, PNG, raw bootstrap or unknown field values.' }, nativeRestored: false });
  let baseline;let installed = false;let choiceAttempted = false;let primary;const cleanupCodes = [];
  const old = (action) => page.evaluate(gitLabWhitespaceProbe, action, GITLAB_WHITESPACE_SESSION);
  const strictCurrent = async () => { await settings.current();const value = await old('read');check(value.qualified === true, value.code ?? 'STRICT_BASELINE_UNQUALIFIED');return value; };
  const read = async (action = 'read') => { await settings.current();const result = await page.evaluate(gitLabWhitespaceSessionProbe, action, GITLAB_WHITESPACE_SESSION);p.lastProbe = result;check(result?.qualified === true, result?.code ?? 'SESSION_PROBE_FAILED');return result; };
  const click = async (action) => {
    await read();const handle = await page.evaluateHandle(gitLabWhitespaceSessionProbe, action, GITLAB_WHITESPACE_SESSION);
    try { const node = handle.asElement();check(node !== null, 'ORIGINAL_NATIVE_CONTROL_UNAVAILABLE');await node.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));await read();check(await node.evaluate((element) => { const r = element.getBoundingClientRect();const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);return element.isConnected && hit !== null && (hit === element || element.contains(hit)); }), 'NATIVE_CONTROL_OCCLUDED');await node.click(); }
    finally { await handle.dispose(); }
  };
  const mode = (phase, checked) => observer.evidence.modes.some((entry) => entry.phase === phase && entry.eligible && entry.nativeFrame && !entry.extensionFrame && entry.status === 200 && entry.finished && entry.ignoreWhitespace === !checked);
  const stable = async (completed) => poll(async () => { const before = await read();const after = await read('frame');return { before, after }; }, ({ before, after }) => after.completed === completed && !after.pending && after.preservedNativeNodes && isDeepStrictEqual(before, after), 'Independent completed native whitespace frame');
  const transition = async (desired, phase, count) => {
    p.phase = phase === 'toggle' ? 'NATIVE_TOGGLE' : 'NATIVE_RESTORE';observer.phase(phase);await read(`mark-${phase}`);let before = await read();
    check(before.checked !== desired, 'NATIVE_MODE_CHANGED_BEFORE_INPUT');
    if (!before.open) { p.menuOpens ??= [];p.menuOpens.push({ phase });await click('opener');before = await poll(() => read(), (value) => value.open, 'Original Preferences menu opens'); }
    settings.intent(desired);choiceAttempted = true;await click('toggle-target');
    const value = await poll(() => read(), (value) => value.events.length === count && value.events[count - 1].trusted === true && value.events[count - 1].checked === desired, 'Trusted original native whitespace choice');
    p[phase] = { input: value };await poll(() => read(), (value) => mode(phase, desired) && value.completed === count, 'Independent native mode response and completed reload');
    const settled = (await stable(count)).after;check(settled.checked === desired, 'NATIVE_MODE_REVERTED');await poll(async () => { try { await settings.choiceComplete();return true; } catch (failure) { if (fixed(failure) === 'NATIVE_INTENT_NOT_PERSISTED') return false;throw failure; } }, (ready) => ready, 'Product-generated current-review opt-out choice');
    p[phase].settled = settled;p.phase = phase === 'toggle' ? 'TOGGLE_PRODUCT_TOTALS' : 'RESTORE_PRODUCT_TOTALS';p[phase].state = await totals(phase);p.phase = 'POST_PRODUCT_NATIVE_FRAME';const after = await read('frame');check(after.preservedNativeNodes && after.completed === count && !after.pending && after.checked === desired && isDeepStrictEqual(after.files, settled.files), 'POST_PRODUCT_NATIVE_FRAME_CHANGED');p[phase].afterProduct = after;return after;
  };
  try {
    const ready = await poll(() => old('read'), (value) => value.qualified ? value.files.every((file) => file.mounted) : !['SOURCE_OWNER_PENDING', 'MENU_OWNER_PENDING'].includes(value.code), 'Strict original anonymous whitespace baseline');
    check(ready.qualified, ready.code ?? 'STRICT_BASELINE_UNQUALIFIED');
    if (!ready.open) {
      const armed = await old('arm-opener');check(armed.armed, 'OPENER_ARM_UNQUALIFIED');const handle = await page.evaluateHandle(gitLabWhitespaceProbe, 'opener', GITLAB_WHITESPACE_SESSION);
      try { const node = handle.asElement();check(node !== null, 'ORIGINAL_NATIVE_CONTROL_UNAVAILABLE');await node.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));await strictCurrent();check(await node.evaluate((element) => { const r = element.getBoundingClientRect();const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);return element.isConnected && hit !== null && (hit === element || element.contains(hit)); }), 'NATIVE_CONTROL_OCCLUDED');await node.click(); } finally { await handle.dispose(); }
    }
    baseline = await old('bind');check(baseline.bound && baseline.open, 'STRICT_BASELINE_UNQUALIFIED');p.baseline = retainedBaseline(baseline);
    check(baseline.url === GITLAB_WHITESPACE_SESSION.url && baseline.checked === false && baseline.files.every((file) => file.viewed.disabled), 'INITIAL_HIDE_MODE_OR_VIEWED_UNQUALIFIED');await settings.bind();
    await comparisons.checkpoint('beforeIntent', {});
    p.phase = 'INDEPENDENT_ACQUISITION';p.acquisition = await poll(async () => acquisitionMatches(baseline, acquisition(), '1'), (value) => value.matched, 'Existing complete pinned independent acquisition for explicit w1');
    await strictCurrent();observer.bind(baseline.nativeStream);observer.phase('baseline');p.phase = 'INSTALL_INDEPENDENT_SESSION';const setup = await page.evaluate(gitLabWhitespaceSessionProbe, 'install', GITLAB_WHITESPACE_SESSION);p.setup = setup;check(setup.qualified, setup.code ?? 'SESSION_INSTALL_FAILED');installed = true;
    p.phase = 'BASELINE_PRODUCT_TOTALS';p.baselineState = await totals('baseline');p.baselineSelection = { source: { id: GITLAB_WHITESPACE.version, head: GITLAB_WHITESPACE.head }, target: baseline.app.targetVersions.filter((entry) => entry.selected).map(({ id, head_sha, is_merge_head }) => ({ id: String(id), head: head_sha, mergeHead: is_merge_head })) };
    await transition(true, 'toggle', 1);p.status = 'bounded_session_verified';
  } catch (failure) { primary = fixed(failure);p.primaryFailure = primary;p.failurePhase = p.phase;p.status = baseline ? 'failed' : 'unavailable'; }
  finally {
    if (installed && choiceAttempted && !page.isClosed()) try {
      const current = await read();check(current.completed === 1 && !current.pending && current.checked === true, 'NATIVE_RESTORE_SOURCE_UNQUALIFIED');
      const restored = await transition(false, 'restore', 2);check(isDeepStrictEqual(restored.other, p.setup.other) && isDeepStrictEqual(restored.files.map(({ slot, viewed }) => [slot, viewed]), p.setup.files.map(({ slot, viewed }) => [slot, viewed])), 'NATIVE_PROPERTY_VECTOR_NOT_RESTORED');
      p.nativeRestored = true;p.sourceRestoration = { initialHead: baseline.files[0].head, restoredHead: restored.files[0].refs.head, equalsInitial: baseline.files[0].head === restored.files[0].refs.head, claim: 'Mode, other preferences and Viewed values restored. Native head and nodes reported independently.' };
    } catch (failure) { cleanupCodes.push(fixed(failure));p.nativeRestored = false; }
    if (installed && page.isClosed()) cleanupCodes.push('SESSION_PAGE_CLOSED_BEFORE_RESTORE');
    if (!page.isClosed()) for (const probe of [gitLabWhitespaceSessionProbe, gitLabWhitespaceProbe]) try { check((await page.evaluate(probe, 'cleanup', GITLAB_WHITESPACE_SESSION))?.released, 'SESSION_PROBE_CLEANUP_FAILED'); } catch { cleanupCodes.push('SESSION_PROBE_CLEANUP_FAILED'); }
    p.nativeCleanupCodes = cleanupCodes;const cleanup = await cleanupGitLabWhitespace(page, { settings, observer, comparisons, progress: p });if (cleanup.codes.length) { p.status = 'failed';cleanupCodes.splice(0, cleanupCodes.length, ...cleanup.codes); }
  }
  if (primary || cleanupCodes.length) throw new AggregateError([...(primary ? [new Error(primary)] : []), ...cleanupCodes.map((code) => new Error(code))], 'Native whitespace session or cleanup failed');
  return { status: 'passed', verified: 'One anonymous native diff visit, two original checkbox choices, independently complete current-native reload frames, unchanged acquired counts/categories and exact close-first raw settings restoration. Digest, server preference persistence and native Viewed writes are separate and unverified.' };
}
