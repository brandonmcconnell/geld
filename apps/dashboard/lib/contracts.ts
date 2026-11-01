import { z } from 'zod';
import { capabilitySchema, pullRefSchema, resourceSchema } from '@geld/domain';
export const summarySchema = z.object({ ref: pullRefSchema, id: z.string(), title: z.string(), author: z.string(), authorAvatar: z.string().nullable(), state: z.enum(['open','closed','merged']), draft: z.boolean(), updatedAt: z.string(), url: z.string(), headSha: z.string(), baseSha: z.string(), additions: z.number(), deletions: z.number(), labels: z.array(z.string()), reviewers: z.array(z.string()) });
export const detailSchema = summarySchema.extend({ body: z.string(), capabilities: z.array(capabilitySchema) });
export const repositorySchema = z.object({ ref: resourceSchema, id: z.string(), private: z.boolean(), permission: z.enum(['none','read','triage','write','maintain','admin']), url: z.string() });
export const queueSchema = z.object({ pulls: z.array(summarySchema), repositories: z.array(repositorySchema), sources: z.array(z.object({ provider: z.string(), error: z.string().nullable(), more: z.boolean() })).optional() });
export const sessionSchema = z.object({ user: z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable().optional() }).nullable(), configured: z.boolean(), demo: z.boolean(), viewers: z.record(z.string(), z.string()).optional() });
export type QueueData = z.infer<typeof queueSchema>;
export type SessionData = z.infer<typeof sessionSchema>;
