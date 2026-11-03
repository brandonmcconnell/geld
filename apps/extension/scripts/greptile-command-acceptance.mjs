import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const GREPTILE_COMMAND_FIXTURE = { url: 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272', author: '37628862', login: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b', anchor: 'note_3381334808', command: '@greptileai' };

/** Exact audited source routes or positive extension frames are acquisition evidence.
 * Other review JSON stays first-party-observed or unattributed, never assumed native. */
export function observeGreptileCommandRequest(request, extensionId) {
  let url;try { url = new URL(request.url()); } catch { return null; }
  if (request.method() !== 'GET' || url.origin !== 'https://gitlab.com') return null;
  const frames = [];let initiator;try { initiator = request.initiator?.(); } catch { /* Unknown stays unknown. */ }
  let stack = initiator?.stack;
  for (let depth = 0; stack != null && depth < 8; depth += 1) { frames.push(...(stack.callFrames ?? []).slice(0, 20).map((frame) => frame.url));stack = stack.parent; }
  const extension = frames.some((frame) => typeof frame === 'string' && frame.startsWith(`chrome-extension://${extensionId}/`));
  const firstParty = frames.some((frame) => { try { const source = new URL(frame);return source.origin === url.origin && source.pathname.startsWith('/assets/'); } catch { return false; } });
  const project = /^\/api\/v4\/projects\/(?:whitebox-aero%2fwhitebox|56243493)(.*)$/i.exec(url.pathname);
  const ownedEndpoint = project !== null && (project[1] === '' || /^\/merge_requests\/272(?:\/(?:approvals|pipelines|reviewers))?$/.test(project[1]) || /^\/pipelines\/[1-9]\d*\/jobs$/.test(project[1]) || /^\/repository\/(?:branches\/[^/]+|tree|files\/[^/]+\/raw|commits\/[^/]+)$/.test(project[1]))
    || /^\/whitebox-aero\/whitebox\/-\/merge_requests\/272\/(?:discussions|diffs_metadata)\.json$/.test(url.pathname)
    || /^\/whitebox-aero\/whitebox\/-\/(?:commit\/[a-f0-9]{40,64}\.diff|compare\/[a-f0-9]{40,64}\.\.\.[a-f0-9]{40,64})$/.test(url.pathname);
  if (!extension && !ownedEndpoint && !url.pathname.startsWith('/api/') && !/^\/whitebox-aero\/whitebox\/-\/merge_requests\/272\/.*\.json$/.test(url.pathname)) return null;
  return { url: url.origin + url.pathname, method: 'GET', observedAt: new Date().toISOString(), ownedEndpoint,
    acquisition: extension || ownedEndpoint, attribution: extension ? 'extension_frame_observed' : firstParty ? 'first_party_frame_observed' : 'native_or_unattributed',
    frameSources: [...new Set(frames.flatMap((frame) => { try { const source = new URL(frame);return ['http:', 'https:', 'chrome-extension:'].includes(source.protocol) ? [`${source.protocol}//${source.host}${source.pathname}`] : []; } catch { return []; } }))].slice(0, 12) };
}

export function greptileCommandDomProbe() {
  const panel = document.querySelector('.geld-provider-review');if (panel === null) return null;
  const requests = [...panel.querySelectorAll('[data-geld-review-bot="greptile"] details[data-geld-bot-request]')];
  const root = requests.length === 1 ? requests[0] : null;
  const native = document.querySelector('[data-testid="noteable-note-container"]#note_3381334808');
  const author = native?.querySelector(':scope > .timeline-entry-inner > .timeline-content > .note-header > .note-header-info > a.author-name-link[data-user-id][data-username]');
  const held = globalThis.__geldGreptileCommandNative;
  return { url: location.href.split('#')[0], head: panel.getAttribute('data-geld-review-head'), requests: requests.length,
    summary: root?.querySelector(':scope > summary')?.textContent, preview: root?.querySelector('[data-geld-bot-command]')?.textContent,
    modes: root?.querySelectorAll('[role="group"][aria-label="Review command mode"]').length,
    copyDisabled: root?.querySelector('[data-geld-bot-request-action="copy"]')?.disabled,
    commentDisabled: root?.querySelector('[data-geld-bot-request-action="comment"]')?.disabled,
    commentTitle: root?.querySelector('[data-geld-bot-request-action="comment"]')?.title,
    source: root?.querySelector('a[href]')?.href, status: root?.querySelector('[role="status"]')?.textContent,
    native: { exists: native !== null, author: author?.getAttribute('data-user-id'), login: author?.getAttribute('data-username'), body: native?.querySelector('.note-body .note-text')?.innerHTML,
      sameNode: held === undefined ? null : native === held.node && native?.parentElement === held.parent } };
}

