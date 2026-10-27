import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { ISSUES_URL } from '@/lib/site';

/**
 * Where feedback goes. The extension links here rather than to GitHub, so the
 * destination can change (a form on this site, a private tracker) without a
 * store release. Today it is a new issue on the public repository, its form
 * fields filled from the query the extension sends: `version`, `browser`,
 * `page` and `what`; anything else is dropped.
 */
const FIELDS = ['what', 'version', 'browser', 'page'] as const;
const MAX_FIELD_LENGTH = 500;

export async function GET(request: NextRequest): Promise<NextResponse> {
  await connection();
  const target = new URL(`${ISSUES_URL}/new`);
  target.searchParams.set('template', 'feedback.yml');
  for (const field of FIELDS) {
    const value = request.nextUrl.searchParams.get(field)?.trim().slice(0, MAX_FIELD_LENGTH) ?? '';
    if (value !== '') target.searchParams.set(field, value);
  }
  return NextResponse.redirect(target, 303);
}
