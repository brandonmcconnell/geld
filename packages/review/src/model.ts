/**
 * The Geld PR summary payload: versioned, Zod-validated, and the only
 * machine-readable contract between the Action (or a future App) and the
 * extension. Comment text is never stored here — only ids, verdicts and
 * GitHub's own anchors, so the extension can map items to DOM nodes with
 * `getElementById`.
 */

import { z } from 'zod';

export const META_VERSION = 1 as const;

/** HTML comment the Action uses (via the GitHub API) to find its own summary. */
export const SUMMARY_MARKER = '<!-- geld:summary:v1 -->';
/** Visible heading; the extension matches this when the HTML comment is stripped. */
export const SUMMARY_HEADING = 'Geld review summary';
/**
 * The payload's carrier in the comment: an empty `<span>` whose `title`
 * attribute holds `geld:` + the JSON, HTML-escaped. GitHub's sanitizer
 * keeps `title` on a `span` and strips HTML comments, so this is the one
 * place in a rendered comment that is invisible to everyone (an empty
 * inline has no size, so no tooltip either) and still in the DOM for the
 * extension to read. Verified against GitHub's own renderer (the
 * `/markdown` API) in Oct 2026: the attribute round-trips byte for byte,
 * including quotes, angle brackets, backticks and `@`/`#` sequences.
 */
export const PAYLOAD_ATTR_PREFIX = 'geld:';
/** `<details>` summary older summaries showed for their payload fence (still read, never written). */
export const DATA_SUMMARY = 'Geld data';
/** Fence language older summaries used (`<pre lang="geld">`; still read, never written). */
export const PAYLOAD_FENCE = 'geld';

export const SITE_ORIGIN = 'https://www.geld.sh';

/** Keep the payload, as written into its attribute (`encodePayloadAttribute`), well under GitHub's 65,536-character comment cap. */
export const PAYLOAD_BUDGET = 40_000;

export const SEVERITIES = ['blocking', 'bug', 'suggestion', 'question', 'nit', 'praise'] as const;
export type ReviewSeverity = (typeof SEVERITIES)[number];

export const ITEM_STATUSES = ['open', 'needs-reply', 'addressed', 'done-manual', 'resolved', 'outdated'] as const;
export type ReviewItemStatus = (typeof ITEM_STATUSES)[number];

/** Open items first when truncating to the payload budget. */
export const STATUS_RANK: Readonly<Record<ReviewItemStatus, number>> = {
  open: 0,
  'needs-reply': 1,
  addressed: 2,
  outdated: 3,
  'done-manual': 4,
  resolved: 5,
};

/**
 * `loading` is the extension's alone: the page's timeline is still being
 * read and the bot's word may not have arrived (its only evidence so far is
 * an old request for it). The Action reads the whole timeline and never
 * produces it.
 */
/** `unknown`: a run asked for on a pull request since merged or closed, which the bot never answered in a comment — GitHub no longer shows the checks of the time, so there is no word either way. */
export const BOT_VERDICTS = ['clean', 'findings', 'failed', 'running', 'loading', 'unknown'] as const;
export type BotVerdict = (typeof BOT_VERDICTS)[number];

export const REVIEWER_STATES = ['approved', 'changes_requested', 'commented', 'pending'] as const;
export type ReviewerState = (typeof REVIEWER_STATES)[number];

