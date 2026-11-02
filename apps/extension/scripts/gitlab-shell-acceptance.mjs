import { isDeepStrictEqual } from 'node:util';
import prefix from './fixtures/gitlab-run253-prefix.json' with { type: 'json' };

export const GITLAB_SHELL = Object.freeze({ url: 'https://gitlab.com/gitlab-org/step-runner/-/merge_requests/253/diffs?diff_id=1414651952&w=1&file_path=dist%2Fsteps%2Fscript%2F.gitlab-ci.yml', path: 'dist/steps/script/.gitlab-ci.yml', project: 'gitlab-org/step-runner', projectId: '52469398', mr: '253', version: '1414651952', head: '22f769f2c75f5e82e1d456f97e3936d320a9cd33', base: 'f9925c58bb30a2aa77283e22fccde80a2cad5ed6', prefix, selection: 'if ! command' });
const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const failureCodes = new Set(['ACTOR_UNQUALIFIED', 'ANONYMOUS_WITNESS_MISSING', 'APP_DATA_BOUND', 'APP_DATA_UNQUALIFIED', 'BASELINE_NOT_COLD', 'BASELINE_OWNERSHIP_UNQUALIFIED', 'BASELINE_UNAVAILABLE', 'COMPARISON_UNQUALIFIED', 'DISABLE', 'DUPLICATE_TARGET', 'ENABLE', 'FILE_DATA_BOUND', 'FILE_DATA_UNQUALIFIED', 'FILE_RESOURCE_UNQUALIFIED', 'FILE_REVISION_UNQUALIFIED', 'HIGHLIGHT_API_UNAVAILABLE', 'LIGHT_PAINT', 'MEDIA_RESTORE_FAILED', 'NATIVE_BASELINE', 'NATIVE_DARK_MEDIA', 'NATIVE_DIALOG_UNAVAILABLE', 'NATIVE_PALETTE_UNAVAILABLE', 'NATIVE_PREFIX_UNQUALIFIED', 'NATIVE_SOURCE_BOUND', 'NATIVE_SOURCE_CHANGED', 'NATIVE_STREAM', 'NATIVE_TABLE_UNQUALIFIED', 'NATIVE_TARGET_PENDING', 'NATIVE_TARGET_UNAVAILABLE', 'NATIVE_TREE_REVEAL', 'NATIVE_VISIBILITY_UNQUALIFIED', 'OBSERVER_RELEASE_FAILED', 'ORIGINAL_CONTROL_OCCLUDED', 'ORIGINAL_CONTROL_UNAVAILABLE', 'ORIGINAL_SOURCE_CHANGED', 'OWNED_CLEANUP_FAILED', 'OWNED_RANGE_BOUND', 'PAGE_CLOSE_FAILED', 'PAGE_MUST_CLOSE_BEFORE_SETTINGS_RESTORE', 'PAGE_UNQUALIFIED', 'POST_CAPTURE_CHANGED', 'PROBE_RELEASE_FAILED', 'RAW_SETTINGS_RESTORE_FAILED', 'REAL_SELECTION', 'REENABLE', 'REGISTRY_BOUND', 'SELECTION_RESTORE_FAILED', 'SELECTION_TARGET_UNAVAILABLE', 'SETTINGS_CHANGED', 'SETTINGS_CHANGE_UNQUALIFIED', 'SETTINGS_PREPARE_FAILED', 'SETTINGS_UNQUALIFIED', 'SHELL_OPERATION_FAILED', 'SOURCE_READ_FAILED', 'TRUSTED_NATIVE_REVEAL_UNVERIFIED', 'TRUSTED_OWNED_REVEAL_UNVERIFIED', 'UNEXPECTED_FEATURE_SOURCE_REQUEST', 'VIEWED_UNQUALIFIED']);
const failureCode = (error) => failureCodes.has(error?.code) ? error.code : 'SHELL_OPERATION_FAILED';

