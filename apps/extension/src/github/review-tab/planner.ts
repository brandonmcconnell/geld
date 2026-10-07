/**
 * The Review tab's plan for the pull request on this page, and the reader's
 * progress through it. The rules producer runs by itself (free) the first
 * time a pull request is opened and whenever a push leaves the stored plan
 * behind; the model is asked only when the reader clicks Plan or Replan, and
 * a step's story only when the step is reached (the next one is prefetched).
 * Everything the model writes is kept on this device (`store.ts`).
 */

import type { GeldSettings } from '@geld/core';
import type { PlanInput, ReviewPlan, ReviewProgress, ReviewStep, StepProposal, StepState } from '@geld/review';
import {
  carryProgress,
  hunkHandles,
  isEvaluationModel,
  normalizePlan,
  parsePlanOutput,
  parseStoryOutput,
  PLAN_JSON_SCHEMA,
  PLAN_SYSTEM,
  planDelta,
  planSignatures,
  planUserPrompt,
  refKey,
  remapProposals,
  rulesPlan,
  rulesProposals,
  STORY_JSON_SCHEMA,
  STORY_SYSTEM,
  storyUserPrompt,
} from '@geld/review';
import { browser } from 'wxt/browser';
import type { ReviewPlanRecord, StoredStory } from '../../lib/local-state';
import { aiKeyItem } from '../../lib/local-state';
import type { AiCompleteRequest } from '../../lib/messages';
import { isAiCompleteResponse } from '../../lib/messages';
import { clearPlanRecord, clearProgress, loadPlanRecord, loadProgress, recordWithError, recordWithPlan, recordWithStory, savePlanRecord, saveProgress } from './store';

interface Visit {
  readonly key: string;
  record: ReviewPlanRecord | null;
  progress: ReviewProgress | null;
  loaded: boolean;
  /** The model is planning (or replanning). */
  planning: boolean;
  /** Steps whose story is being written. */
  storiesInFlight: Set<string>;
  /** Steps this visit already asked a story for, so a failure does not retry on every pass. */
  storiesAsked: Set<string>;
  /** The last input the plan was judged against, for the story prompt. */
  input: PlanInput | null;
  /** The plan as laid over the current diff (the stored one, or its remap after a push). */
  effective: ReviewPlan | null;
}

let visit: Visit | null = null;
let onChange: () => void = () => undefined;

/** Point the planner at a pull request; `notify` runs when stored state lands or a model answers. */
export function openPlanner(key: string, notify: () => void): void {
  onChange = notify;
  if (visit?.key === key) return;
  const fresh: Visit = { key, record: null, progress: null, loaded: false, planning: false, storiesInFlight: new Set(), storiesAsked: new Set(), input: null, effective: null };
  visit = fresh;
  void Promise.all([loadPlanRecord(key), loadProgress(key)]).then(([record, progress]) => {
    if (visit !== fresh) return;
    fresh.record = record;
    fresh.progress = progress;
    fresh.loaded = true;
    onChange();
  });
}

export function closePlanner(): void {
  visit = null;
  onChange = () => undefined;
}

export interface PlannerState {
  readonly loaded: boolean;
  readonly plan: ReviewPlan | null;
  readonly progress: ReviewProgress | null;
  readonly planning: boolean;
  /** The plan was made for an earlier head; `newHunks` says how many hunks it never saw. */
  readonly behind: { readonly newHunks: number; readonly goneHunks: number } | null;
  readonly error: string | null;
  readonly storiesInFlight: ReadonlySet<string>;
}

const EMPTY: PlannerState = { loaded: false, plan: null, progress: null, planning: false, behind: null, error: null, storiesInFlight: new Set() };

/**
 * The plan for `input`, from the store or the rules: a stored plan for this
 * head is used as is; one for an earlier head is laid over the current diff
 * (the rules' plan is simply remade, since it costs nothing); no plan means
 * the rules make one now and store it. Progress follows the plan's step ids.
 */
