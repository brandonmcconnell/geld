import { z } from 'zod';
import type { RawCheckRun } from './bots';
import type { BotVerdictRecord, GeldPrMeta, PreviewRecord, ReviewItem, ReviewProvider } from './model';
import { botVerdictSchema, previewRecordSchema, REVIEW_PROVIDERS, REVIEWER_STATES, reviewItemSchema } from './model';
import type { ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput } from './provider-review';
import { buildProviderReviewItems, providerReviewKey, providerReviewUrl } from './provider-review';

/**
 * One document per pull or merge request that every host fills and every renderer reads.
 * It holds facts only: no DOM, no callbacks, nothing a host would need to be asked again.
 * `GeldPrMeta` stays the Action's wire format and is lifted in by `digestFromMeta`.
 */

export const DIGEST_AREAS = ['comments', 'threads', 'reviews', 'checks', 'activity', 'tasks', 'bots', 'previews'] as const;
export type DigestArea = (typeof DIGEST_AREAS)[number];

export const COVERAGE_STATES = ['complete', 'partial', 'unavailable'] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

export const SUBJECT_STATES = ['open', 'draft', 'merged', 'closed', 'unknown'] as const;
export const CHECK_STATES = ['success', 'failure', 'running', 'queued', 'manual', 'skipped', 'neutral', 'cancelled', 'unknown'] as const;
export const REQUEST_STATES = ['pending', 'not-pending', 'unknown'] as const;
export const RULE_STATES = ['passed', 'failed', 'pending', 'unknown'] as const;
export const EVENT_KINDS = ['push', 'commit', 'state', 'task', 'activity'] as const;

const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a timestamp.');
const nonEmpty = z.string().refine((value) => value.trim() !== '', 'Expected a value.');

export const digestSubjectSchema = z.object({
  provider: z.enum(REVIEW_PROVIDERS),
  origin: z.string(),
  repository: nonEmpty,
  id: z.string().regex(/^[1-9]\d*$/),
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/i),
  state: z.enum(SUBJECT_STATES),
  url: z.string(),
});

/** An account is a person or a bot, told by the host's own marks, never by how its name reads. */
export const digestAccountSchema = z.object({
  id: nonEmpty,
  login: nonEmpty,
  kind: z.enum(['person', 'bot']),
});

export const digestReviewerSchema = z.object({
  account: digestAccountSchema,
  standing: z.enum(REVIEWER_STATES),
  request: z.enum(REQUEST_STATES),
  anchor: z.string().optional(),
});

export const digestRuleSchema = z.object({ id: nonEmpty, label: nonEmpty, state: z.enum(RULE_STATES) });

export const digestRequirementSchema = z.object({
  approvalsRequired: z.number().int().min(0).nullable(),
  approvalsLeft: z.number().int().min(0).nullable(),
  rules: z.array(digestRuleSchema).nullable(),
}).refine((value) => value.approvalsRequired === null || value.approvalsLeft === null || value.approvalsLeft <= value.approvalsRequired, 'Approvals left cannot exceed approvals required.');

export const digestCheckSchema = z.object({
  name: nonEmpty,
  state: z.enum(CHECK_STATES),
  allowFailure: z.boolean().optional(),
  detailsUrl: z.string().optional(),
  sha: z.string().optional(),
});

export const digestEventSchema = z.object({
  id: nonEmpty,
  kind: z.enum(EVENT_KINDS),
  actorId: z.string().optional(),
  at: instant,
  url: z.string().optional(),
  headSha: z.string().optional(),
});

export const digestCoverageSchema = z.object({ state: z.enum(COVERAGE_STATES), reason: z.string().optional() });

/** What the host can do at all, so a layout never branches on the provider's name. */
export const digestCapabilitiesSchema = z.object({
  dismissReviews: z.boolean(),
  requestReviewers: z.boolean(),
  editHistory: z.boolean(),
  botAccounts: z.boolean(),
  mergeQueue: z.boolean(),
  deployments: z.boolean(),
});

