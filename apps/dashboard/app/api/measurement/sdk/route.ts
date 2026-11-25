import { loadMeasurementCode } from '@/lib/measurement-code';
/** Requested only after recorded measurement consent. Keeping this out of the client graph prevents framework preloading. */
export async function GET(): Promise<Response> {
  const code = await loadMeasurementCode();
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