export function plannerState(input: PlanInput | null): PlannerState {
  const current = visit;
  if (current === null || !current.loaded) return EMPTY;
  if (input === null) return { ...EMPTY, loaded: true, plan: current.record?.plan ?? null, progress: current.progress, planning: current.planning, error: current.record?.error ?? null, storiesInFlight: current.storiesInFlight };
  current.input = input;
  const now = new Date().toISOString();
  let record = current.record;
  let behind: PlannerState['behind'] = null;
  if (record === null) {
    record = recordWithPlan(null, rulesPlan(input, now), now);
    current.record = record;
    void savePlanRecord(current.key, record);
  }
  let plan = record.plan;
  if (plan.headSha !== input.headSha) {
    const delta = planDelta(planSignatures(plan), input);
    if (plan.producer === 'rules') {
      // Free to remake: the stored rules plan follows the head, progress carried by step id.
      plan = rulesPlan(input, now);
      record = recordWithPlan(record, plan, now);
      current.record = record;
      void savePlanRecord(current.key, record);
    } else {
      plan = normalizePlan(input, remapProposals(record.plan, input), { producer: record.plan.producer, model: record.plan.model, madeAt: record.plan.madeAt, fromHeaders: record.plan.fromHeaders });
      behind = { newHunks: delta.added.length, goneHunks: delta.removed.length };
    }
  }
  current.effective = plan;
  if (current.progress !== null && current.progress.planId !== plan.id) {
    current.progress = carryProgress(current.progress, plan);
    void saveProgress(current.key, current.progress);
  }
  return { loaded: true, plan, progress: current.progress, planning: current.planning, behind, error: record.error ?? null, storiesInFlight: current.storiesInFlight };
}

/* ------------------------------------------------------------------------- */
/* Progress                                                                   */
/* ------------------------------------------------------------------------- */

function withProgress(update: (progress: ReviewProgress) => ReviewProgress): void {
  const current = visit;
  const plan = current?.effective ?? null;
  if (current === null || plan === null) return;
  const base = current.progress ?? { planId: plan.id, steps: {}, current: null };
  current.progress = update(base.planId === plan.id ? base : carryProgress(base, plan));
  void saveProgress(current.key, current.progress);
  onChange();
}

export function markStep(step: ReviewStep, state: StepState, note?: string): void {
  withProgress((progress) => ({
    ...progress,
    steps: { ...progress.steps, [step.id]: { state, at: new Date().toISOString(), fingerprint: step.fingerprint, ...(note === undefined || note.trim() === '' ? {} : { note: note.trim() }) } },
  }));
}

export function unmarkStep(step: ReviewStep): void {
  withProgress((progress) => {
    const steps = { ...progress.steps };
    delete steps[step.id];
    return { ...progress, steps };
  });
}

export function setCurrentStep(stepId: string | null): void {
  withProgress((progress) => (progress.current === stepId ? progress : { ...progress, current: stepId }));
}

/** Forget the plan (the rules make a new one on the next pass) but keep the marks: they carry over by step id. */
export async function dropPlan(): Promise<void> {
  const current = visit;
  if (current === null) return;
  current.record = null;
  current.effective = null;
  current.storiesAsked.clear();
  await clearPlanRecord(current.key);
  onChange();
}

export async function resetReview(): Promise<void> {
  const current = visit;
  if (current === null) return;
  current.progress = null;
  current.record = null;
  current.effective = null;
  current.storiesAsked.clear();
  await Promise.all([clearProgress(current.key), clearPlanRecord(current.key)]);
  onChange();
}

/* ------------------------------------------------------------------------- */
/* The model                                                                  */
/* ------------------------------------------------------------------------- */

/** The planning model: the Review tab's own when set, else the prose model; null when AI is off or incomplete. */
export function reviewModelFor(settings: GeldSettings): string | null {
  if (!settings.aiEnabled || settings.aiBaseUrl === '') return null;
  const model = settings.aiReviewModel !== '' ? settings.aiReviewModel : settings.aiModel;
  return model === '' || isEvaluationModel(model) ? null : model;
}

/** Whether a plan call can be made now: a model, a URL and a key on this device. */
export async function reviewAiReady(settings: GeldSettings): Promise<boolean> {
  return reviewModelFor(settings) !== null && (await aiKeyItem.getValue()).trim() !== '';
}

type Completion = { readonly ok: true; readonly text: string; readonly model: string } | { readonly ok: false; readonly reason: string };

async function complete(settings: GeldSettings, model: string, system: string, user: string, jsonSchema: unknown, schemaName: string): Promise<Completion> {
  const apiKey = (await aiKeyItem.getValue()).trim();
  if (apiKey === '') return { ok: false, reason: 'No AI gateway key on this device.' };
  const message: AiCompleteRequest = {
    type: 'geld:ai-complete',
    baseUrl: settings.aiBaseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    jsonSchema,
    schemaName,
  };
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The extension did not answer.' };
  }
  if (!isAiCompleteResponse(response)) return { ok: false, reason: 'The extension did not answer.' };
  return response.ok ? { ok: true, text: response.text, model: response.model } : { ok: false, reason: response.reason };
}

/**
 * Ask the model for the plan. `replan` starts from the stored plan laid over
 * the current diff and tells the model which hunks are new, so step ids (and
 * the progress bound to them) carry over where the change is the same;
 * otherwise the rules' candidates are the seed.
 */
