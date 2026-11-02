import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertDisplayedOutlineCounts, GITLAB_DISPLAYED_OUTLINE } from './gitlab-displayed-outline.mjs';

export const GITLAB_WHOLE_TEST = Object.freeze({ path:GITLAB_DISPLAYED_OUTLINE.path, bodySha256:'3a3823e627ba0eca13d2a97945a97ca18d0225e6b5a85b6bc8d0e6bf0354a84b', retainedHead:'d03aadd2c95a94ecbe229896b29c9dcda009a916', target:{ title:'generates an error', start:96, end:100 }, second:{ title:'moves and repositions issue', start:125, end:131 } });

/** Observe only original native source, actual owned controls and browser input; never create source or dispatch app events. */
export function gitLabWholeTestProbe(action='read', argument=null) {
  const KEY='__geldWholeTestObservation';let store=globalThis[KEY];
  if(action==='cleanup'){store?.cleanup();delete globalThis[KEY];return null;}
  const url=new URL(location.href), path='spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
  if(url.origin!=='https://gitlab.com'||url.pathname!=='/gitlab-org/gitlab/-/merge_requests/266334/diffs'||url.search!=='?diff_id=2158520123')return null;
  const native=(node)=>node.closest('[data-geld-ui]')===null;
  const matches=[...document.querySelectorAll('diff-file[data-file-data]')].filter((root)=>{try{return native(root)&&JSON.parse(root.getAttribute('data-file-data')).new_path===path;}catch{return false;}});
  if(matches.length!==1)return null;const root=matches[0];let data;try{data=JSON.parse(root.getAttribute('data-file-data'));}catch{return null;}
  const rows=()=>[...root.querySelectorAll('tr.rd-hunk-lines-inline,tr.rd-hunk-lines-parallel')].filter(native).map((row)=>{
    const number=row.querySelector('.rd-line-number[data-position="new"] a[data-line-number]')?.getAttribute('data-line-number');
    const cell=row.matches('.rd-hunk-lines-parallel')?row.querySelector('td.rd-line-content[data-position="new"]'):row.querySelector('td.rd-line-content');
    const walk=document.createTreeWalker(row,NodeFilter.SHOW_TEXT),texts=[];for(let node=walk.nextNode();node!==null;node=walk.nextNode())texts.push([node,node.data]);
    return{node:row,html:row.innerHTML,attributes:[...row.attributes].filter((attribute)=>attribute.name!=='data-geld-provider-line-hidden').map((attribute)=>[attribute.name,attribute.value]),texts,number:number&&/^[1-9]\d*$/.test(number)?Number(number):null,text:cell?.querySelector('.rd-line-text')?.textContent?.replace(/\n$/,'')??null,ids:[...row.querySelectorAll('[id]')].map((node)=>[node,node.id]),links:[...row.querySelectorAll('a[href]')].map((node)=>[node,node.getAttribute('href')])};
  });
  const controls=()=>[...root.querySelectorAll('tr.rd-hunk-header[data-hunk-header] button[data-click="expandLines"][data-expand-direction]')].filter((button)=>native(button)&&button.closest('diff-file')===root&&button.closest('.note,.md,[data-testid="noteable-note-container"],form,dialog,[role="dialog"]')===null&&button.closest('table.rd-text-view-root')!==null&&button.closest('tr')?.querySelector('.rd-line-content')===null&&['up','down','both'].includes(button.dataset.expandDirection));
  const contextSample=(button)=>{
    const sequence=[...root.querySelectorAll('tr')],index=sequence.indexOf(button.closest('tr')),numbered=new Map(rows().map((line)=>[line.node,line.number]));
    const beforeNew=sequence.slice(0,index).map((row)=>numbered.get(row)??null).findLast((number)=>number!==null)??null;
    const afterNew=sequence.slice(index+1).map((row)=>numbered.get(row)??null).find((number)=>number!==null)??null;
    return{direction:button.dataset.expandDirection,label:button.getAttribute('aria-label'),beforeNew,afterNew};
  };
  const viewed=()=>[...root.querySelectorAll('input[data-viewed-checkbox],[data-testid="fileReviewCheckbox"] input')].filter(native);
  const intent=root.querySelector('header[data-testid="rd-diff-file-header"] > .rd-diff-file-info > button[data-geld-test-boundaries]');
  if(action==='setup'){
    if(store)throw Error('Whole-context source observation already exists');
    const initial=rows();if(initial.length===0||initial.length>500||initial.reduce((sum,row)=>sum+row.texts.length,0)>10000)throw Error('Whole-context original row inventory unavailable');
    store={root,parent:root.parentElement,url:location.href,data:root.getAttribute('data-file-data'),rows:initial,viewed:viewed().map((node)=>({node,checked:node.checked,disabled:node.disabled})),events:[],expected:null};
    store.listener=(event)=>{
      if(!(event.target instanceof Element))return;
      if(event.type==='click'&&store.expected?.contains(event.target))store.lastClick={trusted:event.isTrusted===true,label:store.expected.getAttribute('aria-label')??store.expected.textContent,url:location.href};
      if(!root.contains(event.target))return;
      const context=event.target.closest('button[data-click="expandLines"][data-expand-direction]');
      if(context)store.events.push({kind:'context',type:event.type,trusted:event.isTrusted===true,nativeOwned:controls().includes(context),...contextSample(context),url:location.href});
      if(store.viewed.some(({node})=>node===event.target))store.events.push({kind:'viewed',type:event.type,trusted:event.isTrusted===true});
    };
    for(const type of ['click','input','change'])document.addEventListener(type,store.listener,true);
    store.cleanup=()=>{for(const type of ['click','input','change'])document.removeEventListener(type,store.listener,true);};globalThis[KEY]=store;
  }
  if(!store)return null;
  const currentRows=rows();const sameOriginal=store.root===root&&root.parentElement===store.parent&&store.url===location.href&&store.data===root.getAttribute('data-file-data')&&(store.firstOpenedRows??store.rows).every((old)=>{
    const current=currentRows.find((line)=>line.node===old.node);return current&&current.number===old.number&&current.text===old.text&&current.html===old.html&&JSON.stringify(current.attributes)===JSON.stringify(old.attributes)&&current.texts.length===old.texts.length&&current.texts.every(([node,text],i)=>node===old.texts[i][0]&&text===old.texts[i][1])&&current.ids.length===old.ids.length&&current.ids.every(([node,id],i)=>node===old.ids[i][0]&&id===old.ids[i][1])&&current.links.length===old.links.length&&current.links.every(([node,href],i)=>node===old.links[i][0]&&href===old.links[i][1]);
  });
  const unchangedViewed=store.viewed.length===viewed().length&&store.viewed.every(({node,checked,disabled})=>node.isConnected&&root.contains(node)&&node.checked===checked&&node.disabled===disabled);
  if(action==='retain-first'){if(!sameOriginal||!unchangedViewed)throw Error('First opened native source changed before second-test checkpoint');store.firstOpenedRows=currentRows;}
  const folds=[...root.querySelectorAll('[data-geld-provider-fold-row^="test:"]')].map((row)=>({row,button:row.querySelector('button'),title:row.querySelector('.geld-provider-line-fold__title')?.textContent??'',start:Number(row.querySelector('.geld-provider-line-fold__line')?.textContent),expanded:row.querySelector('button')?.getAttribute('aria-expanded'),label:row.querySelector('button')?.getAttribute('aria-label')??''}));
  const category=(name)=>[...document.querySelectorAll('.geld-provider-category-header')].filter((button)=>new RegExp(`^${name}\\b`).test(button.textContent.trim()));
  if(action==='button'){
    if(!sameOriginal||!unchangedViewed)return null;
    if(argument==='intent')return intent;
    if(argument==='Tests'||argument==='Essential'){const buttons=category(argument);return buttons.length===1?buttons[0]:null;}
    return folds.find((fold)=>fold.start===argument)?.button??null;
  }
  if(action==='arm'){if(!(argument instanceof HTMLButtonElement)||![intent,...folds.map((fold)=>fold.button),...category('Tests'),...category('Essential')].includes(argument))return false;store.expected=argument;store.lastClick=null;return true;}
  if(action==='click-result')return store.lastClick??null;
  const css=(node)=>node?Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','borderRadius','borderWidth','boxShadow'].map((name)=>[name,getComputedStyle(node)[name]])):null;
  const sampleNative=[...root.querySelectorAll('header button.btn-default.btn-sm')].find(native)??null;
  return{url:location.href,path,sameOriginal,unchangedViewed,rawPath:data.blob_raw_path??null,headSha:data.diff_refs?.head_sha??null,baseSha:data.diff_refs?.base_sha??null,startSha:data.diff_refs?.start_sha??null,
    intent:intent?{label:intent.textContent,status:intent.dataset.status,disabled:intent.disabled,nativeClasses:intent.className,style:css(intent),nativeComparison:sampleNative?{classes:sampleNative.className,style:css(sampleNative)}:null}:null,
    visible:getComputedStyle(root).display!=='none'&&root.getBoundingClientRect().height>0,sourceRows:currentRows.map((line)=>({number:line.number,text:line.text,hidden:line.node.hasAttribute('data-geld-provider-line-hidden')})),
    folds:folds.map(({row,button,...fold})=>fold),controls:controls().map(contextSample),events:[...store.events],
    categories:[...document.querySelectorAll('.geld-provider-category-header')].map((button)=>({text:button.textContent.trim(),expanded:button.getAttribute('aria-expanded')}))};
}

