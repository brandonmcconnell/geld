import { describe, expect, it } from 'vitest';
import { agentComment, agentLikely, agentsInRelatedLinks, agentTask, codingAgentById, recommendAgents } from './coding-agents';

const ids = (agents: readonly { readonly id: string }[]): readonly string[] => agents.map((agent) => agent.id);

describe('recommendAgents', () => {
  it('leads with the reader’s choice when nothing else is known', () => {
    const pick = recommendAgents('codex', [], false);
    expect(pick.recommended?.id).toBe('codex');
    expect(pick.reason).toBe('preferred');
    expect(ids(pick.order)).toEqual(['codex', 'cursor', 'copilot', 'claude', 'devin', 't3code']);
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

describe('agentLikely', () => {
  const agent = (id: string) => {
    const found = codingAgentById(id);
    if (found === undefined) throw new Error(id);
    return found;
  };

  it('counts an agent whose review bot is known here, the reader’s choice, and the one the author used', () => {
    expect(agentLikely(agent('cursor'), 'auto', [], new Set(['bugbot']))).toBe(true);
    expect(agentLikely(agent('codex'), 'auto', [], new Set(['bugbot', 'greptile']))).toBe(false);
    expect(agentLikely(agent('devin'), 'devin', [], new Set())).toBe(true);
    expect(agentLikely(agent('claude'), 'auto', ['claude'], new Set())).toBe(true);
  });

  it('never guesses at an app nothing on the page can show', () => {
    expect(agentLikely(agent('t3code'), 'auto', [], new Set(['bugbot', 'codex', 'copilot', 'claude', 'devin']))).toBe(false);
    expect(agentLikely(agent('t3code'), 't3code', [], new Set())).toBe(true);
  });
});

describe('hand-off', () => {
  it('reads agents from related-link services, once each', () => {
    expect(agentsInRelatedLinks(['linear', 'cursor-automation', 'cursor', 'claude-code', 't3code'])).toEqual(['cursor', 'claude', 't3code']);
  });

  it('writes the task with each finding, and puts the agent’s command first', () => {
    const task = agentTask([{ title: 'Guard `parseDiff` against null', path: 'src/diff.ts', line: 42, context: 'Throws on null.', url: 'https://github.com/o/r/pull/1#discussion_r1' }], 'https://github.com/o/r/pull/1');
    expect(task).toContain('1. Guard `parseDiff` against null (`src/diff.ts:42`)');
    expect(task).toContain('   Thread: https://github.com/o/r/pull/1#discussion_r1');
    const devin = codingAgentById('devin');
    expect(devin === undefined ? '' : agentComment(devin, task)).toMatch(/^\/devin Address/);
    const pull = { owner: 'o', repo: 'r', number: 1 };
    const cursor = codingAgentById('cursor');
    expect(cursor?.openUrl?.('fix it', pull)).toBe('https://cursor.com/link/prompt?text=fix+it');
    expect(cursor?.openLabel).toBe('Open in Cursor desktop');
  });

  it('opens T3 Code as a draft on the pull request, and posts nothing for it', () => {
    const t3 = codingAgentById('t3code');
    expect(t3?.command).toBeUndefined();
    expect(t3 === undefined ? '' : agentComment(t3, 'fix it')).toBeNull();
    const url = new URL(t3?.openUrl?.(`fix ${'x'.repeat(9000)}`, { owner: 'o', repo: 'r', number: 12 }) ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('https://app.t3.codes/new');
    expect(url.searchParams.get('repo')).toBe('o/r');
    expect(url.searchParams.get('pr')).toBe('o/r/12');
    expect(url.searchParams.get('prompt')?.length).toBe(8000);
  });
});
