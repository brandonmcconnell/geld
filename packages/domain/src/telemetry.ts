import {z} from 'zod';
export const measurementTarget=z.enum(['primary-nav','queue-filter','queue-row','guide','review-step','review-submit','assistant','provider-connect','billing-plan','team-access','privacy-settings']);
export const featureName=z.enum(['guide','assistant','review','connections','billing','team-access','trackers','models','enterprise','consolidation']);
export function normalisedRoute(pathname:string):string{
 const path=pathname.split('?')[0]??'/';
 if(new Set(['/:page','/:provider/:owner/:repo/pull/:number','/:provider/:resource/~settings','/:provider/:resource','/teams/:team/settings','/teams/:team']).has(path))return path;
 if(/^\/(github|gitlab|bitbucket)\//.test(path)||path.startsWith('/ghe/'))return /\/pull\/\d+(?:\/|$)/.test(path)?'/:provider/:owner/:repo/pull/:number':path.endsWith('/~settings')?'/:provider/:resource/~settings':'/:provider/:resource';
 if(/^\/teams\/[^/]+/.test(path))return path.endsWith('/settings')?'/teams/:team/settings':'/teams/:team';
 const known=new Set(['/','/connect','/sign-in','/inbox','/repositories','/teams','/projects','/roadmap','/privacy','/settings','/settings/account','/settings/account/reset-password','/settings/review','/settings/providers','/settings/models','/settings/billing','/settings/security','/settings/enterprise']);
 return known.has(path)?path:'/:page';
}
