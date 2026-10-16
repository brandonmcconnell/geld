import { z } from 'zod';

export const CRF_VERSION = 'v0' as const;
export const CRF_SCHEMA = `crf/${CRF_VERSION}` as const;

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const RUN_STATES = ['queued', 'running', 'completed', 'superseded', 'refused', 'failed', 'cancelled'] as const;
export const FINDING_STATES = ['new', 'persisting', 'fixed', 'withdrawn'] as const;
export const REFUSAL_CODES = [
  'disabled',
  'not_installed',
  'quota',
  'billing',
  'permissions',
  'too_large',
  'skipped_by_config',
  'other',
] as const;
export const TRIGGER_TYPES = ['push', 'comment', 'check', 'schedule', 'manual', 'api'] as const;
export const BLOCK_KINDS = ['summary', 'status', 'refusal', 'finding', 'reply'] as const;

export const Severity = z.enum(SEVERITIES);

const Sha = z.string().regex(/^[0-9a-f]{40}$/, 'a full 40-character lowercase commit SHA');
const PositiveInt = z.int().positive();

export const UrlAction = z.object({
  type: z.literal('url'),
  url: z.url(),
  label: z.string().min(1).optional(),
});

export const CommentAction = z.object({
  type: z.literal('comment'),
  body: z.string().min(1),
  label: z.string().min(1).optional(),
});

export const Action = z.discriminatedUnion('type', [UrlAction, CommentAction]);

export const Links = z.object({
  view: UrlAction.optional(),
  rerun: Action.optional(),
  fix: Action.optional(),
  settings: UrlAction.optional(),
});

export const Location = z.object({
  path: z.string().min(1),
  line: PositiveInt.optional(),
  startLine: PositiveInt.optional(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
});

export const Rule = z.object({
  source: z.enum(['repo', 'bot']),
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});

export const Finding = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: Severity,
  fingerprint: z.string().min(1).optional(),
  location: Location.optional(),
  related: z.array(Location).optional(),
  category: z.string().min(1).optional(),
  vendorSeverity: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  state: z.enum(FINDING_STATES).optional(),
  rule: Rule.optional(),
  commentId: PositiveInt.optional(),
  links: Links.pick({ view: true, fix: true }).optional(),
});

export const Bot = z.object({
  name: z.string().min(1),
  app: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
});

export const Trigger = z.object({
  type: z.enum(TRIGGER_TYPES),
  commentId: PositiveInt.optional(),
  by: z.string().min(1).optional(),
});

export const Run = z.object({
  id: z.string().min(1),
  state: z.enum(RUN_STATES),
  headSha: Sha,
  sequence: PositiveInt.optional(),
  track: z.enum(['code', 'security']).optional(),
  baseSha: Sha.optional(),
  scope: z.enum(['full', 'incremental']).optional(),
  coverage: z.object({ from: Sha.optional(), to: Sha }).optional(),
  part: z.object({ index: PositiveInt, total: PositiveInt }).optional(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  trigger: Trigger.optional(),
});

export const RunRef = Run.pick({ id: true });

export const Result = z.object({
  verdict: z.enum(['clean', 'findings']),
  score: z.object({ value: z.number(), max: z.number().positive() }).optional(),
  risk: z.enum(['minimal', 'low', 'moderate', 'high']).optional(),
  counts: z.partialRecord(Severity, z.int().nonnegative()).optional(),
  findings: z.array(Finding).optional(),
  truncated: z.boolean().optional(),
  resolvedSinceLast: z.int().nonnegative().optional(),
  previouslyMissed: z.int().nonnegative().optional(),
  gate: z.object({ blocking: z.boolean(), threshold: Severity.optional() }).optional(),
  recommendation: z.enum(['approve', 'comment', 'request_changes']).optional(),
});

export const Refusal = z.object({
  code: z.enum(REFUSAL_CODES),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
});

const base = {
  schema: z.literal(CRF_SCHEMA),
  bot: Bot,
  links: Links.optional(),
};

export const SummaryBlock = z.object({ ...base, kind: z.literal('summary'), run: Run, result: Result.optional() });
export const StatusBlock = z.object({ ...base, kind: z.literal('status'), run: Run });
export const RefusalBlock = z.object({ ...base, kind: z.literal('refusal'), run: Run, refusal: Refusal });
export const FindingBlock = z.object({ ...base, kind: z.literal('finding'), run: RunRef, finding: Finding });
export const ReplyBlock = z.object({ ...base, kind: z.literal('reply'), run: RunRef.optional() });

/** One block per comment. Also a Standard Schema (`CrfBlock['~standard']`), so any Standard Schema consumer can use it directly. */
export const CrfBlock = z.discriminatedUnion('kind', [SummaryBlock, StatusBlock, RefusalBlock, FindingBlock, ReplyBlock]);

export type Severity = z.infer<typeof Severity>;
export type UrlAction = z.infer<typeof UrlAction>;
export type CommentAction = z.infer<typeof CommentAction>;
export type Action = z.infer<typeof Action>;
export type Links = z.infer<typeof Links>;
export type Location = z.infer<typeof Location>;
export type Rule = z.infer<typeof Rule>;
export type Finding = z.infer<typeof Finding>;
export type Bot = z.infer<typeof Bot>;
export type Trigger = z.infer<typeof Trigger>;
export type Run = z.infer<typeof Run>;
export type RunRef = z.infer<typeof RunRef>;
export type Result = z.infer<typeof Result>;
export type Refusal = z.infer<typeof Refusal>;
export type SummaryBlock = z.infer<typeof SummaryBlock>;
export type StatusBlock = z.infer<typeof StatusBlock>;
export type RefusalBlock = z.infer<typeof RefusalBlock>;
export type FindingBlock = z.infer<typeof FindingBlock>;
export type ReplyBlock = z.infer<typeof ReplyBlock>;
export type CrfBlock = z.infer<typeof CrfBlock>;
export type BlockKind = CrfBlock['kind'];
