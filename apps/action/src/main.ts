import { readFileSync } from 'node:fs';
import {
  ADDRESSED_JSON_SCHEMA,
  ADDRESSED_SYSTEM,
  CONSOLIDATE_JSON_SCHEMA,
  CONSOLIDATE_SYSTEM,
  addressedUserPrompt,
  botOnlyForRewrite,
  buildMeta,
  completeChat,
  consolidateUserPrompt,
  parseAddressedOutput,
  parseConsolidateOutput,
  renderSummary,
} from '@geld/review';
import type { AddressedOutputItem, ConsolidateInputItem, ConsolidateOutputItem, ProducerRecord } from '@geld/review';
import { filesChangedBetween, findSummaryComment, loadPullRequest, parseActionEvent, shouldSkipSelfEdit, upsertIssueComment } from './github';
import type { GithubClient } from './github';

const ACTION_VERSION = '0.1.0';

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

async function maybeRewrite(
  items: ReturnType<typeof botOnlyForRewrite>,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<readonly ConsolidateOutputItem[]> {
  if (apiKey === '' || model === '' || items.length === 0) return [];
  const payload: ConsolidateInputItem[] = items.map((item) => {
    const entry: ConsolidateInputItem = {
      id: item.id,
      title: item.title,
      sources: item.sources.map((source) => source.anchor),
      excerpt: item.title,
    };
    if (item.path !== undefined && item.line !== undefined) return { ...entry, path: item.path, line: item.line };
    if (item.path !== undefined) return { ...entry, path: item.path };
    if (item.line !== undefined) return { ...entry, line: item.line };
    return entry;
  });
  const result = await completeChat({
    fetch,
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: CONSOLIDATE_SYSTEM },
      { role: 'user', content: consolidateUserPrompt(payload) },
    ],
    jsonSchema: CONSOLIDATE_JSON_SCHEMA,
    schemaName: 'geld_consolidate',
    timeoutMs: 45_000,
  });
  if (!result.ok) {
    console.warn(`AI rewrite skipped: ${result.reason}`);
    return [];
  }
  const parsed = parseConsolidateOutput(result.text, new Set(items.map((item) => item.id)));
  if (!parsed.ok) {
    console.warn(`AI rewrite ignored: ${parsed.issues.join('; ')}`);
    return [];
  }
  return parsed.value;
}

async function maybeAddressed(
  items: ReturnType<typeof botOnlyForRewrite>,
  apiKey: string,
  baseUrl: string,
  model: string,
  changedPaths: readonly string[],
): Promise<readonly AddressedOutputItem[]> {
  if (apiKey === '' || model === '' || items.length === 0) return [];
  const result = await completeChat({
    fetch,
    baseUrl,
    apiKey,
    model,
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
            excerpt: item.title,
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
  const laterPaths =
    existing?.meta != null && existing.meta.headSha.toLowerCase() !== loaded.headSha.toLowerCase()
      ? await filesChangedBetween(client, event.owner, event.repo, existing.meta.headSha, loaded.headSha)
      : [];
  const pr = { ...loaded, changedPaths: laterPaths };
  const aiKey = input('ai-key') || env.INPUT_AI_KEY || '';
  const baseUrl = input('ai-base-url') || env.INPUT_AI_BASE_URL || 'https://api.openai.com';
  const model = input('model') || env.INPUT_MODEL || '';
  const extras = extraBots(input('extra-bots') || env.INPUT_EXTRA_BOTS || '');
  const maxItemsRaw = Number.parseInt(input('max-items') || env.INPUT_MAX_ITEMS || '80', 10);
  const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? maxItemsRaw : 80;
  const producer: ProducerRecord = { kind: 'action', version: ACTION_VERSION, ai: aiKey !== '' && model !== '' };
  const draft = buildMeta(pr, {
    producer: { ...producer, ai: false },
    generatedAt: new Date().toISOString(),
    extraBotLogins: extras,
    previous: existing?.meta ?? null,
    previousBody: existing?.body ?? '',
    maxItems,
  });
  const rewritten = producer.ai ? await maybeRewrite(botOnlyForRewrite(draft.items), aiKey, baseUrl, model) : [];
  const semantic = producer.ai ? await maybeAddressed(botOnlyForRewrite(draft.items), aiKey, baseUrl, model, pr.changedPaths ?? []) : [];
  const meta = buildMeta(pr, {
    producer,
    generatedAt: draft.generatedAt,
    extraBotLogins: extras,
    previous: existing?.meta ?? null,
    previousBody: existing?.body ?? '',
    rewritten,
    semantic,
    maxItems,
  });
  const body = renderSummary(meta, { owner: event.owner, repo: event.repo, number: event.number });
  const id = await upsertIssueComment(client, event.owner, event.repo, event.number, existing?.commentId ?? null, body);
  console.log(`Upserted Geld summary comment ${id} on ${event.owner}/${event.repo}#${event.number} (${meta.items.length} items).`);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('index.js') || entry.endsWith('main.ts')) {
  run().catch((error: unknown) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
