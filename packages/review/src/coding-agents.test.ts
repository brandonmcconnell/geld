import { describe, expect, it } from 'vitest';
import { agentComment, agentLikely, agentsInRelatedLinks, agentTask, codingAgentById, openTargetById, openTargetLikely, recommendAgents } from './coding-agents';

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
  });

  it('posts nothing for T3 Code, whose one action opens its app', () => {
    const t3 = codingAgentById('t3code');
    expect(t3?.command).toBeUndefined();
    expect(t3 === undefined ? '' : agentComment(t3, 'fix it')).toBeNull();
    expect(t3?.opens).toBe('t3code-app');
  });
});

describe('OPEN_TARGETS', () => {
  const pull = { owner: 'o', repo: 'r', number: 12 };
  const open = (id: string, task = 'fix it'): URL => new URL(openTargetById(id)?.url(task, pull) ?? 'about:blank');

  it('builds each service’s documented link with the pull request where it takes one', () => {
    expect(open('cursor-app').toString()).toBe('https://cursor.com/link/prompt?text=fix+it');
    expect(Object.fromEntries(open('claude-web').searchParams)).toEqual({ prompt: 'fix it', repositories: 'o/r' });
    expect(open('claude-app').protocol).toBe('claude-cli:');
    expect(Object.fromEntries(open('claude-app').searchParams)).toEqual({ repo: 'o/r', q: 'fix it' });
    expect(Object.fromEntries(open('codex-app').searchParams)).toEqual({ prompt: 'fix it', originUrl: 'https://github.com/o/r' });
    expect(open('devin-web').toString()).toBe('https://app.devin.ai/?prompt=fix+it');
    expect(open('factory-web').toString()).toBe('https://app.factory.ai/sessions/new?prompt=fix+it');
    const t3 = open('t3code-app');
    expect(`${t3.origin}${t3.pathname}`).toBe('https://app.t3.codes/new');
    expect(Object.fromEntries(t3.searchParams)).toEqual({ prompt: 'fix it', repo: 'o/r', pr: 'o/r/12' });
  });

  it('wraps the Copilot app’s session link in GitHub’s launcher', () => {
    const launcher = open('copilot-app');
    expect(`${launcher.origin}${launcher.pathname}`).toBe('https://github.com/copilot/app/launch');
    const inner = new URL(launcher.searchParams.get('open') ?? 'about:blank');
    expect(inner.protocol).toBe('ghapp:');
    expect(Object.fromEntries(inner.searchParams)).toEqual({ repo: 'o/r', pr: '12', prompt: 'fix it' });
  });

  it('cuts a long task to what each link takes', () => {
    const long = 'x'.repeat(9000);
    expect(open('t3code-app', long).searchParams.get('prompt')?.length).toBe(8000);
    expect(open('claude-app', long).searchParams.get('q')?.length).toBe(5000);
    expect(open('claude-web', long).searchParams.get('prompt')?.length).toBe(6000);
  });

  it('counts a target as likely through its agent, or for a service no agent stands for, through the links', () => {
    const factory = openTargetById('factory-web');
    const claude = openTargetById('claude-web');
    expect(factory === undefined ? null : openTargetLikely(factory, () => true, [])).toBe(false);
    expect(factory === undefined ? null : openTargetLikely(factory, () => false, ['factory'])).toBe(true);
    expect(claude === undefined ? null : openTargetLikely(claude, (id) => id === 'claude', [])).toBe(true);
  });
});
