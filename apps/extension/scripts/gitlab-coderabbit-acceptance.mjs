import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export const CODERABBIT_FIXTURE = { url: 'https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117', project: 'ark-bitcoin/bark', id: '2117', note: '3436654383', author: '38968537', login: 'group_117740890_bot_4b22dd1a4e94814ac4828214cbd93cfe' };
const FULL = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const metadataPath = `/api/v4/projects/${CODERABBIT_FIXTURE.project}/merge_requests/${CODERABBIT_FIXTURE.id}`;
const discussionPath = new URL(CODERABBIT_FIXTURE.url).pathname + '/discussions.json';

function noteId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null;
}

function fixtureResource(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://gitlab.com' || url.username || url.password || url.hash) return null;
    if (decodeURIComponent(url.pathname) === metadataPath && url.search === '') return { kind: 'metadata', url: url.href };
    if (url.pathname !== discussionPath || [...url.searchParams.keys()].some((key) => !['cursor', 'page', 'per_page', 'notes_filter', 'persist_filter'].includes(key))) return null;
    if (url.searchParams.get('per_page') !== '100' || url.searchParams.get('notes_filter') !== '0' || url.searchParams.get('persist_filter') !== 'false') return null;
    if (url.searchParams.has('cursor') && url.searchParams.has('page')) return null;
    const cursor = url.searchParams.get('cursor'); const page = url.searchParams.get('page') ?? '1';
    if (cursor !== null && (cursor === '' || cursor.length > 4096) || !/^[1-9]\d*$/.test(page)) return null;
    return { kind: 'discussions', url: url.href, key: cursor === null ? `page:${page}` : `cursor:${cursor}`, page: Number(page), cursor };
  } catch { return null; }
}

