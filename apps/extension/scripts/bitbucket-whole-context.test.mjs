import assert from 'node:assert/strict';
import test,{beforeEach,afterEach} from 'node:test';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {Window} from 'happy-dom';
import {BITBUCKET_WHOLE as F,bitbucketWholeURL,bitbucketWholeResource,bitbucketWholeSettings,observeBitbucketWhole,bitbucketWholeProbe as probe,qualifyBitbucketWhole,verifyBitbucketWhole} from './bitbucket-whole-context.mjs';
const keys=['document','location','Element','HTMLButtonElement','getComputedStyle','getSelection','NodeFilter','innerHeight'];const original=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let window;
beforeEach(()=>{window=new Window({url:bitbucketWholeURL});for(const[k,v]of Object.entries({document:window.document,location:window.location,Element:window.Element,HTMLButtonElement:window.HTMLButtonElement,getComputedStyle:n=>window.getComputedStyle(n),getSelection:()=>window.getSelection(),NodeFilter:window.NodeFilter,innerHeight:1000}))Object.defineProperty(globalThis,k,{configurable:true,value:v});});
afterEach(()=>{globalThis.__geldBitbucketWholeContext?.stop();delete globalThis.__geldBitbucketWholeContext;for(const[k,v]of original)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];window.happyDOM.abort();});
function fixture(){document.head.innerHTML='<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\' data-target-workspace-uuid="workspace">';document.body.innerHTML=`<main role="main"><h1 data-qa="page-header">${F.head.slice(0,12)}</h1><div role="group"><a href="/${F.repository}/src/${F.head}/">View source</a></div><div role="region" aria-label="Diff"><div><div id="chg-${F.path}"></div><div><article data-qa="branch-diff-file"><label>Viewed<input type="checkbox" disabled></label><div role="rowgroup" class="diff-chunk"><div class="diff-chunk-inner"><div class="chunk-heading-wrapper"><div><button data-qa="pr-diff-show-more-lines-above">above</button></div><div><button data-qa="pr-diff-show-more-lines-below">below</button></div></div></div></div></article></div></div><div><div><h2>5 files</h2></div></div></div></main>`;const group=document.querySelector('.diff-chunk-inner');group.insertAdjacentHTML('beforeend',row(68,'before')+row(85,'after'));return{group,root:document.getElementById('chg-'+F.path).parentElement,first:document.querySelector('[data-qa="code-line"]')};}
function row(next,text){return `<div data-qa="code-line"><div data-key="code-line-number" data-old-line-number="${next}" data-new-line-number="${next}"></div><span data-line-type=" ">${text}</span><a href="#L${next}" id="L${next}">${next}</a></div>`;}
test('binds current original native full commit and admits newly inserted source without replacing original nodes',()=>{const f=fixture();const a=probe('bind');assert.equal(a.same,true);assert.equal(a.viewedPresent,true);f.group.insertAdjacentHTML('beforeend',row(86,'new context'));assert.equal(probe().same,true);assert.equal(probe().rows.length,3);assert.equal(f.first.isConnected,true);assert.equal(probe('cleanup').released,true);});
for(const fault of ['route','actor','heading','source-link','text','replace','anchor','Viewed','counts'])test(`native lease detects ${fault}`,()=>{const f=fixture();assert.equal(probe('bind').same,true);if(fault==='route')window.location.href=bitbucketWholeURL.replace(F.head,F.head.slice(0,12));if(fault==='actor')document.querySelector('meta').setAttribute('data-current-user','{"isAuthenticated":true}');if(fault==='heading')document.querySelector('h1').textContent='invalid';if(fault==='source-link')document.querySelector('a').href='/other/src/main/';if(fault==='text')f.first.querySelector('[data-line-type]').textContent='changed';if(fault==='replace')f.first.replaceWith(f.first.cloneNode(true));if(fault==='anchor')f.first.querySelector('a').id='new';if(fault==='Viewed')document.querySelector('input').checked=true;if(fault==='counts')document.querySelector('h2').textContent='4 files';const v=probe();assert.ok(v===null||v.same===false||v.viewedSame===false||v.countsSame===false);});
test('records native context directions without treating synthetic click as trusted owned input',()=>{const f=fixture();probe('bind');const intent=document.createElement('button');intent.dataset.geldTestBoundaries='';f.root.append(intent);assert.equal(probe('button','intent'),intent);intent.click();assert.equal(probe().clicked,false);document.querySelector('[data-qa="pr-diff-show-more-lines-below"]').click();assert.deepEqual(probe().events,[{leaf:null,direction:'below',before:null,after:68,oldBefore:null,oldAfter:68,trusted:false,qualified:false}]);});
test('source classification is exact and refuses branch, query and other origin substitutions',()=>{const good=`https://bitbucket.org/!api/2.0/repositories/${F.repository}/src/${F.head}/${F.path}`;assert.deepEqual(bitbucketWholeResource(good),{exact:true});assert.deepEqual(bitbucketWholeResource(good.replace('/!api','').replace('bitbucket.org','api.bitbucket.org')),{exact:true});for(const u of [good.replace(F.head,'main'),good+'?raw=1'])assert.deepEqual(bitbucketWholeResource(u),{exact:false});assert.equal(bitbucketWholeResource(good.replace('bitbucket.org','evil.example')),null);});
test('raw source requires exact full-head response, positive attribution, one request and source agreement',()=>{const good={exact:true,extension:true,armed:true,method:'GET',status:200,redirected:false,bytes:F.bytes,sha256:F.sha256,lines:['same']};const sample={rows:[{next:1,text:'same'}]},traffic={requests:[{}],raw:[good]};assert.equal(qualifyBitbucketWhole(sample,traffic),good);for(const edit of [{extension:false},{status:304},{redirected:true},{sha256:'a'.repeat(64)},{lines:['different']}])assert.throws(()=>qualifyBitbucketWhole(sample,{...traffic,raw:[{...good,...edit}]}));assert.throws(()=>qualifyBitbucketWhole(sample,{...traffic,requests:[{},{}]}));});
function streamFixture({stream,enable}={}) {
 const session=new EventEmitter();session.calls=[];session.send=async(method,args)=>{session.calls.push({method,args});if(method==='Network.enable')return enable?enable():{};if(method==='Network.streamResourceContent')return stream?stream(args.requestId):{bufferedData:''};throw Error('PRIVATE_UNKNOWN_METHOD');};session.detach=async()=>{};
 const page=new EventEmitter();page.createCDPSession=async()=>session;return{page,session};
}
const rawURL=`https://bitbucket.org/!api/2.0/repositories/${F.repository}/src/${F.head}/${F.path}`;
function sourceRequest(page,session,id='source-1') {
 const req={id,url:()=>rawURL,method:()=> 'GET',initiator:()=>({stack:{callFrames:[{url:'chrome-extension://id/source.js'}]}}),redirectChain:()=>[]};
 page.emit('request',req);session.emit('Network.requestWillBeSent',{requestId:id,request:{url:rawURL,method:'GET'}});return req;
}
function sourceResponse(page,req) {page.emit('response',{url:req.url,request:()=>req,status:()=>200,headers:()=>({'content-type':'text/x-python'}),buffer:async()=>{throw Error('DECODED_BUFFER_MUST_NOT_BE_READ');}});}
test('observer streams bounded already-issued raw bytes and strips source body during dispose',async()=>{
 const body=Buffer.from('public source ✖'),{page,session}=streamFixture({stream:()=>({bufferedData:body.toString('base64')})}),progress={},o=observeBitbucketWhole(page,progress,'id');await o.checkpoint();progress.armed=true;
 const req=sourceRequest(page,session);sourceResponse(page,req);session.emit('Network.loadingFinished',{requestId:req.id});await o.checkpoint();
 assert.equal(progress.raw[0].extension,true);assert.equal(progress.raw[0].lines[0],'public source ✖');assert.equal(progress.raw[0].bytes,body.length);assert.equal(progress.raw[0].mechanism,'cdp_network_stream');await o.dispose();assert.equal(progress.raw[0].lines,undefined);assert.equal(page.listenerCount('request'),0);assert.equal(session.listenerCount('Network.dataReceived'),0);assert.doesNotMatch(JSON.stringify(progress),/chrome-extension|https:|public source/);
});
test('early raw stream joins buffered bytes before later chunks without Chromium charset re-encoding',async()=>{
 let release;const {page,session}=streamFixture({stream:()=>new Promise(resolve=>{release=resolve;})}),progress={},o=observeBitbucketWhole(page,progress,'id');await o.checkpoint();progress.armed=true;const req=sourceRequest(page,session);sourceResponse(page,req);
 session.emit('Network.dataReceived',{requestId:req.id,data:Buffer.from('✖').toString('base64')});session.emit('Network.loadingFinished',{requestId:req.id});release({bufferedData:Buffer.from('source ').toString('base64')});await o.checkpoint();
 assert.deepEqual(progress.raw[0].lines,['source ✖']);assert.equal(progress.raw[0].bytes,Buffer.byteLength('source ✖'));await o.dispose();
});
for(const fault of ['unsupported','failed','overflow','invalid'])test('raw stream fails closed without a decoded-body fallback: '+fault,async()=>{
 const {page,session}=streamFixture({stream:()=>fault==='unsupported'?Promise.reject(Error('PRIVATE_CDP_FAILURE')):{bufferedData:''}}),progress={},o=observeBitbucketWhole(page,progress,'id');await o.checkpoint();progress.armed=true;const req=sourceRequest(page,session);sourceResponse(page,req);
 if(fault==='failed')session.emit('Network.loadingFailed',{requestId:req.id,errorText:'PRIVATE_NETWORK_ERROR'});
 else if(fault==='overflow')session.emit('Network.dataReceived',{requestId:req.id,data:Buffer.alloc(512*1024+1).toString('base64')});
 else if(fault==='invalid')session.emit('Network.dataReceived',{requestId:req.id,data:'PRIVATE_NOT_BASE64'});
 session.emit('Network.loadingFinished',{requestId:req.id});await o.checkpoint();assert.equal(progress.raw[0].error,'SOURCE_RESPONSE_UNQUALIFIED');assert.equal(progress.raw[0].lines,undefined);assert.doesNotMatch(JSON.stringify(progress),/PRIVATE_|DECODED_BUFFER/);await o.dispose();
});
test('raw streaming must initialize before intent and cleans up unsupported CDP',async()=>{
 const {page,session}=streamFixture({enable:()=>Promise.reject(Error('PRIVATE_ENABLE'))}),progress={},o=observeBitbucketWhole(page,progress,'id');await assert.rejects(o.checkpoint(),e=>e.code==='SOURCE_STREAM_UNAVAILABLE');await o.dispose();assert.equal(session.listenerCount('Network.requestWillBeSent'),0);assert.doesNotMatch(JSON.stringify(progress),/PRIVATE_/);
});
test('pending raw stream times out and ignores late bytes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {page,session}=streamFixture({stream:()=>new Promise(()=>{})}),progress={},o=observeBitbucketWhole(page,progress,'id');await o.checkpoint();progress.armed=true;const req=sourceRequest(page,session);sourceResponse(page,req);t.mock.timers.tick(5001);await o.checkpoint();assert.equal(progress.raw[0].error,'SOURCE_RESPONSE_UNQUALIFIED');session.emit('Network.dataReceived',{requestId:req.id,data:Buffer.from('late').toString('base64')});assert.equal(progress.raw[0].lines,undefined);await o.dispose();t.mock.timers.reset();
});
test('raw streaming is restricted to exact GETs and four retained sources',async()=>{
 const {page,session}=streamFixture(),progress={},o=observeBitbucketWhole(page,progress,'id');await o.checkpoint();
 session.emit('Network.requestWillBeSent',{requestId:'foreign',request:{url:rawURL+'?raw=1',method:'GET'}});session.emit('Network.requestWillBeSent',{requestId:'post',request:{url:rawURL,method:'POST'}});
 for(let i=0;i<10;i++)session.emit('Network.requestWillBeSent',{requestId:String(i),request:{url:rawURL,method:'GET'}});
 assert.equal(session.calls.filter(c=>c.method==='Network.streamResourceContent').length,4);await assert.rejects(o.checkpoint(),e=>e.code==='SOURCE_STREAM_UNAVAILABLE');await o.dispose();
});

