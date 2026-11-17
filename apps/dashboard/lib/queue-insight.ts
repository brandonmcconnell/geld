import { CATEGORIES } from '@geld/core';
import { z } from 'zod';
export const changeCountSchema = z.object({ files: z.number(), additions: z.number(), deletions: z.number() });
export const queueInsightSchema = z.object({
  headSha: z.string(),
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