/** Response-only oracle. Missing bodies/complete cursor chains never trigger another fetch. */
export function createCodeRabbitFixtureOracle() {
  const pages = new Map(); const metadata = new Map(); let invalid = false;
  const evidence = { metadata: [], metadataResponses: [], pages: [], errors: [], providerMutations: [], aiRequests: [], copySourceGets: [], copyOtherGets: [] };
  const reject = (message) => { invalid = true;if (evidence.errors.length < 12) evidence.errors.push(message); };
  return { evidence,
    observe(url, status, value, headers = {}) {
      const source = fixtureResource(url); if (source === null) return;
      if (source.kind === 'metadata' && evidence.metadataResponses.length < 12) evidence.metadataResponses.push({ url, status });
      if (status !== 200) return;
      if (source.kind === 'metadata') {
        if (String(value?.iid) !== CODERABBIT_FIXTURE.id || value.web_url !== CODERABBIT_FIXTURE.url || !FULL.test(value.sha ?? '') || value.diff_refs?.head_sha !== value.sha) return reject('Current native MR metadata did not establish the exact fixture/head.');
        metadata.set(value.sha, { iid: value.iid, sha: value.sha, state: value.state, webUrl: value.web_url });
        if (evidence.metadata.length < 12) evidence.metadata.push({ url, ...metadata.get(value.sha) });
        return;
      }
      if (!Array.isArray(value) || value.length > 100 || pages.size >= 5 && !pages.has(source.key)) return reject('Discussion response exceeded the bounded complete-source oracle.');
      const notes = []; const discussionIds = [];
      for (const discussion of value) {
        if (typeof discussion?.id !== 'string' || !Array.isArray(discussion.notes)) return reject('Native discussions omitted their identities or notes.');
        if (discussion.notes.length > 1000 || notes.length + discussion.notes.length > 2000) return reject('Native note count exceeded the fixture observer bound.');
        discussionIds.push(discussion.id);
        for (const note of discussion.notes) {
          const systemEvent = note?.system === true && ['LabelNote', 'StateNote'].includes(note.type) && typeof note.id === 'string' && FULL.test(note.id) && note.id === discussion.id;
          const id = noteId(note?.id) ?? (systemEvent ? `${note.type}:${note.id}` : null);
          if (id === null || typeof note.note !== 'string' || note.note.length > 1_000_000) return reject('Native note identity/body was malformed.');
          notes.push({ id, discussion: discussion.id, system: note.system, url: note.noteable_note_url,
            author: { id: String(note.author?.id), login: note.author?.username, bot: note.author?.bot, type: note.author?.user_type },
            createdAt: note.created_at, updatedAt: note.updated_at, bodyHash: hash(note.note), resolved: discussion.resolved, active: discussion.active });
        }
      }
      const cursor = headers['x-next-page-cursor'] ?? ''; const nextPage = headers['x-next-page'] ?? '';
      if (typeof cursor !== 'string' || cursor.length > 4096 || nextPage !== '' && !/^[1-9]\d*$/.test(nextPage)) return reject('Native discussion continuation was malformed.');
      const next = cursor !== '' ? `cursor:${cursor}` : source.cursor !== null || nextPage === '' ? null : nextPage === String(source.page + 1) ? `page:${nextPage}` : 'invalid';
      if (next === 'invalid' || next === source.key) return reject('Native discussion continuation repeated or changed page order.');
      const page = { key: source.key, next, url: source.url, discussionIds, notes };
      if (pages.has(source.key) && hash(pages.get(source.key)) !== hash(page)) return reject('A native source page changed while establishing the fixture.');
      pages.set(source.key, page);
      if (evidence.pages.length < 12) evidence.pages.push({ url, key: source.key, next, discussions: value.length, notes: notes.length, signature: hash(page) });
    },
    snapshot() {
      const pending = (reason) => ({ status: 'unavailable', reason });
      if (invalid || metadata.size !== 1) return pending('One fresh exact native MR identity and consistent complete discussion source are required.');
      const seen = new Set(); const notes = []; const discussions = []; let key = 'page:1';
      while (key !== null) {
        if (seen.has(key) || seen.size >= 5) return pending('Native discussion pagination did not finish within its bound.');
        seen.add(key); const page = pages.get(key); if (page === undefined) return pending('A complete native discussion page chain has not been observed.');
        notes.push(...page.notes);discussions.push(...page.discussionIds);key = page.next;
      }
      if (new Set(notes.map((note) => note.id)).size !== notes.length || new Set(discussions).size !== discussions.length) return pending('Native discussion source identities are ambiguous.');
      const source = notes.find((note) => note.id === CODERABBIT_FIXTURE.note);
      if (source === undefined || source.system !== false || source.author.id !== CODERABBIT_FIXTURE.author || source.author.login !== CODERABBIT_FIXTURE.login || source.author.bot !== true || source.author.type !== 'project_bot' || source.url !== `${CODERABBIT_FIXTURE.url}#note_${source.id}`) return pending('The actual expected native account and summary source have not been confirmed.');
      return { status: 'ready', metadata: [...metadata.values()][0], discussions: discussions.length, notes: notes.length, pages: [...seen], source,
        accountNotes: notes.filter((note) => note.system === false && note.author.id === source.author.id && note.author.login === source.author.login && note.url === `${CODERABBIT_FIXTURE.url}#note_${note.id}`), sourceSignature: hash(notes) };
    },
  };
}

export function codeRabbitRequestObservation(request, extensionId) {
  let url;try { url = new URL(request.url); } catch { return null; }
  if (url.origin !== 'https://gitlab.com' || request.method !== 'GET') return null;
  const frames = [];let stack = request.initiator?.stack;
  for (let depth = 0; stack != null && depth < 20; depth += 1) { frames.push(...(stack.callFrames ?? []).map((frame) => frame.url));stack = stack.parent; }
  const extension = frames.some((frame) => typeof frame === 'string' && frame.startsWith(`chrome-extension://${extensionId}/`));
  let path;try { path = decodeURIComponent(url.pathname); } catch { return null; }
  const owned = path === metadataPath || path.startsWith(`${metadataPath}/`) || url.pathname === discussionPath;
  if (!owned && !extension && !path.startsWith('/api/') && !(url.pathname.startsWith(new URL(CODERABBIT_FIXTURE.url).pathname + '/') && url.pathname.endsWith('.json'))) return null;
  return { url: url.origin + url.pathname, method: 'GET', source: owned || extension, attribution: extension ? 'extension_frame_observed' : 'native_or_unattributed', ownedEndpoint: owned };
}

