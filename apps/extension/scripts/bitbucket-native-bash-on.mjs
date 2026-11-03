import assert from 'node:assert/strict';
import { nativeSettingsReadinessProbe, waitNativeSettingsCandidate } from './native-settings-readiness.mjs';
import { BITBUCKET_NATIVE_BASH, revealNativeBashTarget, nativeBashStyleSnapshot } from './bitbucket-native-bash.mjs';
import { assertNativeSaveEvents, assertSyntaxOnTraffic } from './bitbucket-syntax-on.mjs';
import { nativeBashOnProbe } from './bitbucket-native-bash-on-probe.mjs';
export { nativeBashOnProbe } from './bitbucket-native-bash-on-probe.mjs';

export const NATIVE_BASH_ROLES = [
  { line: 24, start: 2, end: 23, text: '# required parameters', scope: 'comment' },
  { line: 69, start: 2, end: 4, text: 'if', scope: 'keyword' },
  { line: 69, start: 12, end: 31, text: '${EXTRA_ARGS_COUNT}', scope: 'variable' },
  { line: 69, start: 35, end: 39, text: 'then', scope: 'keyword' },
  { line: 70, start: 19, end: 31, text: "'EXTRA_ARGS'", scope: 'string' },
  { line: 72, start: 12, end: 16, text: 'read', scope: 'built_in' },
  { line: 72, start: 34, end: 37, text: '<<<', scope: null },
  { line: 72, start: 38, end: 53, text: '"${EXTRA_ARGS}"', scope: 'string' },
  { line: 72, start: 39, end: 52, text: '${EXTRA_ARGS}', scope: 'variable' },
  { line: 81, start: 2, end: 4, text: 'if', scope: 'keyword' },
  { line: 81, start: 8, end: 15, text: '${MODE}', scope: 'variable' },
  { line: 81, start: 18, end: 27, text: '"command"', scope: 'string' },
  { line: 81, start: 32, end: 36, text: 'then', scope: 'keyword' },
];

export function nativeBashOnPreflight(active, budget) {
  assert.ok(Number.isSafeInteger(active) && active >= 0);assert.equal(budget, 40);
  return { budgetAvailable: active === 0, active, remaining: budget - active, budget, minimumFreeBeforeSave: 8,
    admissionRequirement: { boundary: 'ROOT-MANUAL', verifiedByHarness: false, requirement: 'Root independently verifies prior successful PR NativeOn, exact native preference restoration and observed request costs before selecting this literal focus. Cite run, artifact and report hashes in the PR admission note. Literal focus is an operator instruction, never automated proof.' },
    basis: 'A completely free rolling40 window is machine-enforced. Historical10 native navigation GETs do not forecast Settings, Save, rerender or restore costs. Prior NativeOn success is an external root requirement, not machine-verified here.' };
}
export function assertBashSyntaxVector(before, after, checked) {
  assert.ok([12, 13].includes(before?.length));assert.equal(after?.length, before.length);assert.equal(before.filter((f) => f.id === 'diff-settings-syntax-highlighting-toggle').length, 1);
  assert.deepEqual(after, before.map((f) => f.id === 'diff-settings-syntax-highlighting-toggle' ? { ...f, checked } : f), 'Preserve every original native field except the intended Syntax checkbox');
}

export function nativeBashMasterScope({ readSettings, patchSettings, writeSettings, progress }) {
  let before;let prepared;let attempted = false;
  return {
    async prepare() { before = structuredClone(await readSettings());progress.status = 'preparing';progress.originalPresent = before !== undefined;attempted = true;await patchSettings({ enabled: false });prepared = structuredClone(await readSettings());assert.equal(prepared?.enabled, false);progress.status = 'disabled_before_page'; },
    async current() { assert.ok(attempted && prepared !== undefined);assert.deepEqual(await readSettings(), prepared, 'Shared settings changed during master-disabled native visit'); },
    async restore(closed) {
      if (!attempted) return;progress.restoration = { status: 'pending', pageClosedBeforeRestore: closed, restored: false };
      try { assert.equal(closed, true, 'Close native page before restoring master');assert.ok(prepared !== undefined, 'Prepared settings readback unavailable');assert.deepEqual(await readSettings(), prepared, 'Do not overwrite another settings change');await writeSettings(before);assert.deepEqual(await readSettings(), before, 'Exact original settings presence/value did not restore');progress.restoration.status = 'restored';progress.restoration.restored = true;progress.status = 'restored'; }
      catch (error) { progress.restoration.status = 'failed';progress.restoration.error = String(error);progress.status = 'failed';throw error; }
    },
  };
}

