const FULL_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const REPOSITORY = 'atlassian/bitbucket-upload-file';

function resource(value) {
  try {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '' || url.hash !== '') return null;
    if (url.origin === 'https://bitbucket.org' && url.pathname.startsWith('/!api/2.0/')) {
      url.hostname = 'api.bitbucket.org';
      url.pathname = url.pathname.slice('/!api'.length);
    }
    if (url.origin !== 'https://api.bitbucket.org') return null;
    const match = /^\/2\.0\/repositories\/atlassian\/bitbucket-upload-file\/(commit|diffstat)\/([a-f0-9]{7,64})$/i.exec(url.pathname);
    if (match === null) return null;
    if (match[1] === 'diffstat' && [...url.searchParams.keys()].some((key) => !['pagelen', 'page'].includes(key))) return null;
    if (match[1] === 'commit' && [...url.searchParams.keys()].some((key) => key !== 'fields')) return null;
    url.searchParams.sort();
    return { kind: match[1], ref: match[2].toLowerCase(), url: url.href };
  } catch { return null; }
}

export function commitHoverTotal(rows) {
  const total = rows.filter((row) => row.label === 'Total');
  if (total.length !== 1) return null;
  const number = (value, pattern) => typeof value === 'string' && pattern.test(value) ? Number(value.replace(/[^0-9]/g, '')) : null;
  const files = number(total[0].files, /^[\d,]+ files?$/);
  const additions = number(total[0].additions, /^\+[\d,]+$/);
  const deletions = number(total[0].deletions, /^[−-][\d,]+$/);
  return [files, additions, deletions].some((value) => value === null || !Number.isSafeInteger(value)) ? null : { files, additions, deletions };
}

