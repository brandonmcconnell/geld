export async function GET(): Promise<Response> {
  return Response.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
}