export function nativeBashOwnedPalette(roles) {
  const root = document.getElementById('chg-pipe/pipe.sh')?.parentElement;if (!root || root.closest('[data-geld-ui]')) return null;
  const rules = [];const inaccessible = [];let seen = 0;let truncated = false;
  const visit = (list, depth) => { if (depth > 6) { truncated = true;return; }for (const rule of list) { if (++seen > 6000) { truncated = true;return; }if (rule.selectorText?.includes('::highlight(geld-bitbucket-shell-')) {if(rules.length>=64){truncated=true;return;}rules.push({ selector: rule.selectorText, color: rule.style?.getPropertyValue('color') ?? null });}if (rule.cssRules?.length) { const text=rule.cssText??'';if(text.startsWith('@layer')||text.startsWith('@media')&&typeof matchMedia==='function'&&matchMedia(rule.conditionText).matches||text.startsWith('@supports')&&typeof CSS!=='undefined'&&typeof CSS.supports==='function'&&CSS.supports(rule.conditionText))visit(rule.cssRules,depth+1);else if(inaccessible.length<40)inaccessible.push({reason:'Conditional highlight rule context was not established'}); } } };
  for (const sheet of document.styleSheets) { try { visit(sheet.cssRules, 0); } catch { if(inaccessible.length<40)inaccessible.push({ reason: 'Stylesheet rule access unavailable' }); } }
  const metrics = (s) => ({ color: s.color, backgroundColor: s.backgroundColor, font:s.font,fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, fontStyle: s.fontStyle, borderTopWidth: s.borderTopWidth, borderRightWidth: s.borderRightWidth, borderBottomWidth: s.borderBottomWidth, borderLeftWidth: s.borderLeftWidth, borderTopStyle: s.borderTopStyle, borderRightStyle:s.borderRightStyle,borderBottomStyle:s.borderBottomStyle,borderLeftStyle:s.borderLeftStyle,borderTopColor: s.borderTopColor,borderRightColor:s.borderRightColor,borderBottomColor:s.borderBottomColor,borderLeftColor:s.borderLeftColor, borderRadius: s.borderRadius, textShadow: s.textShadow });
  const tokens={keyword:['--ds-text-code-keywords'],built_in:['--ds-text-accent-blue-bolder','--ds-text-code-functions'],string:['--ds-text-accent-orange','--ds-text-code-strings'],comment:['--ds-comment-refreshed','--ds-text-code-comments'],variable:['--ds-text-accent-blue-bolder','--ds-text-code-accent-1']};
  const result = roles.map((role) => {
    const rows = [...root.querySelectorAll('[data-qa="code-line"]')].filter((n) => n.closest('[data-geld-ui]') === null && n.querySelector('[data-key="code-line-number"]')?.getAttribute('data-new-line-number') === String(role.line));if (rows.length !== 1) return { ...role, status: 'source_unavailable' };
    const code = rows[0].querySelector('[data-line-type]');if (!code || ![' ', '+'].includes(code.getAttribute('data-line-type')) || code.textContent.slice(role.start, role.end) !== role.text) return { ...role, status: 'source_mismatch' };
    const pieces = [];const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);let offset = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { const start = offset;offset += n.data.length;if (pieces.length >= 32) return { ...role, status: 'truncated' };const from = Math.max(role.start, start);const to = Math.min(role.end, offset);if (from >= to) continue;
      const parent = n.parentElement;const s = getComputedStyle(parent);let pseudo = null;let pseudoError = null;
      if (role.scope !== null) { try { pseudo = { color: getComputedStyle(parent, `::highlight(geld-bitbucket-shell-${role.scope})`).color }; } catch { pseudoError = 'Custom highlight computed style unavailable'; } }
      const range = document.createRange();range.setStart(n, from - start);range.setEnd(n, to - start);const rects = [...range.getClientRects()].map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }));
      const overlays=[...document.querySelectorAll('[role="tooltip"],[popover],[role="dialog"],[role="menu"]')].filter((n)=>n.closest('[data-geld-ui]')===null&&n!==parent&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).opacity!=='0').map((n)=>n.getBoundingClientRect()).filter((r)=>r.width>0&&r.height>0);
      let presented=!parent.closest('[hidden],[inert],[aria-hidden="true"]');for(let p=parent;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||['hidden','collapse'].includes(s.visibility)||s.opacity==='0'||s.contentVisibility==='hidden')presented=false;}
      const visible = presented && rects.length > 0 && rects.every((r) => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && !overlays.some((o)=>o.left<r.right&&o.right>r.left&&o.top<r.bottom&&o.bottom>r.top) && [[(r.left+r.right)/2,(r.top+r.bottom)/2],[r.left+Math.min(1,r.width/4),r.top+Math.min(1,r.height/4)],[r.right-Math.min(1,r.width/4),r.bottom-Math.min(1,r.height/4)]].every(([x,y])=>code.contains(document.elementFromPoint(x,y))));
      const choices=role.scope===null?[]:tokens[role.scope]??[];const token=choices.find((name,i)=>i===choices.length-1||s.getPropertyValue(name)!==''||Array.from({length:s.length},(_,j)=>s.item(j)).includes(name))??null;const tokenValue=token?s.getPropertyValue(token).trim():'';const tokenAvailable=token!==null&&tokenValue!==''&&!tokenValue.includes('var(')&&typeof CSS!=='undefined'&&typeof CSS.supports==='function'&&CSS.supports('color',tokenValue);
      pieces.push({ token,tokenValue,tokenAvailable,start: from, end: to, text: n.data.slice(from-start, to-start), nativeStyle: metrics(s), ownedPseudo: pseudo, pseudoError, rects, visible });
    }
    const ruleCovered = role.scope !== null && typeof CSS!=='undefined' && CSS.highlights!==undefined && typeof CSS.supports==='function' && CSS.supports('selector(::highlight(geld-bitbucket-shell-'+role.scope+'))') && rules.some((r) => r.selector.split(',').some(s=>s.trim()===`::highlight(geld-bitbucket-shell-${role.scope})`) && r.color);
    return { ...role, status: 'observed_original', codeStyle: metrics(getComputedStyle(code)), pieces, ruleCovered };
  });
  return { selectedTheme: { colorMode: document.documentElement.getAttribute('data-color-mode'), theme: document.documentElement.getAttribute('data-theme') }, rules, inaccessible, truncated, roles: result };
}

