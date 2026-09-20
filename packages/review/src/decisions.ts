import type { JevAnswer, JevQuestion, JevRequest } from './jev';
import type { PreviewStatusRecord } from './model';
import { PREVIEW_STATUSES } from './model';
import type { ConsolidateInputItem } from './prompts';

/**
 * The decisions Jev takes in front of the prose model. Each builder turns
 * what we know into one System One request - shared state plus typed
 * questions - and a reader turns the answers back into something the
 * pipeline can branch on. Nothing here writes text.
 */

/** A pair of items Jev is asked about, keyed the way the question is. */
export interface ItemPair {
  readonly a: string;
  readonly b: string;
}

export function pairKey(a: string, b: string): string {
  return `same:${a}:${b}`;
}

const EXCERPT_CHARS = 480;
/** Jev reads 32k tokens; keep well under it so a busy round still fits in one call. */
const STATE_CHARS = 60_000;
/** Above this many pending items only same-file pairs are asked; below it, every pair. */
const ALL_PAIRS_UP_TO = 6;
const MAX_PAIRS = 60;

function excerptOf(item: ConsolidateInputItem): string {
  const text = item.excerpts.join(' / ').replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text;
}

/**
 * Which pending items might be reporting the same problem? Two bots often
 * flag one bug from two lines of the same file, or two files of one change.
 * Every pair is asked when the round is small; larger rounds ask about pairs
 * that share a file (a cross-file duplicate is rare enough to leave to the
 * prose model's own judgement).
 */
export function candidatePairs(items: readonly ConsolidateInputItem[]): readonly ItemPair[] {
  const pairs: ItemPair[] = [];
  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) {
      const a = items[index];
      const b = items[other];
      if (a === undefined || b === undefined) continue;
      if (items.length > ALL_PAIRS_UP_TO && (a.path === undefined || a.path !== b.path)) continue;
      pairs.push({ a: a.id, b: b.id });
      if (pairs.length >= MAX_PAIRS) return pairs;
    }
  }
  return pairs;
}

/**
 * One request: the items as numbered state, one yes/no question per
 * candidate pair. Null when there is nothing to ask.
 */
export function sameProblemRequest(model: string, items: readonly ConsolidateInputItem[]): JevRequest | null {
  const pairs = candidatePairs(items);
  if (pairs.length === 0) return null;
  const lines: string[] = ['Code-review findings on one pull request, one per line, each with its id, file and what the reporters said.'];
  for (const item of items) {
    const where = item.path === undefined ? '' : ` (${item.path}${item.line === undefined ? '' : `:${item.line}`})`;
    lines.push(`[${item.id}]${where} ${item.title} — ${excerptOf(item)}`);
  }
  let state = lines.join('\n');
  if (state.length > STATE_CHARS) state = `${state.slice(0, STATE_CHARS - 1)}…`;
  const questions: Record<string, JevQuestion> = {};
  for (const pair of pairs) {
    questions[pairKey(pair.a, pair.b)] = {
      type: 'noul',
      instructions: `Do findings [${pair.a}] and [${pair.b}] report the same underlying problem, such that a reader would want to see them as one item?`,
      criteria: {
        true: 'Same root cause or the same requested change, even if worded differently or pointing at neighbouring lines.',
        false: 'Different problems, or the same file but unrelated concerns.',
      },
    };
  }
  return { model, state, questions };
}

/** The probability above which a pair counts as the same problem. */
export const SAME_PROBLEM_THRESHOLD = 0.7;

/**
 * Items joined by Jev's "yes" answers, as groups of ids (size ≥ 2). Items in
 * no group are singletons: they report their own problem and need no
 * consolidation with anything.
 */
export function sameProblemGroups(items: readonly ConsolidateInputItem[], answers: Readonly<Record<string, JevAnswer>>, threshold = SAME_PROBLEM_THRESHOLD): readonly (readonly string[])[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let current = id;
    while ((parent.get(current) ?? current) !== current) current = parent.get(current) ?? current;
    return current;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const item of items) parent.set(item.id, item.id);
  for (const pair of candidatePairs(items)) {
    const answer = answers[pairKey(pair.a, pair.b)];
    if (answer?.type === 'noul' && answer.noul >= threshold) union(pair.a, pair.b);
  }
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const root = find(item.id);
    const group = groups.get(root) ?? [];
    group.push(item.id);
    groups.set(root, group);
  }
  return [...groups.values()].filter((group) => group.length >= 2);
}

