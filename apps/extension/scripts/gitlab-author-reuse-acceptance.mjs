import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RENDERED_NOTES_FIXTURE as F } from './gitlab-rendered-notes-acceptance.mjs';
import { observeGreptileCommandRequest } from './greptile-command-acceptance.mjs';

/** Independent native-header oracle. An absent finding is never called natively painted. */
export function gitLabAuthorReuseProbe(records) {
  const sample = (node) => {
    if (node === null || node === undefined) return null;
    const rect = node.getBoundingClientRect();
    let presented = rect.width > 0 && rect.height > 0;
    for (let current = node; current !== null; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true' && !(current === node && node instanceof HTMLImageElement) || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden'
        || current instanceof HTMLDetailsElement && !current.open && !current.querySelector(':scope > summary')?.contains(node)) presented = false;
    }
    const style = getComputedStyle(node);
    return { text: node.textContent.trim(), presented, width: rect.width, height: rect.height,
      typography: Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color'].map((key) => [key, style[key]])) };
  };
  const roots = [...document.querySelectorAll('[id="note_3381334808"]')];
  const root = roots.length === 1 ? roots[0] : null;
  const headers = root?.querySelectorAll(':scope > .timeline-entry-inner > .timeline-content > .note-header') ?? [];
  const header = headers.length === 1 ? headers[0] : null;
  const authors = header?.querySelectorAll(':scope > .note-header-info > a.author-name-link[data-user-id][data-username]') ?? [];
  const author = authors.length === 1 ? authors[0] : null;
  const alias = header?.querySelector(':scope > .note-header-info > .author-username > a.author-username-link') ?? null;
  const avatarLink = root?.querySelector(':scope > .timeline-entry-inner > .timeline-avatar > a.gl-avatar-link[data-user-id][data-username]') ?? null;
  const avatar = avatarLink?.querySelector('img.gl-avatar') ?? null;
  const tuple = root === null ? null : { id: root.id, noteId: root.getAttribute('data-note-id'), testId: root.getAttribute('data-testid'),
    author: author?.getAttribute('data-user-id'), login: author?.getAttribute('data-username'), profile: author?.href,
    avatarAuthor: avatarLink?.getAttribute('data-user-id'), avatarLogin: avatarLink?.getAttribute('data-username'), avatarProfile: avatarLink?.href,
    avatarSource: avatar?.getAttribute('src'), avatarClasses: avatar?.className,
    sourceTimes: [...header?.querySelectorAll('time[datetime]') ?? []].map((time) => time.getAttribute('datetime')),
    badges: [...header?.querySelectorAll(':scope > .note-actions > .gl-badge') ?? []].map((badge) => ({ label: badge.querySelector(':scope > .gl-badge-content')?.textContent.trim(), title: badge.getAttribute('title'), className: badge.className })) };
  const nativeValid = root !== null && root.matches('[data-testid="noteable-note-container"][data-note-id="3381334808"]')
    && root.closest('[data-geld-ui], .geld-provider-review, .note-body, [data-testid="description-content"], form') === null
    && root.parentElement?.closest('[data-testid="noteable-note-container"]') === null && author !== null;
  const selected = [];
  for (const node of document.querySelectorAll('[data-rapid-diffs][data-app-data]')) {
    if (node.closest('[data-geld-ui], .note-body, [data-testid="description-content"], [data-testid="noteable-note-container"], form') !== null) continue;
    try {
      const app = JSON.parse(node.getAttribute('data-app-data'));
      selected.push({ repository: app.project_path, path: app.mr_path, iid: String(app.iid), versions: app.versions?.source_versions?.filter((version) => version.selected === true).map((version) => ({ id: version.id, latest: version.latest, mergeHead: version.is_merge_head, head: version.head_sha })) ?? [] });
    } catch { selected.push(null); }
  }
  const held = globalThis.__geldAuthorReuseNative;
  const themeHeld = globalThis.__geldAuthorReuseThemesNative;
  const native = { rootCount: roots.length, valid: nativeValid, tuple, name: sample(author?.querySelector('[data-testid="author-name"]')), alias: sample(alias?.querySelector('.note-headline-light') ?? alias), aliasHref: alias?.href,
    avatar: avatar === null ? null : { ...sample(avatar), src: avatar.src, className: avatar.className }, sameNode: held === undefined ? null : root === held.root && root?.parentElement === held.parent,
    sameThemeNode: themeHeld === undefined ? null : root === themeHeld.root && root?.parentElement === themeHeld.parent };
  const panel = document.querySelectorAll('.geld-provider-review');
  const findings = records.map((record) => {
    const anchor = `note_${record.id}`;
    const articles = panel.length === 1 ? panel[0].querySelectorAll(`article.geld-provider-review__source[data-geld-source="${anchor}"]`) : [];
    const article = articles.length === 1 ? articles[0] : null;
    const byline = article?.querySelector(':scope > .geld-provider-review__byline');
    const aliases = [...byline?.querySelectorAll(':scope > .geld-provider-review__muted') ?? []].filter((node) => node.textContent.trim() === `@${record.author.username}`);
    const ownAvatar = byline?.querySelector('[data-geld-author-avatar]') ?? null;
    const slot = byline?.querySelector('[data-geld-author-avatar-slot]') ?? null;
    const anchors = [...document.querySelectorAll(`[id="${anchor}"]`)];
    const original = anchors.length === 1 ? anchors[0] : null;
    const originalAuthors = original?.querySelectorAll(':scope > .timeline-entry-inner > .timeline-content > .note-header > .note-header-info > a.author-name-link[data-user-id][data-username]') ?? [];
    const originalValid = original !== null && original.matches(`[data-testid="noteable-note-container"][data-note-id="${record.id}"]`)
      && original.closest('[data-geld-ui], .geld-provider-review, .note-body, [data-testid="description-content"], form') === null
      && original.parentElement?.closest('[data-testid="noteable-note-container"]') === null && originalAuthors.length === 1
      && originalAuthors[0].getAttribute('data-user-id') === record.author.id && originalAuthors[0].getAttribute('data-username') === record.author.username;
    return { id: record.id, nameCount: byline?.querySelectorAll('[data-geld-author-name]').length ?? 0, profileCount: byline?.querySelectorAll('[data-geld-author-profile]').length ?? 0, aliasCount: aliases.length, avatarCount: byline?.querySelectorAll('[data-geld-author-avatar]').length ?? 0, slotCount: byline?.querySelectorAll('[data-geld-author-avatar-slot]').length ?? 0, nativeCount: originalValid ? 1 : 0, invalidAnchorCount: anchors.length - (originalValid ? 1 : 0), articleCount: articles.length,
      sourceTuple: article === null ? null : { id: article.getAttribute('data-geld-source-id'), anchor: article.getAttribute('data-geld-source'), url: article.getAttribute('data-geld-source-url'),
        links: [...byline?.querySelectorAll(':scope > a[href]') ?? [], ...article?.querySelectorAll(':scope > .geld-provider-review__msg-side a[data-geld-view][href]') ?? []].map((link) => link.href), times: [...byline?.querySelectorAll('time[datetime]') ?? []].map((time) => time.getAttribute('datetime')), edited: byline?.querySelector('[data-geld-edited]') !== null && byline?.querySelector('[data-geld-edited]') !== undefined },
      name: sample(byline?.querySelector('[data-geld-author-name]')), alias: aliases.length === 1 ? sample(aliases[0]) : null,
      profile: byline?.querySelector('[data-geld-author-profile]')?.href ?? null, badges: [...byline?.querySelectorAll('[data-geld-author-badge]') ?? []].map((node) => node.textContent.trim()),
      avatar: ownAvatar === null ? null : { ...sample(ownAvatar), src: ownAvatar.src, className: ownAvatar.className }, slot: sample(slot) };
  });
  return { url: location.href.split('#')[0], panelCount: panel.length, selected, native, findings,
    theme: { system: document.documentElement.classList.contains('gl-system'), dark: document.documentElement.classList.contains('gl-dark'), osDark: window.matchMedia('(prefers-color-scheme: dark)').matches } };
}

