import { z } from 'zod';
import { threadSchema, commentSchema } from './review-contracts';
import { reviewItemSchema, reviewItemFrom } from '@geld/review/model';
export const findingResponse = z.object({
  items: z.array(reviewItemSchema.transform(reviewItemFrom)),
  credits: z.number(),
  model: z.string(),
  fingerprints: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  discussion: z.object({ threads: z.array(threadSchema), comments: z.array(commentSchema) }),
});
