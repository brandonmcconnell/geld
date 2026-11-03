import assert from 'node:assert/strict';

export const BITBUCKET_NATIVE_BASH = {
  url: 'https://bitbucket.org/atlassian/ssh-run/commits/ee12dbf75a6f05494d13f6c5cda7a93bdefab1f6',
  repository: 'atlassian/ssh-run', commit: 'ee12dbf75a6f05494d13f6c5cda7a93bdefab1f6', parent: 'ae00b96da137254f92455cf968fb4f163221784c', path: 'pipe/pipe.sh',
  sourceBlob: '60c8ec9a0e2f9bcfc9ae2df2e3cc1a6906a090b2',
  sourceSamples: [
    { line: 24, text: '  # required parameters', sourceRoles: ['comment'] },
    { line: 69, text: '  if [ ! -z ${EXTRA_ARGS_COUNT} ]; then', sourceRoles: ['keyword', 'variable'] },
    { line: 70, text: "    init_array_var 'EXTRA_ARGS';", sourceRoles: ['quoted_string'] },
    { line: 72, text: '    IFS=\' \' read -r -a EXTRA_ARGS <<< "${EXTRA_ARGS}"', sourceRoles: ['builtin_read', 'quoted_string', 'variable', 'here_string'] },
    { line: 81, text: '  if [[ ${MODE} = "command" ]]; then', sourceRoles: ['keyword', 'variable', 'quoted_string'] },
  ],
};

/** Observe already-issued native demand only, never fetch an oracle or execute provider code. */
export function observeNativeBashSources(page, item, { safeUrl, extensionId }) {
  const evidence = { requests: [], mutations: [], metadata: [], errors: [], requestCount: 0, mutationCount: 0, extensionFrameCount: 0, truncated: false };
  const pending = new Set();
  item.nativeBashRequests = evidence;
  const apiPath = (value) => {
    try {
      const url = new URL(value);
      if (url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/')) return url.pathname.slice('/!api'.length);
      return url.origin === 'https://api.bitbucket.org' && url.pathname.startsWith('/2.0/') ? url.pathname : null;
    } catch { return null; }
  };
  const request = (value) => {
    if (apiPath(value.url()) === null) return;
    const frames = [];let stack = value.initiator?.()?.stack;
    for (let depth = 0; stack != null && depth < 8; depth += 1) { frames.push(...(stack.callFrames ?? []).map((frame) => frame.url));stack = stack.parent; }
    const record = { url: safeUrl(value.url()), method: value.method(), extensionFrameObserved: frames.some((frame) => frame?.startsWith(`chrome-extension://${extensionId}/`)) };
    evidence.requestCount += 1;if (record.extensionFrameObserved) evidence.extensionFrameCount += 1;
    if (evidence.requests.length < 80) evidence.requests.push(record);else evidence.truncated = true;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(record.method)) { evidence.mutationCount += 1;if (evidence.mutations.length < 8) evidence.mutations.push(record); }
  };
  const response = (value) => {
    if (value.request().method() !== 'GET' || value.status() !== 200 || apiPath(value.url()) !== `/2.0/repositories/${BITBUCKET_NATIVE_BASH.repository}/commit/${BITBUCKET_NATIVE_BASH.commit}`) return;
    const task = (async () => {
      try {
        assert.ok(!(Number(value.headers()['content-length']) > 128 * 1024), 'Already-issued commit metadata exceeds128KiB bound');
        const body = await value.json();
        assert.equal(body?.hash, BITBUCKET_NATIVE_BASH.commit, 'Observed native commit metadata changed the immutable source');
        if (Object.hasOwn(body, 'repository')) assert.ok(body.repository !== null && typeof body.repository === 'object' && !Array.isArray(body.repository), 'Malformed present native repository');
        const repository = body.repository?.full_name;
        if (repository !== undefined) assert.equal(repository, BITBUCKET_NATIVE_BASH.repository);
        let parents = null;let parentEvidence = null;
        if (Object.hasOwn(body, 'parents')) {
          assert.ok(Array.isArray(body.parents) && body.parents.length === 1, 'Observed native parent collection contradicts the Git-proven single parent');
          parentEvidence = body.parents.map((parent) => {
            const hash = parent?.hash;
            assert.ok(typeof hash === 'string' && /^(?:[a-f0-9]{7,40}|[a-f0-9]{64})$/i.test(hash), 'Malformed supplied native parent hash');
            assert.ok(BITBUCKET_NATIVE_BASH.parent.startsWith(hash.toLowerCase()), 'Observed native parent hash contradicts the Git-proven parent');
            return { suppliedHash: hash, characters: hash.length, precision: hash.length === BITBUCKET_NATIVE_BASH.parent.length ? 'full' : 'prefix', agreesWithGitParent: true };
          });
          parents = parentEvidence.map((parent) => parent.suppliedHash);
        }
        if (evidence.metadata.length < 4) evidence.metadata.push({ url: safeUrl(value.url()), hash: body.hash, repository: repository ?? null, parents, parentEvidence });
      } catch (error) { if (evidence.errors.length < 8) evidence.errors.push(error instanceof Error ? error.message : String(error)); }
    })();
    pending.add(task);void task.finally(() => pending.delete(task));
  };
  const stop = () => { page.off('request', request);page.off('response', response); };
  page.on('request', request);page.on('response', response);page.once('close', stop);
  return { evidence, flush: async () => { await Promise.all([...pending]); }, stop };
}

