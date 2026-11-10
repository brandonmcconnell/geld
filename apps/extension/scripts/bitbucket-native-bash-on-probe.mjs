/** Native references only. Original controls are operated through trusted browser handles. */
export function nativeBashOnProbe(action = 'read', target = null, fixture = null, environment = {}) {
  const KEY = '__geldNativeBashOn';let store = globalThis[KEY];
  const source = fixture ?? store?.fixture;if (!source) return null;
  const native = (n) => n !== null && n.isConnected && n.closest('[data-geld-ui],[data-testid="comment"],[data-qa="pr-activity"],[data-qa="pull-request-description"]') === null;
  const visible = (n) => {
    if (!native(n) || n.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let p = n; p; p = p.parentElement) { const s = getComputedStyle(p);if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.contentVisibility === 'hidden' || s.opacity === '0' && !(p === n && n.type === 'checkbox')) return false; }
    const r = n.getBoundingClientRect();return r.width > 0 && r.height > 0;
  };
  const enabled = (n) => native(n) && !n.disabled && !n.readOnly && !n.closest('[aria-disabled="true"],[aria-readonly="true"],fieldset[disabled]');
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const actor = () => {
    const nodes = [...document.head.querySelectorAll('meta#bb-bootstrap[data-current-user][data-target-workspace-uuid]')].filter(native);if (nodes.length !== 1) return null;
    const node = nodes[0];const bytes = node.getAttribute('data-current-user');const workspace = node.getAttribute('data-target-workspace-uuid');
    try { if (!bytes || bytes.length > 16384 || JSON.parse(bytes)?.isAuthenticated !== false || !workspace) return null; } catch { return null; }
    return { node, bytes, workspace };
  };
  const currentURL = () => { const u = new URL(location.href);const e = new URL(source.url);return u.origin === e.origin && u.pathname === e.pathname && !u.search && !u.username && !u.password; };
  const readSource = () => {
    if (!currentURL()) return null;
    const regions = [...document.querySelectorAll('[role="region"][aria-label="Diff"]')].filter(native);if (regions.length !== 1) return null;
    const anchors = [...regions[0].querySelectorAll(':scope > div > div[id]')].filter((n) => native(n) && n.id === `chg-${source.path}`);if (anchors.length !== 1) return null;
    const anchor = anchors[0];const root = anchor.parentElement;const articles = [...root.querySelectorAll('article[data-qa="branch-diff-file"]')].filter(native);if (articles.length !== 1) return null;const article = articles[0];
    if (article.querySelector('h2[data-qa="bk-filepath"]')?.textContent.trim() !== source.path) return null;
    const header = article.querySelector('[data-qa="bk-file__header"][data-testid="file-header"]');if (!native(header)) return null;
    const viewed = [...header.querySelectorAll('label')].filter((n) => n.textContent.trim() === 'Viewed').map((n) => n.querySelector('input[type="checkbox"]'));if (viewed.length > 1 || viewed.length === 1 && !native(viewed[0]) || viewed.length === 0 && header.querySelector('input[type="checkbox"]') !== null) return null;
    const rows = [...article.querySelectorAll('[data-qa="code-line"]')].filter(native);if (!rows.length || rows.length > 500) return null;
    const groups = [];const records = [];let total = 0;
    for (const row of rows) {
      const code = row.querySelector('[data-line-type]');const numbers = [...row.querySelectorAll('[data-key="code-line-number"]')];const group = row.closest('[role="rowgroup"]');
      if (!native(code) || code.tagName !== 'SPAN' || code.getAttribute('role') !== 'gridcell' || numbers.length !== 1 || !native(group) || !article.contains(group) || ![' ', '+', '-'].includes(code.getAttribute('data-line-type')) || code.querySelector('a,button,input,textarea,select,[contenteditable]')) return null;
      if (!groups.includes(group)) groups.push(group);if (groups.at(-1) !== group) return null;
      const old = numbers[0].getAttribute('data-old-line-number');const next = numbers[0].getAttribute('data-new-line-number');if (![old, next].every((n) => n === null || /^[1-9]\d*$/.test(n)) || old === null && next === null) return null;
      if(code.children.length!==1||code.firstElementChild.tagName!=='SPAN'||[...code.childNodes].some((n)=>n.nodeType===3&&n.data!==''))return null;
      const nodes = [];const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);for (let n = w.nextNode(); n; n = w.nextNode()) { if (++total > 4000) return null;nodes.push(n); }
      const spans = [...code.querySelectorAll('*')];if (spans.length > 80 || spans.some((n) => n.tagName !== 'SPAN' || [...n.attributes].some((a) => a.name !== 'class'))) return null;
      records.push({ row, code, nodes, values: nodes.map((n) => n.data), spans, spanClasses: spans.map((n) => n.className), spanFonts:spans.map((n)=>getComputedStyle(n).font), group: groups.indexOf(group), kind: code.getAttribute('data-line-type'), old, next, raw: code.textContent, aria: code.getAttribute('aria-label'), attrs: [...code.attributes].map((a) => [a.name, a.value]), font:getComputedStyle(code).font, ids: [...(row.hasAttribute('id')?[row]:[]),...row.querySelectorAll('[id]')].map((n) => [n, n.id]), links: [...row.querySelectorAll('a[href]')].map((n) => [n, n.getAttribute('href'), n.getAttribute('aria-label')]) });
    }
    const plain = records.every((r) => !/[\r\n]/.test(r.raw));
    // Observe this file's complete group pattern; PR/YAML row counts and token classes are not authority here.
    const delimited = !plain && records.every((r, i) => r.raw.endsWith('\n') === (records[i + 1]?.group === r.group) && !/[\r\n]/.test(r.raw.endsWith('\n') ? r.raw.slice(0, -1) : r.raw));
    if (!plain && !delimited) return null;
    for (const r of records) r.text = delimited && r.raw.endsWith('\n') ? r.raw.slice(0, -1) : r.raw;
    for (const expected of source.sourceSamples) { const matches = records.filter((r) => r.next === String(expected.line) && [' ', '+'].includes(r.kind));if (matches.length !== 1 || matches[0].text !== expected.text) return null; }
    const counters = [...regions[0].querySelectorAll(':scope > div > div > h2')].filter((n) => native(n) && /^[\d,]+ files?$/.test(n.textContent.trim()));
    const tabs = [...document.querySelectorAll('[data-testid="sidebar-tab-files"][role="tab"]')].filter(native);
    if (!counters.length && !tabs.length || counters.some((n)=>Number(n.textContent.trim().split(' ')[0].replaceAll(',',''))!==8) || tabs.some((n)=>n.textContent.trim()!=='Files8')) return null;
    const counts = [...counters, ...tabs].map((node) => ({ node, text: node.textContent, attrs: [...node.attributes].map((a) => [a.name, a.value]) }));
    return { anchor, root, parent: root.parentElement, article, articleParent: article.parentElement, header, viewed: viewed[0]??null, checked: viewed[0]?.checked??null, disabled: viewed[0]?.disabled??null, groups, records, counts, delimiter: delimited ? 'observed-native-rowgroup-single-lf' : 'none' };
  };
  const cookieNotices = () => [...document.querySelectorAll('[role="dialog"][aria-labelledby="cookiesTrackingNoticeLink"]')].filter((n) => native(n) && n.querySelector('input,select,textarea,form') === null && n.querySelector('a[id="cookiesTrackingNoticeLink"][href="https://www.atlassian.com/legal/cookies"]') !== null);
  const dialogs = () => { const passive = cookieNotices();return [...document.querySelectorAll('[role="dialog"]')].filter((n) => native(n) && !passive.includes(n)); };
  const formRead = () => {
    const ds = dialogs();const diagnostics = { dialogs: ds.length, fields: [] };
    const inspection = action === 'diagnose-form' ? { recognized: false, firstRefusal: null, checks: { dialogCount: ds.length, presentationEligible: null, heading: null, formCount: null, containment: null, enabled: null, shape: null, tab: null, radios: null, labels: null, syntaxLabel: null, buttons: null } } : null;
    if (inspection) diagnostics.inspection = inspection;
    const refuse = (reason) => { if (inspection) inspection.firstRefusal = reason;return { form: null, diagnostics }; };
    if (inspection && ds.length === 1) inspection.checks.presentationEligible = visible(ds[0]);
    if (ds.length !== 1 || !visible(ds[0])) return refuse(ds.length !== 1 ? 'dialog_count' : 'dialog_presentation');
    const dialog = ds[0];const controls = [...dialog.querySelectorAll('input,select,textarea')];
    const safe = (s) => /^[a-zA-Z0-9_-]{0,80}$/.test(s ?? '') ? s : '[omitted]';
    Object.assign(diagnostics, { fieldCount: controls.length, fields: controls.slice(0, 40).map((f) => ({ id: safe(f.id), name: safe(f.name), type: safe(f.type) })), truncated: controls.length > 40 });
    const title = document.getElementById(dialog.getAttribute('aria-labelledby'));const forms = [...dialog.querySelectorAll('form')];
    const phrase = (text) => text === 'Global diff view settings' ? 'global_diff_view_settings' : text === 'Global diff settings' ? 'global_diff_settings' : text === 'Save' ? 'save' : text === 'Cancel' ? 'cancel' : 'unknown';
    if (inspection) { inspection.checks.heading = { present: title !== null, contained: title !== null && dialog.contains(title), phrase: title === null ? 'missing' : phrase(title.textContent.trim()), requiredPhrase: title !== null && title.textContent.trim() === 'Global diff view settings' };inspection.checks.formCount = forms.length; }
    if (!title || !dialog.contains(title) || title.textContent.trim() !== 'Global diff view settings' || forms.length !== 1) return refuse(!title ? 'title_missing' : !dialog.contains(title) ? 'title_outside_dialog' : title.textContent.trim() !== 'Global diff view settings' ? 'title_phrase' : 'form_count');
    const form = forms[0];const fields = [...form.querySelectorAll('input,select,textarea')];
    if (inspection) { inspection.checks.containment = { dialogFieldCount: controls.length, formFieldCount: fields.length, equal: fields.length === controls.length };inspection.checks.enabled = fields.slice(0, 40).map((f, index) => ({ index, native: native(f), disabled: f.disabled === true, readOnly: f.readOnly === true, ariaBlocked: f.closest('[aria-disabled="true"],[aria-readonly="true"]') !== null, fieldsetBlocked: f.closest('fieldset[disabled]') !== null, enabled: enabled(f) })); }
    if (fields.length !== controls.length || fields.some((f) => !native(f) || !enabled(f))) return refuse(fields.length !== controls.length ? 'controls_outside_form' : 'field_not_native_or_enabled');
    const expected = [
      ['', 'diffViewMode', 'radio', 'UNIFIED'], ['', 'diffViewMode', 'radio', 'SIDE_BY_SIDE'],
      ['diff-settings-syntax-highlighting-toggle', 'enableSyntaxHighlighting', 'checkbox', 'enableSyntaxHighlighting'],
      ['diff-settings-ignore-whitespace-toggle', 'shouldIgnoreWhitespace', 'checkbox', 'shouldIgnoreWhitespace'],
      ['diff-settings-word-diff-toggle', 'enableWordDiff', 'checkbox', 'enableWordDiff'],
      ['diff-settings-color-blind-mode-toggle', 'enableColorBlindMode', 'checkbox', 'enableColorBlindMode'],
      ['diff-settings-annotations-toggle', 'enableAnnotations', 'checkbox', 'enableAnnotations'],
      ['', 'isSingleFileModeEnabled', 'radio', 'ALL_FILES_MODE'], ['', 'isSingleFileModeEnabled', 'radio', 'SINGLE_FILE_MODE'],
      ['tab-size-pref', '', 'text', null], ['', 'tabSize', 'hidden', null], ['', 'fileViewMode', 'radio', 'TREE'], ['', 'fileViewMode', 'radio', 'LIST'],
    ];
    const without = expected.filter((f) => f[1] !== 'enableAnnotations');
    if (inspection) {
      const families = [expected, without];const structural = families.find((family) => family.length === fields.length && fields.every((f, i) => f.id === family[i][0] && f.name === family[i][1] && f.type === family[i][2]));
      inspection.checks.shape = families.map((family) => ({ family: family.length === 13 ? 'standalone_13' : 'standalone_12', countMatches: fields.length === family.length, fields: fields.slice(0, 40).map((f, index) => ({ index, idMatches: family[index] !== undefined && f.id === family[index][0], nameMatches: family[index] !== undefined && f.name === family[index][1], typeMatches: family[index] !== undefined && f.type === family[index][2], enumValueMatches: null })) }));
      if (structural === undefined) return refuse('shape_mismatch');
    }
    const shape = fields.map((f) => [f.id, f.name, f.type, ['radio', 'checkbox'].includes(f.type) ? f.value : null]);
    if (inspection) for (const entry of inspection.checks.shape) { const family = entry.family === 'standalone_13' ? expected : without;if (entry.countMatches && fields.every((f, i) => f.id === family[i][0] && f.name === family[i][1] && f.type === family[i][2])) for (const check of entry.fields) check.enumValueMatches = ['radio', 'checkbox'].includes(fields[check.index].type) ? shape[check.index][3] === family[check.index][3] : null; }
    const annotations = equal(shape, expected);if (!annotations && !equal(shape, without)) return refuse('shape_mismatch');
    const tabValue = (v) => v === '' || /^(?:[1-9]\d?|100)$/.test(v);
    if (inspection) inspection.checks.tab = [];
    if (fields.some((f, index) => { if (!['hidden', 'text'].includes(f.type)) return false;const valid = tabValue(f.value);if (inspection) inspection.checks.tab.push({ index, valid });return !valid; })) return refuse('tab_value');
    for (const name of ['diffViewMode', 'isSingleFileModeEnabled', 'fileViewMode']) {
      const count = fields.filter((f) => f.name === name && f.checked).length;if (inspection) (inspection.checks.radios ??= []).push({ group: name === 'diffViewMode' ? 'diff_view' : name === 'isSingleFileModeEnabled' ? 'file_mode' : 'file_view', selectedCount: count });
      if (count !== 1) return refuse('radio_selection_count');
    }
    const labels={enableSyntaxHighlighting:'Syntax highlighting',shouldIgnoreWhitespace:'Whitespace changes',enableWordDiff:'Word diff',enableColorBlindMode:'Color accessibility',enableAnnotations:'Annotations'};
    if (inspection) inspection.checks.labels = fields.flatMap((f, index) => f.type === 'checkbox' ? [{ index, labelCount: [...f.labels ?? []].length, exactMatchCount: [...f.labels ?? []].filter((l) => l.textContent.trim() === labels[f.name]).length, visibleMatchCount: [...f.labels ?? []].filter((l) => l.textContent.trim() === labels[f.name] && visible(l)).length }] : []);
    if(fields.some((f)=>f.type==='checkbox'&&![...f.labels??[]].some((l)=>l.textContent.trim()===labels[f.name]&&visible(l))))return refuse('checkbox_label');
    const field = fields.find((f) => f.id === 'diff-settings-syntax-highlighting-toggle');
    if (inspection) inspection.checks.syntaxLabel = [...field.labels ?? []].some((l) => l.textContent.trim() === 'Syntax highlighting' && visible(l));
    if (![...field.labels ?? []].some((l) => l.textContent.trim() === 'Syntax highlighting' && visible(l))) return refuse('syntax_label');
    const buttons = [...form.querySelectorAll('button')].filter(native);const saves = buttons.filter((b) => b.type === 'submit' && b.textContent.trim() === 'Save' && enabled(b) && visible(b));const cancels = buttons.filter((b) => b.type === 'button' && b.textContent.trim() === 'Cancel' && enabled(b) && visible(b));
    if (inspection) inspection.checks.buttons = { count: buttons.length, saveCount: saves.length, cancelCount: cancels.length, controls: buttons.slice(0, 40).map((b, index) => ({ index, type: ['submit', 'button', 'reset'].includes(b.type) ? b.type : 'unknown', phrase: phrase(b.textContent.trim()), native: native(b), enabled: enabled(b), visible: visible(b) })) };
    if (buttons.length !== 2 || saves.length !== 1 || cancels.length !== 1) return refuse(buttons.length !== 2 ? 'button_count' : saves.length !== 1 ? 'save_count' : 'cancel_count');
    if (inspection) inspection.recognized = true;
    const vector = fields.map((f) => ({ id: f.id, name: f.name, type: f.type, value: f.value, checked: f.checked, disabled: f.disabled, readOnly: f.readOnly }));
    return { form: { dialog, form, fields, field, save: saves[0], cancel: cancels[0], vector, candidate: annotations ? 'source-backed-standalone-13' : 'source-backed-standalone-12-without-annotations' }, diagnostics };
  };
  if (action === 'cleanup') { if (store) for (const type of ['click', 'input', 'change', 'submit']) document.removeEventListener(type, store.listen, true);delete globalThis[KEY];return null; }
  const a = actor();const s = readSource();
  if (action === 'setup') {
    if (store || !a || !s || dialogs().length) return null;
    store = { fixture: source, url: location.href, theme:[document.documentElement.getAttribute('data-color-mode'),document.documentElement.getAttribute('data-theme')], actor: a, original: s, expectedSource: s, cookieNotices: cookieNotices().map((node)=>({node,parent:node.parentElement})), saveArm: null, transition: null, baseline: null, form: null, opener: null, events: [], early: [], expected: null, last: null, trust: environment.unitOnly?.trusted };
    store.listen = (e) => {
      if (!(e.target instanceof Element)) return;const f = store.form;const trusted = store.trust?.(e) ?? e.isTrusted === true;
      if (e.type === 'click' && store.expected?.contains(e.target)) store.last = { trusted, url: location.href, type: e.type };
      if (!f || !f.form.contains(e.target)) { if (e.target.closest('[role="dialog"]')) store.early.push({ type: e.type, trusted });return; }
      const b = e.target.closest('button');const control = e.target === f.field ? 'syntax' : b === f.save ? 'save' : b === f.cancel ? 'cancel' : e.type === 'submit' && e.target === f.form ? 'form' : 'other';
      store.events.push({ type: e.type, trusted, control, ...(control === 'syntax' ? { checked: f.field.checked } : {}), ...(e.type === 'submit' ? { sameForm: e.target === f.form, sameSubmitter: e.submitter === f.save } : {}) });
      if(e.type==='submit'&&control==='form'&&store.saveArm!==null&&store.transition===null){
        const arm=store.saveArm;const expectedEvents=[['click','syntax'],['input','syntax'],['change','syntax'],['click','save'],['submit','form']];
        const sequence=store.events.length===5&&store.events.every((v,i)=>v.trusted&&v.type===expectedEvents[i][0]&&v.control===expectedEvents[i][1]&&(i>=3||v.checked===arm.target));
        const snapshot=nativeBashOnProbe();
        if(sequence&&e.submitter===f.save&&store.expected===f.save&&arm.form===f.form&&snapshot?.same&&snapshot.stable&&snapshot.ready&&equal(snapshot.vector,arm.vector))store.transition={target:arm.target,vector:arm.vector,authorization:'trusted-original-native-save-submit'};
      }
    };
    for (const type of ['click', 'input', 'change', 'submit']) document.addEventListener(type, store.listen, true);globalThis[KEY] = store;
  }
  if (!store || !a || !s) return null;
  const base = store.original;const expected = store.expectedSource;
  const sameSemantic = equal(s.records.map((r) => [r.old, r.next, r.kind, r.text, r.aria, r.group, r.ids.map(([, id]) => id), r.links.map(([, href, label]) => [href, label])]), base.records.map((r) => [r.old, r.next, r.kind, r.text, r.aria, r.group, r.ids.map(([, id]) => id), r.links.map(([, href, label]) => [href, label])]));
  const sameOwner = s.anchor === base.anchor && s.root === base.root && s.parent === base.parent && s.article === base.article && s.articleParent === base.articleParent && s.header === base.header && s.viewed === base.viewed && s.checked === base.checked && s.disabled === base.disabled
    && s.counts.length === base.counts.length && s.counts.every((r, i) => r.node === base.counts[i].node && r.text === base.counts[i].text && equal(r.attrs, base.counts[i].attrs));
  const stable = s.groups.length === expected.groups.length && s.groups.every((n,i)=>n===expected.groups[i]) && s.records.length === expected.records.length && s.records.every((r, i) => {
    const old = expected.records[i];return r.row === old.row && r.code === old.code && r.font === old.font && r.raw === old.raw && equal(r.attrs, old.attrs) && equal(r.spanClasses, old.spanClasses) && equal(r.spanFonts,old.spanFonts)
      && r.ids.length===old.ids.length&&r.ids.every(([n],j)=>n===old.ids[j][0])&&r.links.length===old.links.length&&r.links.every(([n],j)=>n===old.links[j][0])
      && r.spans.length === old.spans.length && r.spans.every((n, j) => n === old.spans[j]) && r.nodes.length === old.nodes.length && r.nodes.every((n, j) => n === old.nodes[j] && n.data === old.values[j]);
  });
  const cookies = cookieNotices();const sameCookies = cookies.length === store.cookieNotices.length && cookies.every((node,i)=>node===store.cookieNotices[i].node&&node.parentElement===store.cookieNotices[i].parent);
  const same = sameCookies && equal(store.theme,[document.documentElement.getAttribute('data-color-mode'),document.documentElement.getAttribute('data-theme')]) && currentURL() && location.href === store.url && a.node === store.actor.node && a.bytes === store.actor.bytes && a.workspace === store.actor.workspace && sameOwner && sameSemantic && (stable || store.transition!==null);
  let state;
  if (action === 'diagnose-form') { try { state = formRead(); } catch { state = { form: null, diagnostics: { inspection: { recognized: false, firstRefusal: 'inspection_unavailable', checks: null } } }; } }else state = formRead();
  const f = state.form;
  const sameForm = f !== null && store.form !== null && f.dialog === store.form.dialog && f.form === store.form.form && f.field === store.form.field && f.save === store.form.save && f.cancel === store.form.cancel && f.fields.length===store.form.fields.length&&f.fields.every((n, i) => n === store.form.fields[i]);
  const canSave=same&&stable&&sameForm&&store.transition===null&&store.saveArm!==null&&store.saveArm.form===f.form&&equal(f.vector,store.saveArm.vector)&&store.events.length===3&&store.events.every((e,i)=>e.trusted&&e.control==='syntax'&&e.type===['click','input','change'][i]&&e.checked===store.saveArm.target);
  if (action === 'bind') {
    if (!same || !f || store.early.length || store.form?.dialog === f.dialog || store.transition!==null&&!equal(f.vector,store.transition.vector)) return null;
    store.form = f;store.saveArm=null;store.events = [];store.last = null;return { vector: f.vector, candidate: f.candidate };
  }
  if (action === 'begin-save') {
    const allowed = same && stable && store.transition===null && sameForm && f.field.checked === target && equal(f.vector,store.form.vector.map((v)=>v.id==='diff-settings-syntax-highlighting-toggle'?{...v,checked:target}:v))
      && equal(store.events.map((e) => [e.type, e.control, e.trusted, e.checked]), ['click', 'input', 'change'].map((type) => [type, 'syntax', true, target]));
    if (allowed) store.saveArm={target,form:f.form,vector:f.vector};return allowed;
  }
  const own = () => typeof CSS !== 'undefined' && CSS.highlights ? [...CSS.highlights.keys()].filter((n) => n.startsWith('geld-')) : [];
  const highlights = () => typeof CSS === 'undefined' || !CSS.highlights ? [] : [...CSS.highlights].map(([name, value]) => ({ name, value, ranges: [...value].map((range)=>({range,startContainer:range.startContainer,startOffset:range.startOffset,endContainer:range.endContainer,endOffset:range.endOffset})), priority:value.priority??null,type:value.type??null }));
  const foreignPreserved = !store.baseline || typeof CSS !== 'undefined' && CSS.highlights && equal([...CSS.highlights.keys()].filter((n)=>!n.startsWith('geld-')),store.baseline.foreign.map((b)=>b.name)) && store.baseline.foreign.every((b) => {
    if (CSS.highlights.get(b.name)!==b.value||(b.value.priority??null)!==b.priority||(b.value.type??null)!==b.type)return false;
    const current=[...b.value];return current.length===b.ranges.length&&current.every((range,i)=>{const before=b.ranges[i];return range===before.range&&range.startContainer===before.startContainer&&range.startOffset===before.startOffset&&range.endContainer===before.endContainer&&range.endOffset===before.endOffset;});
  });
  if (action === 'diagnose-form') return { same, sameSemantic, sameOwner, stable, url: location.href, rows: s.records.length, ownedHighlightCount: own().length, ownedUiCount: s.root.querySelectorAll('[data-geld-ui]').length, counts: s.counts.map((r) => r.text), viewedAvailable: s.viewed !== null, forbiddenEventCount: store.events.length + store.early.length, openerEvent: store.expected === store.opener?.node && store.last?.type === 'click' && store.last.url === store.url ? { trusted: store.last.trusted, type: 'click', url: store.url } : null, inspection: state.diagnostics.inspection };
  if (action === 'baseline') {
    if (!same || !sameForm || store.events.length || store.early.length || own().length) return null;
    if(store.transition!==null&&!equal(f.vector,store.transition.vector))return null;
    const formatterTransition={authorization:store.transition?.authorization??'none',target:store.transition?.target??null,groupNodesReplaced:s.groups.filter((n,i)=>n!==expected.groups[i]).length,rowNodesReplaced:s.records.filter((r,i)=>r.row!==expected.records[i]?.row).length,codeNodesReplaced:s.records.filter((r,i)=>r.code!==expected.records[i]?.code).length,idNodesReplaced:s.records.reduce((sum,r,i)=>sum+r.ids.filter(([n],j)=>n!==expected.records[i]?.ids[j]?.[0]).length,0),linkNodesReplaced:s.records.reduce((sum,r,i)=>sum+r.links.filter(([n],j)=>n!==expected.records[i]?.links[j]?.[0]).length,0)};
    store.expectedSource = s;store.transition=null;store.saveArm=null;store.baseline = { foreign: highlights() };return { same: true, formatterTransition,candidate: f.candidate, delimiter: s.delimiter, rows: s.records.length, theme: {colorMode:document.documentElement.getAttribute('data-color-mode'),theme:document.documentElement.getAttribute('data-theme')}, sourceSamples: source.sourceSamples.map((sample) => ({ ...sample, text: s.records.find((r) => r.next === String(sample.line)).raw })) };
  }
  if (action === 'events') return [...store.events];
  if (action === 'event') return store.last;
  if (action === 'opener' || action === 'arm-opener') {
    const nodes = [...document.querySelectorAll('button[data-testid="settingsButton"][aria-label="Open modal window: diff display settings"][type="button"]')].filter((n) => native(n) && visible(n) && enabled(n) && n.tabIndex >= 0 && n.textContent.trim() === 'Settings' && n.closest('[role="main"]') !== null && n.closest('[role="group"]') !== null);
    const selected = same && dialogs().length === 0 && nodes.length === 1 && (!store.opener || store.opener.node === nodes[0] && store.opener.parent === nodes[0].parentElement) ? nodes[0] : null;
    if (action === 'opener') { if (!store.opener && selected) store.opener = { node: selected, parent: selected.parentElement };return selected; }store.expected = selected;store.last = null;store.early = [];return selected !== null && selected === target;
  }
  if (['syntax', 'save', 'cancel'].includes(action)) return same && sameForm && (action!=='save'||canSave) ? f[action === 'syntax' ? 'field' : action] : null;
  if (action.startsWith('arm-')) { const kind = action.slice(4);const selected = same && sameForm && ['syntax', 'save', 'cancel'].includes(kind) && (kind!=='save'||canSave) ? f[kind === 'syntax' ? 'field' : kind] : null;store.expected = selected;store.last = null;return selected !== null && selected === target; }
  if (action === 'hit') { if (!same || target !== store.expected || !visible(target) || !enabled(target) || target===f?.save&&!canSave) return false;const r = target.getBoundingClientRect();return target.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }
  if (action === 'ready-frames') return new Promise((resolve) => { let frames = 0;let pending;const timeout = setTimeout(() => { cancelAnimationFrame(pending);resolve(null); }, 3000);const sample = () => { const v = nativeBashOnProbe();if (!v?.same || !v.ready || v.events.length) { clearTimeout(timeout);resolve(null);return; }if (++frames === 2) { clearTimeout(timeout);resolve({ frames }); }else pending = requestAnimationFrame(sample); };pending = requestAnimationFrame(sample); });
  return { same, sameSemantic, sameOwner, stable, formatterTransition:store.transition===null?null:{authorization:store.transition.authorization,target:store.transition.target},saveArmed:store.saveArm!==null,foreignPreserved, url: location.href, rows: s.records.length, delimiter: s.delimiter, ready: same && sameForm, dialogs: dialogs().length, formAvailable: f !== null, candidate: f?.candidate ?? null, vector: f?.vector ?? null, diagnostics: state.diagnostics, events: [...store.events], earlyEvents: [...store.early], ownedHighlights: own(), ownedUi: s.root.querySelectorAll('[data-geld-ui]').length, samples: source.sourceSamples.map((sample) => ({ line: sample.line, raw: s.records.find((r) => r.next === String(sample.line)).raw })), counts: s.counts.map((r) => r.text), viewed: { available:s.viewed!==null, checked: s.checked, disabled: s.disabled } };
}
