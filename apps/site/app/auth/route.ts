import { fetchGitHubProfile, OAUTH_SCOPE } from '@geld/core';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { authConfig, authOrigin, callbackUrl } from '@/lib/auth/config';
import { exchangeCode } from '@/lib/auth/github';
import { DEFAULT_NEXT_PATH, safeNextPath } from '@/lib/auth/redirect';
import { clearOAuthState, readOAuthState, writeSession } from '@/lib/auth/session';

/**
 * OAuth callback (the App's registered callback URL). Verifies `state`,
 * exchanges the code server-side, looks up the profile and stores everything
 * in the encrypted session cookie. Failures land on /settings with a reason.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Always request-time: nothing here may be prerendered, even when sign-in is unconfigured.
  await connection();
  const origin = authOrigin();
  const failed = (reason: 'denied' | 'state' | 'exchange' | 'unconfigured'): NextResponse => {
    const url = new URL(DEFAULT_NEXT_PATH, origin);
    url.searchParams.set('auth', reason);
    return NextResponse.redirect(url, 303);
  };

  const config = authConfig();
  if (config === null) return failed('unconfigured');

  const store = await cookies();
  const expected = readOAuthState(store);
  clearOAuthState(store);

  const params = request.nextUrl.searchParams;
  if (params.get('error') !== null) return failed(params.get('error') === 'access_denied' ? 'denied' : 'exchange');

  const state = params.get('state');
  const code = params.get('code');
  if (expected === null || state === null || code === null || state !== expected.state) return failed('state');

  // Must be byte-for-byte the redirect_uri used in the authorize request.
  const exchange = await exchangeCode(config, code, callbackUrl());
  if (!exchange.ok) return failed('exchange');
  if (!exchange.scope.split(',').map((scope) => scope.trim()).includes(OAUTH_SCOPE)) return failed('exchange');

  const profile = await fetchGitHubProfile(exchange.token).catch(() => null);
  if (profile === null) return failed('exchange');

  await writeSession(store, config, { token: exchange.token, login: profile.login, avatarUrl: profile.avatarUrl });
  return NextResponse.redirect(new URL(safeNextPath(expected.next), origin), 303);
}
