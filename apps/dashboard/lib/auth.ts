import 'server-only';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import { database } from './db';
import { configured, dashboardOrigin, isPreview } from './env';
import {prepareAccountErasure} from './erasure';
import { sendEmail } from './email';

const bitbucketUser = z.object({ uuid: z.string(), display_name: z.string(), links: z.object({ avatar: z.object({ href: z.string() }) }) });
const bitbucketEmails = z.object({ values: z.array(z.object({ email: z.string().email(), is_primary: z.boolean(), is_confirmed: z.boolean() })) });

async function githubUserInfo(tokens: { readonly accessToken?: string | undefined }) {
  if (!tokens.accessToken) return null;
  const token = tokens.accessToken;
  const api = createApiTransport({ baseUrl: 'https://api.github.com/', source: { get: async () => ({ status: 'ok', token, refreshed: false }) } });
  const [profileResult, emailResult] = await Promise.all([api.request('user'), api.request('user/emails')]);
  if (!profileResult.ok || !emailResult.ok) return null;
  const profile = z.object({ id: z.number(), login: z.string(), name: z.string().nullable(), avatar_url: z.string() }).safeParse(profileResult.value);
  const emails = z.array(z.object({ email: z.string().email(), verified: z.boolean(), primary: z.boolean() })).safeParse(emailResult.value);
  if (!profile.success || !emails.success) return null;
  const verified = emails.data.filter((entry) => entry.verified);
  const selected = verified.find((entry) => entry.primary) ?? verified[0];
  if (!selected) return null;
  return { id: String(profile.data.id), name: profile.data.name ?? profile.data.login, email: selected.email, emailVerified: true, image: profile.data.avatar_url };
}
function githubSubject({ profile }: { readonly profile: Record<string, unknown> }): string {
  if (typeof profile.id !== 'string') throw new Error('Invalid GitHub identity');
  return profile.id;
}
function createAuth() {
  const db = database();
  const secret = configured(process.env.BETTER_AUTH_SECRET);
  if (!db || !secret || secret.length < 32 || isPreview()) return null;
  const githubId = configured(process.env.GITHUB_IDENTITY_CLIENT_ID);
  const githubSecret = configured(process.env.GITHUB_IDENTITY_CLIENT_SECRET);
  const gitlabId = configured(process.env.GITLAB_CLIENT_ID);
  const gitlabSecret = configured(process.env.GITLAB_CLIENT_SECRET);
  const bitbucketId = configured(process.env.BITBUCKET_CLIENT_ID);
  const bitbucketSecret = configured(process.env.BITBUCKET_CLIENT_SECRET);
  const repositoryId = configured(process.env.GITHUB_REPOSITORY_CLIENT_ID);
  const repositorySecret = configured(process.env.GITHUB_REPOSITORY_CLIENT_SECRET);
  const oauthId = configured(process.env.GITHUB_OAUTH_CLIENT_ID);
  const oauthSecret = configured(process.env.GITHUB_OAUTH_CLIENT_SECRET);
  const origin = dashboardOrigin();
  const shareCookie = new URL(origin).hostname.endsWith('.geld.sh');
  return betterAuth({
    appName: 'Geld', database: db, secret, baseURL: origin,
    trustedOrigins: shareCookie ? [origin, 'https://www.geld.sh'] : [origin],
    user: { modelName: 'users', changeEmail: { enabled: true }, deleteUser: { enabled: true, beforeDelete:async user=>prepareAccountErasure(user.id), sendDeleteAccountVerification: async ({ user, url }) => sendEmail(user.email, 'Delete your Geld account', `Confirm account deletion: ${url}`) } },
    session: { modelName: 'sessions', cookieCache: { enabled: false } },
    account: { modelName: 'identities', encryptOAuthTokens: true, accountLinking: { enabled: true, allowDifferentEmails: false, trustedProviders: [] } },
    verification: { modelName: 'verifications' },
    emailAndPassword: { enabled: true, minPasswordLength: 12, requireEmailVerification: true, sendResetPassword: async ({ user, url }) => sendEmail(user.email, 'Set your Geld password', `Set or reset your password: ${url}`) },
    emailVerification: { sendVerificationEmail: async ({ user, url }) => sendEmail(user.email, 'Verify your Geld email', `Verify your email: ${url}`) },
    socialProviders: {
      ...(githubId && githubSecret ? { github: { clientId: githubId, clientSecret: githubSecret, scope: ['read:user', 'user:email', 'gist'] } } : {}),
      ...(gitlabId && gitlabSecret ? { gitlab: { clientId: gitlabId, clientSecret: gitlabSecret, scope: ['read_user', 'api'] } } : {}),
    },
    advanced: { cookiePrefix: 'geld', ipAddress: { disableIpTracking: true }, crossSubDomainCookies: { enabled: shareCookie, ...(shareCookie ? { domain: '.geld.sh' } : {}) } },
    rateLimit: { enabled: true, storage: 'database' },
    databaseHooks: { session: { create: { before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }) } } },
    logger: { disabled: true },
    plugins: [
      emailOTP({ storeOTP: 'hashed', allowedAttempts: 3, changeEmail: { enabled: true, verifyCurrentEmail: true }, sendVerificationOTP: async ({ email, otp }) => sendEmail(email, 'Your Geld sign-in code', `Your one-time code is ${otp}. It expires in five minutes.`) }),
      magicLink({ storeToken: 'hashed', sendMagicLink: async ({ email, url }) => sendEmail(email, 'Sign in to Geld', `Sign in using this link: ${url}`) }),
      genericOAuth({ config: [
        ...(bitbucketId && bitbucketSecret ? [{ providerId: 'bitbucket', name: 'Bitbucket', clientId: bitbucketId, clientSecret: bitbucketSecret, authorizationUrl: 'https://bitbucket.org/site/oauth2/authorize', tokenUrl: 'https://bitbucket.org/site/oauth2/access_token', authentication: 'basic', pkce: false, scopes: ['account', 'email', 'repository', 'pullrequest:write'], accountSubject: ({ profile }: { profile: Record<string, unknown> }) => { const p = bitbucketUser.parse(profile); return p.uuid; }, getUserInfo: async (tokens: { accessToken?: string | undefined }) => {
          if (!tokens.accessToken) return null;
          const token=tokens.accessToken;
          const api=createApiTransport({baseUrl:'https://api.bitbucket.org/2.0/',source:{get:async()=>({status:'ok',token,refreshed:false})}});
          const [profileResult,emailsResult]=await Promise.all([api.request('user'),api.request('user/emails')]);
          if(!profileResult.ok||!emailsResult.ok)return null;
          const profile=bitbucketUser.safeParse(profileResult.value);
          const emails=bitbucketEmails.safeParse(emailsResult.value);
          if (!profile.success || !emails.success) return null;
          const verified = emails.data.values.filter((email) => email.is_confirmed);
          const email = verified.find((entry) => entry.is_primary) ?? verified[0];
          if (!email) return null;
          return { ...profile.data, id: profile.data.uuid, name: profile.data.display_name, email: email.email, emailVerified: true, image: profile.data.links.avatar.href };
        } } satisfies GenericOAuthConfig] : []),
        ...(repositoryId && repositorySecret ? [{ providerId: 'github-repository', name: 'GitHub repositories', clientId: repositoryId, clientSecret: repositorySecret, authorizationUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scopes: [], accountSubject: githubSubject, getUserInfo: githubUserInfo } satisfies GenericOAuthConfig] : []),
        ...(oauthId && oauthSecret ? [{ providerId: 'github-oauth', name: 'GitHub OAuth', clientId: oauthId, clientSecret: oauthSecret, authorizationUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scopes: ['repo', 'user:email'], accountSubject: githubSubject, getUserInfo: githubUserInfo } satisfies GenericOAuthConfig] : []),
      ] }),
      nextCookies(),
    ],
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  auth ??= createAuth();
  return auth;
}