test('restores exact raw settings after close, while preserving all fields except outline during the run',async()=>{for(const initial of [{present:false},{present:true,value:{enabled:false,testOutline:true,categories:{tests:true},extra:'keep'}}]){let v=structuredClone(initial);const progress={},s=bitbucketWholeSettings({read:async()=>structuredClone(v),write:async x=>{v=structuredClone(x);},progress});await s.prepare();assert.equal(v.value.enabled,true);assert.equal(v.value.testOutline,false);await s.outline(true);assert.equal(v.value.testOutline,true);await s.outline(false);await s.restore(true);assert.deepEqual(v,initial);assert.equal(progress.restored,true);}});
test('refuses settings drift and refuses restore while the provider remains open',async()=>{let v={present:false};const s=bitbucketWholeSettings({read:async()=>structuredClone(v),write:async x=>{v=structuredClone(x);},progress:{}});await s.prepare();v.value.changed=true;await assert.rejects(s.outline(true));await assert.rejects(s.restore(false));});
function protocol(fault){let closed=false,outline=false,ready=false,stage=0,selected='',restored=false;const events=[],progress={},order=[],pollSamples=[];let contextSamples=0,rebound=false;const commits=[];const source=Array.from({length:134},(_,i)=>`line${i+1}`);const state=()=>({same:true,viewedSame:true,countsSame:fault!=='counts',overflow:false,visible:true,clicked:true,rows:source.flatMap((text,i)=>stage<2&&F.leaves.some((f,j)=>j>=stage&&f.missing.includes(i+1))?[]:[{next:i+1,text,hidden:false}]),folds:outline?F.leaves.map((f,i)=>({...f,expanded:stage>i?'true':'false'})):[],intent:outline?{status:ready?'ready':'idle'}:null,events:[...events],selected});const traffic={requests:[],raw:[],armed:false};const observer={evidence:traffic,checkpoint:async()=>traffic,dispose:async()=>{order.push('dispose');}};const settings={current:async()=>{},outline:async on=>{outline=on;order.push(on?'on':'off');},restore:async c=>{assert.equal(c,true);restored=true;order.push('restore');}};const page={isClosed:()=>closed,close:async()=>{closed=true;order.push('close');},evaluate:async(_fn,action,_arg,fixture)=>{if(action==='commit-transition'){commits.push(_arg);rebound=true;return{committed:true};}if(action==='read-with-diagnostic'&&['context-rebind','context-wrong-source'].includes(fault)&&stage>0&&!rebound&&progress.phase==='await_context'){const rows=source.map((text,i)=>({next:i+1,text:fault==='context-wrong-source'&&i===83?'PRIVATE_WRONG_SOURCE':text}));return{value:null,diagnostic:{code:'NATIVE_ROW_TRANSITION',flags:{rebindEligible:true}},candidate:{token:7,state:{rows,viewedSame:true,countsSame:true,overflow:false}},observedRows:rows};}if(action==='read-with-diagnostic'&&fault==='context-null'&&stage>0&&progress.phase==='await_context'){contextSamples++;return{value:null,diagnostic:{code:'SOURCE_CUSTODY',flags:{rowsPresent:contextSamples>1,rowText:false},leaves:[{start:83,missing:[83,84]}],events:{count:1,above:1,below:0}},observedRows:source.map((text,i)=>({next:i+1,text}))};}if(action==='bind-diagnostic'&&fault==='bind')return{same:false,diagnostic:{phase:'bind',code:'ROW_SYNTAX_LABEL',counts:{rows:200,invalidRows:1},flags:{articleParent:true}}};if(action==='bind-diagnostic'&&fault==='bind-evaluate')throw Error('PRIVATE_BIND_EVALUATION');if(action==='cleanup')return vm.runInNewContext('('+_fn.toString()+')(...args)',{args:[action,_arg,fixture]});if(action==='selection-target')return{visible:true,text:'self.assertIn',x1:1,x2:4,y:1};if(action==='restore-selection')return{restored:true};if(action==='cleanup')return{released:true};return state();},evaluateHandle:async(_fn,_action,arg)=>({asElement:()=>({evaluate:async()=>{if(fault==='prepare-source')traffic.requests.push({armed:false});return true;},click:async()=>{order.push(arg);if(arg==='intent'){ready=true;traffic.requests=[{}];traffic.raw=[{exact:true,extension:true,armed:true,method:'GET',status:200,redirected:false,bytes:F.bytes,sha256:F.sha256,lines:source}];}else{stage++;events.push({leaf:fault==='native-leaf'?999:arg,qualified:fault!=='native-gap',direction:stage===1?'above':'below'});}}}),dispose:async()=>{}}),mouse:{move:async()=>{},down:async()=>{},up:async()=>{selected=fault==='selection'?'wrong':'self.assertIn';}}};const poll=async(read,accept)=>{for(let i=0;i<2;i++){try{const v=await read();pollSamples.push(v);if(accept(v))return v;}catch(error){if(fault!=='context-null')throw error;}}throw Error('PRIVATE_NATIVE_ERROR');};return{run:()=>verifyBitbucketWhole(page,{settings,observer,poll,progress,guardBudget:()=>{}}),progress,order,pollSamples,commits,get restored(){return restored;}};}
test('protocol uses one source request, two explicit folds, real mouse and close-first cleanup',async()=>{const p=protocol();assert.equal((await p.run()).status,'passed');assert.deepEqual(p.order,['on','intent',83,45,'off','close','dispose','restore']);assert.equal(p.restored,true);});
for(const fault of ['counts','selection','native-leaf','native-gap','prepare-source'])test(`protocol cleans up after ${fault} failure without arbitrary error text`,async()=>{const p=protocol(fault);await assert.rejects(p.run());assert.notEqual(p.progress.status,'passed');assert.equal(p.restored,true);if(fault==='prepare-source')assert.equal(p.order.includes('intent'),false);assert.doesNotMatch(JSON.stringify(p.progress),/PRIVATE_NATIVE_ERROR/);});

