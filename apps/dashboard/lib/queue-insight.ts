import { z } from 'zod';
export const changeCountSchema = z.object({ files: z.number(), additions: z.number(), deletions: z.number() });
export const queueInsightSchema = z.object({
  headSha: z.string(),
  essential: changeCountSchema,
  hidden: changeCountSchema,
  categories: z.array(changeCountSchema.extend({ id: z.string(), label: z.string() })),
  requesters: z.array(z.string()).nullable(),
});
export type QueueInsight = z.infer<typeof queueInsightSchema>;