export function gitLabShellSettings({ read, write, progress }) {
  let original;let expected;let restored;
  return {
    async prepare() {
      original = await read();check(original && typeof original.present === 'boolean' && (!original.present || original.value && typeof original.value === 'object' && !Array.isArray(original.value)), 'SETTINGS_UNQUALIFIED');
      expected = { present: true, value: { ...(original.present ? original.value : {}), enabled: false } };
      await write(expected);check(isDeepStrictEqual(await read(), expected), 'SETTINGS_PREPARE_FAILED');progress.prepared = true;
    },
    async current(enabled) { const actual = await read();check(isDeepStrictEqual(actual, expected) && actual.value.enabled === enabled, 'SETTINGS_CHANGED'); },
    async enabled(value) { check(typeof value === 'boolean' && expected, 'SETTINGS_CHANGE_UNQUALIFIED');await this.current(expected.value.enabled);expected = { present: true, value: { ...expected.value, enabled: value } };await write(expected);await this.current(value);progress.transitions ??= [];progress.transitions.push(value); },
    restore(closed) { if (restored) return restored;restored = (async () => { check(closed, 'PAGE_MUST_CLOSE_BEFORE_SETTINGS_RESTORE');if (original === undefined) return;await write(original);check(isDeepStrictEqual(await read(), original), 'RAW_SETTINGS_RESTORE_FAILED');progress.restored = true;progress.pageClosedBeforeRestore = true; })();return restored; },
  };
}

export function observeGitLabShell(page, progress, extensionId) {
  let stopped = false;
  Object.assign(progress, { records: [], overflow: false, featureSourceRequests: 0, nonreads: 0 });
  const classify = (value) => {
    try { const url = new URL(value);if (url.origin !== 'https://gitlab.com') return 'other';if (/\/assets\/highlight\/themes\//.test(url.pathname)) return 'native_theme';if (url.pathname.includes('/raw/') && url.pathname.endsWith('/.gitlab-ci.yml')) return 'target_raw';return 'gitlab_other'; } catch { return 'other'; }
  };
  const request = (req) => {
    const kind = classify(req.url());let stack = req.initiator?.()?.stack;let extension = false;
    for (let i = 0; stack && i < 8; i++, stack = stack.parent) extension ||= (stack.callFrames ?? []).some((frame) => typeof frame.url === 'string' && frame.url.startsWith(`chrome-extension://${extensionId}/`));
    const method = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method()) ? req.method() : 'other';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) progress.nonreads++;
    if (extension && ['native_theme', 'target_raw'].includes(kind)) progress.featureSourceRequests++;
    if (progress.records.length < 256) progress.records.push({ kind, method, extension });else progress.overflow = true;
  };
  page.on('request', request);
  return { evidence: progress, async dispose() { if (stopped) return;stopped = true;page.off('request', request);progress.released = true; } };
}