export const digestDocumentSchema = z.object({
  v: z.literal(1),
  subject: digestSubjectSchema,
  reviewers: z.array(digestReviewerSchema),
  requirement: digestRequirementSchema.nullable(),
  bots: z.array(botVerdictSchema),
  checks: z.array(digestCheckSchema),
  items: z.array(reviewItemSchema),
  previews: z.array(previewRecordSchema),
  events: z.array(digestEventSchema),
  coverage: z.partialRecord(z.enum(DIGEST_AREAS), digestCoverageSchema),
  capabilities: digestCapabilitiesSchema,
});

export type DigestSubject = z.infer<typeof digestSubjectSchema>;
export type DigestAccount = z.infer<typeof digestAccountSchema>;
export type DigestReviewer = z.infer<typeof digestReviewerSchema>;
export type DigestRequirement = z.infer<typeof digestRequirementSchema>;
export type DigestCheck = z.infer<typeof digestCheckSchema>;
export type DigestEvent = z.infer<typeof digestEventSchema>;
export type DigestCoverage = z.infer<typeof digestCoverageSchema>;
export type DigestCapabilities = z.infer<typeof digestCapabilitiesSchema>;
export interface DigestDocument {
  readonly v: 1;
  readonly subject: DigestSubject;
  readonly reviewers: readonly DigestReviewer[];
  readonly requirement: DigestRequirement | null;
  readonly bots: readonly BotVerdictRecord[];
  readonly checks: readonly DigestCheck[];
  readonly items: readonly ReviewItem[];
  readonly previews: readonly PreviewRecord[];
  readonly events: readonly DigestEvent[];
  readonly coverage: Readonly<Partial<Record<DigestArea, DigestCoverage>>>;
  readonly capabilities: DigestCapabilities;
}

export const PROVIDER_CAPABILITIES: Readonly<Record<ReviewProvider, DigestCapabilities>> = {
  github: { dismissReviews: true, requestReviewers: true, editHistory: true, botAccounts: true, mergeQueue: true, deployments: true },
  gitlab: { dismissReviews: false, requestReviewers: true, editHistory: false, botAccounts: true, mergeQueue: true, deployments: true },
  bitbucket: { dismissReviews: false, requestReviewers: true, editHistory: false, botAccounts: true, mergeQueue: false, deployments: false },
};