export function beginGitLabAuthorReuseProbe() {
  if (globalThis.__geldAuthorReuseNative !== undefined) throw new Error('Author comparison state was already retained.');
  const root = document.getElementById('note_3381334808');
  const details = new Map();
  for (const id of ['3381334872', '3381334884', '3384406925']) {
    const source = document.querySelector(`.geld-provider-review article[data-geld-source="note_${id}"]`);
    for (let node = source?.parentElement; node !== null && node !== undefined; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement && node.closest('.geld-provider-review') !== null) details.set(node, node.open);
    }
  }
  globalThis.__geldAuthorReuseNative = { root, parent: root?.parentElement, url: location.href.split('#')[0], details };
}

export function endGitLabAuthorReuseProbe() {
  const held = globalThis.__geldAuthorReuseNative;
  delete globalThis.__geldAuthorReuseNative;
  if (held === undefined) throw new Error('Author comparison state was lost before cleanup.');
  if (location.href.split('#')[0] !== held.url) throw new Error('Author comparison navigated before disclosure restoration.');
  for (const [node, open] of held.details) {
    if (!node.isConnected || node.closest('.geld-provider-review') === null) throw new Error('Owned disclosure remounted before author comparison restoration.');
    node.open = open;
    if (node.open !== open) throw new Error('Owned author comparison disclosure failed to restore.');
  }
  return { stateRemoved: globalThis.__geldAuthorReuseNative === undefined, ownedDisclosuresRestored: held.details.size };
}

