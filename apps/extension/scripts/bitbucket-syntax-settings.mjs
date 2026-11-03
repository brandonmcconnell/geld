import assert from 'node:assert/strict';

/** Read original native controls/source only; the store holds identity/event evidence, never app state. */
export function bitbucketSyntaxSettingsProbe(action = 'read', target = null) {
  const KEY = '__geldBitbucketSyntaxSettings';
  let store = globalThis[KEY];
  const native = (node) => node !== null && node.closest('[data-geld-ui], [data-testid="comment"], [data-qa="pr-activity"]') === null;
  const visible = (node) => {
    if (!node?.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let p = node; p !== null; p = p.parentElement) { const s = getComputedStyle(p);if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.opacity === '0' || s.contentVisibility === 'hidden') return false; }
    const r = node.getBoundingClientRect();return r.width > 0 && r.height > 0;
  };
  const textNodes = (node, limit) => { const result = [];const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);for (let n = w.nextNode(); n !== null; n = w.nextNode()) { if (result.length >= limit) return null;result.push(n); }return result; };
  const rows = (article) => {
    const candidates = [...article.querySelectorAll('[data-qa="code-line"]')].filter(native);
    if (candidates.length > 500) return null;
    const result = [];let remaining = 4000;
    for (const node of candidates) {
      const code = node.querySelector('[data-line-type]');if (code === null || !native(code)) continue;
      const nodes = textNodes(code, remaining);if (nodes === null) return null;remaining -= nodes.length;
      result.push({ node, code, text: code.textContent, nodes, numbers: [...node.querySelectorAll('[data-key="code-line-number"]')].map((n) => [n.getAttribute('data-old-line-number'), n.getAttribute('data-new-line-number')]), ids: [...node.querySelectorAll('[id]')].map((n) => [n, n.id]), links: [...node.querySelectorAll('a[href]')].map((n) => [n, n.getAttribute('href')]) });
    }
    return result;
  };
  const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter((n) => native(n) && visible(n));
  if (action === 'cleanup') { if (store) for (const type of ['click', 'input', 'change', 'submit', 'keydown']) document.removeEventListener(type, store.listen, true);delete globalThis[KEY];return null; }
  if (action === 'setup') {
    if (store) throw new Error('Native settings identity observation already exists');
    const anchor = document.getElementById('chg-bitbucket-pipelines.yml');const root = anchor?.parentElement;
    if (!native(anchor) || root === null || root === undefined || location.href !== 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff') return null;
    const articles = [...root.querySelectorAll('article[data-qa="branch-diff-file"]')].filter(native);if (articles.length !== 1) return null;
    const article = articles[0];const sourceRows = rows(article);if (sourceRows === null || sourceRows.length === 0) return null;
    store = { url: location.href, root, parent: root.parentElement, anchor, article, articleParent: article.parentElement, rows: sourceRows.map((r) => ({ ...r, nodeTexts: r.nodes.map((n) => n.data) })), viewed: [...root.querySelectorAll('input[type="checkbox"]')].map((n) => [n, n.checked]), events: [], expected: null, lastClick: null, dialog: null, form: null };
    store.listen = (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.type === 'click' && store.expected?.contains(event.target)) store.lastClick = { trusted: event.isTrusted, url: location.href, control: { tag: store.expected.tagName, type: store.expected.getAttribute('type'), text: store.expected.textContent.trim(), ariaLabel: store.expected.getAttribute('aria-label') } };
      if (['input', 'change'].includes(event.type) && store.dialog?.contains(event.target)) store.events.push({ type: event.type, trusted: event.isTrusted, id: event.target.id });
      if (event.type === 'submit' && event.target === store.form) store.events.push({ type: 'submit', trusted: event.isTrusted });
      if (event.type === 'keydown' && event.key === 'Escape' && store.dialog?.isConnected) store.lastEscape = { trusted: event.isTrusted, url: location.href };
    };
    for (const type of ['click', 'input', 'change', 'submit', 'keydown']) document.addEventListener(type, store.listen, true);
    globalThis[KEY] = store;
  }
  if (!store) return null;
  const currentRows = rows(store.article);
  const currentArticles = [...store.root.querySelectorAll('article[data-qa="branch-diff-file"]')].filter(native);
  const currentViewed = [...store.root.querySelectorAll('input[type="checkbox"]')];
  const sameSource = currentRows !== null && location.href === store.url && store.root.isConnected && store.root.parentElement === store.parent && store.anchor.parentElement === store.root && store.anchor.id === 'chg-bitbucket-pipelines.yml'
    && store.article.isConnected && store.article.parentElement === store.articleParent && currentArticles.length === 1 && currentArticles[0] === store.article
    && currentRows.length === store.rows.length && currentRows.every((r, i) => {
      const b = store.rows[i];return r.node === b.node && r.code === b.code && r.text === b.text && JSON.stringify(r.numbers) === JSON.stringify(b.numbers) && r.nodes.length === b.nodes.length && r.nodes.every((n, j) => n === b.nodes[j] && n.data === b.nodeTexts[j])
        && r.ids.length === b.ids.length && r.ids.every(([n, id], j) => n === b.ids[j][0] && id === b.ids[j][1]) && r.links.length === b.links.length && r.links.every(([n, href], j) => n === b.links[j][0] && href === b.links[j][1]);
    }) && currentViewed.length === store.viewed.length && store.viewed.every(([n, checked], i) => n === currentViewed[i] && n.isConnected && n.checked === checked);
  if (action === 'arm') { store.expected = target;store.lastClick = null;return sameSource; }
  if (action === 'click-result') return store.lastClick;
  if (action === 'escape-result') return store.lastEscape ?? null;
  if (action === 'opener' || action === 'opener-hit') {
    if (!sameSource || !native(target) || target.tagName !== 'BUTTON' || target.closest('[role="tabpanel"]')?.id !== 'pull-request-tabs-1-tab' || !visible(target) || target.disabled || target.getAttribute('aria-disabled') === 'true') return false;
    if (action === 'opener') return true;
    const r = target.getBoundingClientRect();const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);return hit !== null && target.contains(hit);
  }
  const opened = dialogs();store.dialog = opened.length === 1 ? opened[0] : null;
  const fields = store.dialog === null ? [] : [...store.dialog.querySelectorAll('input[id="diff-settings-syntax-highlighting-toggle"]')].filter(native);
  const field = fields.length === 1 ? fields[0] : null;
  store.form = field?.closest('form') ?? null;
  const label = field === null ? '' : [...(field.labels ?? [])].map((n) => n.textContent.trim()).join(' ');
  const fieldKnown = field !== null && field.type === 'checkbox' && field.name === 'enableSyntaxHighlighting' && label === 'Syntax highlighting' && store.form !== null
    && field.closest('[hidden],[inert],[aria-hidden="true"]') === null && [...(field.labels ?? [])].some(visible) && !field.disabled;
  const cancels = store.dialog === null ? [] : [...store.dialog.querySelectorAll('button')].filter((n) => native(n) && n.textContent.trim() === 'Cancel' && n.type === 'button' && !n.disabled && n.getAttribute('aria-disabled') !== 'true' && visible(n));
  if (action === 'cancel') return sameSource && cancels.length === 1 ? cancels[0] : null;
  const preferenceFields = store.dialog === null ? [] : [...store.dialog.querySelectorAll('input,select')].filter((n) => native(n) && !['hidden', 'password', 'file'].includes(n.type)
    && n.closest('[hidden],[inert],[aria-hidden="true"]') === null && (visible(n) || [...(n.labels ?? [])].some(visible)));
  const preferences = preferenceFields.slice(0, 40).map((n) => ({ id: n.id, name: n.name, type: n.type, value: n.value, checked: 'checked' in n ? n.checked : null, disabled: n.disabled }));
  return { url: location.href, sameSource, sourceRows: currentRows?.length ?? null, viewed: store.viewed.map(([n]) => n.checked), dialogCount: opened.length, ready: fieldKnown && preferenceFields.length <= 40, checkbox: field === null ? null : { id: field.id, name: field.name, type: field.type, checked: field.checked, disabled: field.disabled, label }, preferences, preferencesTruncated: preferenceFields.length > 40, events: [...store.events], cancelAvailable: cancels.length === 1 };
}

