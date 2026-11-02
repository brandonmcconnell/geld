import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { parseIssueTracker } from '@geld/core';
import type { IssueTrackerConfig } from '@geld/core';
export const DASHBOARD_ORIGIN='https://app.geld.sh';
export interface DashboardUser{readonly id:string;readonly name:string;readonly image:string|null}
export interface DashboardSession{readonly user:DashboardUser|null;readonly teams:readonly {id:string;name:string}[]}
export interface DashboardTracker{readonly userId:string;readonly teamId:string;readonly config:IssueTrackerConfig}
export const dashboardSessionItem=storage.defineItem<DashboardSession>('local:dashboardSession',{fallback:{user:null,teams:[]}});
export const dashboardTeamItem=storage.defineItem<string>('local:dashboardTeam',{fallback:''});
export const dashboardTrackerItem=storage.defineItem<DashboardTracker|null>('local:dashboardTracker',{fallback:null});
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
let refreshRevision=0;
export async function connectDashboard():Promise<void>{const allowed=await browser.permissions.request({origins:[`${DASHBOARD_ORIGIN}/*`]});if(!allowed)return;await browser.tabs.create({url:`${DASHBOARD_ORIGIN}/sign-in`});}
export async function selectDashboardTeam(teamId:string):Promise<void>{refreshRevision+=1;await dashboardTrackerItem.setValue(null);await dashboardTeamItem.setValue(teamId);}
export async function refreshDashboardSession():Promise<void>{
  const revision=++refreshRevision;
  const selected=await dashboardTeamItem.getValue();
  if(!selected)await dashboardTrackerItem.setValue(null);
  if(!await browser.permissions.contains({origins:[`${DASHBOARD_ORIGIN}/*`]})){await dashboardTrackerItem.setValue(null);return;}
  try {
    const response=await fetch(`${DASHBOARD_ORIGIN}/api/extension/session`,{credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(revision!==refreshRevision)return;
    if(!response.ok){if(response.status===401||response.status===403){await dashboardSessionItem.setValue({user:null,teams:[]});await selectDashboardTeam('');}return;}
    const data:unknown=await response.json();if(!record(data)||revision!==refreshRevision)return;
    let user:DashboardUser|null=null;
    if(record(data.user)&&typeof data.user.id==='string'&&typeof data.user.name==='string')user={id:data.user.id,name:data.user.name,image:typeof data.user.image==='string'?data.user.image:null};
    const teams:{id:string;name:string}[]=[];
    if(Array.isArray(data.teams))for(const team of data.teams)if(record(team)&&typeof team.id==='string'&&typeof team.name==='string')teams.push({id:team.id,name:team.name});
    await dashboardSessionItem.setValue({user,teams});
    if(!user||!selected||!teams.some(team=>team.id===selected)){await dashboardTrackerItem.setValue(null);if(selected)await selectDashboardTeam('');return;}
    const tracker=await fetch(`${DASHBOARD_ORIGIN}/api/tracker?team=${encodeURIComponent(selected)}`,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});
    const value:unknown=await tracker.json();
    if(revision!==refreshRevision||await dashboardTeamItem.getValue()!==selected)return;
    const current=await dashboardSessionItem.getValue();
    if(current.user?.id!==user.id||!current.teams.some(team=>team.id===selected))return;
    const config=tracker.ok&&record(value)?parseIssueTracker(value.config):null;
    await dashboardTrackerItem.setValue(config?{userId:user.id,teamId:selected,config}:null);
  }catch{/* Offline retains a previously verified team cache. */}
}
