import { z } from 'zod';
const schema = z
  .object({
    mode: z.enum(['personal', 'team']),
    batch: z.number().int().min(0).max(15999),
    pullPage: z.number().int().min(1).max(4000),
  })
  .strict();
export type QueueCursor = z.infer<typeof schema>;
export function readQueueCursor(raw: string | null, mode: QueueCursor['mode']): QueueCursor | null {
  if (!raw || raw === '1') return { mode, batch: 0, pullPage: 1 };
  if (/^[1-9]\d{0,3}$/.test(raw)) {
    const page = Number(raw);
    return page <= 4000 ? { mode, batch: page - 1, pullPage: 1 } : null;
  }
  if (!raw.startsWith('q.') || raw.length > 200) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(raw.slice(2), 'base64url').toString('utf8')));
    return parsed.success && parsed.data.mode === mode ? parsed.data : null;
  } catch {
    return null;
  }
}
export function writeQueueCursor(cursor: QueueCursor): string {
  return `q.${Buffer.from(JSON.stringify(schema.parse(cursor))).toString('base64url')}`;
}
export function nextQueueCursor(cursor: QueueCursor, morePulls: boolean, moreRepositories: boolean): string | null {
  if (morePulls) return cursor.pullPage < 4000 ? writeQueueCursor({ ...cursor, pullPage: cursor.pullPage + 1 }) : null;
  return moreRepositories && cursor.batch < 15999
    ? writeQueueCursor({ ...cursor, batch: cursor.batch + 1, pullPage: 1 })
    : null;
}
