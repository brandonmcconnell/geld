import type { GeldSettings } from '@geld/core';
import type { AgentHost, CodingAgent, GeldPrMeta, OpenTarget } from '@geld/review';
import { agentAnswersOn, agentLikely, agentsInRelatedLinks, botAppAvatar, botById, botTitle, codingAgentById, diffHunks, lineDiff, OPEN_TARGETS, openTargetLikely, recommendAgents, resolveBotId } from '@geld/review';
import { browser } from 'wxt/browser';
import { authorLabels } from '../github/review/panel-model';
import type { AiState } from './ai';
import { aiPending, triageSuggestions } from './ai';
import type { TriageView } from './triage-card';

/** What one visit did with the triage: which fix is open, which are being applied, and what the last hand-off said. */
export interface TriageVisit {
  readonly openKey: string | null;
  readonly collapsed: boolean;
  readonly busy: ReadonlyMap<string, 'fix' | 'writing'>;
  readonly errors: ReadonlyMap<string, string>;
  readonly handedOff: TriageView['handedOff'];
}

/** What the card's reading needs from the host: the review and its AI, who is reading, and what the page says about agents. */
export interface TriageViewInput {
  readonly meta: GeldPrMeta;
  readonly ai: AiState;
  readonly settings: GeldSettings;
  readonly knownBots: ReadonlySet<string>;
  /** The reader opened the review: their own coding agent leads. */
  readonly viewerIsAuthor: boolean;
  /** The agent services the review's related links name (`cursor`, `devin`), from the page. */
  readonly agentServices: readonly string[];
  readonly visit: TriageVisit;
  /** Apply resolves the threads it answers. */
  readonly resolves: boolean;
  /** The repository's config is still being read, so whether Apply resolves is not known yet. */
  readonly policyPending: boolean;
  /**
   * The host the review is on. Off GitHub, only the open targets whose link carries the task alone
   * (`OpenTarget.anyHost`), and only the agents whose comment command starts them there (`agentAnswersOn`).
   */
  readonly host?: AgentHost;
}

export function agentIcon(agent: CodingAgent): string | null {
  if (agent.icon !== undefined) return browser.runtime.getURL(`/agent-icons/${agent.icon}.png`);
  if (agent.appId !== undefined) return `https://avatars.githubusercontent.com/in/${agent.appId}?s=32&v=4`;
  const bot = agent.bot === undefined ? null : botById(agent.bot);
  return bot === null ? null : botAppAvatar(bot, 32);
}

/** An open target's mark: its agent's, else its service's GitHub App. */
export function targetIcon(target: OpenTarget): string | null {
  const agent = target.agent === undefined ? undefined : codingAgentById(target.agent);
  if (agent !== undefined) return agentIcon(agent);
  return target.appId === undefined ? null : `https://avatars.githubusercontent.com/in/${target.appId}?s=32&v=4`;
}

/** Who a comment's finding came from, as the digest names them: a review bot by its name, anyone else by login. */
function originAuthor(author: string, settings: GeldSettings): string {
  const id = resolveBotId(author, settings.reviewBots);
  return id === null ? author.replace(/\[bot\]$/i, '') : botTitle(id, author);
}

/** The triage card's reading: the fixes to show, who to hand the rest to, and what this visit did with them. */
export function buildTriageView(input: TriageViewInput): TriageView | null {
  const { meta, ai, settings, knownBots } = input;
  if (ai.kind !== 'current' && ai.kind !== 'stale' && ai.kind !== 'failed' && ai.kind !== 'running' && ai.kind !== 'needs-key') return null;
  const services = input.agentServices;
  const used = agentsInRelatedLinks(services);
  const pick = recommendAgents(settings.codingAgent, used, input.viewerIsAuthor);
  const likely = (id: string): boolean => {
    const agent = codingAgentById(id);
    return agent !== undefined && agentLikely(agent, settings.codingAgent, used, knownBots);
  };
  const suggestions = triageSuggestions(meta, settings).map(({ entry, item, partners, current, behind }) => ({
    key: entry.key,
    title: item.title,
    path: entry.path,
    start: entry.start,
    end: entry.end,
    summary: entry.summary,
    kind: entry.replacement === null ? ('agent' as const) : ('fix' as const),
    diff: entry.replacement === null ? [] : diffHunks(lineDiff(entry.original, entry.replacement, entry.start)),
    reporters: [...new Set([item, ...partners].flatMap((each) => authorLabels(each)))],
    threads: 1 + partners.length,
    state: entry.state === 'applied' ? ('applied' as const) : ('open' as const),
    current,
    behind,
    busy: input.visit.busy.get(entry.key) ?? null,
    error: input.visit.errors.get(entry.key) ?? null,
    from: entry.origin === undefined ? null : originAuthor(entry.origin.author, settings),
    routed: entry.routed === true,
  }));
  const host = input.host ?? 'github';
  const here = host === 'github' ? pick.order : pick.order.filter((agent) => agentAnswersOn(agent, host));
  const recommended = pick.recommended !== null && here.includes(pick.recommended) ? pick.recommended : null;
  return {
    suggestions,
    agents: here.map((agent) => ({
      id: agent.id,
      name: agent.name,
      command: agent.command ?? null,
      iconSrc: agentIcon(agent),
      note: (host === 'github' ? agent.note : agent.hostNotes?.[host]) ?? null,
      opens: agent.opens ?? null,
      used: used.includes(agent.id),
      likely: likely(agent.id),
    })),
    openTargets: OPEN_TARGETS.filter((target) => host === 'github' || target.anyHost === true).map((target) => ({ id: target.id, service: target.service, variant: target.variant, iconSrc: targetIcon(target), likely: openTargetLikely(target, likely, services), copiesTask: target.copiesTask === true })),
    recommended: recommended === null || pick.reason === null ? null : { id: recommended.id, reason: pick.reason },
    openKey: input.visit.openKey,
    collapsed: input.visit.collapsed,
    // Only once the titles and the TL;DR are in: until then their own rows shimmer, and this line would name the wrong step.
    writing: aiPending().has('suggest') && aiPending().size === 1,
    handedOff: input.visit.handedOff,
    resolves: input.resolves,
    policyPending: input.policyPending,
  };
}

