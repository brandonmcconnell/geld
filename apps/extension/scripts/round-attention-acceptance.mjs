import assert from 'node:assert/strict';

const REVIEW = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
const BOUNDARY = '4135374883';
const OPEN = new Set(['open', 'needs-reply', 'addressed', 'outdated']);

export function gitLabRoundSnapshot() {
  const panel = document.querySelector('.geld-provider-review');
  if (panel === null) return null;
  let selected = null;
  try {
    const app = JSON.parse(document.querySelector('[data-rapid-diffs][data-app-data]')?.getAttribute('data-app-data') ?? 'null');
    const versions = app?.versions?.source_versions?.filter((version) => version.selected === true && version.latest === true) ?? [];
    if (app?.mr_path === '/gitlab-org/gitlab/-/merge_requests/266334' && String(app?.iid) === '266334' && versions.length === 1) selected = { headSha: versions[0].head_sha, versionId: String(versions[0].id) };
  } catch { /* Missing native selection cannot pass scope checks. */ }
  const native = (anchor) => {
    const source = document.getElementById(anchor);const thread = source?.closest('[data-discussion-id]');const saved = globalThis.__geldRoundNative?.get(anchor);
    return { anchor, id: source?.id ?? null, body: source?.querySelector('.note-body .note-text')?.textContent ?? null, discussion: thread?.getAttribute('data-discussion-id') ?? null, resolved: thread?.getAttribute('data-discussion-resolved') ?? null, sameNode: saved === undefined || saved.node === source && saved.parent === source?.parentElement };
  };
  return { url: location.href, head: panel.getAttribute('data-geld-review-head'), selected,
    items: [...panel.querySelectorAll('[data-geld-item]')].map((item) => ({ id: item.getAttribute('data-geld-item'), state: item.getAttribute('data-state'), homeId: item.id, attention: item.closest('[data-geld-review-attention]') !== null, open: item.open, focused: document.activeElement === item.querySelector(':scope > summary'),
      sources: [...item.querySelectorAll('[data-geld-source]')].map((source) => ({ anchor: source.getAttribute('data-geld-source'), id: source.getAttribute('data-geld-source-id'), url: source.getAttribute('data-geld-source-url'), body: source.querySelector(':scope > .geld-provider-review__body')?.textContent, createdAt: source.querySelector('time[datetime]')?.getAttribute('datetime'), native: native(source.getAttribute('data-geld-source')) })) })),
    attention: panel.querySelector('[data-geld-review-attention]')?.open ?? null,
    rounds: [...panel.querySelectorAll('[data-geld-review-round]')].map((round) => ({ id: round.getAttribute('data-geld-review-round'), label: round.querySelector(':scope > summary')?.textContent, at: round.querySelector('[data-geld-event] time[datetime]')?.getAttribute('datetime'), pointers: [...round.querySelectorAll('[data-geld-review-pointer]')].map((row) => row.getAttribute('data-geld-review-pointer')) })),
    beforePointers: [...panel.querySelectorAll('[data-geld-review-key="history:before"] [data-geld-review-pointer]')].map((row) => row.getAttribute('data-geld-review-pointer')),
    boundary: (() => { const node = document.getElementById('note_4135374883');return { time: node?.querySelector('time[datetime]')?.getAttribute('datetime'), commits: [...node?.querySelectorAll('a.gfm-commit[data-commit]') ?? []].map((link) => ({ sha: link.getAttribute('data-commit'), url: link.href, project: link.getAttribute('data-project-path') })) }; })(),
    input: globalThis.__geldRoundInput ?? null,
  };
}

