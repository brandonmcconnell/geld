import { describe, expect, it, vi } from 'vitest';
import { completeChat, joinUrl, listModels } from './ai-client';

describe('ai-client', () => {
  it('does not call the network without a key', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('must not fetch');
    };
    expect(await listModels(fetchImpl, 'https://api.openai.com', '')).toEqual({
      ok: false,
      reason: 'No API key.',
    });
    expect(
      await completeChat({
        fetch: fetchImpl,
        baseUrl: 'https://api.openai.com',
        apiKey: '',
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).toEqual({ ok: false, reason: 'No API key.' });
  });

  it('folds a trailing /v1 into the path (Vercel AI Gateway style base URLs)', () => {
    expect(joinUrl('https://ai-gateway.vercel.sh/v1', '/v1/models')).toBe('https://ai-gateway.vercel.sh/v1/models');
    expect(joinUrl('https://api.openai.com/', 'v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('lists model ids from /v1/models', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe('https://api.openai.com/v1/models');
      return new Response(
        JSON.stringify({
          data: [{ id: 'gpt-4.1-mini' }, { id: '' }, { nope: true }],
        }),
      );
    };
    expect(await listModels(fetchImpl, 'https://api.openai.com/', 'sk-test')).toEqual({
      ok: true,
      models: [{ id: 'gpt-4.1-mini' }],
    });
  });
});

it('propagates cancellation and replaces raw transport errors with safe provider failures', async () => {
  const abort = new AbortController();
  abort.abort();
  let signal: AbortSignal | null | undefined;
  const result = await completeChat({
    fetch: async (_url, init) => {
      signal = init?.signal;
      throw new Error('private transport detail synthetic-key');
    },
    baseUrl: 'https://api.openai.com',
    apiKey: 'synthetic',
    model: 'fixture-model',
    messages: [],
    signal: abort.signal,
  });
  expect(signal?.aborted).toBe(true);
  expect(result).toEqual({
    ok: false,
    reason: 'The AI provider could not complete the request.',
  });
});

it('bounds an unavailable model catalog while a healthy catalog returns normally', async () => {
  const abort = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
  try {
    const offline = listModels(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Discovery timed out')), { once: true });
        }),
      'https://offline.example',
      'synthetic',
    );
    expect(
      await listModels(
        async () => Response.json({ data: [{ id: 'working' }] }),
        'https://healthy.example',
        'synthetic',
      ),
    ).toEqual({ ok: true, models: [{ id: 'working' }] });
    expect(timeout).toHaveBeenCalledWith(15000);
    abort.abort();
    expect((await offline).ok).toBe(false);
  } finally {
    timeout.mockRestore();
  }
});
it('combines caller cancellation with the completion deadline', async () => {
  const abort = new AbortController();
  let entered: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const result = completeChat({
    apiKey: 'synthetic',
    baseUrl: 'https://companion.example',
    model: 'fixture',
    messages: [{ role: 'user', content: 'Fixture' }],
    timeoutMs: 120000,
    signal: abort.signal,
    fetch: async (_url, init) => {
      entered();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Caller canceled')), { once: true });
      });
    },
  });
  await ready;
  abort.abort();
  expect(await result).toEqual({ ok: false, reason: 'The AI provider could not complete the request.' });
});