/** Optional native preference evidence; cleanup/source/write failures are mandatory failures. */
export async function observeBitbucketSyntaxSettings(page, { progress, poll, capture, guardBudget, assertCurrent, readState, assertState, requests }) {
  progress.status = 'reading';progress.cycles = [];progress.limitations = ['Initial native dialog preference, not server persistence or completed native renderer proof.'];
  const start = requests().length;const before = await readState();progress.before = before;
  let installed = false;let openedByHelper = false;let initialDialogCount = 0;let failure;
  const read = () => page.evaluate(bitbucketSyntaxSettingsProbe);
  const click = async (handle) => {
    assertCurrent();assert.equal(await page.evaluate(bitbucketSyntaxSettingsProbe, 'arm', handle), true, 'Native settings source identity changed before click');
    await handle.click();const event = await page.evaluate(bitbucketSyntaxSettingsProbe, 'click-result');assert.equal(event?.trusted, true, 'Native settings action must be a trusted click');assertCurrent();return event;
  };
  const close = async () => {
    if (!openedByHelper) return;
    const state = await read();if (state?.dialogCount === 0) return;
    assertCurrent();const handle = await page.evaluateHandle(bitbucketSyntaxSettingsProbe, 'cancel');
    try {
      const button = handle.asElement();
      if (button !== null) { (progress.closeEvents ??= []).push(await click(button));progress.closeMethod = 'Trusted native Cancel'; }
      else {
        await page.keyboard.press('Escape');progress.escape = await page.evaluate(bitbucketSyntaxSettingsProbe, 'escape-result');
        assert.equal(progress.escape?.trusted, true, 'Native Escape cleanup must be trusted');progress.closeMethod = 'Native Escape fallback; no Save or setting toggle';
      }
    } finally { await handle.dispose(); }
    await poll(read, (v) => v?.dialogCount === 0, 'Native diff settings dialog closed', 3000);
  };
  try {
    assertCurrent();const initial = await page.evaluate(bitbucketSyntaxSettingsProbe, 'setup');installed = initial !== null;
    initialDialogCount = initial?.dialogCount ?? 0;
    assert.ok(initial?.sameSource && initial.dialogCount === 0, 'No unique ready original source or a native dialog was already open');
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const record = { cycle: cycle + 1, budget: guardBudget() };progress.cycles.push(record);assertCurrent();
      const handles = await page.$$('::-p-aria([name="Global diff settings"][role="button"])');
      try {
        const eligible = [];
        for (const handle of handles) if (await page.evaluate(bitbucketSyntaxSettingsProbe, 'opener', handle)) eligible.push(handle);
        assert.equal(eligible.length, 1, 'Unique observed native Global diff settings button unavailable');
        await eligible[0].evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
        assert.equal(await page.evaluate(bitbucketSyntaxSettingsProbe, 'opener-hit', eligible[0]), true, 'Original native settings button is obstructed');
        openedByHelper = true;record.open = await click(eligible[0]);
      } finally { for (const handle of handles) await handle.dispose(); }
      record.initial = await poll(read, (v) => v?.dialogCount === 1 && v.ready && v.cancelAvailable, 'Initial native Syntax highlighting checkbox and Cancel', 4000);
      assert.equal(record.initial.sameSource, true, 'Native settings changed original source before Cancel');
      record.artifacts = await capture(page, `bitbucket-native-syntax-settings-${cycle + 1}`, { fullPage: false });
      await close();record.closed = await read();assert.equal(record.closed.sameSource, true, 'Native settings changed original source after Cancel');
      assert.equal(record.closed.dialogCount, 0);assertState(before, await readState());assertCurrent();
    }
    assert.deepEqual(progress.cycles[1].initial.preferences, progress.cycles[0].initial.preferences, 'Native initial preferences changed after Cancel/reopen');
    const enabled = progress.cycles[0].initial.checkbox.checked;
    progress.status = enabled ? 'native_enabled' : 'native_disabled';progress.enabled = enabled;
    progress.basis = 'Two fresh native dialog initial reads agree after real Cancel; no Save, toggle or provider-state injection.';
  } catch (error) { progress.status = 'unavailable';progress.error = error instanceof Error ? error.message : String(error); }
  finally {
    try {
      if (installed) {
        if (page.isClosed()) throw new Error('Native page closed before settings cleanup/source verification');
        await close();const after = await read();progress.after = after;
        assert.equal(after.sameSource, true, 'Native settings observation changed original source/Viewed/URL/node identities');
        assert.equal(after.dialogCount, initialDialogCount, 'Native settings dialog remains open');assert.deepEqual(after.events, [], 'Settings observation must not change a field or submit');
        assertCurrent();progress.afterState = await readState();assertState(before, progress.afterState);
      }
    } catch (error) { progress.status = 'failed';progress.cleanupError = error instanceof Error ? error.message : String(error);failure = error; }
    finally {
      try { if (installed && !page.isClosed()) await page.evaluate(bitbucketSyntaxSettingsProbe, 'cleanup'); }
      catch (error) { progress.status = 'failed';progress.cleanupError = error instanceof Error ? error.message : String(error);failure = error; }
      progress.apiRequests = requests().slice(start);progress.apiRequestDelta = progress.apiRequests.length;
    }
  }
  if (failure !== undefined) throw failure;
  return progress;
}