export function nativeBashStyleSnapshot(fixture) {
  const current = new URL(location.href);const expected = new URL(fixture.url);
  const scope = current.origin === expected.origin && current.pathname === expected.pathname && current.search === '';
  if (!scope) return { status: 'wrong_document', url: current.href };
  const native = (node) => node !== null && node.closest('[data-geld-ui]') === null;
  const containers = [...document.querySelectorAll('[role="region"][aria-label="Diff"]')].filter(native);
  if (containers.length !== 1) return { status: 'diff_region_unavailable', count: containers.length, url: current.href };
  const roots = [...containers[0].querySelectorAll(':scope > div')].filter((root) => [...root.children].some((node) => node.id === `chg-${fixture.path}`) && native(root));
  if (roots.length !== 1) return { status: 'file_root_unavailable', count: roots.length, url: current.href };
  const root = roots[0];const view = document.defaultView;
  const bounds = (node) => { const r = node.getBoundingClientRect();return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const style = (node, pseudo) => {
    try {
      const s = view.getComputedStyle(node, pseudo);
      return { color: s.color, backgroundColor: s.backgroundColor, fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, fontStyle: s.fontStyle, textDecorationColor: s.textDecorationColor, textShadow: s.textShadow };
    } catch { return null; }
  };
  const presented = (node) => {
    if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]') !== null) return false;
    for (let p = node; p !== null; p = p.parentElement) { const s = view.getComputedStyle(p);if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.opacity === '0' || s.contentVisibility === 'hidden') return false; }
    const r = node.getBoundingClientRect();return r.width > 0 && r.height > 0;
  };
  const header = root.querySelector('article[data-qa="branch-diff-file"] [data-qa="bk-file__header"][data-testid="file-header"]');
  const content = root.querySelector('[data-testid="file-content"][data-qa="bk-file__content"]');
  const links = [...document.querySelectorAll('#file-tree a[href]')].filter((node) => native(node) && node.getAttribute('href') === `#chg-${fixture.path}`);
  const rows = [...root.querySelectorAll('[data-qa="code-line"]')].filter(native);
  const limits = { maximumHighlights: 80, maximumRanges: 512, maximumTextNodesPerSample: 32 };
  const registry = { supported: typeof CSS !== 'undefined' && CSS.highlights !== undefined, entries: [], ranges: [], errors: [], truncated: false };
  if (registry.supported) {
    let total = 0;
    for (const [name, highlight] of CSS.highlights) {
      if (registry.entries.length >= limits.maximumHighlights) { registry.truncated = true;break; }
      registry.entries.push({ name, priority: highlight.priority ?? null, type: highlight.type ?? null, size: highlight.size ?? null, ownedName: name.startsWith('geld-') });
      for (const range of highlight) {
        if (total >= limits.maximumRanges) { registry.truncated = true;break; }
        total += 1;registry.ranges.push({ name, range });
      }
      if (registry.truncated) break;
    }
  }
  const point = (container, offset) => { const r = document.createRange();r.setStart(container, offset);r.collapse(true);return r; };
  const compare = (a, b) => a.compareBoundaryPoints(0, b);
  const samples = fixture.sourceSamples.map((expectedSample) => {
    const matches = rows.filter((row) => row.querySelector('[data-key="code-line-number"]')?.getAttribute('data-new-line-number') === String(expectedSample.line));
    if (matches.length !== 1) return { line: expectedSample.line, status: matches.length === 0 ? 'not_mounted' : 'ambiguous', matches: matches.length };
    const row = matches[0];const code = row.querySelector('[data-line-type]');
    if (!native(code) || ![' ', '+'].includes(code.getAttribute('data-line-type'))) return { line: expectedSample.line, status: 'unsupported_line_surface' };
    if (code.textContent !== expectedSample.text) return { line: expectedSample.line, status: 'source_mismatch', actualText: code.textContent, expectedText: expectedSample.text };
    const nodes = [];const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);let offset = 0;let truncated = false;
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      if (nodes.length >= limits.maximumTextNodesPerSample) { truncated = true;break; }
      const start = offset;offset += text.data.length;
      const paint = [];
      for (const { name, range } of registry.ranges) {
        try {
          if (!range.startContainer.isConnected || !range.endContainer.isConnected) continue;
          const a = point(range.startContainer, range.startOffset);const b = point(range.endContainer, range.endOffset);
          const c = point(text, 0);const d = point(text, text.data.length);
          if (compare(b, c) <= 0 || compare(a, d) >= 0) continue;
          const from = range.startContainer === text ? range.startOffset : 0;
          const to = range.endContainer === text ? range.endOffset : text.data.length;
          if (to <= from) continue;
          paint.push({ name, ownedName: name.startsWith('geld-'), start: start + from, end: start + to, text: text.data.slice(from, to), pseudoStyle: typeof CSS.escape === 'function' ? style(text.parentElement, `::highlight(${CSS.escape(name)})`) : null });
        } catch { if (registry.errors.length < 8) registry.errors.push({ name, reason: 'Original-node highlight range could not be compared' }); }
      }
      nodes.push({ start, end: offset, text: text.data, parentTag: text.parentElement.tagName, parentClass: text.parentElement.className, parentStyle: style(text.parentElement), highlights: paint });
    }
    const r = bounds(code);const visible = presented(code);
    return { line: expectedSample.line, status: 'matched_original', text: code.textContent, sourceRoles: expectedSample.sourceRoles, nativeLineType: code.getAttribute('data-line-type'),
      presented: visible, inViewport: visible && r.right > 0 && r.left < view.innerWidth && r.bottom > 0 && r.top < view.innerHeight, bounds: r, codeStyle: style(code),
      spanCount: code.querySelectorAll('span').length, spansTruncated: code.querySelectorAll('span').length > 40, spans: [...code.querySelectorAll('span')].slice(0, 40).map((node) => ({ className: node.className, text: node.textContent.slice(0, 220), style: style(node) })), nodes, truncated };
  });
  const computed = view.getComputedStyle(root);
  const properties = ['--ds-text-code-default', '--ds-text-code-keywords', '--ds-text-code-functions', '--ds-text-code-numbers', '--ds-text-code-strings', '--ds-text-code-comments', '--ds-text-code-accent-1', '--ds-text-code-tags'];
  return { status: 'observed', url: current.href, path: fixture.path, anchor: `chg-${fixture.path}`, rootCount: roots.length,
    header: header === null ? null : { text: header.textContent, canToggle: header.getAttribute('aria-disabled') !== 'true' && header.querySelector('[aria-label="Expand/collapse file"]') !== null },
    contentExpanded: content !== null && content.closest('[aria-hidden="true"]') === null, placeholder: root.querySelector('pre[data-testid="pr-diff-placeholder-wrapper"]') !== null,
    treeMatches: links.length, treeLinkPresented: links.length === 1 && presented(links[0]), samples, highlights: { supported: registry.supported, entries: registry.entries, errors: registry.errors, truncated: registry.truncated, rangesScanned: registry.ranges.length, limits },
    theme: { colorMode: document.documentElement.getAttribute('data-color-mode'), theme: document.documentElement.getAttribute('data-theme'), variables: Object.fromEntries(properties.map((key) => [key, computed.getPropertyValue(key).trim()])) },
    ownership: { ownedUi: root.querySelectorAll('[data-geld-ui]').length, ownedHighlights: registry.entries.filter((entry) => entry.ownedName).map((entry) => entry.name) },
    unknowns: ['Native semantic token mapping and exact classifier equivalence are not inferred', 'Authoritative native syntax-highlighting preference is not read by this slice', 'Native selected dark mode is not exercised', ...(registry.supported ? [] : ['CSS Custom Highlights API unavailable']), ...(registry.truncated ? ['Custom-highlight scan truncated at its explicit cap'] : []), ...(registry.errors.length > 0 ? ['Some native ranges could not be compared'] : []), ...(samples.some((sample) => sample.truncated || sample.spansTruncated) ? ['Some original text/span samples exceed the explicit cap'] : [])],
    classification: 'Source roles identify Git-proven source examples only. Native span classes and matching custom-highlight names/pseudo-colors are observations, with no invented semantic mapping. Offscreen DOM styles do not establish viewport paint.' };
}

