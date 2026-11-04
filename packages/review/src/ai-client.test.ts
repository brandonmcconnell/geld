import { describe, expect, it, vi } from 'vitest';
import { completeChat, joinUrl, listModels } from './ai-client';
import { evaluateJev } from './jev';

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

  it('reaches every gateway preset at its OpenAI path', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['https://openrouter.ai/api', 'https://openrouter.ai/api/v1/chat/completions'],
      ['https://api.cloudflare.com/client/v4/accounts/abc123/ai', 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1/chat/completions'],
      ['https://bedrock-mantle.us-east-1.api.aws', 'https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions'],
      ['https://acme.openai.azure.com/openai', 'https://acme.openai.azure.com/openai/v1/chat/completions'],
      ['https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
      ['https://generativelanguage.googleapis.com/v1beta/openai/', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
      ['https://api.groq.com/openai', 'https://api.groq.com/openai/v1/chat/completions'],
      ['https://api.deepinfra.com/v1/openai', 'https://api.deepinfra.com/v1/openai/chat/completions'],
      ['http://localhost:11434', 'http://localhost:11434/v1/chat/completions'],
    ];
    for (const [base, url] of cases) expect(joinUrl(base, '/v1/chat/completions')).toBe(url);
    expect(joinUrl('https://generativelanguage.googleapis.com/v1beta/openai', '/v1/models')).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
    expect(joinUrl('https://ai-gateway.vercel.sh', '/typesafe/v1/systemone')).toBe('https://ai-gateway.vercel.sh/typesafe/v1/systemone');
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

/** Fails as Chrome's native fetch does when called as a method of another object. */
function nativeLikeFetch(answer: unknown): (this: unknown, input: string, init?: RequestInit) => Promise<Response> {
  return function (this: unknown) {
    if (this !== undefined && this !== globalThis) return Promise.reject(new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation"));
    return Promise.resolve(Response.json(answer));
  };
}

it('calls the given fetch on its own, as a browser requires of its native fetch', async () => {
  expect(
    await completeChat({
      fetch: nativeLikeFetch({ model: 'fixture', choices: [{ message: { content: '{"tldr":"ok"}' } }] }),
      baseUrl: 'https://ai-gateway.vercel.sh',
      apiKey: 'synthetic',
      model: 'fixture',
      messages: [{ role: 'user', content: 'Fixture' }],
    }),
  ).toEqual({ ok: true, text: '{"tldr":"ok"}', model: 'fixture' });
  expect(
    await evaluateJev({
      fetch: nativeLikeFetch({ model: 'jev', answers: { a: { type: 'noul', noul: 0.9 } } }),
      baseUrl: 'https://api.typesafe.ai',
      apiKey: 'synthetic',
      request: { model: 'jev-latest', state: 'Fixture', questions: { a: { type: 'noul', instructions: 'Yes?' } } },
    }),
  ).toEqual({ ok: true, model: 'jev', answers: { a: { type: 'noul', noul: 0.9 } } });
});
