import assert from 'node:assert/strict';
import { test,beforeEach,afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { gitLabWholeTestProbe as probe, qualifyGitLabWholeResponse, assertWholeTestMounted, assertSecondWholeTestMounted, scrollGitLabWholeTestControl, verifyGitLabWholeTestContext, GITLAB_WHOLE_TEST as fixture } from './gitlab-whole-test-context.mjs';
const URL='https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123', H='a'.repeat(40);let window;const originalGlobals=new Map();
beforeEach(()=>{window=new Window({url:URL});for(const key of ['document','location','NodeFilter','Element','HTMLButtonElement','getComputedStyle']){originalGlobals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value:key==='getComputedStyle'?window.getComputedStyle.bind(window):window[key]});}});
afterEach(()=>{probe('cleanup');for(const[key,value]of originalGlobals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}window.happyDOM.abort();});
function nativeFixture(){
 document.body.innerHTML=`<button class="geld-provider-category-header" aria-expanded="true">Essential</button><button class="geld-provider-category-header" aria-expanded="false">Tests</button><article data-rapid-diffs><div data-diffs-list><diff-file><header data-testid="rd-diff-file-header"><div class="rd-diff-file-info"><button data-geld-ui data-geld-test-boundaries data-status="idle">Find test boundaries</button></div></header><input data-viewed-checkbox type="checkbox"><table><tbody><tr class="rd-hunk-lines-inline"><td class="rd-line-number" data-position="new"><a data-line-number="100" id="original" href="#original">100</a></td><td class="rd-line-content"><pre class="rd-line-text">    end\n</pre></td></tr><tr class="rd-hunk-header" data-hunk-header><td><button data-click="expandLines" data-expand-direction="up">Show</button></td></tr></tbody></table></diff-file></div></article>`;
 const root=document.querySelector('diff-file');root.querySelector('table').className='rd-text-view-root';root.setAttribute('data-file-data',JSON.stringify({new_path:fixture.path,diff_refs:{head_sha:H,base_sha:'b'.repeat(40),start_sha:'c'.repeat(40)},blob_raw_path:`/gitlab-org/gitlab/-/raw/${H}/${fixture.path}`}));root.getBoundingClientRect=()=>({height:100,width:500});return root;
}
test('retains original native identities, source side and unchecked Viewed without initializing GitLab hooks',()=>{const root=nativeFixture(),html=root.innerHTML;const before=probe('setup');assert.equal(before.sameOriginal,true);assert.equal(before.unchangedViewed,true);assert.equal(before.headSha,H);assert.equal(before.sourceRows[0].number,100);assert.equal(before.sourceRows[0].text,'    end');assert.equal(root.innerHTML,html);assert.deepEqual(before.events,[]);});
test('comparison checkpoint reads only original native selection and eligibility fields without altering the file',()=>{
 const root=nativeFixture(),app=root.closest('article'),data=JSON.parse(root.getAttribute('data-file-data'));data.diff_lines_path=`/gitlab-org/gitlab/-/blob/${H}/${fixture.path}/diff_lines`;root.setAttribute('data-file-data',JSON.stringify(data));
 app.setAttribute('data-app-data',JSON.stringify({project_path:'gitlab-org/gitlab',mr_path:'/gitlab-org/gitlab/-/merge_requests/266334',is_fork:'false',body:'PRIVATE_BODY_CANARY',versions:{source_versions:[{selected:true,id:1,head_sha:H,base_sha:'b'.repeat(40),body:'PRIVATE_BODY_CANARY'}],target_versions:[{selected:true,id:2,head_sha:H,start_sha:'c'.repeat(40),is_merge_head:true,body:'PRIVATE_BODY_CANARY'}]}}));
 root.querySelector('header').setAttribute('aria-label','Diff file controls');const toggle=document.createElement('button');toggle.setAttribute('aria-label','Hide file contents');root.querySelector('header').append(toggle);
 probe('setup');const before=root.outerHTML,value=probe('native-eligibility');assert.equal(value.nativeApps,1);assert.equal(value.originalFileInApp,true);assert.equal(value.headerHosts,1);assert.equal(value.contextControls,1);assert.equal(value.expanded,true);assert.equal(value.sourceVersions[0].id,1);assert.equal(value.targetVersions[0].id,2);assert.equal(value.file.head_sha,H);assert.ok(!JSON.stringify(value).includes('PRIVATE_BODY_CANARY'));assert.equal(root.outerHTML,before);assert.deepEqual(probe().events,[]);
 const note=document.createElement('section');note.className='note';app.before(note);note.append(app);const forged=probe('native-eligibility');assert.equal(forged.nativeApps,0);assert.equal(forged.originalFileInApp,false);assert.equal(forged.headerHosts,0);assert.equal(forged.contextControls,0);
});
for(const[name,change]of[
 ['same-text remount',()=>{const row=document.querySelector('tr');row.replaceWith(row.cloneNode(true));}],
 ['source text',()=>{document.querySelector('.rd-line-text').textContent='other';}],
 ['native id',()=>{document.getElementById('original').id='changed';}],
 ['native permalink',()=>{document.getElementById('original').href='#other';}],
 ['native style',()=>{document.querySelector('tr').style.display='none';}],
 ['text wrapping',()=>{const node=document.querySelector('.rd-line-text').firstChild,wrapper=document.createElement('span');node.before(wrapper);wrapper.append(node);}],
 ['file head',()=>{const root=document.querySelector('diff-file');const value=JSON.parse(root.getAttribute('data-file-data'));value.diff_refs.head_sha='d'.repeat(40);root.setAttribute('data-file-data',JSON.stringify(value));}],
 ['subject URL',()=>{location.href=URL+'#other';}],
])test(`original-source proof rejects ${name}`,()=>{nativeFixture();probe('setup');change();assert.equal(probe().sameOriginal,false);});
test('only the owned line-fold marker is exempt; Viewed changes are independently rejected',()=>{nativeFixture();probe('setup');document.querySelector('tr').setAttribute('data-geld-provider-line-hidden','');assert.equal(probe().sameOriginal,true);document.querySelector('input').checked=true;assert.equal(probe().unchangedViewed,false);});
test('observes original context clicks but does not invoke them; category input is tracked outside the file',()=>{nativeFixture();probe('setup');const category=probe('button','Tests');assert.equal(probe('arm',category),true);category.click();assert.equal(probe('click-result').trusted,false);assert.deepEqual(probe().events,[]);document.querySelector('[data-click]').click();assert.equal(probe().events.filter((e)=>e.kind==='context').length,1);});
function sourceProof(){const lines=Array(165).fill('');lines[95]="    it 'generates an error' do";lines[99]='    end';lines[124]="      it 'moves and repositions issue' do";lines[130]='      end';return{sample:{headSha:H,rawPath:`/gitlab-org/gitlab/-/raw/${H}/${fixture.path}`,sourceRows:[{number:100,text:lines[99]},{number:131,text:lines[130]}]},response:{url:`https://gitlab.com/gitlab-org/gitlab/-/raw/${H}/${fixture.path}`,status:200,redirected:false,bytes:6616,sha256:fixture.bodySha256,lines}};}
test('qualifies a fresh exact full native head only against complete response digest and genuinely missing leaves',()=>{const{sample,response}=sourceProof();assert.equal(qualifyGitLabWholeResponse(sample,response).headSha,H);});
for(const[name,change]of[
 ['short head',(s)=>{s.headSha=H.slice(0,7);}],['different response head',(s,r)=>{r.url=r.url.replace(H,'b'.repeat(40));}],['redirect',(s,r)=>{r.redirected=true;}],['HTTP failure',(s,r)=>{r.status=404;}],['body digest mismatch',(s,r)=>{r.sha256='f'.repeat(64);}],['oversized body',(s,r)=>{r.bytes=512*1024+1;}],['shown text mismatch',(s)=>{s.sourceRows[0].text='other';}],['invented title',(s,r)=>{r.lines[95]="it 'invented' do";}],['already complete leaf',(s,r)=>{for(let n=96;n<100;n++)s.sourceRows.push({number:n,text:r.lines[n-1]});}],
])test(`whole-file qualification rejects ${name}`,()=>{const{sample,response}=sourceProof();change(sample,response);assert.throws(()=>qualifyGitLabWholeResponse(sample,response));});
function mounted(){const{sample,response}=sourceProof();return{sample:{headSha:sample.headSha,rawPath:sample.rawPath,visible:true,sameOriginal:true,unchangedViewed:true,folds:[{start:96,title:fixture.target.title,expanded:'true',label:'Hide generates an error, from line 96'}],sourceRows:Array.from({length:5},(_,i)=>({number:i+96,text:response.lines[i+95],hidden:false})),events:[{kind:'context',type:'click',trusted:false,nativeOwned:true,direction:'up',beforeNew:null,afterNew:100}]},response};}
test('full-test acceptance requires all actual native rows, visible text agreement and an original context activation',()=>{const{sample,response}=mounted();assertWholeTestMounted(sample,response);});
for(const[name,change]of[
 ['missing row',(s)=>s.sourceRows.pop()],['hidden row',(s)=>{s.sourceRows[0].hidden=true;}],['wrong text',(s)=>{s.sourceRows[0].text='other';}],['shown-scope label',(s)=>{s.folds[0].label+=' Only displayed lines are available';}],['native mutation',(s)=>{s.sameOriginal=false;}],['Viewed mutation',(s)=>{s.unchangedViewed=false;}],['no context activation',(s)=>{s.events=[];}],['excess native expansion',(s)=>{s.events=Array(5).fill({kind:'context',type:'click'});}],
])test(`full native mounted acceptance rejects ${name}`,()=>{const{sample,response}=mounted();change(sample);assert.throws(()=>assertWholeTestMounted(sample,response));});