function parse(document: DigestDocument): DigestDocument {
  const result = digestDocumentSchema.safeParse(document);
  if (!result.success) throw new TypeError(`Invalid digest document: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
  const issues = digestDocumentIssues(document);
  if (issues.length > 0) throw new TypeError(`Inconsistent digest document: ${issues.join('; ')}`);
  return document;
}

/** The area's coverage, `complete` unless the host said otherwise. */
export function coverageOf(document: DigestDocument, area: DigestArea): DigestCoverage {
  return document.coverage[area] ?? { state: 'complete' };
}

/** A row may say "none" only for an area it read whole; otherwise it says how much it saw. */
export function knownEmpty(document: DigestDocument, area: DigestArea, count: number): boolean {
  return count === 0 && coverageOf(document, area).state === 'complete';
}

/** Facts the schema cannot check alone. The conformance suite runs every adapter's fixtures through this. */
export function digestDocumentIssues(document: DigestDocument): readonly string[] {
  const issues: string[] = [];
  const reviewerIds = new Set<string>();
  for (const reviewer of document.reviewers) {
    if (reviewerIds.has(reviewer.account.id)) issues.push(`reviewer ${reviewer.account.login} is listed twice`);
    reviewerIds.add(reviewer.account.id);
  }
  const botIds = new Set<string>();
  for (const bot of document.bots) {
    if (botIds.has(bot.id)) issues.push(`bot ${bot.id} has two verdicts`);
    botIds.add(bot.id);
  }
  const itemIds = new Set<string>();
  for (const item of document.items) {
    if (itemIds.has(item.id)) issues.push(`item ${item.id} is listed twice`);
    itemIds.add(item.id);
  }
  if (coverageOf(document, 'threads').state === 'unavailable' && document.items.length > 0) issues.push('items are listed while threads are unavailable');
  if (coverageOf(document, 'reviews').state === 'unavailable' && document.reviewers.length > 0) issues.push('reviewers are listed while reviews are unavailable');
  if (coverageOf(document, 'checks').state === 'unavailable' && document.checks.length > 0) issues.push('checks are listed while checks are unavailable');
  if (document.subject.provider !== 'github' && document.subject.url !== providerReviewUrl(document.subject)) issues.push('subject url is not the review page');
  return issues;
}

function coverageFrom(entries: readonly { readonly area: string; readonly state: CoverageState; readonly reason?: string }[]): Partial<Record<DigestArea, DigestCoverage>> {
  const coverage: Partial<Record<DigestArea, DigestCoverage>> = {};
  const rank: Record<CoverageState, number> = { complete: 0, partial: 1, unavailable: 2 };
  for (const entry of entries) {
    const area = DIGEST_AREAS.find((candidate) => candidate === entry.area);
    if (area === undefined) throw new TypeError(`Unknown digest area: ${entry.area}`);
    const current = coverage[area];
    if (current !== undefined && rank[current.state] >= rank[entry.state]) continue;
    coverage[area] = entry.reason === undefined ? { state: entry.state } : { state: entry.state, reason: entry.reason };
  }
  return coverage;
}

function checkState(run: RawCheckRun): DigestCheck['state'] {
  if (run.status === 'in_progress') return 'running';
  if (run.status === 'queued' || run.status === 'pending' || run.status === 'waiting' || run.status === 'requested') return 'queued';
  switch (run.conclusion) {
    case 'success': return 'success';
    case 'failure':
    case 'timed_out':
    case 'action_required':
    case 'startup_failure':
    case 'stale': return 'failure';
    case 'skipped': return 'skipped';
    case 'neutral': return 'neutral';
    case 'cancelled': return 'cancelled';
    default: return 'unknown';
  }
}

export interface ProviderDigestParts {
  readonly input: ProviderReviewInput;
  readonly state?: DigestSubject['state'];
  readonly events?: readonly { readonly id: string; readonly url: string; readonly author: ProviderReviewAuthor; readonly createdAt: string; readonly kind?: DigestEvent['kind']; readonly headSha?: string }[];
  readonly approvalsRequired?: number | null;
  readonly approvalsLeft?: number | null;
  readonly requirements?: readonly { readonly id: string; readonly label: string; readonly state: DigestRuleState }[] | null;
  readonly unavailable?: readonly { readonly area: string; readonly reason: string }[];
  readonly sourceCoverage?: { readonly comments: CoverageState; readonly threads: CoverageState };
  readonly previews?: readonly PreviewRecord[];
  readonly bots?: readonly BotVerdictRecord[];
  readonly items?: readonly ReviewItem[];
  readonly comments?: readonly ProviderReviewComment[];
}

export type DigestRuleState = (typeof RULE_STATES)[number];

function account(author: ProviderReviewAuthor, bots: ReadonlySet<string>): DigestAccount {
  return { id: author.id, login: author.login, kind: author.automated === true || bots.has(author.id) ? 'bot' : 'person' };
}

// Mirrors the labels GitLab and Bitbucket readers give a source they could not read; null labels describe no area.
const AREA_ALIASES: ReadonlyMap<string, { readonly area: DigestArea; readonly state: CoverageState } | null> = new Map([
  ['thread state', { area: 'threads', state: 'partial' }],
  ['CI checks', { area: 'checks', state: 'unavailable' }],
  ['approval requirements', null],
  ['Published summary', null],
  ['Refresh', null],
]);

/** GitLab and Bitbucket fill the document from what their adapters already read. */
export function digestFromProvider(parts: ProviderDigestParts): DigestDocument {
  const { input } = parts;
  providerReviewKey(input.subject);
  const bots = new Set([
    ...(input.bots ?? []).map((bot) => bot.authorId),
    ...[...(parts.comments ?? []), ...input.threads.flatMap((thread) => thread.comments)].filter((comment) => comment.author.automated === true).map((comment) => comment.author.id),
  ]);
  const unavailable = parts.unavailable ?? [];
  const coverage = coverageFrom([
    ...unavailable.flatMap((entry) => {
      const alias = AREA_ALIASES.get(entry.area);
      if (alias === null) return [];
      return [{ area: alias?.area ?? entry.area, state: alias?.state ?? 'unavailable', reason: entry.reason }];
    }),
    ...(input.checksCoverage === undefined ? [] : [{ area: 'checks', state: input.checksCoverage }]),
    ...(parts.sourceCoverage === undefined ? [] : [{ area: 'comments', state: parts.sourceCoverage.comments }, { area: 'threads', state: parts.sourceCoverage.threads }]),
  ]);
  // A review source that failed while another answered leaves the reviewers read: partial, not none.
  if (input.reviewers === undefined) coverage.reviews = coverage.reviews?.state === 'unavailable' ? coverage.reviews : { state: 'unavailable', reason: coverage.reviews?.reason ?? 'The host did not list reviewers.' };
  else if (coverage.reviews?.state === 'unavailable') coverage.reviews = { ...coverage.reviews, state: 'partial' };
  const reviewsUnavailable = coverage.reviews?.state === 'unavailable';
  // Hosts report these loosely: a pair that does not add up is no requirement, not a broken document.
  const whole = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const valid = whole(parts.approvalsRequired) && whole(parts.approvalsLeft) && parts.approvalsRequired > 0 && parts.approvalsLeft <= parts.approvalsRequired;
  const required = valid ? parts.approvalsRequired ?? null : null;
  const left = valid ? parts.approvalsLeft ?? null : null;
  const rules = parts.requirements ?? null;
  return parse({
    v: 1,
    subject: { ...input.subject, state: parts.state ?? (input.closed === true ? 'closed' : 'unknown'), url: providerReviewUrl(input.subject) },
    reviewers: reviewsUnavailable ? [] : (input.reviewers ?? []).map((reviewer) => ({
      account: account(reviewer.author, bots),
      standing: reviewer.state,
      request: reviewer.reviewRequest ?? (reviewer.state === 'pending' ? 'pending' : 'unknown'),
      ...(reviewer.anchor === undefined ? {} : { anchor: reviewer.anchor }),
    })),
    requirement: required === null && left === null && rules === null ? null : { approvalsRequired: required, approvalsLeft: left, rules: rules === null ? null : rules.map((rule) => ({ ...rule })) },
    bots: [...(parts.bots ?? [])],
    checks: coverage.checks?.state === 'unavailable' ? [] : (input.checks ?? []).map((run) => ({
      name: run.name,
      state: run.nativeStatus === 'manual' ? 'manual' : checkState(run),
      ...(run.allowFailure === undefined ? {} : { allowFailure: run.allowFailure }),
      ...(run.detailsUrl === undefined ? {} : { detailsUrl: run.detailsUrl }),
    })),
    items: coverage.threads?.state === 'unavailable' ? [] : [...(parts.items ?? buildProviderReviewItems(input))],
    previews: [...(parts.previews ?? [])],
    events: (parts.events ?? []).map((event) => ({
      id: event.id,
      kind: event.kind ?? 'activity',
      actorId: event.author.id,
      at: event.createdAt,
      url: event.url,
      ...(event.headSha === undefined ? {} : { headSha: event.headSha }),
    })),
    coverage,
    capabilities: PROVIDER_CAPABILITIES[input.subject.provider],
  });
}

/** GitHub's Action payload lifted in; what the payload never carries is marked unavailable, not empty. */
export function digestFromMeta(meta: GeldPrMeta, subject: Omit<DigestSubject, 'headSha' | 'url'> & { readonly url: string }): DigestDocument {
  const coverage = coverageFrom([
    { area: 'checks', state: 'unavailable', reason: 'The summary payload carries no check runs.' },
    { area: 'activity', state: 'unavailable', reason: 'The summary payload carries no timeline events.' },
    ...(meta.truncated === true ? [{ area: 'threads', state: 'partial' as const, reason: 'The summary payload was truncated.' }] : []),
  ]);
  return parse({
    v: 1,
    subject: { ...subject, headSha: meta.headSha },
    reviewers: meta.reviewers.map((reviewer) => ({
      account: { id: reviewer.login, login: reviewer.login, kind: reviewer.login.endsWith('[bot]') ? 'bot' : 'person' },
      standing: reviewer.state,
      request: reviewer.state === 'pending' ? 'pending' : 'unknown',
    })),
    requirement: null,
    bots: [...meta.bots],
    checks: [],
    items: [...meta.items],
    previews: [...(meta.previews ?? [])],
    events: [],
    coverage,
    capabilities: PROVIDER_CAPABILITIES[subject.provider],
  });
}