export async function discoverNativeBash(page, item, { poll, tabState, capture, source }) {
  const evidence = { status: 'reading', actions: [], samples: [], source: BITBUCKET_NATIVE_BASH, interpretation: 'Native discovery only, never a Geld feature pass or proof of classifier equivalence.' };
  item.nativeBashStyle = evidence;
  const read = () => page.evaluate(nativeBashStyleSnapshot, BITBUCKET_NATIVE_BASH);
  const scope = () => { const current = new URL(page.url());return current.origin + current.pathname === BITBUCKET_NATIVE_BASH.url && current.search === ''; };
  try {
    evidence.disabledState = await poll(() => tabState(page), (value) => value.allowed === false && value.hasDiff === false, 'Actual installed master-disabled native Bash discovery', 10000);
    evidence.initial = await poll(read, (value) => value.status === 'observed', 'One exact native pipe/pipe.sh wrapper on the immutable commit', 15000);
    const selector = '[role="region"][aria-label="Diff"] > div:has(> [id="chg-pipe/pipe.sh"])';
    assert.ok(scope(), 'Native Bash source route changed before reveal');
    if (evidence.initial.treeMatches === 1 && evidence.initial.treeLinkPresented) {
      const link = await page.$('#file-tree a[href="#chg-pipe/pipe.sh"]');
      try { assert.ok(link !== null);await link.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'auto' }));await link.click();evidence.actions.push('Trusted pointer click on the one original pipe/pipe.sh file-tree link'); }
      finally { await link?.dispose(); }
    }
    await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center', behavior: 'auto' }));
    evidence.actions.push('One native target-wrapper scroll, limited to pipe/pipe.sh');
    const hydrated = await poll(read, (value) => value.status === 'observed' && value.header !== null, 'Native target file header hydrates after bounded reveal', 10000);
    assert.ok(scope(), 'Native Bash source route changed during reveal');
    if (!hydrated.contentExpanded) {
      assert.equal(hydrated.header.canToggle, true, 'Unknown native collapsed-file control');
      const header = await page.$(`${selector} article[data-qa="branch-diff-file"] [data-qa="bk-file__header"][data-testid="file-header"]`);
      try { assert.ok(header !== null);await header.click();evidence.actions.push('Trusted pointer click on the verified target file header to expand'); }
      finally { await header?.dispose(); }
    }
    const complete = (value) => value.status === 'observed' && value.samples.length === BITBUCKET_NATIVE_BASH.sourceSamples.length && value.samples.every((sample) => sample.status === 'matched_original');
    evidence.before = await poll(async () => { const value = await read();evidence.samples.push(value);if (evidence.samples.length > 3) evidence.samples.shift();return value; }, complete, 'Exact Git-proven original new-side Bash source samples', 10000);
    assert.deepEqual(evidence.before.ownership.ownedHighlights, []);assert.equal(evidence.before.ownership.ownedUi, 0);
    await page.$eval(`${selector} [data-qa="code-line"]:has([data-key="code-line-number"][data-new-line-number="72"])`, (node) => node.scrollIntoView({ block: 'center', behavior: 'auto' }));
    evidence.actions.push('One original new-line72 scroll within the same target file');
    evidence.presented = await poll(read, (value) => complete(value) && value.samples.find((sample) => sample.line === 72)?.inViewport === true, 'Original native builtin line reaches the viewport after its bounded scroll', 5000);assert.ok(complete(evidence.presented));
    assert.equal(evidence.presented.samples.find((sample) => sample.line === 72)?.inViewport, true, 'The real target builtin source line must be presented after bounded scroll');
    evidence.artifacts = await capture(page, 'bitbucket-native-bash-style');
    evidence.after = await read();assert.ok(complete(evidence.after));assert.ok(scope());
    await source.flush();assert.deepEqual(source.evidence.errors, []);assert.deepEqual(source.evidence.mutations, []);
    assert.equal(source.evidence.extensionFrameCount, 0, 'Master-disabled discovery observed extension-origin API demand');assert.equal(source.evidence.mutationCount, 0);
    evidence.sourceBinding = { requestedImmutableUrl: BITBUCKET_NATIVE_BASH.url, currentUrl: page.url(), matchedOriginalSamples: evidence.after.samples.map((sample) => sample.line), nativeMetadata: source.evidence.metadata,
      metadataCoverage: source.evidence.metadata.length > 0 ? 'Observed already-issued native metadata, with only fields actually present validated' : 'No matching native commit response observed; immutable URL and original-source samples only' };
    evidence.status = 'discovery';
    return { status: 'discovery', featureParity: 'not_evaluated', reason: 'Master-disabled native Bash diff source/style discovery. Exact source samples and observed span/custom-highlight styles only; no invented token mapping, selected-dark equivalence or extension feature pass.' };
  } catch (error) { evidence.status = 'unavailable';evidence.error = error instanceof Error ? error.message : String(error);throw error; }
}
