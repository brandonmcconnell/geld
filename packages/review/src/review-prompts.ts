/**
 * Prompts for the Review tab's two model calls: the plan (which hunks form
 * which steps, in what order, with a gist each) and a step's story (what the
 * step does and why, in plain words). Outputs are JSON, schema-validated,
 * and every hunk handle and step key in an answer is checked against the
 * input, as `prompts.ts` does for the digest.
 */

import { z } from 'zod';
import type { PromptParse } from './prompts';
import type { BeforeAfterKind, BeforeAfterLine, FlowNode, HunkRef, PlanInput, PlanOverview, ReviewPlan, ReviewStep, StepKind, StepProposal } from './review-plan';
import { FLOW_NODE_KINDS, isFlowNodeKind, isStepKind, movesOf, refKey, refsOf, STEP_KINDS, STEP_SIZE_CAP, touchesSummary } from './review-plan';
import { movesTouching } from './moves';

export const PLAN_SYSTEM = `You plan a code review. A pull request's diff is given as numbered hunks (h1, h2, …), each with its file, header and changed lines, plus the pull request's title, its commits, and a first grouping made by simple rules. Group the hunks into steps a reviewer reads in order.
Rules:
- A step is one body of work: a feature slice, a fix, a refactor, a migration. Group by purpose, never by file type or by file. A hunk belongs to exactly one step. Every hunk listed must appear in some step; invent none.
- Order the steps so each reads with what came before it: foundations (types, data, shared helpers) before what uses them; the change the pull request is about before its follow-through. Name a dependency in "dependsOn" (step keys) only when reading the other step first is needed to understand this one.
- A step is read in one sitting: prefer steps under ${STEP_SIZE_CAP} changed lines, a few hunks in one to three files, and split a large body of work into the parts a reader would take in turn (the data model, then the logic, then where it is wired in). A tiny pull request may be one step. Do not pad: a step with one hunk is fine when it is its own change.
- "key": s1, s2, … in reading order. "title": three to seven words, imperative or a noun phrase, naming the change not the files ("Debounce the search box", "Settings schema for the new toggle"). "kind": one of ${STEP_KINDS.join(', ')}. "gist": one sentence, under 160 characters, saying what the step does. "watch": zero to three short items worth a second look, only when the diff shows one.
- Files Geld hides (tests, generated output, fixtures) are listed by path only and are not hunks to place; their steps are decided afterwards.
- "moves" lists blocks cut from one hunk and pasted into another ("h3 → h9 · 31 lines"). Both ends of a move belong to one step, and a move is not new code: say "moved", not "adds".
- When "previousSteps" are given, the reader has already worked through them: keep a step's key where its hunks are the same change, and change only what the new and removed hunks require; rewrite "previousOverview" only where the new hunks change the account.
- "overview" is the account of the whole pull request a reader gets before the steps. "summary": three or four sentences in one paragraph: what the system did before, what this pull request turns it into, the mechanism in a clause, and why. "points": one line per mechanism in reading order, zero to five, each under 140 characters, identifiers in backticks. "beforeAfter": the behaviour as a diff, not the code: a "caption" naming the path through the system ("A row in Ready to merge", "Crew merge completion path"), then "lines" in reading order, each with "kind" same (behaviour that stays), before (the old way, gone) or after (the new way), "depth" 0 to 3 for nesting under the line above, "text" under 100 characters in plain words with → for "leads to", and "step": the key of the step where that behaviour is read, or null. Four to twelve lines. "flow": the same path as boxes and arrows: "nodes" (id n1, n2, …; "label": a function or a question, under 48 characters; "file": its file's name or null; "kind" new, changed, existing or decision; "step": the step key or null) and "edges" (from, to, "label": yes, no or null for a decision's branches). Three to ten nodes, a tree or a near tree, no cycles.
- Return JSON only, matching the schema.`;

