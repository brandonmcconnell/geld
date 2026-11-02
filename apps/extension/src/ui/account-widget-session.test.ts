// @vitest-environment happy-dom
import { beforeEach,describe,expect,it,vi } from 'vitest';
type TestSession={user:{id:string;name:string;image:null}|null;teams:{id:string;name:string}[]};
const state=vi.hoisted(()=>({refresh:vi.fn(async()=>undefined),connect:vi.fn(async()=>undefined),listener:(_value:TestSession):void=>undefined,signedIn:false}));
vi.mock('wxt/browser',()=>({browser:{runtime:{sendMessage:async()=>({ok:true})},tabs:{create:async()=>undefined}}}));
vi.mock('../lib/dashboard-session',()=>({DASHBOARD_ORIGIN:'https://app.geld.sh',refreshDashboardSession:state.refresh,connectDashboard:state.connect,selectDashboardTeam:async()=>undefined,dashboardSessionItem:{getValue:async()=>({user:null,teams:[]}),watch:(listener:(value:TestSession)=>void)=>{state.listener=listener;return()=>undefined;}},dashboardTeamItem:{getValue:async()=>'',watch:()=>()=>undefined}}));
vi.mock('../lib/account',()=>({EMPTY_SYNC_STATE:{pendingChoice:null},accountItem:{getValue:async()=>null,watch:()=>()=>undefined},authFlowItem:{getValue:async()=>({status:'idle'}),watch:()=>()=>undefined},syncStateItem:{getValue:async()=>({pendingChoice:null}),watch:()=>()=>undefined}}));
import { mountAccountWidget } from './account-widget';
beforeEach(()=>{state.refresh.mockClear();state.connect.mockClear();state.signedIn=false;state.refresh.mockImplementation(async()=>{if(state.signedIn)state.listener({user:{id:'u',name:'User',image:null},teams:[{id:'t',name:'Team'}]});});document.body.replaceChildren();});
describe('returning from Geld sign-in',()=>{
  it('refreshes the mounted widget on focus and removes the listener on close',async()=>{
    const host=document.createElement('div');document.body.append(host);
    const close=mountAccountWidget(host,{variant:'full'});
    try {
      await vi.waitFor(()=>expect(state.refresh).toHaveBeenCalledTimes(1));
      const signIn=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Sign in to Geld');if(!signIn)throw new Error('Missing sign-in');
      signIn.click();await vi.waitFor(()=>expect(state.connect).toHaveBeenCalledTimes(1));
      state.signedIn=true;window.dispatchEvent(new Event('focus'));expect(state.refresh).toHaveBeenCalledTimes(2);expect(host.querySelector('select[aria-label="Geld team"]')?.textContent).toContain('Team');
      close();window.dispatchEvent(new Event('focus'));expect(state.refresh).toHaveBeenCalledTimes(2);
    } finally {close();}
  });
});
