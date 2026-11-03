import { createHash } from 'node:crypto';

export const GITLAB_COMPARISON_LIMITS = Object.freeze({ observations:64, bodyBytes:1024*1024, totalBytes:4*1024*1024, paths:128, files:6000, versions:1024, selected:8 });
const ORIGIN='https://gitlab.com', MR='/gitlab-org/gitlab/-/merge_requests/266334', SPEC='spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
const SHA=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const record=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=(value)=>createHash('sha256').update(value).digest('hex');
const ref=(value)=>typeof value==='string'&&SHA.test(value)?value.toLowerCase():null;
const id=(value)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[1-9]\d{0,31}$/.test(value)?value:null;
const path=(value)=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\\\u0000-\u001f\u007f]/.test(value)&&value.split('/').every((part)=>part!==''&&part!=='.'&&part!=='..')?value:null;
const project=(value)=>path(value)!==null&&value.length<=512&&value.includes('/')?value:null;
const fieldState=(source,key,value)=>!Object.hasOwn(source,key)?'missing':value===null?'invalid':'valid';
const stamp=()=>new Date().toISOString();

function selection(url) {
  const values={};
  for(const[key,value]of url.searchParams){
    const valid=key==='diff_id'?/^\d{1,32}$/.test(value):['start_sha','commit_id'].includes(key)?SHA.test(value):key==='w'?/^[01]$/.test(value):key==='only_context_commits'?/^(?:true|1)$/.test(value):false;
    if(!valid||Object.hasOwn(values,key))return null;values[key]=value;
  }
  return values;
}
function route(value) {
  try{
    if(typeof value!=='string'||value.length>8192)return null;
    const url=new URL(value);if(url.origin!==ORIGIN)return null;
    const kind=url.pathname===`${MR}/diffs_metadata.json`?'metadata':url.pathname===`${MR}/versions`?'versions':null;
    if(kind===null)return null;
    const chosen=url.username||url.password||url.hash?null:selection(url);
    return{kind,url:chosen===null?ORIGIN+url.pathname:url.href,selection:chosen,selectionRedacted:chosen===null};
  }catch{return null;}
}
function versionPath(value) {
  try{if(typeof value!=='string'||value.length>8192)return null;const url=new URL(value,ORIGIN);const chosen=selection(url);return url.origin===ORIGIN&&url.pathname===`${MR}/diffs`&&!url.username&&!url.password&&!url.hash&&chosen!==null?{url:url.href,selection:chosen}:null;}catch{return null;}
}
function version(value,target) {
  if(!record(value))return null;
  const result={id:id(value.id),headSha:ref(value.head_sha),startSha:ref(value.start_sha)};
  if(target)result.mergeHead=typeof value.is_merge_head==='boolean'?value.is_merge_head:null;
  else result.baseSha=ref(value.base_sha);
  return result;
}
function selected(values,target) {
  if(!Array.isArray(values))return{state:'missing_or_invalid',selectedCount:null,values:[]};
  const inspected=values.slice(0,GITLAB_COMPARISON_LIMITS.versions).filter((value)=>record(value)&&value.selected===true);
  return{state:values.length>GITLAB_COMPARISON_LIMITS.versions||inspected.length>GITLAB_COMPARISON_LIMITS.selected?'truncated':'observed',selectedCount:values.length>GITLAB_COMPARISON_LIMITS.versions?null:inspected.length,values:inspected.slice(0,GITLAB_COMPARISON_LIMITS.selected).map((value)=>version(value,target))};
}