export function observeCodeRabbitFixture(page, item, extensionId) {
  const oracle = createCodeRabbitFixtureOracle();item.nativeCodeRabbitFixture = oracle.evidence;let copying = false;
  const request = (request) => {
    const url = new URL(request.url());
    if (/\/(?:chat\/completions|responses|completions)\/?$/.test(url.pathname) && url.origin !== 'https://gitlab.com') oracle.evidence.aiRequests.push(url.origin + url.pathname);
    if (url.origin === 'https://gitlab.com' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      const mutation = url.pathname === '/api/graphql' ? /\bmutation\b/.test(request.postData() ?? '') : /\/(?:notes|discussions|draft_notes|approve|unapprove|reviews|merge)(?:\/|$)/.test(url.pathname);
      if (mutation) oracle.evidence.providerMutations.push({ method: request.method(), url: url.origin + url.pathname });
    }
    if (copying) { const seen = codeRabbitRequestObservation({ url: request.url(), method: request.method(), initiator: request.initiator?.() }, extensionId); if (seen !== null) (seen.source ? oracle.evidence.copySourceGets : oracle.evidence.copyOtherGets).push(seen); }
  };
  const response = (response) => {
    if (fixtureResource(response.url()) === null) return;
    const status = response.status();
    if (status !== 200) { oracle.observe(response.url(), status, null, response.headers());return; }
    void response.json().then((body) => oracle.observe(response.url(), status, body, response.headers())).catch(() => { if (oracle.evidence.errors.length < 12) oracle.evidence.errors.push('An already-issued native response body was unreadable.'); });
  };
  page.on('request', request);page.on('response', response);
  return { ...oracle, copyPhase(active) { copying = active; }, dispose() { page.off('request', request);page.off('response', response); } };
}

