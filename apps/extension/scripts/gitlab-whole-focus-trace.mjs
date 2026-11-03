/** Read-only first-Enter diagnostics. No focus, source writes, mutator wrapping, stacks or content capture. */
export function standaloneWholeFocusTrace(action = 'read', argument = null) {
  const KEY = '__geldStandaloneFirstFocusTrace';let trace = globalThis[KEY];
  if (action === 'setup') {
    if (trace) throw Error('Standalone first-Enter trace already exists');
    const button = argument, row = button?.closest?.('[data-geld-provider-fold-row="test:new:R96"]'), root = row?.closest('diff-file[data-file-data]');
    const path = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb', head = '13215ca460cd4f75d3765a882ef486aa2dacf549';
    const nativeRoot = (node) => {
      if (!(node instanceof Element) || node.closest('[data-geld-ui],.note,.note-text,.md,form,[contenteditable],dialog') !== null) return false;
      try { const data = JSON.parse(node.getAttribute('data-file-data'));return data?.new_path === path && new URL(data.diff_lines_path, 'https://gitlab.com').href === `https://gitlab.com/gitlab-org/gitlab/-/blob/${head}/${path}/diff_lines`; } catch { return false; }
    };
    if (!(button instanceof HTMLButtonElement) || !button.isConnected || !row?.hasAttribute('data-geld-ui') || !nativeRoot(root) || document.activeElement !== button
      || root.querySelectorAll('[data-geld-provider-fold-row="test:new:R96"] button').length !== 1) throw Error('Exact focused current owned leaf96 unavailable for tracing');
    const LIMIT = 128, NODE_LIMIT = 256, DEPTH = 24;
    trace = { records: [], dropped: 0, nodeIds: new WeakMap(), nextId: 0, nodeIdsDropped: 0, phase: 'armed', frame: null, stopped: false, previous: null, firstTransitionAway: null };
    const ids = (node) => { if (!(node instanceof Node)) return null;const held = trace.nodeIds.get(node);if (held !== undefined) return held;if (trace.nextId >= NODE_LIMIT) { trace.nodeIdsDropped++;return null; }const id = ++trace.nextId;trace.nodeIds.set(node, id);return id; };
    const number = (value) => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
    const classes = new Set(['rd-app', 'rd-diff-file', 'rd-diff-file-header-sticky', 'rd-text-view-root', 'rd-text-view-content', 'rd-hunk-lines-inline', 'rd-hunk-lines-parallel', 'geld-provider-diffs', 'geld-provider-hidden', 'geld-provider-line-fold', 'geld-provider-line-fold__cell', 'geld-provider-line-fold__toggle']);
    const staticIds = new Set(['content-body', 'diffs', 'js-diffs']);
    const tags = new Set(['HTML', 'BODY', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'FORM', 'BUTTON', 'INPUT', 'TEXTAREA', 'A', 'SPAN', 'P', 'UL', 'LI', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TH', 'TD', 'SUMMARY', 'DETAILS', 'DIFF-FILE', 'STREAMING-ELEMENT']);
    const identity = (node) => node instanceof Element ? { objectId: ids(node), tag: tags.has(node.tagName) ? node.tagName : 'OTHER_ELEMENT', domId: staticIds.has(node.id) ? node.id : null, domIdPresent: node.hasAttribute('id'), connected: node.isConnected, owned: node.closest('[data-geld-ui]') !== null, classes: [...node.classList].filter((name) => classes.has(name)).slice(0, 8), sameArmedButton: node === button, sameArmedRow: node === row, sameNativeRoot: node === root } : node instanceof Node ? { objectId: ids(node), nodeType: node.nodeType, connected: node.isConnected } : null;
    const describe = (node) => node instanceof Node ? { ...identity(node), parent: identity(node.parentNode) } : null;
    const chain = (node) => { const nodes = [];for (let at = node; at instanceof Element && nodes.length < DEPTH; at = at.parentElement) nodes.push(at);return nodes; };
    const originalChain = chain(button);let latestChain = [], previousChain = [], watched = new Set(originalChain);
    const watch = (nodes) => { if (nodes.length !== latestChain.length || nodes.some((node, index) => node !== latestChain[index])) { previousChain = latestChain;latestChain = nodes; }watched = new Set([...originalChain, ...latestChain, ...previousChain]);trace.watchedNodes = watched.size;trace.maxWatchedNodes = Math.max(trace.maxWatchedNodes ?? 0, watched.size); };
    const current = () => {
      const roots = [...document.querySelectorAll('diff-file[data-file-data]')].filter(nativeRoot), file = roots.length === 1 ? roots[0] : null;
      const controls = file ? [...file.querySelectorAll('[data-geld-provider-fold-row="test:new:R96"][data-geld-ui] button')].filter((control) => control.closest('diff-file') === file) : [];
      const control = controls.length === 1 ? controls[0] : null;
      return { rootCount: roots.length, controlCount: controls.length, file, button: control, row: control?.closest('[data-geld-provider-fold-row="test:new:R96"]') ?? null };
    };
    const metric = (node) => {
      if (!(node instanceof Element)) return null;const css = getComputedStyle(node), rect = node.getBoundingClientRect();
      const token = (value, allowed) => allowed.includes(value) ? value : 'other';
      return { hidden: node.hasAttribute('hidden'), hiddenUntilFound: node.getAttribute('hidden') === 'until-found', inert: node.hasAttribute('inert'), ariaHidden: node.getAttribute('aria-hidden') === 'true', detailsOpen: node.tagName === 'DETAILS' ? node.hasAttribute('open') : null,
        display: token(css.display, ['none', 'block', 'inline', 'inline-block', 'contents', 'table', 'table-row', 'table-cell', 'table-row-group', 'flex', 'grid', 'flow-root']), visibility: token(css.visibility, ['visible', 'hidden', 'collapse']), opacity: number(Number(css.opacity)), contentVisibility: token(css.contentVisibility, ['visible', 'hidden', 'auto']),
        bounds: Object.fromEntries(['left', 'right', 'top', 'bottom', 'width', 'height'].map((key) => [key, number(rect[key])])) };
    };
    const viewport = () => ({ width: number(innerWidth), height: number(innerHeight), scrollX: number(scrollX), scrollY: number(scrollY), visualWidth: number(window.visualViewport?.width), visualHeight: number(window.visualViewport?.height), visualScale: number(window.visualViewport?.scale), visualOffsetTop: number(window.visualViewport?.offsetTop), visualOffsetLeft: number(window.visualViewport?.offsetLeft) });
    const state = () => {
      const latest = current(), currentChain = chain(latest.button);watch(currentChain);
      return { armed: { button: describe(button), row: describe(row), nativeRoot: describe(root) }, current: { rootCount: latest.rootCount, controlCount: latest.controlCount, nativeRoot: describe(latest.file), button: describe(latest.button), row: describe(latest.row), sameArmedButton: latest.button === button, focused: latest.button !== null && document.activeElement === latest.button },
        active: describe(document.activeElement), viewport: viewport(), armedAncestors: originalChain.map((node) => ({ node: describe(node), presentation: metric(node) })), currentAncestors: latest.button === button ? null : currentChain.map((node) => ({ node: describe(node), presentation: metric(node) })) };
    };
    const push = (kind, data = {}) => { if (trace.stopped) return;const record = { at: number(performance.now()), phase: trace.phase, kind, ...data };if (trace.records.length === LIMIT) { trace.records.shift();trace.dropped++; }trace.records.push(record); };
    const snapshot = (reason) => {
      const value = state(), signature = JSON.stringify(value);if (signature === trace.previous) return;trace.previous = signature;push('state', { reason, state: value });
      if (trace.firstTransitionAway === null && !value.current.focused) trace.firstTransitionAway = { at: number(performance.now()), phase: trace.phase, reason, state: value };
    };
    const schedule = (reason) => { if (!trace.stopped && trace.frame === null) trace.frame = requestAnimationFrame(() => { trace.frame = null;snapshot(reason); }); };
    const relevantNode = (node, latest) => node instanceof Element && (watched.has(node) || node.contains(button) || latest.button !== null && node.contains(latest.button));
    const mutations = (records) => {
      const latest = current();watch(chain(latest.button));
      for (const record of records) {
        if (record.type === 'childList') {
          const added = [...record.addedNodes], removed = [...record.removedNodes], trackedTarget = watched.has(record.target) && record.target !== document.body && record.target !== document.documentElement;
          if (!trackedTarget && !added.some((node) => relevantNode(node, latest)) && !removed.some((node) => relevantNode(node, latest))) continue;
          push('childList', { timing: 'observer_delivery', target: describe(record.target), addedCount: added.length, removedCount: removed.length, added: added.slice(0, 8).map(describe), removed: removed.slice(0, 8).map(describe), nodesTruncated: added.length > 8 || removed.length > 8 });schedule('mutation');
        } else if (watched.has(record.target)) { push('attribute', { timing: 'observer_delivery', target: describe(record.target), name: record.attributeName });schedule('attribute'); }
      }
    };
    const observer = new MutationObserver(mutations);observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'open', 'aria-hidden'] });
    const focus = (event) => { push(event.type, { trusted: event.isTrusted === true, target: describe(event.target), related: describe(event.relatedTarget), state: state() });snapshot('focus_event');schedule('focus_event'); };
    const input = (event) => {
      const keys = ['Enter', 'Tab', 'Escape', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
      push('input', { type: event.type, trusted: event.isTrusted === true, key: event.type === 'pointerdown' ? null : keys.includes(event.key) ? event.key === ' ' ? 'Space' : event.key : 'other', pointerButton: event.type === 'pointerdown' && Number.isInteger(event.button) && event.button >= 0 && event.button <= 4 ? event.button : null, target: describe(event.target), active: describe(document.activeElement), viewport: viewport() });schedule('input');
    };
    const relay = (event) => {
      const control = event.target instanceof Element ? event.target.closest('button[data-click="expandLines"][data-expand-direction]') : null;
      if (!control || control.closest('diff-file') !== root || control.closest('[data-geld-ui],.note,.md,form') !== null) return;
      push('native_relay', { trusted: event.isTrusted === true, direction: ['up', 'both', 'down'].includes(control.dataset.expandDirection) ? control.dataset.expandDirection : 'other', control: describe(control), state: state() });snapshot('native_relay');schedule('native_relay');
    };
    const render = () => { push('render_signal', { state: state() });snapshot('render_signal');schedule('render_signal'); };
    const mounted = (event) => { if (!nativeRoot(event.target)) return;push('native_mount_signal', { target: describe(event.target), state: state() });snapshot('native_mount_signal');schedule('native_mount_signal'); };
    const resized = () => { push('viewport_event', { state: state() });schedule('viewport_event'); };
    const listeners = [['focus', focus], ['blur', focus], ['focusin', focus], ['focusout', focus], ['keydown', input], ['keyup', input], ['pointerdown', input], ['click', relay], ['geld:provider-line-folds-changed', render], ['DiffFileMounted', mounted]];
    for (const [name, callback] of listeners) document.addEventListener(name, callback, true);
    window.addEventListener('resize', resized);window.visualViewport?.addEventListener('resize', resized);window.visualViewport?.addEventListener('scroll', resized);
    trace.armed = { rowKey: 'test:new:R96', button: describe(button), row: describe(row), nativeRoot: describe(root), nativeViewed: { count: [...root.querySelectorAll('input[data-viewed-checkbox],[data-testid="fileReviewCheckbox"] input')].filter((node) => node.closest('[data-geld-ui]') === null).length }, documentURLRecorded: false };
    trace.sample = () => { mutations(observer.takeRecords());push('stage', { state: state() });snapshot('stage'); };
    trace.cleanup = () => { try { mutations(observer.takeRecords());push('lifecycle', { action: 'cleanup', state: state() });snapshot('cleanup'); } finally { observer.disconnect();for (const [name, callback] of listeners) document.removeEventListener(name, callback, true);window.removeEventListener('resize', resized);window.visualViewport?.removeEventListener('resize', resized);window.visualViewport?.removeEventListener('scroll', resized);if (trace.frame !== null) cancelAnimationFrame(trace.frame);trace.frame = null;trace.stopped = true;trace.listenersRemoved = listeners.length;trace.observerDisconnected = true; } };
    globalThis[KEY] = trace;try { snapshot('armed'); } catch (error) { try { trace.cleanup(); } finally { delete globalThis[KEY]; }throw error; }
  }
  if (!trace) return null;
  const phases = new Set(['before_enter', 'after_enter', 'awaiting_mount', 'mounted', 'before_capture', 'after_screenshot', 'after_dom_read', 'after_accessibility_read', 'after_capture', 'first_complete', 'failure', 'before_restore', 'cleanup']);
  if (action !== 'setup' && typeof argument === 'string' && phases.has(argument)) trace.phase = argument;
  if (action === 'stage') trace.sample();
  if (action === 'cleanup') { try { trace.cleanup(); } finally { delete globalThis[KEY]; } }
  return { armed: trace.armed, records: [...trace.records], dropped: trace.dropped, firstTransitionAway: trace.firstTransitionAway, stopped: trace.stopped, framePending: trace.frame !== null, observerDisconnected: trace.observerDisconnected === true, listenersRemoved: trace.listenersRemoved ?? 0, removed: action === 'cleanup' && !Object.hasOwn(globalThis, KEY), nodeIds: trace.nextId, nodeIdsDropped: trace.nodeIdsDropped, watchedNodes: trace.watchedNodes, maxWatchedNodes: trace.maxWatchedNodes, limit: 128, nodeLimit: 256, watchedNodeLimit: 72,
    scope: 'Read-only latest128 focus/input/identity/mutation/viewport records; observer timestamps are delivery times. No text, HTML, values, stacks, mutator interception, cause assignment or focus restoration.' };
}
