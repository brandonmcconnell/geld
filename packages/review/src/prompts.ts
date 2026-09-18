/**
 * Prompts for optional AI: consolidate bot-only titles, and a semantic
 * "was this addressed?" verdict. Outputs are JSON and must be schema-
 * validated; source ids in the model output are checked against the input.
 */

import { z } from 'zod';
import { ADDRESSED_VERDICTS, SEVERITIES } from './model';

export const CONSOLIDATE_SYSTEM = `You rewrite review-bot findings into short titles for a pull-request digest.
Rules:
- One title per item. At most 80 characters, no trailing period.
- Keep the author's meaning; do not invent bugs.
- Mention the symbol or file when it helps.
- Return JSON only, matching the schema. Every id must be one of the ids you were given.`;

export const ADDRESSED_SYSTEM = `You decide whether a review finding still applies given later discussion and the files that changed.
Verdicts: "yes" (fixed or no longer applies), "partly", "no", "unclear".
Return JSON only. Every id must be one of the ids you were given. Do not quote comment text at length; evidence is short phrases.`;

export interface ConsolidateInputItem {
  readonly id: string;
  readonly title: string;
  readonly path?: string;
  readonly line?: number;
  readonly sources: readonly string[];
  readonly excerpt: string;
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
    }),
  ),
});

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
        },
      },
    },
  },
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

export function parseConsolidateOutput(text: string, allowedIds: ReadonlySet<string>): PromptParse<readonly ConsolidateOutputItem[]> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = consolidateOutputSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`) };
  }
  const kept = keepKnownIds(parsed.data.items, allowedIds).map((entry) =>
    entry.severity === undefined ? { id: entry.id, title: entry.title } : { id: entry.id, title: entry.title, severity: entry.severity },
  );
  return { ok: true, value: kept };
}

export function parseAddressedOutput(text: string, allowedIds: ReadonlySet<string>): PromptParse<readonly AddressedOutputItem[]> {
  const json = parseJsonObject(text);
  if (!json.ok) return json;
  const parsed = addressedOutputSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`) };
  }
  const kept = keepKnownIds(parsed.data.items, allowedIds);
  return { ok: true, value: kept };
}
