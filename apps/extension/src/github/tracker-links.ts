import { browser } from 'wxt/browser';
import { recognizeTickets,TRACKER_LABELS,parseIssueTracker } from '@geld/core';
import type { GeldSettings,RepoConfig,IssueTrackerConfig } from '@geld/core';
import { OWN_UI_ATTRIBUTE } from './dom';
import { dashboardTrackerItem,dashboardTeamItem,dashboardSessionItem } from '../lib/dashboard-session';
let teamTracker:IssueTrackerConfig|null=null;
let started=false;
let signature='';
let latest:{settings:GeldSettings;configs:readonly RepoConfig[]}|null=null;
let lifecycle=0;
let snapshotRevision=0;
const watchers:(()=>void)[]=[];
export function removeTrackerLinks():void{
  document.getElementById('geld-links-row')?.remove();signature='';latest=null;teamTracker=null;started=false;lifecycle+=1;snapshotRevision+=1;
  for(const stop of watchers.splice(0))stop();
}
function renderLatest():void{if(latest)applyTrackerLinks(latest.settings,latest.configs);}
function startTrackerWatchers():void{
  started=true;const active=lifecycle;
  const load=async()=>{
    const revision=++snapshotRevision;
    const [value,team,session]=await Promise.all([dashboardTrackerItem.getValue(),dashboardTeamItem.getValue(),dashboardSessionItem.getValue()]);
    if(active!==lifecycle||revision!==snapshotRevision||!latest)return;
    const raw:unknown=value;
    teamTracker=raw&&typeof raw==='object'&&'userId' in raw&&'teamId' in raw&&'config' in raw&&raw.userId===session.user?.id&&raw.teamId===team&&session.teams.some(item=>item.id===team)?parseIssueTracker(raw.config):null;
    signature='';renderLatest();
  };
  const changed=()=>{if(active!==lifecycle||!latest)return;teamTracker=null;signature='';renderLatest();void load().catch(()=>undefined);};
  watchers.push(dashboardTrackerItem.watch(changed),dashboardTeamItem.watch(changed),dashboardSessionItem.watch(changed));
  void load().catch(()=>undefined);
}
export function applyTrackerLinks(settings:GeldSettings,configs:readonly RepoConfig[]):void{
  latest={settings,configs};
  const match=/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)/.exec(location.pathname);if(!match){removeTrackerLinks();return;}const owner=match[1];const repo=match[2];if(!owner||!repo)return;
  if(!started)startTrackerWatchers();
  const config=teamTracker??[...configs].reverse().find(c=>c.issueTracker)?.issueTracker??settings.issueTracker;
  const title=document.querySelector('.js-issue-title,[data-testid="issue-title"],.gh-header-title')?.textContent??'';
  const description=document.querySelector('.js-discussion .js-comment-container .markdown-body,[data-testid="issue-body"],.js-issue-body .markdown-body');
  const clean=description?.cloneNode(true);let destinations='';if(clean instanceof HTMLElement){for(const node of clean.querySelectorAll('pre,code,script,style'))node.remove();destinations=Array.from(clean.querySelectorAll<HTMLAnchorElement>('a[href]'),anchor=>anchor.href).join('\n');}
  const branch=document.querySelector('.head-ref,[data-testid="head-ref"]')?.textContent??'';
  const links=recognizeTickets(`${title}\n${clean?.textContent??''}\n${destinations}\n${branch}`,{provider:'github',host:location.hostname,owner,repo},config);
  const next=JSON.stringify(links);if(next===signature&&document.getElementById('geld-links-row'))return;signature=next;document.getElementById('geld-links-row')?.remove();if(!links.length)return;
  const anchor=document.querySelector('.gh-header-meta,[data-testid="pull-request-header"]')??document.querySelector('.gh-header');if(!anchor)return;const row=document.createElement('div');row.id='geld-links-row';row.setAttribute(OWN_UI_ATTRIBUTE,'');row.className='geld-links-row';const label=document.createElement('span');label.textContent='Links';row.append(label);for(const link of links){const a=document.createElement('a');a.href=link.url;a.rel='noreferrer';a.target='_blank';const icon=document.createElement('img');icon.className='geld-tracker-icon';icon.alt='';icon.width=16;icon.height=16;icon.src=browser.runtime.getURL(`/tracker-icons/${link.provider}.svg`);a.append(icon,`${TRACKER_LABELS[link.provider]} ${link.id}`);row.append(a);}anchor.after(row);
  void browser.runtime.sendMessage({type:'geld:tracker-status',repository:{provider:'github',host:location.hostname,owner,repo},urls:links.slice(0,20).map(link=>link.url)}).then((value:unknown)=>{if(!value||typeof value!=='object'||!('links' in value)||!Array.isArray(value.links)||!row.isConnected)return;for(const item of value.links){if(!item||typeof item!=='object'||!('url' in item)||!('status' in item)||typeof item.url!=='string'||typeof item.status!=='string')continue;const link=Array.from(row.querySelectorAll('a')).find(a=>a.href===item.url);if(link){const status=document.createElement('span');status.textContent=` · ${item.status}`;link.append(status);}}}).catch(()=>undefined);
}