export const STORY_SYSTEM = `You explain one step of a code review to the reviewer, who did not write the code. The whole plan is given for context, then the step's hunks in full.
Rules:
- "story": two to four short sentences, in the present tense, about the code as it now is ("A new \`MergeGate\` decides each row's merge action from the checks rollup, and the Ready to merge section renders it on every row."). The first sentence is the point: what the step does. Then how it fits the pull request, and what the pieces do. Plain words; name a file only where the reader would otherwise be lost. Never say what is not in the diff. No praise, no "this PR", no headings or lists. Inline code in backticks is fine.
- "moves" lists code cut from one place and pasted into another: say it moved and what, if anything, changed on the way. Never describe moved code as new.
- "why": one sentence tying the step to the pull request's goal, or omit it when the story already says so.
- "watch": zero to three things worth a second look, each one sentence starting with what to check ("The retry loop has no cap"). Only what the diff shows.
- Return JSON only, matching the schema.`;

/* ------------------------------------------------------------------------- */
/* Budgeting the diff                                                         */
/* ------------------------------------------------------------------------- */

/** Full hunks under this many changed lines in the whole pull request. */
export const FULL_HUNKS_UNDER = 2000;
/** Excerpts (first and last changed lines of each hunk) under this; above it, headers only. */
export const EXCERPTS_UNDER = 10_000;
const EXCERPT_HEAD = 12;
const EXCERPT_TAIL = 6;
/** A changed line longer than this is cut; minified output would otherwise take the budget. */
const MAX_LINE_CHARS = 200;

export type DiffDetail = 'full' | 'excerpts' | 'headers';

export function diffDetailFor(input: PlanInput): DiffDetail {
  let changed = 0;
  for (const file of input.files) {
    if (file.hidden !== null) continue;
    for (const hunk of file.hunks) changed += hunk.added.length + hunk.removed.length;
  }
  if (changed < FULL_HUNKS_UNDER) return 'full';
  return changed < EXCERPTS_UNDER ? 'excerpts' : 'headers';
}