export function createBitbucketCommitOracle() {
  const metadata = new Map();
  const pages = new Map();
  const invalid = new Set();
  const evidence = { kind: 'Already-issued browser response bodies, with no additional oracle fetch', metadata: [], diffstat: [], errors: [] };
  const error = (message) => { if (evidence.errors.length < 10) evidence.errors.push(message); };
  return {
    evidence,
    observe(url, value, headers = {}) {
      const source = resource(url);
      if (source === null) return;
      const cacheHeaders = Object.fromEntries(Object.entries(headers).filter(([key, value]) => ['cache-control', 'etag', 'age', 'date', 'vary'].includes(key.toLowerCase()) && typeof value === 'string').map(([key, value]) => [key.toLowerCase(), value]));
      const reject = (message) => { invalid.add(source.ref);error(message); };
      if (source.kind === 'commit') {
        const hash = value?.hash;
        if (typeof hash !== 'string' || !FULL_SHA.test(hash) || !hash.toLowerCase().startsWith(source.ref)
          || (value.repository !== undefined && value.repository?.full_name !== REPOSITORY)) { reject('Native commit metadata identity did not match its response URL.'); return; }
        metadata.set(JSON.stringify([source.url, hash.toLowerCase()]), { sha: hash.toLowerCase(), url: source.url });
        if (evidence.metadata.length < 20) evidence.metadata.push({ url: source.url, sha: hash.toLowerCase(), cacheHeaders });
        return;
      }
      if (!FULL_SHA.test(source.ref) || !Array.isArray(value?.values) || value.values.length > 1000) { reject('Native diffstat response was invalid.'); return; }
      for (const key of ['size', 'page', 'pagelen']) {
        if (Object.hasOwn(value, key) && (!Number.isSafeInteger(value[key]) || value[key] < (key === 'size' ? 0 : 1))) { reject('Native diffstat pagination metadata was malformed.'); return; }
      }
      if (value.page !== undefined && value.page !== Number(new URL(source.url).searchParams.get('page') ?? 1)
        || value.pagelen !== undefined && value.values.length > value.pagelen) { reject('Native diffstat page metadata did not match its response.'); return; }
      const size = value.size ?? null;
      if (size !== null && [...pages.values()].some((page) => page.sha === source.ref && page.size !== null && page.size !== size)) { reject('Native diffstat responses declared conflicting sizes.'); return; }
      const files = [];
      for (const item of value.values) {
        const path = item?.new?.path ?? item?.old?.path;
        if (typeof path !== 'string' || path === '' || !Number.isSafeInteger(item.lines_added) || item.lines_added < 0 || !Number.isSafeInteger(item.lines_removed) || item.lines_removed < 0) { reject('Native diffstat entry was invalid.'); return; }
        files.push({ path, additions: item.lines_added, deletions: item.lines_removed });
      }
      if (new Set(files.map((file) => file.path)).size !== files.length) { reject('Native diffstat repeated a file path.'); return; }
      const next = value.next === undefined || value.next === null ? null : resource(value.next);
      if ((value.next !== undefined && value.next !== null && next === null) || next !== null && (next.kind !== 'diffstat' || next.ref !== source.ref)) { reject('Native diffstat pagination changed commit identity.'); return; }
      if (pages.size >= 40 && !pages.has(source.url)) { error('Native diffstat observer exceeded its response bound.'); return; }
      const page = { sha: source.ref, files, next: next?.url ?? null, size };
      if (pages.has(source.url) && JSON.stringify(pages.get(source.url)) !== JSON.stringify(page)) { reject('Native diffstat changed for an already-observed immutable page.'); return; }
      pages.set(source.url, page);
      if (evidence.diffstat.length < 40) evidence.diffstat.push({ url: source.url, sha: source.ref, count: files.length, next: next?.url ?? null, size, page: value.page ?? null, cacheHeaders });
    },
    snapshot(ref) {
      if (typeof ref !== 'string' || !/^[a-f0-9]{7,64}$/i.test(ref) || [...invalid].some((value) => value.startsWith(ref.toLowerCase()) || ref.toLowerCase().startsWith(value))) return { status: 'unavailable', reason: 'Observed commit source identity or pagination was invalid.' };
      const identities = [...new Set([...metadata.values()].filter((value) => value.sha.startsWith(ref.toLowerCase())).map((value) => value.sha))];
      if (identities.length !== 1) return { status: 'unavailable', reason: 'Already-issued native commit metadata did not establish one full commit identity.' };
      const sha = identities[0];
      const chains = [];
      for (const [first, page] of pages) {
        if (page.sha !== sha || ![null, '1'].includes(new URL(first).searchParams.get('page'))) continue;
        const seen = new Set();
        const files = [];
        const sizes = new Set();
        let next = first;
        while (next !== null && seen.size < 20) {
          if (seen.has(next)) break;
          const current = pages.get(next);
          if (current === undefined || current.sha !== sha) break;
          seen.add(next);
          files.push(...current.files);
          if (current.size !== null) sizes.add(current.size);
          next = current.next;
        }
        if (next === null && new Set(files.map((file) => file.path)).size === files.length && sizes.size <= 1 && (sizes.size === 0 || sizes.has(files.length))) chains.push({ files, urls: [...seen] });
      }
      if (chains.length === 0) return { status: 'unavailable', reason: 'No complete already-issued diffstat page chain for this immutable commit.' };
      const signatures = new Set(chains.map((chain) => JSON.stringify([...chain.files].sort((a, b) => a.path.localeCompare(b.path)))));
      if (signatures.size !== 1) return { status: 'unavailable', reason: 'Already-issued diffstat responses disagree.' };
      const files = chains[0].files;
      const totals = { files: files.length, additions: 0, deletions: 0 };
      for (const file of files) {
        totals.additions += file.additions;totals.deletions += file.deletions;
        if (!Number.isSafeInteger(totals.additions) || !Number.isSafeInteger(totals.deletions)) return { status: 'unavailable', reason: 'Native diffstat aggregate line count was unsafe.' };
      }
      return { status: 'ready', sha, files, totals,
        provenance: { metadata: [...metadata.values()].filter((value) => value.sha === sha).map((value) => value.url), diffstat: chains[0].urls } };
    },
  };
}

export function observeBitbucketCommitFixture(page, item) {
  const oracle = createBitbucketCommitOracle();
  item.commitResponses = oracle.evidence;
  page.on('response', (response) => {
    if (response.status() !== 200 || resource(response.url()) === null) return;
    void response.json().then((value) => oracle.observe(response.url(), value, response.headers())).catch(() => {
      if (oracle.evidence.errors.length < 10) oracle.evidence.errors.push('Could not read an already-issued commit response body.');
    });
  });
  return oracle;
}

