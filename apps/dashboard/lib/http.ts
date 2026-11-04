import { dashboardOrigin } from './env';
export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin === dashboardOrigin();
}

/** Bounds transient JSON processing, including chunked bodies without Content-Length. */
export async function readJson(request: Request, limit = 1_000_000): Promise<unknown> {
  const text = await readText(request, limit);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
export async function readText(request: Request, limit = 1_000_000): Promise<string | null> {
  if (request.signal.aborted) return null;
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  let canceled = false;
  const stop = () => {
    canceled = true;
    void reader.cancel().catch(() => undefined);
  };
  const timer = setTimeout(stop, 15000);
  request.signal.addEventListener('abort', stop, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        stop();
        return null;
      }
      parts.push(chunk.value);
    }
    if (canceled) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', stop);
    reader.releaseLock();
  }
}
