export async function gitLabWhitespaceProbe(action = 'read', fixture) {
  const key = '__geldWhitespaceProof';
  if (!['read', 'cleanup', 'frame', 'bind', 'arm-opener', 'opener', 'toggle-target', 'mark-toggle', 'mark-restore'].includes(action)) return { qualified: false, code: 'UNKNOWN_PROBE_ACTION' };
  if (action === 'cleanup') {
    const proof = globalThis[key];
    if (proof) for (const type of ['click', 'input', 'change']) document.removeEventListener(type, proof.listen, true);
    const lifecycle = proof?.stopLifecycle?.();delete globalThis[key];return { released: true, ...(lifecycle === undefined ? {} : { lifecycle }) };
  }
  if (action === 'frame') { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));action = 'read'; }
  const fail = (code) => ({ qualified: false, code, ...(globalThis[key]?.readLifecycle === undefined ? {} : { lifecycle: globalThis[key].readLifecycle() }) });
  const excluded = '[data-geld-ui], .note, .note-body, .note-text, .md, [data-testid="description-content"], [data-testid="noteable-note-container"], [contenteditable]';
  const native = (node) => node?.isConnected === true && node.closest(excluded) === null;
  const shown = (node) => {
    if (!native(node) || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let p = node; p; p = p.parentElement) { const s = getComputedStyle(p);if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0') return false; }
    const r = node.getBoundingClientRect();return r.width > 0 && r.height > 0;
  };
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  const id = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) ? value : null;
  let url;
  try {
    url = new URL(location.href);const expected = new URL(fixture.url);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.searchParams.getAll('diff_id').length !== 1 || url.searchParams.get('diff_id') !== fixture.version) return fail('ROUTE_UNQUALIFIED');
    for (const [name, value] of url.searchParams) if (!(name === 'diff_id' || name === 'w' && /^[01]$/.test(value) || name === 'view' && /^(inline|parallel)$/.test(value)) || url.searchParams.getAll(name).length !== 1) return fail('SELECTION_UNQUALIFIED');
    if (url.hash && !/^#[a-f0-9]{40}$/.test(url.hash)) return fail('ANCHOR_UNQUALIFIED');
  } catch { return fail('ROUTE_UNQUALIFIED'); }
  if (document.body.dataset.projectId !== '278964' || document.body.dataset.projectFullPath !== 'gitlab-org/gitlab') return fail('PROJECT_SCOPE_UNQUALIFIED');
  for (const overlay of document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]')) {
    if (!native(overlay) || overlay.closest('[hidden],[inert],[aria-hidden="true"]')) continue;
    let closed = false;for (let p = overlay; p; p = p.parentElement) { const s = getComputedStyle(p);if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') closed = true; }
    if (!closed) return fail('UNRELATED_DIALOG_UNQUALIFIED');
  }
  const actors = [...document.querySelectorAll('#js-vue-mr-discussions[data-current-user-data]')].filter(native);
  if (actors.length > 1 || [...document.querySelectorAll('.js-mr-title-actions[data-is-signed-in="true"]')].some(native)) return fail('ACTOR_UNQUALIFIED');
  try { if (actors.length && JSON.parse(actors[0].getAttribute('data-current-user-data') ?? 'null')?.id != null) return fail('ACTOR_UNQUALIFIED'); } catch { return fail('ACTOR_UNQUALIFIED'); }
  const signIn = [...document.querySelectorAll('a[data-testid="topbar-signin-button"]')].filter((node) => {
    if (!native(node)) return false;
    try { const link = new URL(node.href);return link.origin === url.origin && link.pathname === '/users/sign_in' && shown(node); } catch { return false; }
  });
  if (signIn.length < 1) return fail('ANONYMOUS_WITNESS_MISSING');
  const roots = [...document.querySelectorAll('[data-rapid-diffs][data-app-data]')].filter(native);
  if (roots.length !== 1) return fail(roots.length === 0 ? 'SOURCE_OWNER_PENDING' : 'SOURCE_OWNER_UNQUALIFIED');
  const root = roots[0];let app;
  try { app = JSON.parse(root.getAttribute('data-app-data')); } catch { return fail('SOURCE_DATA_UNQUALIFIED'); }
  if (!record(app) || app.mr_path !== '/gitlab-org/gitlab/-/merge_requests/266334' || id(app.iid) !== '266334' || app.file_by_file_mode !== false || typeof app.show_whitespace !== 'boolean'
    || app.update_user_endpoint !== '/api/v4/user/preferences') return fail('SOURCE_DATA_UNQUALIFIED');
  let nativeStream;
  try {
    const stream = new URL(app.reload_stream_url, url.origin);
    if (stream.origin !== url.origin || stream.pathname !== `${app.mr_path}/diffs_stream` || stream.username || stream.password || stream.hash
      || [...stream.searchParams].length !== 1 || stream.searchParams.get('diff_id') !== fixture.version || !['inline', 'parallel'].includes(app.diff_view_type)) return fail('NATIVE_ENDPOINT_UNQUALIFIED');
    nativeStream = { resource: `${stream.origin}${stream.pathname}`, diffId: stream.searchParams.get('diff_id'), view: app.diff_view_type, requestSourceHead: 'absent', requestTargetHead: 'absent' };
  } catch { return fail('NATIVE_ENDPOINT_UNQUALIFIED'); }
  const versions = (values, target) => {
    if (!Array.isArray(values) || !values.length || values.length > 1024) return null;
    const output = [];const seen = new Set();
    for (const value of values) {
      if (!record(value) || id(value.id) === null || seen.has(id(value.id)) || typeof value.selected !== 'boolean' || typeof value.is_merge_head !== 'boolean' || (!target || value.head_sha !== undefined) && !sha(value.head_sha)) return null;
      seen.add(id(value.id));let href;
      try {
        const link = new URL(value.href, url.origin);
        if (link.origin !== url.origin || link.pathname !== url.pathname || link.username || link.password || link.hash) return null;
        for (const [name, field] of link.searchParams) if (!(name === 'diff_id' && /^[1-9]\d*$/.test(field) || ['start_sha', 'commit_id'].includes(name) && sha(field) || name === 'w' && /^[01]$/.test(field)) || link.searchParams.getAll(name).length !== 1) return null;
        href = link.href;
      } catch { return null; }
      output.push({ id: value.id, selected: value.selected, is_merge_head: value.is_merge_head, ...(value.head_sha === undefined ? {} : { head_sha: value.head_sha }), href });
    }
    const selected = output.filter((value) => value.selected);
    return selected.length === 1 && sha(selected[0].head_sha) ? output : null;
  };
  const sourceVersions = versions(app.versions?.source_versions, false);const targetVersions = versions(app.versions?.target_versions, true);
  if (sourceVersions === null || targetVersions === null) return fail('VERSIONS_UNQUALIFIED');
  const source = sourceVersions.find((value) => value.selected);const target = targetVersions.find((value) => value.selected);
  if (id(source.id) !== fixture.version || source.head_sha !== fixture.head || source.is_merge_head !== false) return fail('PINNED_SOURCE_CHANGED');
  const header = root.querySelector(':scope > header.rd-app-header[aria-label="View controls"]');
  const owners = [...header?.querySelectorAll('.gl-new-dropdown[aria-label="Preferences"]') ?? []].filter(native);
  if (owners.length !== 1) return fail(owners.length === 0 ? 'MENU_OWNER_PENDING' : 'MENU_OWNER_UNQUALIFIED');
  const owner = owners[0];const openers = [...owner.querySelectorAll('button.js-show-diff-settings[data-testid="base-dropdown-toggle"][role="combobox"]')].filter(native);
  const menus = [...owner.querySelectorAll('[data-testid="base-dropdown-menu"]')].filter(native);
  if (openers.length !== 1 || menus.length !== 1) return fail(openers.length <= 1 && menus.length <= 1 ? 'MENU_OWNER_PENDING' : 'MENU_OWNER_UNQUALIFIED');
  const opener = openers[0];const menu = menus[0];
  if (!shown(opener) || opener.type !== 'button' || opener.disabled || opener.getAttribute('aria-disabled') === 'true' || !['true', 'false'].includes(opener.getAttribute('aria-expanded'))) return fail('OPENER_UNQUALIFIED');
  const fields = [...menu.querySelectorAll('input,select,textarea,[contenteditable],form,[role="dialog"]')];
  if (fields.length !== 2 || menu.querySelector('a,button,[role="textbox"],[role="combobox"]') !== null) return fail('MENU_SCHEMA_UNQUALIFIED');
  const known = {};
  for (const [testid, labelText] of [['show-whitespace', 'Show whitespace changes'], ['file-by-file', 'Show one file at a time']]) {
    const matches = fields.filter((field) => field.matches(`input[type="checkbox"][data-testid="${testid}"]`));
    if (matches.length !== 1) return fail('MENU_SCHEMA_UNQUALIFIED');
    const field = matches[0];
    if (field.disabled || field.readOnly || field.tabIndex < 0 || field.getAttribute('value') !== 'true' || field.closest('[inert],[aria-disabled="true"],[aria-readonly="true"]')) return fail('MENU_FIELD_UNQUALIFIED');
    const labels = [...menu.querySelectorAll('label[for]')].filter((label) => label.htmlFor === field.id);
    if (!field.id || document.getElementById(field.id) !== field || [...document.querySelectorAll('[id]')].filter((node) => node.id === field.id).length !== 1
      || labels.length !== 1 || !native(labels[0]) || labels[0].textContent.replace(/\s+/g, ' ').trim() !== labelText) return fail('MENU_LABEL_UNQUALIFIED');
    known[testid] = { field, label: labels[0] };
  }
  if (known['file-by-file'].field.checked !== false) return fail('MODE_UNQUALIFIED');
  const fileRoots = [...root.querySelectorAll('diff-file[data-file-data]')].filter(native);
  if (fileRoots.length !== fixture.paths.length) return fail('FILE_INVENTORY_UNQUALIFIED');
  const files = [];const boxes = [];let bytes = 0;
  const fileFailure = (reason, data, file) => {
    const slot = fixture.paths.indexOf(data?.new_path);const head = data?.diff_refs?.head_sha;const validHead = sha(head);
    return { ...fail('FILE_DATA_UNQUALIFIED'), fileData: { reason, pathSlot: slot < 0 ? null : slot, knownPath: slot >= 0,
      refPresent: record(data?.diff_refs) && Object.hasOwn(data.diff_refs, 'head_sha'), headValid: validHead, headMatchesTarget: validHead && head === target.head_sha, anchorValid: sha(file.id),
      ...(slot >= 0 && validHead ? { candidateHead: head } : {}) } };
  };
  for (const file of fileRoots) {
    let data;try { data = JSON.parse(file.getAttribute('data-file-data')); } catch { return fileFailure('FILE_JSON_UNREADABLE', null, file); }
    if (!fixture.paths.includes(data?.new_path)) return fileFailure('FILE_PATH_UNEXPECTED', data, file);
    if (!record(data?.diff_refs) || !Object.hasOwn(data.diff_refs, 'head_sha')) return fileFailure('FILE_REF_MISSING', data, file);
    if (!sha(data.diff_refs.head_sha)) return fileFailure('FILE_HEAD_INVALID', data, file);
    if (data.diff_refs.head_sha !== target.head_sha) return fileFailure('FILE_HEAD_MISMATCH', data, file);
    if (!sha(file.id)) return fileFailure('FILE_ANCHOR_INVALID', data, file);
    const inputs = [...file.querySelectorAll('input[data-viewed-checkbox][type="checkbox"]')].filter(native);
    if (inputs.length !== 1) return fail('VIEWED_UNQUALIFIED');
    boxes.push(inputs[0]);
    const rows = [...file.querySelectorAll('tr.rd-hunk-lines-inline, tr.rd-hunk-lines-parallel')].map((row) => {
      const old = row.querySelector('.rd-line-number[data-position="old"] a[data-line-number]')?.getAttribute('data-line-number') ?? null;
      const next = row.querySelector('.rd-line-number[data-position="new"] a[data-line-number]')?.getAttribute('data-line-number') ?? null;
      const text = [...row.querySelectorAll('.rd-line-text')].map((code) => code.textContent ?? '');bytes += text.reduce((count, value) => count + value.length, 0);
      return { old, next, text };
    });
    if (rows.length > 2000 || bytes > 256000) return fail('SOURCE_BOUND');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows))))].map((value) => value.toString(16).padStart(2, '0')).join('');
    files.push({ path: data.new_path, anchor: file.id, head: data.diff_refs.head_sha, mounted: file.lastElementChild?.tagName === 'DIFF-FILE-MOUNTED', rows: rows.length, sha256: digest, viewed: { checked: inputs[0].checked, disabled: inputs[0].disabled } });
  }
  if (new Set(files.map((file) => file.path)).size !== fixture.paths.length) return fail('FILE_INVENTORY_UNQUALIFIED');
  if (!native(opener) || !native(menu) || fields.some((field) => !native(field) || !field.matches('input[type="checkbox"]'))
    || menu.querySelectorAll('input,select,textarea,[contenteditable],form,[role="dialog"]').length !== 2) return fail('MENU_SCHEMA_UNQUALIFIED');
  try {
    const latest = JSON.parse(root.getAttribute('data-app-data'));
    if (JSON.stringify(versions(latest.versions?.source_versions, false)) !== JSON.stringify(sourceVersions) || JSON.stringify(versions(latest.versions?.target_versions, true)) !== JSON.stringify(targetVersions)
      || latest.reload_stream_url !== app.reload_stream_url || latest.diff_view_type !== app.diff_view_type) return fail('VERSIONS_CHANGED_DURING_READ');
  } catch { return fail('SOURCE_DATA_UNQUALIFIED'); }
  const references = { root, rootParent: root.parentElement, owner, ownerParent: owner.parentElement, opener, openerParent: opener.parentElement, menu, menuParent: menu.parentElement,
    field: known['show-whitespace'].field, fieldParent: known['show-whitespace'].field.parentElement, label: known['show-whitespace'].label, other: known['file-by-file'].field, otherParent: known['file-by-file'].field.parentElement };
  const scope = JSON.stringify([url.origin, url.pathname, url.search, source, target, nativeStream, files.map(({ path, anchor, head }) => [path, anchor, head])]);
  let proof = globalThis[key];
  if (proof && (proof.scope !== scope || Object.keys(references).some((name) => references[name] !== proof.references[name]))) return fail('ORIGINAL_OWNER_CHANGED');
  if (action === 'bind' || action === 'arm-opener') {
    if (action === 'arm-opener' && (proof || opener.getAttribute('aria-expanded') !== 'false')) return fail('OPENER_ARM_UNQUALIFIED');
    if (action === 'bind' && (proof?.bound || opener.getAttribute('aria-expanded') !== 'true' || !shown(menu) || !shown(references.label))) return fail('BIND_UNQUALIFIED');
    if (!proof) {
      proof = { references, scope, events: [], overflow: false, bound: false };
      proof.listen = (event) => {
      const kind = event.target === references.field || references.label.contains(event.target) ? 'whitespace' : event.target === references.other ? 'file-by-file'
        : event.target === opener || opener.contains(event.target) ? 'opener' : boxes.includes(event.target) ? 'viewed' : null;
      if (kind === null) return;
      if (kind === 'whitespace') proof.lifecycleInput?.(event);
      if (proof.events.length >= 40) { proof.overflow = true;return; }
      proof.events.push({ kind, type: event.type, trusted: event.isTrusted === true, ...(kind === 'whitespace' ? { checked: references.field.checked } : {}) });
      };
      for (const type of ['click', 'input', 'change']) document.addEventListener(type, proof.listen, true);
      globalThis[key] = proof;
    }
    if (action === 'bind') {
      proof.bound = true;
      const history = [];const limit = 128;let phase = 'baseline';let status = 'observing';let diagnosticCode = 'OBSERVING';let overflow = false;let closed = false;let observer;
      const one = (selector) => { const nodes = [...root.querySelectorAll(selector)].filter(native);return nodes.length === 1 ? nodes[0] : null; };
      const list = one('[data-diffs-list]');const overlay = one('[data-diffs-overlay]');const loading = one('[data-list-loading]');const alert = one('[data-diffs-list-alert]');
      const owners = [root, owner, opener, menu, references.field, references.label, references.other, list, overlay, loading, alert];const parents = owners.map((node) => node?.parentNode);
      let originals = [...fileRoots];let originalAnchors = originals.map((node) => node.id);let originalParents = originals.map((node) => node.parentNode);
      const currentOwners = () => owners.every((node, index) => native(node) && node.parentNode === parents[index] && (node === root || root.contains(node))) && [[list, '[data-diffs-list]'], [overlay, '[data-diffs-overlay]'], [loading, '[data-list-loading]'], [alert, '[data-diffs-list-alert]']].every(([node, selector]) => one(selector) === node);
      const contained = (node, file) => node === file || node.nodeType === 1 && node.contains(file);
      const bounded = (value) => Math.min(value, fixture.paths.length + 1);
      const state = () => {
        const current = list ? [...list.querySelectorAll('diff-file[data-file-data]')].filter(native) : [];
        return { ownersCurrent: currentOwners(), overlayLoading: overlay === null ? 'unknown' : !overlay.hasAttribute('data-loading') ? 'idle' : overlay.getAttribute('data-loading') === 'true' ? 'loading' : 'unknown',
          loadingHidden: loading?.hidden === true, alertEmpty: alert?.childNodes.length === 0,
          originalConnected: originals.filter((node) => node.isConnected).length, originalInRoot: originals.filter((node) => root.contains(node)).length,
          originalInList: originals.filter((node) => list?.contains(node)).length, originalParentsSame: originals.filter((node, index) => node.parentNode === originalParents[index]).length,
          nativeFilesInList: bounded(current.length), freshFilesInList: bounded(current.filter((node) => !originals.includes(node)).length) };
      };
      const record = (kind, detail = {}) => {
        if (closed || overflow) return;
        if (history.length >= limit) { overflow = true;status = 'incomplete';diagnosticCode = 'HISTORY_BOUND';return; }
        history.push({ seq: history.length + 1, phase, kind, ...state(), ...detail });
      };
      const process = (records) => {
        for (let index = 0; index < records.length && !overflow; index++) {
          const mutation = records[index];
          if (mutation.type === 'attributes' && (mutation.target === overlay && mutation.attributeName === 'data-loading' || mutation.target === loading && mutation.attributeName === 'hidden')) {
            const next = records.slice(index + 1).find((entry) => entry.type === 'attributes' && entry.target === mutation.target && entry.attributeName === mutation.attributeName);
            const after = next ? next.oldValue : mutation.target.getAttribute(mutation.attributeName);
            const token = (value) => value === null ? 'absent' : mutation.attributeName === 'hidden' ? 'present' : value === 'true' ? 'true' : 'unknown';
            record(mutation.target === overlay ? 'overlay' : 'loading', { before: token(mutation.oldValue), after: token(after) });
          } else if (mutation.type === 'childList') {
            const removedOwners = owners.filter((owner) => owner !== null && [...mutation.removedNodes].some((node) => contained(node, owner))).length;const addedOwners = owners.filter((owner) => owner !== null && [...mutation.addedNodes].some((node) => contained(node, owner))).length;
            if (removedOwners || addedOwners) record('owner_structure', { removedOwnerRefs: removedOwners, addedOwnerRefs: addedOwners });
            if ([...mutation.addedNodes, ...mutation.removedNodes].some((node) => node.nodeType === 1 && (node.matches('[data-diffs-list],[data-diffs-overlay],[data-list-loading],[data-diffs-list-alert]') || node.querySelector('[data-diffs-list],[data-diffs-overlay],[data-list-loading],[data-diffs-list-alert]') !== null))) record('marker_structure', { addedNodes: bounded(mutation.addedNodes.length), removedNodes: bounded(mutation.removedNodes.length) });
            if (mutation.target === alert || alert?.contains(mutation.target)) record('alert', { addedNodes: bounded(mutation.addedNodes.length), removedNodes: bounded(mutation.removedNodes.length) });
            const removed = originals.filter((file) => [...mutation.removedNodes].some((node) => contained(node, file))).length;
            const structural = [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node.nodeType === 1 && (node.matches('diff-file,diff-file-mounted') || node.querySelector('diff-file,diff-file-mounted') !== null));
            if (mutation.target === list || removed > 0 || structural && list?.contains(mutation.target)) record('list_structure', { removedOriginalRefs: removed, addedNodes: bounded(mutation.addedNodes.length), removedNodes: bounded(mutation.removedNodes.length) });
          }
        }
      };
      const drain = () => { try { if (observer) process(observer.takeRecords());if (!closed && status === 'observing' && !currentOwners() && !history.some((entry) => entry.kind === 'owner_lost')) record('owner_lost'); } catch { status = 'unavailable';diagnosticCode = 'OBSERVER_FAILED'; } };
      const report = () => { drain();return { status, code: diagnosticCode, stateTiming: 'observation_drain', fileReferenceBasis: 'phase_native_files', limit, overflow, stopped: closed, history }; };
      const mounted = (event) => {
        if (event.target?.nodeType !== 1 || !native(event.target) || event.target.tagName !== 'DIFF-FILE' || !list?.contains(event.target)) return;
        drain();record('file_mounted', { originalFile: originals.includes(event.target), knownAnchorSlot: originalAnchors.indexOf(event.target.id), trusted: event.isTrusted === true });
      };
      if ([list, overlay, loading, alert].some((node) => node === null)) { status = 'unavailable';diagnosticCode = 'MARKER_SCHEMA_UNAVAILABLE'; }
      else if (typeof document.defaultView?.MutationObserver !== 'function') { status = 'unavailable';diagnosticCode = 'OBSERVER_UNAVAILABLE'; }
      else {
        try {
          observer = new document.defaultView.MutationObserver((records) => { try { process(records); } catch { status = 'unavailable';diagnosticCode = 'OBSERVER_FAILED'; } });
          observer.observe(root, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'data-loading'], childList: true, subtree: true });
          if (root.parentNode) observer.observe(root.parentNode, { childList: true });
          root.addEventListener('DiffFileMounted', mounted);record('baseline');
        } catch { status = 'unavailable';diagnosticCode = 'OBSERVER_FAILED'; }
      }
      proof.readLifecycle = report;
      proof.markLifecycle = (value, currentFiles) => { drain();phase = value;originals = [...currentFiles];originalAnchors = originals.map((node) => node.id);originalParents = originals.map((node) => node.parentNode);record('phase'); };
      proof.lifecycleInput = (event) => { drain();record('native_input', { inputType: event.type, trusted: event.isTrusted === true, checked: references.field.checked }); };
      proof.stopLifecycle = () => { drain();try { observer?.disconnect(); } catch { status = 'unavailable';diagnosticCode = 'OBSERVER_FAILED'; }try { root.removeEventListener('DiffFileMounted', mounted); } catch { status = 'unavailable';diagnosticCode = 'OBSERVER_FAILED'; }closed = true;if (status === 'observing') { status = 'closed';diagnosticCode = 'CLOSED'; }return report(); };
    }
  }
  if (action === 'mark-toggle' || action === 'mark-restore') proof?.markLifecycle?.(action === 'mark-toggle' ? 'toggle' : 'restore', fileRoots);
  if (action === 'opener') return opener.getAttribute('aria-expanded') === 'false' ? opener : null;
  if (action === 'toggle-target') return proof && opener.getAttribute('aria-expanded') === 'true' && shown(menu) && shown(references.label) ? references.label : null;
  const number = (selector) => { const text = root.querySelector(selector)?.textContent?.trim() ?? '';return /^[+−\-]?[\d,]+$/.test(text) ? Number(text.replace(/[+,−\-]/g, '')) : null; };
  return { qualified: true, anonymous: true, url: url.href, app: { path: app.mr_path, iid: app.iid, fileByFileMode: false, sourceVersions, targetVersions },
    initialShowWhitespace: app.show_whitespace, nativeStream, checked: references.field.checked, other: { fileByFile: references.other.checked }, open: opener.getAttribute('aria-expanded') === 'true' && shown(menu),
    ...(proof?.readLifecycle === undefined ? {} : { lifecycle: proof.readLifecycle() }), files, displayedCounts: { additions: number('[data-testid="js-file-addition-line"]'), deletions: number('[data-testid="js-file-deletion-line"]') }, armed: proof !== undefined, bound: proof?.bound === true, events: proof?.events ?? [], eventOverflow: proof?.overflow ?? false };
}
