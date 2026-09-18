/**
 * Optional in-browser rewrite of bot-only item titles. The user's gateway
 * key stays in `storage.local`; the background worker talks to the gateway
 * directly. No request is made without a key, URL and model.
 */

import type { GeldSettings } from '@geld/core';
import type { ConsolidateOutputItem, ReviewItem } from '@geld/review';
import { botOnlyForRewrite, CONSOLIDATE_JSON_SCHEMA, CONSOLIDATE_SYSTEM, consolidateUserPrompt, parseConsolidateOutput } from '@geld/review';
import { browser } from 'wxt/browser';
import { aiKeyItem } from '../../lib/local-state';
import type { AiCompleteRequest } from '../../lib/messages';
import { isAiCompleteResponse } from '../../lib/messages';

const cache = new Map<string, ConsolidateOutputItem>();

export function cachedRewrite(id: string): ConsolidateOutputItem | null {
  return cache.get(id) ?? null;
}

export async function maybeRewriteBotTitles(
  items: readonly ReviewItem[],
  settings: GeldSettings,
): Promise<readonly ConsolidateOutputItem[]> {
  if (settings.aiBaseUrl === '' || settings.aiModel === '') return [];
  const apiKey = (await aiKeyItem.getValue()).trim();
  if (apiKey === '') return [];
  const pending = botOnlyForRewrite(items).filter((item) => !item.rewritten && !cache.has(item.id));
  if (pending.length === 0) return [...cache.values()];
  const message: AiCompleteRequest = {
    type: 'geld:ai-complete',
    baseUrl: settings.aiBaseUrl,
    apiKey,
    model: settings.aiModel,
    messages: [
      { role: 'system', content: CONSOLIDATE_SYSTEM },
      {
        role: 'user',
        content: consolidateUserPrompt(
          pending.map((item) => {
            const entry = { id: item.id, title: item.title, sources: item.sources.map((source) => source.anchor), excerpt: item.title };
            if (item.path !== undefined && item.line !== undefined) return { ...entry, path: item.path, line: item.line };
            if (item.path !== undefined) return { ...entry, path: item.path };
            if (item.line !== undefined) return { ...entry, line: item.line };
            return entry;
          }),
        ),
      },
    ],
    jsonSchema: CONSOLIDATE_JSON_SCHEMA,
    schemaName: 'geld_consolidate',
  };
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch {
    return [];
  }
  if (!isAiCompleteResponse(response) || !response.ok) return [];
  const parsed = parseConsolidateOutput(response.text, new Set(pending.map((item) => item.id)));
  if (!parsed.ok) return [];
  for (const item of parsed.value) cache.set(item.id, item);
  return parsed.value;
}