for(const scenario of ['success','navigation-failure'])test(`actual runner keeps ${scenario} private and restores settings after page close`,async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');const source=readFileSync(new URL('./browser-e2e.mjs',import.meta.url),'utf8');const body=source.slice(source.indexOf('async function runCase('),source.indexOf('\nasync function runBitbucketWhitespaceCase('));let storage={present:true,value:{enabled:true,testOutline:true,private:'DO_NOT_RETAIN'}},closed=false,navigations=0;const order=[];const page=new EventEmitter();Object.assign(page,{setViewport:async()=>{},bringToFront:async()=>{},isClosed:()=>closed,url:()=>bitbucketWholeURL,close:async()=>{closed=true;order.push('close');},goto:async()=>{navigations++;assert.equal(storage.value.testOutline,false);page.emit('console',{text:()=> 'DO_NOT_RETAIN_CONSOLE'});if(scenario==='navigation-failure')throw Error('DO_NOT_RETAIN_FAILURE');return{status:()=>200};}});
 const report={cases:[],infrastructureErrors:[],quotaPolicy:{conservativeObservedRequestBudget:40}},context={ bitbucketBudgetHold: vm.runInNewContext('(' + source.slice(source.indexOf('function bitbucketBudgetHold('), source.indexOf('async function inheritCooldowns(')) + ')'), bitbucketRequestTimes: [],assert,AbortController,console:{log(){}},report,focus:'bitbucket-whole-context',FOCUSED_CASES:{'bitbucket-whole-context':['bitbucket-whole-context']},cooldowns:new Map(),providerOf:()=> 'bitbucket',currentCaseAbort:undefined,bitbucketWholeSettings,observeBitbucketWhole,bitbucketWholeCases:new WeakMap(),SETTINGS_KEY:'settings',extensionId:'test',options:{evaluate:async(_fn,key,v)=>{assert.equal(key,'settings');if(v!==undefined){if(v.value?.testOutline===true){assert.equal(closed,true);order.push('restore');}storage=structuredClone(v);}return structuredClone(storage);}},browser:{newPage:async()=>page},observeBitbucketBudget(){},safeUrl:v=>v,errorText:e=>String(e),closedTarget:()=>false,saveReport:async()=>{},authObservation:async()=>{throw Error('DO_NOT_RETAIN_AUTH');},capture:async()=>{throw Error('DO_NOT_RETAIN_CAPTURE');}};
 vm.createContext(context);new vm.Script(body+'\nglobalThis.run=runCase;').runInContext(context);await context.run('bitbucket-whole-context',bitbucketWholeURL,async(_page,item)=>{item.bitbucketWhole.baseline={same:true};return{status:'passed'};});assert.equal(navigations,1);assert.deepEqual(order,['close','restore']);assert.equal(storage.value.private,'DO_NOT_RETAIN');assert.equal(report.cases[0].status,scenario==='success'?'passed':'unavailable');assert.doesNotMatch(JSON.stringify(report),/DO_NOT_RETAIN/);
});

test('preserves original source nodes across a native renderer terminal-LF addition',()=>{
 const f=fixture(),codes=[...f.root.querySelectorAll('[data-line-type]')];for(const code of codes){code.className='code-diff syntax-highlighted __rbb_syntax_highlight';code.setAttribute('role','gridcell');code.setAttribute('aria-label','Unchanged: '+code.textContent);}codes[0].append('\n');assert.equal(probe('bind').same,true);const before=codes[1].firstChild;codes[1].append('\n');f.group.insertAdjacentHTML('beforeend',row(86,'new context'));assert.equal(probe().same,true);assert.equal(codes[1].firstChild,before);before.data+='changed';assert.equal(probe(),null);
});

test('selection maps original native token Text nodes across a fragmented command',()=>{const f=fixture();f.group.insertAdjacentHTML('beforeend',row(69,'self.assertIn'));const code=f.group.querySelector('[data-new-line-number="69"]').parentElement.querySelector('[data-line-type]');code.innerHTML='<span>self</span><span>.</span><span>assertIn</span>';code.scrollIntoView=()=>{};assert.equal(probe('bind').same,true);assert.equal(probe('selection-target').text,'self.assertIn');});

const bindFaults={
 ROUTE_UNQUALIFIED:()=>{window.location.hash='%E0%A4%A';},
 ANONYMOUS_ACTOR:()=>document.querySelector('meta').setAttribute('data-current-user','{"isAuthenticated":true,"private":"PRIVATE_ACTOR"}'),
 STANDALONE_REGION:()=>document.querySelector('[aria-label="Diff"]').remove(),
 STANDALONE_HEADING:()=>{document.querySelector('h1').textContent='PRIVATE_HEADING';},
 STANDALONE_SOURCE_LINK:()=>{document.querySelector('a').href='https://example.test/PRIVATE_SOURCE';},
 TARGET_ANCHOR:()=>document.getElementById('chg-'+F.path).remove(),
 ARTICLE_PARENT:()=>{const article=document.querySelector('article');article.parentElement.parentElement.append(article);},
 ROW_STRUCTURE:()=>document.querySelector('[data-key="code-line-number"]').remove(),
 ROW_SYNTAX_STRUCTURE:()=>document.querySelector('[data-line-type]').classList.add('__rbb_syntax_highlight'),
 ROW_SYNTAX_LABEL:()=>{const n=document.querySelector('[data-line-type]');n.className='syntax-highlighted __rbb_syntax_highlight';n.setAttribute('role','gridcell');n.setAttribute('aria-label','PRIVATE_LABEL');},
 ROW_NEWLINE:()=>{document.querySelector('[data-line-type]').textContent='PRIVATE_CODE\n';},
 ROW_NUMBER:()=>document.querySelector('[data-key="code-line-number"]').setAttribute('data-new-line-number','PRIVATE_NUMBER'),
 ROW_KIND:()=>document.querySelector('[data-line-type]').setAttribute('data-line-type','PRIVATE_KIND'),
 ROW_BOUNDS:()=>{document.querySelector('[data-line-type]').textContent='p'.repeat(20001);},
 VIEWED_COUNT:()=>document.querySelector('label').after(document.querySelector('label').cloneNode(true)),
 COUNT_SURFACES:()=>document.querySelector('h2').remove(),
};
for(const[code,change]of Object.entries(bindFaults))test('bind diagnostics preserve fixed failed predicate and exclude source/private content: '+code,()=>{
 fixture();change();const before=document.documentElement.outerHTML,value=probe('bind-diagnostic');assert.equal(value.same,false);assert.equal(value.diagnostic.code,code);assert.equal(globalThis.__geldBitbucketWholeContext,undefined);assert.equal(document.documentElement.outerHTML,before);assert.equal(probe('bind'),null);
 assert.deepEqual(Object.keys(value),['same','diagnostic']);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|https:|"text"|"raw"|"workspace"|"rows":\[/);assert.ok(JSON.stringify(value).length<2048);
});
test('bind diagnostic reports only bounded primitive facts when original source qualifies',()=>{
 fixture();const value=probe('bind-diagnostic');assert.equal(value.same,true);assert.equal(value.diagnostic.code,'BIND_READY');assert.equal(value.diagnostic.counts.rows,2);assert.equal(value.diagnostic.flags.articleParent,true);assert.equal('rows' in value,false);assert.equal('counts' in value,false);assert.equal(probe().same,true);
});
test('bind diagnostics bound row counts without recording the rows',()=>{
 const f=fixture();for(let i=0;i<1005;i++)f.group.insertAdjacentHTML('beforeend',row(i+100,'PRIVATE_ROW'));const value=probe('bind-diagnostic');assert.equal(value.diagnostic.code,'ROW_BOUNDS');assert.equal(value.diagnostic.counts.rows,1001);assert.equal(value.diagnostic.flags.countsCapped,true);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_ROW/);
});
test('PR frame absence has a distinct primitive bind diagnostic',()=>{
 fixture();window.location.href=`https://bitbucket.org/${F.repository}/pull-requests/22/diff`;const value=probe('bind-diagnostic',null,{...F,pr:'22'});assert.equal(value.diagnostic.code,'PR_FRAME');assert.equal(value.diagnostic.flags.prFrame,false);
});

