import { readFileSync } from 'node:fs';
import {
  ADDRESSED_JSON_SCHEMA,
  ADDRESSED_SYSTEM,
  CONSOLIDATE_JSON_SCHEMA,
  CONSOLIDATE_SYSTEM,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM,
  addressedUserPrompt,
  botOnlyForRewrite,
  buildMeta,
  completeChat,
  consolidateUserPrompt,
  parseAddressedOutput,
  parseConsolidateOutput,
  parseSummaryOutput,
  planConsolidation,
  rawCommentsOf,
  renderSummary,
  summaryInput,
  summaryIsCurrent,
  summaryRecord,
  summaryUserPrompt,
} from '@geld/review';
import type { AddressedOutputItem, ConsolidateInputItem, ConsolidateOutputItem, ProducerRecord, ReviewItem, ReviewSummary } from '@geld/review';
import { filesChangedBetween, findSummaryComment, loadPullRequest, parseActionEvent, shouldSkipSelfEdit, upsertIssueComment } from './github';
import type { GithubClient } from './github';

const ACTION_VERSION = '0.2.0';
const FIX_MODES = ['all', 'bots', 'ai', 'off'] as const;
type FixMode = (typeof FIX_MODES)[number];

function input(name: string): string {
  const key = `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;
  return process.env[key] ?? '';
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readEventPayload(): unknown {
  const path = process.env.GITHUB_EVENT_PATH;
  if (path === undefined || path === '') return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

function extraBots(raw: string): readonly string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function fixMode(raw: string): FixMode {
  return FIX_MODES.find((mode) => mode === raw.trim()) ?? 'bots';
}

interface Ai {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly fetch: typeof fetch;
}

async function consolidate(ai: Ai, pending: readonly ConsolidateInputItem[]): Promise<readonly ConsolidateOutputItem[]> {
  if (pending.length === 0) return [];
  const result = await completeChat({
    fetch: ai.fetch,
    baseUrl: ai.baseUrl,
    apiKey: ai.apiKey,
    model: ai.model,
    messages: [
      { role: 'system', content: CONSOLIDATE_SYSTEM },
      { role: 'user', content: consolidateUserPrompt(pending) },
    ],
    jsonSchema: CONSOLIDATE_JSON_SCHEMA,
    schemaName: 'geld_consolidate',
    timeoutMs: 60_000,
  });
  if (!result.ok) {
    console.warn(`AI consolidation skipped: ${result.reason}`);
    return [];
  }
  const parsed = parseConsolidateOutput(result.text, new Set(pending.map((item) => item.id)));
  if (!parsed.ok) {
    console.warn(`AI consolidation ignored: ${parsed.issues.join('; ')}`);
    return [];
  }
  return parsed.value;
}

async function writeTldr(ai: Ai, items: readonly ReviewItem[], previous: ReviewSummary | undefined, now: string): Promise<ReviewSummary | undefined> {
  if (previous !== undefined && summaryIsCurrent(previous, items)) return previous;
  const open = summaryInput(items);
  if (open.length === 0) return undefined;
  const result = await completeChat({
    fetch: ai.fetch,
    baseUrl: ai.baseUrl,
    apiKey: ai.apiKey,
    model: ai.model,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: summaryUserPrompt(open, previous?.tldr ?? null) },
    ],
    jsonSchema: SUMMARY_JSON_SCHEMA,
    schemaName: 'geld_summary',
    timeoutMs: 45_000,
  });
  if (!result.ok) {
    console.warn(`AI summary skipped: ${result.reason}`);
    return previous;
  }
  const parsed = parseSummaryOutput(result.text);
  if (!parsed.ok) {
    console.warn(`AI summary ignored: ${parsed.issues.join('; ')}`);
    return previous;
  }
  return summaryRecord(parsed.value, items, now);
}

async function judgeAddressed(ai: Ai, items: readonly ReviewItem[], changedPaths: readonly string[]): Promise<readonly AddressedOutputItem[]> {
  if (items.length === 0) return [];
  const result = await completeChat({
    fetch: ai.fetch,
    baseUrl: ai.baseUrl,
    apiKey: ai.apiKey,
    model: ai.model,
    messages: [
      { role: 'system', content: ADDRESSED_SYSTEM },
      {
        role: 'user',
        content: addressedUserPrompt(
          items.map((item) => ({
            id: item.id,
            title: item.title,
            ...(item.path === undefined ? {} : { path: item.path }),
            changed: item.path !== undefined && changedPaths.includes(item.path),
            excerpt: item.context ?? item.title,
            laterReplies: '',
          })),
        ),
      },
    ],
    jsonSchema: ADDRESSED_JSON_SCHEMA,
    schemaName: 'geld_addressed',
    timeoutMs: 45_000,
  });
  if (!result.ok) {
    console.warn(`AI addressed skipped: ${result.reason}`);
    return [];
  }
  const parsed = parseAddressedOutput(result.text, new Set(items.map((item) => item.id)));
  if (!parsed.ok) {
    console.warn(`AI addressed ignored: ${parsed.issues.join('; ')}`);
    return [];
  }
  return parsed.value;
}

export async function run(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const payload = env === process.env ? readEventPayload() : JSON.parse(env.GITHUB_EVENT_PAYLOAD ?? '{}');
  const event = parseActionEvent(env, payload);
  if (event === null) {
    console.log('Not a pull request event; nothing to do.');
    return;
  }
  if (shouldSkipSelfEdit(event)) {
    console.log('Skipping our own comment edit.');
    return;
  }
  const debounce = Number.parseInt(input('debounce-seconds') || env.INPUT_DEBOUNCE_SECONDS || '0', 10);
  if (Number.isFinite(debounce) && debounce > 0) {
    await new Promise((resolve) => setTimeout(resolve, debounce * 1000));
  }
  const token = input('github-token') || env.INPUT_GITHUB_TOKEN || env.GITHUB_TOKEN || '';
  if (token === '') fail('A GitHub token is required (pass github-token or set GITHUB_TOKEN).');
  const client: GithubClient = { token, fetch: fetchImpl };
  const loaded = await loadPullRequest(client, event.owner, event.repo, event.number);
  const existing = findSummaryComment(loaded.comments);
  const previous = existing?.meta ?? null;
  const laterPaths =
    previous !== null && previous.headSha.toLowerCase() !== loaded.headSha.toLowerCase()
      ? await filesChangedBetween(client, event.owner, event.repo, previous.headSha, loaded.headSha)
      : [];
  const pr = { ...loaded, changedPaths: laterPaths };
  const apiKey = input('ai-key') || env.INPUT_AI_KEY || '';
  const baseUrl = input('ai-base-url') || env.INPUT_AI_BASE_URL || 'https://ai-gateway.vercel.sh';
  const model = input('model') || env.INPUT_MODEL || '';
  const extras = extraBots(input('extra-bots') || env.INPUT_EXTRA_BOTS || '');
  const suggestedFixes = fixMode(input('suggested-fixes') || env.INPUT_SUGGESTED_FIXES || 'bots');
  const maxItemsRaw = Number.parseInt(input('max-items') || env.INPUT_MAX_ITEMS || '80', 10);
  const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? maxItemsRaw : 80;
  const useAi = apiKey !== '' && model !== '';
  const producer: ProducerRecord = { kind: 'action', version: ACTION_VERSION, ai: useAi };
  const generatedAt = new Date().toISOString();
  const common = { extraBotLogins: extras, previous, previousBody: existing?.body ?? '', maxItems, suggestedFixes } as const;

  // Deterministic pass first: the same items the extension's crawler would build.
  const draft = buildMeta(pr, { ...common, producer: { ...producer, ai: false }, generatedAt });
  if (!useAi) {
    const body = renderSummary(draft, { owner: event.owner, repo: event.repo, number: event.number });
    const id = await upsertIssueComment(client, event.owner, event.repo, event.number, existing?.commentId ?? null, body);
    console.log(`Upserted Geld summary comment ${id} on ${event.owner}/${event.repo}#${event.number} (${draft.items.length} items).`);
    return;
  }

  // Ask the model only about bot-only items whose sources changed since the last comment.
  const ai: Ai = { apiKey, baseUrl, model, fetch: fetchImpl };
  const plan = planConsolidation(previous, draft.items, {
    comments: rawCommentsOf(pr),
    wantFix: suggestedFixes === 'all' || suggestedFixes === 'ai',
  });
  const rewritten = await consolidate(ai, plan.pending);
  const consolidated = buildMeta(pr, { ...common, producer, generatedAt, rewritten, carried: plan.carried });
  const semantic = await judgeAddressed(ai, botOnlyForRewrite(consolidated.items), pr.changedPaths);
  const judged = buildMeta(pr, { ...common, producer, generatedAt, rewritten, carried: plan.carried, semantic });
  const summary = await writeTldr(ai, judged.items, previous?.summary, generatedAt);
  const meta = buildMeta(pr, { ...common, producer, generatedAt, rewritten, carried: plan.carried, semantic, ...(summary === undefined ? {} : { summary }) });
  const body = renderSummary(meta, { owner: event.owner, repo: event.repo, number: event.number });
  const id = await upsertIssueComment(client, event.owner, event.repo, event.number, existing?.commentId ?? null, body);
  console.log(
    `Upserted Geld summary comment ${id} on ${event.owner}/${event.repo}#${event.number} (${meta.items.length} items, ${plan.pending.length} consolidated, ${plan.carried.size} carried${summary === previous?.summary ? ', TL;DR kept' : ', TL;DR written'}).`,
  );
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('index.js') || entry.endsWith('main.ts')) {
  run().catch((error: unknown) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