export function bitbucketParentCommitSnapshot() {
  const tabs = [...document.querySelectorAll('[data-testid="sidebar-tab-details"][role="tab"]')].filter((node) => node.closest('[data-geld-ui]') === null);
  const tab = tabs.length === 1 ? tabs[0] : null;
  const panel = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
  if (tab === null || panel?.getAttribute('role') !== 'tabpanel' || panel.getAttribute('aria-labelledby') !== tab.id) return null;
  const section = [...panel.querySelectorAll('[data-testid="expanded-CommitCard"] > section')].find((node) => /^\d+ parent commits?$/.test(node.querySelector(':scope > h2 > button')?.textContent.replace(/\s+/g, ' ').trim() ?? ''));
  const control = section?.querySelector(':scope > h2 > button[aria-controls]');
  const body = document.getElementById(control?.getAttribute('aria-controls') ?? '');
  if (section === undefined || body === null || !section.contains(body)) return null;
  const current = new URL(location.href);
  const match = /^\/atlassian\/bitbucket-upload-file\/commits\/([a-f0-9]{7,64})$/i.exec(current.pathname);
  if (match === null || current.origin !== 'https://bitbucket.org') return null;
  const presentation = (node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;const y = rect.top + rect.height / 2;
    const view = document.defaultView;
    let presented = node.isConnected && rect.width > 0 && rect.height > 0 && node.closest('[hidden], [aria-hidden="true"], [inert]') === null;
    for (let parent = node; presented && parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') presented = false;
    }
    const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    const header = hit?.closest('header[data-layout-slot="true"]');
    return { presented, visible: presented && x >= 0 && y >= 0 && x < (view?.innerWidth ?? 0) && y < (view?.innerHeight ?? 0) && hit !== null && (hit === node || node.contains(hit)),
      bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      point: { x, y }, hit: hit === null ? null : { tag: hit.tagName, id: hit.id, testid: hit.getAttribute('data-testid'), role: hit.getAttribute('role'), owned: hit.closest('[data-geld-ui]') !== null,
        nativeHeader: header !== null && header !== undefined && header.closest('[data-geld-ui], form, .ak-renderer-document') === null && header.closest('#unsafe-design-system-page-layout-root') !== null } };

  };
  const sidebar = tab.closest('[data-testid="sidebar"]');
  const expandSelector = '[data-testid="sidebar"] button:has([role="img"][aria-label="Click or tap to expand or press the ] (right bracket) key"])';
  const expandButtons = [...document.querySelectorAll(expandSelector)].filter((node) => node.closest('[data-geld-ui]') === null && node.closest('[data-testid="sidebar"]') === sidebar);
  const describeControl = (node, selector) => node === null || node.disabled || node.getAttribute('aria-disabled') === 'true' || node.closest('[data-geld-ui]') !== null ? null : { selector, ...presentation(node) };
  const controls = {
    expandSidebar: sidebar?.contains(panel) && expandButtons.length === 1 ? describeControl(expandButtons[0], expandSelector) : null,
    details: describeControl(tab, '[data-testid="sidebar-tab-details"][role="tab"]'),
    parents: /^[A-Za-z][A-Za-z0-9_-]*$/.test(body.id) ? describeControl(control, `[data-testid="expanded-CommitCard"] > section > h2 > button[aria-controls="${body.id}"]`) : null,
  };
  // Observed Atlassian consent banner is a direct native layout slot, never a comment or form.
  const layout = document.querySelectorAll('#unsafe-design-system-page-layout-root');
  const excluded = '[data-geld-ui], form, .ak-renderer-document, [data-qa="comment-content"], [data-testid="comment-content"], [data-testid="expanded-CommitCard"]';
  const dialogSelector = '#unsafe-design-system-page-layout-root > [data-layout-slot="true"] [role="dialog"][aria-labelledby="cookiesTrackingNoticeLink"]';
  const dialogs = [...document.querySelectorAll(dialogSelector)].filter((node) => node.closest(excluded) === null);
  let consent = null;
  if (layout.length === 1 && dialogs.length === 1) {
    const dialog = dialogs[0];const slot = dialog.closest('[data-layout-slot="true"]');
    const buttons = [...dialog.querySelectorAll('button[data-testid="only-necessary-button"]')];
    const legal = [...dialog.querySelectorAll('a[href]')].filter((link) => link.getAttribute('href') === 'https://www.atlassian.com/legal/cookies');
    const button = buttons.length === 1 ? buttons[0] : null;
    const selector = `${dialogSelector} button[data-testid="only-necessary-button"]`;
    if (slot?.parentElement === layout[0] && legal.length > 0 && button?.textContent.trim() === 'Only necessary' && button.type === 'button' && button.closest(excluded) === null && document.querySelectorAll(selector).length === 1) {
      consent = { selector, label: 'Only necessary', legalUrl: legal[0].href, dialog: presentation(dialog), control: describeControl(button, selector) };
    }
  }
  const headers = [...document.querySelectorAll('header[data-layout-slot="true"]')].filter((node) => node.closest('#unsafe-design-system-page-layout-root') !== null && node.closest(excluded) === null);
  const nativeLayout = { headers: headers.map((node) => ({ id: node.id, ...presentation(node) })), bannerHeight: layout.length === 1 ? getComputedStyle(layout[0]).getPropertyValue('--n_bnrM') : null, topNavHeight: layout.length === 1 ? getComputedStyle(layout[0]).getPropertyValue('--n_tNvM') : null };
  const links = [...body.querySelectorAll('a[href]')].filter((node) => node.closest('[data-geld-ui]') === null && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(node.getAttribute('href') ?? '')).map((node) => {
    const url = new URL(node.href, current);
    const raw = node.getAttribute('href');
    if (url.origin !== current.origin || url.pathname !== `/atlassian/bitbucket-upload-file/commits/${raw}` || url.search !== '' || url.hash !== '' || !raw.startsWith(node.textContent.trim()) || !/^[a-f0-9]{7,64}$/i.test(node.textContent.trim())) return null;
    return { href: url.href, raw, sha: raw.toLowerCase(), text: node.textContent.trim(), bodyId: body.id, ...presentation(node) };
  }).filter((value) => value !== null);
  return { currentUrl: current.href, currentRef: match[1], tabSelected: tab.getAttribute('aria-selected'), parentsExpanded: control.getAttribute('aria-expanded'), controls, links, consent, nativeLayout };
}

