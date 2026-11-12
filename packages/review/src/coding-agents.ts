/**
 * Coding agents the triage can hand open findings to. Each starts from a comment on the pull request (verified in
 * their docs in Nov 2026): Cursor, Copilot, Claude and Codex answer a mention at the start of a comment, Devin a
 * `/devin` command, each pushing to the pull request's branch. Cursor also opens a prompt in its desktop app. Which
 * agent leads is the reader's choice (`codingAgent`), unless the pull request's own links show its author used
 * another and the reader is that author.
 */

import type { CodingAgentId } from '@geld/core';

export type AgentId = Exclude<CodingAgentId, 'auto'>;

export interface CodingAgent {
  readonly id: AgentId;
  readonly name: string;
  /** What starts it, at the start of a comment on the pull request. */
  readonly command: string;
  /** The review bot whose registry mark stands for it, or a GitHub App id of its own. */
  readonly bot?: string;
  readonly appId?: number;
  /** Related-link services (`related-links.ts` spec ids) that show it worked on a pull request. */
  readonly relatedIds: readonly string[];
  /** A link that opens the task in the agent's own app, where it has one. */
  readonly openUrl?: (task: string) => string;
  /** What to know before asking it. */
  readonly note?: string;
}

/** Deep links carry the task in the URL, so a long one is cut before it would trip a URL limit. */
const DEEPLINK_TASK_CHARS = 6000;

export const CODING_AGENTS: readonly CodingAgent[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    command: '@cursor',
    bot: 'bugbot',
    relatedIds: ['cursor', 'cursor-automation'],
    openUrl: (task) => {
      const url = new URL('https://cursor.com/link/prompt');
      url.searchParams.set('text', task.length > DEEPLINK_TASK_CHARS ? `${task.slice(0, DEEPLINK_TASK_CHARS - 1)}…` : task);
      return url.toString();
    },
  },
  { id: 'copilot', name: 'Copilot', command: '@copilot', appId: 1143301, relatedIds: ['copilot'], note: 'Not on pull requests from forks' },
  { id: 'claude', name: 'Claude', command: '@claude', bot: 'claude', relatedIds: ['claude-code'], note: 'Needs the Claude Code GitHub Action' },
  { id: 'codex', name: 'Codex', command: '@codex', bot: 'codex', relatedIds: ['codex'] },
  { id: 'devin', name: 'Devin', command: '/devin', bot: 'devin', relatedIds: ['devin'], note: 'Open pull requests only' },
];

export function codingAgentById(id: string): CodingAgent | undefined {
  return CODING_AGENTS.find((agent) => agent.id === id);
}

/** The agents a pull request's related links show worked on it, in the links' order. */
export function agentsInRelatedLinks(serviceIds: readonly string[]): readonly AgentId[] {
  const found: AgentId[] = [];
  for (const service of serviceIds) {
    const agent = CODING_AGENTS.find((entry) => entry.relatedIds.includes(service));
    if (agent !== undefined && !found.includes(agent.id)) found.push(agent.id);
  }
  return found;
}

export interface AgentRecommendation {
  /** Every agent, the recommended one first. */
  readonly order: readonly CodingAgent[];
  readonly recommended: CodingAgent | null;
  /** Why it leads: the reader's own choice, or the agent this pull request's author used. */
  readonly reason: 'preferred' | 'used' | null;
}

/**
 * Which agent leads. The reader's choice when the pull request's links name it among others; the agent the links name
 * when the reader is the author and chose another (they used it for this one) or chose none; else the reader's choice.
 */
export function recommendAgents(preferred: CodingAgentId, used: readonly AgentId[], viewerIsAuthor: boolean): AgentRecommendation {
  const mine = preferred === 'auto' ? null : preferred;
  let first: AgentId | null = mine;
  let reason: AgentRecommendation['reason'] = mine === null ? null : 'preferred';
  const authorsAgent = used[0];
  if (viewerIsAuthor && authorsAgent !== undefined && (mine === null || !used.includes(mine))) {
    first = authorsAgent;
    reason = 'used';
  }
  const ids: AgentId[] = [];
  for (const id of [first, mine, ...used, ...CODING_AGENTS.map((agent) => agent.id)]) if (id !== null && !ids.includes(id)) ids.push(id);
  const order = ids.flatMap((id) => {
    const agent = codingAgentById(id);
    return agent === undefined ? [] : [agent];
  });
  return { order, recommended: first === null ? null : (codingAgentById(first) ?? null), reason };
}

export interface AgentFinding {
  readonly title: string;
  readonly path?: string;
  readonly line?: number;
  readonly context?: string;
  /** A fix the triage proposed for it, or what it said is needed. */
  readonly suggestion?: string;
  readonly url?: string;
}

/** The task for an agent, in plain Markdown: the open findings, where each is, and what to do when done. */
export function agentTask(findings: readonly AgentFinding[], pullUrl: string): string {
  const lines = [`Address the open review findings on ${pullUrl}:`, ''];
  findings.forEach((finding, index) => {
    const where = finding.path === undefined ? '' : ` (\`${finding.path}${finding.line === undefined ? '' : `:${finding.line}`}\`)`;
    lines.push(`${index + 1}. ${finding.title}${where}`);
    if (finding.context !== undefined && finding.context !== '') lines.push(`   ${finding.context}`);
    if (finding.suggestion !== undefined && finding.suggestion !== '') lines.push(`   Suggested: ${finding.suggestion}`);
    if (finding.url !== undefined) lines.push(`   Thread: ${finding.url}`);
  });
  lines.push('', "Push the fixes to this pull request's branch and reply in each thread with what changed.");
  return lines.join('\n');
}

/** The comment that hands `task` to `agent`: its mention or command first, which every one of them requires. */
export function agentComment(agent: CodingAgent, task: string): string {
  return `${agent.command} ${task}`;
}