for(const fault of ['bind','bind-evaluate'])test('bind timeout retains first/last fixed diagnostics and its phase through close-first cleanup: '+fault,async()=>{
 const p=protocol(fault);await assert.rejects(p.run());assert.equal(p.progress.failurePhase,'bind');assert.equal(p.progress.phase,'failed');assert.equal(p.progress.bindProbe.attempts,2);assert.equal(p.progress.bindProbe.first.code,fault==='bind'?'ROW_SYNTAX_LABEL':'BIND_EVALUATION_FAILED');assert.deepEqual(p.progress.bindProbe.first,p.progress.bindProbe.last);assert.deepEqual(p.order,['close','dispose','restore']);assert.equal(p.restored,true);assert.doesNotMatch(JSON.stringify(p.progress),/PRIVATE_/);
});

function visualCountHeader(){
 document.querySelector('h2').remove();const tree=document.createElement('div');tree.id='file-tree';
 // Retained c4fo7 LinesUpdatedBody: numeric visual spans are aria-hidden beside the accessible summary.
 tree.innerHTML='<div class="css-1lgdsrk"><div class="css-8jq715 e1u3rele5"><div class="css-1u6qxyx e1u3rele4"><span class="css-wk3yip e1u3rele3"><h5>Lines updated</h5></span><div class="css-1ed6y7i e1u3rele2"><span data-geld-ui>PRIVATE_OWNED_COUNT</span><span aria-hidden="true" class="css-1o3h7pb e1u3rele1"><span>+46</span></span><span aria-hidden="true" class="css-1dfuavi e1u3rele0"><span>-99</span></span></div><span data-geld-ui>PRIVATE_ACCESSIBLE_SUMMARY</span></div></div><ul><li><span aria-hidden="true"><span>+123</span></span></li></ul></div>';document.body.append(tree);return tree;
}
test('bind reads original visual header deltas through their native aria-hidden presentation wrappers',()=>{
 fixture();const tree=visualCountHeader(),before=tree.outerHTML;const value=probe('bind-diagnostic');assert.equal(value.same,true);assert.equal(value.diagnostic.counts.countSurfaces,2);assert.deepEqual(probe().counts,['+46','-99']);assert.equal(tree.outerHTML,before);
 tree.querySelector('[data-geld-ui]').textContent='PRIVATE_CHANGED';tree.querySelector('li span span').textContent='+999';assert.equal(probe().countsSame,true);
 tree.querySelector('.e1u3rele1 > span').textContent='+45';assert.equal(probe().countsSame,false);
});
for(const hidden of ['hidden','inert','owned','display','visibility','opacity','content-visibility','aria-container','input'])test('visual delta metadata cannot bypass actual unavailable or foreign scope: '+hidden,()=>{
 fixture();const tree=visualCountHeader(),header=tree.querySelector('.e1u3rele4');
 if(hidden==='display')header.style.display='none';else if(hidden==='visibility')header.style.visibility='hidden';else if(hidden==='opacity')header.style.opacity='0';else if(hidden==='content-visibility')header.style.contentVisibility='hidden';else if(hidden==='owned')header.setAttribute('data-geld-ui','');else if(hidden==='aria-container')header.setAttribute('aria-hidden','true');else if(hidden==='input'){const button=document.createElement('button');header.before(button);button.append(header);}else header.setAttribute(hidden,'');
 const value=probe('bind-diagnostic');assert.equal(value.same,false);assert.equal(value.diagnostic.code,'COUNT_SURFACES');assert.equal(probe('bind'),null);
});

