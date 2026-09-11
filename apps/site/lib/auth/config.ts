import 'server-only';

import { SITE_URL } from '@/lib/site';

/**
 * Sign-in configuration, read only on the server. All three values must be
 * present for sign-in to be offered; preview deployments deliberately have
 * none (their hostnames are random, so GitHub could never redirect back), and
 * the UI says so.
 */
export interface AuthConfig {
  /** The Geld GitHub App's client id (public). */
  readonly clientId: string;
  readonly clientSecret: string;
  /** Encrypts the session cookie (AES-GCM key derived from it). */
  readonly secret: string;
  /**
   * The retired OAuth App's credentials, kept only to revoke the tokens it
   * issued when their owners reconnect through the App or sign out. Absent once
   * the migration period is over.
   */
  readonly legacy: { readonly clientId: string; readonly clientSecret: string } | null;
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

export function authConfig(): AuthConfig | null {
  // Only production can receive the callback (a fixed host is registered on the
  // App), so previews never offer sign-in even if the env vars were scoped to them.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== undefined && vercelEnv !== 'production') return null;
  const clientId = nonEmpty(process.env.GELD_APP_CLIENT_ID);
  const clientSecret = nonEmpty(process.env.GELD_APP_CLIENT_SECRET);
  const secret = nonEmpty(process.env.AUTH_SECRET);
  if (clientId === null || clientSecret === null || secret === null) return null;
  const legacyId = nonEmpty(process.env.GITHUB_CLIENT_ID);
  const legacySecret = nonEmpty(process.env.GITHUB_CLIENT_SECRET);
  const legacy = legacyId !== null && legacySecret !== null ? { clientId: legacyId, clientSecret: legacySecret } : null;
  return { clientId, clientSecret, secret, legacy };
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
 * Origin of the callback URL registered on the GitHub App: the canonical
 * `https://www.geld.sh/auth` in production and `http://localhost:3000/auth`
 * in development (both are registered; an App accepts up to ten). Must match
 * GitHub exactly.
 */
export function callbackOrigin(): string {
  return authOrigin();
}

/** Callback path registered on the GitHub App. */
export const AUTH_CALLBACK_PATH = '/auth';

export function callbackUrl(): string {
  return new URL(AUTH_CALLBACK_PATH, callbackOrigin()).toString();
}