/**
 * The pending items narrowed by Jev's answers: only items with a partner go
 * to the prose model, each told which items report its problem, so it can
 * give them one title and say so. Singletons keep the reporter's wording.
 */
export function withSameProblem(items: readonly ConsolidateInputItem[], groups: readonly (readonly string[])[]): readonly ConsolidateInputItem[] {
  const partners = new Map<string, readonly string[]>();
  for (const group of groups) for (const id of group) partners.set(id, group.filter((other) => other !== id));
  return items.filter((item) => partners.has(item.id)).map((item) => ({ ...item, sameProblemAs: partners.get(item.id) ?? [] }));
}

/* ------------------------------------------------------------------------- */
/* Lanes and thread state: the classification Jev stands in for               */
/* ------------------------------------------------------------------------- */

/**
 * Where a top-level comment belongs. Deterministic code decides this from
 * trigger phrases and bot logins; with Jev on, Jev decides it from the text,
 * and only a confident answer replaces the deterministic one.
 */
export const COMMENT_LANES = ['trigger', 'status', 'verdict', 'report', 'finding', 'discussion'] as const;
export type CommentLane = (typeof COMMENT_LANES)[number];

export function isCommentLane(value: unknown): value is CommentLane {
  return typeof value === 'string' && (COMMENT_LANES as readonly string[]).includes(value);
}

const LANE_CRITERIA: Readonly<Record<CommentLane, string>> = {
  trigger: 'Only asks an automated review bot to run - a trigger phrase such as "@greptileai", "bugbot run", "/devin review" - with no other content.',
  status: 'A bot saying its run started, is in progress, was superseded, or finished with nothing to read ("Starting review", "Stale comment from a previous run").',
  verdict: 'A bot\'s review result: a score or confidence, "no issues found", or "found N issues" with a summary of them.',
  report: 'An informational report from a bot - coverage, bundle size, build output, a preview deployment, a benchmark - with nothing the author must act on.',
  finding: 'A concrete problem or requested change the author should act on: failing tests, a bug, a security issue, a blocking question.',
  discussion: 'A person\'s remark, question or answer that is none of the above.',
};

export interface LaneInput {
  readonly id: string;
  readonly author: string;
  readonly bot: boolean;
  readonly text: string;
}

export interface ThreadInput {
  readonly id: string;
  readonly path?: string;
  readonly first: { readonly author: string; readonly text: string };
  readonly replies: readonly { readonly author: string; readonly text: string }[];
}

export function laneKey(id: string): string {
  return `lane:${id}`;
}

/** A preview deployment whose status the parser could not read from the comment: Jev reads it instead. */
export interface PreviewStatusInput {
  readonly id: string;
  readonly host: string;
  readonly project: string;
  /** The comment's text (table rows as `| a | b |` lines). */
  readonly text: string;
}

export function previewStatusKey(id: string): string {
  return `preview:${id}`;
}

const PREVIEW_CRITERIA: Readonly<Record<PreviewStatusRecord, string>> = {
  ready: 'The deployment succeeded and the preview is up: "Ready", "Deployed", "Visit Preview", a green check.',
  building: 'The deployment is still in progress: "Building", "Queued", "Pending", "Initializing", a yellow or spinning mark.',
  failed: 'The deployment failed: "Error", "Failed", a red cross, a link to logs because something broke.',
  skipped: 'The deployment was not attempted for this commit: "Skipped", "Ignored", "Canceled", a grey or crossed-out mark.',
  unknown: 'The comment does not say, or says something that fits none of the others.',
};

export function doneKey(id: string): string {
  return `done:${id}`;
}

const LANE_TEXT_CHARS = 400;
const REPLY_TEXT_CHARS = 300;
/** Comments and threads per request: the state has to fit with its questions in Jev's 32k-token budget. */
const PER_REQUEST = 24;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * One request per batch: the comments and threads as structured state, a
 * lane question per comment and a done question per thread, all answered in
 * one parallel pass. Empty when there is nothing to ask.
 */