export function qualifyGitLabWholeResponse(sample, response) {
  assert.match(sample.headSha??'',/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
  const expected=new URL(`/gitlab-org/gitlab/-/raw/${sample.headSha}/${GITLAB_WHOLE_TEST.path}`,'https://gitlab.com');
  assert.equal(new URL(sample.rawPath,'https://gitlab.com').href,expected.href);assert.equal(response.url,expected.href);assert.equal(response.status,200);assert.equal(response.redirected,false);
  assert.ok(response.bytes>0&&response.bytes<=512*1024);assert.equal(response.sha256,GITLAB_WHOLE_TEST.bodySha256,'The current immutable raw file must independently match the qualified complete fixture, not merely visible text');
  const lines=response.lines;assert.ok(Array.isArray(lines)&&lines.length<=10_000);
  for(const row of sample.sourceRows)if(row.number!==null)assert.equal(lines[row.number-1],row.text,'Fresh immutable source disagrees with original native new-side text');
  for(const leaf of [GITLAB_WHOLE_TEST.target,GITLAB_WHOLE_TEST.second]){
    assert.match(lines[leaf.start-1],new RegExp(`\\bit '${leaf.title}' do$`));assert.equal(lines[leaf.end-1].trim(),'end');
    assert.ok(sample.sourceRows.some((row)=>row.number>=leaf.start&&row.number<=leaf.end));assert.ok(Array.from({length:leaf.end-leaf.start+1},(_,i)=>leaf.start+i).some((n)=>!sample.sourceRows.some((row)=>row.number===n)),'The retained leaf must actually be partial before context expansion');
  }
  return{headSha:sample.headSha,url:response.url,sha256:response.sha256,bytes:response.bytes,lineCount:lines.length,retainedHead:GITLAB_WHOLE_TEST.retainedHead,matchingCompleteBody:true};
}

export function assertWholeTestMounted(sample, response, target=GITLAB_WHOLE_TEST.target) {
  assert.equal(sample.sameOriginal,true);assert.equal(sample.unchangedViewed,true);assert.equal(sample.visible,true);
  assert.equal(new URL(sample.rawPath,'https://gitlab.com').href,response.url);assert.equal(new URL(response.url).pathname,`/gitlab-org/gitlab/-/raw/${sample.headSha}/${GITLAB_WHOLE_TEST.path}`);
  const fold=sample.folds.find((fold)=>fold.start===target.start);assert.ok(fold);assert.equal(fold.title,target.title);assert.equal(fold.expanded,'true');assert.doesNotMatch(fold.label,/Only displayed lines are available/);
  for(let n=target.start;n<=target.end;n++){const row=sample.sourceRows.find((row)=>row.number===n);assert.ok(row,`Missing original native R${n}`);assert.equal(row.text,response.lines[n-1]);assert.equal(row.hidden,false);}
  const clicks=sample.events.filter((event)=>event.kind==='context'&&event.type==='click');assert.ok(clicks.length>=1&&clicks.length<=4);assert.ok(clicks.every((event)=>event.nativeOwned===true));assert.equal(sample.events.some((event)=>event.kind==='viewed'),false);
}

export function assertSecondWholeTestMounted(sample,response,before) {
  assertWholeTestMounted(sample,response);assertWholeTestMounted(sample,response,GITLAB_WHOLE_TEST.second);
  assert.equal(sample.headSha,before.headSha);assert.equal(sample.rawPath,before.rawPath);
  assert.deepEqual(sample.events.slice(0,before.events.length),before.events,'Original context event history changed');
  const added=sample.events.slice(before.events.length).filter((event)=>event.kind==='context'&&event.type==='click');
  assert.ok(added.some((event)=>event.nativeOwned===true&&event.direction==='both'&&event.beforeNew===115&&event.afterNew===131),'Second test requires the original BOTH context gap115→131');
}

export async function scrollGitLabWholeTestControl(page,target) {
  const handle=await page.evaluateHandle(gitLabWholeTestProbe,'button',target);
  try{const button=handle.asElement();assert.ok(button,'Second qualified test control unavailable');await button.scrollIntoView();}finally{await handle.dispose();}
}

export async function verifyGitLabWholeTestContext(page,{progress,poll,capture,readSettings,writeSettings,readState,safeUrl,extensionId}) {
  progress.status='running';progress.scope='Explicit file intent, exact immutable rendered new source, then explicit original native context expansion; no default-on raw acquisition.';
  const original=structuredClone(await readSettings());assert.equal(original.testOutline,false);const enabled={...original,testOutline:true};let setup=false,prepared=false,failure;const requests=[],responses=[];const pending=new Set();
  const request=(value)=>{let url;try{url=new URL(value.url());}catch{return;}if(url.origin!=='https://gitlab.com')return;const frames=[];let stack=value.initiator?.()?.stack;for(let i=0;stack&&i<8;i++){frames.push(...(stack.callFrames??[]).map((f)=>f.url));stack=stack.parent;}requests.push({url:safeUrl(value.url()),method:value.method(),extensionInitiator:frames.some((frame)=>frame.startsWith(`chrome-extension://${extensionId}/`))});};
  const response=(value)=>{
    let url;try{url=new URL(value.url());}catch{return;}if(url.origin!=='https://gitlab.com'||!/^\/gitlab-org\/gitlab\/-\/raw\/(?:[0-9a-f]{40}|[0-9a-f]{64})\//.test(url.pathname)||!url.pathname.endsWith(`/${GITLAB_WHOLE_TEST.path}`))return;
    const work=(async()=>{const length=value.headers()['content-length'];assert.ok(!length||Number(length)<=512*1024,'Whole-file response exceeds discovery read bound');const body=await value.buffer();assert.ok(body.length<=512*1024);responses.push({url:value.url(),status:value.status(),redirected:value.request().redirectChain().length>0,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),lines:new TextDecoder('utf-8',{fatal:true}).decode(body).split(/\r?\n/)});})().catch((error)=>{responses.push({url:value.url(),error:error.message});});pending.add(work);void work.finally(()=>pending.delete(work));
  };
  const read=()=>page.evaluate(gitLabWholeTestProbe);
  const click=async(target)=>{const handle=await page.evaluateHandle(gitLabWholeTestProbe,'button',target);try{const button=handle.asElement();assert.ok(button);await button.scrollIntoView();assert.equal(await page.evaluate(gitLabWholeTestProbe,'arm',button),true);await button.click();}finally{await handle.dispose();}const event=await page.evaluate(gitLabWholeTestProbe,'click-result');assert.equal(event?.trusted,true);return event;};
  const intact=(sample)=>sample?.sameOriginal&&sample.unchangedViewed;
  try{
    progress.beforeCounts=await readState();assertDisplayedOutlineCounts(progress.beforeCounts,progress.beforeCounts);progress.initial=await page.evaluate(gitLabWholeTestProbe,'setup');setup=progress.initial!==null;assert.ok(intact(progress.initial));assert.equal(progress.initial.folds.length,0);
    page.on('request',request);page.on('response',response);progress.openCategoryInput=await click('Tests');await poll(read,(s)=>intact(s)&&s.visible,'Native original test file visible for whole-context intent',8000);
    prepared=true;await writeSettings(structuredClone(enabled));assert.ok(isDeepStrictEqual(await readSettings(),enabled));
    progress.beforeIntent=await poll(read,(s)=>intact(s)&&s.folds.length===3,'Shown-source outline baseline before explicit whole-context intent',8000);
    assert.equal(requests.filter((r)=>r.extensionInitiator&&/\/-\/raw\//.test(r.url)).length,0,'No raw acquisition before real file intent');
    if(progress.beforeIntent.intent===null){progress.status='unavailable';progress.reason='Fresh acquired/native new-source authority or eligible original file-header/context control was unavailable. No raw source request was made.';}
    else {
    assert.equal(progress.beforeIntent.intent.status,'idle');assert.equal(progress.beforeIntent.intent.disabled,false);
    progress.findInput=await click('intent');progress.found=await poll(read,(s)=>intact(s)&&s.intent?.status==='ready','Exact immutable test boundaries acquired',20_000);await Promise.all([...pending]);
    assert.equal(responses.length,1,'One coalesced explicit whole-file response required');assert.ok(!responses[0].error,responses[0].error);const body=responses[0];progress.source=qualifyGitLabWholeResponse(progress.beforeIntent,body);
    progress.beforeUnfold=await read();for(const leaf of [GITLAB_WHOLE_TEST.target,GITLAB_WHOLE_TEST.second]){const fold=progress.beforeUnfold.folds.find((f)=>f.start===leaf.start);assert.ok(fold);assert.equal(fold.title,leaf.title);assert.equal(fold.expanded,'false');assert.match(fold.label,/Only displayed lines are available/);}
    assert.equal(progress.beforeUnfold.events.filter((e)=>e.kind==='context').length,0,'Finding boundaries must not click native context');
    progress.boundariesArtifacts=await capture(page,'gitlab-whole-boundaries',{fullPage:false});progress.unfoldInput=await click(GITLAB_WHOLE_TEST.target.start);
    progress.unfolded=await poll(read,(s)=>{try{assertWholeTestMounted(s,body);return true;}catch{return false;}},'All required original native test lines mounted after explicit Show',30_000);assertWholeTestMounted(progress.unfolded,body);
    progress.unfoldedArtifacts=await capture(page,'gitlab-whole-test-open',{fullPage:false});progress.afterCapture=await read();assertWholeTestMounted(progress.afterCapture,body);progress.afterCounts=await readState();assertDisplayedOutlineCounts(progress.beforeCounts,progress.afterCounts);
    progress.firstLeafStatus='passed';progress.secondLeafStatus='running';
    progress.firstOpenedCheckpoint=await page.evaluate(gitLabWholeTestProbe,'retain-first');assertWholeTestMounted(progress.firstOpenedCheckpoint,body);
    const secondReady=(sample)=>{
      assertWholeTestMounted(sample,body);const second=sample.folds.find((fold)=>fold.start===GITLAB_WHOLE_TEST.second.start);
      assert.equal(second?.title,GITLAB_WHOLE_TEST.second.title);assert.equal(second.expanded,'false');assert.match(second.label,/Only displayed lines are available/);
      assert.equal(sample.controls.filter((control)=>control.direction==='both'&&control.beforeNew===115&&control.afterNew===131).length,1);
    };
    await scrollGitLabWholeTestControl(page,GITLAB_WHOLE_TEST.second.start);
    progress.beforeSecondUnfold=await read();secondReady(progress.beforeSecondUnfold);
    progress.beforeSecondArtifacts=await capture(page,'gitlab-whole-second-before',{fullPage:false});progress.afterSecondBeforeCapture=await read();secondReady(progress.afterSecondBeforeCapture);assert.deepEqual(progress.afterSecondBeforeCapture.events,progress.beforeSecondUnfold.events);
    progress.secondUnfoldInput=await click(GITLAB_WHOLE_TEST.second.start);
    progress.secondUnfolded=await poll(read,(sample)=>{try{assertSecondWholeTestMounted(sample,body,progress.beforeSecondUnfold);return true;}catch{return false;}},'Both qualified original native tests mounted after second explicit Show',30_000);assertSecondWholeTestMounted(progress.secondUnfolded,body,progress.beforeSecondUnfold);
    progress.secondUnfoldedArtifacts=await capture(page,'gitlab-whole-second-open',{fullPage:false});progress.afterSecondCapture=await read();assertSecondWholeTestMounted(progress.afterSecondCapture,body,progress.beforeSecondUnfold);
    await Promise.all([...pending]);assert.equal(responses.length,1,'Second test must reuse the same exact whole-file response');assert.equal(requests.filter((request)=>/\/-\/raw\//.test(request.url)&&request.url.endsWith(`/${GITLAB_WHOLE_TEST.path}`)).length,1,'Second test must not request another raw file');
    progress.afterSecondCounts=await readState();assertDisplayedOutlineCounts(progress.beforeCounts,progress.afterSecondCounts);
    progress.secondLeafStatus='passed';
    progress.status='passed';
    }
  }catch(error){failure=error;progress.status='failed';progress.error=error.message;if(progress.secondLeafStatus==='running')progress.secondLeafStatus='failed';}
  finally{
    try{
      const current=await readSettings();if(prepared&&isDeepStrictEqual(current,enabled))await writeSettings(structuredClone(original));else assert.ok(isDeepStrictEqual(current,original),'Do not overwrite unrelated concurrent settings');assert.ok(isDeepStrictEqual(await readSettings(),original));progress.settingsRestored=true;
      if(setup){if(page.isClosed())throw Error('Native page closed before whole-context cleanup');progress.restored=await poll(read,(s)=>intact(s)&&s.folds.length===0&&s.intent===null&&s.sourceRows.every((r)=>!r.hidden),'Owned whole-context controls and folds restored',8000);if(!progress.restored.categories.some((c)=>/^Essential\b/.test(c.text)&&c.expanded==='true'))progress.closeCategoryInput=await click('Essential');progress.closed=await poll(read,(s)=>intact(s)&&!s.visible&&s.categories.some((c)=>/^Essential\b/.test(c.text)&&c.expanded==='true'),'Original Essential category restored after native expansion',8000);progress.restoredCounts=await readState();assertDisplayedOutlineCounts(progress.beforeCounts,progress.restoredCounts);}
    }catch(error){failure=error;progress.status='failed';progress.cleanupError=error.message;}
    finally{page.off('request',request);page.off('response',response);await Promise.all([...pending]);progress.requests=requests;progress.responses=responses.map(({lines,...metadata})=>metadata);progress.limitations=['At most the two qualified unchanged-context leaves96–100 and125–131 are tested; actual completion is recorded per stage. No old-side/deleted/fork acquisition or automatic raw loading.','Native context expansion is not reversed; all native source rows remain provider-owned. No Viewed/count/server state is written.','HTTP initiator stack absence does not prove native ownership; only observed requests and original controls are reported.'];if(setup&&!page.isClosed()){try{await page.evaluate(gitLabWholeTestProbe,'cleanup');}catch(error){failure=error;progress.status='failed';progress.cleanupError=error.message;}}}
  }
  if(progress.status==='unavailable'){try{assert.equal(responses.length,0,'Unavailable whole-source authority unexpectedly issued a raw response');assert.equal(requests.filter((r)=>/\/-\/raw\//.test(r.url)&&r.url.endsWith(`/${GITLAB_WHOLE_TEST.path}`)).length,0,'Unavailable authority unexpectedly issued a raw request');}catch(error){failure=error;progress.status='failed';progress.error=error.message;}}
  if(failure)throw failure;return progress;
}
