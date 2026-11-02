import { z } from 'zod';
import type { DiffFile, DiffHunk } from '@geld/core';

// A -1 reference reviews the file's binary or metadata change when it has no text hunks.
export const hunkRefSchema = z.object({ path: z.string(), hunk: z.number().int().min(-1) });
export type HunkRef = z.infer<typeof hunkRefSchema>;
export const stepKindSchema = z.enum(['feature','fix','refactor','tests','docs','chore','generated','other']);
export const reviewStepSchema = z.object({
  id: z.string(), title: z.string().min(1).max(160), kind: stepKindSchema,
  story: z.string().nullable(), why: z.string().nullable(),
  touches: z.array(hunkRefSchema), supporting: z.array(hunkRefSchema),
  dependsOn: z.array(z.string()), watch: z.array(z.string()).max(3), findings: z.array(z.string()),
  fingerprint: z.string(),
});
export type ReviewStep = z.infer<typeof reviewStepSchema>;
export const reviewPlanSchema = z.object({ id: z.string(), headSha: z.string(), madeAt: z.string(), producer: z.literal('ai'), model: z.string(), steps: z.array(reviewStepSchema), unassigned: z.array(hunkRefSchema), excerpted: z.boolean() });
export type ReviewPlan = z.infer<typeof reviewPlanSchema>;
export interface PlanFile extends DiffFile { readonly hidden: boolean }
export const plannerOutputSchema = z.object({ steps: z.array(z.object({
  title: z.string().min(1).max(160), kind: stepKindSchema,
  story: z.string().max(4000), why: z.string().max(1000),
  touches: z.array(hunkRefSchema), supporting: z.array(hunkRefSchema),
  dependsOn: z.array(z.number().int().nonnegative()), watch: z.array(z.string().max(500)).max(3),
})).min(1).max(200) });
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export function reviewFingerprint(text: string): string {
  let hash = 14695981039346656037n;
  for (const code of text) { hash ^= BigInt(code.codePointAt(0) ?? 0); hash = BigInt.asUintN(64, hash * 1099511628211n); }
  return hash.toString(16).padStart(16, '0');
}
const refKey = (ref: HunkRef): string => JSON.stringify([ref.path, ref.hunk]);
function hunkText(hunk: DiffHunk): string {
  return hunk.lines.map((line) => `${line.kind}:${line.text}`).join('\n');
}
function fileRefs(file: PlanFile): HunkRef[] {
  return file.hunks.length ? file.hunks.map((_hunk, hunk) => ({ path: file.path, hunk })) : [{ path: file.path, hunk: -1 }];
}
export function seedReview(files: readonly PlanFile[]): readonly { readonly title: string; readonly touches: readonly HunkRef[]; readonly supporting: readonly HunkRef[] }[] {
  const visible = files.filter((file) => !file.hidden);
  const groups = new Map<string, { title: string; touches: HunkRef[]; supporting: HunkRef[] }>();
  for (const file of visible) {
    const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : 'Changes';
    const group = groups.get(directory) ?? { title: directory, touches: [], supporting: [] };
    group.touches.push(...fileRefs(file));
    groups.set(directory, group);
  }
  const seeds = [...groups.values()];
  for (const file of files.filter((file) => file.hidden)) {
    const stem = file.path.replace(/(?:\.test|\.spec)?\.[^.]+$/, '').split('/').pop() ?? '';
    const target = seeds.find((group) => group.touches.some((ref) => ref.path.includes(stem))) ?? seeds[0];
    if (target) target.supporting.push(...fileRefs(file));
  }
  return seeds;
}

