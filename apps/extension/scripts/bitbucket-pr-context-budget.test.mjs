import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { cachedBitbucketWholeFold } from './bitbucket-whole-context.mjs';
import { readFileSync } from 'node:fs';
import { bitbucketPrContextPolicy as policy, bitbucketPrContextInputBudget as input } from './bitbucket-pr-context-budget.mjs';
test('only explicit PR whole context has50total with3external reservations and47observed stop',()=>{
  assert.deepEqual(policy('bitbucket-pr-whole-context'),{conservativeObservedRequestBudget:47,totalReadOnlyRequestBudget:50,externalRequestReserve:3,externalRequestReserveReason:'Reserve for requests accounted outside the browser runner'});
  for(const focus of ['all','regression','bitbucket-whole-context','bitbucket-local-reviewed','bitbucket-pipeline-initial-on','bitbucket-native-bash-on','other'])assert.deepEqual(policy(focus),{});
});
test('missing context reserves three free observations for at most two requests',()=>{
  assert.equal(input(44).available,true);assert.equal(input(45).available,false);assert.equal(input(46).available,false);assert.equal(input(47).available,false);
  assert.equal(input(44).requiredFree,3);
});
test('only a proven cached owned fold may omit request reserve, never past hard stop',()=>{
  assert.equal(input(46,{cachedOwnFold:true}).available,true);assert.equal(input(46,{cachedOwnFold:'true'}).available,false);assert.equal(input(47,{cachedOwnFold:true}).available,false);
  for(const value of [-1,NaN,Infinity,1.5,'0'])assert.equal(input(value,{cachedOwnFold:true}).available,false);
});
test('PR preparation disables both review consumers and default and real429 guards stay intact',()=>{
  const code=readFileSync(new URL('./browser-e2e.mjs',import.meta.url),'utf8');
  assert.match(code,/preparePatch:prWhole\?\{prOverview:false,quickReview:false,showListStats:false,repoConfigs:'never',aiEnabled:false\}/);
  assert.match(code,/conservativeObservedRequestBudget: 40/);assert.match(code,/active \+ 4 < budget/);
  assert.match(code,/response\.status\(\) === 429/);assert.match(code,/holdReason = 'provider_http429'/);
  assert.match(code,/const inheritedBudgetHold = bitbucketBudgetHold/);
  assert.match(code,/guardBudget:guardBitbucketPrContextBudget/);
});
test('cached request exemption comes from complete qualified leaf rows, never boundary source acquisition',()=>{
  const code=readFileSync(new URL('./bitbucket-whole-context.mjs',import.meta.url),'utf8');
  assert.match(code,/cachedBitbucketWholeFold\(await check\(\),fixture,sourceLines,arg\)/);assert.match(code,/guardBudget\(\{cachedOwnFold:cached\}\)/);
  assert.match(code,/await click\('intent'\)/);assert.match(code,/await click\(leaf.start,missingBefore.length===0\)/);
});

function observed(focus,count) {
  const code=readFileSync(new URL('./browser-e2e.mjs',import.meta.url),'utf8');
  const start=code.indexOf('function observeBitbucketBudget('),end=code.indexOf('async function runCase(',start);assert.ok(start>=0&&end>start);
  const now=1_000_000,policyValue={conservativeObservedRequestBudget:40,...policy(focus)},times=[],cooldowns=new Map(),report={quotaPolicy:policyValue};
  const context={Date:class extends Date{static now(){return now;}},bitbucketApi:()=>true,bitbucketApiRequests:0,bitbucketRequestTimes:times,report,cooldowns,BITBUCKET_ANONYMOUS_COOLDOWN_MS:62*60*1000};
  const helper=code.slice(code.indexOf('function bitbucketBudgetHold('),code.indexOf('async function inheritCooldowns('));
  const observe=new vm.Script(helper+code.slice(start,end)+';observeBitbucketBudget').runInNewContext(context);
  const page=new EventEmitter();let closed=0;page.close=async()=>{closed++;};const abort=new AbortController(),item={name:focus};observe(page,item,abort);
  for(let i=0;i<count;i++)page.emit('request',{url:()=>'/!api/2.0/test'});
  return{times,cooldowns,report,item,aborted:abort.signal.aborted,closed};
}
test('actual request observer stops the PR-only47th request without fabricating a server cooldown',()=>{
  const before=observed('bitbucket-pr-whole-context',46);assert.equal(before.aborted,false);
  const after=observed('bitbucket-pr-whole-context',47);assert.equal(after.aborted,true);assert.equal(after.closed,1);assert.equal(after.cooldowns.size,0);assert.equal(after.times.length,47);assert.equal(after.item.budgetHold.externalReserve,3);assert.equal(after.item.rateLimitedUntil,undefined);
});
test('actual ordinary request observer keeps40 with a budget hold instead of a server cooldown',()=>{
  const before=observed('bitbucket-pipeline-initial-on',39);assert.equal(before.aborted,false);
  const after=observed('bitbucket-pipeline-initial-on',40);assert.equal(after.aborted,true);assert.equal(after.cooldowns.size,0);assert.equal(after.item.budgetHold.observedLimit,40);assert.equal(after.item.rateLimitedUntil,undefined);
});
const fixture={leaves:[{start:2,end:3,title:'test'}]},source=['header','one','two'];
function sample(){return{same:true,viewedSame:true,countsSame:true,overflow:false,intent:{status:'ready'},rows:[{next:2,text:'one'},{next:3,text:'two'}],folds:[{start:2,title:'test',expanded:'false'}]};}
test('cached exemption requires fresh complete source-equal rows and one exact closed owned fold',()=>{
  assert.equal(cachedBitbucketWholeFold(sample(),fixture,source,2),true);
  for(const change of [s=>s.rows.pop(),s=>s.rows.push(s.rows[0]),s=>s.rows[0].text='wrong',s=>s.same=false,s=>s.viewedSame=false,s=>s.countsSame=false,s=>s.overflow=true,s=>s.intent.status='loading',s=>s.folds[0].title='other',s=>s.folds[0].expanded='true',s=>s.folds.push(s.folds[0])]){
    const value=sample();change(value);assert.equal(cachedBitbucketWholeFold(value,fixture,source,2),false);
  }
  assert.equal(cachedBitbucketWholeFold(sample(),fixture,source,'intent'),false);
});