test('read observation distinguishes same-content row replacement from source ownership',()=>{
 const f=fixture();probe('bind');f.first.replaceWith(f.first.cloneNode(true));const value=probe('read-with-diagnostic');assert.equal(value.value,null);assert.equal(value.diagnostic.code,'SOURCE_CUSTODY');assert.equal(value.diagnostic.flags.frame,true);assert.equal(value.diagnostic.flags.rowsPresent,false);assert.equal(value.diagnostic.counts.missingRetainedRows,1);assert.deepEqual(value.observedRows,[{next:68,text:'before'},{next:85,text:'after'}]);assert.equal(probe(),null);assert.doesNotMatch(JSON.stringify(value.diagnostic),/"text"|before|after|https:/);
});
test('read observation identifies retained row text drift without recording its contents',()=>{
 const f=fixture();probe('bind');f.first.querySelector('[data-line-type]').textContent='PRIVATE_REPLACEMENT_CONTENT';const value=probe('read-with-diagnostic');assert.equal(value.value,null);assert.equal(value.diagnostic.flags.rowsPresent,true);assert.equal(value.diagnostic.flags.rowText,false);assert.equal(value.diagnostic.flags.rowTextNodes,false);assert.doesNotMatch(JSON.stringify(value.diagnostic),/PRIVATE_|"text"/);
});
test('read diagnostics independently capture known fold, missing/hidden lines and bounded native events',()=>{
 const f=fixture();probe('bind');f.root.insertAdjacentHTML('beforeend',`<div data-geld-provider-fold-row="test:83"><button aria-expanded="true"><span class="geld-provider-line-fold__line">83</span><span class="geld-provider-line-fold__title">${F.leaves[0].title}</span></button></div>`);f.group.querySelector('[data-new-line-number="85"]').parentElement.setAttribute('data-geld-provider-line-hidden','');
 globalThis.__geldBitbucketWholeContext.events=[{direction:'above',qualified:true,trusted:false,private:'PRIVATE_EVENT'},{direction:'below',qualified:false,trusted:true},{direction:'PRIVATE_DIRECTION',leaf:'PRIVATE_LEAF'}];
 const value=probe('read-with-diagnostic'),leaf=value.diagnostic.leaves[0];assert.equal(value.value.same,true);assert.equal(leaf.start,83);assert.equal(leaf.foldCount,1);assert.equal(leaf.titleMatches,true);assert.equal(leaf.expanded,'expanded');assert.deepEqual(leaf.hidden,[85]);assert.equal(leaf.missing.includes(83),true);assert.equal(leaf.missing.includes(85),false);assert.deepEqual(value.diagnostic.events,{count:3,above:1,below:1,unknown:1,qualified:1,trusted:1,overflow:false});assert.doesNotMatch(JSON.stringify(value.diagnostic),/PRIVATE_|test_fail_if/);
});
test('failed early read still captures safe original-node connectivity and native event totals',()=>{
 const f=fixture();probe('bind');globalThis.__geldBitbucketWholeContext.events=[{direction:'above',qualified:true}];document.querySelector('article').remove();const value=probe('read-with-diagnostic');assert.equal(value.value,null);assert.equal(value.diagnostic.flags.originalArticleConnected,false);assert.equal(value.diagnostic.events.count,1);assert.equal(value.diagnostic.leaves.length,2);assert.equal(probe(),null);
});