export function classificationRequests(model: string, comments: readonly LaneInput[], threads: readonly ThreadInput[], previews: readonly PreviewStatusInput[] = []): readonly JevRequest[] {
  const requests: JevRequest[] = [];
  const queue: Array<{ readonly comment?: LaneInput; readonly thread?: ThreadInput; readonly preview?: PreviewStatusInput }> = [...comments.map((comment) => ({ comment })), ...threads.map((thread) => ({ thread })), ...previews.map((preview) => ({ preview }))];
  for (let start = 0; start < queue.length; start += PER_REQUEST) {
    const slice = queue.slice(start, start + PER_REQUEST);
    const stateComments = slice.flatMap((entry) => (entry.comment === undefined ? [] : [{ id: entry.comment.id, author: entry.comment.author, bot: entry.comment.bot, text: clip(entry.comment.text, LANE_TEXT_CHARS) }]));
    const stateThreads = slice.flatMap((entry) =>
      entry.thread === undefined
        ? []
        : [
            {
              id: entry.thread.id,
              ...(entry.thread.path === undefined ? {} : { path: entry.thread.path }),
              first: { author: entry.thread.first.author, text: clip(entry.thread.first.text, LANE_TEXT_CHARS) },
              replies: entry.thread.replies.map((reply) => ({ author: reply.author, text: clip(reply.text, REPLY_TEXT_CHARS) })),
            },
          ],
    );
    const statePreviews = slice.flatMap((entry) => (entry.preview === undefined ? [] : [{ id: entry.preview.id, host: entry.preview.host, project: entry.preview.project, comment: clip(entry.preview.text, LANE_TEXT_CHARS * 3) }]));
    const questions: Record<string, JevQuestion> = {};
    for (const preview of statePreviews) {
      questions[previewStatusKey(preview.id)] = {
        type: 'choice',
        instructions: `In \`previews\`, for the entry with id "${preview.id}": what is the state of the "${preview.project}" deployment according to \`comment\`?`,
        criteria: PREVIEW_CRITERIA,
      };
    }
    for (const comment of stateComments) {
      questions[laneKey(comment.id)] = {
        type: 'choice',
        instructions: `Which kind of comment is the one in \`comments\` with id "${comment.id}"?`,
        criteria: LANE_CRITERIA,
      };
    }
    for (const thread of stateThreads) {
      questions[doneKey(thread.id)] = {
        type: 'noul',
        instructions: `In \`threads\`, for the thread with id "${thread.id}": do the replies say the concern raised in \`first\` has been fixed, resolved, or no longer applies?`,
        criteria: {
          true: 'A reply states the change was made, points at a fixing commit, or explains why the concern does not apply, and no later reply disputes it.',
          false: 'The concern is still being discussed, was pushed back on without agreement, or no reply speaks to it.',
        },
      };
    }
    if (Object.keys(questions).length === 0) continue;
    requests.push({ model, state: { comments: stateComments, threads: stateThreads, previews: statePreviews }, questions });
  }
  return requests;
}

/** Below this confidence a lane answer is not trusted and the deterministic classification stands. */
export const LANE_CONFIDENCE = 0.6;
/** A thread counts as addressed at or above this, and as still open at or below its complement. */
export const DONE_THRESHOLD = 0.9;

export function lanesFrom(answers: Readonly<Record<string, JevAnswer>>, minConfidence = LANE_CONFIDENCE): ReadonlyMap<string, CommentLane> {
  const lanes = new Map<string, CommentLane>();
  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith('lane:') || answer.type !== 'choice' || answer.confidence < minConfidence || !isCommentLane(answer.choice)) continue;
    lanes.set(key.slice('lane:'.length), answer.choice);
  }
  return lanes;
}

/** Jev's word on each preview's state, taken as given: it was offered "unknown" and could have said so. */
export function previewStatusesFrom(answers: Readonly<Record<string, JevAnswer>>): ReadonlyMap<string, PreviewStatusRecord> {
  const out = new Map<string, PreviewStatusRecord>();
  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith('preview:') || answer.type !== 'choice') continue;
    const status = PREVIEW_STATUSES.find((candidate) => candidate === answer.choice);
    if (status !== undefined) out.set(key.slice('preview:'.length), status);
  }
  return out;
}

export type DoneVerdict = 'yes' | 'no' | 'unclear';

export function doneFrom(answers: Readonly<Record<string, JevAnswer>>, threshold = DONE_THRESHOLD): ReadonlyMap<string, { readonly verdict: DoneVerdict; readonly probability: number }> {
  const done = new Map<string, { readonly verdict: DoneVerdict; readonly probability: number }>();
  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith('done:') || answer.type !== 'noul') continue;
    const verdict: DoneVerdict = answer.noul >= threshold ? 'yes' : answer.noul <= 1 - threshold ? 'no' : 'unclear';
    done.set(key.slice('done:'.length), { verdict, probability: answer.noul });
  }
  return done;
}
