import { cookies } from 'next/headers';
import { connection, NextResponse } from 'next/server';

import { authConfig, authOrigin } from '@/lib/auth/config';
import { revokeToken } from '@/lib/auth/github';
import { clearSession, getSession } from '@/lib/auth/session';

/**
 * Sign out: drop the cookies and, best-effort, revoke the token at GitHub so
 * it cannot be used even if the cookie value were ever recovered. POST only,
 * and the session cookie is SameSite=Lax, so a cross-site form cannot trigger it.
 */
export async function POST(): Promise<NextResponse> {
  // Always request-time: nothing here may be prerendered, even when sign-in is unconfigured.
  await connection();
  const config = authConfig();
  const session = await getSession(config);
  clearSession(await cookies());
  if (config !== null && session !== null) await revokeToken(config, session.token);
  return NextResponse.redirect(new URL('/', authOrigin()), 303);
}
