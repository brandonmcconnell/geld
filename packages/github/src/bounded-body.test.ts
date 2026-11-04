import { describe, expect, it } from 'vitest';
import { boundedBody } from './bounded-body';
describe('provider response bounds', () => {
  it('rejects an advertised oversized response before reading and a chunked response as soon as the byte limit is exceeded', async () => {
    let canceled = 0;
    const advertised = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          canceled++;
        },
      }),
      { headers: { 'content-length': '1000' } },
    );
    expect(await boundedBody(advertised, 10, new AbortController().signal)).toBeNull();
    expect(canceled).toBe(1);
    const chunks = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('αβ'));
          controller.enqueue(new TextEncoder().encode('γδ'));
        },
        cancel() {
          canceled++;
        },
      }),
    );
    expect(await boundedBody(chunks, 6, new AbortController().signal)).toBeNull();
    expect(canceled).toBe(2);
  });
  it('cancels a stalled body on abort and decodes split UTF-8 sequences', async () => {
    const abort = new AbortController();
    const pending = boundedBody(new Response(new ReadableStream()), 10, abort.signal);
    abort.abort();
    expect(await pending).toBeNull();
    const text = new TextEncoder().encode('αβ');
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(text.slice(0, 1));
          controller.enqueue(text.slice(1));
          controller.close();
        },
      }),
    );
    expect(await boundedBody(response, 4, new AbortController().signal)).toBe('αβ');
  });
});
