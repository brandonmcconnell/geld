import { z } from 'zod';
export const pairingSchema = z
  .object({
    version: z.literal(1),
    brokerUrl: z.url().refine((raw) => {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
    }),
    channel: z.string().uuid(),
    secret: z.string().min(64).max(200),
    kind: z.literal('claude'),
  })
  .strict();
