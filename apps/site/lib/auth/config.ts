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
 * The origin the OAuth App redirects back to. Fixed per environment, never
 * derived from request headers: production is geld.sh, local development is
 * the second OAuth App's http://localhost:3000.
 */
export function authOrigin(): string {
  return process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : SITE_URL;
}

/** Callback path registered on the OAuth App. */
export const AUTH_CALLBACK_PATH = '/auth';
