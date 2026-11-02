import 'server-only';
import {sso} from '@better-auth/sso';
import type {SSOUserResolution} from '@better-auth/sso';
import {encryptCredential,decryptCredential} from './crypto';
import {database} from './db';
export const encryptedAuthField={input:async(value:unknown)=>typeof value==='string'?encryptCredential(value):null,output:async(value:unknown)=>typeof value==='string'?decryptCredential(value):null};
export async function ssoEntitled(providerId:string):Promise<boolean>{const db=database();return !!db&&(await db.query("SELECT t.provider_id FROM team_sso_providers t JOIN subscriptions s ON s.team_id=t.team_id WHERE t.provider_id=$1 AND s.tier IN('business','enterprise') AND s.status IN('active','trialing')",[providerId])).rows.length>0;}
export function geldSso(){
 const plugin=sso({domainVerification:{enabled:true,tokenPrefix:'geld-sso'},providersLimit:5,disableImplicitSignUp:false,trustEmailVerified:false,resolveUser:async(input):Promise<SSOUserResolution>=>{if(input.protocol!=='oidc'||!input.providerUser.emailVerified||!await ssoEntitled(input.providerId))return{action:'reject',code:'SSO_UNAVAILABLE',message:'This verified SSO connection is not available'};return{action:'continue'};}});
 const oidc=plugin.schema.ssoProvider.fields.oidcConfig;const saml=plugin.schema.ssoProvider.fields.samlConfig;if(!oidc||!saml)throw new Error('SSO schema is unavailable');
 return{...plugin,schema:{...plugin.schema,ssoProvider:{...plugin.schema.ssoProvider,fields:{...plugin.schema.ssoProvider.fields,oidcConfig:{...oidc,transform:encryptedAuthField},samlConfig:{...saml,transform:encryptedAuthField}}}}};
}
