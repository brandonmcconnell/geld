import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { observeGreptileCommandRequest } from './greptile-command-acceptance.mjs';

export const RENDERED_NOTES_FIXTURE = {
  url: 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272', project: '56243493', review: '488567980', iid: '272',
  author: '37628862', login: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b', ids: ['3381334872', '3381334884', '3384406925'],
};

/** Independent response observation, not the extension's parser or rendered-note map. */
export function captureGitLabRenderedNote(note) {
  const f = RENDERED_NOTES_FIXTURE;
  const id = String(note?.id);
  if (!f.ids.includes(id)) return null;
  const unavailable = (reason) => ({ status: 'unavailable', id, reason });
  if (note.noteable_type !== 'MergeRequest' || String(note.project_id) !== f.project || String(note.noteable_id) !== f.review
    || String(note.noteable_iid) !== f.iid || note.system !== false || String(note.author?.id) !== f.author
    || note.author?.username !== f.login || note.author?.bot !== true || note.author?.user_type !== 'project_bot'
    || note.noteable_note_url !== `${f.url}#note_${id}`) return unavailable('The independently observed native note identity changed.');
  if (typeof note.note !== 'string' || typeof note.created_at !== 'string' || !Number.isFinite(Date.parse(note.created_at))
    || typeof note.updated_at !== 'string' || !Number.isFinite(Date.parse(note.updated_at))) return unavailable('The native raw body or timestamp tuple is incomplete.');
  if (typeof note.note_html !== 'string' || note.note_html.trim() === '' || note.note_html.length > 256 * 1024) return unavailable('The already-issued response has no bounded rendered HTML for this finding.');
  return { status: 'available', id, project: f.project, review: f.review, iid: f.iid, author: f.author, login: f.login,
    url: note.noteable_note_url, createdAt: note.created_at, updatedAt: note.updated_at,
    bodySha256: createHash('sha256').update(note.note).digest('hex'), htmlSha256: createHash('sha256').update(note.note_html).digest('hex'), html: note.note_html };
}

/** Runs in the browser with only inert templates and DOM reads; never hydrates an original note. */
export function gitLabRenderedNotesProbe(records) {
  const normalize = (text) => text.replace(/\s+/g, ' ').trim();
  // The oracle includes image alternative text as content, without loading the native badge resource.
  const words = (node) => node.nodeType === 3 ? node.textContent ?? '' : node.nodeType === 1 && node.localName === 'img'
    ? node.getAttribute('alt') ?? '' : [...node.childNodes].map(words).join('');
  const semantics = (root) => ({
    text: normalize(words(root)), paragraphs: [...root.querySelectorAll('p')].map((node) => normalize(words(node))),
    inlineCode: [...root.querySelectorAll('code')].filter((node) => node.closest('pre') === null).map((node) => node.textContent),
    pre: [...root.querySelectorAll('pre')].map((node) => node.textContent),
    emphasis: [...root.querySelectorAll('strong,em')].map((node) => ({ tag: node.localName, text: normalize(words(node)) })),
  });
  const presented = (node) => {
    if (node === null || node.getBoundingClientRect().width <= 0 || node.getBoundingClientRect().height <= 0) return false;
    for (let current = node; current !== null; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true' || style.display === 'none'
        || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    }
    return true;
  };
  const panels = document.querySelectorAll('.geld-provider-review');
  const panel = panels.length === 1 ? panels[0] : null;
  const findings = records.map((record) => {
    const anchor = `note_${record.id}`;
    const template = document.createElement('template');template.innerHTML = record.html;
    const oracleUnsupported = template.content.querySelector('script,style,iframe,form,button,input,textarea,select,svg,math') !== null;
    const expected = semantics(template.content);
    const articles = panel?.querySelectorAll(`article.geld-provider-review__source[data-geld-source="${anchor}"]`) ?? [];
    const article = articles.length === 1 ? articles[0] : null;
    const body = article?.querySelector(':scope > .geld-provider-review__body') ?? null;
    const roots = body?.querySelectorAll(':scope > .note-text.md[data-geld-rendered-source="api"]') ?? [];
    const root = roots.length === 1 ? roots[0] : null;
    const anchors = [...document.querySelectorAll(`[id="${anchor}"]`)];
    const candidate = anchors.length === 1 ? anchors[0] : null;
    const headers = candidate?.querySelectorAll(':scope > .timeline-entry-inner > .timeline-content > .note-header > .note-header-info > a.author-name-link[data-user-id][data-username]') ?? [];
    const native = candidate instanceof HTMLElement && candidate.matches('[data-testid="noteable-note-container"]')
      && candidate.closest('[data-geld-ui], .geld-provider-review, .note-body, [data-testid="description-content"]') === null
      && headers.length === 1 && headers[0].namespaceURI === 'http://www.w3.org/1999/xhtml'
      && headers[0].getAttribute('data-user-id') === record.author && headers[0].getAttribute('data-username') === record.login
      && candidate.querySelectorAll('.note-body .note-text').length === 1;
    const unsafe = 'img,script,style,iframe,form,button,input,textarea,select,svg,math,[id],[data-testid],[data-src],[data-canonical-src],[contenteditable]';
    const resourcesOrControls = [...roots].reduce((count, node) => count + node.querySelectorAll(unsafe).length + (node.matches(unsafe) ? 1 : 0), 0);
    return { id: record.id, nativeCount: native ? 1 : 0, invalidAnchorCount: anchors.length - (native ? 1 : 0), articleCount: articles.length, apiRootCount: roots.length,
      expected, oracleUnsupported, actual: root === null ? null : semantics(root), presented: presented(root),
      permalinks: [...article?.querySelectorAll(':scope > .geld-provider-review__byline > a[href]') ?? []].map((link) => link.href),
      literalBadgeHtml: body === null ? false : /<a\s+href\s*=|<img\s+[^>]*alt\s*=/i.test(body.textContent),
      resourcesOrControls };
  });
  return { url: location.href.split('#')[0], panelCount: panels.length, findings };
}

