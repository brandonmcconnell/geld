import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {featureFlags,localFeatureFlags} from './features';
describe('release flags',()=>{
 it('defaults off and ignores unknown capabilities',()=>{expect(localFeatureFlags(undefined)).toEqual({projects:false,roadmaps:false});expect(localFeatureFlags('{"projects":true,"initiatives":true}')).toEqual({projects:true,roadmaps:false});expect(localFeatureFlags('{"projects":"true"}')).toEqual({projects:false,roadmaps:false});});
 it('evaluates the local snapshot without measurement, cookies or network',async()=>{vi.stubEnv('GELD_FEATURE_FLAGS','{"projects":true}');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect(await featureFlags()).toEqual({projects:true,roadmaps:false});expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.unstubAllEnvs();});
});
