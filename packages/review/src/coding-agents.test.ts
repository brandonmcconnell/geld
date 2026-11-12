import { describe, expect, it } from 'vitest';
import { agentComment, agentsInRelatedLinks, agentTask, codingAgentById, recommendAgents } from './coding-agents';

const ids = (agents: readonly { readonly id: string }[]): readonly string[] => agents.map((agent) => agent.id);

describe('recommendAgents', () => {
  it('leads with the reader’s choice when nothing else is known', () => {
    const pick = recommendAgents('codex', [], false);
    expect(pick.recommended?.id).toBe('codex');
    expect(pick.reason).toBe('preferred');
    expect(ids(pick.order)).toEqual(['codex', 'cursor', 'copilot', 'claude', 'devin']);
  });

  it('recommends the agent the author used only to the author', () => {
    expect(recommendAgents('cursor', ['devin'], true)).toMatchObject({ recommended: { id: 'devin' }, reason: 'used' });
    expect(recommendAgents('cursor', ['devin'], false)).toMatchObject({ recommended: { id: 'cursor' }, reason: 'preferred' });
    expect(ids(recommendAgents('cursor', ['devin'], false).order).slice(0, 2)).toEqual(['cursor', 'devin']);
  });

  it('keeps the reader’s choice first when the links name it among others', () => {
    expect(recommendAgents('claude', ['devin', 'claude'], true)).toMatchObject({ recommended: { id: 'claude' }, reason: 'preferred' });
  });

  it('recommends nothing on auto unless the author is reading', () => {
    expect(recommendAgents('auto', ['copilot'], false).recommended).toBeNull();
    expect(recommendAgents('auto', ['copilot'], true).recommended?.id).toBe('copilot');
  });
});

describe('hand-off', () => {
  it('reads agents from related-link services, once each', () => {
    expect(agentsInRelatedLinks(['linear', 'cursor-automation', 'cursor', 'claude-code'])).toEqual(['cursor', 'claude']);
  });

  it('writes the task with each finding, and puts the agent’s command first', () => {
    const task = agentTask([{ title: 'Guard `parseDiff` against null', path: 'src/diff.ts', line: 42, context: 'Throws on null.', url: 'https://github.com/o/r/pull/1#discussion_r1' }], 'https://github.com/o/r/pull/1');
    expect(task).toContain('1. Guard `parseDiff` against null (`src/diff.ts:42`)');
    expect(task).toContain('   Thread: https://github.com/o/r/pull/1#discussion_r1');
    const devin = codingAgentById('devin');
    expect(devin === undefined ? '' : agentComment(devin, task)).toMatch(/^\/devin Address/);
    const cursor = codingAgentById('cursor');
    expect(cursor?.openUrl?.('fix it')).toBe('https://cursor.com/link/prompt?text=fix+it');
  });
});
