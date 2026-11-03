import assert from 'node:assert/strict';

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
export function gitLabLocalReviewedCandidate() {
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
    const source = [...item?.querySelectorAll('[data-geld-source]') ?? []].find((entry) => {
      const byline = entry.querySelector(':scope > .geld-provider-review__byline');
      const native = document.getElementById(entry.getAttribute('data-geld-source'));
      return byline !== null && ![...byline.children].some((node) => node.textContent.trim() === 'Automated account')
        && native !== null && native.querySelector('.note-header a.author-name-link[data-user-id]') !== null;
    });
    if (source !== undefined) counts.human++;
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
    const additions = signed(host.querySelector('[data-testid="js-file-addition-line"]'), '+');
    const deletions = signed(host.querySelector('[data-testid="js-file-deletion-line"]'), '-');
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
  if (mode === 'bind' && panel && globalThis[key] === undefined) {
    const roots = [...document.querySelectorAll('[data-geld-provider-native-find="folded"]')].filter((node) => !panel.contains(node));
    if (roots.length > 0) globalThis[key] = { panel, url: location.href, roots: roots.map((node) => ({ node, parent: node.parentElement, text: node.textContent, id: node.id })) };
  }
  const state = globalThis[key];
  const native = state?.roots ?? [];
  const sections = [...panel?.querySelectorAll('[data-geld-review-key]') ?? []];
  const bound = state?.panel === panel && state?.url === location.href;
  const sameOriginals = bound && native.every((entry) => entry.node.isConnected && entry.node.parentElement === entry.parent && entry.node.id === entry.id && entry.node.textContent === entry.text);
  const sectionBindings = sections.map((section) => {
    const control = section.querySelector(':scope > button[data-geld-review-toggle]');
    const target = document.getElementById(control?.getAttribute('aria-controls') ?? '');
    return { primary: section.parentElement === panel, nativeDetails: section.tagName === 'DETAILS', toggle: visible(control), expanded: control?.getAttribute('aria-expanded') ?? null, ownsContent: target !== null && section.contains(target) && target.classList.contains('geld-provider-review__section-content') && control.id !== '' && target.getAttribute('aria-labelledby') === control.id, contentVisible: visible(target) };
  });
  const provider = panel?.getAttribute('data-provider');
  const nativeSelector = provider === 'gitlab' ? '.issuable-discussion [data-testid="noteable-note-container"] .timeline-content' : provider === 'bitbucket' ? '[data-qa="pull-request-description"]' : null;
  const nativeSurface = nativeSelector === null ? null : [...document.querySelectorAll(nativeSelector)].find((node) => node.closest('[data-geld-ui]') === null && (provider !== 'gitlab' || !['', 'transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(node).backgroundColor))) ?? null;
  const nativeBodyAppearance = appearance(document.body);
  const nativeSurfaceAppearance = appearance(nativeSurface);
  return {
    panelCount: panels.length, panelVisible: visible(panel), bound, sameOriginals,
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
  assert.equal(snapshot.sameOriginals, true, 'Original conversation nodes and content must be retained');
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
      const point = await handle.evaluate((node) => {
        if (!node.isConnected || node.disabled) return null;
        const box = node.getBoundingClientRect();const x = box.left + box.width / 2;const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return box.width > 0 && box.height > 0 && x > 0 && y > 0 && x < innerWidth && y < innerHeight && hit !== null && node.contains(hit) ? { x, y } : null;
      });
      assert.ok(point, 'The original dashboard control must have an unobscured visible click point');
      assert.equal((await read()).sameOriginals, true, 'Original conversation changed before the real pointer input');
      await page.mouse.click(point.x, point.y);
    } finally { await Promise.all(handles.map((entry) => entry.dispose())); }
  };
  try {
    progress.baseline = await poll(() => read('bind'), (value) => value.bound && value.originalCount > 0 && value.overviewVisible, 'Visible dashboard and retained original conversation');
    assertProviderDashboard(progress.baseline);
    progress.initialScreenshot = await capture('dashboard-native-hidden');
    const sectionSelector = '.geld-provider-review > [data-geld-review-key] > button[data-geld-review-toggle]';
    const beforeExpanded = progress.baseline.sectionBindings.find((section) => section.primary)?.expanded;
    await click(sectionSelector, 0);
    progress.sectionToggled = await poll(read, (value) => value.sectionBindings.find((section) => section.primary)?.expanded !== beforeExpanded && value.sameOriginals, 'Real custom dashboard disclosure changes its body');
    const toggled = progress.sectionToggled.sectionBindings.find((section) => section.primary);
    assert.equal(toggled.contentVisible, toggled.expanded === 'true', 'Dashboard disclosure controls actual content visibility');
    await click(sectionSelector, 0);
    await poll(read, (value) => value.sectionBindings.find((section) => section.primary)?.expanded === beforeExpanded && value.sameOriginals, 'Custom dashboard disclosure restores its original state');
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
