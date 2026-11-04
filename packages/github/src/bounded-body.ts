/** Streaming byte limits apply before decoding or JSON parsing, including when Content-Length is absent. */
export async function boundedBody(response: Response, limit: number, signal: AbortSignal): Promise<string | null> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  let canceled = signal.aborted;
  const decoder = new TextDecoder();
  const parts: string[] = [];
  const stop = () => {
    canceled = true;
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (canceled) {
      stop();
      return null;
    }
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        stop();
        return null;
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    return canceled ? null : parts.join('') + decoder.decode();
  } catch {
    return null;
  } finally {
    signal.removeEventListener('abort', stop);
    reader.releaseLock();
  }
}
