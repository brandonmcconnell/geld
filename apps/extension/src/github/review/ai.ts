/**
 * Optional in-browser consolidation when the Action did not run with AI.
 * The user's gateway key stays in `storage.local` (never the gist); the
 * background worker talks to the gateway. Nothing is sent without a key,
 * URL and model. Results are cached for the visit and layered onto every
 * later pass, so a title never flickers back to the verbatim one; only
 * items whose sources changed are asked again (`planConsolidation`).
 */

import type { GeldSettings } from '@geld/core';
import type { ConsolidateOutputItem, GeldPrMeta, RawComment, ReviewItem, ReviewSummary } from '@geld/review';
import {
  applyConsolidation,
  CONSOLIDATE_JSON_SCHEMA,
  CONSOLIDATE_SYSTEM,
  consolidateUserPrompt,
  parseConsolidateOutput,
  parseSummaryOutput,
  planConsolidation,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM,
  summaryInput,
  summaryIsCurrent,
  summaryRecord,
  summaryUserPrompt,
} from '@geld/review';
import type { Carried } from '@geld/review';
import { browser } from 'wxt/browser';
import { aiKeyItem } from '../../lib/local-state';
import type { AiCompleteRequest } from '../../lib/messages';
import { isAiCompleteResponse } from '../../lib/messages';

/** What the model said about an item, kept for the visit. */
const rewrites = new Map<string, ConsolidateOutputItem>();
let summary: ReviewSummary | undefined;
/** Item ids (and `tldr`) a request is in flight for — the rows that shimmer. */
const inFlight = new Set<string>();
let configured: boolean | null = null;

export function aiPending(): ReadonlySet<string> {
  return inFlight;
}

export async function aiConfigured(settings: GeldSettings): Promise<boolean> {
  if (settings.aiBaseUrl === '' || settings.aiModel === '') return false;
  if (configured === null) configured = (await aiKeyItem.getValue()).trim() !== '';
  return configured;
}

aiKeyItem.watch(() => {
  configured = null;
});

/** Layer this visit's model output onto a meta built without it. */
export function withAi(meta: GeldPrMeta): GeldPrMeta {
  const previous: GeldPrMeta = { ...meta, items: meta.items.map((item) => (rewrites.has(item.id) ? { ...item, rewritten: true } : item)) };
  const items = applyConsolidation(previous.items, new Map<string, Carried>(), [...rewrites.values()]);
  const withItems = items === meta.items ? meta : { ...meta, items };
  if (summary !== undefined && withItems.summary === undefined && summaryIsCurrent(summary, items)) return { ...withItems, summary };
  return withItems;
}

async function complete(settings: GeldSettings, apiKey: string, system: string, user: string, jsonSchema: unknown, schemaName: string): Promise<string | null> {
  const message: AiCompleteRequest = {
    type: 'geld:ai-complete',
    baseUrl: settings.aiBaseUrl,
    apiKey,
    model: settings.aiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    jsonSchema,
    schemaName,
  };
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch {
    return null;
  }
  if (!isAiCompleteResponse(response) || !response.ok) return null;
  return response.text;
}

export interface ConsolidateRun {
  /** Something changed: re-apply to show it. */
  readonly changed: boolean;
}

/**
 * Consolidate bot-only items whose sources are new to this visit and write
 * (or refresh) the TL;DR. `onProgress` fires as soon as requests start, so
 * the rows can shimmer, and again when results land.
 */
export async function consolidateInBrowser(
  meta: GeldPrMeta,
  comments: readonly RawComment[],
  settings: GeldSettings,
  onProgress: () => void,
): Promise<ConsolidateRun> {
  if (meta.producer.ai || !(await aiConfigured(settings))) return { changed: false };
  const apiKey = (await aiKeyItem.getValue()).trim();
  if (apiKey === '') return { changed: false };
  const known: GeldPrMeta = withAi(meta);
  const plan = planConsolidation(known, meta.items, { comments, wantFix: settings.suggestedFixes === 'all' || settings.suggestedFixes === 'ai' });
  const pending = plan.pending.filter((item) => !inFlight.has(item.id));
  const needsTldr = !inFlight.has('tldr') && summaryInput(known.items).length > 0 && !summaryIsCurrent(known.summary ?? summary, known.items);
  if (pending.length === 0 && !needsTldr) return { changed: false };

  for (const item of pending) inFlight.add(item.id);
  if (needsTldr) inFlight.add('tldr');
  onProgress();

  let changed = false;
  if (pending.length > 0) {
    const text = await complete(settings, apiKey, CONSOLIDATE_SYSTEM, consolidateUserPrompt(pending), CONSOLIDATE_JSON_SCHEMA, 'geld_consolidate');
    const parsed = text === null ? null : parseConsolidateOutput(text, new Set(pending.map((item) => item.id)));
    if (parsed !== null && parsed.ok) {
      for (const entry of parsed.value) rewrites.set(entry.id, entry);
      changed = parsed.value.length > 0;
    }
    for (const item of pending) inFlight.delete(item.id);
    if (changed) onProgress();
  }
  if (needsTldr) {
    const items = applyConsolidation(meta.items, new Map<string, Carried>(), [...rewrites.values()]);
    const text = await complete(settings, apiKey, SUMMARY_SYSTEM, summaryUserPrompt(summaryInput(items), summary?.tldr ?? null), SUMMARY_JSON_SCHEMA, 'geld_summary');
    const parsed = text === null ? null : parseSummaryOutput(text);
    if (parsed !== null && parsed.ok) {
      summary = summaryRecord(parsed.value, items, new Date().toISOString());
      changed = true;
    }
    inFlight.delete('tldr');
    onProgress();
  }
  return { changed };
}

export function resetAiForVisit(): void {
  inFlight.clear();
}

/** Titles the model has already rewritten for this visit (kept across page keys: ids are anchor hashes). */
export function rewrittenIds(): ReadonlySet<string> {
  return new Set(rewrites.keys());
}

export function itemsWithRewrite(items: readonly ReviewItem[]): readonly ReviewItem[] {
  return applyConsolidation(items, new Map<string, Carried>(), [...rewrites.values()]);
}