export function codeRabbitDomProbe(fixture) {
  const panel = document.querySelector('.geld-provider-review');if (panel === null) return null;
  const native = document.getElementById(`note_${fixture.note}`);
  const nativeAuthor = native?.querySelector(':scope > .timeline-entry-inner > .timeline-content > .note-header > .note-header-info > a.author-name-link[data-user-id][data-username]');
  const source = panel.querySelector(`[data-geld-source="note_${fixture.note}"]`);
  const requests = [...panel.querySelectorAll('details[data-geld-bot-request]')].map((root) => ({ summary: root.querySelector(':scope > summary')?.textContent, preview: root.querySelector('code[data-geld-bot-command]')?.textContent,
    source: root.querySelector('a[href]')?.href, modes: [...root.querySelectorAll('[role="group"][aria-label="Review command mode"] button')].map((button) => ({ text: button.textContent, pressed: button.getAttribute('aria-pressed') })),
    copyDisabled: root.querySelector('[data-geld-bot-request-action="copy"]')?.disabled, commentDisabled: root.querySelector('[data-geld-bot-request-action="comment"]')?.disabled, commentTitle: root.querySelector('[data-geld-bot-request-action="comment"]')?.title,
    status: root.querySelector('[role="status"]')?.textContent }));
  const nativeOnly = (node) => node.closest('[data-geld-ui], .note-body, .description') === null;
  const reviewRoots = [...document.querySelectorAll('.merge-request[data-project-path][data-url]')].filter(nativeOnly);
  const review = reviewRoots[0];
  const nativeScope = { count: reviewRoots.length, project: review?.getAttribute('data-project-path'), path: review?.getAttribute('data-url'), action: review?.getAttribute('data-mr-action') };
  let nativeHead = null;
  for (const node of [...document.querySelectorAll('[data-noteable-type="MergeRequest"][data-noteable-data]')].filter(nativeOnly)) {
    try {
      const data = JSON.parse(node.getAttribute('data-noteable-data'));
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Malformed native noteable data');
      if (Object.hasOwn(data, 'diff_head_sha')) {
        const head = data.diff_head_sha;
        if (typeof head !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(head) || nativeHead !== null && nativeHead !== head) throw new Error('Malformed or conflicting native noteable head');
        nativeHead = head;
      }
    } catch { nativeHead = 'invalid';break; }
  }
  const rapidRoots = [...document.querySelectorAll('[data-rapid-diffs][data-app-data]')].filter(nativeOnly);
  let nativeVersion = { status: 'absent', count: rapidRoots.length };
  if (rapidRoots.length > 0) {
    nativeVersion = { status: 'invalid', count: rapidRoots.length };
    try {
      const app = rapidRoots.length === 1 ? JSON.parse(rapidRoots[0].getAttribute('data-app-data')) : null;
      const versions = app?.versions?.source_versions;
      if (!Array.isArray(versions) || versions.length === 0 || versions.length > 500 || versions.some((version) => version === null || typeof version !== 'object' || typeof version.selected !== 'boolean' || typeof version.latest !== 'boolean' || !Number.isSafeInteger(version.id) || version.id <= 0 || typeof version.head_sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(version.head_sha))) throw new Error('Malformed native Rapid Diff versions');
      const versionOf = (version) => ({ id: version.id, head: version.head_sha, selected: version.selected, latest: version.latest, href: version.href });
      nativeVersion = { status: 'observed', count: rapidRoots.length, project: app.project_path, path: app.mr_path, iid: String(app.iid), type: app.noteable_type,
        selected: versions.filter((version) => version.selected).map(versionOf), latest: versions.filter((version) => version.latest).map(versionOf) };
    } catch { /* A present malformed/ambiguous Rapid record remains invalid, never absent. */ }
  }
  const held = globalThis.__geldCodeRabbitNative;
  const commandUrl = requests[0]?.source;
  let commandAnchor = '';try { commandAnchor = decodeURIComponent(new URL(commandUrl).hash.slice(1)); } catch { /* Unavailable command source stays unknown. */ }
  const commandRoot = document.getElementById(commandAnchor);
  const commandAuthor = commandRoot?.querySelector(':scope > .timeline-entry-inner > .timeline-content > .note-header > .note-header-info > a.author-name-link[data-user-id][data-username]');
  const commandHeld = globalThis.__geldCodeRabbitCommandNative;
  const requestNative = { anchor: commandAnchor, exists: commandRoot !== null, body: commandRoot?.querySelector('.note-body .note-text')?.innerHTML ?? null,
    authorId: commandAuthor?.dataset.userId, login: commandAuthor?.dataset.username,
    sameNode: commandHeld === undefined ? null : commandRoot === commandHeld.node && commandRoot?.parentElement === commandHeld.parent };
  return { url: location.href.split('#')[0], state: panel.dataset.state, head: panel.dataset.geldReviewHead, nativeHead, nativeScope, nativeVersion,
    source: { anchor: source?.getAttribute('data-geld-source'), body: source?.querySelector(':scope > .geld-provider-review__body')?.innerHTML ?? null, links: [...source?.querySelectorAll(':scope > .geld-provider-review__byline a[href]') ?? []].map((link) => link.href) },
    native: { exists: native !== null, body: native?.querySelector('.note-body .note-text')?.innerHTML ?? null, authorId: nativeAuthor?.dataset.userId, login: nativeAuthor?.dataset.username, href: nativeAuthor?.getAttribute('href'),
      sameNode: held === undefined ? null : native === held.node && native?.parentElement === held.parent },
    requests, requestNative, items: [...panel.querySelectorAll('[data-geld-item]')].map((root) => ({ id: root.dataset.geldItem, state: root.dataset.state, sources: [...root.querySelectorAll('[data-geld-source]')].map((source) => source.dataset.geldSource) })).sort((a, b) => a.id.localeCompare(b.id)), bots: [...panel.querySelectorAll('[data-geld-review-bot]')].map((root) => ({ id: root.dataset.geldReviewBot, state: root.dataset.state, text: root.textContent.replace(/\s+/g, ' ').trim() })),
    aiRunControls: panel.querySelectorAll('[data-geld-ai-run]').length, unavailable: [...panel.querySelectorAll('.geld-provider-review__unavailable')].map((node) => node.textContent) };
}