export function compareBashPalette(native, owned) {
  assert.equal(native?.status, 'observed');assert.ok(owned && Array.isArray(owned.roles));
  return owned.roles.map((role) => {
    const sample = native.samples.find((s) => s.line === role.line);const segments = [];
    for (const piece of role.pieces ?? []) {
      const node = sample?.nodes?.find((n) => n.start <= piece.start && n.end >= piece.end);const cuts = [...new Set([piece.start, piece.end, ...(node?.highlights ?? []).flatMap((h) => [Math.max(h.start,piece.start),Math.min(h.end,piece.end)]).filter((n) => n > piece.start && n < piece.end)])].sort((a,b)=>a-b);
      for (let i=1;i<cuts.length;i++) { const start=cuts[i-1],end=cuts[i];const paint=(node?.highlights??[]).filter((h)=>h.start<end&&h.end>start);const nativeColor=paint.length===0?piece.nativeStyle.color:paint.length===1?paint[0].pseudoStyle?.color:null;const covered=node!==undefined&&native.highlights?.supported===true&&!native.highlights.truncated&&(native.highlights.errors?.length??0)===0&&sample?.truncated!==true&&sample?.spansTruncated!==true&&role.scope!==null&&piece.tokenAvailable===true&&role.ruleCovered&&!owned.truncated&&paint.length<=1&&nativeColor&&piece.ownedPseudo?.color;
        segments.push({start,end,text:sample?.text.slice(start,end),nativeColor:nativeColor??null,ownedColor:piece.ownedPseudo?.color??null,nativeHighlights:paint.map((h)=>h.name),status:covered?(nativeColor===piece.ownedPseudo.color?'matched':'mismatched'):'unmeasured',visible:piece.visible}); }
    }
    const status=segments.some((s)=>s.status==='mismatched')?'mismatched':segments.length>0&&segments.every((s)=>s.status==='matched')?'matched':'unmeasured';
    return { line:role.line,start:role.start,end:role.end,scope:role.scope,text:role.text,status,segments };
  });
}

