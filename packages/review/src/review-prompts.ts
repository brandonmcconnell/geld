/**
 * Prompts for the Review tab's two model calls: the plan (which hunks form
 * which steps, in what order, with a gist each) and a step's story (what the
 * step does and why, in plain words). Outputs are JSON, schema-validated,
 * and every hunk handle and step key in an answer is checked against the
 * input, as `prompts.ts` does for the digest.
 */

import { z } from 'zod';
import type { PromptParse } from './prompts';
import type { HunkRef, PlanInput, ReviewPlan, ReviewStep, StepKind, StepProposal } from './review-plan';
import { isStepKind, refKey, refsOf, STEP_KINDS, STEP_SIZE_CAP, touchesSummary } from './review-plan';

export const PLAN_SYSTEM = `You plan a code review. A pull request's diff is given as numbered hunks (h1, h2, …), each with its file, header and changed lines, plus the pull request's title, its commits, and a first grouping made by simple rules. Group the hunks into steps a reviewer reads in order.
Rules:
- A step is one body of work: a feature slice, a fix, a refactor, a migration. Group by purpose, never by file type or by file. A hunk belongs to exactly one step. Every hunk listed must appear in some step; invent none.
- Order the steps so each reads with what came before it: foundations (types, data, shared helpers) before what uses them; the change the pull request is about before its follow-through. Name a dependency in "dependsOn" (step keys) only when reading the other step first is needed to understand this one.
- Prefer steps under ${STEP_SIZE_CAP} changed lines. A tiny pull request may be one step. Do not pad: a step with one hunk is fine when it is its own change.
- "key": s1, s2, … in reading order. "title": three to seven words, imperative or a noun phrase, naming the change not the files ("Debounce the search box", "Settings schema for the new toggle"). "kind": one of ${STEP_KINDS.join(', ')}. "gist": one sentence, under 160 characters, saying what the step does. "watch": zero to three short items worth a second look, only when the diff shows one.
- Files Geld hides (tests, generated output, fixtures) are listed by path only and are not hunks to place; their steps are decided afterwards.
- When "previousSteps" are given, the reader has already worked through them: keep a step's key where its hunks are the same change, and change only what the new and removed hunks require.
- Return JSON only, matching the schema.`;

export const STORY_SYSTEM = `You explain one step of a code review to the reviewer, who did not write the code. The whole plan is given for context, then the step's hunks in full.
Rules:
- "story": three to five short sentences. The first sentence is the point: what the step does. Then how it fits the pull request, and what the pieces do. Plain words; name a file only where the reader would otherwise be lost. Never say what is not in the diff. No praise, no "this PR", no headings or lists. Inline code in backticks is fine.
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
  if (options.previous !== undefined) {
    payload.previousSteps = options.previous.plan.steps.filter((step) => step.touches.length > 0).map((step) => toPrompt({ key: step.id, title: step.title, kind: step.kind, touches: step.touches }));
    payload.newHunks = options.previous.newHandles;
  }
  if (input.findings.length > 0) payload.openFindings = input.findings.map((finding) => (finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`));
  return JSON.stringify(payload, null, 1);
}

/* ------------------------------------------------------------------------- */
/* Plan output                                                                */
/* ------------------------------------------------------------------------- */

export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
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
  },
} as const;

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
});

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
export function parsePlanOutput(text: string, handles: ReadonlyMap<string, HunkRef>): PromptParse<readonly StepProposal[]> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = planOutputSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const keys = new Set(parsed.data.steps.map((step) => step.key));
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
  return { ok: true, value: proposals.filter((proposal) => proposal.touches.length > 0) };
}

/* ------------------------------------------------------------------------- */
/* Story                                                                      */
/* ------------------------------------------------------------------------- */

/** How many changed lines of the step the story prompt carries in full before excerpting. */
const STORY_FULL_UNDER = 1500;

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
