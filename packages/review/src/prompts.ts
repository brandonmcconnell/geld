/**
 * Prompts for optional AI: consolidate an item's sources into one title
 * (plus merged context and, when asked, a fix), write the TL;DR, and give a
 * semantic "was this addressed?" verdict. Outputs are JSON and must be
 * schema-validated; every id in a model output is checked against the input.
 */

import { z } from 'zod';
import { ADDRESSED_VERDICTS, SEVERITIES } from './model';

export const CONSOLIDATE_SYSTEM = `You consolidate code-review findings for a pull-request digest. Each item is one concern; its sources are the comments (from review bots and people) that raised it.
Rules:
- "title": one line, at most 80 characters, no trailing period. Say what is wrong or asked, naming the symbol or file when it helps. Keep the reporters' meaning; never invent a bug.
- "context": at most two sentences with what a reader needs beyond the title — the consequence, the condition, the reasoning a source gave. Omit it when the title already says everything. Merge duplicates: when several sources report the same thing, keep the union of useful detail once.
- When "previousTitle" is given, the item was already summarised; change the title and context only as much as the new sources require. Prefer keeping them.
- "fix": only when asked ("wantFix": true) and only when a concrete change follows from the sources; a short code or prose change, no commentary. Omit otherwise.
- "severity": one of the allowed values when you can tell; omit otherwise.
- When "sameProblemAs" lists other ids, those items were judged to report the same underlying problem: give them one and the same title, and let each context say which other reporters raised it.
- Return JSON only, matching the schema. Every id must be one of the ids you were given.`;

export const SUMMARY_SYSTEM = `You write the TL;DR of a pull request's review state for its digest.
Rules:
- At most three sentences, plain prose, no lists, no headings, no emoji.
- Say what kind of feedback is open (bugs, questions, nits), where it clusters, and what is blocking if anything. Do not repeat every item.
- When "previousTldr" is given, keep its wording where it still holds and change only what the item list requires.
- Return JSON only: {"tldr": "..."}.`;

export const ADDRESSED_SYSTEM = `You decide whether a review finding still applies given later discussion and the files that changed.
Verdicts: "yes" (fixed or no longer applies), "partly", "no", "unclear".
Return JSON only. Every id must be one of the ids you were given. Do not quote comment text at length; evidence is short phrases.`;

export interface ConsolidateInputItem {
  readonly id: string;
  readonly title: string;
  readonly path?: string;
  readonly line?: number;
  readonly sources: readonly string[];
  /** What each source said, one entry per source, trimmed. */
  readonly excerpts: readonly string[];
  readonly previousTitle?: string;
  readonly previousContext?: string;
  readonly wantFix: boolean;
  /** Ids of other items in this request that Jev judged to report the same problem. */
  readonly sameProblemAs?: readonly string[];
}

export interface SummaryInputItem {
  readonly id: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly path?: string;
}

export interface AddressedInputItem {
  readonly id: string;
  readonly title: string;
  readonly path?: string;
  readonly changed: boolean;
  readonly excerpt: string;
  readonly laterReplies: string;
}

const consolidateOutputSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1).max(120),
      severity: z.enum(SEVERITIES).optional(),
      context: z.string().max(600).optional(),
      fix: z.string().max(2000).optional(),
    }),
  ),
});

const summaryOutputSchema = z.object({ tldr: z.string().min(1).max(600) });

const addressedOutputSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      verdict: z.enum(ADDRESSED_VERDICTS),
      evidence: z.array(z.string().min(1)).max(4),
    }),
  ),
});

export interface ConsolidateOutputItem {
  readonly id: string;
  readonly title: string;
  readonly severity?: (typeof SEVERITIES)[number];
  readonly context?: string;
  readonly fix?: string;
}

export interface AddressedOutputItem {
  readonly id: string;
  readonly verdict: (typeof ADDRESSED_VERDICTS)[number];
  readonly evidence: readonly string[];
}

export type PromptParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

function parseJsonObject(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly string[] } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, issues: ['$: Model output is not JSON.'] };
  }
}

function keepKnownIds<T extends { readonly id: string }>(items: readonly T[], allowed: ReadonlySet<string>): readonly T[] {
  return items.filter((item) => allowed.has(item.id));
}

export function consolidateUserPrompt(items: readonly ConsolidateInputItem[]): string {
  return JSON.stringify({ items }, null, 2);
}

export function summaryUserPrompt(items: readonly SummaryInputItem[], previousTldr: string | null): string {
  return JSON.stringify(previousTldr === null ? { items } : { previousTldr, items }, null, 2);
}

export function addressedUserPrompt(items: readonly AddressedInputItem[]): string {
  return JSON.stringify({ items }, null, 2);
}

export const CONSOLIDATE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: [...SEVERITIES] },
          context: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
} as const;

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tldr'],
  properties: { tldr: { type: 'string' } },
} as const;

export const ADDRESSED_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'evidence'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: [...ADDRESSED_VERDICTS] },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

function issuesOf(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`);
}

export function parseConsolidateOutput(text: string, allowedIds: ReadonlySet<string>): PromptParse<readonly ConsolidateOutputItem[]> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = consolidateOutputSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const kept = keepKnownIds(parsed.data.items, allowedIds).map((entry) => {
    const item: ConsolidateOutputItem = { id: entry.id, title: entry.title.trim().replace(/\.$/, '') };
    const graded = entry.severity === undefined ? item : { ...item, severity: entry.severity };
    const context = entry.context?.trim() ?? '';
    const explained = context === '' ? graded : { ...graded, context };
    const fix = entry.fix?.trim() ?? '';
    return fix === '' ? explained : { ...explained, fix };
  });
  return { ok: true, value: kept };
}

export function parseSummaryOutput(text: string): PromptParse<string> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = summaryOutputSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, value: parsed.data.tldr.trim() };
}

export function parseAddressedOutput(text: string, allowedIds: ReadonlySet<string>): PromptParse<readonly AddressedOutputItem[]> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = addressedOutputSchema.safeParse(json.value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, value: keepKnownIds(parsed.data.items, allowedIds) };
}
