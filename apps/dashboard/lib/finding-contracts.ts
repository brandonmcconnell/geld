import {z} from 'zod';
import {reviewItemSchema,reviewItemFrom} from '@geld/review/model';
export const findingResponse=z.object({items:z.array(reviewItemSchema.transform(reviewItemFrom)),credits:z.number(),model:z.string()});