export function nativeBashPaintEvidence(native) {
  const tokenizedSamples=[];const tokenPaintSamples=[];let nativeHighlightIntersections=0;
  for(const sample of native.samples){
    const tokens=(sample.spans??[]).filter((span)=>span.className.split(/\s+/).includes('token'));
    if(tokens.length)tokenizedSamples.push(sample.line);
    if(tokens.some((span)=>span.style!=null&&sample.codeStyle!=null&&['color','fontWeight','fontStyle','textShadow','textDecorationColor'].some((key)=>span.style[key]!==undefined&&span.style[key]!==''&&span.style[key]!==sample.codeStyle[key])))tokenPaintSamples.push(sample.line);
    for(const node of sample.nodes??[])for(const paint of node.highlights??[])if(!paint.ownedName&&paint.pseudoStyle?.color)nativeHighlightIntersections++;
  }
  const observed=tokenPaintSamples.length>0||nativeHighlightIntersections>0;
  return {status:observed?'observed':'unavailable',tokenizedSamples,tokenPaintSamples,nativeHighlightIntersections,reason:observed?'Actual source-bound native token styles or native highlight paint observed. No classifier equivalence inferred.':'Native On has no measured token/native-highlight paint in the five source samples. Native Bash palette reference remains unavailable; per-role comparisons are diagnostic only.'};
}

