/** References and diagnostics only. Native input, Save and Cancel always use real browser handles. */
export function syntaxOnProbe(action = 'read', target = null, environment = {}) {
  const classify = (original, current, mode) => {
    const fail = (reason) => ({ valid: false, reason });const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!['on', 'off'].includes(mode) || !Array.isArray(original) || !Array.isArray(current) || original.length === 0 || original.length > 500 || original.length !== current.length) return fail('Native row count or requested renderer is unknown');
    const partition = (rows) => { const groups = [];for (let i = 0; i < rows.length; i++) { const group = rows[i]?.render?.group;if (!Number.isSafeInteger(group) || group < 0 || group > groups.length) return null;if (group === groups.length) groups.push([]);else if (group !== groups.length - 1) return null;groups[group].push(i); }return groups; };
    const groups = partition(original);const now = partition(current);if (groups === null || now === null || !equal(groups, now)) return fail('Original ordered native rowgroup partition changed');
    const tokenClasses = new Set(['token', 'key', 'atrule', 'punctuation', 'number', 'important', 'boolean', 'comment', 'tag']);
    const shape = (row, renderer) => {
      const r = row?.render;if (!r || r.tag !== 'SPAN' || r.role !== 'gridcell' || typeof r.ariaLabel !== 'string' || r.rowRole !== 'row' || !Array.isArray(r.classes) || !equal([...r.classes].sort(), renderer === 'on' ? ['__rbb_syntax_highlight', 'code-diff', 'syntax-highlighted'] : ['code-diff']) || !equal(r.attrs, ['aria-label', 'class', 'data-line-type', 'role']) || r.directText !== '' || !Array.isArray(r.childNodeTypes) || r.childNodeTypes.some((t) => ![1, 3].includes(t)) || !equal(r.children, ['SPAN']) || !Array.isArray(r.spans) || r.spans.length === 0) return false;
      if (renderer === 'off') return r.spans.length === 1 && equal(r.spans[0], { tag: 'SPAN', attrs: [], classes: [] });
      return r.spans.every((s, i) => s?.tag === 'SPAN' && equal(s.attrs, ['class']) && Array.isArray(s.classes) && s.classes.length > 0 && (i === 0 ? !s.classes.includes('token') : s.classes.includes('token') && s.classes.every((c) => tokenClasses.has(c))));
    };
    const validSemantic = (s) => s && [' ', '+', '-'].includes(s.kind) && Array.isArray(s.numbers) && s.numbers.length === 1 && Array.isArray(s.numbers[0]) && s.numbers[0].length === 2 && s.numbers[0].every((n) => n === null || typeof n === 'string' && /^[1-9]\d*$/.test(n) && Number.isSafeInteger(Number(n))) && s.numbers[0].some((n) => n !== null) && Array.isArray(s.ids) && s.ids.every((id) => typeof id === 'string' && id !== '') && Array.isArray(s.links) && s.links.every((link) => Array.isArray(link) && link.length === 2 && typeof link[0] === 'string' && (link[1] === null || typeof link[1] === 'string'));
    const rows = [];
    for (let i = 0; i < original.length; i++) {
      const before = original[i];const after = current[i];if (!before?.semantic || !after?.semantic || !shape(before, 'off') || !shape(after, mode)) return fail('Native plain/token span-only presentation witness is missing');
      const a = before.semantic;const b = after.semantic;if (!validSemantic(a) || !validSemantic(b) || typeof a.text !== 'string' || /[\r\n]/.test(a.text) || typeof b.text !== 'string' || before.render.ariaLabel !== after.render.ariaLabel || !equal([a.kind, a.numbers, a.ids, a.links], [b.kind, b.numbers, b.ids, b.links])) return fail('Original native code characters, aria, numbers, kind, IDs or links changed');
      const group = before.render.group;const last = groups[group].at(-1) === i;const expected = a.text + (mode === 'on' && !last ? '\n' : '');if (b.text !== expected) return fail('Only one proven non-final native rowgroup LF transition is allowed');
      rows.push({ index: i, group, groupEnd: last, rawBefore: a.text, rawAfter: b.text, originalCode: a.text, rendererLF: mode === 'on' && !last ? '\n' : '', numbers: a.numbers, kind: a.kind, ids: a.ids, links: a.links });
    }
    return { valid: true, origin: 'verified-native-rowgroup-terminal-lf', mode, groups, rows };
  };
  if (action === 'classify-native-lines') return classify(target?.original, target?.current, target?.mode);
  const KEY = '__geldBitbucketSyntaxOnCharacterization';let store = globalThis[KEY];
  const forbidden = '[data-geld-ui],[data-testid="comment"],[data-qa="pr-activity"],[data-qa="pull-request-description"]';
  const native = (n) => n !== null && n.isConnected && n.closest(forbidden) === null;
  const visible = (n) => {
    if (!native(n) || n.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let p = n; p; p = p.parentElement) { const s = getComputedStyle(p);if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.contentVisibility === 'hidden' || s.opacity === '0' && !(p === n && n.tagName === 'INPUT' && n.type === 'checkbox')) return false; }
    const r = n.getBoundingClientRect();return r.width > 0 && r.height > 0;
  };
  const enabled = (n) => native(n) && !n.disabled && !n.readOnly && !n.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[aria-readonly="true"],fieldset[disabled]');
  const actor = () => {
    const metas = [...document.head.querySelectorAll('meta#bb-bootstrap[data-current-user][data-target-workspace-uuid]')].filter(native);if (metas.length !== 1) return null;
    const node = metas[0];const user = node.getAttribute('data-current-user');const workspace = node.getAttribute('data-target-workspace-uuid');
    try { if (user.length > 16_384 || JSON.parse(user)?.isAuthenticated !== false || !workspace) return null; } catch { return null; }
    return { node, user, workspace };
  };
  const source = () => {
    const anchors = [...document.querySelectorAll('[id="chg-bitbucket-pipelines.yml"]')].filter(native);if (anchors.length !== 1) return null;
    const anchor = anchors[0];const root = anchor.parentElement;const articles = [...root.querySelectorAll('article[data-qa="branch-diff-file"]')].filter(native);if (articles.length !== 1) return null;const article = articles[0];
    if (article.querySelector('h2[data-qa="bk-filepath"]')?.textContent.trim() !== 'bitbucket-pipelines.yml') return null;
    const elements = [...article.querySelectorAll('[data-qa="code-line"]')].filter(native);if (elements.length === 0 || elements.length > 500) return null;
    const groupNodes = [];const groupIndices = new Map();let total = 0;const rows = elements.map((row) => { const code = row.querySelector('[data-line-type]');const group = row.closest('[role="rowgroup"]');if (!native(code) || !native(group) || !article.contains(group)) return null;
      if (!groupIndices.has(group)) { groupIndices.set(group, groupNodes.length);groupNodes.push(group); }
      const nodes = [];const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);for (let n = walker.nextNode(); n; n = walker.nextNode()) { if (++total > 4000) return null;nodes.push(n); }
      return { row, code, nodes, spans: [...code.querySelectorAll('*')], values: nodes.map((n) => n.data), font: getComputedStyle(code).font, idNodes: [...row.querySelectorAll('[id]')], linkNodes: [...row.querySelectorAll('a[href]')],
        render: { tag: code.tagName, role: code.getAttribute('role'), ariaLabel: code.getAttribute('aria-label'), rowRole: row.closest('[role="row"]')?.getAttribute('role') ?? null, group: groupIndices.get(group), classes: [...code.classList], attrs: [...code.attributes].map((a) => a.name).sort(), directText: [...code.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join(''), childNodeTypes: [...code.childNodes].map((n) => n.nodeType), children: [...code.children].map((n) => n.tagName), spans: [...code.querySelectorAll('*')].map((n) => ({ tag: n.tagName, attrs: [...n.attributes].map((a) => a.name).sort(), classes: [...n.classList] })) },
        semantic: { text: code.textContent, kind: code.getAttribute('data-line-type'), numbers: [...row.querySelectorAll('[data-key="code-line-number"]')].map((n) => [n.getAttribute('data-old-line-number'), n.getAttribute('data-new-line-number')]), ids: [...row.querySelectorAll('[id]')].map((n) => n.id), links: [...row.querySelectorAll('a[href]')].map((n) => [n.getAttribute('href'), n.getAttribute('aria-label')]) } }; });
    if (rows.some((r) => r === null)) return null;
    const viewed = [...root.querySelectorAll('label')].filter((n) => n.textContent.trim() === 'Viewed').map((n) => n.querySelector('input[type="checkbox"]'));
    if (viewed.length !== 1 || !native(viewed[0])) return null;
    const permalinkNodes = [...article.querySelectorAll('[data-qa="code-line-permalink"][id]')].filter(native);
    return { anchor, root, parent: root.parentElement, article, articleParent: article.parentElement, rows, groupNodes, permalinkNodes, permalinkIds: permalinkNodes.map((n) => n.id), lineWitness: rows.map((r) => ({ semantic: r.semantic, render: r.render })), viewed: viewed[0], checked: viewed[0].checked, disabled: viewed[0].disabled };
  };
  const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(native);
  const settings = () => {
    const ds = dialogs();if (ds.length !== 1 || !visible(ds[0])) return null;const dialog = ds[0];const heading = dialog.getAttribute('aria-labelledby');if (!heading || document.getElementById(heading)?.textContent.trim() !== 'Global diff view settings' || !dialog.contains(document.getElementById(heading))) return null;
    const forms = [...dialog.querySelectorAll('form')];if (forms.length !== 1) return null;const form = forms[0];
    const fields = [...form.querySelectorAll('input,select,textarea')];if (fields.length !== 13 || fields.some((f) => !native(f) || f.disabled || f.readOnly)) return null;
    const shape = fields.map((f) => [f.id, f.name, f.type, f.type === 'radio' ? f.value : null]);
    if (JSON.stringify(shape) !== JSON.stringify([
      ['', 'diffViewMode', 'radio', 'UNIFIED'], ['', 'diffViewMode', 'radio', 'SIDE_BY_SIDE'],
      ['diff-settings-syntax-highlighting-toggle', 'enableSyntaxHighlighting', 'checkbox', null], ['diff-settings-ignore-whitespace-toggle', 'shouldIgnoreWhitespace', 'checkbox', null],
      ['diff-settings-word-diff-toggle', 'enableWordDiff', 'checkbox', null], ['diff-settings-color-blind-mode-toggle', 'enableColorBlindMode', 'checkbox', null], ['diff-settings-annotations-toggle', 'enableAnnotations', 'checkbox', null],
      ['', 'isSingleFileModeEnabled', 'radio', 'ALL_FILES_MODE'], ['', 'isSingleFileModeEnabled', 'radio', 'SINGLE_FILE_MODE'], ['tab-size-pref', '', 'text', null], ['', 'tabSize', 'hidden', null],
      ['', 'fileViewMode', 'radio', 'TREE'], ['', 'fileViewMode', 'radio', 'LIST'],
    ])) return null;
    const syntax = fields.filter((f) => f.id === 'diff-settings-syntax-highlighting-toggle');if (syntax.length !== 1) return null;const field = syntax[0];
    if (field.type !== 'checkbox' || field.name !== 'enableSyntaxHighlighting' || field.value !== 'enableSyntaxHighlighting' || !enabled(field) || ![...field.labels ?? []].some((l) => l.textContent.trim() === 'Syntax highlighting' && visible(l))) return null;
    if (fields.filter((f) => f.type === 'hidden').length !== 1 || fields.find((f) => f.type === 'hidden')?.name !== 'tabSize') return null;
    const buttons = [...form.querySelectorAll('button')].filter(native);const saves = buttons.filter((b) => b.type === 'submit' && b.textContent.trim() === 'Save' && enabled(b) && visible(b));const cancels = buttons.filter((b) => b.type === 'button' && b.textContent.trim() === 'Cancel' && enabled(b) && visible(b));
    if (saves.length !== 1 || cancels.length !== 1) return null;
    const vector = fields.map((f) => ({ id: f.id, name: f.name, type: f.type, value: f.value, checked: 'checked' in f ? f.checked : null, disabled: f.disabled, readOnly: 'readOnly' in f ? f.readOnly : false }));
    return { dialog, form, field, save: saves[0], cancel: cancels[0], fields, vector };
  };
  if (action === 'cleanup') { if (store) for (const type of ['click', 'input', 'change', 'submit']) document.removeEventListener(type, store.listen, true);delete globalThis[KEY];return null; }
  if (action === 'events') return store ? [...store.events] : [];
  const a = actor();const s = source();const u = new URL(location.href);
  if (!a || !s || u.origin !== 'https://bitbucket.org' || u.pathname !== '/atlassian/bitbucket-upload-file/pull-requests/27/diff' || u.search || u.hash !== '#chg-bitbucket-pipelines.yml' || u.username || u.password) return null;
  if (action === 'inspect-native-lines') return { lines: s.lineWitness, permalinkIds: s.permalinkIds };
  if (action === 'setup') {
    if (store || dialogs().length || !classify(s.lineWitness, s.lineWitness, 'off').valid) return null;
    store = { url: location.href, actor: a, source: s, expectedSource: s, allowReplacement: false, saveTarget: null, on: null, baselineEvidence: null, nextBaseline: 0, nextForm: 0, foreign: [], opener: null, form: null, events: [], earlyEvents: [], expected: null, last: null, unitOnlyTrusted: environment.unitOnly?.trusted };
    store.listen = (e) => {
      if (!(e.target instanceof Element)) return;const form = store.form;
      const trusted = store.unitOnlyTrusted?.(e) ?? e.isTrusted === true;
      if (e.type === 'click' && store.expected?.contains(e.target)) { store.last = { trusted, type: 'click', control: store.expected.tagName, url: location.href };if (store.expected === store.opener) store.earlyEvents = []; }
      if (!form || !form.form.contains(e.target)) { const dialog = e.target.closest('[role="dialog"]');if (dialog && native(dialog) && dialog.querySelector('input[id="diff-settings-syntax-highlighting-toggle"]')) store.earlyEvents.push({ type: e.type, trusted });return; }
      const button = e.target.closest('button');const control = e.target === form.field ? 'syntax' : button === form.save ? 'save' : button === form.cancel ? 'cancel' : e.type === 'submit' && e.target === form.form ? 'form' : 'other';
      const event = { type: e.type, trusted, control, ...(control === 'syntax' ? { checked: form.field.checked } : {}), ...(e.type === 'submit' ? { sameForm: e.target === form.form, sameSubmitter: e.submitter === form.save } : {}) };
      store.events.push(event);
    };
    for (const type of ['click', 'input', 'change', 'submit']) document.addEventListener(type, store.listen, true);globalThis[KEY] = store;
  }
  if (!store) return null;
  const b = store.source;const sameScope = store.url === location.href && store.actor.node === a.node && store.actor.user === a.user && store.actor.workspace === a.workspace;
  const sameSemantic = JSON.stringify(s.rows.map((r) => r.semantic)) === JSON.stringify(b.rows.map((r) => r.semantic));
  const sameContainer = s.anchor === b.anchor && s.root === b.root && s.parent === b.parent && s.article === b.article && s.articleParent === b.articleParent && s.viewed === b.viewed && s.checked === b.checked && s.disabled === b.disabled && JSON.stringify(s.permalinkIds) === JSON.stringify(b.permalinkIds);
  const preserved = (baseline) => baseline !== null && s.groupNodes.length === baseline.groupNodes.length && s.groupNodes.every((n, i) => n === baseline.groupNodes[i]) && s.permalinkNodes.length === baseline.permalinkNodes.length && s.permalinkNodes.every((n, i) => n === baseline.permalinkNodes[i]) && s.rows.length === baseline.rows.length && s.rows.every((r, i) => { const old = baseline.rows[i];return r.row === old.row && r.code === old.code && r.font === old.font && JSON.stringify(r.render) === JSON.stringify(old.render) && r.spans.length === old.spans.length && r.spans.every((n, j) => n === old.spans[j]) && r.nodes.length === old.nodes.length && r.nodes.every((n, j) => n === old.nodes[j] && n.data === old.values[j]) && r.idNodes.length === old.idNodes.length && r.idNodes.every((n, j) => n === old.idNodes[j]) && r.linkNodes.length === old.linkNodes.length && r.linkNodes.every((n, j) => n === old.linkNodes[j]); });
  const offModel = classify(b.lineWitness, s.lineWitness, 'off');const lineModel = offModel.valid ? offModel : classify(b.lineWitness, s.lineWitness, 'on');const sameCodeCharacters = lineModel.valid;
  const stableNodes = preserved(store.expectedSource);const same = sameScope && sameCodeCharacters && sameContainer && (stableNodes || store.allowReplacement && lineModel.mode === store.saveTarget);const form = settings();
  if (action === 'bind') { if (!same || !form || store.earlyEvents.length || store.form?.dialog === form.dialog) return null;store.form = { ...form, id: `native-form-${++store.nextForm}` };store.events = [];store.last = null;return form.vector; }
  const sameForm = form !== null && store.form !== null && form.dialog === store.form.dialog && form.form === store.form.form && form.field === store.form.field && form.save === store.form.save && form.cancel === store.form.cancel && form.fields.every((f, i) => f === store.form.fields[i]);
  if (action === 'begin-native-save') {
    const allowed = same && sameForm && form.field.checked === target && store.events.length === 3 && store.events.every((e, i) => e.trusted && e.control === 'syntax' && e.type === ['click', 'input', 'change'][i] && e.checked === target);
    if (allowed) { store.allowReplacement = true;store.saveTarget = target ? 'on' : 'off'; }return allowed;
  }
  if (action === 'finish-native-restore') {
    if (!same || !sameForm || form.field.checked || store.events.length || lineModel.mode !== 'off') return null;store.expectedSource = s;store.allowReplacement = false;store.saveTarget = null;
  }
  if (action === 'ready-frames') {
    if (!same || !sameForm) return null;
    return new Promise((resolve) => { let frames = 0;let pending;const timeout = setTimeout(() => { cancelAnimationFrame(pending);resolve(null); }, 3000);
      const sample = () => { const current = syntaxOnProbe();if (!current?.same || !current.ready || current.events.length) { clearTimeout(timeout);resolve(null);return; }frames += 1;if (frames === 2) { clearTimeout(timeout);resolve({ frames, same: true, ready: true }); }else pending = requestAnimationFrame(sample); };pending = requestAnimationFrame(sample);
    });
  }
  if (action === 'event') return store.last;
  if (action === 'opener' || action === 'arm-opener') {
    const list = [...document.querySelectorAll('button[aria-live="polite"]')].filter((n) => n.textContent.trim() === 'Global diff settings' && !n.hasAttribute('aria-label') && !n.hasAttribute('aria-labelledby') && n.type === 'button' && n.tabIndex >= 0 && enabled(n) && visible(n) && n.closest('[role="tabpanel"]')?.id === 'pull-request-tabs-1-tab');const chosen = same && dialogs().length === 0 && list.length === 1 && (store.opener === null || store.opener === list[0]) ? list[0] : null;
    if (action === 'opener') { store.opener ??= chosen;return chosen; }store.expected = chosen;store.last = null;return chosen !== null && chosen === target;
  }
  if (action.startsWith('arm-')) { const kind = action.slice(4);const chosen = same && sameForm && ['syntax', 'save', 'cancel'].includes(kind) ? form[kind === 'syntax' ? 'field' : kind] : null;store.expected = chosen;store.last = null;return chosen !== null && chosen === target; }
  if (['syntax', 'save', 'cancel'].includes(action)) return same && sameForm ? form[action === 'syntax' ? 'field' : action] : null;
  if (action === 'hit') { if (target !== store.expected || !same || !native(target) || !enabled(target) || !visible(target)) return false;const r = target.getBoundingClientRect();return target.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }
  if (action === 'baseline-on') {
    const owned = [...CSS.highlights ?? []].filter(([key]) => key.startsWith('geld-bitbucket-shell-'));const ownedCount = owned.reduce((sum, [, ranges]) => sum + [...ranges].length, 0);
    if (!same || !sameForm || !form.field.checked || store.events.length || owned.length || lineModel.mode !== 'on') return null;store.on = s;store.foreign = [...CSS.highlights ?? []].map(([key, highlight]) => ({ key, highlight, ranges: [...highlight] }));
    store.expectedSource = s;store.allowReplacement = false;store.saveTarget = null;store.baselineEvidence = { origin: 'fresh-native-on-form-open', id: `native-on-${++store.nextBaseline}`, formId: store.form.id, formControls: form.fields.length, url: location.href, dialogs: dialogs().length, checked: form.field.checked, ownedCount, events: [...store.events], semanticRows: s.rows.map((r) => r.semantic), originalLines: b.lineWitness, renderedLines: s.lineWitness, lineModel, vector: form.vector };
  }
  const foreignPreserved = store.foreign.every((p) => CSS.highlights?.get(p.key) === p.highlight && [...p.highlight].length === p.ranges.length && [...p.highlight].every((range, i) => range === p.ranges[i]));
  return { same, sameScope, sameSemantic, sameCodeCharacters, lineModel, sameContainer, offPreserved: preserved(b), onBaseline: store.on !== null, onPreserved: preserved(store.on), dialogs: dialogs().length,
    ready: same && sameForm, formAvailable: same && form !== null && store.earlyEvents.length === 0, vector: sameForm ? form.vector : null, events: [...store.events], earlyEvents: [...store.earlyEvents], sourceRows: s.rows.length, semanticRows: s.rows.map((r) => r.semantic), originalLines: b.lineWitness, renderedLines: s.lineWitness, checked: sameForm ? form.field.checked : null, foreignPreserved, baselineEvidence: store.baselineEvidence,
    lifecycle: { originalCodeRows: s.rows.filter((r, i) => r.row === b.rows[i].row).length, originalTextNodes: s.rows.reduce((sum, r, i) => sum + r.nodes.filter((n) => b.rows[i].nodes.includes(n)).length, 0) } };
}


export function classifySyntaxOnLines(original, current, mode) { return syntaxOnProbe('classify-native-lines', { original, current, mode }); }
