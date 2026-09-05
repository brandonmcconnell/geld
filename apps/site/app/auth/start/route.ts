import { OAUTH_SCOPE } from '@geld/core';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { AUTH_CALLBACK_PATH, authConfig, authOrigin } from '@/lib/auth/config';
import { randomToken } from '@/lib/auth/crypto';
import { authorizeUrl } from '@/lib/auth/github';
import { safeNextPath } from '@/lib/auth/redirect';
import { writeOAuthState } from '@/lib/auth/session';

/**
 * Step one of the GitHub web flow: remember a random `state` (and where to go
 * afterwards) in a short-lived cookie, then send the browser to GitHub.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Always request-time: nothing here may be prerendered, even when sign-in is unconfigured.
  await connection();
  const config = authConfig();
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  if (config === null) {
    // The settings page explains that sign-in is not configured here.
    return NextResponse.redirect(new URL(next, authOrigin()), 303);
  }
  const state = randomToken();
  writeOAuthState(await cookies(), { state, next });
  const redirectUri = new URL(AUTH_CALLBACK_PATH, authOrigin()).toString();
  return NextResponse.redirect(authorizeUrl(config, redirectUri, state, OAUTH_SCOPE), 303);
}
