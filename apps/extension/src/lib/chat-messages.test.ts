import { describe, expect, it } from 'vitest';
import { isChatPortEvent, isChatPortRequest, isCursorConversationReply, isCursorRequest } from './chat-messages';

const AGENT = { id: 'bc-00000000-0000-0000-0000-000000000001', name: 'Fix it', status: 'ACTIVE', url: 'https://cursor.com/agents/x', createdAt: null, updatedAt: null, latestRunId: null };

describe('chat messages', () => {
  it('takes only well-formed Cursor requests', () => {
    expect(isCursorRequest({ type: 'geld:cursor', action: 'send', agentId: AGENT.id, text: 'hi', model: null, steer: false })).toBe(true);
    expect(isCursorRequest({ type: 'geld:cursor', action: 'send', agentId: AGENT.id, text: 'hi', steer: false })).toBe(false);
    expect(isCursorRequest({ type: 'geld:cursor', action: 'delete', agentId: AGENT.id })).toBe(false);
    expect(isCursorRequest({ type: 'geld:cursor', action: 'find', prUrl: 'u', ids: [1] })).toBe(false);
  });

  it('checks conversation replies field by field', () => {
    expect(isCursorConversationReply({ ok: true, agent: AGENT, run: null, messages: [{ id: 'm', role: 'user', text: 'x' }] })).toBe(true);
    expect(isCursorConversationReply({ ok: true, agent: AGENT, run: null, messages: [{ id: 'm', role: 'system', text: 'x' }] })).toBe(false);
    expect(isCursorConversationReply({ ok: false, reason: 'No', code: null })).toBe(true);
  });

  it('checks port messages and the agent updates they carry', () => {
    expect(isChatPortRequest({ type: 'assistant', id: 'a', model: 'm', messages: [{ role: 'user', content: 'hi' }] })).toBe(true);
    expect(isChatPortRequest({ type: 'assistant', id: 'a', model: 'm', messages: [{ role: 'tool', content: 'hi' }] })).toBe(false);
    expect(isChatPortEvent({ type: 'agent', agentId: AGENT.id, update: { kind: 'tool', callId: 'c', name: 'read_file', status: 'running', detail: null } })).toBe(true);
    expect(isChatPortEvent({ type: 'agent', agentId: AGENT.id, update: { kind: 'tool', callId: 'c', name: 'read_file', status: 'paused', detail: null } })).toBe(false);
    expect(isChatPortEvent({ type: 'agent-closed', agentId: AGENT.id, reason: null })).toBe(true);
  });
});