export const SOURCE_KINDS = ['thread', 'comment', 'review'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const ADDRESSED_VERDICTS = ['yes', 'partly', 'no', 'unclear'] as const;
export type AddressedVerdict = (typeof ADDRESSED_VERDICTS)[number];

export const PRODUCER_KINDS = ['action', 'app', 'crawler'] as const;
export type ProducerKind = (typeof PRODUCER_KINDS)[number];

export const FIX_SOURCES = ['bot', 'human', 'ai'] as const;
export type FixSource = (typeof FIX_SOURCES)[number];

export const REVIEW_PROVIDERS = ['github', 'gitlab', 'bitbucket'] as const;
export type ReviewProvider = (typeof REVIEW_PROVIDERS)[number];

/** Native fragments, or Geld's explicit anchor for a provider source with no native fragment. */
export const SOURCE_ANCHOR_PATTERN = /^(discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+|event-\d+|note_\d+|discussion_[a-f0-9]{8,64}|comment[-_]\d+|geld-(?:github|gitlab|bitbucket)-(?:note|discussion|comment|thread|event|review)-[A-Za-z0-9_-]{1,180})$/;

const GITHUB_ANCHOR = /^(discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+|event-\d+)$/;
const GITLAB_ANCHOR = /^(note_\d+|discussion_[a-f0-9]{8,64})$/;
const BITBUCKET_ANCHOR = /^comment[-_]\d+$/;
const QUALIFIED_ANCHOR = /^geld-(github|gitlab|bitbucket)-(?:note|discussion|comment|thread|event|review)-[A-Za-z0-9_-]{1,180}$/;

export const sourceAnchorSchema = z.string().regex(SOURCE_ANCHOR_PATTERN).refine((value) => value.trim() === value);

export function isSourceAnchor(value: string): boolean {
  return value.trim() === value && SOURCE_ANCHOR_PATTERN.test(value);
}

export function isProviderSourceAnchor(provider: ReviewProvider, anchor: string): boolean {
  if (anchor.trim() !== anchor) return false;
  const qualified = QUALIFIED_ANCHOR.exec(anchor);
  if (qualified !== null) return qualified[1] === provider;
  if (provider === 'github') return GITHUB_ANCHOR.test(anchor);
  return provider === 'gitlab' ? GITLAB_ANCHOR.test(anchor) : BITBUCKET_ANCHOR.test(anchor);
}

export interface ReviewSource {
  readonly anchor: string;
  readonly kind: SourceKind;
  readonly author: string;
  readonly bot?: string;
  readonly sourceId?: string;
  readonly authorId?: string;
  readonly automated?: boolean;
  readonly provider?: ReviewProvider;
  readonly origin?: string;
  readonly url?: string;
}

export interface AddressedEvidence {
  readonly verdict: AddressedVerdict;
  readonly evidence: readonly string[];
}

/** A suggested change: the bot's ```suggestion block, a person's, or one the model proposed. */
export interface SuggestedFix {
  readonly text: string;
  readonly source: FixSource;
}

export interface ReviewItem {
  readonly id: string;
  readonly title: string;
  readonly rewritten: boolean;
  readonly severity: ReviewSeverity;
  readonly status: ReviewItemStatus;
  readonly path?: string;
  readonly line?: number;
  readonly sources: readonly ReviewSource[];
  readonly addressed?: AddressedEvidence;
  /** Merged context from every source that reported this, when it adds something the title does not. */
  readonly context?: string;
  readonly fix?: SuggestedFix;
}

/** The short read of the whole review state, written by the model and kept until the open set changes. */
export interface ReviewSummary {
  readonly tldr: string;
  readonly updatedAt: string;
  /** Sorted open item ids the TL;DR was written for; a different set means it needs another pass. */
  readonly forItems: readonly string[];
}

export const FINDING_SEVERITIES = ['low', 'medium', 'high'] as const;

export interface BotVerdictRecord {
  readonly id: string;
  readonly login: string;
  readonly verdict: BotVerdict;
  readonly count?: number;
  readonly score?: number;
  readonly severity?: (typeof FINDING_SEVERITIES)[number];
  readonly reviewedSha: string;
  readonly checkName?: string;
  /** Actual pipeline/status commit, when an authoritative association relates it to a different review head. */
  readonly checkSha?: string;
  readonly sourceId?: string;
  /** For a `failed` verdict the bot explained: its own words for why it did not review ("Bugbot is disabled for this repository"). */
  readonly reason?: string;
  /** The verdict was judged against the bot's check run's known start (`DerivedBotVerdict.runJudged`). */
  readonly runJudged?: true;
}

export interface ReviewerRecord {
  readonly login: string;
  readonly state: ReviewerState;
}

export interface ProducerRecord {
  readonly kind: ProducerKind;
  readonly version: string;
  readonly ai: boolean;
}

export interface FoldRecord {
  readonly comments: readonly string[];
  readonly events: readonly string[];
}

export interface NativePublication {
  readonly v: 1;
  readonly subject: {
    readonly provider: 'gitlab' | 'bitbucket';
    readonly origin: string;
    readonly repository: string;
    readonly id: string;
    readonly headSha: string;
  };
  readonly items: readonly {
    readonly itemId: string;
    readonly fingerprint: string;
    readonly sources: readonly {
      readonly id: string;
      readonly anchor: string;
      readonly authorId: string;
      readonly fingerprint: string;
    }[];
  }[];
}

export interface GeldPrMeta {
  readonly v: typeof META_VERSION;
  readonly generatedAt: string;
  readonly headSha: string;
  readonly producer: ProducerRecord;
  readonly items: readonly ReviewItem[];
  readonly bots: readonly BotVerdictRecord[];
  readonly reviewers: readonly ReviewerRecord[];
  readonly fold: FoldRecord;
  readonly truncated?: boolean;
  readonly summary?: ReviewSummary;
  /** Preview deployments the hosting bots posted, every comment's, in timeline order (the reader keeps the latest per project). */
  readonly previews?: readonly PreviewRecord[];
  readonly nativePublication?: NativePublication;
}

export const PREVIEW_STATUSES = ['ready', 'building', 'failed', 'skipped', 'unknown'] as const;
export type PreviewStatusRecord = (typeof PREVIEW_STATUSES)[number];

export interface PreviewRecord {
  readonly host: string;
  readonly project: string;
  readonly status: PreviewStatusRecord;
  readonly url: string | null;
  readonly inspectUrl: string | null;
  readonly anchor: string;
  readonly updatedAt?: string;
  /** Why there is no deployment, when the host said so in words ("X is not a member of the team"). */
  readonly reason?: string;
}

export interface GeldDeeplink {
  readonly v: typeof META_VERSION;
  readonly headSha: string;
  readonly generatedAt: string;
  readonly open: number;
  readonly total: number;
}

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { error: 'Expected an ISO date string.' });
const sha = z.string().regex(/^[0-9a-f]{7,40}$/i, { error: 'Expected a git SHA.' });

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' ? url.origin : null;
  } catch {
    return null;
  }
}