export function projectGitLabComparison(kind,value) {
  if(!record(value))return null;
  if(kind==='versions')return{source:selected(value.source_versions,false),target:selected(value.target_versions,true)};
  if(kind!=='metadata')return null;
  const projectPath=project(value.project_path),selectedVersion=record(value.merge_request_diff)?value.merge_request_diff:{},sourcePath=versionPath(selectedVersion.version_path);
  const inventory=Array.isArray(value.diff_files)?value.diff_files:null;
  const scanComplete=inventory!==null&&inventory.length<=GITLAB_COMPARISON_LIMITS.files;
  const paths=inventory===null?[]:inventory.slice(0,GITLAB_COMPARISON_LIMITS.files).flatMap((file)=>record(file)&&path(file.new_path)!==null?[{newPath:path(file.new_path),oldPath:path(file.old_path),deleted:file.deleted_file===true,submodule:file.submodule===true}]:[]);
  const count=(value)=>Number.isSafeInteger(value)&&value>=0?value:typeof value==='string'&&/^\d{1,9}$/.test(value)?value:null;
  return{projectPath,projectPathState:fieldState(value,'project_path',projectPath),diffId:id(sourcePath?.selection.diff_id),versionPathState:fieldState(selectedVersion,'version_path',sourcePath),
    inventory:{state:inventory===null?'missing_or_invalid':!scanComplete||paths.length>GITLAB_COMPARISON_LIMITS.paths?'truncated':'observed',total:inventory?.length??null,scanComplete,validPaths:paths.length,uniqueNewPaths:new Set(paths.map((file)=>file.newPath)).size,specPresent:paths.some((file)=>file.newPath===SPEC&&!file.deleted&&!file.submodule)?true:scanComplete?false:null,paths:paths.slice(0,GITLAB_COMPARISON_LIMITS.paths),pathsSha256:digest(JSON.stringify(paths)),size:count(value.size),realSize:count(value.real_size),overflow:typeof value.render_overflow_warning==='boolean'?value.render_overflow_warning:null}};
}

function attribution(request,extensionId) {
  const sources=[];let extensionFrameObserved=false,firstPartyFrameObserved=false,stack;
  try{stack=request.initiator?.()?.stack;}catch{return{attribution:'unattributed',extensionFrameObserved:false,firstPartyFrameObserved:false,frameSources:[],code:'INITIATOR_UNAVAILABLE'};}
  for(let depth=0;stack&&depth<8;depth++,stack=stack.parent)for(const frame of (Array.isArray(stack.callFrames)?stack.callFrames:[]).slice(0,20)){
    try{const url=new URL(frame.url);if(url.username||url.password)continue;const extension=url.protocol==='chrome-extension:'&&url.host===extensionId;const firstParty=url.origin===ORIGIN&&url.pathname.startsWith('/assets/');extensionFrameObserved ||= extension;firstPartyFrameObserved ||= firstParty;if((extension||firstParty)&&url.pathname.length<=512&&sources.length<12)sources.push(`${url.protocol}//${url.host}${url.pathname}`);}catch{/* Invalid frame URLs contribute no attribution. */}
  }
  return{attribution:extensionFrameObserved?'extension_frame_observed':firstPartyFrameObserved?'first_party_frame_observed':'unattributed',extensionFrameObserved,firstPartyFrameObserved,frameSources:[...new Set(sources)]};
}
function nativeResource(value,head,newPath,raw) {
  try{if(typeof value!=='string'||value.length>8192||head===null||newPath===null)return null;const url=new URL(value,ORIGIN),encoded=newPath.split('/').map(encodeURIComponent).join('/');return url.origin===ORIGIN&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname===`/gitlab-org/gitlab/-/${raw?'raw':'blob'}/${head}/${encoded}${raw?'':'/diff_lines'}`?url.href:null;}catch{return null;}
}
export function projectGitLabNativeEligibility(value) {
  if(!record(value)||value.state==='invalid_native_app')return{state:'unavailable'};
  const source=selected(value.sourceVersions,false),target=selected(value.targetVersions,true),file=record(value.file)?value.file:{},head=ref(file.head_sha),newPath=path(file.new_path);
  const number=(v)=>Number.isSafeInteger(v)&&v>=0&&v<=10000?v:null;
  const bool=(v)=>typeof v==='boolean'?v:null;
  const projectPath=project(value.projectPath);
  return{state:'observed',projectPath,projectPathState:fieldState(value,'projectPath',projectPath),sameMrPath:value.mrPath===MR,isFork:value.isFork===true||value.isFork==='true'?true:value.isFork===false||value.isFork==='false'?false:null,source,target,
    file:{newPath,headSha:head,baseSha:ref(file.base_sha),startSha:ref(file.start_sha),rawUrl:nativeResource(file.blob_raw_path,head,newPath,true),contextUrl:nativeResource(file.diff_lines_path,head,newPath,false)},
    eligibility:{nativeApps:number(value.nativeApps),originalFileInApp:bool(value.originalFileInApp),headerHosts:number(value.headerHosts),contextControls:number(value.contextControls),expanded:bool(value.expanded),visible:bool(value.visible),nativeSearchNonempty:bool(value.nativeSearchNonempty)}};
}
function compare(observation,native) {
  if(observation.status!=='projected'||native.state!=='observed')return{id:observation.id,state:'unknown',consumedByProduct:'not_observed'};
  const differences=[],unknown=[];const check=(field,actual,expected)=>{if(actual===null||actual===undefined||expected===null||expected===undefined)unknown.push(field);else if(actual!==expected)differences.push(field);};
  const observed=observation.projection;
  if(observation.kind==='metadata'){
    check('projectPath',observed.projectPath,native.projectPath);check('diffId',observed.diffId,native.source.values.length===1?native.source.values[0].id:null);check('specPresent',observed.inventory.specPresent,true);
    if(observed.inventory.state!=='observed')unknown.push('inventory');
  }else{
    for(const name of ['source','target']){
      const left=observed[name],right=native[name];
      if(left.state!=='observed'||right.state!=='observed'||left.selectedCount!==1||right.selectedCount!==1){unknown.push(name);continue;}
      for(const key of name==='source'?['id','headSha','baseSha','startSha']:['id','headSha','startSha','mergeHead'])check(`${name}.${key}`,left.values[0][key],right.values[0][key]);
    }
  }
  return{id:observation.id,state:differences.length?'contradiction_observed':unknown.length?'unknown':'compatible_candidate',differences,unknown,consumedByProduct:'not_observed'};
}