export async function characterizeNativeBashOn(page, item, deps) {
  const { poll, pause, capture, guardBudget, tabState, source, traffic, settings } = deps;
  const p = { status: 'running', admissionBoundary: { boundary: 'ROOT-MANUAL', verifiedByHarness: false, evidenceLocation: 'Root admission note with actual prior NativeOn run, artifact and report hashes. Literal selection alone is not proof.' }, actions: [], writes: [], restoration: { status: 'pending' }, limitations: ['Native source/style characterization only, never an extension feature pass.', 'No native dark selection, server persistence, enabled-runtime Bash path exclusion or complete grammar equivalence.'] };item.nativeBashOn = p;item.suppressGenericNativeBashCapture = true;
  let installed=false;let initial;let failure;let modified=false;
  const read=()=>page.evaluate(nativeBashOnProbe);
  const current=async()=>{assert.equal(page.isClosed(),false);await settings.current();await source.flush();assert.deepEqual(source.evidence.errors,[]);assert.ok(source.evidence.metadata.length>0,'Already-issued exact immutable commit metadata required');assert.equal(source.evidence.extensionFrameCount,0);assert.equal((await tabState(page)).allowed,false);const v=await read();assert.equal(v?.same,true,'Native source/actor/URL/counts/Viewed lease changed');assert.deepEqual(v.ownedHighlights,[]);assert.equal(v.ownedUi,0);return v;};
  const click=async(kind)=>{const budget=guardBudget();await current();const h=await page.evaluateHandle(nativeBashOnProbe,kind);try{const n=h.asElement();assert.ok(n,`Original native ${kind} unavailable`);await n.evaluate((n)=>n.scrollIntoView({block:'center',behavior:'instant'}));assert.equal(await page.evaluate(nativeBashOnProbe,`arm-${kind}`,n),true);assert.equal(await page.evaluate(nativeBashOnProbe,'hit',n),true);if(kind==='opener')assert.equal((await page.evaluate(nativeSettingsReadinessProbe,'begin','standalone',n))?.started,true);const immediateBudget=guardBudget();if(kind==='save'){p.writes.at(-1).immediateBudget=immediateBudget;assert.ok(40-immediateBudget.observedWithinRollingHour>=8,'Keep eight free immediately before actual native Save input');}await n.click();const event=await page.evaluate(nativeBashOnProbe,'event');assert.equal(event?.trusted,true);p.actions.push({kind,budget,immediateBudget,event});if(kind!=='save')await current();return event;}finally{await h.dispose();}};
  const open=async()=>{
    const progress={status:'opening'};(p.formReadiness??=[]).push(progress);
    try{await click('opener');const bound=await waitNativeSettingsCandidate(page,{readCurrent:current,read,bind:()=>page.evaluate(nativeBashOnProbe,'bind'),tabWitness:'bitbucket-native-tab',pause,progress});p.lastForm=progress.samples.at(-1);if(bound===null){p.readinessBlocked=true;p.unknownForm=p.lastForm?.diagnostics??{fields:[]};if(initial===undefined&&!modified)p.restoration={status:'not_modified',unknownFormUntouched:true};return null;}p.readinessBlocked=false;p.formCandidate=bound.candidate;return bound.vector;}
    catch(error){p.readinessBlocked=true;throw error;}
  };
  const close=async()=>{const event=await click('cancel');await poll(read,v=>v?.same&&v.dialogs===0,'Known original native Cancel closes Settings',4000);return event;};
  const save=async(checked)=>{const budget=guardBudget();assert.ok(40-budget.observedWithinRollingHour>=8,'Keep eight free before a native Save; costs remain unmeasured');const before=await current();assertBashSyntaxVector(initial,before.vector,!checked);modified=true;const record={expected:checked,budget};p.writes.push(record);await click('syntax');assertBashSyntaxVector(initial,(await current()).vector,checked);assert.equal(await page.evaluate(nativeBashOnProbe,'begin-save',checked),true);const w=traffic.beginSave(checked);record.window=w.id;try{await click('save');await poll(read,v=>v?.same&&v.dialogs===0,'Original native Save closes Settings',5000);}finally{record.events=await page.evaluate(nativeBashOnProbe,'events');traffic.endSave(record.events);}assertNativeSaveEvents(record.events,checked);await current();};
  const baseline=async()=>{const ready=await page.evaluate(nativeBashOnProbe,'ready-frames');assert.equal(ready?.frames,2);const b=await page.evaluate(nativeBashOnProbe,'baseline');assert.equal(b?.same,true);return b;};
  try{
    assert.equal(deps.freshAnonymousProfile,true);await settings.current();
    p.preparation={actions:[]};await (deps.unitOnly?.prepare??revealNativeBashTarget)(page,p.preparation,{poll,tabState});
    await source.flush();assert.ok(source.evidence.metadata.length>0);p.setup=await poll(()=>page.evaluate(nativeBashOnProbe,'setup',null,BITBUCKET_NATIVE_BASH),v=>v?.same,'Immutable native Bash source and actor baseline',10000);assert.equal(p.setup?.same,true);installed=true;await current();
    initial=await open();if(initial===null){initial=undefined;p.status='unavailable';return{status:'unavailable',featureParity:'not_evaluated',reason:'Unrecognized standalone native Settings form. No field, Save or Cancel operated; page closure is required.'};}
    p.initialVector=initial;const initiallyOn=initial.find(f=>f.id==='diff-settings-syntax-highlighting-toggle').checked;p.initiallyOn=initiallyOn;
    if(!initiallyOn){await save(true);const on=await open();assert.ok(on,'Fresh native On form became unknown after Save');assertBashSyntaxVector(initial,on,true);}
    p.nativeOnBaseline=await baseline();assertBashSyntaxVector(initial,(await read()).vector,true);await close();await current();
    const collect=async(label)=>{const state=await current();assert.equal(state.stable,true);assert.equal(state.foreignPreserved,true);const adjusted={...BITBUCKET_NATIVE_BASH,sourceSamples:p.nativeOnBaseline.sourceSamples};const native=await page.evaluate(nativeBashStyleSnapshot,adjusted);assert.equal(native.status,'observed');assert.ok(native.samples.every(s=>s.status==='matched_original'));assert.deepEqual(native.ownership.ownedHighlights,[]);assert.equal(native.ownership.ownedUi,0);const owned=await page.evaluate(nativeBashOwnedPalette,NATIVE_BASH_ROLES);assert.deepEqual(owned?.selectedTheme,p.nativeOnBaseline.theme,'Selected native theme changed during measurements');await current();const record={label,native,owned,comparison:compareBashPalette(native,owned)};(p.measurements??=[]).push(record);return record;};
    await collect('native_on_before_viewport_capture');
    for(const line of [24,72]){guardBudget();await current();const selector=`[role="region"][aria-label="Diff"] > div:has(> [id="chg-pipe/pipe.sh"]) article[data-qa="branch-diff-file"] [data-qa="code-line"]:has([data-key="code-line-number"][data-new-line-number="${line}"])`;const h=await page.$(selector);try{assert.ok(h,'Exact original source row unavailable');await h.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));}finally{await h.dispose();}const observation=await collect(`viewport_${line}_before`);const required=observation.owned.roles.filter(r=>line===24?r.line===24:r.line!==24);p.viewportCoverage??=[];p.viewportCoverage.push({line,roles:required.map(r=>({line:r.line,start:r.start,end:r.end,visible:r.pieces?.length>0&&r.pieces.every(p=>p.visible)}))});p.artifacts??=[];p.artifacts.push(await capture(page,`bitbucket-native-bash-on-${line}`));await collect(`viewport_${line}_after`);}
    p.uncoveredViewportRoles=NATIVE_BASH_ROLES.filter(role=>!p.viewportCoverage.some(c=>c.roles.some(r=>r.line===role.line&&r.start===role.start&&r.end===role.end&&r.visible))).map(({line,start,end,scope})=>({line,start,end,scope}));p.nativePaintEvidence=p.measurements.map(({label,native})=>({label,...nativeBashPaintEvidence(native)}));const paintedStages=p.nativePaintEvidence.filter(s=>s.status==='observed');p.tokenReference={status:paintedStages.length===0?'unavailable':paintedStages.length===p.nativePaintEvidence.length?'observed':'partial',reason:paintedStages.length===0?'No measured native token/highlight paint in any retained stage. Per-role comparisons remain diagnostic.':'Native paint stages are recorded separately; mixed readiness is partial, not a stable native palette reference.'};p.status=p.uncoveredViewportRoles.length===0&&p.tokenReference.status==='observed'?'characterized':'partial_reference';return{status:'discovery',featureParity:'not_evaluated',reason:p.tokenReference.status==='unavailable'?'Native On is observed but native token paint/palette reference is unavailable. Per-role comparisons remain diagnostic. No feature or native Bash palette acceptance.':p.tokenReference.status==='partial'?'Native token paint varies across the retained stages. The reference is partial and comparisons remain diagnostic.':'Actual standalone native Syntax-On source/style reference under its selected theme, with explicit per-role comparisons. No full feature, dark or server-persistence claim.'};
  }catch(error){failure=error;p.status='failed';p.error=String(error);throw error;}
  finally{
    let cleanup;
    try{if(installed&&initial!==undefined){p.restoration={status:'pending',modificationAttempted:modified};await current();const state=await read();if(state.dialogs){assert.notEqual(p.readinessBlocked,true,'Readiness-invalid form remains untouched');assert.equal(state.ready,true,'Do not operate an unknown replacement Settings dialog');await close();}let vector=await open();assert.ok(vector,'Native restoration form is unknown');const desired=initial.find(f=>f.id==='diff-settings-syntax-highlighting-toggle').checked;const checked=vector.find(f=>f.id==='diff-settings-syntax-highlighting-toggle').checked;assertBashSyntaxVector(initial,vector,checked);if(checked!==desired){await save(desired);vector=await open();assert.ok(vector);}assertBashSyntaxVector(initial,vector,desired);p.restoration.readback=vector;p.restoration.baseline=await baseline();p.restoration.cancel=await close();p.restoration.after=await current();p.restoration.status='restored';}else if(!p.unknownForm)p.restoration={status:'not_modified'};}
    catch(error){cleanup=error;p.restoration.status='failed';p.restoration.error=String(error);p.status='failed';}
    try{await poll(()=>traffic.pending(),n=>n===0,'Observed native Save-window writes settle',3000);assertSyntaxOnTraffic(item.nativeBashOnTraffic,source.evidence.mutations);p.trafficCheck={status:'recorded',attribution:'Trusted original form windows and observed bodies, not inferred endpoint, actor or persistence'};}catch(error){cleanup??=error;p.trafficCheck={status:'failed',error:String(error)};p.status='failed';}
    if(installed&&!page.isClosed())for(const probe of[nativeBashOnProbe,nativeSettingsReadinessProbe])try{await page.evaluate(probe,'cleanup');}catch(error){cleanup??=error;p.cleanupError=String(error);p.status='failed';}
    if(cleanup&&failure)throw new AggregateError([failure,cleanup],'Native Bash characterization and preference restoration failed');if(cleanup)throw cleanup;
  }
}
