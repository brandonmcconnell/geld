/**
 * Coding agents the triage can hand open findings to (verified in their docs in Nov 2026). Cursor, Copilot, Claude
 * and Codex answer a mention at the start of a comment on the pull request, Devin a `/devin` command, each pushing to
 * the pull request's branch. Some also open the task in their own app as a draft the reader sends: Cursor's desktop
 * app, and T3 Code, which has no comment command. Which agent leads is the reader's choice (`codingAgent`), unless the
 * pull request's own links show its author used another and the reader is that author.
 */

import type { CodingAgentId } from '@geld/core';

export type AgentId = Exclude<CodingAgentId, 'auto'>;

/** The pull request a task is about, for an app that opens it there. */
export interface PullRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface CodingAgent {
  readonly id: AgentId;
  readonly name: string;
  /** What starts it, at the start of a comment on the pull request; absent for an agent that only opens in its own app. */
  readonly command?: string;
  /** The review bot whose registry mark stands for it, or a GitHub App id of its own. */
  readonly bot?: string;
  readonly appId?: number;
  /** A mark the extension bundles (`public/agent-icons/<name>.png`), for an agent with no GitHub App to borrow one from. */
  readonly icon?: 't3code';
  /** Related-link services (`related-links.ts` spec ids) that show it worked on a pull request. */
  readonly relatedIds: readonly string[];
  /**
   * Review bots (registry ids) whose presence on a repository says this agent's GitHub integration is installed there:
   * the same App answers both (Bugbot and `@cursor` are Cursor's), so a mention would be heard.
   */
  readonly installedWith?: readonly string[];
  /** A link that opens the task in the agent's own app as a draft, where it has one, and what following it is called. */
  readonly openUrl?: (task: string, pull: PullRef) => string;
  readonly openLabel?: string;
  /** What to know before asking it. */
  readonly note?: string;
}

/** Deep links carry the task in the URL, so a long one is cut before it would trip a URL limit. */
const DEEPLINK_TASK_CHARS = 6000;
/** T3 Code takes a prompt of at most 8,000 characters (its `docs/user/prompt-links.md`). */
const T3_PROMPT_CHARS = 8000;

const cut = (task: string, max: number): string => (task.length > max ? `${task.slice(0, max - 1)}…` : task);

export const CODING_AGENTS: readonly CodingAgent[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    command: '@cursor',
    bot: 'bugbot',
    relatedIds: ['cursor', 'cursor-automation'],
    installedWith: ['bugbot'],
    // The web form of Cursor's prompt deeplink: it hands the prompt to the desktop app, not to Cursor on the web.
    openUrl: (task) => {
      const url = new URL('https://cursor.com/link/prompt');
      url.searchParams.set('text', cut(task, DEEPLINK_TASK_CHARS));
      return url.toString();
    },
    openLabel: 'Open in Cursor desktop',
  },
  { id: 'copilot', name: 'Copilot', command: '@copilot', appId: 1143301, relatedIds: ['copilot'], installedWith: ['copilot'], note: 'Not on pull requests from forks' },
  { id: 'claude', name: 'Claude', command: '@claude', bot: 'claude', relatedIds: ['claude-code'], installedWith: ['claude'], note: 'Needs the Claude Code GitHub Action' },
  { id: 'codex', name: 'Codex', command: '@codex', bot: 'codex', relatedIds: ['codex'], installedWith: ['codex'] },
  { id: 'devin', name: 'Devin', command: '/devin', bot: 'devin', relatedIds: ['devin'], installedWith: ['devin'], note: 'Open pull requests only' },
  {
    // A prompt link: app.t3.codes asks once where to open it (desktop, mobile, or a connected browser), and `pr` puts the
    // draft in the pull request's thread, or on its branch in a new worktree after the reader confirms.
    id: 't3code',
    name: 'T3 Code',
    icon: 't3code',
    relatedIds: ['t3code'],
    openUrl: (task, pull) => {
      const url = new URL('https://app.t3.codes/new');
      url.searchParams.set('prompt', cut(task, T3_PROMPT_CHARS));
      url.searchParams.set('repo', `${pull.owner}/${pull.repo}`);
      url.searchParams.set('pr', `${pull.owner}/${pull.repo}/${pull.number}`);
      return url.toString();
    },
    openLabel: 'Open in T3 Code',
  },
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

/**
 * Whether the agent is likely to answer here, as the review bots' request menu judges its bots: it is the reader's
 * choice, the pull request's links show its author used it, or a review bot of the same App is known on the repository
 * (`knownBots`: seen on the page, declared or configured).
 */
export function agentLikely(agent: CodingAgent, preferred: CodingAgentId, used: readonly AgentId[], knownBots: ReadonlySet<string>): boolean {
  return agent.id === preferred || used.includes(agent.id) || (agent.installedWith ?? []).some((bot) => knownBots.has(bot));
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

/** The task for an agent, in plain Markdown: the findings (one, or one problem several reviewers reported), where each is, and what to do when done. */
export function agentTask(findings: readonly AgentFinding[], pullUrl: string): string {
  const lines = [findings.length === 1 ? `Address this review finding on ${pullUrl}:` : `Address these review findings on ${pullUrl}:`, ''];
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

/** The comment that hands `task` to `agent`: its mention or command first, which every one of them requires. Null for an agent started from its own app only. */
export function agentComment(agent: CodingAgent, task: string): string | null {
  return agent.command === undefined ? null : `${agent.command} ${task}`;
}
