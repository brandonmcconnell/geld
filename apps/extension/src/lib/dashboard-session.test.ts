import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({values:new Map<string,unknown>(),allowed:true}));
vi.mock('wxt/browser',()=>({browser:{permissions:{contains:async()=>state.allowed}}}));
vi.mock('wxt/utils/storage',()=>({storage:{defineItem:(key:string,options:{fallback:unknown})=>({getValue:async()=>state.values.get(key)??options.fallback,setValue:async(value:unknown)=>{state.values.set(key,value);}})}}));
import { refreshDashboardSession,selectDashboardTeam } from './dashboard-session';
beforeEach(()=>{state.values.clear();state.allowed=true;vi.unstubAllGlobals();});
const session={user:{id:'u',name:'User'},teams:[{id:'t',name:'Team'}]};
const config={provider:'linear',keys:['ENG'],workspace:'acme'};
describe('dashboard tracker cache scope',()=>{
  it('clears the cached team tracker in personal view and on membership loss',async()=>{
    const fetcher=vi.fn(async()=>Response.json(session));vi.stubGlobal('fetch',fetcher);
    state.values.set('local:dashboardTracker',{userId:'u',teamId:'t',config});
    await refreshDashboardSession();expect(state.values.get('local:dashboardTracker')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
    state.values.set('local:dashboardTeam','removed');state.values.set('local:dashboardTracker',{userId:'u',teamId:'removed',config});
    await refreshDashboardSession();expect(state.values.get('local:dashboardTracker')).toBeNull();expect(state.values.get('local:dashboardTeam')).toBe('');
  });
  it('ignores an in-flight tracker response after switching to personal view',async()=>{
    state.values.set('local:dashboardTeam','t');
    let finish:(value:Response)=>void=()=>undefined;
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json(session)).mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
    const pending=refreshDashboardSession();await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
    await selectDashboardTeam('');finish(Response.json({config}));await pending;
    expect(state.values.get('local:dashboardTracker')).toBeNull();
  });
  it('stores credentials-free configuration bound to the confirmed user and team',async()=>{
    state.values.set('local:dashboardTeam','t');vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(Response.json({config})));
    await refreshDashboardSession();expect(state.values.get('local:dashboardTracker')).toEqual({userId:'u',teamId:'t',config});
  });
});
