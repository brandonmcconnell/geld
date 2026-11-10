import { CATEGORIES } from '@geld/core';
import { z } from 'zod';
export const queueDigestSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('stale') }),
  z.object({
    state: z.literal('current'),
    open: z.number().int().nonnegative(),
    needsReply: z.number().int().nonnegative(),
    unresolvedThreads: z.number().int().nonnegative().nullable().optional(),
    approvedBy: z.array(z.string()).optional(),
    approvals: z.number().int().nonnegative(),
    changesRequested: z.number().int().nonnegative(),
    partial: z.boolean(),
    bots: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        verdict: z.enum(['clean', 'findings', 'failed', 'running', 'unknown', 'skipped', 'earlier']),
        score: z.number().optional(),
      }),
    ),
  }),
]);
export type QueueDigest = z.infer<typeof queueDigestSchema>;

export const changeCountSchema = z.object({ files: z.number(), additions: z.number(), deletions: z.number() });
export const queueInsightSchema = z.object({
  headSha: z.string(),
  digest: queueDigestSchema.nullable().optional(),
  essential: changeCountSchema,
  hidden: changeCountSchema,
  categories: z.array(
    changeCountSchema.extend({
      id: z.string(),
      label: z.string(),
      shortNoun: z.string().optional(),
      shortNounPlural: z.string().optional(),
    }),
  ),
  requesters: z.array(z.string()).nullable(),
});
export type QueueInsight = z.infer<typeof queueInsightSchema>;

export function hiddenFilesLabel(insight: QueueInsight): string {
  const only = insight.categories.length === 1 ? insight.categories[0] : undefined;
  const category = only && CATEGORIES.find((item) => item.id === only.id);
  const noun =
    insight.hidden.files === 1
      ? (only?.shortNoun ?? category?.shortNoun)
      : (only?.shortNounPlural ?? category?.shortNounPlural);
  return `${insight.hidden.files} ${noun ?? 'hidden'}`;
}
