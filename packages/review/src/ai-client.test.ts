import { describe, expect, it, vi } from 'vitest';
import { completeChat, joinUrl, listModels, providerMessage, refusalKind } from './ai-client';
import type { ChatCompletionOptions } from './ai-client';
import { evaluateDecision } from './jev';

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

it('keeps the endpoints a gateway names for a model', async () => {
  const listed = await listModels(async () => Response.json({ data: [{ id: 'cloudflare/clairic', endpoints: ['/api/alpha/extractions'] }, { id: 'liquid/d1' }] }), 'https://openrouter.ai/api', 'synthetic');
  expect(listed).toEqual({ ok: true, models: [{ id: 'cloudflare/clairic', provider: 'cloudflare', endpoints: ['/api/alpha/extractions'] }, { id: 'liquid/d1', provider: 'liquid' }] });
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
    await evaluateDecision({
      fetch: nativeLikeFetch({ model: 'jev', answers: { a: { type: 'noul', noul: 0.9 } } }),
      baseUrl: 'https://api.typesafe.ai',
      apiKey: 'synthetic',
      request: { model: 'jev-latest', state: 'Fixture', questions: { a: { type: 'noul', instructions: 'Yes?' } } },
    }),
  ).toEqual({ ok: true, model: 'jev', answers: { a: { type: 'noul', noul: 0.9 } } });
});

describe('a refused completion', () => {
  const options = (fetchImpl: ChatCompletionOptions['fetch']): ChatCompletionOptions => ({
    fetch: fetchImpl,
    baseUrl: 'https://ai-gateway.vercel.sh',
    apiKey: 'sk-synthetic-secret-1234',
    model: 'anthropic/claude-sonnet-5',
    messages: [
      { role: 'system', content: 'You write titles.' },
      { role: 'user', content: '{}' },
    ],
    jsonSchema: { type: 'object', properties: { tldr: { type: 'string' } }, required: ['tldr'], additionalProperties: false },
    schemaName: 'geld_summary',
  });

  it('says what the provider said, without the key', async () => {
    const result = await completeChat(
      options(async () => Response.json({ error: { message: 'Model not found for key sk-synthetic-secret-1234', type: 'invalid_request_error' } }, { status: 404 })),
    );
    expect(result).toEqual({ ok: false, reason: 'Completion failed (404): Model not found for key <key>.', status: 404, kind: 'model' });
  });

  it('keeps to the status when the answer has no words to give', async () => {
    expect(await completeChat(options(async () => new Response('<html><body>Bad gateway</body></html>', { status: 502 })))).toEqual({ ok: false, reason: 'Completion failed (502).', status: 502, kind: 'other' });
    expect(providerMessage(JSON.stringify([{ error: { code: 400, message: 'Invalid JSON payload received.' } }]), '')).toBe('Invalid JSON payload received.');
  });

  it('asks again with the schema in the prompt when the gateway cannot take it as a response format', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const result = await completeChat(
      options(async (_url, init) => {
        const body: unknown = JSON.parse(String(init?.body));
        if (typeof body === 'object' && body !== null && !Array.isArray(body)) bodies.push(Object.fromEntries(Object.entries(body)));
        return bodies.length === 1 ? Response.json({ error: { message: "Invalid schema for response_format 'geld_summary'" } }, { status: 400 }) : Response.json({ choices: [{ message: { content: '{"tldr":"ok"}' } }] });
      }),
    );
    expect(result).toEqual({ ok: true, text: '{"tldr":"ok"}', model: 'anthropic/claude-sonnet-5' });
    expect(bodies[0]).toHaveProperty('response_format');
    expect(bodies[1]).not.toHaveProperty('response_format');
    expect(JSON.stringify(bodies[1]?.messages)).toContain('matching this JSON Schema');
  });

  it('reports the plain request’s own refusal when it is refused too, and asks only once more', async () => {
    let calls = 0;
    const result = await completeChat(
      options(async () => {
        calls += 1;
        return calls === 1 ? Response.json({ error: { message: 'json_schema is not supported for this model' } }, { status: 400 }) : Response.json({ error: { message: 'You exceeded your current quota' } }, { status: 429 });
      }),
    );
    expect(calls).toBe(2);
    expect(result).toEqual({ ok: false, reason: 'Completion failed (429): You exceeded your current quota.', status: 429, kind: 'quota' });
  });

  it('reads the whole message for the response format, past the part the reason shows', async () => {
    const long = `${'The request could not be processed as sent. '.repeat(8)}response_format is not supported for this model.`;
    let calls = 0;
    const result = await completeChat(
      options(async () => {
        calls += 1;
        return Response.json({ error: { message: long } }, { status: 400 });
      }),
    );
    expect(calls).toBe(2);
    expect(result.ok === false && result.kind).toBe('response-format');
    expect(result.ok === false && result.reason.length).toBeLessThan(long.length);
  });

  it('never reports a decision body it could not read in its own words', async () => {
    const result = await evaluateDecision({
      fetch: async () => new Response('private text the gateway echoed', { status: 200 }),
      baseUrl: 'https://api.typesafe.ai',
      apiKey: 'synthetic',
      request: { model: 'jev-latest', state: 'Fixture', questions: { a: { type: 'noul', instructions: 'Yes?' } } },
    });
    expect(result).toEqual({ ok: false, reason: 'The decision model answered in an unexpected shape.' });
  });

  it('does not ask again for a 400 that is not about the response format', async () => {
    for (const words of ["This model's maximum context length is 8192 tokens.", 'Messages require strict user/assistant alternation.', 'Tool input does not match its schema.']) {
      let calls = 0;
      const result = await completeChat(
        options(async () => {
          calls += 1;
          return Response.json({ error: { message: words } }, { status: 400 });
        }),
      );
      expect(calls).toBe(1);
      expect(result.ok).toBe(false);
    }
  });
});

describe('the kind of a refusal', () => {
  it('reads it from the words first, then the status', () => {
    expect(refusalKind(400, "Invalid schema for response_format 'geld_suggest'")).toBe('response-format');
    expect(refusalKind(400, "output_config.format.schema: Invalid schema: Enum value 'blocking' does not match declared type '['string', 'null']'")).toBe('response-format');
    expect(refusalKind(400, "This model's maximum context length is 8192 tokens.")).toBe('too-long');
    expect(refusalKind(429, 'Rate limit reached for model gpt-5')).toBe('rate-limit');
    expect(refusalKind(429, 'You exceeded your current quota')).toBe('quota');
    expect(refusalKind(401, 'Incorrect API key provided: <key>.')).toBe('key');
    expect(refusalKind(400, 'The model `no-such-model` does not exist')).toBe('model');
    expect(refusalKind(403, null)).toBe('key');
    expect(refusalKind(400, 'Invalid input near: privatePayroll = 125000')).toBe('other');
  });
});

it('leaves temperature to the provider unless the caller sets one', async () => {
  const bodies: unknown[] = [];
  const fetchImpl = async (_input: string, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  };
  const options: ChatCompletionOptions = { fetch: fetchImpl, baseUrl: 'https://api.openai.com', apiKey: 'synthetic', model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] };
  await completeChat(options);
  await completeChat({ ...options, temperature: 0.2 });
  expect(bodies[0]).not.toHaveProperty('temperature');
  expect(bodies[1]).toHaveProperty('temperature', 0.2);
});
