import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { textDeltas } from './ai-stream';
async function read(response: Response) { let result = ''; for await (const text of textDeltas(response)) result += text; return result; }
describe('assistant stream boundaries', () => {
  it('reads compatible text deltas without leaking metadata', async () => {
    const response = new Response('data: {"choices":[{"delta":{"content":"Hello"}}],"ignored":"private metadata"}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n');
    expect(await read(response)).toBe('Hello world');
  });
  it('treats a truncated stream as a failure for metering', async () => {
    await expect(read(new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'))).rejects.toThrow('before completion');
  });
});
