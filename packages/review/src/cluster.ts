/**
 * Deterministic grouping of review comments into one item per concern:
 * same thread, file + line overlap (±3), identical suggestion blocks, or
 * the same bot rule id.
 */

import type { FixSource, ReviewItem, ReviewSeverity, ReviewSource, SourceKind } from './model';
import { itemIdFor } from './model';
import { isTriggerComment, looksLikeBotLogin, resolveBotId } from './bots';

export interface RawComment {
  readonly anchor: string;
  readonly kind: SourceKind;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
  readonly path?: string;
  readonly line?: number;
  readonly isResolved?: boolean;
  readonly isOutdated?: boolean;
  /** Other comments that already belong to the same GitHub thread. */
  readonly threadAnchors?: readonly ThreadPeer[];
}

export interface ThreadPeer {
  readonly anchor: string;
  readonly kind: SourceKind;
  readonly author: string;
  readonly body: string;
}

const SUGGESTION = /```suggestion\r?\n([\s\S]*?)```/;
const RULE_ID = /(?:\brule\b|\bcheck\b)[:\s#]+([a-z0-9][\w.-]{1,80})/i;

export function suggestionOf(body: string): string | null {
  const match = SUGGESTION.exec(body);
  const block = match?.[1];
  return block === undefined ? null : block.replace(/\s+$/, '').replace(/^\n+/, '');
}

export function ruleIdOf(body: string): string | null {
  const match = RULE_ID.exec(body);
  return match?.[1]?.toLowerCase() ?? null;
}

export function firstSentence(body: string): string {
  const withoutCode = body.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1');
  const line = withoutCode
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !entry.startsWith('<') && !/^#{1,6}\s/.test(entry) && !/^[-*]\s*$/.test(entry))
    .map((entry) => entry.replace(/^\s*[-*]\s+/, ''))
    .find((entry) => entry !== '') ?? '';
  const cleaned = line.replace(/\s+/g, ' ').trim();
  if (cleaned === '') return 'Comment';
  const sentence = /^(.{1,160}?(?:[.!?]|$))/.exec(cleaned)?.[1] ?? cleaned.slice(0, 160);
  return sentence.trim();
}

export function guessSeverity(body: string, bot: boolean, humanQuestion: boolean): ReviewSeverity {
  const text = body.toLowerCase();
  if (/\b(security|critical|blocker|must fix|p0)\b/.test(text)) return 'blocking';
  if (humanQuestion || /^(why|what|how|who|where)\b/.test(text.trim()) || text.includes('?')) return 'question';
  if (/\b(nit(?:pick)?|style|typo|nit:)\b/.test(text)) return 'nit';
  if (/\b(nice|thanks|lgtm|love this|good catch)\b/.test(text) && !bot) return 'praise';
  if (/\b(bug|null|crash|incorrect|broken|error|exception)\b/.test(text)) return 'bug';
  return bot ? 'suggestion' : 'suggestion';
}

interface Atom {
  readonly sources: ReviewSource[];
  readonly bodies: string[];
  /** First sentence of the comment that opened the thread: the concern itself, not a reply. */
  readonly title: string;
  readonly humanLead: boolean;
  readonly path: string | undefined;
  readonly line: number | undefined;
  readonly suggestion: string | null;
  readonly suggestionBy: FixSource | null;
  readonly ruleId: string | null;
  readonly botIds: Set<string>;
  readonly humanAuthors: string[];
  readonly resolved: boolean;
  readonly outdated: boolean;
}

function sourceOf(comment: RawComment | ThreadPeer, extraLogins: readonly string[]): ReviewSource {
  const bot = resolveBotId(comment.author, extraLogins);
  const kind: SourceKind = 'kind' in comment ? comment.kind : 'comment';
  return bot === null ? { anchor: comment.anchor, kind, author: comment.author } : { anchor: comment.anchor, kind, author: comment.author, bot };
}

function atomFrom(comment: RawComment, extraLogins: readonly string[]): Atom {
  const sources = [sourceOf(comment, extraLogins)];
  const bodies = [comment.body];
  for (const peer of comment.threadAnchors ?? []) {
    if (peer.anchor === comment.anchor) continue;
    sources.push(sourceOf(peer, extraLogins));
    bodies.push(peer.body);
  }
  const botIds = new Set<string>();
  const humanAuthors: string[] = [];
  for (const source of sources) {
    if (source.bot !== undefined) botIds.add(source.bot);
    else if (!looksLikeBotLogin(source.author)) humanAuthors.push(source.author);
  }
  const lead = sources[0];
  return {
    sources,
    bodies,
    title: firstSentence(comment.body),
    humanLead: lead !== undefined && lead.bot === undefined && !looksLikeBotLogin(lead.author),
    path: comment.path,
    line: comment.line,
    suggestion: suggestionOf(comment.body),
    suggestionBy: suggestionOf(comment.body) === null ? null : lead !== undefined && (lead.bot !== undefined || looksLikeBotLogin(lead.author)) ? 'bot' : 'human',
    ruleId: ruleIdOf(comment.body),
    botIds,
    humanAuthors,
    resolved: comment.isResolved === true,
    outdated: comment.isOutdated === true,
  };
}

function shouldMerge(a: Atom, b: Atom): boolean {
  if (a.path !== undefined && a.path === b.path && a.line !== undefined && b.line !== undefined && Math.abs(a.line - b.line) <= 3) {
    return true;
  }
  if (a.suggestion !== null && a.suggestion === b.suggestion) return true;
  if (a.ruleId !== null && a.ruleId === b.ruleId && [...a.botIds].some((id) => b.botIds.has(id))) return true;
  return false;
}

function mergeAtom(a: Atom, b: Atom): Atom {
  const botIds = new Set(a.botIds);
  for (const id of b.botIds) botIds.add(id);
  const seen = new Set(a.sources.map((source) => source.anchor));
  const sources = [...a.sources];
  for (const source of b.sources) {
    if (!seen.has(source.anchor)) {
      seen.add(source.anchor);
      sources.push(source);
    }
  }
  // A person's words win over a bot's when two threads on the same lines merge.
  const humanLead = a.humanLead || b.humanLead;
  return {
    sources,
    bodies: [...a.bodies, ...b.bodies],
    title: a.humanLead || !b.humanLead ? a.title : b.title,
    humanLead,
    path: a.path ?? b.path,
    line: a.line ?? b.line,
    suggestion: a.suggestion ?? b.suggestion,
    suggestionBy: a.suggestion !== null ? a.suggestionBy : b.suggestionBy,
    ruleId: a.ruleId ?? b.ruleId,
    botIds,
    humanAuthors: [...a.humanAuthors, ...b.humanAuthors.filter((login) => !a.humanAuthors.includes(login))],
    resolved: a.resolved && b.resolved,
    outdated: a.outdated || b.outdated,
  };
}

function severityOf(atom: Atom): ReviewSeverity {
  const human = atom.humanAuthors.length > 0;
  let worst: ReviewSeverity = 'suggestion';
  const rank: Record<ReviewSeverity, number> = { blocking: 0, bug: 1, suggestion: 2, question: 3, nit: 4, praise: 5 };
  for (let index = 0; index < atom.bodies.length; index += 1) {
    const body = atom.bodies[index] ?? '';
    const source = atom.sources[index];
    const bot = source?.bot !== undefined;
    const next = guessSeverity(body, bot, human && body.includes('?'));
    if (rank[next] < rank[worst]) worst = next;
  }
  return worst;
}

function itemFromAtom(atom: Atom): ReviewItem {
  const id = itemIdFor(
    atom.sources.map((source) => source.anchor),
    atom.ruleId ?? undefined,
  );
  const item: ReviewItem = {
    id,
    title: atom.title,
    rewritten: false,
    severity: severityOf(atom),
    status: atom.outdated ? 'outdated' : atom.resolved ? 'resolved' : 'open',
    sources: atom.sources,
    ...(atom.suggestion !== null && atom.suggestionBy !== null ? { fix: { text: atom.suggestion, source: atom.suggestionBy } } : {}),
  };
  if (atom.path !== undefined && atom.line !== undefined) return { ...item, path: atom.path, line: atom.line };
  if (atom.path !== undefined) return { ...item, path: atom.path };
  if (atom.line !== undefined) return { ...item, line: atom.line };
  return item;
}

const EXCERPT_CHARS = 700;

/** What each source of an item said, trimmed, for a model prompt. */
export function sourceExcerpts(comments: readonly RawComment[], item: ReviewItem): readonly string[] {
  const bodies = new Map<string, string>();
  for (const comment of comments) {
    bodies.set(comment.anchor, comment.body);
    for (const peer of comment.threadAnchors ?? []) bodies.set(peer.anchor, peer.body);
  }
  return item.sources.map((source) => {
    const body = (bodies.get(source.anchor) ?? '').replace(/\s+/g, ' ').trim();
    const who = source.bot !== undefined ? `${source.bot}` : `@${source.author}`;
    return `${who}: ${body.length > EXCERPT_CHARS ? `${body.slice(0, EXCERPT_CHARS)}…` : body}`;
  });
}

/**
 * Group comments into review items. Threads are already one atom; atoms then
 * merge when they share a location, suggestion, or bot rule.
 */
/** A bot's top-level comment is its run summary (a verdict, folded away), not a review finding. */
export function isBotSummaryComment(comment: RawComment, extraLogins: readonly string[] = []): boolean {
  return comment.kind !== 'thread' && (resolveBotId(comment.author, extraLogins) !== null || looksLikeBotLogin(comment.author));
}

/**
 * Review items are the resolvable things: review threads. Top-level
 * comments and review bodies cannot be resolved on GitHub, so a "done"
 * there would come straight back on reload; they stay in the timeline
 * (or fold, for bots and review requests).
 */
export function isReviewItemComment(comment: RawComment, extraLogins: readonly string[] = []): boolean {
  return comment.kind === 'thread' && comment.body.trim() !== '' && !isTriggerComment(comment.body, extraLogins);
}

export function clusterComments(comments: readonly RawComment[], extraLogins: readonly string[] = []): readonly ReviewItem[] {
  const atoms = comments.filter((comment) => isReviewItemComment(comment, extraLogins)).map((comment) => atomFrom(comment, extraLogins));
  const parent = atoms.map((_, index) => index);
  const find = (index: number): number => {
    const current = parent[index] ?? index;
    if (current === index) return index;
    const root = find(current);
    parent[index] = root;
    return root;
  };
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const left = atoms[i];
      const right = atoms[j];
      if (left === undefined || right === undefined) continue;
      if (shouldMerge(left, right) && find(i) !== find(j)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Atom>();
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom === undefined) continue;
    const root = find(index);
    const existing = groups.get(root);
    groups.set(root, existing === undefined ? atom : mergeAtom(existing, atom));
  }
  return [...groups.values()].map(itemFromAtom);
}

export function isBotOnly(item: ReviewItem): boolean {
  return item.sources.length > 0 && item.sources.every((source) => source.bot !== undefined || looksLikeBotLogin(source.author));
}