export const reviewSourceSchema = z.object({
  anchor: sourceAnchorSchema,
  kind: z.enum(SOURCE_KINDS),
  author: z.string().min(1),
  bot: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  authorId: z.string().min(1).optional(),
  automated: z.boolean().optional(),
  provider: z.enum(REVIEW_PROVIDERS).optional(),
  origin: z.string().optional(),
  url: z.string().optional(),
}).superRefine((source, context) => {
  if (source.provider !== undefined && (!isProviderSourceAnchor(source.provider, source.anchor) || source.origin === undefined)) {
    context.addIssue({ code: 'custom', path: ['anchor'], message: 'Expected an anchor and origin for the declared provider.' });
  }
  if (!GITHUB_ANCHOR.test(source.anchor) && source.provider === undefined) {
    context.addIssue({ code: 'custom', path: ['provider'], message: 'Native provider anchors require explicit provenance.' });
  }
  if (source.origin !== undefined && httpOrigin(source.origin) !== source.origin) {
    context.addIssue({ code: 'custom', path: ['origin'], message: 'Expected an HTTP(S) origin without credentials or a path.' });
  }
  if (source.url !== undefined && (source.origin === undefined || httpOrigin(source.url) !== source.origin)) {
    context.addIssue({ code: 'custom', path: ['url'], message: 'Expected an HTTP(S) URL on the source origin.' });
  }
});

export const addressedSchema = z.object({
  verdict: z.enum(ADDRESSED_VERDICTS),
  evidence: z.array(z.string().min(1)),
});

export const suggestedFixSchema = z.object({
  text: z.string().min(1),
  source: z.enum(FIX_SOURCES),
});

export const reviewItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rewritten: z.boolean(),
  severity: z.enum(SEVERITIES),
  status: z.enum(ITEM_STATUSES),
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  sources: z.array(reviewSourceSchema).min(1),
  addressed: addressedSchema.optional(),
  context: z.string().min(1).optional(),
  fix: suggestedFixSchema.optional(),
});

export const reviewSummarySchema = z.object({
  tldr: z.string().min(1),
  updatedAt: isoDate,
  forItems: z.array(z.string().min(1)),
});

export const botVerdictSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  verdict: z.enum(BOT_VERDICTS),
  count: z.number().int().nonnegative().optional(),
  score: z.number().optional(),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  reviewedSha: sha,
  checkName: z.string().min(1).optional(),
  checkSha: sha.optional(),
  sourceId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  runJudged: z.literal(true).optional(),
});