export function assertCodeRabbitSource(value, snapshot, baseline) {
  assert.ok(value !== null && ['ready', 'partial'].includes(value.state));assert.equal(value.url, CODERABBIT_FIXTURE.url);
  assert.equal(value.head, snapshot.metadata.sha);if (value.nativeHead !== null) assert.equal(value.nativeHead, snapshot.metadata.sha);assert.equal(value.aiRunControls, 0);
  const reviewPath = new URL(CODERABBIT_FIXTURE.url).pathname;
  assert.deepEqual(value.nativeScope, { count: 1, project: CODERABBIT_FIXTURE.project, path: reviewPath + '.json', action: 'show' });
  const rapid = value.nativeVersion;
  assert.equal(rapid?.status, 'observed');assert.equal(rapid.count, 1);assert.equal(rapid.project, CODERABBIT_FIXTURE.project);assert.equal(rapid.path, reviewPath);assert.equal(rapid.iid, CODERABBIT_FIXTURE.id);assert.equal(rapid.type, 'MergeRequest');
  assert.equal(rapid.selected.length, 1);assert.equal(rapid.latest.length, 1);assert.deepEqual(rapid.selected, rapid.latest);
  const selected = rapid.selected[0];assert.ok(Number.isSafeInteger(selected.id) && selected.id > 0);assert.equal(selected.selected, true);assert.equal(selected.latest, true);assert.equal(selected.head, snapshot.metadata.sha);
  assert.equal(selected.href, `${reviewPath}/diffs?diff_id=${selected.id}`);
  assert.equal(value.source.anchor, `note_${CODERABBIT_FIXTURE.note}`);assert.equal(typeof value.source.body, 'string');assert.ok(value.source.links.includes(`${CODERABBIT_FIXTURE.url}#note_${CODERABBIT_FIXTURE.note}`));
  assert.equal(value.native.exists, true);assert.equal(typeof value.native.body, 'string');assert.equal(value.native.authorId, CODERABBIT_FIXTURE.author);assert.equal(value.native.login, CODERABBIT_FIXTURE.login);
  if (baseline !== undefined) { assert.deepEqual(value.source, baseline.source);assert.deepEqual({ ...value.native, sameNode: null }, { ...baseline.native, sameNode: null });assert.equal(value.native.sameNode, true); }
}

export function assertCodeRabbitRequestSource(value, snapshot, baseline) {
  const source = value.requests[0]?.source;
  assert.ok(snapshot.accountNotes.some((note) => note.url === source));
  const original = value.requestNative;
  assert.equal(original.exists, true);assert.equal(typeof original.body, 'string');assert.equal(original.authorId, CODERABBIT_FIXTURE.author);assert.equal(original.login, CODERABBIT_FIXTURE.login);
  assert.equal(`${CODERABBIT_FIXTURE.url}#${original.anchor}`, source);
  if (baseline !== undefined) { assert.deepEqual({ ...original, sameNode: null }, { ...baseline.requestNative, sameNode: null });assert.equal(original.sameNode, true);assert.equal(source, baseline.requests[0].source); }
}

