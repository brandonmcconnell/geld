import { SEVERITIES } from '@geld/review';
import { AI_RUNS_CAP, aiRunsItem, providerReviewedItemsItem, saveProviderReviewedItem } from './local-state';
import type { AiRunRecord, ProviderReviewedStorage } from './local-state';
import type { LocalReviewMutation, LocalReviewWrite } from './local-review-write';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function bounded(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length <= limit; }
function date(value: unknown): value is string { return bounded(value, 80) && Number.isFinite(Date.parse(value)); }

function boundedMessage(value: unknown): boolean { try { return JSON.stringify(value).length <= 1024 * 1024; } catch { return false; } }

function aiRecord(value: unknown): value is AiRunRecord {
  if (!record(value) || !date(value.ranAt) || !Array.isArray(value.rewrites) || value.rewrites.length > 1000 || (value.error !== undefined && !bounded(value.error, 4096))) return false;
  if (!value.rewrites.every((item: unknown) => record(item) && bounded(item.id, 512) && bounded(item.title, 4096)
    && (item.severity === undefined || SEVERITIES.some((severity) => severity === item.severity))
    && (item.context === undefined || bounded(item.context, 64 * 1024)) && (item.fix === undefined || bounded(item.fix, 64 * 1024)))) return false;
  const summary = value.summary;
  return summary === undefined || (record(summary) && bounded(summary.tldr, 64 * 1024) && date(summary.updatedAt) && Array.isArray(summary.forItems) && summary.forItems.length <= 1000 && summary.forItems.every((id: unknown) => bounded(id, 512)));
}

export function isLocalReviewWrite(value: unknown): value is LocalReviewWrite {
  if (!record(value) || value.type !== 'geld:local-review-write' || !bounded(value.token, 80) || !/^[\w-]{1,80}$/.test(value.token) || !record(value.mutation)) return false;
  const mutation = value.mutation;
  if (mutation.kind === 'ai') return bounded(mutation.key, 4096) && /^(?:github(?:@[^:]+)?|gitlab@https:\/\/[^/]+|bitbucket@https:\/\/[^/]+):/.test(mutation.key)
    && (mutation.record === null || aiRecord(mutation.record)) && boundedMessage(value);
  return mutation.kind === 'reviewed' && bounded(mutation.reviewKey, 4096) && /^(gitlab|bitbucket)@https:\/\//.test(mutation.reviewKey)
    && typeof mutation.headSha === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(mutation.headSha)
    && typeof mutation.itemId === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(mutation.itemId) && !['__proto__', 'constructor', 'prototype'].includes(mutation.itemId)
    && typeof mutation.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(mutation.fingerprint) && typeof mutation.reviewed === 'boolean';
}

interface Stores {
  readonly ai: { getValue(): Promise<Readonly<Record<string, AiRunRecord>>>; setValue(value: Readonly<Record<string, AiRunRecord>>): Promise<void> };
  readonly reviewed: ProviderReviewedStorage;
}

export function createLocalReviewAuthority(stores: Stores = { ai: aiRunsItem, reviewed: providerReviewedItemsItem }): (mutation: LocalReviewMutation, validate: () => Promise<void>) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  return (mutation, validate) => {
    const run = queue.catch(() => undefined).then(async () => {
      if (mutation.kind === 'reviewed') {
        await saveProviderReviewedItem(mutation.reviewKey, mutation.headSha, mutation.itemId, mutation.fingerprint, mutation.reviewed, validate, stores.reviewed);
        return;
      }
      await validate();
      const current = { ...await stores.ai.getValue() };
      await validate();
      if (mutation.record === null) delete current[mutation.key];
      else current[mutation.key] = mutation.record;
      const oldest = Object.keys(current).sort((a, b) => Date.parse(current[a]?.ranAt ?? '') - Date.parse(current[b]?.ranAt ?? '')).slice(0, Math.max(0, Object.keys(current).length - AI_RUNS_CAP));
      for (const key of oldest) delete current[key];
      await stores.ai.setValue(current);
    });
    queue = run;
    return run;
  };
}

export async function validateLocalReviewOrigin(send: () => Promise<unknown>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([send(), new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 2000); })]);
    if (!record(response) || response.ok !== true) throw new Error('Review source changed.');
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