function assertFindingIntegrity(value) {
  for (const finding of value.findings) {
    assert.equal(finding.invalidAnchorCount, 0, `Finding ${finding.id} has a copied, invalid or duplicate note ID instead of an independently valid native root`);
    assert.equal(finding.resourcesOrControls, 0, `Finding ${finding.id} copied resource or control hooks into owned output`);
  }
}

function assertRenderedNotes(value, records) {
  assertFindingIntegrity(value);
  assert.equal(value.url, RENDERED_NOTES_FIXTURE.url);assert.equal(value.panelCount, 1);
  assert.equal(value.findings.length, records.length);
  for (const finding of value.findings) {
    const record = records.find((source) => source.id === finding.id);
    assert.ok(record !== undefined);assert.equal(finding.nativeCount, 0, 'An original finding mounted after the API-fallback precondition was checked');
    assert.equal(finding.articleCount, 1, `Finding ${finding.id} lost its unique original-source row`);
    assert.equal(finding.apiRootCount, 1, `Known unmounted finding ${finding.id} is missing the API-rendered body`);
    assert.equal(finding.oracleUnsupported, false);assert.ok(finding.expected.paragraphs.length > 0 && finding.expected.inlineCode.length > 0);
    assert.equal(finding.presented, true, `API-rendered finding ${finding.id} is not presented after opening its real digest ancestors`);
    assert.ok(finding.permalinks.includes(record.url));assert.equal(finding.literalBadgeHtml, false);assert.equal(finding.resourcesOrControls, 0);
    assert.deepEqual(finding.actual, finding.expected, `Rendered paragraph/code/emphasis semantics differ from the independently observed HTML for finding ${finding.id}`);
  }
  assert.ok(value.findings.some((finding) => finding.expected.pre.length > 0), 'The retained suggestion PRE must be positively exercised');
  assert.ok(value.findings.some((finding) => finding.expected.emphasis.length > 0), 'The retained emphasized title must be positively exercised');
}