/** A test-only native DOM lease; no product state or private capability is inspected. */
export function gitLabShellProbe(action = 'read', f = GITLAB_SHELL) {
  const key = '__geldGitLabShellAcceptance';let p = globalThis[key];
  if (action === 'cleanup') { p?.stop?.();delete globalThis[key];return { released: true }; }
  const fail = (code) => ({ available: false, code });
  const excluded = '[data-geld-ui],.note,.note-text,.md,form,[contenteditable],dialog,[role="dialog"],[role="tooltip"]';
  const native = (node) => node?.isConnected === true && node.closest(excluded) === null;
  const scopes = ['plain','keyword','built_in','literal','number','string','comment','variable','subst','title','meta','attr'];
  const originalURL = () => {
    try { const u = new URL(location.href);return u.origin === 'https://gitlab.com' && u.pathname === '/gitlab-org/step-runner/-/merge_requests/253/diffs' && !u.username && !u.password && [...u.searchParams].every(([name,value]) => name === 'diff_id' && value === f.version || name === 'w' && value === '1' || name === 'file_path' && value === f.path) && u.searchParams.getAll('diff_id').length === 1 && u.searchParams.getAll('w').length === 1 && u.searchParams.getAll('file_path').length <= 1; } catch { return false; }
  };
  if ([...document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]')].some(node=>node.closest('[hidden],[inert],[aria-hidden="true"]')===null&&getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0)) return fail('NATIVE_DIALOG_UNAVAILABLE');
  const roots = [...document.querySelectorAll('[data-rapid-diffs][data-app-data]')].filter(native);
  const root = roots[0];if (!originalURL() || roots.length !== 1 || document.body.dataset.projectId !== f.projectId || document.body.dataset.projectFullPath !== f.project) return fail('PAGE_UNQUALIFIED');
  const appData = root.getAttribute('data-app-data');let app;
  try { if (appData.length > 262144) return fail('APP_DATA_BOUND');app = JSON.parse(appData); } catch { return fail('APP_DATA_UNQUALIFIED'); }
  const chosen = (values) => Array.isArray(values) ? values.filter((x) => x?.selected === true) : [];
  const source = chosen(app.versions?.source_versions), target = chosen(app.versions?.target_versions);
  if (app.project_path !== f.project || String(app.iid) !== f.mr || ![false,'false'].includes(app.is_fork) || app.file_by_file_mode !== false || app.diff_view_type !== 'inline'
    || source.length !== 1 || target.length !== 1 || String(source[0].id) !== f.version || String(target[0].id) !== f.version || source[0].head_sha !== f.head || source[0].base_sha !== f.base || source[0].start_sha !== f.base || target[0].head_sha !== f.head || Object.hasOwn(target[0], 'base_sha') && target[0].base_sha !== f.base || target[0].start_sha !== f.base || source[0].is_merge_head !== false || target[0].is_merge_head !== false) return fail('COMPARISON_UNQUALIFIED');
  if ([...document.querySelectorAll('.js-mr-title-actions[data-is-signed-in="true"]')].some(native)) return fail('ACTOR_UNQUALIFIED');
  const actors = [...document.querySelectorAll('#js-vue-mr-discussions[data-current-user-data]')].filter(native);
  try { if (actors.length !== 1 || JSON.parse(actors[0].getAttribute('data-current-user-data')) !== null) return fail('ACTOR_UNQUALIFIED'); } catch { return fail('ACTOR_UNQUALIFIED'); }
  const signIn = [...document.querySelectorAll('a[data-testid="topbar-signin-button"]')].find((node) => { try { const u = new URL(node.href);return native(node) && u.origin === location.origin && u.pathname === '/users/sign_in'; } catch { return false; } });
  if (!signIn) return fail('ANONYMOUS_WITNESS_MISSING');
  const files = [...root.querySelectorAll('diff-file[data-file-data]')].filter(native).filter((node) => { try { return JSON.parse(node.getAttribute('data-file-data')).new_path === f.path; } catch { return false; } });
  const file = files.length === 1 ? files[0] : null;
  const loading = [...root.querySelectorAll('[data-list-loading]')].filter(native);
  const busy = root.querySelector('[data-diffs-overlay][data-loading]') !== null || loading.some((node) => !node.hidden);
  const treeLinks = [...document.querySelectorAll('a[data-testid="file-row"][data-file-row][href]')].filter(native).filter((node) => {
    try { const u = new URL(node.href);return u.origin === location.origin && u.pathname === new URL(f.url).pathname && u.searchParams.get('file_path') === f.path && u.searchParams.get('diff_id') === f.version && /^[a-f0-9]{40}$/.test(node.getAttribute('data-file-row')) && (!u.hash || u.hash === '#' + node.getAttribute('data-file-row')); } catch { return false; }
  });
  if (action === 'tree-target') {
    if (busy || treeLinks.length !== 1 || p?.treeClicks) return null;
    const link = treeLinks[0];p ??= {};p.tree = { link, parent: link.parentNode, href: link.getAttribute('href') };p.treeClicks = 0;
    p.listen = (event) => { if (event.target instanceof Element && link.contains(event.target) && event.isTrusted && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && native(link) && link.parentNode === p.tree.parent && link.getAttribute('href') === p.tree.href) p.treeClicks++; };
    document.addEventListener('click', p.listen, true);p.stop = () => document.removeEventListener('click', p.listen, true);globalThis[key] = p;return link;
  }
  if (files.length > 1) return fail('DUPLICATE_TARGET');
  if (action === 'locate') return { available: file !== null && file.lastElementChild?.tagName === 'DIFF-FILE-MOUNTED', busy, revealAvailable: treeLinks.length === 1 && !p?.treeClicks, treeClicks: p?.treeClicks ?? 0 };
  if (file === null || busy || file.lastElementChild?.tagName !== 'DIFF-FILE-MOUNTED') return fail('NATIVE_TARGET_PENDING');
  const serialized = file.getAttribute('data-file-data');let data;
  try { if (serialized.length > 16384) return fail('FILE_DATA_BOUND');data = JSON.parse(serialized); } catch { return fail('FILE_DATA_UNQUALIFIED'); }
  if (data.old_path !== f.path || data.diff_refs?.head_sha !== f.head || data.diff_refs?.base_sha !== f.base || data.diff_refs?.start_sha !== f.base || !/^[a-f0-9]{40}$/.test(file.id)) return fail('FILE_REVISION_UNQUALIFIED');
  for (const [name,raw] of [['blob_raw_path',true],['diff_lines_path',false]]) {
    try { const u = new URL(data[name],location.origin);if (u.href !== u.origin+u.pathname || u.origin !== location.origin || u.pathname !== `/${f.project}/-/${raw?'raw':'blob'}/${f.head}/${f.path}${raw?'':'/diff_lines'}`) return fail('FILE_RESOURCE_UNQUALIFIED'); } catch { return fail('FILE_RESOURCE_UNQUALIFIED'); }
  }
  const tables = [...file.querySelectorAll('table.rd-text-view-root.code-syntax-highlight-theme')].filter(native);if (tables.length !== 1) return fail('NATIVE_TABLE_UNQUALIFIED');const table = tables[0];
  const number = (node) => { const value = node?.getAttribute('data-line-number');return /^\d+$/.test(value ?? '') && Number(value) > 0 ? Number(value) : null; };
  const rows = [];
  for (const row of table.querySelectorAll('tr.rd-hunk-lines-inline')) {
    if (!native(row)) continue;const cell = row.querySelector(':scope > td.rd-line-content');const codes = cell?.querySelectorAll('.rd-line-text') ?? [];const code = codes[0];if (!code || codes.length !== 1 || row.querySelectorAll(':scope > td.rd-line-content').length !== 1) continue;
    const before = number(row.querySelector('.rd-line-number[data-position="old"] a[data-line-number]')), after = number(row.querySelector('.rd-line-number[data-position="new"] a[data-line-number]'));
    const nodes=[];const walker=document.createTreeWalker(code,4);let node;while((node=walker.nextNode()))nodes.push(node);
    const raw=nodes.map((node)=>node.data).join('');rows.push({row,code,nodes,raw,text:raw.endsWith('\n')?raw.slice(0,-1):raw,before,after});
  }
  if(rows.length>1000||rows.some(row=>row.nodes.length>512||row.raw.length>16384))return fail('NATIVE_SOURCE_BOUND');
  const after = rows.filter((row)=>row.after!==null);const prefixRows=f.prefix.map((text,index)=>after.filter((row)=>row.after===index+1));
  if (prefixRows.some((matches,index)=>matches.length!==1 || matches[0].text!==f.prefix[index])) return fail('NATIVE_PREFIX_UNQUALIFIED');
  const viewed=[...file.querySelectorAll('input[data-viewed-checkbox]')].filter(native);if(viewed.length>1)return fail('VIEWED_UNQUALIFIED');
  const owned = () => [...CSS.highlights.entries()].filter(([name])=>/^geld-gitlab-shell-/.test(name));
  if (typeof CSS==='undefined' || !CSS.highlights || typeof StaticRange==='undefined')return fail('HIGHLIGHT_API_UNAVAILABLE');
  if(CSS.highlights.size>256||[...CSS.highlights.values()].some(highlight=>highlight.size>4096))return fail('REGISTRY_BOUND');
  const foreign=()=>[...CSS.highlights.entries()].filter(([name])=>!/^geld-gitlab-shell-/.test(name)).map(([name,highlight])=>({name,highlight,ranges:[...highlight].map(range=>({range,start:range.startContainer,end:range.endContainer,a:range.startOffset,b:range.endOffset}))}));
  const ownStyles=()=>[...document.head.querySelectorAll('style[data-geld-ui]')].filter(node=>node.textContent.includes('::highlight(geld-gitlab-shell-'));
  const font = (node) => { const s=getComputedStyle(node),r=node.getBoundingClientRect();return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,style:s.fontStyle,lineHeight:s.lineHeight,spacing:s.letterSpacing,height:r.height}; };
  if(action==='bind'){
    if(p?.bound || owned().length)return fail('BASELINE_OWNERSHIP_UNQUALIFIED');
    p ??= {};Object.assign(p,{bound:true,root,rootParent:root.parentNode,appData,actor:actors[0],actorData:actors[0].getAttribute('data-current-user-data'),signIn,signInParent:signIn.parentNode,signInHref:signIn.getAttribute('href'),file,parent:file.parentNode,serialized,table,rows,viewed:viewed[0]??null,viewedValue:viewed[0]?.checked,viewedDisabled:viewed[0]?.disabled,anchor:file.id,foreign:foreign(),selection:[...Array(getSelection()?.rangeCount??0)].map((_,i)=>getSelection().getRangeAt(i).cloneRange()),
      ids:[...file.querySelectorAll('[id],a[href]')].filter(native).map((node)=>({node,id:node.id,href:node.getAttribute('href')})),fonts:prefixRows.map(([row])=>font(row.code)),invalid:false});
    p.process=(records)=>{for(const record of records){if(record.type==='characterData'&&p.rows.some((row)=>row.nodes.includes(record.target)))p.invalid=true;if(record.type==='attributes'&&record.target===p.file&&['id','data-file-data'].includes(record.attributeName))p.invalid=true;if(record.type==='childList'&&[...record.removedNodes].some((node)=>p.rows.some((row)=>node===row.row||node.contains(row.row)||row.nodes.some((text)=>node===text||node.contains(text)))))p.invalid=true;}};p.observer=new MutationObserver(p.process);
    p.observer.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});const priorStop=p.stop;p.stop=()=>{p.observer.disconnect();priorStop?.();};globalThis[key]=p;
  }
  p?.process?.(p.observer.takeRecords());
  const other=foreign();const foreignPreserved=!!p&&p.foreign?.length===other.length&&p.foreign.every((entry,i)=>{const current=other[i];return entry.name===current.name&&entry.highlight===current.highlight&&entry.ranges.length===current.ranges.length&&entry.ranges.every((r,j)=>Object.keys(r).every(key=>r[key]===current.ranges[j][key]));});
  if(!p?.bound || !foreignPreserved || p.invalid || root!==p.root || root.parentNode!==p.rootParent || appData!==p.appData || actors[0]!==p.actor || actors[0].getAttribute('data-current-user-data')!==p.actorData || signIn!==p.signIn || signIn.parentNode!==p.signInParent || signIn.getAttribute('href')!==p.signInHref || file!==p.file || file.parentNode!==p.parent || table!==p.table || serialized!==p.serialized || file.id!==p.anchor || (viewed[0]??null)!==p.viewed || viewed[0]?.checked!==p.viewedValue || viewed[0]?.disabled!==p.viewedDisabled
    || p.ids.some(({node,id,href})=>!native(node)||node.id!==id||node.getAttribute('href')!==href) || p.rows.length!==rows.length || p.rows.some((row,index)=>row.row!==rows[index].row||row.code!==rows[index].code||row.before!==rows[index].before||row.after!==rows[index].after||row.raw!==rows[index].raw||row.nodes.length!==rows[index].nodes.length||row.nodes.some((node,i)=>node!==rows[index].nodes[i])))return fail('ORIGINAL_SOURCE_CHANGED');
  if(action==='visibility')return{available:true,visible:getComputedStyle(file).display!=='none'&&[prefixRows[6][0],prefixRows[8][0]].every(row=>row.code.getBoundingClientRect().height>0),hiddenMode:file.getAttribute('data-geld-provider-hidden')};
  if(action==='owned-target'){
    if(file.getAttribute('data-geld-provider-hidden')!=='closed')return null;const list=file.closest('.geld-provider-diffs');const controls=[...list?.querySelectorAll(':scope > .geld-provider-hidden > .geld-provider-toggle')??[]];
    if(controls.length!==1||controls[0].getAttribute('aria-expanded')!=='false'||p.ownedClicks)return null;const button=controls[0],parent=button.parentNode;p.ownedListen=(event)=>{if(event.isTrusted&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&button.isConnected&&button.parentNode===parent&&event.target instanceof Element&&button.contains(event.target))p.ownedClicks=(p.ownedClicks??0)+1;};document.addEventListener('click',p.ownedListen,true);const stop=p.stop;p.stop=()=>{document.removeEventListener('click',p.ownedListen,true);stop();};return button;
  }
  const measured=()=>{
    const links=[...document.querySelectorAll('link[rel~="stylesheet"][href]')].filter((link)=>{try{const u=new URL(link.href);return u.origin===location.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/assets\/highlight\/themes\/[a-z][a-z0-9_-]*-[a-f0-9]{8,64}\.css$/i.test(u.pathname);}catch{return false;}});
    if(links.length>16)return null;
    const active=(value)=>!value||matchMedia(value).matches;
    const sheets=links.filter((link)=>{try{return !link.disabled&&active(link.media)&&link.sheet instanceof CSSStyleSheet&&!link.sheet.disabled&&link.sheet.ownerNode===link&&link.sheet.href===link.href&&active(link.sheet.media.mediaText)&&(link.sheet.cssRules.length>=0);}catch{return false;}});
    const base=getComputedStyle(table).getPropertyValue('--code-text-color').trim();if(!base||base.length>160||!CSS.supports('color',base)||/var\(|[;{}<>\r\n]/i.test(base)||!sheets.length)return null;
    let visited=0;const styled=(node,token,rules,depth=0)=>{if(depth>8)return false;for(const rule of rules){if(++visited>4096)return false;if(rule instanceof CSSStyleRule&&rule.selectorText.split(',').some((selector)=>selector.includes('.code-syntax-highlight-theme')&&new RegExp(`\\.${token}(?![\\w-])`).test(selector)&&node.matches(selector)))return true;if(rule instanceof CSSMediaRule&&active(rule.conditionText)&&styled(node,token,rule.cssRules,depth+1))return true;if(typeof CSSSupportsRule!=='undefined'&&rule instanceof CSSSupportsRule&&CSS.supports(rule.conditionText)&&styled(node,token,rule.cssRules,depth+1))return true;}return false;};
    const holder=document.createElement('tbody');holder.setAttribute('data-geld-ui','');holder.setAttribute('data-geld-shell-acceptance-probe','');holder.hidden=true;const row=document.createElement('tr'),cell=document.createElement('td');cell.className='rd-line-content';cell.style.color=base;row.append(cell);holder.append(row);
    const classes={plain:null,keyword:'k',built_in:'nb',literal:'kc',number:'m',string:'s2',comment:'c',variable:'nv',subst:null,title:'nf',meta:'c',attr:'nt'};const palette={};
    try{table.append(holder);for(const scope of scopes){const token=classes[scope];if(token===null){palette[scope]=getComputedStyle(cell).color;continue;}const sample=document.createElement('span');sample.className=token;sample.textContent='x';cell.append(sample);visited=0;if(!sheets.some((link)=>styled(sample,token,link.sheet.cssRules)))return null;const color=getComputedStyle(sample).color;sample.remove();if(!color||!CSS.supports('color',color)||color.length>160||/[;{}<>\r\n]/.test(color))return null;palette[scope]=color;}return{palette,themes:links.map((link)=>({path:new URL(link.href).pathname,active:sheets.includes(link),light:link.media.includes('light'),dark:link.media.includes('dark')})),dark:matchMedia('(prefers-color-scheme: dark)').matches};}finally{holder.remove();}
  };
  if(action==='restore-selection'){const selection=getSelection();selection.removeAllRanges();for(const range of p.selection)selection.addRange(range);return{restored:selection.rangeCount===p.selection.length&&p.selection.every((range,i)=>{const actual=selection.getRangeAt(i);return actual.startContainer===range.startContainer&&actual.endContainer===range.endContainer&&actual.startOffset===range.startOffset&&actual.endOffset===range.endOffset;})};}
  if(action==='capture-box'){
    const code=prefixRows[8][0].code,r=code.getBoundingClientRect();const x=Math.max(0,r.left),y=Math.max(0,r.top),width=Math.min(innerWidth,r.right)-x,height=Math.min(innerHeight,r.bottom)-y;
    if(width<=0||height<=0||width>10000||height>300)return null;const points=[[x+1,y+1],[x+width-1,y+1],[x+1,y+height-1],[x+width-1,y+height-1],[x+width/2,y+height/2]];if(!points.every(([a,b])=>code.contains(document.elementFromPoint(a,b))))return null;return{x,y,width,height};
  }
  if(action==='selection-target'){
    const row=prefixRows[8][0];row.code.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const start=row.text.indexOf(f.selection),end=start+f.selection.length;
    const at=(offset)=>{let seen=0;for(const node of row.nodes){if(offset<=seen+node.data.length)return{node,offset:offset-seen};seen+=node.data.length;}return null;};const a=at(start),b=at(end);if(start<0||!a||!b)return null;const range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const rect=range.getBoundingClientRect();const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return{text:range.toString(),x1:rect.left+0.1,x2:rect.right-0.1,y:rect.top+rect.height/2,visible:rect.width>0&&rect.top>=0&&rect.bottom<=innerHeight&&hit!==null&&row.code.contains(hit)};
  }
  const selection=getSelection();const selected=selection?.rangeCount===1&&prefixRows[8][0].code.contains(selection.anchorNode)&&prefixRows[8][0].code.contains(selection.focusNode)?selection.toString():null;
  const ranges=[];let invalid=0;for(const[name,highlight]of owned()){
    const match=/^geld-gitlab-shell-\d+-(plain|keyword|built_in|literal|number|string|comment|variable|subst|title|meta|attr)$/.exec(name);if(!match){invalid++;continue;}
    for(const range of highlight){if(ranges.length>=4096)return fail('OWNED_RANGE_BOUND');const row=p.rows.find((row)=>row.nodes.includes(range.startContainer));if(!(range instanceof StaticRange)||!(range.startContainer instanceof Text)||range.startContainer!==range.endContainer||!row||![7,9].includes(row.after)||row.before!==null){invalid++;continue;}
      const index=row.nodes.indexOf(range.startContainer),offset=row.nodes.slice(0,index).reduce((n,node)=>n+node.data.length,0),start=offset+range.startOffset,end=offset+range.endOffset;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<14||end<=start||end>row.text.length){invalid++;continue;}ranges.push({scope:match[1],line:row.after,start,end,color:(()=>{const value=getComputedStyle(row.code,`::highlight(${name})`).color;return value.length<=160&&CSS.supports('color',value)?value:'invalid';})()});
    }
  }
  const palette=measured();if(!palette)return fail('NATIVE_PALETTE_UNAVAILABLE');
  const typography=prefixRows.every(([row],index)=>isFontEqual(font(row.code),p.fonts[index]));
  function isFontEqual(a,b){return Object.keys(b).every((name)=>a[name]===b[name]);}
  return{available:true,sourcePreserved:true,prefixLines:15,rows:p.rows.length,refs:{head:f.head,base:f.base,start:f.base},rootId:p.anchor,originalTextNodes:p.rows.reduce((n,row)=>n+row.nodes.length,0),viewedPreserved:true,viewedPresent:p.viewed!==null,observedNegativeLines:{oldClassic:[5,6,7,8,9,10,11,16,17,18,19,20].filter(line=>p.rows.some(row=>row.before===line)),new:[11,13,20].filter(line=>p.rows.some(row=>row.after===line))},foreignPreserved,ownedStyles:ownStyles().length,temporaryProbes:document.querySelectorAll('[data-geld-shell-acceptance-probe]').length,ownedGroups:owned().length,ranges,invalidRanges:invalid,typographyPreserved:typography,selected,palette,treeClicks:p.treeClicks??0,ownedClicks:p.ownedClicks??0};
}