function assertComparison(value, records, head, requirePresented) {
  assert.equal(value.url, F.url);assert.equal(value.panelCount, 1);assert.equal(value.native.rootCount, 1);assert.equal(value.native.valid, true);
  const context = value.selected;
  assert.equal(context.length, 1);assert.equal(context[0]?.repository, 'whitebox-aero/whitebox');assert.equal(context[0]?.path, '/whitebox-aero/whitebox/-/merge_requests/272');assert.equal(context[0]?.iid, F.iid);
  assert.deepEqual(context[0].versions.map((version) => ({ latest: version.latest, mergeHead: version.mergeHead, head: version.head })), [{ latest: true, mergeHead: false, head }]);
  assert.deepEqual(value.findings.map((finding) => finding.id), F.ids);
  const native = value.native;
  assert.equal(native.tuple.author, F.author);assert.equal(native.tuple.login, F.login);assert.equal(native.tuple.profile, `https://gitlab.com/${F.login}`);
  assert.equal(native.name?.text, '****');assert.equal(native.alias?.text, `@${F.login}`);assert.equal(native.aliasHref, native.tuple.profile);
  for (const finding of value.findings) {
    const source = records.find((record) => record.id === finding.id);assert.ok(source);
    assert.equal(finding.invalidAnchorCount, 0, 'A copied, duplicate or malformed target ID cannot establish native availability');
    assert.equal(finding.nativeCount, 0, 'Account reuse acceptance requires the actual finding to remain unmounted');assert.equal(finding.articleCount, 1);
    assert.equal(finding.nameCount, 1);assert.equal(finding.profileCount, 1);assert.equal(finding.aliasCount, 1);assert.ok(finding.avatarCount <= 1 && finding.slotCount <= 1);
    // The byline shows the edit's time with a clock for the first posting, as GitHub's does.
    const edited = source.updatedAt !== undefined && source.updatedAt !== source.createdAt;
    assert.ok(finding.sourceTuple?.times.includes(new Date(edited ? source.updatedAt : source.createdAt).toISOString()));
    assert.equal(finding.sourceTuple?.edited, edited);
    assert.equal(finding.sourceTuple?.id, source.id);assert.equal(finding.sourceTuple?.anchor, `note_${source.id}`);assert.equal(finding.sourceTuple?.url, source.url);assert.ok(finding.sourceTuple?.links.includes(source.url));
    assert.equal(finding.name?.text, native.name.text);assert.equal(finding.alias?.text, native.alias.text);assert.equal(finding.profile, native.tuple.profile);assert.deepEqual(finding.badges, [], 'A donor badge must not become a finding-specific role');
    if (!requirePresented) continue;
    assert.equal(native.name.presented, true);assert.equal(native.alias.presented, true);assert.equal(finding.name.presented, true);assert.equal(finding.alias.presented, true);
    assert.deepEqual(finding.name.typography, native.name.typography, 'Finding author typography differs from the mounted same-account donor');
    assert.deepEqual(finding.alias.typography, native.alias.typography, 'Finding alias typography differs from the mounted same-account donor');
    if (native.avatar?.presented && native.avatar.width > 0 && native.avatar.height > 0 && native.avatar.width <= 128 && native.avatar.height <= 128) {
      assert.equal(native.tuple.avatarAuthor, F.author);assert.equal(native.tuple.avatarLogin, F.login);assert.equal(native.tuple.avatarProfile, native.tuple.profile);assert.equal(new URL(native.avatar.src).protocol, 'https:');
      assert.equal(finding.avatarCount, 1);assert.equal(finding.slotCount, 1);assert.ok(finding.avatar?.presented && finding.slot?.presented, 'Finding avatar and measured slot must both be visually presented');assert.equal(finding.avatar.src, native.avatar.src);assert.equal(finding.avatar.className, native.avatar.className);
      for (const key of ['width', 'height']) { assert.ok(Math.abs(finding.avatar[key] - native.avatar[key]) <= 0.5, `Finding avatar ${key} differs from the same-visit native measurement`);assert.ok(Math.abs(finding.slot[key] - native.avatar[key]) <= 0.5); }
    }
  }
}