export const reviewerSchema = z.object({
  login: z.string().min(1),
  state: z.enum(REVIEWER_STATES),
});

export const producerSchema = z.object({
  kind: z.enum(PRODUCER_KINDS),
  version: z.string().min(1),
  ai: z.boolean(),
});

export const foldSchema = z.object({
  comments: z.array(sourceAnchorSchema),
  events: z.array(sourceAnchorSchema),
});

export const previewRecordSchema = z.object({
  host: z.string().min(1),
  project: z.string().min(1),
  status: z.enum(PREVIEW_STATUSES),
  url: z.string().url().nullable(),
  inspectUrl: z.string().url().nullable(),
  anchor: sourceAnchorSchema,
  updatedAt: isoDate.optional(),
  reason: z.string().min(1).max(200).optional(),
});

export const nativePublicationSchema = z.object({
  v: z.literal(1),
  subject: z.object({
    provider: z.enum(['gitlab', 'bitbucket']),
    origin: z.string().max(500).refine((value) => httpOrigin(value) === value),
    repository: z.string().min(3).max(500).refine((value) => {
      const parts = value.split('/');
      return parts.length >= 2 && parts.every((part) => /^[\p{L}\p{N}_.-]+$/u.test(part) && part !== '.' && part !== '..');
    }),
    id: z.string().regex(/^[1-9]\d{0,19}$/),
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  items: z.array(z.object({
    itemId: z.string().min(1).max(100),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    sources: z.array(z.object({
      id: z.string().regex(/^[1-9]\d{0,19}$/),
      anchor: sourceAnchorSchema,
      authorId: z.string().min(1).max(100),
      fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    })).min(1).max(20_000),
  })).max(5000),
}).superRefine((publication, context) => {
  const items = new Set<string>();
  const anchors = new Set<string>();
  const sourceIds = new Set<string>();
  publication.items.forEach((item, index) => {
    if (items.has(item.itemId)) context.addIssue({ code: 'custom', path: ['items', index, 'itemId'], message: 'Duplicate publication item.' });
    items.add(item.itemId);
    item.sources.forEach((source, position) => {
      const native = publication.subject.provider === 'gitlab' ? source.anchor === `note_${source.id}` : source.anchor === `comment-${source.id}` || source.anchor === `comment_${source.id}`;
      const account = publication.subject.provider === 'gitlab' ? /^[1-9]\d{0,19}$/.test(source.authorId) : /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(source.authorId) && source.authorId.startsWith('{') === source.authorId.endsWith('}');
      if (!native || anchors.has(source.anchor) || sourceIds.has(source.id)) context.addIssue({ code: 'custom', path: ['items', index, 'sources', position, 'anchor'], message: 'Expected a unique native comment anchor.' });
      if (!account) context.addIssue({ code: 'custom', path: ['items', index, 'sources', position, 'authorId'], message: 'Expected a durable native account id.' });
      anchors.add(source.anchor);
      sourceIds.add(source.id);
    });
  });
});

export const geldPrMetaSchema = z.object({
  v: z.literal(META_VERSION),
  generatedAt: isoDate,
  headSha: sha,
  producer: producerSchema,
  items: z.array(reviewItemSchema),
  bots: z.array(botVerdictSchema),
  reviewers: z.array(reviewerSchema),
  fold: foldSchema,
  truncated: z.boolean().optional(),
  summary: reviewSummarySchema.optional(),
  previews: z.array(previewRecordSchema).optional(),
  nativePublication: nativePublicationSchema.optional(),
}).superRefine((meta, context) => {
  const publication = meta.nativePublication;
  if (publication === undefined) return;
  if (publication.subject.headSha !== meta.headSha) context.addIssue({ code: 'custom', path: ['nativePublication', 'subject', 'headSha'], message: 'Publication and summary heads differ.' });
  const itemIds = new Set<string>();
  const anchors = new Set<string>();
  for (const item of meta.items) {
    if (itemIds.has(item.id)) context.addIssue({ code: 'custom', path: ['items'], message: 'Native publication item ids must be unique.' });
    itemIds.add(item.id);
    for (const source of item.sources) {
      if (anchors.has(source.anchor) || source.provider !== publication.subject.provider || source.origin !== publication.subject.origin) context.addIssue({ code: 'custom', path: ['items'], message: 'Native publication sources must be unique and share its provider origin.' });
      anchors.add(source.anchor);
    }
  }
  for (const entry of publication.items) {
    const item = meta.items.find((candidate) => candidate.id === entry.itemId);
    if (item === undefined || item.sources.length !== entry.sources.length || item.sources.some((source, index) => {
      const published = entry.sources[index];
      return published === undefined || published.id !== source.sourceId || published.anchor !== source.anchor || published.authorId !== source.authorId;
    })) context.addIssue({ code: 'custom', path: ['nativePublication', 'items'], message: 'Publication sources must match retained summary items.' });
  }
});

export const deeplinkSchema = z.object({
  v: z.literal(META_VERSION),
  headSha: sha,
  generatedAt: isoDate,
  open: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

function issuesOf(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? '$' : issue.path.join('.');
    return `${path}: ${issue.message}`;
  });
}

function reviewSourceFrom(value: z.infer<typeof reviewSourceSchema>): ReviewSource {
  return {
    anchor: value.anchor,
    kind: value.kind,
    author: value.author,
    ...(value.bot === undefined ? {} : { bot: value.bot }),
    ...(value.sourceId === undefined ? {} : { sourceId: value.sourceId }),
    ...(value.authorId === undefined ? {} : { authorId: value.authorId }),
    ...(value.automated === undefined ? {} : { automated: value.automated }),
    ...(value.provider === undefined ? {} : { provider: value.provider }),
    ...(value.origin === undefined ? {} : { origin: value.origin }),
    ...(value.url === undefined ? {} : { url: value.url }),
  };
}

function reviewItemFrom(value: z.infer<typeof reviewItemSchema>): ReviewItem {
  const item: ReviewItem = {
    id: value.id,
    title: value.title,
    rewritten: value.rewritten,
    severity: value.severity,
    status: value.status,
    sources: value.sources.map(reviewSourceFrom),
  };
  const located = value.path === undefined ? item : { ...item, path: value.path };
  const numbered = value.line === undefined ? located : { ...located, line: value.line };
  const judged = value.addressed === undefined ? numbered : { ...numbered, addressed: { verdict: value.addressed.verdict, evidence: value.addressed.evidence } };
  const explained = value.context === undefined ? judged : { ...judged, context: value.context };
  return value.fix === undefined ? explained : { ...explained, fix: { text: value.fix.text, source: value.fix.source } };
}

function botVerdictFrom(value: z.infer<typeof botVerdictSchema>): BotVerdictRecord {
  const record: BotVerdictRecord = {
    id: value.id,
    login: value.login,
    verdict: value.verdict,
    reviewedSha: value.reviewedSha,
  };
  const counted = value.count === undefined ? record : { ...record, count: value.count };
  const scored = value.score === undefined ? counted : { ...counted, score: value.score };
  const graded = value.severity === undefined ? scored : { ...scored, severity: value.severity };
  const named = value.checkName === undefined ? graded : { ...graded, checkName: value.checkName };
  const checked = value.checkSha === undefined ? named : { ...named, checkSha: value.checkSha };
  const sourced = value.sourceId === undefined ? checked : { ...checked, sourceId: value.sourceId };
  const reasoned = value.reason === undefined ? sourced : { ...sourced, reason: value.reason };
  return value.runJudged === undefined ? reasoned : { ...reasoned, runJudged: true };
}

function metaFrom(value: z.infer<typeof geldPrMetaSchema>): GeldPrMeta {
  const meta: GeldPrMeta = {
    v: value.v,
    generatedAt: value.generatedAt,
    headSha: value.headSha,
    producer: value.producer,
    items: value.items.map(reviewItemFrom),
    bots: value.bots.map(botVerdictFrom),
    reviewers: value.reviewers.map((reviewer) => ({ login: reviewer.login, state: reviewer.state })),
    fold: { comments: value.fold.comments, events: value.fold.events },
  };
  const published = value.nativePublication === undefined ? meta : { ...meta, nativePublication: value.nativePublication };
  const flagged = value.truncated === undefined ? published : { ...published, truncated: value.truncated };
  const summarised =
    value.summary === undefined
      ? flagged
      : { ...flagged, summary: { tldr: value.summary.tldr, updatedAt: value.summary.updatedAt, forItems: value.summary.forItems } };
  return value.previews === undefined
    ? summarised
    : {
        ...summarised,
        previews: value.previews.map((entry) => {
          const record: PreviewRecord = { host: entry.host, project: entry.project, status: entry.status, url: entry.url, inspectUrl: entry.inspectUrl, anchor: entry.anchor };
          const dated = entry.updatedAt === undefined ? record : { ...record, updatedAt: entry.updatedAt };
          return entry.reason === undefined ? dated : { ...dated, reason: entry.reason };
        }),
      };
}

export function parseGeldPrMeta(value: unknown): ParseResult<GeldPrMeta> {
  const parsed = geldPrMetaSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, value: metaFrom(parsed.data) };
}

export function parseDeeplink(value: unknown): ParseResult<GeldDeeplink> {
  const parsed = deeplinkSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return {
    ok: true,
    value: {
      v: parsed.data.v,
      headSha: parsed.data.headSha,
      generatedAt: parsed.data.generatedAt,
      open: parsed.data.open,
      total: parsed.data.total,
    },
  };
}

/** FNV-1a 32-bit, hex. Stable across runtimes; used as the review-item id. */
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Item id: hash of the sorted source anchors (and an optional bot rule id). */
export function itemIdFor(anchors: readonly string[], ruleId?: string): string {
  const parts = [...anchors].sort();
  if (ruleId !== undefined && ruleId !== '') parts.push(`rule:${ruleId}`);
  return `ri_${fnv1aHex(parts.join('|'))}`;
}

/**
 * Statuses that still want something of someone. `outdated` is among them:
 * GitHub says it of the code the thread was on, not of the conversation,
 * which stays open (its button still reads Resolve) until a person resolves
 * it; the digest shows the badge and counts the thread as open.
 */
const OPEN_STATUSES: ReadonlySet<ReviewItemStatus> = new Set(['open', 'needs-reply', 'addressed', 'outdated']);

export function isOpenStatus(status: ReviewItemStatus): boolean {
  return OPEN_STATUSES.has(status);
}

export function openItemCount(items: readonly ReviewItem[]): number {
  return items.filter((item) => isOpenStatus(item.status)).length;
}

export function doneItemCount(items: readonly ReviewItem[]): number {
  return items.length - openItemCount(items);
}

/** The payload's size as the comment carries it: the JSON with `&`, `'`, `<`, `>` as entities (see `encodePayloadAttribute`). */
function encodedPayloadLength(meta: GeldPrMeta): number {
  const json = JSON.stringify(meta);
  let extra = 0;
  for (const char of json) {
    if (char === '&') extra += 4;
    else if (char === "'") extra += 4;
    else if (char === '<' || char === '>') extra += 3;
  }
  return json.length + extra;
}

/**
 * Drop lowest-priority items until the payload, as written into the
 * comment, fits `budget`. Open items are kept longest. Sets
 * `truncated: true` whenever anything was dropped.
 */
export function truncateMeta(meta: GeldPrMeta, budget: number = PAYLOAD_BUDGET): GeldPrMeta {
  const retained = (items: readonly ReviewItem[], truncated: boolean): GeldPrMeta => {
    const ids = new Set(items.map((item) => item.id));
    return { ...meta, items, ...(truncated ? { truncated: true } : {}), ...(meta.nativePublication === undefined ? {} : { nativePublication: { ...meta.nativePublication, items: meta.nativePublication.items.filter((item) => ids.has(item.itemId)) } }) };
  };
  const initial = meta.nativePublication === undefined ? meta : retained(meta.items, false);
  if (encodedPayloadLength(initial) <= budget) return initial;
  const ranked = [...meta.items].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  let items = ranked;
  while (items.length > 0) {
    const candidate = retained(items, true);
    if (encodedPayloadLength(candidate) <= budget) return candidate;
    items = items.slice(0, -1);
  }
  return retained([], true);
}

export function deeplinkFrom(meta: GeldPrMeta): GeldDeeplink {
  return {
    v: META_VERSION,
    headSha: meta.headSha,
    generatedAt: meta.generatedAt,
    open: openItemCount(meta.items),
    total: meta.items.length,
  };
}

const BASE64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    const remain = bytes.length - index;
    out += BASE64_TABLE[(triple >> 18) & 63];
    out += BASE64_TABLE[(triple >> 12) & 63];
    if (remain > 1) out += BASE64_TABLE[(triple >> 6) & 63];
    if (remain > 2) out += BASE64_TABLE[triple & 63];
  }
  return out.replaceAll('+', '-').replaceAll('/', '_');
}