function sourceFacts(snapshot) {
  return snapshot.items.map((item) => ({ id: item.id, state: item.state, sources: item.sources })).sort((a, b) => a.id.localeCompare(b.id));
}
export function assertGitLabRoundScope(snapshot, { headSha, diffPageUrl }) {
  assert.ok(snapshot !== null);assert.equal(new URL(snapshot.url).origin + new URL(snapshot.url).pathname, REVIEW);
  assert.match(headSha, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  assert.equal(snapshot.head, headSha);assert.equal(snapshot.selected?.headSha, headSha);
  assert.equal(snapshot.selected.versionId, new URL(diffPageUrl).searchParams.get('diff_id'));
}
export function assertRoundSources(before, after) {
  assert.deepEqual(sourceFacts(after), sourceFacts(before), 'Grouping changed source IDs, words, native status, links or element identity');
  const anchors = after.items.flatMap((item) => item.sources.map((source) => source.anchor));
  assert.equal(new Set(anchors).size, anchors.length, 'A history pointer duplicated a real source/body/action home');
}
export function assertRoundSingleHomes(before, after) {
  assertRoundSources(before, after);
  assert.deepEqual(after.items.filter((item) => item.attention).map((item) => item.id).sort(), before.items.filter((item) => OPEN.has(item.state)).map((item) => item.id).sort());
}

// Audited callsites: gitlab/review.ts (MR, discussions, approval/reviewer/pipeline jobs),
// gitlab/source.ts (selected metadata and immutable diff), gitlab/config.ts (repository config).
export function isOwnedGitLabRoundEndpoint(url) {
  if (url.origin !== 'https://gitlab.com' || url.username || url.password || url.hash) return false;
  const project = /^\/api\/v4\/projects\/(?:gitlab-org%2fgitlab|278964)(.*)$/i.exec(url.pathname);
  if (project !== null) return project[1] === '' || /^\/merge_requests\/266334(?:\/(?:approvals|pipelines|reviewers))?$/.test(project[1])
    || /^\/pipelines\/[1-9]\d*\/jobs$/.test(project[1])
    || /^\/repository\/(?:branches\/[^/]+|tree|files\/[^/]+\/raw|commits\/[^/]+)$/.test(project[1]);
  return /^\/gitlab-org\/gitlab\/-\/merge_requests\/266334\/(?:discussions|diffs_metadata)\.json$/.test(url.pathname)
    || /^\/gitlab-org\/gitlab\/-\/(?:commit\/[a-f0-9]{40,64}\.diff|compare\/[a-f0-9]{40,64}\.\.\.[a-f0-9]{40,64})$/.test(url.pathname);
}

/** Positive extension frames or exact owned source signatures fail acquisition checks.
 * Missing frames remain unattributed; unrelated MR JSON never becomes native by default. */
export function observeGitLabRoundRequest(value, extensionId) {
  let url;try { url = new URL(value.url()); } catch { return null; }
  if (url.origin !== 'https://gitlab.com' || value.method() !== 'GET') return null;
  const frames = [];let initiator;try { initiator = value.initiator?.(); } catch { /* Missing evidence stays unknown. */ }
  let stack = initiator?.stack;
  for (let level = 0; stack != null && level < 8; level += 1) { frames.push(...(stack.callFrames ?? []).slice(0, 20).map((frame) => frame.url));stack = stack.parent; }
  const extension = frames.some((frame) => typeof frame === 'string' && frame.startsWith(`chrome-extension://${extensionId}/`));
  const firstParty = frames.some((frame) => { try { const source = new URL(frame);return source.origin === url.origin && source.pathname.startsWith('/assets/'); } catch { return false; } });
  const ownedEndpoint = isOwnedGitLabRoundEndpoint(url);
  if (!extension && !ownedEndpoint && !url.pathname.startsWith('/api/') && !/\/-\/merge_requests\/266334\/.*\.json$/.test(url.pathname)) return null;
  return { url: url.origin + url.pathname, method: 'GET', observedAt: new Date().toISOString(), ownedEndpoint,
    attribution: extension ? 'extension_frame_observed' : firstParty ? 'first_party_frame_observed' : 'native_or_unattributed',
    frameSources: [...new Set(frames.flatMap((frame) => { try { const source = new URL(frame);return ['https:', 'http:', 'chrome-extension:'].includes(source.protocol) ? [`${source.protocol}//${source.host}${source.pathname}`] : []; } catch { return []; } }))].slice(0, 12),
  };
}

export async function verifyGitLabRoundAttention(page, item, { readSettings, patchSettings, poll, openReviewAncestors, capture, headSha, diffPageUrl, extensionId }) {
  assert.match(extensionId, /^[a-p]{32}$/, 'Request attribution needs the actual installed extension ID');
  const proof = { status: 'running', sourceGets: [], otherGets: [], requests: [], scope: 'Grouping over the current loaded review and native selected version/head. Forbid observed extension frames and exact audited source endpoints. Other GETs retain first-party or unknown attribution; no claim of zero provider traffic or historical edited bodies.' };item.roundAttention = proof;
  const original = await readSettings();
  const request = (value) => { const observed = observeGitLabRoundRequest(value, extensionId);if (observed === null) return;proof.requests.push(observed);if (observed.ownedEndpoint || observed.attribution === 'extension_frame_observed') proof.sourceGets.push(observed);else proof.otherGets.push(observed); };
  page.on('request', request);
  const read = () => page.evaluate(gitLabRoundSnapshot);
  let completed = false;
  try {
    await patchSettings({ reviewGrouping: 'type' });
    let baselineSignature = '';
    await poll(read, (value) => { const valid = value?.attention === null && value.items.length > 0;const signature = valid ? JSON.stringify([value.head, value.selected, sourceFacts(value)]) : '';const settled = valid && signature === baselineSignature;baselineSignature = signature;return settled; }, 'Type grouping and native source identities settle before the source baseline');
    await page.evaluate(() => { globalThis.__geldRoundNative = new Map([...document.querySelectorAll('.geld-provider-review [data-geld-source]')].map((source) => { const anchor = source.getAttribute('data-geld-source');const node = document.getElementById(anchor);return [anchor, { node, parent: node?.parentElement }]; })); });
    proof.before = await read();assertGitLabRoundScope(proof.before, { headSha, diffPageUrl });
    assert.ok(proof.before.items.some((item) => OPEN.has(item.state)), 'This actual corpus needs prior unresolved work');
    assert.ok(Number.isFinite(Date.parse(proof.before.boundary.time)) && proof.before.boundary.commits.length > 0, 'Explicit native commit event must already be mounted');
    for (const commit of proof.before.boundary.commits) { assert.match(commit.sha, /^[a-f0-9]{40}$/);const url = new URL(commit.url);assert.equal(url.origin + url.pathname, `${REVIEW}/diffs`);assert.equal(url.searchParams.get('commit_id'), commit.sha);assert.equal(commit.project, 'gitlab-org/gitlab'); }
    await patchSettings({ reviewGrouping: 'batch' });
    proof.batch = await poll(read, (value) => value?.attention === true && value.rounds.some((round) => round.id.split(':').includes(BOUNDARY)), 'Already-fetched typed native commit creates a real round and one Needs attention group');
    assertGitLabRoundScope(proof.batch, { headSha, diffPageUrl });assertRoundSingleHomes(proof.before, proof.batch);
    const dates = proof.batch.rounds.map((round) => Date.parse(round.at));assert.ok(dates.every(Number.isFinite));assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
    assert.deepEqual(proof.batch.rounds.map((round) => Number(/^Push round ([1-9]\d*)/.exec(round.label)?.[1])), proof.batch.rounds.map((_, index, rounds) => rounds.length - index));
    const candidate = proof.batch.items.find((item) => item.attention && item.sources.some((source) => Date.parse(source.createdAt) < Date.parse(proof.before.boundary.time)));
    assert.ok(candidate !== undefined, 'Actual unresolved work must predate the recorded commit event');proof.itemId = candidate.id;
    const home = `[data-geld-item="${candidate.id}"]`;const pointer = `[data-geld-review-pointer="${candidate.id}"] button`;
    await openReviewAncestors(page, `${home} > summary`);
    if ((await read()).items.find((item) => item.id === candidate.id).open) await page.click(`${home} > summary`);
    await page.click('[data-geld-review-attention] > summary');
    assert.equal((await read()).attention, false);
    proof.openedAncestors = await openReviewAncestors(page, pointer);
    await page.$eval(pointer, (button) => { globalThis.__geldRoundInput = null;button.addEventListener('click', (event) => { globalThis.__geldRoundInput = { trusted: event.isTrusted, detail: event.detail }; }, { once: true, capture: true }); });
    await page.focus(pointer);await page.keyboard.press('Enter');
    proof.opened = await poll(read, (value) => value.attention === true && value.items.some((item) => item.id === candidate.id && item.open && item.focused), 'Trusted Enter opens and focuses the one real attention home');
    assert.deepEqual(proof.opened.input, { trusted: true, detail: 0 });assertRoundSingleHomes(proof.before, proof.opened);assertGitLabRoundScope(proof.opened, { headSha, diffPageUrl });
    proof.artifacts = await capture(page, 'gitlab-round-attention');proof.afterCapture = await read();assertRoundSingleHomes(proof.before, proof.afterCapture);assertGitLabRoundScope(proof.afterCapture, { headSha, diffPageUrl });
    assert.deepEqual(proof.sourceGets, [], 'Grouping must not acquire an extension-attributed or recognized review source');completed = true;return proof;
  } catch (error) { proof.status = 'failed';proof.error = String(error);throw error; }
  finally {
    try {
      await patchSettings({ reviewGrouping: original.reviewGrouping ?? 'type' });
      if (completed) {
        proof.restored = await poll(read, (value) => (original.reviewGrouping ?? 'type') === 'batch' ? value.attention !== null : value.attention === null, 'Original global grouping restores');
        assertRoundSources(proof.before, proof.restored);assertGitLabRoundScope(proof.restored, { headSha, diffPageUrl });
        assert.deepEqual(proof.sourceGets, []);proof.status = 'passed';
      }
    } catch (error) { proof.status = 'failed';proof.cleanupError = String(error);throw error; }
    finally { page.off('request', request);if (!page.isClosed()) await page.evaluate(() => { delete globalThis.__geldRoundNative;delete globalThis.__geldRoundInput; }); }
  }
}