export function normalizeReviewPlan(output: PlannerOutput, files: readonly PlanFile[], context: { readonly headSha: string; readonly model: string; readonly madeAt: string; readonly excerpted?: boolean }): ReviewPlan {
  const refs = new Map<string, { ref: HunkRef; hunk: DiffHunk | null; hidden: boolean; identity: string; fingerprint: string }>();
  for (const file of files) {
    if (!file.hunks.length) {
      const ref = { path: file.path, hunk: -1 };
      refs.set(refKey(ref), { ref, hunk: null, hidden: file.hidden, identity: JSON.stringify([file.path, 'file']), fingerprint: reviewFingerprint(JSON.stringify([context.headSha, file.status, file.kinds, file.binary])) });
      continue;
    }
    const identities = file.hunks.map((hunk) => reviewFingerprint(hunkText(hunk)));
    const counts = new Map<string, number>();
    for (const identity of identities) counts.set(identity, (counts.get(identity) ?? 0) + 1);
    file.hunks.forEach((hunk, index) => {
      const ref = { path: file.path, hunk: index };
      const fingerprint = identities[index] ?? '';
      const ambiguous = (counts.get(fingerprint) ?? 0) > 1;
      refs.set(refKey(ref), { ref, hunk, hidden: file.hidden, identity: JSON.stringify([file.path, fingerprint, ambiguous ? hunk.header : null]), fingerprint });
    });
  }
  const stableKey = (ref: HunkRef): string => refs.get(refKey(ref))?.identity ?? refKey(ref);
  const fingerprintFor = (items: readonly HunkRef[]): string => reviewFingerprint(items.map((ref) => `${stableKey(ref)}:${refs.get(refKey(ref))?.fingerprint ?? ''}`).sort().join('\n'));
  const used = new Set<string>();
  const steps: ReviewStep[] = [];
  const sourceToIds = new Map<number, string[]>();
  for (const [index, proposed] of output.steps.entries()) {
    const touches: HunkRef[] = [];
    const supporting: HunkRef[] = [];
    for (const ref of [...proposed.touches, ...proposed.supporting]) {
      const key = refKey(ref); const entry = refs.get(key);
      if (!entry || used.has(key)) continue;
      used.add(key);
      (entry.hidden ? supporting : touches).push(entry.ref);
    }
    if (!touches.length && !supporting.length) continue;
    const chunks: HunkRef[][] = [];
    let chunk: HunkRef[] = []; let size = 0;
    for (const ref of touches) {
      const count = refs.get(refKey(ref))?.hunk?.lines.filter((line) => line.kind === 'added' || line.kind === 'removed').length ?? 0;
      if (chunk.length && size + count > 400) { chunks.push(chunk); chunk = []; size = 0; }
      chunk.push(ref); size += count;
    }
    if (chunk.length) chunks.push(chunk);
    if (!chunks.length) chunks.push([]);
    const ids: string[] = [];
    chunks.forEach((part, split) => {
      const support = split === 0 ? supporting : [];
      const identity = part[0] ?? support[0];
      const id = `step-${reviewFingerprint(identity ? stableKey(identity) : String(index))}`;
      ids.push(id);
      const fingerprint = fingerprintFor([...part, ...support]);
      steps.push({ id, title: chunks.length > 1 ? `${proposed.title} (${split + 1})` : proposed.title, kind: proposed.kind, story: proposed.story, why: proposed.why, touches: part, supporting: support, dependsOn: [], watch: proposed.watch, findings: [], fingerprint });
    });
    sourceToIds.set(index, ids);
  }
  const unassigned: HunkRef[] = [];
  const remainingHidden: HunkRef[] = [];
  for (const [key, entry] of refs) if (!used.has(key)) (entry.hidden ? remainingHidden : unassigned).push(entry.ref);
  if (unassigned.length || remainingHidden.length) {
    const all = [...unassigned, ...remainingHidden];
    steps.push({ id: `step-${reviewFingerprint(all.map(stableKey).sort().join(':'))}`, title: unassigned.length ? 'Review the remaining changes' : 'Review supporting changes', kind: unassigned.length ? 'other' : 'tests', story: null, why: null, touches: [...unassigned], supporting: remainingHidden, dependsOn: [], watch: [], findings: [], fingerprint: fingerprintFor(all) });
  }
  const withDependencies = steps.map((step) => {
    const source = [...sourceToIds].find(([_index, ids]) => ids.includes(step.id));
    const proposed = source ? output.steps[source[0]] : undefined;
    const dependencies = proposed?.dependsOn.flatMap((index) => sourceToIds.get(index) ?? []).filter((id) => id !== step.id) ?? [];
    return { ...step, dependsOn: [...new Set(dependencies)] };
  });
  const ordered: ReviewStep[] = [];
  const pending = [...withDependencies];
  const done = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex((step) => step.dependsOn.every((id) => done.has(id)));
    const step = pending.splice(index < 0 ? 0 : index, 1)[0];
    if (step) { ordered.push({ ...step, dependsOn: step.dependsOn.filter((id) => done.has(id)) }); done.add(step.id); }
  }
  return { id: reviewFingerprint(`${context.headSha}:${ordered.map((step) => `${step.id}:${step.fingerprint}`).join(':')}`), headSha: context.headSha, madeAt: context.madeAt, producer: 'ai', model: context.model, steps: ordered, unassigned: [], excerpted: context.excerpted ?? false };
}

export interface StepProgress { readonly state: 'accepted' | 'flagged' | 'changed'; readonly fingerprint: string; readonly note: string; readonly at: string }
export function reconcileProgress(plan: ReviewPlan, previous: Readonly<Record<string, StepProgress>>): Readonly<Record<string, StepProgress>> {
  const result: Record<string, StepProgress> = {};
  for (const step of plan.steps) {
    const saved = previous[step.id];
    if (saved) result[step.id] = saved.fingerprint === step.fingerprint ? saved : { ...saved, state: 'changed' };
  }
  return result;
}
