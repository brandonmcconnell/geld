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
  /** Who reacted to the comment, by login, when the page says (a bot's 👍 on a trigger is its acknowledgement). */
  readonly reactedBy?: readonly string[];
  /** The same reactions with what each was, as GitHub names it ("rocket", "thumbs down", "thumbs up"). */
  readonly reactions?: readonly CommentReaction[];
}

export interface CommentReaction {
  readonly login: string;
  readonly emoji: string;
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

/**
 * The first line worth showing, kept to one sentence. Fenced blocks go;
 * inline marks (`code`, **bold**, *italic*, ~~struck~~) stay, so a title
 * renders the identifier or emphasis its author wrote (`inline-markdown.ts`).
 */
/**
 * A line that is only a finding's severity badge and where it is — "🟠 **High** `src/findings.ts:117`" (Macroscope) —
 * over the finding itself: never its title.
 */
const BADGE_LINE = /^\p{Extended_Pictographic}?\uFE0F?\s*\*\*(critical|high|medium|low)\*\*(?:\s+`[^`\n]*`)?$/iu;
/** Macroscope's "#### Approvability" heading as the page reads it (a bare line): the "**Verdict:** …" under it says more. */
const GATE_HEADING = /^approvability$/i;

/** `change` applied to the text outside code spans: "Escape `<div>` before rendering." keeps its tag. */
function outsideCodeSpans(line: string, change: (text: string) => string): string {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, index) => (index % 2 === 1 ? part : change(part)))
    .join('');
}

export function firstSentence(body: string): string {
  const withoutCode = body.replace(/```[\s\S]*?```/g, ' ');
  const line = withoutCode
    .split('\n')
    // Codex's raw "**<sub><sub>![P2 Badge](…)</sub></sub>  Resolve reference paths…**": the badge is no words, as on the page.
    .map((entry) => outsideCodeSpans(entry, (text) => text.replace(/<br\s*\/?>/gi, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<\/?(?:sub|sup|picture|source|img|span|a|p|div)\b[^>]*>/gi, '')).replace(/^(\*\*|__)\s+/, '$1').trim())
    .filter((entry) => entry !== '' && !entry.startsWith('<') && !/^#{1,6}\s/.test(entry) && !/^[-*]\s*$/.test(entry) && !BADGE_LINE.test(entry) && !GATE_HEADING.test(entry))
    .map((entry) => entry.replace(/^\s*[-*]\s+/, ''))
    .find((entry) => entry !== '') ?? '';
  const cleaned = line.replace(/\s+/g, ' ').trim();
  if (cleaned === '') return 'Comment';
  // The sentence ends at the first terminator outside a code span that ends a word too, so neither `a.b` in code nor a
  // URL, a version or an abbreviation ("e.g.", "etc.") in the text cuts it short.
  const sentence = sentenceOf(cleaned, 160);
  return sentence.trim();
}

/**
 * Whether the terminator at `index` ends a word: after it, past any closing punctuation or emphasis (`.)`, `."`,
 * `.**`), comes the end of the text, a space or a tag (a raw body's `<br>`). A URL's `?_ga=1` or `a.b_c` goes on, its
 * `_` opening nothing.
 */
function endsWord(text: string, index: number): boolean {
  const next = closedThrough(text, index);
  return next >= text.length || /[\s<]/.test(text[next] ?? '');
}

/** Past the terminator at `index`, the closing punctuation and emphasis that are the sentence's own (`.**`, `.)`). */
function closedThrough(text: string, index: number): number {
  let next = index + 1;
  while (next < text.length && /[)\]"'’”*_~]/.test(text[next] ?? '')) next += 1;
  return next;
}

/** Words whose period is an abbreviation's, never a sentence's end: "Use e.g. Node 20" goes on past it. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf|viz|approx|incl|esp)$/i;
/** "etc." ends a list and, before a capital, a sentence too: "Covers lists, etc. Then rerun." stops there. */
const ETC = /(?:^|[\s(])etc$/i;

function abbreviationGoesOn(text: string, index: number): boolean {
  const before = text.slice(0, index);
  if (ABBREVIATION.test(before)) return true;
  return ETC.test(before) && !/^\s+[A-Z]/.test(text.slice(index + 1));
}

function sentenceOf(text: string, limit: number): string {
  let inCode = false;
  for (let index = 0; index < text.length && index < limit; index += 1) {
    const char = text[index];
    if (char === '`') inCode = !inCode;
    else if (!inCode && (char === '.' || char === '!' || char === '?') && endsWord(text, index) && !(char === '.' && abbreviationGoesOn(text, index))) return text.slice(0, closedThrough(text, index));
  }
  return text.slice(0, limit);
}

export function guessSeverity(body: string, bot: boolean, humanQuestion: boolean): ReviewSeverity {
  // A bot that grades its own finding says how bad it is better than its words do.
  const badge = BADGE_LINE.exec(body.replace(/<!--[\s\S]*?-->/g, '').trim().split('\n')[0]?.trim() ?? '')?.[1]?.toLowerCase();
  if (badge !== undefined) return badge === 'critical' ? 'blocking' : badge === 'low' ? 'suggestion' : 'bug';
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
  /** The review threads merged into this atom, and how many of them are unresolved. */
  readonly threads: number;
  readonly openThreads: number;
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
    threads: 1,
    openThreads: comment.isResolved === true ? 0 : 1,
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
    threads: a.threads + b.threads,
    openThreads: a.openThreads + b.openThreads,
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
    // Resolved is the conversation's state and wins; outdated is a badge on an open one.
    status: atom.resolved ? 'resolved' : atom.outdated ? 'outdated' : 'open',
    sources: atom.sources,
    ...(atom.suggestion !== null && atom.suggestionBy !== null ? { fix: { text: atom.suggestion, source: atom.suggestionBy } } : {}),
    ...(atom.threads > 1 ? { threads: { total: atom.threads, open: atom.openThreads } } : {}),
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
