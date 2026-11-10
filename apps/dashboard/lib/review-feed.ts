import { z } from 'zod';
import { activitySchema, checkSchema } from '@geld/domain';
import type { ProviderActivity, ProviderCheck } from '@geld/domain';
export const feedResponseSchema = z.object({
  headSha: z.string(),
  page: z.object({
    items: z.array(z.union([activitySchema, checkSchema])),
    cursor: z.string().nullable(),
    capped: z.boolean(),
  }),
});
export interface ReviewFeed {
  activity: ProviderActivity[];
  checks: ProviderCheck[];
  activityCursor: string | null;
  checksCursor: string | null;
  activityUnavailable: boolean;
  checksUnavailable: boolean;
}
export const emptyFeed: ReviewFeed = {
  activity: [],
  checks: [],
  activityCursor: null,
  checksCursor: null,
  activityUnavailable: false,
  checksUnavailable: false,
};
