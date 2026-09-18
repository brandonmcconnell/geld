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
/** `<details>` summary GitHub shows for the payload fence. */
export const DATA_SUMMARY = 'Geld data';
/** Fence language GitHub renders as `<pre lang="geld">`. */
export const PAYLOAD_FENCE = 'geld';

export const SITE_ORIGIN = 'https://www.geld.sh';

/** Keep the JSON payload well under GitHub's 65,536-character comment cap. */
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
  'done-manual': 3,
  resolved: 4,
  outdated: 5,
};

export const BOT_VERDICTS = ['clean', 'findings', 'failed', 'running'] as const;
export type BotVerdict = (typeof BOT_VERDICTS)[number];

export const REVIEWER_STATES = ['approved', 'changes_requested', 'commented', 'pending'] as const;
export type ReviewerState = (typeof REVIEWER_STATES)[number];

export const SOURCE_KINDS = ['thread', 'comment', 'review'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const ADDRESSED_VERDICTS = ['yes', 'partly', 'no', 'unclear'] as const;
export type AddressedVerdict = (typeof ADDRESSED_VERDICTS)[number];

export const PRODUCER_KINDS = ['action', 'app', 'crawler'] as const;
export type ProducerKind = (typeof PRODUCER_KINDS)[number];

/** GitHub permalink fragments the extension resolves with `getElementById`. */
export const SOURCE_ANCHOR_PATTERN = /^(discussion_r\d+|issuecomment-\d+|pullrequestreview-\d+|event-\d+)$/;

export const sourceAnchorSchema = z.string().regex(SOURCE_ANCHOR_PATTERN);

export function isSourceAnchor(value: string): boolean {
  return SOURCE_ANCHOR_PATTERN.test(value);
}

export interface ReviewSource {
  readonly anchor: string;
  readonly kind: SourceKind;
  readonly author: string;
  readonly bot?: string;
}

export interface AddressedEvidence {
  readonly verdict: AddressedVerdict;
  readonly evidence: readonly string[];
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
}

export interface BotVerdictRecord {
  readonly id: string;
  readonly login: string;
  readonly verdict: BotVerdict;
  readonly count?: number;
  readonly score?: number;
  readonly reviewedSha: string;
  readonly checkName?: string;
  readonly sourceId?: string;
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

export const reviewSourceSchema = z.object({
  anchor: sourceAnchorSchema,
  kind: z.enum(SOURCE_KINDS),
  author: z.string().min(1),
  bot: z.string().min(1).optional(),
});

export const addressedSchema = z.object({
  verdict: z.enum(ADDRESSED_VERDICTS),
  evidence: z.array(z.string().min(1)),
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
});

export const botVerdictSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  verdict: z.enum(BOT_VERDICTS),
  count: z.number().int().nonnegative().optional(),
  score: z.number().optional(),
  reviewedSha: sha,
  checkName: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
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
  return value.bot === undefined
    ? { anchor: value.anchor, kind: value.kind, author: value.author }
    : { anchor: value.anchor, kind: value.kind, author: value.author, bot: value.bot };
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
  if (value.addressed === undefined) return numbered;
  return { ...numbered, addressed: { verdict: value.addressed.verdict, evidence: value.addressed.evidence } };
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
  const named = value.checkName === undefined ? scored : { ...scored, checkName: value.checkName };
  return value.sourceId === undefined ? named : { ...named, sourceId: value.sourceId };
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
  return value.truncated === undefined ? meta : { ...meta, truncated: value.truncated };
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

const OPEN_STATUSES: ReadonlySet<ReviewItemStatus> = new Set(['open', 'needs-reply', 'addressed']);

export function isOpenStatus(status: ReviewItemStatus): boolean {
  return OPEN_STATUSES.has(status);
}

export function openItemCount(items: readonly ReviewItem[]): number {
  return items.filter((item) => isOpenStatus(item.status)).length;
}

export function doneItemCount(items: readonly ReviewItem[]): number {
  return items.length - openItemCount(items);
}

/**
 * Drop lowest-priority items until the JSON fits `budget`. Open items are
 * kept longest. Sets `truncated: true` whenever anything was dropped.
 */
export function truncateMeta(meta: GeldPrMeta, budget: number = PAYLOAD_BUDGET): GeldPrMeta {
  if (JSON.stringify(meta).length <= budget) return meta;
  const ranked = [...meta.items].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  let items = ranked;
  while (items.length > 0) {
    const candidate: GeldPrMeta = { ...meta, items, truncated: true };
    if (JSON.stringify(candidate).length <= budget) return candidate;
    items = items.slice(0, -1);
  }
  return { ...meta, items: [], truncated: true };
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