function bothMounted(){
 const{sample:before,response}=mounted();const sample=structuredClone(before);
 sample.folds.push({start:125,title:fixture.second.title,expanded:'true',label:'Hide moves and repositions issue, from line 125'});
 for(let n=125;n<=131;n++)sample.sourceRows.push({number:n,text:response.lines[n-1],hidden:false});
 sample.events.push({kind:'context',type:'click',trusted:false,nativeOwned:true,direction:'both',beforeNew:115,afterNew:131});
 return{sample,response,before};
}
test('second native BOTH acceptance preserves the first open test and consumes a new owned gap115→131 step',()=>{const f=bothMounted();assertSecondWholeTestMounted(f.sample,f.response,f.before);});
for(const[name,change]of[
 ['first test recollapsed',(s)=>{s.folds[0].expanded='false';}],
 ['first test rehidden',(s)=>{s.sourceRows[0].hidden=true;}],
 ['missing second declaration',(s)=>{s.sourceRows=s.sourceRows.filter((r)=>r.number!==125);}],
 ['second closing row hidden',(s)=>{s.sourceRows.find((r)=>r.number===131).hidden=true;}],
 ['source full head changed',(s)=>{s.headSha='b'.repeat(40);}],
 ['no second native step',(s)=>{s.events.pop();}],
 ['non-original context',(s)=>{s.events[1].nativeOwned=false;}],
 ['wrong gap edge',(s)=>{s.events[1].beforeNew=114;}],
 ['wrong gap direction',(s)=>{s.events[1].direction='up';}],
 ['previous event overwritten',(s)=>{s.events[0].direction='down';}],
 ['fifth cumulative native step',(s)=>{s.events.push(s.events[1],s.events[1],s.events[1]);}],
 ['original file replaced',(s)=>{s.sameOriginal=false;}],
 ['Viewed changed',(s)=>{s.unchangedViewed=false;}],
])test(`second native acceptance rejects ${name}`,()=>{const f=bothMounted();change(f.sample);assert.throws(()=>assertSecondWholeTestMounted(f.sample,f.response,f.before));});
test('four cumulative native steps are the whole-phase cap, not four more steps for the second test',()=>{const f=bothMounted();f.sample.events.push(f.sample.events[1],f.sample.events[1]);assertSecondWholeTestMounted(f.sample,f.response,f.before);f.sample.events.push(f.sample.events[1]);assert.throws(()=>assertSecondWholeTestMounted(f.sample,f.response,f.before));});

