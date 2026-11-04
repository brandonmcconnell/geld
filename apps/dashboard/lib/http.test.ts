import { describe, expect, it } from 'vitest';
import { readJson } from './http';
describe('transient request bounds', () => {
  it('rejects oversized declared and streamed JSON and malformed UTF-8', async () => {
    expect(
      await readJson(
        new Request('https://dashboard.example', {
          method: 'POST',
          headers: { 'content-length': '1000' },
          body: '{}',
        }),
        10,
      ),
    ).toBeNull();
    expect(
      await readJson(
        new Request('https://dashboard.example', {
          method: 'POST',
          body: JSON.stringify({ text: 'α'.repeat(10) }),
        }),
        12,
      ),
    ).toBeNull();
    expect(
      await readJson(
        new Request('https://dashboard.example', {
          method: 'POST',
          body: new Uint8Array([0xff]),
        }),
      ),
    ).toBeNull();
  });
  it('parses a bounded body without retaining it and refuses an already aborted request', async () => {
    expect(
      await readJson(
        new Request('https://dashboard.example', {
          method: 'POST',
          body: '{"action":"save"}',
        }),
      ),
    ).toEqual({ action: 'save' });
    const abort = new AbortController();
    abort.abort();
    expect(
      await readJson(
        new Request('https://dashboard.example', {
          method: 'POST',
          signal: abort.signal,
          body: '{}',
        }),
      ),
    ).toBeNull();
  });
});