export async function prepareBitbucketParentCommit(page, initial, poll, onProgress = () => undefined) {
  const actions = [];
  const progress = { status: 'running', initial, actions, snapshots: [] };onProgress(progress);
  const read = async () => {
    const value = await page.evaluate(bitbucketParentCommitSnapshot);
    if (value === null || value.currentUrl !== initial.currentUrl || value.links.length !== 1 || value.links[0].href !== initial.links[0].href) throw new Error('Native parent identity or document changed during discovery.');
    progress.native = value;progress.snapshots.push(value);if (progress.snapshots.length > 8) progress.snapshots.shift();
    return value;
  };
  const attempted = new Set();
  try {
    for (let step = 0; step < 5; step += 1) {
      const native = await read();
      if (native.links[0].visible) { progress.status = 'ready';return { ...progress, native }; }
      const kind = native.controls.expandSidebar?.visible && !attempted.has('expandSidebar') ? 'expandSidebar'
        : native.tabSelected !== 'true' && native.controls.details?.visible && !attempted.has('details') ? 'details'
        : native.parentsExpanded === 'false' && native.controls.parents?.visible && !attempted.has('parents') ? 'parents'
        : null;
      if (kind !== null) {
        const selector = native.controls[kind].selector;
        const handle = await page.$(selector);
        if (handle === null) throw new Error('Observed native parent control disappeared.');
        try {
          const latest = await read();
          if (latest.controls[kind]?.visible !== true || latest.controls[kind].selector !== selector) throw new Error('Observed native parent control is no longer visible.');
          const connected = await handle.evaluate((node, target, url) => node.isConnected && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && document.URL === url && document.querySelectorAll(target).length === 1 && document.querySelector(target) === node, selector, initial.currentUrl);
          if (!connected) throw new Error('Observed native parent control changed before its click.');
          await handle.click();
        } finally { await handle.dispose(); }
        attempted.add(kind);actions.push({ kind, selector, input: 'Native control pointer click' });
        await poll(read, (value) => kind === 'expandSidebar' ? value.controls.details?.visible || value.links[0].visible : kind === 'details' ? value.tabSelected === 'true' : value.parentsExpanded === 'true', `Native parent ${kind} control takes effect`, 5000);
      } else if (!attempted.has('necessaryCookies') && native.controls.expandSidebar?.presented && !native.controls.expandSidebar.visible
        && native.controls.expandSidebar.hit?.nativeHeader === true && native.controls.expandSidebar.hit.owned === false
        && native.consent?.dialog.visible && native.consent.control?.visible) {
        const selector = native.consent.selector;
        const sidebarSelector = native.controls.expandSidebar.selector;
        const sidebarHandle = await page.$(sidebarSelector);const handle = await page.$(selector);
        const action = { kind: 'necessaryCookies', selector, input: 'Native Only necessary pointer click', before: native };actions.push(action);
        attempted.add('necessaryCookies');
        try {
          if (handle === null || sidebarHandle === null) throw new Error('Observed native consent or sidebar control disappeared.');
          const latest = await read();
          if (latest.consent?.selector !== selector || !latest.consent.dialog.visible || !latest.consent.control?.visible || latest.controls.expandSidebar?.selector !== sidebarSelector || latest.controls.expandSidebar.hit?.nativeHeader !== true) throw new Error('Native consent/header obstruction changed before preparation.');
          const current = await sidebarHandle.evaluate((node, target, url) => node.isConnected && !node.disabled && document.URL === url && document.querySelectorAll(target).length === 1 && document.querySelector(target) === node, sidebarSelector, initial.currentUrl);
          if (!current) throw new Error('Original native sidebar control changed before consent.');
          const bound = await handle.evaluate((node, target, url) => {
            if (!node.isConnected || node.disabled || node.getAttribute('aria-disabled') === 'true' || document.URL !== url || document.querySelectorAll(target).length !== 1 || document.querySelector(target) !== node) return false;
            const dialog = node.closest('[role="dialog"][aria-labelledby="cookiesTrackingNoticeLink"]');
            const layout = document.querySelectorAll('#unsafe-design-system-page-layout-root');
            const slot = dialog?.closest('[data-layout-slot="true"]');
            if (layout.length !== 1 || slot?.parentElement !== layout[0] || node.type !== 'button' || node.textContent.trim() !== 'Only necessary' || node.getAttribute('data-testid') !== 'only-necessary-button'
              || node.closest('[data-geld-ui], form, .ak-renderer-document, [data-qa="comment-content"], [data-testid="comment-content"], [data-testid="expanded-CommitCard"]') !== null
              || ![...dialog.querySelectorAll('a[href]')].some((link) => link.getAttribute('href') === 'https://www.atlassian.com/legal/cookies')) return false;
            const listener = (event) => { globalThis.__geldParentConsent.event = { trusted: event.isTrusted, detail: event.detail, nativeButton: event.currentTarget === node && node.contains(event.target) }; };
            globalThis.__geldParentConsent = { node, listener, event: null };node.addEventListener('click', listener, { capture: true, once: true });return true;
          }, selector, initial.currentUrl);
          if (!bound) throw new Error('Observed native consent control changed before its click.');
          await handle.click();
          action.event = await page.evaluate(() => globalThis.__geldParentConsent?.event ?? null);
          if (action.event?.trusted !== true || action.event.detail !== 1 || action.event.nativeButton !== true) throw new Error('Consent preparation requires genuine native pointer input');
          action.after = await poll(read, (value) => (value.consent === null || !value.consent.dialog.presented) && value.controls.expandSidebar?.selector === sidebarSelector && value.controls.expandSidebar.visible, 'Native cookie dismissal restores the original sidebar control visibility', 5000);
          const retained = await sidebarHandle.evaluate((node, target, url) => node.isConnected && !node.disabled && document.URL === url && document.querySelectorAll(target).length === 1 && document.querySelector(target) === node, sidebarSelector, initial.currentUrl);
          if (!retained) throw new Error('Original native sidebar control changed after consent.');
        } finally { await handle?.dispose();await sidebarHandle?.dispose(); }
      } else if (native.links[0].presented && !attempted.has('scroll')) {
        const selector = `[data-testid="expanded-CommitCard"] a[href="${native.links[0].raw}"]`;
        const scrolled = await page.$eval(selector, (node, url) => {
          if (!node.isConnected || document.URL !== url || node.closest('[data-geld-ui], [hidden], [aria-hidden="true"], [inert]') !== null) return false;
          node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });return true;
        }, initial.currentUrl);
        if (!scrolled) throw new Error('Native parent changed before its scroll.');
        attempted.add('scroll');actions.push({ kind: 'scroll', selector, input: 'Native parent link scroll' });
        await poll(read, (value) => value.links[0].visible, 'Actual parent link is unobstructed after native scrolling', 5000);
      } else throw new Error('Actual native parent link has no supported visible reveal control.');
    }
    const native = await read();
    if (!native.links[0].visible) throw new Error('Actual native parent link did not become visible.');
    progress.status = 'ready';return { ...progress, native };
  } catch (error) { progress.status = 'failed';progress.error = String(error);throw error; }
  finally {
    if (typeof page.isClosed !== 'function' || !page.isClosed()) await page.evaluate(() => { const observed = globalThis.__geldParentConsent;if (observed !== undefined) observed.node.removeEventListener('click', observed.listener, true);delete globalThis.__geldParentConsent; }).catch(() => undefined);
  }
}