function base64UrlToBytes(text: string): Uint8Array | null {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const fill = padded.length % 4 === 0 ? padded : padded + '='.repeat(4 - (padded.length % 4));
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(fill)) return null;
  const length = Math.floor((fill.replace(/=/g, '').length * 3) / 4);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < fill.length; index += 4) {
    const sextet = (ch: string): number => {
      const at = BASE64_TABLE.indexOf(ch);
      return at === -1 ? 0 : at;
    };
    const a = sextet(fill.charAt(index));
    const b = sextet(fill.charAt(index + 1));
    const c = sextet(fill.charAt(index + 2));
    const d = sextet(fill.charAt(index + 3));
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < bytes.length) bytes[offset] = (triple >> 16) & 255;
    offset += 1;
    if (offset < bytes.length) bytes[offset] = (triple >> 8) & 255;
    offset += 1;
    if (offset < bytes.length) bytes[offset] = triple & 255;
    offset += 1;
  }
  return bytes;
}

function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const combined = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        bytes.push(0xf0 | (combined >> 18), 0x80 | ((combined >> 12) & 0x3f), 0x80 | ((combined >> 6) & 0x3f), 0x80 | (combined & 0x3f));
        index += 1;
      }
    } else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(bytes);
}

function utf8String(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; ) {
    const b0 = bytes[index] ?? 0;
    if (b0 < 0x80) {
      text += String.fromCharCode(b0);
      index += 1;
    } else if (b0 >> 5 === 0x06) {
      const b1 = bytes[index + 1] ?? 0;
      text += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      index += 2;
    } else if (b0 >> 4 === 0x0e) {
      const b1 = bytes[index + 1] ?? 0;
      const b2 = bytes[index + 2] ?? 0;
      text += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
      index += 3;
    } else {
      const b1 = bytes[index + 1] ?? 0;
      const b2 = bytes[index + 2] ?? 0;
      const b3 = bytes[index + 3] ?? 0;
      const code = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      const minus = code - 0x10000;
      text += String.fromCharCode(0xd800 + (minus >> 10), 0xdc00 + (minus & 0x3ff));
      index += 4;
    }
  }
  return text;
}

