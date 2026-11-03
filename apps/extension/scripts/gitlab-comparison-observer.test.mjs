import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { GITLAB_COMPARISON_LIMITS as limits, observeGitLabComparisons, projectGitLabComparison, projectGitLabNativeEligibility } from './gitlab-comparison-observer.mjs';

const ROOT='https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334', SPEC='spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
const H='d03aadd2c95a94ecbe229896b29c9dcda009a916', B='311fea1fc538c493e1f1fc92232024455d7c4388', S='6794d2ce9d2787c30f2d685a2a1bcf13dd0bbfe8', M='8a882c3325b0e851b859d78ad11486aa3a24112c';
const CANARY='NEVER_PERSIST_BODY_COOKIE_POSTDATA_ERROR_CANARY';
function versions(head=H){return{source_versions:[{selected:true,id:2158520123,head_sha:H,base_sha:B,start_sha:S,notes:CANARY}],target_versions:[{selected:true,id:head===H?2158520123:2159449928,head_sha:head,start_sha:S,is_merge_head:head!==H,body:CANARY}],other:{secret:CANARY}};}
function metadata(){return{project_path:'gitlab-org/gitlab',merge_request_diff:{version_path:`${ROOT}/diffs?diff_id=2158520123`,body:CANARY},size:'1',real_size:'1',render_overflow_warning:false,diff_files:[{new_path:SPEC,old_path:SPEC,deleted_file:false,submodule:false,diff:CANARY,note_html:CANARY}],comments:[CANARY]};}
function native(){return{projectPath:'gitlab-org/gitlab',mrPath:'/gitlab-org/gitlab/-/merge_requests/266334',isFork:'false',sourceVersions:versions().source_versions,targetVersions:versions().target_versions,file:{new_path:SPEC,head_sha:H,base_sha:B,start_sha:S,blob_raw_path:`/gitlab-org/gitlab/-/raw/${H}/${SPEC}`,diff_lines_path:`/gitlab-org/gitlab/-/blob/${H}/${SPEC}/diff_lines`,body:CANARY},nativeApps:1,originalFileInApp:true,headerHosts:1,contextControls:3,expanded:true,visible:true,nativeSearchNonempty:false,body:CANARY};}
function request(kind='versions',options={}){
 const url=options.url??`${ROOT}/${kind==='metadata'?'diffs_metadata.json':'versions'}?diff_id=2158520123`;
 return{url:()=>url,method:()=>options.method??'GET',initiator:()=>options.initiator??{stack:{callFrames:[{url:'chrome-extension://installed/content-scripts/gitlab.js?private='+CANARY}]}},postData:()=>{throw Error(CANARY);}};
}
function response(req,value,options={}){
 const bytes=options.bytes??Buffer.from(JSON.stringify(value));let reads=0;
 return{url:()=>options.url??req.url(),request:()=>req,status:()=>options.status??200,headers:()=>options.headers??{'content-type':'application/json','content-length':String(bytes.byteLength),'set-cookie':CANARY,authorization:CANARY},fromCache:()=>options.cached??false,fromServiceWorker:()=>false,buffer:async()=>{reads++;if(options.read)return options.read();return bytes;},reads:()=>reads};
}
function fixture(options={}){const page=new EventEmitter(),item={};const observer=observeGitLabComparisons(page,item,{extensionId:'installed',settleMs:30,...options});return{page,item,observer,evidence:item.gitLabComparisonObservations};}
function emit(f,req,res,withRequest=true){if(withRequest)f.page.emit('request',req);f.page.emit('response',res);}

