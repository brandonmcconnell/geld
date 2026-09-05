import { cookies } from 'next/headers';
import { connection, NextResponse } from 'next/server';

import { authOrigin } from '@/lib/auth/config';
import { clearSession } from '@/lib/auth/session';

/**
 * GitHub answered 401 (token revoked or expired) while rendering a page.
 * Pages cannot modify cookies, so they redirect here to clear the session and
 * bounce to /settings with the "signed out" notice.
 */
export async function GET(): Promise<NextResponse> {
  // Always request-time: nothing here may be prerendered, even when sign-in is unconfigured.
  await connection();
  clearSession(await cookies());
  const url = new URL('/settings', authOrigin());
  url.searchParams.set('auth', 'signed-out');
  return NextResponse.redirect(url, 303);
}