test('native context observation records actual gap ownership and excludes authored lookalikes',()=>{
 const root=nativeFixture(),body=root.querySelector('tbody'),line=root.querySelector('tr');body.insertBefore(body.lastElementChild,line);
 const nativeRow=(n)=>{const row=line.cloneNode(true);row.querySelector('a').setAttribute('data-line-number',String(n));row.querySelector('a').removeAttribute('id');return row;};
 body.append(nativeRow(115));const header=document.createElement('tr');header.className='rd-hunk-header';header.setAttribute('data-hunk-header','');header.innerHTML='<td><button data-click="expandLines" data-expand-direction="both">Show hidden lines</button></td>';body.append(header,nativeRow(131));
 probe('setup');const read=probe();assert.deepEqual(read.controls.map(({direction,beforeNew,afterNew})=>({direction,beforeNew,afterNew})),[{direction:'up',beforeNew:null,afterNew:100},{direction:'both',beforeNew:115,afterNew:131}]);
 header.querySelector('button').click();assert.equal(probe().events.at(-1).nativeOwned,true);assert.equal(probe().events.at(-1).beforeNew,115);
 const note=document.createElement('section');note.className='note';note.innerHTML='<table class="rd-text-view-root"><tr class="rd-hunk-header" data-hunk-header><td><button data-click="expandLines" data-expand-direction="both">Authored lookalike</button></td></tr></table>';root.append(note);
 note.querySelector('button').click();assert.equal(probe().events.at(-1).nativeOwned,false);assert.equal(probe().controls.length,2);
});

test('the second-test checkpoint protects native rows inserted during the first unfold from same-text replacement',()=>{
 const root=nativeFixture();probe('setup');const original=root.querySelector('tr'),inserted=original.cloneNode(true);inserted.querySelector('a').removeAttribute('id');inserted.querySelector('a').setAttribute('data-line-number','96');original.before(inserted);
 assert.equal(probe().sameOriginal,true);assert.equal(probe('retain-first').sameOriginal,true);
 inserted.replaceWith(inserted.cloneNode(true));assert.equal(probe().sameOriginal,false);
});