/** Real installed UI only; no runtime injection, source replacement, bot post or oracle GET. */
export async function verifyCodeRabbitCommands(page, item, { fixture, context, poll, openReviewAncestors, clickReviewButton, readSettings, withdrawTrust, restoreTrust, capture }) {
  const proof = { status: 'running', actions: [], scope: 'Explicit personal account trust and anonymous command clipboard preparation; no posting or authenticated writer proof.' };item.codeRabbitCommands = proof;
  const original = await readSettings();let permissionAttempted = false;let originalClipboard;let completed = false;let acquiringFixture = false;
  const read = () => page.evaluate(codeRabbitDomProbe, CODERABBIT_FIXTURE);
  const unchangedSettings = async (trusted) => { const current = await readSettings();const { trustedReviewAccounts: _before, ...old } = original;const { trustedReviewAccounts: _after, ...now } = current;assert.deepEqual(now, old);assert.deepEqual(current.trustedReviewAccounts ?? [], trusted);assert.equal(current.aiEnabled, false); };
  try {
    assert.deepEqual(original.trustedReviewAccounts ?? [], []);assert.equal(original.aiEnabled, false);
    acquiringFixture = true;assert.ok(fixture !== undefined, 'Actual native CodeRabbit fixture observer is unavailable.');
    const snapshot = await poll(() => fixture.snapshot(), (value) => value.status === 'ready', 'Actual complete CodeRabbit native source/current metadata, without an oracle fetch');acquiringFixture = false;proof.fixture = snapshot;
    let before = await poll(read, (value) => value !== null && ['ready', 'partial'].includes(value.state) && value.source.body !== null && value.head === snapshot.metadata.sha, 'Installed untrusted CodeRabbit source with the actual observed head');
    if (!before.native.exists) {
      const selector = `[data-geld-source="note_${CODERABBIT_FIXTURE.note}"] .geld-provider-review__byline a[href="${CODERABBIT_FIXTURE.url}#note_${CODERABBIT_FIXTURE.note}"]`;
      proof.nativeReveal = await openReviewAncestors(page, selector);const link = await page.$(selector);assert.ok(link !== null);
      try { await link.evaluate((node) => node.scrollIntoView({ block: 'center' }));await link.click(); } finally { await link.dispose(); }
      before = await poll(read, (value) => value?.native.exists && value.native.body !== null, 'Actual native permalink reveals the original CodeRabbit source');
    }
    assertCodeRabbitSource(before, snapshot);assert.deepEqual(before.bots, []);assert.deepEqual(before.requests, []);proof.beforeTrust = before;
    proof.headVerification = { freshMetadataHead: snapshot.metadata.sha, installedPanelHead: before.head, nativeNoteableHead: before.nativeHead, nativeNoteableStatus: before.nativeHead === null ? 'absent/unknown' : 'observed', nativeHeadSource: 'Rapid Diffs selected/latest source version', nativeVersion: before.nativeVersion.selected[0] };
    await page.evaluate((anchor) => { const node = document.getElementById(anchor);globalThis.__geldCodeRabbitNative = { node, parent: node?.parentElement }; }, `note_${CODERABBIT_FIXTURE.note}`);
    const identity = `[data-geld-source="note_${CODERABBIT_FIXTURE.note}"] .geld-provider-reviewer-identity`;
    proof.identityOpened = await openReviewAncestors(page, `${identity} .geld-provider-reviewer-identity__choices button`);
    proof.identity = await page.$eval(identity, (root) => ({ summary: root.querySelector(':scope > summary')?.textContent, metadata: root.querySelector('dl')?.textContent }));
    assert.equal(proof.identity.summary, 'Identify reviewer');for (const value of [CODERABBIT_FIXTURE.author, CODERABBIT_FIXTURE.login, 'gitlab.com/ark-bitcoin/bark']) assert.ok(proof.identity.metadata.includes(value));
    proof.serviceClick = await clickReviewButton(page, `${identity} .geld-provider-reviewer-identity__choices button`, 'CodeRabbit');await unchangedSettings([]);
    proof.confirmation = await page.$eval(`${identity} .geld-provider-reviewer-identity__confirmation`, (root) => ({ visible: !root.hidden, text: root.textContent }));assert.equal(proof.confirmation.visible, true);assert.ok(proof.confirmation.text.includes(CODERABBIT_FIXTURE.login) && proof.confirmation.text.includes('CodeRabbit'));
    proof.trustClick = await clickReviewButton(page, `${identity} .geld-provider-reviewer-identity__confirmation button`, 'Trust');
    const binding = `gitlab.com/ark-bitcoin/bark coderabbit ${snapshot.source.author.id}`;
    await poll(readSettings, (value) => value.trustedReviewAccounts?.length === 1 && value.trustedReviewAccounts[0] === binding, 'Actual Chrome sync contains the exact personally confirmed CodeRabbit account binding');await unchangedSettings([binding]);
    proof.trusted = await poll(read, (value) => value?.requests.length === 1 && value.requests[0].copyDisabled === false, 'Trusted native CodeRabbit request preparation is available');assertCodeRabbitSource(proof.trusted, snapshot, before);
    assertCodeRabbitRequestSource(proof.trusted, snapshot);
    const trustedSource = proof.trusted;
    await page.evaluate((anchor) => { const node = document.getElementById(anchor);globalThis.__geldCodeRabbitCommandNative = { node, parent: node?.parentElement }; }, proof.trusted.requestNative.anchor);
    proof.trusted = await read();assertCodeRabbitSource(proof.trusted, snapshot, before);assertCodeRabbitRequestSource(proof.trusted, snapshot, trustedSource);
    const request = proof.trusted.requests[0];assert.equal(request.summary, 'Prepare CodeRabbit request');assert.ok(snapshot.accountNotes.some((note) => note.url === request.source));assert.equal(request.commentDisabled, true);assert.match(request.commentTitle, /Sign in to GitLab/);
    proof.requestOpened = await openReviewAncestors(page, 'details[data-geld-bot-request] [data-geld-bot-request-action="copy"]');
    permissionAttempted = true;await context.overridePermissions('https://gitlab.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);originalClipboard = await page.evaluate(() => navigator.clipboard.readText());
    fixture.copyPhase(true);const sentinel = `geld-coderabbit-${randomUUID()}`;await page.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
    for (const [mode, expected, input] of [['Incremental review', '@coderabbitai review', 'pointer'], ['Full review', '@coderabbitai full review', 'keyboard']]) {
      await clickReviewButton(page, 'details[data-geld-bot-request] [role="group"][aria-label="Review command mode"] button', mode);
      const preview = await poll(read, (value) => value?.requests[0]?.preview === expected && value.requests[0].modes.some((button) => button.text === mode && button.pressed === 'true'), `Exact ${mode} preview before trusted input`);assertCodeRabbitSource(preview, snapshot, before);assertCodeRabbitRequestSource(preview, snapshot, proof.trusted);assert.deepEqual(preview.bots, proof.trusted.bots);assert.deepEqual(preview.items, proof.trusted.items);
      const handle = await page.$('details[data-geld-bot-request] button[data-geld-bot-request-action="copy"]');assert.ok(handle !== null);
      try {
        await handle.evaluate((button) => { button.scrollIntoView({ block: 'center' });globalThis.__geldCodeRabbitInput = null;button.addEventListener('click', (event) => { globalThis.__geldCodeRabbitInput = { trusted: event.isTrusted, detail: event.detail }; }, { once: true, capture: true }); });
        if (input === 'pointer') await handle.click();else { await handle.focus();await page.keyboard.press('Enter'); }
        const event = await page.evaluate(() => globalThis.__geldCodeRabbitInput);assert.equal(event?.trusted, true);if (input === 'keyboard') assert.equal(event.detail, 0);else assert.ok(event.detail > 0);
        const clipboard = await poll(() => page.evaluate(() => navigator.clipboard.readText()), (value) => value === expected, `Real clipboard ${mode} command`, 8000);
        const after = await poll(read, (value) => value?.requests[0]?.status === 'Command copied. Paste it into the native comment writer and post when ready.', 'Copy acknowledges preparation without posting');
        assertCodeRabbitSource(after, snapshot, before);assertCodeRabbitRequestSource(after, snapshot, proof.trusted);assert.deepEqual(after.bots, proof.trusted.bots);assert.deepEqual(after.items, proof.trusted.items);assert.equal(after.requests[0].commentDisabled, true);await unchangedSettings([binding]);proof.actions.push({ mode, expected, clipboard, input, event, after });
      } finally { await handle.dispose(); }
    }
    proof.artifacts = await capture(page, 'gitlab-coderabbit-command-prepared');const afterCapture = await read();assertCodeRabbitSource(afterCapture, snapshot, before);assertCodeRabbitRequestSource(afterCapture, snapshot, proof.trusted);assert.deepEqual(afterCapture.bots, proof.trusted.bots);assert.deepEqual(afterCapture.items, proof.trusted.items);
    assert.deepEqual(fixture.evidence.copySourceGets, []);fixture.copyPhase(false);
    proof.withdrawal = await withdrawTrust(binding);await page.bringToFront();await unchangedSettings([]);
    proof.withdrawn = await poll(read, (value) => value !== null && value.requests.length === 0 && value.bots.length === 0, 'Actual UI trust withdrawal removes CodeRabbit preparation/classification');assertCodeRabbitSource(proof.withdrawn, snapshot, before);
    assert.deepEqual(fixture.evidence.providerMutations, []);assert.deepEqual(fixture.evidence.aiRequests, []);assert.deepEqual(fixture.evidence.errors, []);assert.equal(fixture.snapshot().sourceSignature, snapshot.sourceSignature);completed = true;
  } catch (error) { proof.status = acquiringFixture ? 'unavailable' : 'failed';proof.error = error instanceof Error ? error.message : String(error);if (!acquiringFixture) throw error; }
  finally {
    const errors = [];try { fixture?.copyPhase(false); } catch (error) { errors.push(error); }
    try { await restoreTrust(original);await unchangedSettings(original.trustedReviewAccounts ?? []);proof.settingsRestored = true; } catch (error) { errors.push(error); }
    try { if (!page.isClosed()) { if (permissionAttempted && originalClipboard !== undefined) await page.evaluate((value) => navigator.clipboard.writeText(value), originalClipboard);await page.evaluate(() => { delete globalThis.__geldCodeRabbitInput;delete globalThis.__geldCodeRabbitNative;delete globalThis.__geldCodeRabbitCommandNative; }); } } catch (error) { errors.push(error); }
    if (permissionAttempted) try { await context.clearPermissionOverrides();proof.permissionsRestored = true; } catch (error) { errors.push(error); }
    try { fixture?.dispose(); } catch (error) { errors.push(error); }
    if (errors.length > 0) { proof.status = 'failed';proof.cleanupErrors = errors.map((error) => String(error));throw new AggregateError(errors, 'CodeRabbit clipboard/trust cleanup failed'); }
    if (completed) proof.status = 'passed';
  }
  if (proof.status === 'unavailable') return { status: 'unavailable', featureParity: 'partial', reason: proof.error };
  assert.equal(completed, true, 'CodeRabbit acceptance did not complete.');assert.equal(proof.status, 'passed');
  return { status: 'passed', featureParity: 'partial', verified: 'Actual observed native CodeRabbit account explicitly trusted and withdrawn; two exact anonymous commands copied by trusted pointer/Enter without posting or AI, with no observed extension/recognized source acquisition during copy. Native writer remains disabled.' };
}
