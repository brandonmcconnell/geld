import 'server-only';
import type { RelayEndpoint } from '@geld/relay';
import {companionEndpoint,companionFetch} from './companion';
import { z } from 'zod';
import { database } from './db';
import { configured } from './env';
import { decryptCredential } from './crypto';
import { completeChat } from '@geld/review/ai-client';
import type { ChatCompletionOptions, ChatCompletionResult } from '@geld/review/ai-client';
const providersSchema = z.array(z.object({ id: z.string(), provider: z.string(), base_url: z.string().nullable(), encrypted_key: z.string().nullable(), settings: z.unknown(), relay_channel:z.string().nullable() }));
const modelSettings = z.object({ mode:z.enum(['api','login']).default('api'), models: z.array(z.string()).default([]), automaticLadder: z.boolean().default(true), billed: z.boolean().default(true), safetyNet: z.boolean().default(false) });
const knownHosts = new Set(['ai-gateway.vercel.sh','openrouter.ai','api.openai.com','api.anthropic.com']);
export function allowedAiUrl(raw: string): boolean {
  try { const url = new URL(raw); const allowed = [...knownHosts, ...(configured(process.env.AI_ALLOWED_HOSTS)?.split(',').map((host) => host.trim()) ?? [])]; return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port && allowed.includes(url.hostname); } catch { return false; }
}
export interface AiConfiguration { readonly id: string; readonly provider: string; readonly apiKey: string; readonly baseUrl: string; readonly model: string; readonly geldBilled: boolean; readonly fallback: boolean; readonly relay?:RelayEndpoint }
export async function aiConfigurations(userId: string, teamId?: string, discover = false): Promise<readonly AiConfiguration[]> {
  const db = database();
  if (!db) return [];
  const result = await db.query('SELECT id,provider,base_url,encrypted_key,settings,relay_channel FROM ai_providers WHERE user_id = $1 AND enabled = true ORDER BY CASE WHEN provider = \'geld\' THEN 0 ELSE 1 END,id', [userId]);
  const rows = providersSchema.safeParse(result.rows);
  if (!rows.success) return [];
  const configs: AiConfiguration[] = [];
  const fallback: AiConfiguration[] = [];
  const eligibility = teamId ? z.object({ card_on_file: z.boolean(), safety_net: z.boolean(), cap_cents: z.number() }).safeParse((await db.query('SELECT card_on_file,safety_net,cap_cents FROM subscriptions WHERE team_id = $1', [teamId])).rows[0]) : null;
  for (const row of rows.data) {
    const settings = modelSettings.safeParse(row.settings);
    if (!settings.success) continue;
    if(row.provider==='claude'&&settings.data.mode==='login'){const relay=row.relay_channel?await companionEndpoint(row.relay_channel,userId):null;if(relay){const models=settings.data.models.length?settings.data.models:['sonnet'];for(const model of (settings.data.automaticLadder?models.slice(0,3):models.slice(0,1)))configs.push({id:row.id,provider:'companion',apiKey:'local-companion',baseUrl:'https://claude.local.geld.invalid',model,geldBilled:false,fallback:false,relay});}continue;}
    if (row.provider === 'geld') {
      const key = configured(process.env.AI_GATEWAY_API_KEY); const model = configured(process.env.AI_GATEWAY_MODEL); const baseUrl = configured(process.env.AI_GATEWAY_BASE_URL) ?? 'https://ai-gateway.vercel.sh';
      if (key && model && allowedAiUrl(baseUrl)) {
        if (settings.data.billed) configs.push({ id: row.id, provider: 'gateway', apiKey: key, baseUrl, model, geldBilled: true, fallback: false });
        else if (settings.data.safetyNet && eligibility?.success && eligibility.data.card_on_file && eligibility.data.safety_net && eligibility.data.cap_cents > 0) fallback.push({ id: row.id, provider: 'gateway', apiKey: key, baseUrl, model, geldBilled: true, fallback: true });
      }
      continue;
    }
    const key = row.encrypted_key ? await decryptCredential(row.encrypted_key) : null;
    if (!key || !row.base_url || !allowedAiUrl(row.base_url)) continue;
    const availableModels = settings.data.models.length ? settings.data.models : discover ? [''] : [];
    const models = settings.data.automaticLadder ? availableModels.slice(0,3) : availableModels.slice(0,1);
    for (const model of models) configs.push({ id: row.id, provider: row.provider, apiKey: key, baseUrl: row.base_url, model, geldBilled: false, fallback: false });
  }
  return [...configs, ...fallback];
}
export async function completeConfigured(config: AiConfiguration, options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  if(config.provider==='companion'&&config.relay)return completeChat({...options,baseUrl:config.baseUrl,apiKey:config.apiKey,model:config.model,timeoutMs:120000,fetch:companionFetch(config.relay)});
  if (config.provider !== 'claude') return completeChat({ ...options, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, fetch: async (input, init) => fetch(input, { ...init, redirect: 'error' }) });
  try {
    const system = options.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000), headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: config.model, max_tokens: 12000, system, messages: options.messages.filter((message) => message.role !== 'system'), ...(options.jsonSchema ? { output_config: { format: { type: 'json_schema', schema: options.jsonSchema } } } : {}) }) });
    if (!response.ok) return { ok: false, reason: 'The AI provider is unavailable' };
    const payload: unknown = await response.json();
    const parsed = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })), model: z.string() }).safeParse(payload);
    return parsed.success ? { ok: true, text: parsed.data.content.map((part) => part.text ?? '').join(''), model: parsed.data.model } : { ok: false, reason: 'The AI provider returned an invalid response' };
  } catch { return { ok: false, reason: 'The AI provider is unavailable' }; }
}
