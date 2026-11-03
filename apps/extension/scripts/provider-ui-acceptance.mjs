import assert from 'node:assert/strict';

export const GITLAB_LOCAL_REVIEW = Object.freeze({
  url: 'https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117',
  anchor: 'note_3412014628', authorId: '9249395',
  provenance: 'Retained public installed run41388609871: open human source by ErikDeSmedt; availability must be rechecked live.',
});

/** Resolve the hint belonging to the actual native count group, never a different header. */
export function providerHeaderHintTarget(groupSelector, kind = 'anchor') {
  const visible = node => {
    if (!node?.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const box = node.getBoundingClientRect();
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return box.width > 0 && box.height > 0;
  };
  const group = [...document.querySelectorAll(groupSelector)].find(visible);
  if (!group) return null;
  let anchor = null;
  for (let scope = group; scope && scope !== document.body; scope = scope.parentElement) {
    const hints = [...scope.querySelectorAll('.geld-provider-header-stats, .geld-provider-header-hidden-count')]
      .filter(node => !node.matches('.geld-provider-header-hidden-count') || !node.closest('.geld-provider-header-stats'))
      .filter(visible);
    if (scope.matches('.geld-provider-header-stats, .geld-provider-header-hidden-count') && visible(scope)) hints.unshift(scope);
    if (hints.length > 1) return null;
    if (hints.length === 1) { anchor = hints[0];break; }
  }
  if (!anchor || kind === 'anchor') return anchor;
  if (kind !== 'keyboard') return null;
  if (anchor.tabIndex >= 0 && anchor.hasAttribute('data-geld-hover-bound')) return anchor;
  for (let owner = anchor.parentElement; owner && owner !== document.body; owner = owner.parentElement) {
    if (owner.tabIndex >= 0 && owner.hasAttribute('data-geld-hover-bound') && !owner.closest('[data-geld-ui]')) return owner;
  }
  return null;
}

/** Select a real actionable human item before any local-review interaction. */
export function gitLabLocalReviewedCandidate(requiredSource = null) {
  const buttons = [...document.querySelectorAll('.geld-provider-review [data-geld-local-reviewed]')];
  const counts = { total: Math.min(buttons.length, 1000), truncated: buttons.length > 1000, human: 0, disabled: 0, pressed: 0,
    states: { open: 0, 'needs-reply': 0, addressed: 0, resolved: 0, outdated: 0, 'done-manual': 0, other: 0 } };
  let candidate = null;
  for (const button of buttons.slice(0, 1000)) {
    const item = button.closest('[data-geld-item]');
    const state = item?.getAttribute('data-state');
    counts.states[Object.hasOwn(counts.states, state) ? state : 'other']++;
    const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
    const pressed = button.getAttribute('aria-pressed') !== 'false';
    if (disabled) counts.disabled++;
    if (pressed) counts.pressed++;
    const sources = [...item?.querySelectorAll('[data-geld-source]') ?? []].filter((entry) => {
      const byline = entry.querySelector(':scope > .geld-provider-review__byline');
      const native = document.getElementById(entry.getAttribute('data-geld-source'));
      return byline !== null && ![...byline.children].some((node) => node.textContent.trim() === 'Automated account')
        && native !== null && native.querySelector('.note-header a.author-name-link[data-user-id]') !== null;
    });
    if (sources.length > 0) counts.human++;
    const source = requiredSource === null ? sources[0] : sources.find(entry => entry.getAttribute('data-geld-source') === requiredSource.anchor && document.getElementById(requiredSource.anchor)?.querySelector('.note-header a.author-name-link[data-user-id]')?.getAttribute('data-user-id') === requiredSource.authorId);
    const id = button.getAttribute('data-geld-local-reviewed');
    if (candidate === null && id && !disabled && !pressed && ['open', 'needs-reply', 'addressed'].includes(state) && source !== undefined) {
      candidate = { id, humanAnchor: source.getAttribute('data-geld-source'), pressed: button.getAttribute('aria-pressed'), disabled: button.disabled };
    }
  }
  return { candidate, counts };
}

/** Browser-side rendered evidence only: no API, source injection or product getters. */
export function providerUiProbe(provider) {
  const rect = (node) => {
    if (!node) return null;
    const value = node.getBoundingClientRect();
    return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
  };
  const visible = (node) => {
    if (!node?.isConnected || !node.getClientRects().length) return false;
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hasAttribute('inert') || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    }
    const box = rect(node);
    return box.width > 0 && box.height > 0;
  };
  const onScreen = (node) => {
    if (!visible(node)) return false;
    const box = rect(node);
    return box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
  };
  const signed = (node, sign) => {
    if (!onScreen(node)) return null;
    const match = (node.textContent ?? '').trim().match(sign === '+' ? /^\+\s*([\d,]+)$/ : /^[−-]\s*([\d,]+)$/);
    if (!match) return null;
    const value = Number(match[1].replaceAll(',', ''));
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const nativeGitLabSigned = (node, sign) => {
    const direct = signed(node, sign);
    if (direct !== null) return direct;
    if (!onScreen(node) || !/^[\d,]+$/.test((node.textContent ?? '').trim())) return null;
    const group = node.parentElement;
    if (!group?.matches('.diff-stats-group') || group.querySelectorAll('[data-testid="js-file-addition-line"], [data-testid="js-file-deletion-line"]').length !== 1) return null;
    const signs = [...group.children].filter(sibling => sibling !== node && onScreen(sibling) && (sign === '+' ? sibling.textContent?.trim() === '+' : /^[−-]$/.test(sibling.textContent?.trim() ?? '')));
    if (signs.length !== 1) return null;
    const value = Number(node.textContent.trim().replaceAll(',', ''));
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const countPairs = [];
  const counts = { additions: [], deletions: [] };
  for (const host of document.querySelectorAll('.geld-provider-header-line-counts')) {
    const additions = signed(host.querySelector('.geld-provider-header-line-counts__add'), '+');
    const deletions = signed(host.querySelector('.geld-provider-header-line-counts__del'), '-');
    if (additions !== null) counts.additions.push(additions);
    if (deletions !== null) counts.deletions.push(deletions);
    if (additions !== null && deletions !== null) countPairs.push({ kind: 'owned-header', additions, deletions, rect: rect(host) });
  }
  if (provider === 'gitlab') for (const host of document.querySelectorAll('.diff-stats.inline-parallel-buttons .diff-stats-contents')) {
    const additions = nativeGitLabSigned(host.querySelector('[data-testid="js-file-addition-line"]'), '+');
    const deletions = nativeGitLabSigned(host.querySelector('[data-testid="js-file-deletion-line"]'), '-');
    if (additions !== null) counts.additions.push(additions);
    if (deletions !== null) counts.deletions.push(deletions);
    if (additions !== null && deletions !== null) countPairs.push({ kind: 'native-header', additions, deletions, rect: rect(host) });
  }
  if (provider === 'bitbucket') for (const label of document.querySelectorAll('#file-tree h5')) {
    if (label.textContent?.trim() !== 'Lines updated') continue;
    const host = label.parentElement?.parentElement;
    const leaves = [...host?.querySelectorAll('span') ?? []].filter((node) => node.children.length === 0 && node.closest('[data-geld-ui]') === null);
    const additions = leaves.map((node) => signed(node, '+')).filter((value) => value !== null);
    const deletions = leaves.map((node) => signed(node, '-')).filter((value) => value !== null);
    counts.additions.push(...additions);counts.deletions.push(...deletions);
    if (additions.length === 1 && deletions.length === 1) countPairs.push({ kind: 'native-header', additions: additions[0], deletions: deletions[0], rect: rect(host) });
  }
  const popovers = [...document.querySelectorAll('.geld-provider-hover')].filter(visible).map((node) => ({ rect: rect(node), overflowX: getComputedStyle(node).overflowX, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  const categories = [...document.querySelectorAll('.geld-provider-category-header')].map((node) => {
    const label = node.textContent?.trim() ?? '';
    const kind = /^Essential\b/.test(label) ? 'essential' : /^Tests\b/.test(label) ? 'tests' : 'other';
    const id = node.getAttribute('aria-controls');
    const targets = id === null ? [] : [...document.querySelectorAll('[id]')].filter((target) => target.id === id);
    const target = targets.length === 1 ? targets[0] : null;
    return { kind, visible: visible(node), onScreen: onScreen(node), rect: rect(node), expanded: node.getAttribute('aria-expanded'), controlsPresent: target !== null, controlsVisible: visible(target), disabled: node.disabled === true, placement: node.closest('[data-geld-provider-category-placement="fallback"]') ? 'fallback' : 'sidebar' };
  });
  return { provider, viewport: { width: innerWidth, height: innerHeight }, counts: { additions: counts.additions.slice(0, 12), deletions: counts.deletions.slice(0, 12) }, countPairs: countPairs.slice(0, 12), popovers: popovers.slice(0, 4), categories: categories.slice(0, 24), truncated: counts.additions.length > 12 || counts.deletions.length > 12 || popovers.length > 4 || categories.length > 24 };
}

export function assertVisibleProviderCounts(snapshot, expected) {
  assert.equal(snapshot.truncated, false, 'UI evidence must be complete within its fixed bounds');
  assert.ok(snapshot.counts.additions.length > 0 && snapshot.counts.deletions.length > 0, 'Adjusted additions and deletions must be visibly rendered at the native header');
  for (const value of snapshot.counts.additions) assert.equal(value, expected.additions, 'Visible additions must agree with filtered runtime totals');
  for (const value of snapshot.counts.deletions) assert.equal(value, expected.deletions, 'Visible deletions must agree with filtered runtime totals');
}

export function assertCompactProviderPopover(snapshot) {
  assert.equal(snapshot.popovers.length, 1, 'Exactly one visible count popover is required');
  const popover = snapshot.popovers[0];
  assert.ok(popover.rect.width > 0 && popover.rect.width <= Math.min(360, snapshot.viewport.width - 16) + 1, 'Count popover must fit its compact native width');
  assert.ok(popover.rect.left >= 7 && popover.rect.right <= snapshot.viewport.width - 7, 'Count popover must stay inside viewport margins');
  assert.ok(popover.scrollWidth <= popover.clientWidth + 1, 'Count popover must not clip horizontal content');
}

export function assertDiscoverableProviderCategories(snapshot) {
  assert.equal(snapshot.truncated, false, 'Category evidence must be complete within its fixed bounds');
  for (const kind of ['essential', 'tests']) {
    const controls = snapshot.categories.filter((entry) => entry.kind === kind && entry.visible);
    assert.equal(controls.length, 1, `One visible ${kind} category control is required`);
    assert.equal(controls[0].onScreen, true, `${kind} must be discoverable in the current Files view`);
    assert.equal(controls[0].disabled, false, `${kind} must be actionable`);
    assert.equal(controls[0].controlsPresent, true, `${kind} must own an actual category panel`);
  }
}

/** Keep original native nodes in the browser; return only fixed counts and geometry. */
export function providerDashboardProbe(mode = 'read') {
  const key = '__geldDashboardAcceptance';
  if (mode === 'cleanup') { delete globalThis[key];return null; }
  const panels = [...document.querySelectorAll('.geld-provider-review')];
  const panel = panels.length === 1 ? panels[0] : null;
  const represented = new Set();
  for (const source of panel?.querySelectorAll('[data-geld-source]') ?? []) {
    const anchor = source.getAttribute('data-geld-source') ?? '';
    if (!/^(?:note_[1-9]\d*|comment-[1-9]\d*)$/.test(anchor)) continue;
    const native = document.getElementById(anchor);
    if (native && !panel.contains(native)) represented.add(native);
  }
  for (const source of panel?.querySelectorAll('[data-geld-event] a[href]') ?? []) {
    try {
      const target = new URL(source.href, location.href);
      if (target.origin !== location.origin || !/^#(?:note_[1-9]\d*|comment-[1-9]\d*)$/.test(target.hash)) continue;
      const native = document.getElementById(target.hash.slice(1));
      if (native && !panel.contains(native)) represented.add(native);
    } catch { /* An unavailable native source never becomes evidence. */ }
  }
  const visible = (node) => {
    if (!node?.isConnected || !node.getClientRects().length) return false;
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hasAttribute('inert') || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    }
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const appearance = (node) => {
    if (!node) return null;
    const style = getComputedStyle(node);
    let background = 'transparent';
    for (let parent = node; parent; parent = parent.parentElement) {
      const value = getComputedStyle(parent).backgroundColor;
      if (value && !['transparent', 'rgba(0, 0, 0, 0)'].includes(value)) { background = value;break; }
    }
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color, background };
  };
  const payloads = root => {
    const provider = panel?.getAttribute('data-provider');
    const selector = provider === 'gitlab' ? '[data-testid="noteable-note-container"], li.js-timeline-entry.system-note' : provider === 'bitbucket' ? '[data-testid="comment"][id]' : null;
    if (selector === null) return null;
    const entries = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)].filter(node => node.closest('[data-geld-ui]') === null);
    if (entries.length === 0) return null;
    const result = [];
    for (const entry of entries) {
      const bodySelector = provider === 'gitlab' ? entry.matches('li.js-timeline-entry.system-note') ? '[data-testid="system-note-content"]' : '.note-body .note-text' : '[data-testid="comment-content"] .ak-renderer-document';
      const bodies = [...entry.querySelectorAll(bodySelector)].filter(node => node.closest(selector) === entry && node.closest('[data-geld-ui]') === null);
      if (bodies.length !== 1) return null;
      result.push({ owner: entry, body: bodies[0] });
    }
    return result;
  };
  if (mode === 'bind' && panel && globalThis[key] === undefined) {
    const roots = [...document.querySelectorAll('[data-geld-provider-native-find="folded"]')].filter((node) => !panel.contains(node));
    if (roots.length > 0) globalThis[key] = { panel, url: location.href, roots: roots.map((node) => {
      const known = payloads(node);
      return { node, parent: node.parentElement, id: node.id, qualified: known !== null, payloads: (known ?? [{ owner: node, body: node }]).map(({ owner, body }) => ({ owner, parent: owner.parentElement, id: owner.id, text: body.textContent, html: known === null ? null : body.innerHTML })) };
    }) };
  }
  const state = globalThis[key];
  const native = state?.roots ?? [];
  const sections = [...panel?.querySelectorAll('[data-geld-review-key]') ?? []];
  const bound = state?.panel === panel && state?.url === location.href;
  const custody = { identityMismatches: 0, parentMismatches: 0, idMismatches: 0, bodyMismatches: 0, payloadOrderMismatches: 0, unqualifiedPayloads: 0 };
  const bodyChanges = [];
  const fingerprint = value => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return { length: value.length, hash: (hash >>> 0).toString(16) };
  };
  const difference = (before, after, path = [], budget = { remaining: 20000 }) => {
    if (--budget.remaining < 0) return { kind: 'scan-limit', path };
    if (!before || !after || before.nodeType !== after.nodeType || before.nodeName !== after.nodeName) return { kind: 'node-shape', path, beforeType: before?.nodeType ?? null, afterType: after?.nodeType ?? null };
    if (before.nodeType === 3 && before.textContent !== after.textContent) return { kind: 'text', path, before: fingerprint(before.textContent), after: fingerprint(after.textContent) };
    if (before.nodeType === 1) {
      const names = new Set([...before.attributes, ...after.attributes].map(attribute => attribute.name));
      for (const name of names) if (before.getAttribute(name) !== after.getAttribute(name)) return { kind: 'attribute', path, name: /^[a-z][a-z0-9:_-]{0,79}$/.test(name) ? name : 'other', before: fingerprint(before.getAttribute(name) ?? ''), after: fingerprint(after.getAttribute(name) ?? '') };
    }
    if (path.length >= 40) return { kind: 'depth-limit', path };
    for (let index = 0; index < Math.max(before.childNodes.length, after.childNodes.length); index++) {
      const result = difference(before.childNodes[index], after.childNodes[index], [...path, index], budget);
      if (result !== null) return result;
    }
    return null;
  };
  for (const entry of native) {
    if (!entry.node.isConnected || entry.node.ownerDocument !== document || entry.id !== '' && document.getElementById(entry.id) !== entry.node) custody.identityMismatches++;
    if (entry.node.parentElement !== entry.parent) custody.parentMismatches++;
    if (entry.node.id !== entry.id) custody.idMismatches++;
    if (!entry.qualified) custody.unqualifiedPayloads++;
    const current = entry.qualified ? payloads(entry.node) : [{ owner: entry.node, body: entry.node }];
    if (current === null || current.length !== entry.payloads.length) custody.bodyMismatches++;
    for (const [index, saved] of entry.payloads.entries()) {
      const found = current?.[index];
      if (saved.owner !== entry.node) {
        if (!saved.owner.isConnected || saved.owner.ownerDocument !== document || saved.id !== '' && document.getElementById(saved.id) !== saved.owner) custody.identityMismatches++;
        if (saved.owner.parentElement !== saved.parent) custody.parentMismatches++;
        if (saved.owner.id !== saved.id) custody.idMismatches++;
      }
      if (found?.owner !== saved.owner) custody.payloadOrderMismatches++;
      // Native hydration can replace equivalent inner wrappers. The original note/event
      // identity and its exact semantic content remain the authority, not that wrapper.
      if (found === undefined || found.body.textContent !== saved.text || saved.html !== null && found.body.innerHTML !== saved.html) {
        custody.bodyMismatches++;
        if (bodyChanges.length < 8) {
          const before = document.createElement('template');
          const after = document.createElement('template');
          if (saved.html !== null) before.innerHTML = saved.html;
          if (found !== undefined) after.innerHTML = found.body.innerHTML;
          bodyChanges.push({ source: /^(?:note_[1-9]\d*|comment-[1-9]\d*)$/.test(saved.id) ? saved.id : null, index,
            beforeText: fingerprint(saved.text ?? ''), afterText: fingerprint(found?.body.textContent ?? ''),
            beforeHtml: saved.html === null ? null : fingerprint(saved.html), afterHtml: found === undefined ? null : fingerprint(found.body.innerHTML),
            difference: saved.html === null || found === undefined ? { kind: 'unavailable' } : difference(before.content, after.content) });
        }
      }
    }
  }
  const sameOriginals = bound && custody.identityMismatches === 0 && custody.parentMismatches === 0 && custody.idMismatches === 0 && custody.bodyMismatches === 0 && custody.payloadOrderMismatches === 0;
  const sectionBindings = sections.map((section) => {
    const control = section.querySelector(':scope > button[data-geld-review-toggle]');
    const target = document.getElementById(control?.getAttribute('aria-controls') ?? '');
    return { key: section.dataset.geldReviewKey ?? null, id: section.id, primary: section.parentElement === panel, nativeDetails: section.tagName === 'DETAILS', toggle: visible(control), expanded: control?.getAttribute('aria-expanded') ?? null, ownsContent: target !== null && section.contains(target) && target.classList.contains('geld-provider-review__section-content') && control.id !== '' && target.getAttribute('aria-labelledby') === control.id, contentVisible: visible(target) };
  });
  const provider = panel?.getAttribute('data-provider');
  const nativeSelector = provider === 'gitlab' ? '.issuable-discussion [data-testid="noteable-note-container"] .timeline-content' : provider === 'bitbucket' ? '[data-qa="pull-request-description"]' : null;
  const nativeSurface = nativeSelector === null ? null : [...document.querySelectorAll(nativeSelector)].find((node) => node.closest('[data-geld-ui]') === null && (provider !== 'gitlab' || !['', 'transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(node).backgroundColor))) ?? null;
  const nativeBodyAppearance = appearance(document.body);
  const nativeSurfaceAppearance = appearance(nativeSurface);
  return {
    panelCount: panels.length, panelVisible: visible(panel), bound, sameOriginals, custody, bodyChanges,
    overviewVisible: visible(panel?.querySelector('[data-geld-review-overview]')),
    metrics: ['open', 'comments', 'activity'].map((name) => ({ name, visible: visible(panel?.querySelector(`[data-geld-review-metric="${name}"]`)) })),
    sectionBindings: sectionBindings.slice(0, 40), truncated: sectionBindings.length > 40 || native.length > 1000,
    originalCount: native.length, originalVisible: native.filter((entry) => visible(entry.node)).length,
    representedMounted: represented.size, representedVisible: [...represented].filter(visible).length,
    originalToggleCount: panel?.querySelectorAll('button[data-geld-original-conversation]').length ?? 0,
    appearance: appearance(panel), nativeBodyAppearance, nativeSurfaceAppearance,
    nativeSurfaceAvailable: nativeSurface !== null,
    nativeAppearance: nativeSurfaceAppearance === null ? null : { ...nativeBodyAppearance, background: nativeSurfaceAppearance.background },
  };
}

export function assertProviderDashboard(snapshot, originalsVisible = false) {
  assert.equal(snapshot.truncated, false, 'Dashboard evidence exceeded its fixed bound');
  assert.equal(snapshot.panelCount, 1, 'One provider dashboard must own the overview');
  assert.equal(snapshot.panelVisible, true, 'The provider dashboard must be rendered');
  assert.equal(snapshot.overviewVisible, true, 'The dashboard must have a visible summary layout');
  assert.ok(snapshot.metrics.every((metric) => metric.visible), 'Open, comments and activity metrics must be visible');
  assert.ok(snapshot.sectionBindings.length >= 2, 'Dashboard sections must be present');
  assert.ok(snapshot.sectionBindings.every((section) => !section.nativeDetails && section.ownsContent && ['true', 'false'].includes(section.expanded)), 'Dashboard sections must use bound custom controls rather than plain native details');
  assert.ok(snapshot.sectionBindings.filter((section) => section.primary).length >= 2 && snapshot.sectionBindings.filter((section) => section.primary).every((section) => section.toggle), 'Primary dashboard controls must be visible');
  assert.equal(snapshot.originalToggleCount, 1, 'Original conversation must have one explicit restore control');
  assert.equal(snapshot.bound, true, 'Dashboard evidence must stay on its original page');
  assert.equal(snapshot.sameOriginals, true, `Original conversation nodes and content must be retained: ${JSON.stringify(snapshot.custody)}`);
  assert.ok(snapshot.originalCount > 0, 'At least one represented original conversation entry must be exercised');
  assert.equal(snapshot.originalVisible, originalsVisible ? snapshot.originalCount : 0, 'Original conversation visibility must follow its explicit control');
  assert.ok(snapshot.representedMounted > 0, 'Mounted digest sources must have real native counterparts');
  assert.equal(snapshot.representedVisible, originalsVisible ? snapshot.representedMounted : 0, 'Every represented native source must follow original-conversation visibility');
  assert.equal(snapshot.nativeSurfaceAvailable, true, 'A genuine non-owned native card surface is required');
  assert.deepEqual(snapshot.appearance, snapshot.nativeAppearance, 'Dashboard typography and colors must match native body text and card surface');
}

export async function verifyProviderDashboardUi(page, progress, { poll, capture, onOriginalsShown }) {
  const read = (mode = 'read') => page.evaluate(providerDashboardProbe, mode);
  const click = async (selector, index = null) => {
    const handles = await page.$$(selector);
    assert.ok(index === null ? handles.length === 1 : handles.length > index, 'The current dashboard control is required');
    const handle = handles[index ?? 0];
    try {
      await handle.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }));
      const custody = await read();
      assert.equal(custody.sameOriginals, true, `Original conversation changed before the real pointer input: ${JSON.stringify({ custody: custody.custody, bodyChanges: custody.bodyChanges })}`);
      const point = await handle.evaluate(async (node) => {
        let previous = null;
        let stable = 0;
        for (let frame = 0; frame < 24; frame++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          if (!node.isConnected || node.disabled) return { ready: false, reason: 'detached-or-disabled', sample: previous };
          const box = node.getBoundingClientRect();const x = box.left + box.width / 2;const y = box.top + box.height / 2;
          const hit = document.elementFromPoint(x, y);
          const next = { x, y, width: box.width, height: box.height };
          const visible = box.width > 0 && box.height > 0 && x > 0 && y > 0 && x < innerWidth && y < innerHeight && hit !== null && node.contains(hit);
          stable = visible && previous !== null && Object.keys(next).every((key) => Math.abs(next[key] - previous[key]) < 0.25) ? stable + 1 : 0;
          previous = next;
          if (stable < 2) continue;
          const state = { node, receipt: null, listener: null, afterListener: null };
          const expansion = () => ({ target: node.getAttribute('aria-expanded'), current: node.id ? document.getElementById(node.id)?.getAttribute('aria-expanded') ?? null : null, connected: node.isConnected });
          state.listener = (event) => {
            const sameControl = event.currentTarget === node && node.contains(event.target);
            state.receipt = { trusted: event.isTrusted, trustedTargetCount: event.isTrusted && sameControl ? 1 : 0, connected: node.isConnected, sameControl, controlId: node.id, sectionKey: node.parentElement?.dataset.geldReviewKey ?? null, x: event.clientX, y: event.clientY, before: expansion(), immediate: null, microtask: null };
          };
          state.afterListener = () => {
            if (state.receipt === null) return;
            state.receipt.immediate = expansion();
            queueMicrotask(() => { if (state.receipt !== null) state.receipt.microtask = expansion(); });
          };
          node.addEventListener('click', state.listener, { capture: true, once: true });
          node.addEventListener('click', state.afterListener, { once: true });
          globalThis.__geldDashboardPointerReceipt = state;
          return { ready: true, ...next, controlId: node.id, sectionKey: node.parentElement?.dataset.geldReviewKey ?? null, sectionId: node.parentElement?.id ?? null, expandedBefore: node.getAttribute('aria-expanded') };
        }
        return { ready: false, reason: 'unstable-or-obscured', sample: previous };
      });
      progress.clicks ??= [];
      const attempt = { point, receipt: null };
      progress.clicks.push(attempt);
      assert.equal(point.ready, true, 'The original dashboard control must have a stable unobscured visible click point');
      await page.mouse.click(point.x, point.y);
      const receipt = await handle.evaluate((node) => {
        const state = globalThis.__geldDashboardPointerReceipt;
        return state?.node === node ? state.receipt : null;
      });
      attempt.receipt = receipt;
      assert.ok(receipt?.trusted && receipt.trustedTargetCount === 1 && receipt.connected && receipt.sameControl, 'The original dashboard control must receive the trusted click before waiting for its result');
    } finally {
      if (!page.isClosed()) await handle.evaluate(() => {
        const state = globalThis.__geldDashboardPointerReceipt;
        state?.node.removeEventListener('click', state.listener, true);
        state?.node.removeEventListener('click', state.afterListener);
        delete globalThis.__geldDashboardPointerReceipt;
      });
      await Promise.all(handles.map((entry) => entry.dispose()));
    }
  };
  try {
    progress.baseline = await poll(() => read('bind'), (value) => value.bound && value.originalCount > 0 && value.overviewVisible, 'Visible dashboard and retained original conversation');
    assertProviderDashboard(progress.baseline);
    progress.initialScreenshot = await capture('dashboard-native-hidden');
    const section = progress.baseline.sectionBindings.find((section) => section.primary);
    assert.ok(section?.key && section.id, 'The first primary dashboard section must have a stable identity');
    const selected = (value) => value.sectionBindings.find((candidate) => candidate.primary && candidate.key === section.key && candidate.id === section.id);
    const sectionSelector = `.geld-provider-review > [data-geld-review-key=${JSON.stringify(section.key)}] > button[data-geld-review-toggle]`;
    const beforeExpanded = section.expanded;
    const expectedExpanded = beforeExpanded === 'true' ? 'false' : 'true';
    await click(sectionSelector);
    progress.sectionToggled = await poll(read, (value) => selected(value)?.expanded === expectedExpanded && value.sameOriginals, 'Real custom dashboard disclosure changes its body');
    const toggled = selected(progress.sectionToggled);
    assert.equal(toggled.contentVisible, toggled.expanded === 'true', 'Dashboard disclosure controls actual content visibility');
    await click(sectionSelector);
    await poll(read, (value) => selected(value)?.expanded === beforeExpanded && value.sameOriginals, 'Custom dashboard disclosure restores its original state');
    await click('button[data-geld-original-conversation]');
    progress.originalsShown = await poll(read, (value) => value.originalVisible === value.originalCount && value.sameOriginals, 'Real Show original conversation restores retained native entries');
    assertProviderDashboard(progress.originalsShown, true);
    try { await onOriginalsShown?.(progress.originalsShown); }
    finally {
      await click('button[data-geld-original-conversation]');
      progress.originalsHidden = await poll(read, (value) => value.originalVisible === 0 && value.sameOriginals, 'Real Hide original conversation suppresses the same retained entries');
      assertProviderDashboard(progress.originalsHidden);
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await new Promise((resolve) => setTimeout(resolve, 350));
    progress.dark = await poll(read, (value) => value.sameOriginals, 'Dashboard remains current under native dark preference');
    assertProviderDashboard(progress.dark);
    progress.darkMode = progress.dark.nativeAppearance.color !== progress.baseline.nativeAppearance.color || progress.dark.nativeAppearance.background !== progress.baseline.nativeAppearance.background ? 'native_dark_observed' : 'native_did_not_switch';
    if (progress.darkMode === 'native_dark_observed') progress.darkScreenshot = await capture('dashboard-native-dark');
    progress.interaction = 'Real pointer clicks on the original visible dashboard control; OS color-scheme emulation only';
  } finally {
    if (!page.isClosed()) {
      await page.emulateMediaFeatures([]);
      await page.evaluate(providerDashboardProbe, 'cleanup');
    }
  }
}

export async function openProviderReviewAncestors(page, selector) {
  let clicks = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const handle = await page.evaluateHandle((selector) => {
      const target = document.querySelector(selector);
      const closed = [];
      for (let node = target?.parentElement; node; node = node.parentElement) {
        const control = node.matches('[data-geld-review-key]') ? node.querySelector(':scope > button[data-geld-review-toggle]') : null;
        if (control?.getAttribute('aria-expanded') === 'false') closed.push(control);
        else if (node.tagName === 'DETAILS' && !node.open) {
          const summary = node.querySelector(':scope > summary');if (summary) closed.push(summary);
        }
      }
      return closed.at(-1) ?? null;
    }, selector);
    try {
      const control = handle.asElement();
      if (control === null) return clicks;
      await control.click();clicks += 1;
    } finally { await handle.dispose(); }
  }
  throw new Error('Review disclosure nesting did not settle after real control clicks');
}

export async function verifyGitLabCategoryFallback(page, progress, { poll, interact, capture }) {
  const selector = 'button[data-testid="file-tree-button"]';
  const label = () => page.$eval(selector, (button) => button.getAttribute('aria-label'));
  assert.equal(await label(), 'Hide file browser', 'The original GitLab file-browser control must start open');
  let closed = false;
  try {
    await page.$eval(selector, (button) => button.scrollIntoView({ behavior: 'instant', block: 'center' }));
    await page.click(selector);closed = true;
    await poll(label, (value) => value === 'Show file browser', 'Original file-browser control closes the native sidebar');
    progress.closed = await poll(() => page.evaluate(providerUiProbe, 'gitlab'), (value) => value.categories.filter((entry) => entry.visible).some((entry) => entry.placement === 'fallback'), 'A closed native sidebar exposes the fallback category entry point');
    assertDiscoverableProviderCategories(progress.closed);
    progress.interaction = await interact();
    progress.closedScreenshot = await capture('category-native-tree-closed');
    await page.click(selector);closed = false;
    await poll(label, (value) => value === 'Hide file browser', 'Original file-browser control restores the native sidebar');
    progress.reopened = await poll(() => page.evaluate(providerUiProbe, 'gitlab'), (value) => value.categories.filter((entry) => entry.visible).every((entry) => entry.placement === 'sidebar') && value.categories.some((entry) => entry.visible), 'Reopened native sidebar reclaims the category entry point');
    assertDiscoverableProviderCategories(progress.reopened);
  } finally {
    if (closed && !page.isClosed() && await label() === 'Show file browser') await page.click(selector);
  }
}