export async function verifyGitLabRenderedNotes(page, item, { fixture, head, extensionId, readDigest, assertSources, readSettings, openReviewAncestors, poll, capture }) {
  const proof = { status: 'running', scope: 'Inert API-rendered semantics for three already-observed, unmounted GitLab findings. No native hydration, image resource or native-pixel comparison.', sourceGets: [], otherGets: [], samples: [] };
  item.renderedFindings = proof;
  const request = (value) => {
    const evidence = observeGreptileCommandRequest(value, extensionId);
    if (evidence === null) return;
    const list = evidence.acquisition ? proof.sourceGets : proof.otherGets;
    if (list.length < 40) list.push(evidence);else proof.requestOverflow = true;
  };
  const signatures = () => createHash('sha256').update(JSON.stringify(fixture.discussions.map((value) => value.selected))).digest('hex');
  const unchanged = async () => {
    assert.equal(page.url().split('#')[0], RENDERED_NOTES_FIXTURE.url);
    const value = await readDigest();assertSources(value, proof.beforeDigest);assert.deepEqual(value.items, proof.beforeDigest.items);assert.deepEqual(value.bots, proof.beforeDigest.bots);
    assert.equal(value.selectedHead, head);assert.equal(signatures(), proof.sourceSignature);assert.deepEqual(await readSettings(), proof.settings);
    assert.equal(proof.requestOverflow ?? false, false);assert.deepEqual(proof.sourceGets, [], 'Rendered-note inspection caused extension-attributed or recognized source acquisition');
    assert.deepEqual(fixture.errors, []);assert.deepEqual(fixture.providerMutations, []);assert.deepEqual(fixture.aiRequests, []);
    assert.ok(fixture.metadata.length > 0 && fixture.metadata.every((value) => value.sha === head && value.diffHead === head
      && String(value.projectId) === RENDERED_NOTES_FIXTURE.project && String(value.noteableId) === RENDERED_NOTES_FIXTURE.review
      && String(value.iid) === RENDERED_NOTES_FIXTURE.iid && value.webUrl === RENDERED_NOTES_FIXTURE.url));
    return value;
  };
  page.on('request', request);
  try {
    assert.match(head, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
    proof.beforeDigest = await readDigest();assertSources(proof.beforeDigest);proof.settings = await readSettings();proof.sourceSignature = signatures();
    assert.equal(proof.settings.aiEnabled, false);
    assert.deepEqual(proof.settings.trustedReviewAccounts, ['gitlab.com/whitebox-aero/whitebox greptile 37628862']);
    const selected = fixture.discussions.find((value) => value.discussionCount === 36 && value.noteCount === 40 && value.nextCursor === null)?.selected ?? [];
    const records = RENDERED_NOTES_FIXTURE.ids.map((id) => selected.find((note) => note.id === id)?.rendered);
    proof.records = records.map((record) => record === undefined ? null : { ...record, html: undefined });
    if (records.some((record) => record?.status !== 'available')) { proof.status = 'unavailable';proof.reason = 'The already-observed fixture no longer supplies all three independently validated rendered finding records.';return proof; }
    const read = () => page.evaluate(gitLabRenderedNotesProbe, records);
    const unavailable = (value) => value.findings.some((finding) => finding.nativeCount !== 0 || finding.oracleUnsupported
      || finding.expected.paragraphs.length === 0 || finding.expected.inlineCode.length === 0)
      || !value.findings.some((finding) => finding.expected.pre.length > 0) || !value.findings.some((finding) => finding.expected.emphasis.length > 0);
    const markUnavailable = () => { proof.status = 'unavailable';proof.reason = 'An original native finding is now mounted, or the rendered fixture shape changed; API fallback was not accepted.';return proof; };
    proof.precondition = await read();
    assertFindingIntegrity(proof.precondition);
    if (unavailable(proof.precondition)) return markUnavailable();
    proof.openedSummaries = [];
    for (const record of records) proof.openedSummaries.push(await openReviewAncestors(page, `article.geld-provider-review__source[data-geld-source="note_${record.id}"] > .geld-provider-review__body`));
    proof.beforeCapture = await poll(async () => { const value = await read();proof.samples.push(value);if (proof.samples.length > 4) proof.samples.shift();return value; },
      (value) => { if (value.findings.some((finding) => finding.invalidAnchorCount !== 0 || finding.resourcesOrControls !== 0) || unavailable(value)) return true;try { assertRenderedNotes(value, records);return true; } catch { return false; } }, 'Three known unmounted finding bodies preserve the independently observed HTML semantics', 8000);
    assertFindingIntegrity(proof.beforeCapture);
    if (unavailable(proof.beforeCapture)) return markUnavailable();
    assertRenderedNotes(proof.beforeCapture, records);proof.afterDigest = await unchanged();
    proof.artifacts = await capture(page, 'gitlab-api-rendered-findings');proof.afterCapture = await read();assertFindingIntegrity(proof.afterCapture);if (unavailable(proof.afterCapture)) return markUnavailable();
    assertRenderedNotes(proof.afterCapture, records);await unchanged();
    proof.status = 'passed';
  } catch (error) { proof.status = 'failed';proof.error = error instanceof Error ? error.message : String(error);throw error; }
  finally { page.off('request', request);proof.listenerDisposed = true; }
  return proof;
}
