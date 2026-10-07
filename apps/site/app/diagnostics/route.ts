import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { ISSUES_URL } from '@/lib/site';

/**
 * Where a diagnostics report goes: the extension's "Report with diagnostics"
 * links here, as the Feedback link does to `/feedback`, so the destination
 * can change without a store release. Today it is a new issue on the public
 * repository from the `diagnostics.yml` form, its fields filled from the
 * query: `version`, `browser` and the `diagnostics` text itself, which is
 * long (the extension trims it to what a URL carries and keeps the whole
 * report on the clipboard). Anything else is dropped.
 */
const SHORT_FIELDS = ['version', 'browser'] as const;
const MAX_SHORT_FIELD_LENGTH = 500;
/** Generous: the extension trims to ~6 KB encoded before linking here, and GitHub's own limit is higher still. */
const MAX_DIAGNOSTICS_LENGTH = 12_000;

export async function GET(request: NextRequest): Promise<NextResponse> {
  await connection();
  const target = new URL(`${ISSUES_URL}/new`);
  target.searchParams.set('template', 'diagnostics.yml');
  for (const field of SHORT_FIELDS) {
    const value = request.nextUrl.searchParams.get(field)?.trim().slice(0, MAX_SHORT_FIELD_LENGTH) ?? '';
    if (value !== '') target.searchParams.set(field, value);
  }
  const diagnostics = request.nextUrl.searchParams.get('diagnostics')?.trim().slice(0, MAX_DIAGNOSTICS_LENGTH) ?? '';
  if (diagnostics !== '') target.searchParams.set('diagnostics', diagnostics);
  return NextResponse.redirect(target, 303);
}
