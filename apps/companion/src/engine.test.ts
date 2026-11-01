import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createRelayBroker, pollConnector, relayFetch } from '@geld/relay';
import { companionHandler, restrictedOptions, claudeEnvironment } from './engine';
import { pairingSchema } from './config';
describe('Claude companion boundaries', () => {
  it('disables tools, local instructions, MCP and persistence without forwarding credentials', async () => {
    const env = claudeEnvironment({
      HOME: '/home/test',
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'do-not-forward',
      CLAUDE_CODE_OAUTH_TOKEN: 'do-not-forward',
      DATABASE_URL: 'do-not-forward',
    });
    expect(env).toMatchObject({ HOME: '/home/test', PATH: '/bin' });
    expect(Object.values(env)).not.toContain('do-not-forward');
    const options = restrictedOptions('/usr/bin/claude', '/tmp/empty', new AbortController());
    expect(options).toMatchObject({
      pathToClaudeCodeExecutable: '/usr/bin/claude',
      tools: [],
      allowedTools: [],
      skills: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 1,
      permissionMode: 'default',
    });
    expect(
      await options.canUseTool?.(
        'Bash',
        {},
        {
          signal: new AbortController().signal,
          toolUseID: 'test',
          requestId: 'test',
        },
      ),
    ).toMatchObject({ behavior: 'deny' });
  });
  it('rejects pairing redirects and credentials in broker URLs', () => {
    for (const brokerUrl of [
      'http://relay.example',
      'https://user:secret@relay.example',
      'https://relay.example?token=secret',
    ])
      expect(
        pairingSchema.safeParse({
          version: 1,
          kind: 'claude',
          brokerUrl,
          channel: crypto.randomUUID(),
          secret: 'x'.repeat(64),
        }).success,
      ).toBe(false);
  });
  it('round-trips a structured review through the real broker and an injected SDK engine', async () => {
    const secret = 'x'.repeat(64);
    const broker = createRelayBroker([], async (id) =>
      id === 'local' ? { id, secret, host: 'claude.local.geld.invalid', kind: 'claude' } : null,
    );
    broker.server.listen(0, '127.0.0.1');
    await once(broker.server, 'listening');
    const address = broker.server.address();
    if (!address || typeof address === 'string') throw new Error('No broker');
    const endpoint = {
      url: `http://127.0.0.1:${address.port}`,
      channel: 'local',
      secret,
      allowHttp: true,
    };
    const abort = new AbortController();
    const connector = pollConnector(
      endpoint,
      'claude.local.geld.invalid',
      companionHandler({
        models: async () => [{ id: 'sonnet', name: 'Sonnet' }],
        complete: async (input) => {
          expect(input.schema).toEqual({ type: 'object' });
          expect(input.messages[0]?.content).toBe('Untrusted diff');
          return '{"steps":[]}';
        },
      }),
      abort.signal,
      'claude',
    );
    try {
      const fetch = relayFetch(endpoint, 'claude.local.geld.invalid', 'claude');
      const models = await fetch('https://claude.local.geld.invalid/v1/models');
      expect(await models.json()).toEqual({
        data: [{ id: 'sonnet', name: 'Sonnet' }],
      });
      const response = await fetch('https://claude.local.geld.invalid/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'sonnet',
          messages: [{ role: 'user', content: 'Untrusted diff' }],
          response_format: {
            type: 'json_schema',
            json_schema: { schema: { type: 'object' } },
          },
        }),
      });
      expect(await response.json()).toMatchObject({
        choices: [{ message: { content: '{"steps":[]}' } }],
      });
      await expect(fetch('https://api.anthropic.com/v1/messages')).rejects.toThrow('destination');
      expect(broker.pendingCount()).toBe(0);
    } finally {
      abort.abort();
      broker.close();
      await connector;
    }
  });
});