test('context polling retains first/last null-source diagnostics and independent source agreement before failure',async()=>{
 const p=protocol('context-null');await assert.rejects(p.run());const samples=p.progress.observations.await_context;assert.equal(samples.attempts,2);assert.equal(samples.first.flags.rowsPresent,false);assert.equal(samples.last.flags.rowsPresent,true);assert.deepEqual(samples.first.sourceAgreement,{available:true,mismatches:0});assert.equal(p.progress.failurePhase,'await_context');assert.equal(p.restored,true);assert.doesNotMatch(JSON.stringify(samples),/line[0-9]|PRIVATE_/);
});
test('poll transport contains bounded observations instead of native row/source dumps',async()=>{
 const p=protocol();await p.run();const samples=p.pollSamples.filter(s=>s&&Object.hasOwn(s,'diagnostic'));assert.ok(samples.length>0);assert.ok(samples.every(s=>!Object.hasOwn(s,'rows')&&!Object.hasOwn(s,'value')));assert.doesNotMatch(JSON.stringify(samples),/"text":|line[0-9]/);assert.equal(p.progress.phase,'complete');
});

function nativeContextFixture(extra=false){
 const f=fixture(),header=f.group.querySelector('.chunk-heading-wrapper');f.first.after(header);if(extra)f.group.insertAdjacentHTML('beforeend',row(93,'beforeBelow')+'<div class="chunk-heading-wrapper"><button data-qa="pr-diff-show-more-lines-below">below</button></div>'+row(98,'afterBelow'));
 f.root.insertAdjacentHTML('beforeend',`<div data-geld-provider-fold-row="test:83"><button aria-expanded="false"><span class="geld-provider-line-fold__line">83</span><span class="geld-provider-line-fold__title">${F.leaves[0].title}</span></button></div>`);
 probe('bind');const button=probe('button',83),event=new window.MouseEvent('click',{bubbles:true});Object.defineProperty(event,'isTrusted',{value:true});button.dispatchEvent(event);document.querySelector('[data-qa="pr-diff-show-more-lines-above"]').click();if(extra)f.group.querySelectorAll('.chunk-heading-wrapper')[1].querySelector('button').click();
 for(const row of f.group.querySelectorAll('[data-qa="code-line"]'))row.replaceWith(row.cloneNode(true));
 f.group.querySelector('[data-new-line-number="85"]').parentElement.insertAdjacentHTML('beforebegin',row(83,'new83')+row(84,'new84'));if(extra)f.group.querySelector('[data-new-line-number="98"]').parentElement.insertAdjacentHTML('beforebegin',row(94,'new94')+row(95,'new95')+row(96,'new96'));return f;
}
test('native context transition offers a candidate only after trusted own input and qualified gap event, then restores strict custody',()=>{
 const f=nativeContextFixture(),read=probe('read-with-diagnostic');assert.equal(read.value,null);assert.equal(read.diagnostic.flags.semanticRows,true);assert.equal(read.diagnostic.flags.rebindEligible,true);assert.ok(read.candidate.token>0);assert.equal(probe(),null);
 assert.equal(probe('commit-transition',read.candidate.token).committed,true);assert.equal(probe().same,true);assert.equal(probe('commit-transition',read.candidate.token).committed,false);
 f.group.querySelector('[data-new-line-number="83"]').parentElement.querySelector('[data-line-type]').textContent='PRIVATE_EDIT';assert.equal(probe(),null);
});
for(const fault of ['old-edit','old-missing','old-duplicate','outside-gap','non-context','no-event','untrusted-own','counts','Viewed','empty-additions','old-outside-gap','duplicate-new'])test('native context transition refuses '+fault,()=>{
 const f=nativeContextFixture();
 if(fault==='old-edit')f.group.querySelector('[data-new-line-number="68"]').parentElement.querySelector('[data-line-type]').textContent='PRIVATE_EDIT';
 if(fault==='old-missing')f.group.querySelector('[data-new-line-number="68"]').parentElement.remove();
 if(fault==='old-duplicate')f.group.append(f.group.querySelector('[data-new-line-number="68"]').parentElement.cloneNode(true));
 if(fault==='outside-gap')f.group.insertAdjacentHTML('beforeend',row(99,'PRIVATE_OUTSIDE'));
 if(fault==='non-context')f.group.querySelector('[data-new-line-number="83"]').parentElement.querySelector('[data-line-type]').setAttribute('data-line-type','+');
 if(fault==='no-event')globalThis.__geldBitbucketWholeContext.events=[];
 if(fault==='untrusted-own')globalThis.__geldBitbucketWholeContext.transition.clicked=false;
 if(fault==='counts')document.querySelector('h2').textContent='4 files';
 if(fault==='Viewed')document.querySelector('input').checked=true;
 if(fault==='empty-additions')for(const number of [83,84])f.group.querySelector('[data-new-line-number="'+number+'"]').parentElement.remove();
 if(fault==='old-outside-gap')f.group.querySelector('[data-new-line-number="83"]').setAttribute('data-old-line-number','99');
 if(fault==='duplicate-new'){const copy=f.group.querySelector('[data-new-line-number="83"]').parentElement.cloneNode(true);copy.querySelector('[data-key="code-line-number"]').setAttribute('data-old-line-number','82');f.group.querySelector('[data-new-line-number="85"]').parentElement.before(copy);}
 const read=probe('read-with-diagnostic');assert.equal(read.candidate,null);assert.equal(read.value,null);assert.equal(probe(),null);assert.doesNotMatch(JSON.stringify(read.diagnostic),/PRIVATE_/);
});
test('native context commit rechecks the exact candidate after Node source verification',()=>{
 const f=nativeContextFixture(),candidate=probe('read-with-diagnostic').candidate;
 f.group.querySelector('[data-new-line-number="83"]').parentElement.replaceWith(f.group.querySelector('[data-new-line-number="83"]').parentElement.cloneNode(true));
 assert.equal(probe('commit-transition',candidate.token).committed,false);assert.equal(probe(),null);
});

