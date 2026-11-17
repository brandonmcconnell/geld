import { describe, expect, it } from 'vitest';
import type { FetchLike } from './ai-client';
import {
  agentStreamUpdate,
  conversationFromRuns,
  cursorAgentsForPull,
  cursorConversation,
  cursorFailure,
  cursorSend,
  isCursorAgentId,
  parseAgentList,
  parseConversation,
  parseCursorModels,
  parseSent,
  toolLine,
} from './cursor-agents';

const ID = 'bc-00000000-0000-0000-0000-000000000001';

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(answers: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const path = url.replace('https://api.cursor.com', '');
    const answer = answers[path] ?? { status: 404, body: { error: { code: 'not_found', message: 'nope' } } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
}

describe('cursor agents', () => {
  it('knows an agent id by its bc- prefix and UUID', () => {
    expect(isCursorAgentId(ID)).toBe(true);
    expect(isCursorAgentId('bc_abc123')).toBe(false);
    expect(isCursorAgentId('bc-00000000-0000-0000-0000-00000000000z')).toBe(false);
  });

  it('reads v0 conversations and drops entries of other types', () => {
    expect(
      parseConversation({
        id: ID,
        messages: [
          { id: 'm1', type: 'user_message', text: 'Add a README' },
          { id: 'm2', type: 'assistant_message', text: 'Done.' },
          { id: 'm3', type: 'tool_message', text: 'ignored' },
        ],
      }),
    ).toEqual([
      { id: 'm1', role: 'user', text: 'Add a README' },
      { id: 'm2', role: 'assistant', text: 'Done.' },
    ]);
    expect(parseConversation({ id: ID })).toBeNull();
  });

  it('falls back to v1 run results, oldest first, when v0 no longer answers', async () => {
    const fetchImpl = fakeFetch({
      [`/v1/agents/${ID}/runs?limit=100`]: {
        status: 200,
        body: { items: [{ id: 'run-2', status: 'FINISHED', result: 'Second' }, { id: 'run-1', status: 'FINISHED', result: 'First' }, { id: 'run-0', status: 'ERROR' }] },
      },
    });
    const result = await cursorConversation({ fetch: fetchImpl, apiKey: 'key' }, ID);
    expect(result).toEqual({ ok: true, value: [{ id: 'run-1', role: 'assistant', text: 'First' }, { id: 'run-2', role: 'assistant', text: 'Second' }] });
    expect(conversationFromRuns([])).toEqual([]);
  });

  it('does not fall back on a refused key', async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch({ [`/v0/agents/${ID}/conversation`]: { status: 401, body: { error: { code: 'unauthorized', message: 'bad key' } } } }, calls);
    const result = await cursorConversation({ fetch: fetchImpl, apiKey: 'key' }, ID);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('asks for the reader’s agents on a pull request by its URL, with the key as a bearer token', async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch(
      { '/v1/agents?limit=20&prUrl=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7': { status: 200, body: { items: [{ id: ID, status: 'ACTIVE', url: `https://cursor.com/agents/${ID}`, name: 'Fix it' }, { id: 'nope', status: 'ACTIVE' }] } } },
      calls,
    );
    const result = await cursorAgentsForPull({ fetch: fetchImpl, apiKey: 'secret' }, 'https://github.com/o/r/pull/7');
    expect(result.ok && result.value.map((agent) => agent.name)).toEqual(['Fix it']);
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer secret');
  });

  it('sends a follow-up with an optional model, and a steer with nothing else', async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch({ [`/v1/agents/${ID}/runs`]: { status: 201, body: { run: { id: 'run-9', agentId: ID, status: 'CREATING' } } } }, calls);
    const sent = await cursorSend({ fetch: fetchImpl, apiKey: 'k' }, ID, { text: 'Also the tests', model: 'composer-2', steer: false });
    expect(sent).toEqual({ ok: true, value: { delivery: 'run', runId: 'run-9' } });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ prompt: { text: 'Also the tests' }, model: { id: 'composer-2' } });
    await cursorSend({ fetch: fetchImpl, apiKey: 'k' }, ID, { text: 'Stop that', model: 'composer-2', steer: true });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ prompt: { text: 'Stop that' }, delivery: 'steer' });
    expect(parseSent({ delivery: 'queued' })).toEqual({ delivery: 'queued', runId: null });
  });

  it('words refusals by their code', () => {
    expect(cursorFailure(409, { error: { code: 'agent_busy', message: 'busy' } }).reason).toBe('The agent is still working on its last message.');
    expect(cursorFailure(401, null).reason).toContain('API key');
    expect(cursorFailure(500, { error: { code: 'internal_error', message: 'Boom' } }).reason).toBe('Cursor answered 500: Boom');
  });

  it('reads model and agent lists, skipping malformed entries', () => {
    expect(parseCursorModels({ items: [{ id: 'composer-2', displayName: 'Composer 2' }, { displayName: 'no id' }] })).toEqual([{ id: 'composer-2', name: 'Composer 2' }]);
    expect(parseAgentList({ items: [null, { id: ID }] })).toEqual([]);
  });

  it('reads the agent stream’s events into chat updates', () => {
    expect(agentStreamUpdate({ event: 'assistant', data: '{"text":"Hi"}', id: '1' })).toEqual({ kind: 'assistant', text: 'Hi' });
    expect(agentStreamUpdate({ event: 'status', data: '{"agentId":"x","status":"RUNNING","runId":"run-1"}', id: null })).toEqual({ kind: 'status', status: 'RUNNING', runId: 'run-1' });
    expect(agentStreamUpdate({ event: 'tool_call', data: '{"callId":"c","name":"read_file","status":"completed","args":{"path":"README.md"}}', id: '2' })).toEqual({
      kind: 'tool',
      callId: 'c',
      name: 'read_file',
      status: 'completed',
      detail: 'README.md',
    });
    expect(agentStreamUpdate({ event: 'result', data: '{"runId":"run-1","status":"FINISHED","text":"Done"}', id: '3' })).toEqual({ kind: 'result', runId: 'run-1', status: 'FINISHED', text: 'Done' });
    expect(agentStreamUpdate({ event: 'heartbeat', data: '{}', id: null })).toBeNull();
    expect(agentStreamUpdate({ event: 'assistant', data: 'not json', id: null })).toBeNull();
    expect(toolLine('run_terminal_cmd', 'pnpm test')).toBe('Ran pnpm test');
    expect(toolLine('some_tool', null)).toBe('some tool');
  });
});
