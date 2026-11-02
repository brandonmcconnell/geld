// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://github.com/acme/platform/pull/12"}
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_SETTINGS} from '@geld/core';
const state=vi.hoisted(():{read:()=>Promise<unknown>;team:string;session:{user:{id:string}|null;teams:{id:string}[]};watchers:Set<()=>void>;stops:number}=>({read:async()=>null,team:'t',session:{user:{id:'u'},teams:[{id:'t'}]},watchers:new Set(),stops:0}));
vi.mock('wxt/browser',()=>({browser:{runtime:{getURL:(path:string)=>`chrome-extension://test${path}`,sendMessage:async()=>({links:[]})}}}));
vi.mock('../lib/dashboard-session',()=>{
 const watch=(callback:()=>void)=>{const listener=()=>callback();state.watchers.add(listener);return()=>{state.watchers.delete(listener);state.stops+=1;};};
 return {dashboardTrackerItem:{getValue:()=>state.read(),watch},dashboardTeamItem:{getValue:async()=>state.team,watch},dashboardSessionItem:{getValue:async()=>state.session,watch}};
});
import {applyTrackerLinks,removeTrackerLinks} from './tracker-links';
beforeEach(()=>{removeTrackerLinks();state.read=async()=>null;state.team='t';state.session={user:{id:'u'},teams:[{id:'t'}]};state.stops=0;document.body.innerHTML='<header class="gh-header"><h1 class="js-issue-title">Fix #7</h1><div class="gh-header-meta">Open</div></header><div class="js-issue-body"><div class="markdown-body"><p>ENG-12</p><pre>ENG-99</pre><code>ENG-88</code></div></div>';});
afterEach(()=>removeTrackerLinks());
describe('the tracker links lifecycle',()=>{
 it('recognizes description references, excludes code and remains idempotent across DOM passes',()=>{
  const configs=[{categories:{},groups:{},categoryPatterns:{},customCategories:[],reviewBots:[],issueTracker:{provider:'linear',keys:['ENG'],workspace:'acme'}}] satisfies Parameters<typeof applyTrackerLinks>[1];
  applyTrackerLinks(DEFAULT_SETTINGS,configs);
  const row=document.getElementById('geld-links-row');expect(row?.querySelectorAll('a')).toHaveLength(2);expect(row?.textContent).toContain('ENG-12');expect(row?.textContent).not.toContain('ENG-99');expect(row?.textContent).not.toContain('ENG-88');
  applyTrackerLinks(DEFAULT_SETTINGS,configs);expect(document.querySelectorAll('#geld-links-row')).toHaveLength(1);
 });
 it('includes anchor destinations while excluding links inside code',()=>{
  document.body.innerHTML='<div class="gh-header-meta">Open</div><div class="js-issue-body"><div class="markdown-body"><a href="https://app.asana.com/0/123/456">View task</a><pre><a href="https://app.asana.com/0/123/999">Code task</a></pre></div></div>';
  applyTrackerLinks({...DEFAULT_SETTINGS,issueTracker:{provider:'asana',keys:['123']}},[]);
  const links=Array.from(document.querySelectorAll<HTMLAnchorElement>('#geld-links-row a'),link=>link.href);
  expect(links).toEqual(['https://app.asana.com/0/123/456']);
 });
 it('disposes subscriptions and ignores a pending cache read and queued callback after teardown',async()=>{
  let finish:(value:unknown)=>void=()=>undefined;
  state.read=()=>new Promise(resolve=>{finish=resolve;});
  applyTrackerLinks(DEFAULT_SETTINGS,[]);
  const queued=[...state.watchers];removeTrackerLinks();
  finish({teamId:'t',userId:'u',config:{provider:'linear',keys:['ENG'],workspace:'acme'}});
  for(const callback of queued)callback();
  await Promise.resolve();await Promise.resolve();
  expect(state.watchers.size).toBe(0);expect(state.stops).toBe(3);expect(document.getElementById('geld-links-row')).toBeNull();
 });
 it('drops a team cache in personal view and after membership loss',async()=>{
  document.querySelector('.js-issue-title')?.replaceChildren('ENG-12');
  state.read=async()=>({teamId:'t',userId:'u',config:{provider:'linear',keys:['ENG'],workspace:'acme'}});
  applyTrackerLinks(DEFAULT_SETTINGS,[]);
  await vi.waitFor(()=>expect(document.getElementById('geld-links-row')?.textContent).toContain('ENG-12'));
  state.team='';for(const listener of state.watchers)listener();
  await vi.waitFor(()=>expect(document.getElementById('geld-links-row')).toBeNull());
  state.team='t';state.session={user:{id:'u'},teams:[]};for(const listener of state.watchers)listener();
  await Promise.resolve();expect(document.getElementById('geld-links-row')).toBeNull();
 });
});
