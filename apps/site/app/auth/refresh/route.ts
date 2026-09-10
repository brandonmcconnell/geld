import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { authConfig, authOrigin } from '@/lib/auth/config';
import { safeNextPath } from '@/lib/auth/redirect';
import { resolveSession } from '@/lib/auth/session';

/**
 * Renew an expiring App token and go back where the user was. Pages cannot
 * write cookies, so when one finds the token about to expire it redirects
 * here; the refreshed pair is written and the page loads again. A refused
 * refresh clears the session (→ "signed out" notice); an unreachable GitHub
 * leaves it in place and says so, so the page does not bounce back here.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Always request-time: nothing here may be prerendered, even when sign-in is unconfigured.
  await connection();
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const target = new URL(next, authOrigin());
  const access = await resolveSession(authConfig(), await cookies());
  switch (access.status) {
    case 'ok':
    case 'stale': // cannot happen with a writable store; treated as fresh enough
      return NextResponse.redirect(target, 303);
    case 'none':
    case 'expired':
      target.searchParams.set('auth', 'signed-out');
      return NextResponse.redirect(target, 303);
    case 'unavailable':
      target.searchParams.set('auth', 'unavailable');
      return NextResponse.redirect(target, 303);
  }
}