test('listeners attached before navigation retain all already-issued duplicate responses and correlate request identity',async()=>{
 const f=fixture();const a=request(),b=request();
 f.page.goto=async()=>{emit(f,a,response(a,versions()));emit(f,b,response(b,versions(M)));f.page.emit('response',response(a,versions()));};
 await f.page.goto();const checkpoint=await f.observer.checkpoint('beforeIntent',native());await f.observer.dispose();
 assert.equal(f.evidence.requests.length,2);assert.equal(f.evidence.responses.length,3);assert.equal(new Set(f.evidence.responses.map((r)=>r.id)).size,3);
 assert.equal(f.evidence.responses[0].requestId,f.evidence.responses[2].requestId);assert.notEqual(f.evidence.responses[0].requestId,f.evidence.responses[1].requestId);
 assert.deepEqual(checkpoint.comparisons.map((r)=>r.state),['compatible_candidate','contradiction_observed','compatible_candidate']);
 assert.ok(checkpoint.comparisons.every((r)=>r.consumedByProduct==='not_observed'));assert.equal(f.evidence.cleanup.listenersRemoved,true);
});
test('response without a request event has unknown request time rather than a synthesized dispatch observation',async()=>{
 const f=fixture(),q=request();emit(f,q,response(q,versions()),false);await f.observer.dispose();assert.equal(f.evidence.requests[0].requestedAt,null);assert.equal(f.evidence.requests[0].requestEventObserved,false);assert.equal(f.evidence.responses[0].requestEventObserved,false);
});
test('body projections, native fields, URL queries and error messages cannot leak canary content',async()=>{
 const f=fixture(),q=request('metadata');emit(f,q,response(q,metadata()));await f.observer.checkpoint('beforeIntent',native());await f.observer.dispose();
 const serialized=JSON.stringify(f.evidence);assert.ok(!serialized.includes(CANARY));assert.ok(!serialized.includes('set-cookie'));assert.equal(f.evidence.responses[0].projection.projectPath,'gitlab-org/gitlab');assert.equal(f.evidence.responses[0].projection.inventory.specPresent,true);assert.equal(f.evidence.requests[0].frameSources[0],'chrome-extension://installed/content-scripts/gitlab.js');assert.match(f.evidence.responses[0].bodySha256,/^[a-f0-9]{64}$/);
});
for(const[mode,initiator,expected]of[
 ['absent',{},'unattributed'],['native',{stack:{callFrames:[{url:'https://gitlab.com/assets/app.js?secret='+CANARY}]}},'first_party_frame_observed'],['both',{stack:{callFrames:[{url:'https://gitlab.com/assets/app.js'},{url:'chrome-extension://installed/content-scripts/gitlab.js'}]}},'extension_frame_observed'],
])test(`attribution preserves positive facts without making absence native-only: ${mode}`,async()=>{
 const f=fixture(),q=request('versions',{initiator});emit(f,q,response(q,versions()));await f.observer.dispose();assert.equal(f.evidence.requests[0].attribution,expected);assert.equal(f.evidence.requests[0].firstPartyFrameObserved,mode!=='absent');assert.equal(f.evidence.requests[0].extensionFrameObserved,mode==='both');assert.ok(!JSON.stringify(f.evidence).includes(CANARY));
});
test('unsafe selection values are redacted and never cause a body read',async()=>{
 const f=fixture(),q=request('versions',{url:`${ROOT}/versions?diff_id=2158520123&token=${CANARY}`}),r=response(q,versions());emit(f,q,r);await f.observer.dispose();assert.equal(r.reads(),0);assert.equal(f.evidence.responses[0].code,'SELECTION_REDACTED');assert.equal(f.evidence.requests[0].url,`${ROOT}/versions`);assert.ok(!JSON.stringify(f.evidence).includes(CANARY));
});
for(const[url,method]of[[ROOT.replace('266334','266335')+'/versions','GET'],['https://evil.example/versions','GET'],[ROOT+'/versions','POST'],[ROOT+'/discussions.json','GET']])test(`ignores other endpoint/method ${method} ${url}`,async()=>{
 const f=fixture(),q=request('versions',{url,method}),r=response(q,versions());emit(f,q,r);await f.observer.dispose();assert.equal(r.reads(),0);assert.deepEqual(f.evidence.requests,[]);assert.deepEqual(f.evidence.responses,[]);
});
test('all body reads are serialized even when responses arrive together or complete out of order',async()=>{
 const f=fixture();let release;const pending=new Promise((resolve)=>{release=resolve;});const a=request(),b=request('metadata'),ra=response(a,versions(),{read:()=>pending}),rb=response(b,metadata());emit(f,a,ra);emit(f,b,rb);assert.equal(ra.reads(),1);assert.equal(rb.reads(),0);release(Buffer.from(JSON.stringify(versions())));await f.observer.dispose();assert.equal(rb.reads(),1);assert.equal(f.evidence.responses[0].status,'projected');assert.equal(f.evidence.responses[1].status,'projected');
});
for(const[name,options,code,reads]of[
 ['declared oversize',{headers:{'content-type':'application/json','content-length':String(limits.bodyBytes+1)}},'DECLARED_BODY_BOUND',0],
 ['bad declared length',{headers:{'content-type':'application/json','content-length':CANARY}},'DECLARED_BODY_BOUND',0],
 ['HTML',{headers:{'content-type':'text/html; '+CANARY}},'JSON_MIME_REQUIRED',0],
 ['HTTP401',{status:401},'HTTP_STATUS',0],
 ['decoded oversize',{bytes:Buffer.alloc(limits.bodyBytes+1),headers:{'content-type':'application/json'}},'DECODED_BODY_BOUND',1],
 ['invalid JSON',{bytes:Buffer.from(CANARY)},'INVALID_JSON',1],
 ['read failure',{read:async()=>{throw Error(CANARY);}},'BODY_UNAVAILABLE',1],
])test(`fixed codes and safe bounds reject ${name}`,async()=>{const f=fixture(),q=request(),r=response(q,versions(),options);emit(f,q,r);await f.observer.dispose();assert.equal(r.reads(),reads);assert.equal(f.evidence.responses[0].code,code);assert.ok(!JSON.stringify(f.evidence).includes(CANARY));});
test('four-MiB parsing budget prevents a fifth body read rather than just truncating retained JSON',async()=>{
 const f=fixture(),rows=[];for(let n=0;n<5;n++){const q=request(),r=response(q,null,{bytes:Buffer.alloc(limits.bodyBytes,32),headers:{'content-type':'application/json'}});rows.push(r);emit(f,q,r);}await f.observer.dispose();assert.equal(f.evidence.decodedBytesParsed,limits.totalBytes);assert.deepEqual(rows.map((r)=>r.reads()),[1,1,1,1,0]);assert.equal(f.evidence.responses[4].code,'TOTAL_BODY_BOUND');
});
test('observation overflow is explicit incomplete evidence and never silently chooses a first or last response',async()=>{
 const f=fixture();for(let n=0;n<65;n++){const q=request();emit(f,q,response(q,versions()));}await f.observer.dispose();assert.equal(f.evidence.requests.length,64);assert.equal(f.evidence.responses.length,64);assert.ok(f.evidence.overflow.requests>0);assert.equal(f.evidence.overflow.responses,1);assert.equal(f.evidence.status,'incomplete');
});
test('duplicate or truncated native/HTTP selections remain unknown rather than selecting one candidate',async()=>{
 const f=fixture(),q=request(),v=versions();v.target_versions.push({...v.target_versions[0],id:999});emit(f,q,response(q,v));const checkpoint=await f.observer.checkpoint('beforeIntent',native());assert.equal(checkpoint.comparisons[0].state,'unknown');assert.ok(checkpoint.comparisons[0].unknown.includes('target'));await f.observer.dispose();
 const huge=versions();huge.source_versions=Array(1025).fill({selected:false});assert.equal(projectGitLabComparison('versions',huge).source.selectedCount,null);
});
test('missing project provenance and absent spec inventory remain visible diagnostic facts without binding claims',async()=>{
 const f=fixture(),q=request('metadata'),v=metadata();delete v.project_path;v.diff_files=[];emit(f,q,response(q,v));const checkpoint=await f.observer.checkpoint('beforeIntent',native());const projected=f.evidence.responses[0].projection;assert.equal(projected.projectPathState,'missing');assert.equal(projected.inventory.specPresent,false);assert.deepEqual(checkpoint.comparisons[0].differences,['specPresent']);assert.ok(checkpoint.comparisons[0].unknown.includes('projectPath'));await f.observer.dispose();
});
test('path projection is bounded and cannot assert absent spec beyond its inspected inventory',()=>{
 const value=metadata();value.diff_files=Array(6001).fill({new_path:'app/file.rb'});value.diff_files[6000]={new_path:SPEC};const projected=projectGitLabComparison('metadata',value);assert.equal(projected.inventory.state,'truncated');assert.equal(projected.inventory.specPresent,null);assert.equal(projected.inventory.paths.length,128);
});
test('native eligibility drops unrecognized content and reports malformed resource refs as unknown',()=>{
 const value=native();value.file.blob_raw_path+='?token='+CANARY;value.projectPath=undefined;const result=projectGitLabNativeEligibility(value);assert.equal(result.file.rawUrl,null);assert.equal(result.projectPathState,'invalid');assert.ok(!JSON.stringify(result).includes(CANARY));assert.equal(result.eligibility.headerHosts,1);
});
test('bounded cleanup removes listeners, records timeouts and prevents late evidence writes',async()=>{
 const f=fixture({settleMs:5});let release;const q=request(),r=response(q,versions(),{read:()=>new Promise((resolve)=>{release=resolve;})});emit(f,q,r);await f.observer.dispose();assert.equal(f.page.listenerCount('response'),0);assert.equal(f.page.listenerCount('request'),0);assert.equal(f.evidence.responses[0].code,'SETTLE_TIMEOUT');const saved=JSON.stringify(f.evidence);release(Buffer.from(JSON.stringify(versions(M))));await new Promise((resolve)=>setImmediate(resolve));assert.equal(JSON.stringify(f.evidence),saved);assert.equal(await f.observer.dispose(),f.evidence);
});
test('checkpoint records which responses existed at its time without importing later responses or mutations',async()=>{
 const f=fixture(),q=request();emit(f,q,response(q,versions()));const checkpoint=await f.observer.checkpoint('beforeIntent',native());const old=JSON.stringify(checkpoint);const later=request('metadata');emit(f,later,response(later,metadata()));await f.observer.dispose();assert.equal(checkpoint.responseIdsAtObservation.length,1);assert.equal(f.evidence.responses.length,2);assert.equal(JSON.stringify(checkpoint),old);
});
test('an unanswered matching request is incomplete evidence rather than proof of a cache hit or no acquisition',async()=>{
 const f=fixture();f.page.emit('request',request());await f.observer.dispose();assert.equal(f.evidence.unansweredRequests,1);assert.equal(f.evidence.status,'incomplete');assert.deepEqual(f.evidence.responses,[]);
});
test('invalid native app data cannot become an observed selected comparison',()=>{assert.deepEqual(projectGitLabNativeEligibility({state:'invalid_native_app',body:CANARY}),{state:'unavailable'});});