export function encodeDeeplinkPayload(link: GeldDeeplink): string {
  const compact = { v: 1, h: link.headSha, t: link.generatedAt, o: link.open, n: link.total };
  return bytesToBase64Url(utf8Bytes(JSON.stringify(compact)));
}

export function decodeDeeplinkPayload(fragment: string): ParseResult<GeldDeeplink> {
  const trimmed = fragment.replace(/^#/, '');
  const bytes = base64UrlToBytes(trimmed);
  if (bytes === null) return { ok: false, issues: ['$: Not a base64url payload.'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8String(bytes));
  } catch {
    return { ok: false, issues: ['$: Payload is not JSON.'] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, issues: ['$: Expected an object.'] };
  }
  const record: Record<string, unknown> = { ...parsed };
  const mapped = {
    v: record.v,
    headSha: record.h ?? record.headSha,
    generatedAt: record.t ?? record.generatedAt,
    open: record.o ?? record.open,
    total: record.n ?? record.total,
  };
  return parseDeeplink(mapped);
}

export function geldPrUrl(owner: string, repo: string, number: number, meta: GeldPrMeta): string {
  return `${SITE_ORIGIN}/pr/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}#${encodeDeeplinkPayload(deeplinkFrom(meta))}`;
}

export function howItWorksUrl(): string {
  return `${SITE_ORIGIN}/how-it-works#summary`;
}

/**
 * Authors allowed to produce a summary the extension will trust. A forged
 * payload from anyone else is ignored; the schema plus "anchors must exist
 * on the page" is the rest of the trust boundary.
 */
export const ALLOWED_SUMMARY_AUTHORS: readonly string[] = ['github-actions[bot]', 'geld[bot]', 'geld-sh[bot]'];

export function isAllowedSummaryAuthor(login: string, extra: readonly string[] = []): boolean {
  const lower = login.toLowerCase();
  return ALLOWED_SUMMARY_AUTHORS.some((allowed) => allowed.toLowerCase() === lower) || extra.some((allowed) => allowed.toLowerCase() === lower);
}