/** Passive already-issued response projections. Bounds apply to retained/parsed evidence, not Chromium network allocation. */
export function observeGitLabComparisons(page,item,{extensionId,settleMs=2000}) {
  const evidence={status:'observing',scope:'Passive MR266334 metadata/versions only; no additional GET, source body retention or consumed-result inference.',limits:GITLAB_COMPARISON_LIMITS,requests:[],responses:[],checkpoints:[],overflow:{requests:0,responses:0},decodedBytesParsed:0};item.gitLabComparisonObservations=evidence;
  const requests=new WeakMap();const queue=[];let active=false,closed=false,accepting=true,cleanup,sequence=0;const waiters=new Set();
  const unavailable=(entry,code)=>{if(!closed){entry.status='unavailable';entry.code=code;entry.projectionFinishedAt=stamp();}};
  const observeRequest=(value,eventObserved=true)=>{
    if(!accepting)return null;let resource;try{if(value.method()!=='GET')return null;resource=route(value.url());}catch{return null;}if(resource===null)return null;
    const old=requests.get(value);if(old){if(eventObserved&&!old.requestEventObserved){old.requestEventObserved=true;old.requestedAt=stamp();}return old;}
    if(evidence.requests.length>=GITLAB_COMPARISON_LIMITS.observations){evidence.overflow.requests++;return null;}
    const entry={id:`q${++sequence}`,...resource,method:'GET',requestEventObserved:eventObserved,requestedAt:eventObserved?stamp():null,firstObservedAt:stamp(),...attribution(value,extensionId)};requests.set(value,entry);evidence.requests.push(entry);return entry;
  };
  const finishWaiters=()=>{if(!active&&queue.length===0)for(const resolve of [...waiters])resolve(true);};
  const drain=async()=>{
    if(active||closed)return;active=true;
    while(queue.length&&!closed){
      const {response,entry}=queue.shift();
      try{
        entry.projectionStartedAt=stamp();
        if(entry.selectionRedacted){unavailable(entry,'SELECTION_REDACTED');continue;}
        if(entry.httpStatus!==200){unavailable(entry,'HTTP_STATUS');continue;}
        const headers=response.headers(),mime=headers['content-type'];
        if(typeof mime!=='string'||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(mime)){unavailable(entry,'JSON_MIME_REQUIRED');continue;}
        const length=headers['content-length'];
        if(length!==undefined&&(!/^\d{1,10}$/.test(length)||Number(length)>GITLAB_COMPARISON_LIMITS.bodyBytes||Number(length)>GITLAB_COMPARISON_LIMITS.totalBytes-evidence.decodedBytesParsed)){unavailable(entry,'DECLARED_BODY_BOUND');continue;}
        if(evidence.decodedBytesParsed>=GITLAB_COMPARISON_LIMITS.totalBytes){unavailable(entry,'TOTAL_BODY_BOUND');continue;}
        const bytes=await response.buffer();if(closed)break;
        if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>GITLAB_COMPARISON_LIMITS.bodyBytes){unavailable(entry,'DECODED_BODY_BOUND');continue;}
        if(bytes.byteLength>GITLAB_COMPARISON_LIMITS.totalBytes-evidence.decodedBytesParsed){unavailable(entry,'TOTAL_BODY_BOUND');continue;}
        evidence.decodedBytesParsed+=bytes.byteLength;entry.bytes=bytes.byteLength;entry.bodySha256=digest(bytes);
        let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{unavailable(entry,'INVALID_JSON');continue;}
        const projection=projectGitLabComparison(entry.kind,value);if(projection===null){unavailable(entry,'INVALID_PROJECTION');continue;}
        entry.projection=projection;entry.projectionSha256=digest(JSON.stringify(projection));entry.status='projected';entry.projectionFinishedAt=stamp();
      }catch{unavailable(entry,'BODY_UNAVAILABLE');}
    }
    active=false;finishWaiters();
  };
  const response=(value)=>{
    if(!accepting)return;let resource,request;
    try{request=value.request();if(request.method()!=='GET')return;resource=route(value.url());}catch{return;}if(resource===null)return;
    if(evidence.responses.length>=GITLAB_COMPARISON_LIMITS.observations){evidence.overflow.responses++;return;}
    const observed=requests.get(request)??observeRequest(request,false);
    const entry={id:`r${++sequence}`,...resource,requestId:observed?.id??null,requestEventObserved:observed?.requestEventObserved??false,responseAt:stamp(),httpStatus:null,status:'pending',fromCache:null,fromServiceWorker:null};
    try{const status=value.status();if(Number.isInteger(status)&&status>=100&&status<=599)entry.httpStatus=status;}catch{/* Unavailable status is recorded without raw error text. */}
    try{if(typeof value.fromCache==='function')entry.fromCache=value.fromCache()===true;if(typeof value.fromServiceWorker==='function')entry.fromServiceWorker=value.fromServiceWorker()===true;}catch{/* Missing optional transport flags remain unknown. */}
    evidence.responses.push(entry);queue.push({response:value,entry});void drain();
  };
  page.on('request',observeRequest);page.on('response',response);
  const settle=async()=>{
    if(!active&&queue.length===0)return true;
    let timer,resolveWaiter;const result=await Promise.race([new Promise((resolve)=>{resolveWaiter=resolve;waiters.add(resolve);}),new Promise((resolve)=>{timer=setTimeout(()=>resolve(false),settleMs);})]);clearTimeout(timer);waiters.delete(resolveWaiter);return result;
  };
  return{
    async checkpoint(name,value){
      const observedAt=stamp(),ids=evidence.responses.map((entry)=>entry.id);const settled=await settle();if(closed)return{status:'unavailable',code:'OBSERVER_CLOSED'};
      if(evidence.checkpoints.length>=8)return{status:'unavailable',code:'CHECKPOINT_BOUND'};
      const native=projectGitLabNativeEligibility(value),entry={name:name==='beforeIntent'?'beforeIntent':'other',observedAt,savedAt:stamp(),settled,native,nativeSha256:digest(JSON.stringify(native)),responseIdsAtObservation:ids,comparisons:evidence.responses.filter((entry)=>ids.includes(entry.id)).map((entry)=>compare(entry,native)),consumedByProduct:'not_observed'};
      evidence.checkpoints.push(entry);return entry;
    },
    dispose(){
      if(cleanup)return cleanup;accepting=false;page.off('request',observeRequest);page.off('response',response);
      evidence.cleanup={listenersRemoved:true,startedAt:stamp(),status:'settling'};
      cleanup=(async()=>{const settled=await settle();if(!settled)for(const entry of evidence.responses)if(entry.status==='pending')unavailable(entry,'SETTLE_TIMEOUT');closed=true;queue.length=0;evidence.cleanup.status=settled?'settled':'timed_out';evidence.cleanup.finishedAt=stamp();evidence.unansweredRequests=evidence.requests.filter((request)=>!evidence.responses.some((response)=>response.requestId===request.id)).length;evidence.status=evidence.overflow.requests||evidence.overflow.responses||evidence.unansweredRequests||evidence.responses.some((entry)=>entry.status!=='projected')?'incomplete':evidence.responses.length?'observed':'no_matching_responses';return evidence;})();return cleanup;
    },
  };
}