test('pre-capture scrolling handles an offscreen second target without activating it',async()=>{
 const calls=[];let offscreen=true;const button={scrollIntoView:async()=>{calls.push('scroll');offscreen=false;},click:async()=>{throw Error('Scrolling must not click');}};
 const page={evaluateHandle:async(fn,action,target)=>{assert.equal(fn,probe);assert.equal(action,'button');assert.equal(target,125);calls.push('resolve');return{asElement:()=>button,dispose:async()=>calls.push('dispose')};}};
 await scrollGitLabWholeTestControl(page,125);assert.equal(offscreen,false);assert.deepEqual(calls,['resolve','scroll','dispose']);
});
test('a missing current second target cannot be replaced with a fabricated control, and its handle is disposed',async()=>{
 let disposed=false;const page={evaluateHandle:async()=>({asElement:()=>null,dispose:async()=>{disposed=true;}})};
 await assert.rejects(scrollGitLabWholeTestControl(page,125),/unavailable/);assert.equal(disposed,true);
});
function counts(){return{runtime:{hasDiff:true,onDiffPage:true,repository:{provider:'gitlab',origin:'https://gitlab.com',path:'gitlab-org/gitlab'},all:{files:3,additions:36,deletions:0},visible:{files:2,additions:4,deletions:0},hiddenCount:1,categories:[{id:'tests',paths:[fixture.path]}]},native:{headers:[{files:2,additions:4,deletions:0}]}};}
function unavailableRunner({restoreFailure=false,untrusted=false,sourceLostOnRestore=false}={}){
 const original={enabled:true,testOutline:false,future:{retained:true}},progress={},listeners=new Map();let settings=structuredClone(original),tests=false,prepared=false;
 const read=()=>({sameOriginal:!(prepared&&!settings.testOutline&&sourceLostOnRestore),unchangedViewed:true,visible:tests,folds:settings.testOutline?Array(3).fill({}):[],intent:null,sourceRows:[{hidden:false}],categories:[{text:'Essential',expanded:String(!tests)},{text:'Tests',expanded:String(tests)}]});
 const page={isClosed:()=>false,on:(name,fn)=>listeners.set(name,fn),off:(name)=>listeners.delete(name),evaluate:async(fn,action)=>action==='cleanup'?null:action==='arm'?true:action==='click-result'?{trusted:!untrusted}:read(),evaluateHandle:async(fn,action,target)=>({asElement:()=>({scrollIntoView:async()=>{},click:async()=>{if(!untrusted)tests=target==='Tests';}}),dispose:async()=>{}})};
 const deps={progress,poll:async(fn,accept)=>{const value=await fn();assert.ok(accept(value));return value;},capture:async()=>({}),readSettings:async()=>structuredClone(settings),writeSettings:async(value)=>{if(!value.testOutline&&restoreFailure)throw Error('Restoration rejected');if(value.testOutline)prepared=true;settings=structuredClone(value);},readState:async()=>counts(),safeUrl:(url)=>url,extensionId:'synthetic'};
 return{progress,original,current:()=>settings,listeners,run:()=>verifyGitLabWholeTestContext(page,deps)};
}
test('unknown source authority remains unavailable, restores exact settings/category and never gains a feature pass',async()=>{const r=unavailableRunner();await r.run();assert.equal(r.progress.status,'unavailable');assert.equal(r.progress.settingsRestored,true);assert.deepEqual(r.current(),r.original);assert.equal(r.listeners.size,0);assert.equal(r.progress.closed.visible,false);assert.deepEqual(r.progress.requests,[]);});
test('an unavailable source cannot mask failed cleanup through an early return',async()=>{const r=unavailableRunner({restoreFailure:true});await assert.rejects(r.run(),/Restoration rejected/);assert.equal(r.progress.status,'failed');assert.match(r.progress.cleanupError,/Restoration rejected/);assert.equal(r.listeners.size,0);});
test('untrusted category input cannot earn a whole-context phase and still restores settings',async()=>{const r=unavailableRunner({untrusted:true});await assert.rejects(r.run());assert.equal(r.progress.status,'failed');assert.deepEqual(r.current(),r.original);assert.equal(r.listeners.size,0);});
test('restored preferences cannot mask lost original-source proof during cleanup',async()=>{const r=unavailableRunner({sourceLostOnRestore:true});await assert.rejects(r.run());assert.equal(r.progress.status,'failed');assert.equal(r.progress.settingsRestored,true);assert.ok(r.progress.cleanupError);assert.deepEqual(r.current(),r.original);assert.equal(r.listeners.size,0);});
