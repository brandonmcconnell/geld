import { describe, expect, it } from 'vitest';
import { completeChat, listModels } from './ai-client';

describe('ai-client', () => {
  it('does not call the network without a key', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('must not fetch');
    };
    expect(await listModels(fetchImpl, 'https://api.openai.com', '')).toEqual({ ok: false, reason: 'No API key.' });
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

  it('lists model ids from /v1/models', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe('https://api.openai.com/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }, { id: '' }, { nope: true }] }));
    };
    expect(await listModels(fetchImpl, 'https://api.openai.com/', 'sk-test')).toEqual({
      ok: true,
      models: [{ id: 'gpt-4.1-mini' }],
    });
  });
});