export async function verifyGitLabAuthorReuse(page, item, { fixture, head, extensionId, readDigest, assertSources, readSettings, openReviewAncestors, poll }) {
  const proof = { status: 'running', scope: 'Same-account presentation reuse from one mounted native summary for three absent finding headers. No absent finding native paint, native hydration, source fetch or service inference. Typography covers the currently selected native theme only.', sourceGets: [], otherGets: [], samples: [] };
  item.authorReuse = proof;
  const request = (value) => { const observed = observeGreptileCommandRequest(value, extensionId);if (observed === null) return;const list = observed.acquisition ? proof.sourceGets : proof.otherGets;if (list.length < 40) list.push(observed);else proof.requestOverflow = true; };
  const signature = () => createHash('sha256').update(JSON.stringify(fixture.discussions.map((page) => page.selected))).digest('hex');
  let retained = false;let completed = false;
  page.on('request', request);
  try {
    assert.match(head, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
    proof.beforeDigest = structuredClone(await readDigest());assertSources(proof.beforeDigest);proof.settings = structuredClone(await readSettings());proof.sourceSignature = signature();
    assert.equal(proof.settings.aiEnabled, false);assert.equal(proof.beforeDigest.selectedHead, head);
    const selected = fixture.discussions.find((page) => page.discussionCount === 36 && page.noteCount === 40 && page.nextCursor === null)?.selected ?? [];
    const records = F.ids.map((id) => selected.find((record) => record.id === id));
    assert.equal(selected.filter((record) => record.id === '3381334808' && record.author.id === F.author && record.author.username === F.login).length, 1);
    for (const record of records) { assert.ok(record);assert.equal(selected.filter((source) => source.id === record.id).length, 1);assert.equal(record.author.id, F.author);assert.equal(record.author.username, F.login);assert.equal(record.url, `${F.url}#note_${record.id}`);assert.match(record.bodySha256, /^[a-f0-9]{64}$/); }
    proof.records = records.map(({ id, author, url, createdAt, updatedAt, bodySha256, resolved, active, path, line }) => ({ id, author, url, createdAt, updatedAt, bodySha256, resolved, active, path, line }));
    const read = async () => { const value = await page.evaluate(gitLabAuthorReuseProbe, records);proof.samples.push(value);if (proof.samples.length > 4) proof.samples.shift();return value; };
    proof.precondition = await read();
    for (const finding of proof.precondition.findings) assert.equal(finding.invalidAnchorCount, 0, 'An invalid source ID must fail rather than mask missing account presentation');
    if (proof.precondition.findings.some((finding) => finding.nativeCount !== 0)) { proof.status = 'unavailable';proof.reason = 'A finding now has native DOM, so this visit cannot accept absent-header account reuse.';return proof; }
    assertComparison(proof.precondition, records, head, false);
    await page.evaluate(beginGitLabAuthorReuseProbe);retained = true;
    proof.openedSummaries = [];
    for (const record of records) proof.openedSummaries.push(await openReviewAncestors(page, `article.geld-provider-review__source[data-geld-source="note_${record.id}"] > .geld-provider-review__byline`));
    proof.comparison = await poll(read, (value) => { if (value.findings.some((finding) => finding.nativeCount !== 0 || finding.invalidAnchorCount !== 0)) return true;try { assertComparison(value, records, head, true);return true; } catch (error) { proof.lastComparisonError = error instanceof Error ? error.message : String(error);return false; } }, 'Absent finding account presentation matches its independently bound mounted native donor', 8000);
    for (const finding of proof.comparison.findings) assert.equal(finding.invalidAnchorCount, 0, 'A late copied or invalid ID cannot masquerade as a native finding');
    if (proof.comparison.findings.some((finding) => finding.nativeCount !== 0)) { proof.status = 'unavailable';proof.reason = 'A native finding mounted during comparison, so absent-header account reuse was not accepted.';return proof; }
    assertComparison(proof.comparison, records, head, true);assert.equal(proof.comparison.native.sameNode, true);assert.deepEqual(proof.comparison.native.tuple, proof.precondition.native.tuple);
    assert.deepEqual(proof.comparison.findings.map((finding) => finding.sourceTuple), proof.precondition.findings.map((finding) => finding.sourceTuple));
    proof.avatarCoverage = proof.comparison.native.avatar?.presented && proof.comparison.native.avatar.width > 0 && proof.comparison.native.avatar.height > 0 && proof.comparison.native.avatar.width <= 128 && proof.comparison.native.avatar.height <= 128 ? 'Compared to the measured mounted native donor in this visit.' : 'Unavailable: native donor avatar was not measurable. No pixel value was inferred.';
    proof.afterDigest = await readDigest();assertSources(proof.afterDigest, proof.beforeDigest);assert.deepEqual(proof.afterDigest.items, proof.beforeDigest.items);assert.deepEqual(proof.afterDigest.bots, proof.beforeDigest.bots);
    assert.deepEqual(await readSettings(), proof.settings);assert.equal(signature(), proof.sourceSignature);assert.equal(proof.afterDigest.selectedHead, head);assert.equal(page.url().split('#')[0], F.url);
    assert.ok(fixture.metadata.length > 0 && fixture.metadata.every((value) => value.sha === head && value.diffHead === head && String(value.projectId) === F.project && String(value.noteableId) === F.review && String(value.iid) === F.iid && value.webUrl === F.url));
    assert.equal(proof.requestOverflow ?? false, false);assert.deepEqual(proof.sourceGets, [], 'Author comparison caused extension-attributed or recognized source acquisition');assert.deepEqual(fixture.errors, []);assert.deepEqual(fixture.providerMutations, []);assert.deepEqual(fixture.aiRequests, []);
    completed = true;
  } catch (error) { proof.status = 'failed';proof.error = error instanceof Error ? error.message : String(error);throw error; }
  finally {
    try {
      if (retained) { assert.equal(page.isClosed(), false);proof.cleanup = await page.evaluate(endGitLabAuthorReuseProbe);assert.equal(proof.cleanup.stateRemoved, true); }
      assert.equal(proof.requestOverflow ?? false, false);assert.deepEqual(proof.sourceGets, [], 'Author comparison cleanup caused extension-attributed or recognized source acquisition');
      if (completed) proof.status = 'passed';
    } catch (error) { proof.status = 'failed';proof.cleanupError = error instanceof Error ? error.message : String(error);throw error; }
    finally { page.off('request', request);proof.listenerDisposed = true; }
  }
  return proof;
}

function beginAuthorThemeLifetime() {
  if (globalThis.__geldAuthorReuseThemesNative !== undefined) throw new Error('Author theme lifetime was already retained.');
  const root = document.getElementById('note_3381334808');
  globalThis.__geldAuthorReuseThemesNative = { root, parent: root?.parentElement, url: location.href.split('#')[0] };
}

function endAuthorThemeLifetime() {
  const held = globalThis.__geldAuthorReuseThemesNative;delete globalThis.__geldAuthorReuseThemesNative;
  if (held === undefined || location.href.split('#')[0] !== held.url || !held.root?.isConnected
    || document.getElementById('note_3381334808') !== held.root || held.root.parentElement !== held.parent) throw new Error('Native donor lifetime changed during author theme comparison.');
  return { stateRemoved: globalThis.__geldAuthorReuseThemesNative === undefined, sameNative: true };
}

function themeSignature(value) {
  const { tuple, name, alias, aliasHref, avatar } = value.native;
  return { url: value.url, panelCount: value.panelCount, theme: value.theme, selected: value.selected,
    native: { tuple, name, alias, aliasHref, avatar }, findings: value.findings };
}

/** The same independent phase runs three times. The outer listener also covers media-transition gaps. */
export async function verifyGitLabAuthorReuseThemes(page, item, options) {
  const proof = { status: 'running', scope: 'Same-visit native system-theme light, OS-dark preference and restored author-donor comparisons. No class/style injection, native finding hydration or absent-header pixel claim.',
    phases: {}, sourceGets: [], otherGets: [], transitionSamples: { dark: [], restored: [] }, mediaRestored: false };
  item.authorReuseThemes = proof;
  const errors = [];let retained = false;let lightPassed = false;
  const records = options.fixture.discussions.find((value) => value.discussionCount === 36 && value.noteCount === 40 && value.nextCursor === null)?.selected.filter((record) => F.ids.includes(record.id)) ?? [];
  const request = (value) => { const observed = observeGreptileCommandRequest(value, options.extensionId);if (observed === null) return;const list = observed.acquisition ? proof.sourceGets : proof.otherGets;if (list.length < 40) list.push(observed);else proof.requestOverflow = true; };
  const read = async (stage) => {
    const value = await page.evaluate(gitLabAuthorReuseProbe, records);
    if (stage !== undefined) { proof.transitionSamples[stage].push(value);if (proof.transitionSamples[stage].length > 4) proof.transitionSamples[stage].shift(); }
    return value;
  };
  const phase = async (name) => {
    const target = name === 'light' ? item : {};
    try {
      const result = await verifyGitLabAuthorReuse(page, target, options);
      if (name !== 'light' && proof.phases.light?.status === 'passed') {
        assert.deepEqual(result.settings, proof.phases.light.settings, 'Author theme comparison changed the original settings');
        assert.deepEqual(result.beforeDigest, proof.phases.light.beforeDigest, 'Author theme comparison changed the original source/item/verdict digest');
        assert.equal(result.sourceSignature, proof.phases.light.sourceSignature, 'Author theme comparison changed the original fetched source fingerprint');
        assert.deepEqual(result.records, proof.phases.light.records);
      }
      if (result.status === 'passed') assert.equal(result.comparison.native.sameThemeNode, true);
      return result;
    }
    finally { proof.phases[name] = target.authorReuse; }
  };
  const colors = (value) => [value.native.name?.typography.color, value.native.alias?.typography.color];
  const palette = (value) => ({ theme: value.theme, nativeName: value.native.name?.typography, nativeAlias: value.native.alias?.typography,
    findings: value.findings.map((finding) => ({ id: finding.id, name: finding.name?.typography, alias: finding.alias?.typography })) });
  page.on('request', request);
  try {
    await page.evaluate(beginAuthorThemeLifetime);retained = true;
    proof.original = await read();proof.originalSignature = themeSignature(proof.original);
    const light = await phase('light');lightPassed = light.status === 'passed';
    if (lightPassed) {
      assert.equal(proof.original.native.sameThemeNode, true);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      await options.pause(300);
      await options.poll(() => read('dark'), (value) => value.theme.osDark && value.native.sameThemeNode === true, 'OS dark preference is observed on the original native donor', 8000);
      const dark = await phase('dark');
      proof.nativeThemeChanged = dark.status === 'passed' && proof.original.theme.system && !proof.original.theme.dark && !proof.original.theme.osDark
        && dark.comparison.theme.system && dark.comparison.theme.dark && dark.comparison.theme.osDark
        && JSON.stringify(colors(proof.original)) !== JSON.stringify(colors(dark.comparison));
      if (dark.status === 'passed') proof.validatedDarkSignature = palette(dark.comparison);
      proof.darkMeasurement = await read('dark');
      assert.equal(proof.darkMeasurement.native.sameThemeNode, true);
      if (proof.validatedDarkSignature !== undefined) assert.deepEqual(palette(proof.darkMeasurement), proof.validatedDarkSignature, 'Later theme evidence differs from the independently validated author comparison');
      proof.darkAcceptance = dark.status === 'passed' && proof.nativeThemeChanged ? 'native_scheme_observed' : 'unavailable';
      if (proof.darkAcceptance === 'unavailable') proof.reason = 'The native system theme did not visibly change, or the finding fixture changed; dark author reuse was not accepted from OS preference alone.';
    } else proof.reason = 'The original author phase is unavailable; no cross-theme reuse was accepted.';
  } catch (error) { errors.push(error);proof.error = error instanceof Error ? error.message : String(error); }
  finally {
    try {
      await page.emulateMediaFeatures([]);
      proof.mediaCleared = true;
      await options.pause(300);
      if (proof.originalSignature !== undefined) {
        proof.restoredMeasurement = await options.poll(() => read('restored'), (value) => value.native.sameThemeNode === true
          && JSON.stringify(themeSignature(value)) === JSON.stringify(proof.originalSignature), 'Full original native author/theme/source signature is restored', 8000);
        if (lightPassed) {
          const restored = await phase('restored');assert.equal(restored.status, 'passed', 'Restored author comparison did not pass independently');
          proof.afterRestored = await read('restored');assert.deepEqual(themeSignature(proof.afterRestored), proof.originalSignature);assert.equal(proof.afterRestored.native.sameThemeNode, true);
        }
      }
      proof.mediaRestored = proof.originalSignature !== undefined;
    } catch (error) { errors.push(error);proof.restorationError = error instanceof Error ? error.message : String(error); }
    try {
      if (retained) proof.cleanup = await page.evaluate(endAuthorThemeLifetime);
      assert.equal(proof.requestOverflow ?? false, false);assert.deepEqual(proof.sourceGets, [], 'Author theme phases or transitions caused source acquisition');
      assert.deepEqual(options.fixture.errors, []);assert.deepEqual(options.fixture.providerMutations, []);assert.deepEqual(options.fixture.aiRequests, []);
    } catch (error) { errors.push(error);proof.cleanupError = error instanceof Error ? error.message : String(error); }
    finally { page.off('request', request);proof.listenerDisposed = true; }
  }
  if (errors.length > 0) { proof.status = 'failed';throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Author theme comparison or restoration failed'); }
  proof.status = lightPassed && proof.darkAcceptance === 'native_scheme_observed' ? 'passed' : 'unavailable';
  return proof;
}
