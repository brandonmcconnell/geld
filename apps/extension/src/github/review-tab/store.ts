/**
 * What the Review tab keeps on this device: the plan per pull request (with
 * the stories written so far) and the reader's progress through it. Both are
 * keyed `github[@host]:/owner/repo/pull/N` and capped at the most recent
 * pull requests, oldest out. Nothing is written to GitHub.
 */

import type { ReviewPlan, ReviewProgress, StoryOutput } from '@geld/review';
import type { ReviewPlanRecord } from '../../lib/local-state';
import { REVIEW_PLANS_CAP, reviewPlansItem, reviewProgressItem } from '../../lib/local-state';

/** The storage key of a pull request on this host: `github:/o/r/pull/1`, `github@ghe.example.com:/o/r/pull/1`. */
export function reviewKey(stateKey: string, host = location.hostname): string {
  return host === 'github.com' ? `github:${stateKey}` : `github@${host}:${stateKey}`;
}

function capped<T extends { readonly savedAt: string }>(records: Readonly<Record<string, T>>): Record<string, T> {
  const copy: Record<string, T> = { ...records };
  const keys = Object.keys(copy);
  if (keys.length <= REVIEW_PLANS_CAP) return copy;
  const oldest = keys.sort((a, b) => Date.parse(copy[a]?.savedAt ?? '') - Date.parse(copy[b]?.savedAt ?? '')).slice(0, keys.length - REVIEW_PLANS_CAP);
  for (const key of oldest) delete copy[key];
  return copy;
}

export async function loadPlanRecord(key: string): Promise<ReviewPlanRecord | null> {
  return (await reviewPlansItem.getValue())[key] ?? null;
}

export async function savePlanRecord(key: string, record: ReviewPlanRecord): Promise<void> {
  const all = { ...(await reviewPlansItem.getValue()) };
  all[key] = record;
  await reviewPlansItem.setValue(capped(all));
}

export async function clearPlanRecord(key: string): Promise<void> {
  const all = { ...(await reviewPlansItem.getValue()) };
  delete all[key];
  await reviewPlansItem.setValue(all);
}

/** A record with a new plan: the current one becomes `previous`, stories for steps that still exist are kept. */
export function recordWithPlan(record: ReviewPlanRecord | null, plan: ReviewPlan, savedAt: string): ReviewPlanRecord {
  const ids = new Set(plan.steps.map((step) => step.id));
  const stories = Object.fromEntries(Object.entries(record?.stories ?? {}).filter(([id]) => ids.has(id)));
  const previous = record?.plan;
  return { plan, ...(previous === undefined || previous.id === plan.id ? {} : { previous }), stories, savedAt };
}

export function recordWithStory(record: ReviewPlanRecord, stepId: string, fingerprint: string, story: StoryOutput, model: string, at: string): ReviewPlanRecord {
  return { ...record, stories: { ...record.stories, [stepId]: { ...story, model, at, fingerprint } }, savedAt: at };
}

export function recordWithError(record: ReviewPlanRecord, error: string | null, at: string): ReviewPlanRecord {
  const { error: _previous, ...rest } = record;
  return error === null ? { ...rest, savedAt: at } : { ...rest, error, savedAt: at };
}

export async function loadProgress(key: string): Promise<ReviewProgress | null> {
  const stored = (await reviewProgressItem.getValue())[key];
  return stored === undefined ? null : { planId: stored.planId, steps: stored.steps, current: stored.current };
}

export async function saveProgress(key: string, progress: ReviewProgress): Promise<void> {
  const all = { ...(await reviewProgressItem.getValue()) };
  all[key] = { ...progress, savedAt: new Date().toISOString() };
  await reviewProgressItem.setValue(capped(all));
}

export async function clearProgress(key: string): Promise<void> {
  const all = { ...(await reviewProgressItem.getValue()) };
  delete all[key];
  await reviewProgressItem.setValue(all);
}
