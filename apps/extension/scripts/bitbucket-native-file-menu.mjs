import assert from 'node:assert/strict';

export const NATIVE_FILE_MENU_URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff';

export function nativeFileMenuPreflight(active, budget) {
  assert.ok(Number.isSafeInteger(active) && active >= 0);assert.equal(budget, 40);
  return { budgetAvailable: active + 8 + 4 < budget, active, remaining: budget - active, budget, measuredNavigation: 8, reserve: 5,
    basis: 'Historical master-disabled public PR navigation used eight standard GETs. This is a forecast, not a bound on navigation, native scrolling or opening demand. Global40/429 and the immediate minimum-five guard remain authoritative.' };
}

/** Private original-node lease only. No product authority, fields, raw text or arbitrary URLs leave it. */
export function nativeFileMenuProbe(action = 'read', target = null, environment = {}) {
  const key = '__geldNativeFileMenu';let store = globalThis[key];
  if (action === 'cleanup') { if (store) { for (const type of ['click', 'input', 'change', 'submit', 'keydown']) document.removeEventListener(type, store.listen, true);for (const type of ['popstate', 'hashchange', 'wxt:locationchange', 'pagehide']) document.defaultView?.removeEventListener(type, store.navigation); }delete globalThis[key];return { removed: true }; }
  if (action === 'control-result') return store?.controlResult ?? null;
  if (store && ['arm','hit'].includes(action)) store.controlResult = { operation:action,sourceCurrent:null,targetOriginal:null,presented:null,eligible:null,hit:null };
  // Self-contained read-only geometry; the private offline Chromium regression extracts this exact helper.
  const hitSummary = (button) => {
    const r = button.getBoundingClientRect();const finite = [r.left,r.right,r.top,r.bottom,r.width,r.height].every((n)=>Number.isFinite(n)&&Math.abs(n)<=1000000);
    const positive = finite && r.width>0 && r.height>0;const inViewport = positive&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
    const x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;const ix=positive?Math.min(4,r.width/4):0,iy=positive?Math.min(4,r.height/4):0;
    const owned=(px,py)=>positive?button.contains(document.elementFromPoint(px,py)):null;
    const center=owned(x,y);const cardinal={left:owned(r.left+ix,y),right:owned(r.right-ix,y),top:owned(x,r.top+iy),bottom:owned(x,r.bottom-iy)};
    const legacyCorners={topLeft:owned(r.left+1,r.top+1),bottomRight:owned(r.right-1,r.bottom-1)};
    let radiusPixels=null;try { const style=getComputedStyle(button);radiusPixels=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map((key)=>{const match=/^(\d+(?:\.\d+)?)px(?: (\d+(?:\.\d+)?)px)?$/.exec(style[key]);if(!match)return null;const pair=[Number(match[1]),Number(match[2]??match[1])];return pair.every(n=>Number.isFinite(n)&&n<=1000000)?pair:null;}); }catch { /* Optional native geometry only; unknown CSS never leaves the probe. */ }
    return {positiveDimensions:positive,inViewport,width:finite?r.width:null,height:finite?r.height:null,insetX:positive?ix:null,insetY:positive?iy:null,radiusPixels,centerOwned:center,cardinalOwned:cardinal,legacyCornersOwned:legacyCorners,eligible:inViewport&&center===true&&Object.values(cardinal).every(Boolean)};
  };
  const path = 'bitbucket-pipelines.yml';const route = '/atlassian/bitbucket-upload-file/pull-requests/27/diff';
  const forbidden = '[data-geld-ui],.ak-renderer-document,[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"]';
  const native = (node) => node?.isConnected === true && node.closest(forbidden) === null;
  const presented = (node, viewport = false) => {
    if (!native(node) || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    let count = 0;for (let n = node; n; n = n.parentElement) { if (++count > 200) return false;const s = getComputedStyle(n);if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.opacity === '0' || s.contentVisibility === 'hidden') return false; }
    const b = node.getBoundingClientRect();return b.width > 0 && b.height > 0 && (!viewport || b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight);
  };
  const enabled = (node) => native(node) && !node.disabled && !node.readOnly && node.tabIndex >= 0 && node.closest('[aria-disabled="true"],[aria-readonly="true"],fieldset[disabled]') === null;
  const popups = () => [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[popover]')].filter((node) => presented(node));
  let refusal = 'native_binding_unavailable';
  const read = () => {
    refusal = 'route';const url = new URL(location.href);if (url.origin !== 'https://bitbucket.org' || url.pathname !== route || url.search || url.username || url.password || url.hash && url.hash !== '#chg-bitbucket-pipelines.yml') return null;
    refusal = 'anonymous_actor';const metas = [...document.head.querySelectorAll('meta#bb-bootstrap[data-current-user][data-target-workspace-uuid]')].filter(native);if (metas.length !== 1) return null;
    const actor = metas[0];const bytes = actor.getAttribute('data-current-user');const workspace = actor.getAttribute('data-target-workspace-uuid');if (!bytes || bytes.length > 16384 || !workspace || JSON.parse(bytes)?.isAuthenticated !== false) return null;
    refusal = 'native_review_header';const headers = [...document.querySelectorAll('[data-testid="pr-header"]')].filter(native);if (headers.length !== 1) return null;const pr = headers[0];
    const branches = pr.querySelector('[data-qa="pr-branches-and-state-styles"]');const metadata = branches?.nextElementSibling;if (!native(branches) || !native(metadata) || !/^#27\s*•/.test(metadata.textContent.trim())) return null;
    refusal = 'native_repository_link';const repo = [...pr.querySelectorAll('a[href]')].filter((n) => { if (!native(n)) return false;const u = new URL(n.getAttribute('href'), url);return u.origin === url.origin && u.pathname.replace(/\/$/, '') === '/atlassian/bitbucket-upload-file/src' && !u.search && !u.hash && !u.username && !u.password; });if (repo.length === 0) return null;
    refusal = 'native_comparison';const selection = [...document.querySelectorAll('button[aria-haspopup="true"],[role="button"][aria-haspopup="true"]')].filter((n) => presented(n) && n.textContent.trim() === 'All changes' && n.getAttribute('aria-expanded') === 'false');if (selection.length !== 1) return null;
    const branchControls = [...branches.querySelectorAll('[role="button"][aria-haspopup="true"]')].filter((n) => presented(n));if (branchControls.length !== 2 || branchControls.some((n) => n.getAttribute('aria-expanded') !== 'false')) return null;
    refusal = 'native_diff_region';const regions = [...document.querySelectorAll('[role="region"][aria-label="Diff"]')].filter(native);if (regions.length !== 1) return null;const region = regions[0];
    refusal = 'native_file_anchor';const anchors = [...region.querySelectorAll(':scope > div > div[id]')].filter((n) => native(n) && n.id === `chg-${path}`);if (anchors.length !== 1) return null;const anchor = anchors[0];const root = anchor.parentElement;
    const articles = [...root.querySelectorAll('article[data-qa="branch-diff-file"]')].filter(native);if (articles.length !== 1) return null;const article = articles[0];
    refusal = 'native_file_header';const hs = [...article.querySelectorAll('[data-qa="bk-file__header"][data-testid="file-header"]')].filter(native);if (hs.length !== 1) return null;const header = hs[0];const titles = header.querySelectorAll('h2[data-qa="bk-filepath"]');if (titles.length !== 1 || titles[0].textContent.trim() !== path) return null;
    refusal = 'original_file_opener';const menus = [...header.querySelectorAll('[data-qa="bk-file__menu"]')].filter(native);if (menus.length !== 1) return null;const menu = menus[0];const buttons = menu.querySelectorAll('button');const button = buttons[0];
    if (buttons.length !== 1 || button.parentElement !== menu || button.type !== 'button' || button.getAttribute('aria-haspopup') !== 'true' || !['false', 'true'].includes(button.getAttribute('aria-expanded')) || !enabled(button) || !presented(button) || button.querySelectorAll('span[role="img"][aria-label="Diff actions"]').length !== 1) return null;
    refusal = 'native_counts';const tab = document.querySelector('a#pull-request-tabs-1[role="tab"]');const fileCount = tab?.querySelector(':scope > div > span > span');
    const headings = [...document.querySelectorAll('#file-tree h5')].filter((n) => native(n) && n.textContent.trim() === 'Lines updated');if (headings.length !== 1) return null;
    const leaves = [...headings[0].parentElement.parentElement.querySelectorAll('span')].filter((n) => native(n) && n.children.length === 0);const add = leaves.filter((n) => /^\+\s*[\d,]+$/.test(n.textContent.trim()));const del = leaves.filter((n) => /^[-−]\s*[\d,]+$/.test(n.textContent.trim()));
    if (!native(fileCount) || add.length !== 1 || del.length !== 1) return null;const counters = [fileCount, add[0], del[0]];const counts = counters.map((n) => { const t = n.textContent.trim().replaceAll(',', '').replace('−', '-');return /^[+\-]?\d+$/.test(t) ? Math.abs(Number(t)) : null; });if (counts.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 100000000)) return null;
    refusal = 'native_viewed_owner';const viewed = [...header.querySelectorAll('input[type="checkbox"]')];if (viewed.length > 1 || viewed.some((n) => !native(n) || ![...n.labels ?? []].some((l) => l.textContent.trim() === 'Viewed'))) return null;
    refusal = 'native_existing_source';const rows = [...article.querySelectorAll('[data-qa="code-line"]')].filter(native);if (rows.length > 500) return null;
    let textSize = 0;
    const codes = rows.map((row) => { const code = row.querySelector('[data-line-type]');const number = row.querySelector('[data-key="code-line-number"]');if (!native(code) || !native(number)) return null;textSize += code.textContent.length;if (textSize > 512000) return null;return { row, parent: row.parentElement, code, number, text: code.textContent, old: number.getAttribute('data-old-line-number'), next: number.getAttribute('data-new-line-number') }; });if (codes.includes(null)) return null;
    return { url: location.href, actor, bytes, workspace, pr, prParent: pr.parentElement, branches, metadata, metadataText: metadata.textContent, repo, repoHrefs: repo.map((n) => n.getAttribute('href')), selection: selection[0], selectionParent: selection[0].parentElement, branchControls, branchText: branchControls.map((n) => n.textContent), region, regionParent: region.parentElement, anchor, root, rootParent: root.parentElement, article, articleParent: article.parentElement, header, headerParent: header.parentElement, title: titles[0], menu, menuParent: menu.parentElement, button, buttonParent: button.parentElement, counters, countText: counters.map((n) => n.textContent), counts, viewed: viewed[0] ?? null, viewedChecked: viewed[0]?.checked ?? null, viewedDisabled: viewed[0]?.disabled ?? null, codes };
  };
  const same = (now) => {
    if (!store || !now || store.invalid || store.forbidden > 0) return false;const before = store.before;
    const refs = ['actor','pr','prParent','branches','metadata','selection','selectionParent','region','regionParent','anchor','root','rootParent','article','articleParent','header','headerParent','title','menu','menuParent','button','buttonParent','viewed'];
    if (refs.some((k) => now[k] !== before[k]) || ['url','bytes','workspace','metadataText','viewedChecked','viewedDisabled'].some((k) => now[k] !== before[k])) return false;
    for (const k of ['repo','repoHrefs','branchControls','branchText','counters','countText']) if (now[k].length !== before[k].length || now[k].some((v,i) => v !== before[k][i])) return false;
    if (store.clicks === 0 && now.button.getAttribute('aria-expanded') !== 'false') return false;
    return before.codes.every((r) => native(r.row) && r.row.parentElement === r.parent && now.article.contains(r.row) && r.code === r.row.querySelector('[data-line-type]') && r.number === r.row.querySelector('[data-key="code-line-number"]') && r.code.textContent === r.text && r.number.getAttribute('data-old-line-number') === r.old && r.number.getAttribute('data-new-line-number') === r.next);
  };
  try {
    const now = read();
    if (action === 'setup') {
      if (store || !now || now.button.getAttribute('aria-expanded') !== 'false') return { same:false, failure:store?'binding_already_held':!now?refusal:'opener_not_closed' };
      store = { before: now, previousPopups: new Set(popups()), clicks: 0, scrolls: 0, forbidden: 0, invalid: false, armed: null, event: null, controlResult:null, trusted: environment.unitOnly?.trusted };
      store.navigation = () => { store.invalid = true; };
      store.listen = (event) => { const trusted = store.trusted?.(event) ?? event.isTrusted === true;const target = event.target;let permitted = false;try { permitted = event.type === 'click' && target instanceof Element && now.button.contains(target) && store.armed === now.button && store.clicks === 0 && same(read()) && trusted; } catch { permitted = false; }if (permitted) { store.clicks++;store.event = { trusted: true, kind: 'original_diff_actions_opener' }; }else store.forbidden++; };
      for (const type of ['click','input','change','submit','keydown']) document.addEventListener(type, store.listen, true);for (const type of ['popstate','hashchange','wxt:locationchange','pagehide']) document.defaultView?.addEventListener(type, store.navigation);globalThis[key] = store;
    }
    const current = same(now);
    if (['arm','hit'].includes(action) && store) {
      const targetOriginal=current?target===now.button:false;const shown=current?presented(now.button,true):null;const hit=current?hitSummary(now.button):null;
      const eligible=current&&targetOriginal&&shown===true&&hit?.eligible===true&&(action!=='arm'||store.clicks===0);
      store.controlResult={operation:action,sourceCurrent:current,targetOriginal,presented:shown,eligible:current?eligible:null,hit};if(action==='arm')store.armed=eligible?now.button:null;return current?eligible:null;
    }
    if (!current) return action === 'read' ? { same:false, failure:!now?refusal:store?.invalid?'native_navigation_changed':store?.forbidden>0?'unexpected_input':'native_source_or_owner_changed', clicks:store?.clicks??0, forbiddenEvents:store?.forbidden??0, event:store?.event??null } : null;
    if (action === 'opener') return store.clicks === 0 ? now.button : null;
    if (action === 'claim-scroll') { if (target !== now.button || store.clicks || store.scrolls) return false;store.scrolls++;return true; }
    const roots = popups().filter((n) => !store.previousPopups.has(n));const observations = [];
    for (const popup of roots.slice(0,8)) {
      const controls = now.button.getAttribute('aria-controls');const labelled = popup.getAttribute('aria-labelledby');const controlIds = controls?.trim().split(/\s+/) ?? [];const labelIds = labelled?.trim().split(/\s+/) ?? [];
      const associated = { containedByMenu: now.menu.contains(popup), containedByButton: now.button.contains(popup), controlledByOriginal: popup.id !== '' && controlIds.includes(popup.id) && [...document.querySelectorAll('[id]')].filter((n) => n.id === popup.id).length === 1, labelledByOriginal: now.button.id !== '' && labelIds.includes(now.button.id) && [...document.querySelectorAll('[id]')].filter((n) => n.id === now.button.id).length === 1 };
      const anchors = [...popup.querySelectorAll('a[href]')].filter(native);const candidates = [];const rejected = { otherLabel: 0, invalidOrUnqualifiedURL: 0 };let viewSourceLabels = 0;
      for (const a of anchors.slice(0,32)) {
        const label = a.textContent.trim() === 'View source' ? 'view_source' : 'other_or_unknown';if (label === 'view_source') viewSourceLabels++;else rejected.otherLabel++;
        try { const u = new URL(a.getAttribute('href'), location.href);const h = /^\/atlassian\/bitbucket-upload-file\/src\/([0-9a-f]{7,40}|[0-9a-f]{64})\/bitbucket-pipelines\.yml$/.exec(u.pathname)?.[1];if (u.origin !== 'https://bitbucket.org' || u.username || u.password || u.search || u.hash || u.href !== u.origin + u.pathname || !h) { rejected.invalidOrUnqualifiedURL++;continue; }if (candidates.length < 8) candidates.push({ label, url: u.href, ref: h, precision: h.length === 40 || h.length === 64 ? 'full' : 'abbreviated', path, authority: 'not_granted' }); }catch { rejected.invalidOrUnqualifiedURL++; }
      }
      observations.push({ association: associated, fieldCount: Math.min(100, popup.querySelectorAll('input,select,textarea,[contenteditable]').length), links: Math.min(1000,anchors.length), viewSourceLabels, rejected, candidates, truncated: anchors.length > 32 || candidates.length >= 8 });
    }
    const owned = now.root.querySelectorAll('[data-geld-ui]').length;const ownHighlights = typeof CSS === 'undefined' || !CSS.highlights ? 0 : [...CSS.highlights.keys()].filter((n) => n.startsWith('geld-')).length;
    return { same: true, anonymous: true, repository: 'atlassian/bitbucket-upload-file', review: 27, path, comparison: 'all_changes', nativeFullHead: 'unknown', counts: { files: now.counts[0], additions: now.counts[1], deletions: now.counts[2] }, viewed: { available: now.viewed !== null, unchanged: true }, existingCodeRows: store.before.codes.length, ownUi: owned, ownHighlights, inViewport: presented(now.button,true), scrollClaims: store.scrolls, clicks: store.clicks, forbiddenEvents: store.forbidden, event: store.event, expanded: now.button.getAttribute('aria-expanded') === 'true', popupCount: roots.length, popups: observations, truncated: roots.length > 8 };
  } catch { return { same: false, failure: 'native_probe_unavailable' }; }
}

export async function diagnoseNativeFileMenu(page, item, { settings, poll, pause, tabState, guardBudget, unitOnly }) {
  const p = { status: 'running', featureParity: 'not_evaluated', authority: 'not_granted', actions: [], samples: [], sampleCount: 0, limits: { milliseconds: 2000, maxSamples: 20, retainedSamples: 8 }, limitations: ['Original opener-only report, not native full-head, source-frame or whole-file authority.', 'No menu item, source navigation, Escape, Viewed, consent or preference input; no HTML, AX, PNG or arbitrary text/URL capture.'] };item.nativeFileMenu = p;let installed = false;
  const now = unitOnly?.now ?? Date.now;
  const current = async () => { assert.equal(page.isClosed(),false);await settings.current();const tab = await tabState(page);assert.equal(tab?.allowed,false);assert.equal(tab?.hasDiff,false);const v = await page.evaluate(nativeFileMenuProbe);p.lastGuard={same:v?.same===true,failure:v?.failure??null,clicks:v?.clicks??null,event:v?.event??null};assert.equal(v?.same,true);assert.equal(v.ownUi,0);assert.equal(v.ownHighlights,0);assert.equal(v.forbiddenEvents,0);return v; };
  p.phase='initial_settings';p.handle={received:false,asElement:null};p.handleCleanup={status:'not_acquired'};p.controlResults={};
  const control=async(operation,opener)=>{p.phase=operation;p.controlResults[operation]={boolean:null,summary:null};const value=await page.evaluate(nativeFileMenuProbe,operation,opener);p.controlResults[operation].boolean=typeof value==='boolean'?value:null;p.phase=`${operation}_diagnostics`;p.controlResults[operation].summary=await page.evaluate(nativeFileMenuProbe,'control-result');p.phase=`${operation}_assert`;assert.equal(p.controlResults[operation].summary?.operation,operation);assert.equal(p.controlResults[operation].boolean,true);};
  try {
    await settings.current();p.phase='binding';p.bindingSamples=[];const setup = await poll(async()=>{const v=await page.evaluate(nativeFileMenuProbe,'setup');p.bindingSamples.push({same:v?.same===true,failure:v?.failure??null});if(p.bindingSamples.length>8)p.bindingSamples.shift();return v;}, (v) => v?.same === true, 'Already mounted original native Pipeline file menu', 10000);installed = true;p.setup = setup;p.phase='source_after_binding';await current();
    p.phase='handle_acquisition';const handle = await page.evaluateHandle(nativeFileMenuProbe,'opener');p.handle.received=handle!==null&&handle!==undefined;
    try {
      p.phase='handle_type';const opener = handle?.asElement?.()??null;p.handle.asElement=opener!==null;assert.ok(opener);
      if (!setup.inViewport) { p.phase='scroll_claim';p.scrollClaim=null;const claim=await page.evaluate(nativeFileMenuProbe,'claim-scroll',opener);p.scrollClaim=typeof claim==='boolean'?claim:null;assert.equal(p.scrollClaim,true);p.phase='original_scroll';await opener.evaluate((n) => n.scrollIntoView({ block:'center', inline:'nearest', behavior:'instant' }));p.scrolledOriginal = true; }
      p.phase='source_before_arm';await current();await control('arm',opener);await control('hit',opener);p.phase='source_before_input';await current();p.phase='input_budget';const immediateBudget = guardBudget();const action={kind:'original_diff_actions_opener',immediateBudget,status:'input_attempted'};p.actions.push(action);p.phase='input_attempted';await opener.click();action.status='input_sent';p.phase='source_after_input';const after = await current();assert.equal(after.event?.trusted,true);assert.equal(after.clicks,1);action.status='observed';action.event=after.event;
    }catch { p.failureStage??=p.phase;throw new Error('Native file-menu control boundary failed'); }
    finally { if(handle!==null&&handle!==undefined){p.handleCleanup={status:'pending'};try{await handle.dispose();p.handleCleanup.status='released';}catch{p.handleCleanup.status='failed';p.failureStage??='handle_disposal';throw new Error('Native file-menu handle cleanup failed');}} }
    p.phase='observations';
    const deadline = now()+p.limits.milliseconds;
    let timer;const expired = new Error('Native file-menu observation deadline');
    const bounded = async (operation) => { const remaining=deadline-now();if(remaining<=0)throw expired;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(expired),remaining);})]);}finally{clearTimeout(timer);} };
    try { for (let i=0;i<p.limits.maxSamples&&now()<deadline;i++) { const v = await bounded(current);p.sampleCount++;p.samples.push(v);if(p.samples.length>p.limits.retainedSamples)p.samples.shift();if(i+1<p.limits.maxSamples)await bounded(()=>pause(Math.min(100,Math.max(1,deadline-now())))); } }catch(error){if(error!==expired)throw error;p.deadlineReached=true;}
    p.phase='final_source';p.final = await current();p.phase='complete';p.status = 'diagnostic_complete';return { status:'discovery',featureParity:'not_evaluated',reason:'One original native file-menu opener observed. Safe candidates and actual association signals grant no native head or source authority.' };
  } catch { p.failureStage??=p.phase;p.status=installed?'failed':'unavailable';p.failure='native_file_menu_guard_failed';throw new Error('Native file-menu diagnostic unavailable or guard failed'); }
  finally { if(installed&&!page.isClosed())try { p.cleanup='pending';p.cleanupResult=null;const result=await page.evaluate(nativeFileMenuProbe,'cleanup');p.cleanupResult=typeof result?.removed==='boolean'?result.removed:null;assert.equal(p.cleanupResult,true);p.cleanup='removed'; }catch { p.failureStage??='probe_cleanup';p.status='failed';p.cleanup='failed';throw new Error('Native file-menu diagnostic cleanup failed'); }else p.cleanup=page.isClosed()?'page_closed':'not_installed'; }
}
