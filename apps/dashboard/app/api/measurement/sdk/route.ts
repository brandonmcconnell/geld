import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Requested only after recorded measurement consent. Keeping this out of the client graph prevents framework preloading. */
export async function GET(): Promise<Response> {
  let code: string | null = null;
  for (const path of [
    join(process.cwd(), 'node_modules/posthog-js/dist/array.js'),
    join(process.cwd(), 'apps/dashboard/node_modules/posthog-js/dist/array.js'),
  ]) {
    try {
      code = await readFile(/*turbopackIgnore: true*/ path, 'utf8');
      break;
    } catch {
      /* Standalone and workspace layouts differ. */
    }
  }
  if (!code)
    return new Response(null, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  return new Response(code, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
