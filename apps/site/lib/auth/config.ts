import 'server-only';

import { SITE_URL } from '@/lib/site';

/**
 * Sign-in configuration, read only on the server. All three values must be
 * present for sign-in to be offered; preview deployments deliberately have
 * none (an OAuth App accepts a single callback host), and the UI says so.
 */
export interface AuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Encrypts the session cookie (AES-GCM key derived from it). */
  readonly secret: string;
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

export function authConfig(): AuthConfig | null {
  // Only production can receive the OAuth callback (one callback host per App),
  // so previews never offer sign-in even if the env vars were scoped to them.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== undefined && vercelEnv !== 'production') return null;
  const clientId = nonEmpty(process.env.GITHUB_CLIENT_ID);
  const clientSecret = nonEmpty(process.env.GITHUB_CLIENT_SECRET);
  const secret = nonEmpty(process.env.AUTH_SECRET);
  if (clientId === null || clientSecret === null || secret === null) return null;
  return { clientId, clientSecret, secret };
}

/**
 * Where users land after sign-in and where cookies are judged Secure. Fixed
 * per environment, never derived from request headers: the canonical site
 * origin in production, the dev server locally.
 */
export function authOrigin(): string {
  return process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : SITE_URL;
}

/**
 * Origin of the callback URL registered on the OAuth App: `https://geld.sh/auth`
 * in production (the apex 308-redirects to www with path and query intact, so
 * the callback still reaches this app) and the second App's
 * `http://localhost:3000/auth` in development. Must match GitHub exactly.
 */
export function callbackOrigin(): string {
  return process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://geld.sh';
}

/** Callback path registered on the OAuth App. */
export const AUTH_CALLBACK_PATH = '/auth';

export function callbackUrl(): string {
  return new URL(AUTH_CALLBACK_PATH, callbackOrigin()).toString();
}
