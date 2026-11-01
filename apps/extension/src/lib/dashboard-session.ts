import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { parseIssueTracker } from '@geld/core';
import type { IssueTrackerConfig } from '@geld/core';
export const DASHBOARD_ORIGIN='https://app.geld.sh';
export interface DashboardUser{readonly id:string;readonly name:string;readonly image:string|null}
export interface DashboardSession{readonly user:DashboardUser|null;readonly teams:readonly {id:string;name:string}[]}
export const dashboardSessionItem=storage.defineItem<DashboardSession>('local:dashboardSession',{fallback:{user:null,teams:[]}});
export const dashboardTeamItem=storage.defineItem<string>('local:dashboardTeam',{fallback:''});
export const dashboardTrackerItem=storage.defineItem<IssueTrackerConfig|null>('local:dashboardTracker',{fallback:null});
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export async function connectDashboard():Promise<void>{const allowed=await browser.permissions.request({origins:[`${DASHBOARD_ORIGIN}/*`]});if(!allowed)return;await browser.tabs.create({url:`${DASHBOARD_ORIGIN}/sign-in`});}
export async function refreshDashboardSession():Promise<void>{if(!await browser.permissions.contains({origins:[`${DASHBOARD_ORIGIN}/*`]}))return;try{const response=await fetch(`${DASHBOARD_ORIGIN}/api/extension/session`,{credentials:'include',redirect:'error',cache:'no-store'});if(!response.ok)return;const data:unknown=await response.json();if(!record(data))return;let user:DashboardUser|null=null;if(record(data.user)&&typeof data.user.id==='string'&&typeof data.user.name==='string')user={id:data.user.id,name:data.user.name,image:typeof data.user.image==='string'?data.user.image:null};const teams:{id:string;name:string}[]=[];if(Array.isArray(data.teams))for(const t of data.teams)if(record(t)&&typeof t.id==='string'&&typeof t.name==='string')teams.push({id:t.id,name:t.name});await dashboardSessionItem.setValue({user,teams});if(!user){await dashboardTrackerItem.setValue(null);return;}const selected=await dashboardTeamItem.getValue();if(selected&&!teams.some(t=>t.id===selected))await dashboardTeamItem.setValue('');if(selected&&teams.some(t=>t.id===selected)){const r=await fetch(`${DASHBOARD_ORIGIN}/api/tracker?team=${encodeURIComponent(selected)}`,{credentials:'include',redirect:'error'});const v:unknown=await r.json();await dashboardTrackerItem.setValue(record(v)?parseIssueTracker(v.config):null);}}catch{/* Offline keeps local links available. */}}