function cut(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

function changedLines(hunk: { readonly added: readonly string[]; readonly removed: readonly string[] }, detail: DiffDetail): readonly string[] {
  if (detail === 'headers') return [];
  const lines = [...hunk.removed.map((line) => `-${cut(line)}`), ...hunk.added.map((line) => `+${cut(line)}`)];
  if (detail === 'full' || lines.length <= EXCERPT_HEAD + EXCERPT_TAIL) return lines;
  return [...lines.slice(0, EXCERPT_HEAD), `… ${lines.length - EXCERPT_HEAD - EXCERPT_TAIL} more changed lines …`, ...lines.slice(-EXCERPT_TAIL)];
}

/** The handles the prompt gives hunks (`h1`, `h2`, …) and what each stands for, in file order. */
export function hunkHandles(input: PlanInput): ReadonlyMap<string, HunkRef> {
  const handles = new Map<string, HunkRef>();
  let counter = 0;
  for (const file of input.files) {
    if (file.hidden !== null) continue;
    for (const ref of refsOf(file)) {
      counter += 1;
      handles.set(`h${counter}`, ref);
    }
  }
  return handles;
}

interface PromptHunk {
  readonly handle: string;
  readonly file: string;
  readonly status: string;
  readonly header: string;
  readonly lines?: readonly string[];
  readonly changed: number;
}

interface PromptStep {
  readonly key: string;
  readonly title: string;
  readonly kind: StepKind;
  readonly hunks: readonly string[];
}

export interface PlanPromptOptions {
  /** The rules producer's candidates (or the previous plan's steps, for a replan), as a starting point. */
  readonly candidates: readonly StepProposal[];
  /** For a replan: the previous plan and which hunk handles are new since it (the rest are the same changes). */
  readonly previous?: { readonly plan: ReviewPlan; readonly newHandles: readonly string[] };
}

export function planUserPrompt(input: PlanInput, options: PlanPromptOptions): string {
  const detail = diffDetailFor(input);
  const handles = hunkHandles(input);
  const handleOf = new Map<string, string>();
  for (const [handle, ref] of handles) handleOf.set(refKey(ref), handle);
  const files = new Map(input.files.map((file) => [file.path, file] as const));
  const hunks: PromptHunk[] = [];
  for (const [handle, ref] of handles) {
    const file = files.get(ref.path);
    if (file === undefined) continue;
    const hunk = file.hunks[ref.hunk];
    const entry: PromptHunk = {
      handle,
      file: file.path,
      status: file.status,
      header: hunk?.header ?? (file.binary ? 'binary file' : 'whole file'),
      changed: hunk === undefined ? 0 : hunk.added.length + hunk.removed.length,
    };
    const lines = hunk === undefined ? [] : changedLines(hunk, detail);
    hunks.push(lines.length === 0 ? entry : { ...entry, lines });
  }
  const toPrompt = (step: { readonly key: string; readonly title: string; readonly kind: StepKind; readonly touches: readonly HunkRef[] }): PromptStep => ({
    key: step.key,
    title: step.title,
    kind: step.kind,
    hunks: step.touches.map((ref) => handleOf.get(refKey(ref))).filter((handle): handle is string => handle !== undefined),
  });
  const body = input.body === null ? null : input.body.length > 2000 ? `${input.body.slice(0, 2000)}…` : input.body;
  const payload: Record<string, unknown> = {
    title: input.title,
    ...(body === null || body.trim() === '' ? {} : { description: body }),
    commits: input.commits.map((commit) => commit.message.split('\n')[0] ?? ''),
    detail: detail === 'full' ? 'every changed line' : detail === 'excerpts' ? 'the first and last changed lines of each hunk' : 'hunk headers only',
    hunks,
    hiddenFiles: input.files.filter((file) => file.hidden !== null).map((file) => file.path),
    candidates: options.candidates.map(toPrompt),
  };
  const moves = movesOf(input)
    .map((move) => {
      const from = handleOf.get(refKey(move.from));
      const to = handleOf.get(refKey(move.to));
      return from === undefined || to === undefined ? null : `${from} → ${to} · ${move.lines} lines${move.exact ? '' : ' (reindented)'}`;
    })
    .filter((line): line is string => line !== null);
  if (moves.length > 0) payload.moves = moves;
  if (options.previous !== undefined) {
    payload.previousSteps = options.previous.plan.steps.filter((step) => step.touches.length > 0).map((step) => toPrompt({ key: step.id, title: step.title, kind: step.kind, touches: step.touches }));
    payload.newHunks = options.previous.newHandles;
    // The previous steps are keyed by their ids, so the previous overview's step references already fit.
    if (options.previous.plan.overview !== undefined) payload.previousOverview = options.previous.plan.overview;
  }
  if (input.findings.length > 0) payload.openFindings = input.findings.map((finding) => (finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`));
  return JSON.stringify(payload, null, 1);
}

/* ------------------------------------------------------------------------- */
/* Plan output                                                                */
/* ------------------------------------------------------------------------- */

const STEP_REF = { type: ['string', 'null'] } as const;

export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps', 'overview'],
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'kind', 'gist', 'hunks', 'dependsOn', 'watch'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: [...STEP_KINDS] },
          gist: { type: 'string' },
          hunks: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' } },
          watch: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    overview: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'points', 'beforeAfter', 'flow'],
      properties: {
        summary: { type: 'string' },
        points: { type: 'array', items: { type: 'string' } },
        beforeAfter: {
          type: 'object',
          additionalProperties: false,
          required: ['caption', 'lines'],
          properties: {
            caption: { type: 'string' },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'text', 'depth', 'step'],
                properties: { kind: { type: 'string', enum: ['same', 'before', 'after'] }, text: { type: 'string' }, depth: { type: 'integer' }, step: STEP_REF },
              },
            },
          },
        },
        flow: {
          type: 'object',
          additionalProperties: false,
          required: ['caption', 'nodes', 'edges'],
          properties: {
            caption: { type: 'string' },
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'label', 'file', 'kind', 'step'],
                properties: { id: { type: 'string' }, label: { type: 'string' }, file: { type: ['string', 'null'] }, kind: { type: 'string', enum: [...FLOW_NODE_KINDS] }, step: STEP_REF },
              },
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['from', 'to', 'label'],
                properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: ['string', 'null'] } },
              },
            },
          },
        },
      },
    },
  },
} as const;

const stepRef = z.string().nullable().optional();

const planOutputSchema = z.object({
  steps: z.array(
    z.object({
      key: z.string().min(1),
      title: z.string().min(1).max(160),
      kind: z.string(),
      gist: z.string().max(400).optional(),
      hunks: z.array(z.string()),
      dependsOn: z.array(z.string()).optional(),
      watch: z.array(z.string().max(300)).optional(),
    }),
  ),
  // Lenient on purpose: a model that answers the steps alone still gives a plan.
  overview: z
    .object({
      summary: z.string().max(2000).optional(),
      points: z.array(z.string().max(300)).optional(),
      beforeAfter: z
        .object({
          caption: z.string().max(200).optional(),
          lines: z.array(z.object({ kind: z.string(), text: z.string().max(300), depth: z.number().optional(), step: stepRef })).optional(),
        })
        .nullable()
        .optional(),
      flow: z
        .object({
          caption: z.string().max(200).optional(),
          nodes: z.array(z.object({ id: z.string().min(1), label: z.string().max(200), file: z.string().nullable().optional(), kind: z.string().optional(), step: stepRef })).optional(),
          edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().nullable().optional() })).optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

export interface PlanOutput {
  readonly steps: readonly StepProposal[];
  /** Step references are the answer's keys; `normalizePlan` turns them into ids. */
  readonly overview: PlanOverview | null;
}

const MAX_FLOW_NODES = 12;

function overviewOf(raw: NonNullable<z.infer<typeof planOutputSchema>['overview']>, keys: ReadonlySet<string>): PlanOverview | null {
  const summary = raw.summary?.trim() ?? '';
  const points = (raw.points ?? []).map((point) => point.trim()).filter((point) => point !== '').slice(0, 5);
  const ref = (key: string | null | undefined): string | null => (typeof key === 'string' && keys.has(key.trim()) ? key.trim() : null);
  const kindOf = (kind: string): BeforeAfterKind => (kind === 'before' || kind === 'after' ? kind : 'same');
  const lines: BeforeAfterLine[] = (raw.beforeAfter?.lines ?? [])
    .map((line) => ({
      kind: kindOf(line.kind),
      text: line.text.trim(),
      depth: Math.max(0, Math.min(3, Math.round(line.depth ?? 0))),
      step: ref(line.step),
    }))
    .filter((line) => line.text !== '');
  const beforeAfter = raw.beforeAfter === null || raw.beforeAfter === undefined || lines.length === 0 ? null : { caption: raw.beforeAfter.caption?.trim() ?? '', lines };
  const nodes: FlowNode[] = (raw.flow?.nodes ?? [])
    .map((node): FlowNode => ({ id: node.id.trim(), label: node.label.trim(), file: typeof node.file === 'string' && node.file.trim() !== '' ? node.file.trim() : null, kind: isFlowNodeKind(node.kind) ? node.kind : 'changed', step: ref(node.step) }))
    .filter((node) => node.id !== '' && node.label !== '')
    .slice(0, MAX_FLOW_NODES);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (raw.flow?.edges ?? []).map((edge) => ({ from: edge.from.trim(), to: edge.to.trim(), label: typeof edge.label === 'string' && edge.label.trim() !== '' ? edge.label.trim() : null })).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to);
  const flow = raw.flow === null || raw.flow === undefined || nodes.length === 0 ? null : { caption: raw.flow.caption?.trim() ?? '', nodes, edges };
  if (summary === '' && points.length === 0 && beforeAfter === null && flow === null) return null;
  return { summary, points, beforeAfter, flow };
}

function parseJsonObject(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly string[] } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, issues: ['$: Model output is not JSON.'] };
  }
}

function issuesOf(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`);
}

/**
 * The model's steps as proposals: handles the prompt did not give are
 * dropped, an unknown kind reads `other`, and `dependsOn` keeps only keys
 * the answer defines. `normalizePlan` then enforces coverage.
 */
export function parsePlanOutput(text: string, handles: ReadonlyMap<string, HunkRef>): PromptParse<PlanOutput> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = planOutputSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const keys = new Set(parsed.data.steps.map((step) => step.key));
  const overview = parsed.data.overview === null || parsed.data.overview === undefined ? null : overviewOf(parsed.data.overview, keys);
  const proposals: StepProposal[] = parsed.data.steps.map((step) => {
    const gist = step.gist?.trim() ?? '';
    return {
      key: step.key,
      title: step.title.trim().replace(/\.$/, ''),
      kind: isStepKind(step.kind) ? step.kind : 'other',
      gist: gist === '' ? null : gist,
      touches: step.hunks.map((handle) => handles.get(handle.trim())).filter((ref): ref is HunkRef => ref !== undefined),
      dependsOn: (step.dependsOn ?? []).filter((key) => keys.has(key) && key !== step.key),
      watch: (step.watch ?? []).map((item) => item.trim()).filter((item) => item !== ''),
    };
  });
  return { ok: true, value: { steps: proposals.filter((proposal) => proposal.touches.length > 0), overview } };
}

/* ------------------------------------------------------------------------- */
/* Story                                                                      */
/* ------------------------------------------------------------------------- */

/** How many changed lines of the step the story prompt carries in full before excerpting. */
const STORY_FULL_UNDER = 1500;

/** `moves: ["31 lines moved from a.ts (old line 38) to b.ts (line 6)"]` for the step's hunks, or nothing. */
function movesLine(input: PlanInput, step: ReviewStep): { readonly moves?: readonly string[] } {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ref of step.touches) {
    for (const move of movesTouching(movesOf(input), ref)) {
      const key = `${refKey(move.from)}>${refKey(move.to)}@${move.from.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`${move.lines} lines moved from ${move.from.path} (old line ${move.from.line}) to ${move.to.path} (line ${move.to.line})${move.exact ? '' : ', reindented'}`);
    }
  }
  return lines.length === 0 ? {} : { moves: lines };
}

export function storyUserPrompt(input: PlanInput, plan: ReviewPlan, step: ReviewStep): string {
  const files = new Map(input.files.map((file) => [file.path, file] as const));
  const size = step.touches.reduce((sum, ref) => sum + (files.get(ref.path)?.hunks[ref.hunk]?.added.length ?? 0) + (files.get(ref.path)?.hunks[ref.hunk]?.removed.length ?? 0), 0);
  const detail: DiffDetail = size < STORY_FULL_UNDER ? 'full' : 'excerpts';
  const index = plan.steps.findIndex((candidate) => candidate.id === step.id);
  const payload = {
    pullRequest: input.title,
    plan: plan.steps.map((candidate, position) => `${position + 1}. ${candidate.title}${candidate.gist === null ? '' : ` — ${candidate.gist}`}`),
    step: index + 1,
    title: step.title,
    kind: step.kind,
    ...(step.gist === null ? {} : { gist: step.gist }),
    touches: touchesSummary(step).map((entry) => `${entry.path} (${entry.hunks} ${entry.hunks === 1 ? 'hunk' : 'hunks'})`),
    supporting: [...new Set(step.supporting.map((ref) => ref.path))],
    ...movesLine(input, step),
    hunks: step.touches.map((ref) => {
      const file = files.get(ref.path);
      const hunk = file?.hunks[ref.hunk];
      return {
        file: ref.path,
        header: hunk?.header ?? (file?.binary === true ? 'binary file' : 'whole file'),
        lines: hunk === undefined ? [] : changedLines(hunk, detail),
      };
    }),
  };
  return JSON.stringify(payload, null, 1);
}

export const STORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['story', 'why', 'watch'],
  properties: {
    story: { type: 'string' },
    why: { type: 'string' },
    watch: { type: 'array', items: { type: 'string' } },
  },
} as const;

const storyOutputSchema = z.object({
  story: z.string().min(1).max(2000),
  why: z.string().max(400).optional(),
  watch: z.array(z.string().max(300)).optional(),
});

export interface StoryOutput {
  readonly story: string;
  readonly why: string | null;
  readonly watch: readonly string[];
}

export function parseStoryOutput(text: string): PromptParse<StoryOutput> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = storyOutputSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const why = parsed.data.why?.trim() ?? '';
  return {
    ok: true,
    value: {
      story: parsed.data.story.trim(),
      why: why === '' ? null : why,
      watch: (parsed.data.watch ?? [])
        .map((item) => item.trim())
        .filter((item) => item !== '')
        .slice(0, 3),
    },
  };
}