test('Node verifies the immutable full source before passing only a token to commit a native remount',async()=>{
 const p=protocol('context-rebind');await p.run();assert.deepEqual(p.commits,[7]);assert.equal(p.progress.rebindings.length,1);assert.equal(p.progress.phase,'complete');
});
test('Node refuses a native candidate with any new-side source mismatch',async()=>{
 const p=protocol('context-wrong-source');await assert.rejects(p.run());assert.deepEqual(p.commits,[]);assert.equal(p.progress.failurePhase,'await_context');assert.equal(p.progress.observations.await_context.last.sourceAgreement.mismatches,1);assert.doesNotMatch(JSON.stringify(p.progress.observations),/PRIVATE_/);
});

test('one observed native batch can settle above and below gaps but cannot authorize a later arbitrary remount',()=>{
 const f=nativeContextFixture(true),read=probe('read-with-diagnostic');assert.equal(read.diagnostic.flags.rebindEligible,true);assert.equal(probe('commit-transition',read.candidate.token).committed,true);assert.equal(globalThis.__geldBitbucketWholeContext.transition.used,2);assert.equal(probe().same,true);
 const row=f.group.querySelector('[data-new-line-number="83"]').parentElement;row.replaceWith(row.cloneNode(true));const later=probe('read-with-diagnostic');assert.equal(later.value,null);assert.equal(later.candidate,null);assert.equal(later.diagnostic.flags.nativeTransition,false);
});