export async function verifyGreptileCommand(page, item, { context, fixture, head, readDigest, assertSources, readSettings, openReviewAncestors, poll, capture }) {
  const proof = { status: 'running', scope: 'One exact command copied from the already trusted native GitLab source. Copy is preparation only; no native posting, AI or oracle GET.', actions: [], sourceGets: [], otherGets: [] };item.greptileCommand = proof;
  let permissionAttempted = false;let originalClipboard;let completed = false;
  const read = () => page.evaluate(greptileCommandDomProbe);
  const unchanged = async () => {
    assert.equal(page.url().split('#')[0], GREPTILE_COMMAND_FIXTURE.url);
    const digest = await readDigest();assertSources(digest, proof.beforeDigest);assert.deepEqual(digest.items, proof.beforeDigest.items);assert.deepEqual(digest.bots, proof.beforeDigest.bots);
    assert.deepEqual(await readSettings(), proof.settings);
    assert.equal(fixture.commandRequestOverflow ?? false, false);assert.deepEqual(fixture.commandSourceGets, [], 'Command preparation caused extension-attributed or recognized source acquisition');
    assert.deepEqual(fixture.errors, []);
    assert.deepEqual(fixture.providerMutations, []);assert.deepEqual(fixture.aiRequests, []);
    assert.ok(fixture.metadata.every((value) => value.sha === head && value.diffHead === head));
    return digest;
  };
  const source = (value, baseline) => {
    assert.ok(value !== null);assert.equal(value.url, GREPTILE_COMMAND_FIXTURE.url);assert.equal(value.head, head);assert.equal(value.requests, 1);
    assert.equal(value.summary, 'Prepare Greptile request');assert.equal(value.preview, GREPTILE_COMMAND_FIXTURE.command);assert.equal(value.modes, 0);
    assert.equal(value.commentDisabled, true);assert.match(value.commentTitle, /Sign in to GitLab/);assert.equal(value.source, `${GREPTILE_COMMAND_FIXTURE.url}#${GREPTILE_COMMAND_FIXTURE.anchor}`);
    assert.equal(value.native.exists, true);assert.equal(value.native.author, GREPTILE_COMMAND_FIXTURE.author);assert.equal(value.native.login, GREPTILE_COMMAND_FIXTURE.login);assert.equal(typeof value.native.body, 'string');
    if (baseline !== undefined) { assert.deepEqual({ ...value.native, sameNode: null }, { ...baseline.native, sameNode: null });assert.equal(value.native.sameNode, true); }
  };
  try {
    assert.match(head, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);assert.equal(page.url().split('#')[0], GREPTILE_COMMAND_FIXTURE.url);
    proof.settings = await readSettings();assert.equal(proof.settings.aiEnabled, false);
    assert.deepEqual(proof.settings.trustedReviewAccounts, ['gitlab.com/whitebox-aero/whitebox greptile 37628862']);
    proof.beforeDigest = await readDigest();assertSources(proof.beforeDigest);
    assert.equal(fixture.metadata.length > 0, true);assert.deepEqual(fixture.errors, []);
    const summary = fixture.discussions.flatMap((value) => value.selected).find((note) => note.id === '3381334808');
    assert.equal(summary?.author.id, GREPTILE_COMMAND_FIXTURE.author);assert.equal(summary.author.username, GREPTILE_COMMAND_FIXTURE.login);assert.equal(summary.system, false);assert.equal(summary.url, `${GREPTILE_COMMAND_FIXTURE.url}#${GREPTILE_COMMAND_FIXTURE.anchor}`);
    fixture.commandCopyActive = true;
    const selector = '[data-geld-review-bot="greptile"] details[data-geld-bot-request] [data-geld-bot-request-action="copy"]';
    proof.opened = await openReviewAncestors(page, selector);
    const before = await poll(read, (value) => value?.requests === 1 && value.copyDisabled === false, 'Current trusted Greptile command preview');source(before);proof.before = before;
    await page.evaluate(() => { const node = document.getElementById('note_3381334808');globalThis.__geldGreptileCommandNative = { node, parent: node?.parentElement }; });
    proof.permissions = { origin: 'https://gitlab.com', names: ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'] };
    permissionAttempted = true;await context.overridePermissions(proof.permissions.origin, proof.permissions.names);originalClipboard = await page.evaluate(() => navigator.clipboard.readText());
    await page.evaluate((value) => navigator.clipboard.writeText(value), `geld-greptile-${randomUUID()}`);
    const action = { input: 'keyboard Enter', expected: GREPTILE_COMMAND_FIXTURE.command, stage: 'started' };proof.actions.push(action);
    const handle = await page.$(selector);assert.ok(handle !== null, 'Missing current exact Greptile Copy control');
    try {
      await handle.evaluate((button) => { button.scrollIntoView({ block: 'center', inline: 'nearest' });globalThis.__geldGreptileCommandInput = null;button.addEventListener('click', (event) => { globalThis.__geldGreptileCommandInput = { trusted: event.isTrusted, detail: event.detail }; }, { capture: true, once: true }); });
      await handle.focus();await page.keyboard.press('Enter');
      action.event = await page.evaluate(() => globalThis.__geldGreptileCommandInput);action.stage = 'event_observed';assert.equal(action.event?.trusted, true);assert.equal(action.event.detail, 0);action.eventValidated = true;
      action.clipboard = await poll(() => page.evaluate(() => navigator.clipboard.readText()), (value) => value === GREPTILE_COMMAND_FIXTURE.command, 'Exact real Greptile command clipboard readback', 8000);action.clipboardValidated = true;action.stage = 'clipboard_validated';
      proof.after = await poll(read, (value) => value?.status === 'Command copied. Paste it into the native comment writer and post when ready.' && value.copyDisabled === false, 'Command-copy acknowledgement without posting');
      source(proof.after, before);proof.afterDigest = await unchanged();action.completed = true;action.stage = 'complete';
    } finally { await handle.dispose(); }
    proof.artifacts = await capture(page, 'gitlab-greptile-command-prepared');proof.afterCapture = await read();source(proof.afterCapture, before);await unchanged();completed = true;
  } catch (error) { proof.status = 'failed';proof.error = error instanceof Error ? error.message : String(error);throw error; }
  finally {
    fixture.commandCopyActive = false;proof.sourceGets = [...fixture.commandSourceGets];proof.otherGets = [...fixture.commandOtherGets];
    const errors = [];
    try {
      if (!page.isClosed()) {
        if (originalClipboard !== undefined) { await page.evaluate((value) => navigator.clipboard.writeText(value), originalClipboard);assert.equal(await page.evaluate(() => navigator.clipboard.readText()), originalClipboard);proof.clipboardRestored = true; }
        await page.evaluate(() => { delete globalThis.__geldGreptileCommandNative;delete globalThis.__geldGreptileCommandInput; });
      } else if (originalClipboard !== undefined) throw new Error('Provider page closed before clipboard restoration');
    } catch (error) { errors.push(error); }
    if (permissionAttempted) try { await context.clearPermissionOverrides();proof.permissionsRestored = true; } catch (error) { errors.push(error); }
    if (errors.length > 0) { proof.status = 'failed';proof.cleanupErrors = errors.map((error) => String(error));throw new AggregateError(errors, 'Greptile clipboard cleanup failed'); }
    if (completed) proof.status = 'passed';
  }
  return proof;
}