export async function verifyGitLabShell(page,{settings,observer,poll,progress,capture}) {
  Object.assign(progress,{status:'running',phase:'NATIVE_STREAM',limits:['One public MR253 visit; at most one original native file-tree reveal.','Color overlay only, not exact Rouge lexer/font-style equivalence or CI execution.','No raw/config/style oracle fetch, preference write, comment, review or synthetic source.']});let bound=false;let enabled=false;let mediaChanged=false;let originalDark;let primary;
  const read=async()=>{await settings.current(enabled);const value=await page.evaluate(gitLabShellProbe,'read',GITLAB_SHELL);progress.lastRead=value;check(value?.available,value?.code??'SOURCE_READ_FAILED');check(value.sourcePreserved&&value.viewedPreserved&&value.foreignPreserved&&value.temporaryProbes===0&&value.typographyPreserved&&value.invalidRanges===0,'NATIVE_SOURCE_CHANGED');return value;};
  const locate=async()=>{const value=await page.evaluate(gitLabShellProbe,'locate',GITLAB_SHELL);const sample={available:value?.available===true,busy:value?.busy===true,revealAvailable:value?.revealAvailable===true,treeClicks:Number.isInteger(value?.treeClicks)&&value.treeClicks>=0&&value.treeClicks<=1?value.treeClicks:0,...(failureCodes.has(value?.code)?{code:value.code}:{})};progress.lastLocate=sample;return sample;};
  const paintOK=(value)=>value.ranges.length>0&&[7,9].every(line=>value.ranges.some(range=>range.line===line))&&['keyword','built_in','string'].every(scope=>value.ranges.some(range=>range.line===9&&range.scope===scope))&&value.ranges.every(range=>range.color===value.palette.palette[range.scope]);
  const click=async(action)=>{const handle=await page.evaluateHandle(gitLabShellProbe,action,GITLAB_SHELL);try{const element=handle.asElement();check(element,'ORIGINAL_CONTROL_UNAVAILABLE');await element.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));check(await element.evaluate(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return node.isConnected&&hit!==null&&node.contains(hit);}), 'ORIGINAL_CONTROL_OCCLUDED');await element.click();}finally{await handle.dispose();}};
  try{
    await settings.current(false);let found=await poll(locate,value=>!value.busy&&(value.available||value.revealAvailable),'Native target or original tree control becomes ready');
    if(!found.available){check(found.revealAvailable,'NATIVE_TARGET_UNAVAILABLE');progress.phase='NATIVE_TREE_REVEAL';await click('tree-target');found=await poll(locate,value=>!value.busy&&value.available,'Original target mounted');check(found.treeClicks===1,'TRUSTED_NATIVE_REVEAL_UNVERIFIED');}
    progress.phase='NATIVE_BASELINE';const baseline=await page.evaluate(gitLabShellProbe,'bind',GITLAB_SHELL);progress.baseline=baseline;check(baseline.available,baseline.code??'BASELINE_UNAVAILABLE');bound=true;check(baseline.ownedGroups===0&&baseline.ownedStyles===0&&baseline.ranges.length===0,'BASELINE_NOT_COLD');originalDark=baseline.palette.dark;
    progress.phase='ENABLE';await settings.enabled(true);enabled=true;let visibility=await poll(()=>page.evaluate(gitLabShellProbe,'visibility',GITLAB_SHELL),value=>value.available,'Original native source stays bound');
    if(!visibility.visible){check(visibility.hiddenMode==='closed','NATIVE_VISIBILITY_UNQUALIFIED');await click('owned-target');const visible=await page.evaluate(gitLabShellProbe,'read',GITLAB_SHELL);check(visible.ownedClicks===1,'TRUSTED_OWNED_REVEAL_UNVERIFIED');}
    progress.phase='LIGHT_PAINT';const painted=await poll(read,paintOK,'Actual GitLab shell ranges and native colors');progress.paint=painted;
    progress.phase='REAL_SELECTION';const target=await page.evaluate(gitLabShellProbe,'selection-target',GITLAB_SHELL);check(target?.visible&&target.text===GITLAB_SHELL.selection,'SELECTION_TARGET_UNAVAILABLE');await page.mouse.move(target.x1,target.y);await page.mouse.down();await page.mouse.move(target.x2,target.y,{steps:12});await page.mouse.up();const selected=await poll(read,value=>value.selected===GITLAB_SHELL.selection&&paintOK(value),'Real native code selection');progress.selection={mechanism:'real_mouse_drag',text:selected.selected,copy:'unverified'};
    if(capture){progress.artifacts=await capture(page);const after=await read();check(paintOK(after)&&after.selected===selected.selected,'POST_CAPTURE_CHANGED');}
    if(painted.palette.themes.some(theme=>theme.light)&&painted.palette.themes.some(theme=>theme.dark)){
      progress.phase='NATIVE_DARK_MEDIA';await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:originalDark?'light':'dark'}]);mediaChanged=true;const dark=await poll(read,value=>value.palette.dark!==originalDark&&paintOK(value)&&value.palette.palette.keyword!==painted.palette.palette.keyword,'Actual native media and token color change');progress.alternateTheme=dark;
      await page.emulateMediaFeatures([]);mediaChanged=false;await poll(read,value=>value.palette.dark===originalDark&&paintOK(value),'Native media restoration');
    }else progress.alternateTheme={status:'unavailable_native_stylesheet_pair'};
    progress.phase='DISABLE';await settings.enabled(false);enabled=false;progress.disabled=await poll(read,value=>value.ownedGroups===0&&value.ownedStyles===0&&value.ranges.length===0,'Owned shell ranges removed');
    progress.phase='REENABLE';await settings.enabled(true);enabled=true;progress.reenabled=await poll(read,paintOK,'Owned shell ranges restored');
    check(!observer.evidence.overflow&&observer.evidence.featureSourceRequests===0,'UNEXPECTED_FEATURE_SOURCE_REQUEST');progress.status='passed';
  }catch(error){primary=failureCode(error);progress.primaryFailure=primary;progress.failurePhase=progress.phase;progress.status=bound?'failed':'unavailable';}
  finally{
    const errors=[];if(mediaChanged&&!page.isClosed())try{await page.emulateMediaFeatures([]);}catch{errors.push('MEDIA_RESTORE_FAILED');}
    if(enabled&&!page.isClosed())try{await settings.enabled(false);enabled=false;if(bound)await poll(read,value=>value.ownedGroups===0&&value.ownedStyles===0&&value.ranges.length===0,'Final owned cleanup');}catch{errors.push('OWNED_CLEANUP_FAILED');}
    if(bound&&!page.isClosed())try{check((await page.evaluate(gitLabShellProbe,'restore-selection',GITLAB_SHELL)).restored,'SELECTION_RESTORE_FAILED');}catch{errors.push('SELECTION_RESTORE_FAILED');}
    if(!page.isClosed())try{check((await page.evaluate(gitLabShellProbe,'cleanup',GITLAB_SHELL)).released,'PROBE_RELEASE_FAILED');}catch{errors.push('PROBE_RELEASE_FAILED');}
    try{if(!page.isClosed())await page.close();}catch{errors.push('PAGE_CLOSE_FAILED');}
    try{await observer.dispose();}catch{errors.push('OBSERVER_RELEASE_FAILED');}
    try{await settings.restore(page.isClosed());}catch{errors.push('RAW_SETTINGS_RESTORE_FAILED');}
    progress.cleanup={errors,pageClosed:page.isClosed(),settingsRestored:errors.length===0};if(errors.length)progress.status='failed';
    if(primary||errors.length)throw new AggregateError([primary,...errors].filter(Boolean).map(code=>new Error(code)),'GitLab shell acceptance failed');
  }
  return{status:'passed',verified:'Bounded native GitLab run-script color overlay, original source and real selection, owned cleanup and native media response where available. Negative coverage is limited to reported mounted lines; absent old or final-job rows are unexercised. No CI execution, exact Rouge token/font-style equivalence, copy or preference persistence claim.'};
}