export async function planWithAi(settings: GeldSettings, replan: boolean): Promise<void> {
  const current = visit;
  const input = current?.input ?? null;
  const model = reviewModelFor(settings);
  if (current === null || input === null || model === null || current.planning) return;
  current.planning = true;
  onChange();
  const previous = current.record?.plan ?? null;
  let candidates: readonly StepProposal[];
  let previousForPrompt: { readonly plan: ReviewPlan; readonly newHandles: readonly string[] } | undefined;
  if (replan && previous !== null) {
    candidates = remapProposals(previous, input);
    const known = planSignatures(previous);
    const handles = hunkHandles(input);
    const files = new Map(input.files.map((file) => [file.path, file] as const));
    const newHandles: string[] = [];
    for (const [handle, ref] of handles) {
      const hunk = files.get(ref.path)?.hunks[ref.hunk];
      const signature = hunk?.signature ?? refKey(ref);
      if (!known.has(signature)) newHandles.push(handle);
    }
    previousForPrompt = { plan: previous, newHandles };
  } else {
    candidates = rulesProposals(input);
  }
  const result = await complete(settings, model, PLAN_SYSTEM, planUserPrompt(input, { candidates, ...(previousForPrompt === undefined ? {} : { previous: previousForPrompt }) }), PLAN_JSON_SCHEMA, 'geld_review_plan');
  const now = new Date().toISOString();
  if (visit !== current) return;
  current.planning = false;
  let record = current.record ?? recordWithPlan(null, rulesPlan(input, now), now);
  if (!result.ok) {
    record = recordWithError(record, result.reason, now);
  } else {
    const parsed = parsePlanOutput(result.text, hunkHandles(input));
    if (!parsed.ok || parsed.value.length === 0) {
      record = recordWithError(record, 'The model answered in a shape Geld could not read.', now);
    } else {
      const plan = normalizePlan(input, parsed.value, { producer: 'ai', model: result.model, madeAt: now, fromHeaders: planIsFromHeaders(input) });
      record = recordWithError(recordWithPlan(record, plan, now), null, now);
      current.effective = plan;
      if (current.progress !== null) current.progress = carryProgress(current.progress, plan);
      current.storiesAsked.clear();
    }
  }
  current.record = record;
  await savePlanRecord(current.key, record);
  if (current.progress !== null) await saveProgress(current.key, current.progress);
  onChange();
}

function planIsFromHeaders(input: PlanInput): boolean {
  let changed = 0;
  for (const file of input.files) if (file.hidden === null) for (const hunk of file.hunks) changed += hunk.added.length + hunk.removed.length;
  return changed >= 10_000;
}

/**
 * The story of `step`: the stored one when it was written for these hunks,
 * else null while the model writes it (started here, once per visit, only
 * with AI configured). `prefetch` is the step to write next, started once
 * this one has an answer.
 */
export function storyFor(settings: GeldSettings, step: ReviewStep, prefetch: ReviewStep | null): StoredStory | null {
  const current = visit;
  if (current === null) return null;
  const stored = current.record?.stories[step.id];
  if (stored !== undefined && stored.fingerprint === step.fingerprint) {
    if (prefetch !== null) void writeStory(settings, prefetch, null);
    return stored;
  }
  void writeStory(settings, step, prefetch);
  return null;
}

async function writeStory(settings: GeldSettings, step: ReviewStep, then: ReviewStep | null): Promise<void> {
  const current = visit;
  const model = reviewModelFor(settings);
  if (current === null || model === null || current.input === null || current.effective === null) return;
  const stored = current.record?.stories[step.id];
  if (stored !== undefined && stored.fingerprint === step.fingerprint) return;
  if (current.storiesAsked.has(step.id) || current.storiesInFlight.has(step.id)) return;
  if (!(await reviewAiReady(settings))) return;
  current.storiesAsked.add(step.id);
  current.storiesInFlight.add(step.id);
  onChange();
  const result = await complete(settings, model, STORY_SYSTEM, storyUserPrompt(current.input, current.effective, step), STORY_JSON_SCHEMA, 'geld_review_story');
  if (visit !== current) return;
  current.storiesInFlight.delete(step.id);
  const now = new Date().toISOString();
  if (current.record !== null) {
    if (!result.ok) current.record = recordWithError(current.record, result.reason, now);
    else {
      const parsed = parseStoryOutput(result.text);
      if (parsed.ok) current.record = recordWithError(recordWithStory(current.record, step.id, step.fingerprint, parsed.value, result.model, now), null, now);
      else current.record = recordWithError(current.record, 'The model answered in a shape Geld could not read.', now);
    }
    await savePlanRecord(current.key, current.record);
  }
  onChange();
  if (then !== null && result.ok) void writeStory(settings, then, null);
}