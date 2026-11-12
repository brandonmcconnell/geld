/**
 * Coding agents the triage can hand open findings to (verified in their docs in Nov 2026). Cursor, Copilot, Claude
 * and Codex answer a mention at the start of a comment on the pull request, Devin a `/devin` command, each pushing to
 * the pull request's branch (`CODING_AGENTS`). Apps and web apps open the task as a draft the reader sends instead
 * (`OPEN_TARGETS`), one line per way in: Claude Code has both a web app and an app, and T3 Code has no comment command
 * at all. Which agent leads is the reader's choice (`codingAgent`), unless the pull request's own links show its author
 * used another and the reader is that author.
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
  /** For an agent no comment starts: the open target (`OPEN_TARGETS` id) its one action follows. */
  readonly opens?: string;
  /** What to know before asking it. */
  readonly note?: string;
}

export const CODING_AGENTS: readonly CodingAgent[] = [
  { id: 'cursor', name: 'Cursor', command: '@cursor', bot: 'bugbot', relatedIds: ['cursor', 'cursor-automation'], installedWith: ['bugbot'] },
  { id: 'copilot', name: 'Copilot', command: '@copilot', appId: 1143301, relatedIds: ['copilot'], installedWith: ['copilot'], note: 'Not on pull requests from forks' },
  { id: 'claude', name: 'Claude', command: '@claude', bot: 'claude', relatedIds: ['claude-code'], installedWith: ['claude'], note: 'Needs the Claude Code GitHub Action' },
  { id: 'codex', name: 'Codex', command: '@codex', bot: 'codex', relatedIds: ['codex'], installedWith: ['codex'] },
  { id: 'devin', name: 'Devin', command: '/devin', bot: 'devin', relatedIds: ['devin'], installedWith: ['devin'], note: 'Open pull requests only' },
  { id: 't3code', name: 'T3 Code', icon: 't3code', relatedIds: ['t3code'], opens: 't3code-app' },
];

/** Links carry the task in the URL, so a long one is cut before it would trip a URL limit. */
const LINK_TASK_CHARS = 6000;
/** Claude Code's `claude-cli://` link takes at most 5,000 characters of prompt; T3 Code's at most 8,000. */
const CLAUDE_CLI_CHARS = 5000;
const T3_PROMPT_CHARS = 8000;

const cut = (task: string, max: number): string => (task.length > max ? `${task.slice(0, max - 1)}…` : task);

function link(base: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

/** One way to open a task as a draft: a service's web app or its app (desktop or mobile, whichever the reader has). */
export interface OpenTarget {
  readonly id: string;
  readonly service: string;
  readonly variant: 'web' | 'app';
  /** The coding agent it is, for its mark and whether it is likely here. */
  readonly agent?: AgentId;
  /** For a service that is not one of the agents: its mark and the related-link services that show it was used. */
  readonly appId?: number;
  readonly relatedIds?: readonly string[];
  readonly url: (task: string, pull: PullRef) => string;
  /** The link cannot carry the task: it is copied first, for the reader to paste where the link lands. */
  readonly copiesTask?: true;
}

/**
 * Where a task can be opened, each read from the service's own docs in Nov 2026 unless said otherwise. Cursor has no web
 * link that opens a prompt or a cloud agent (its forum, Feb 2026), so its web line copies the task and opens its agents.
 */
export const OPEN_TARGETS: readonly OpenTarget[] = [
  // Cursor's web agents take no prompt in their link (its forum, Feb 2026), so the task is copied for the reader to paste there.
  { id: 'cursor-web', service: 'Cursor', variant: 'web', agent: 'cursor', copiesTask: true, url: () => 'https://cursor.com/agents' },
  // The web form of Cursor's prompt deeplink: a cursor.com page that hands the prompt to the app.
  { id: 'cursor-app', service: 'Cursor', variant: 'app', agent: 'cursor', url: (task) => link('https://cursor.com/link/prompt', { text: cut(task, LINK_TASK_CHARS) }) },
  { id: 'claude-web', service: 'Claude Code', variant: 'web', agent: 'claude', url: (task, pull) => link('https://claude.ai/code', { prompt: cut(task, LINK_TASK_CHARS), repositories: `${pull.owner}/${pull.repo}` }) },
  { id: 'claude-app', service: 'Claude Code', variant: 'app', agent: 'claude', url: (task, pull) => link('claude-cli://open', { repo: `${pull.owner}/${pull.repo}`, q: cut(task, CLAUDE_CLI_CHARS) }) },
  // GitHub's hosted launcher, which opens the Copilot app or shows a fallback page, around a `ghapp://` session link.
  {
    id: 'copilot-app',
    service: 'Copilot',
    variant: 'app',
    agent: 'copilot',
    url: (task, pull) => link('https://github.com/copilot/app/launch', { open: link('ghapp://session/new', { repo: `${pull.owner}/${pull.repo}`, pr: String(pull.number), prompt: cut(task, LINK_TASK_CHARS) }) }),
  },
  // The ChatGPT app's `codex://` link (codex-docs.com's reference, and the app's own code), matched to a local clone by its remote.
  { id: 'codex-app', service: 'Codex', variant: 'app', agent: 'codex', url: (task, pull) => link('codex://new', { prompt: cut(task, LINK_TASK_CHARS), originUrl: `https://github.com/${pull.owner}/${pull.repo}` }) },
  // Devin's web agent (ailinks.swerdlow.dev's catalogue of documented links).
  { id: 'devin-web', service: 'Devin', variant: 'web', agent: 'devin', url: (task) => link('https://app.devin.ai/', { prompt: cut(task, LINK_TASK_CHARS) }) },
  // Factory's new-session link, the shape its users put in pull request descriptions.
  { id: 'factory-web', service: 'Factory', variant: 'web', appId: 358017, relatedIds: ['factory', 'factory-automation'], url: (task) => link('https://app.factory.ai/sessions/new', { prompt: cut(task, LINK_TASK_CHARS) }) },
  // A prompt link: app.t3.codes asks once where to open it (desktop, mobile, or a connected browser), and `pr` puts the
  // draft in the pull request's thread, or on its branch in a new worktree after the reader confirms.
  {
    id: 't3code-app',
    service: 'T3 Code',
    variant: 'app',
    agent: 't3code',
    url: (task, pull) => link('https://app.t3.codes/new', { prompt: cut(task, T3_PROMPT_CHARS), repo: `${pull.owner}/${pull.repo}`, pr: `${pull.owner}/${pull.repo}/${pull.number}` }),
  },
];

export function openTargetById(id: string): OpenTarget | undefined {
  return OPEN_TARGETS.find((target) => target.id === id);
}

/** Whether an open target is likely to be what the reader uses: its agent is likely, or the pull request's links show its service was used. */
export function openTargetLikely(target: OpenTarget, agentIsLikely: (id: AgentId) => boolean, services: readonly string[]): boolean {
  if (target.agent !== undefined) return agentIsLikely(target.agent);
  return (target.relatedIds ?? []).some((id) => services.includes(id));
}

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
