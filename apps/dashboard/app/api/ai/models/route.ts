import { connection } from 'next/server';
import { z } from 'zod';
import { listModels } from '@geld/review/ai-client';
import { isEvaluationModel } from '@geld/review/jev';
import { currentActor } from '@/lib/session';
import { aiConfigurations } from '@/lib/ai-config';
import {companionFetch} from '@/lib/companion';
import { configured } from '@/lib/env';
import { json } from '@/lib/http';
export async function GET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ models: [] }, 401);
  try {
    const configurations = [...new Map((await aiConfigurations(actor.id, undefined, true)).map((config) => [config.id, config])).values()];
    const result = await Promise.all(configurations.map(async (config) => {
      if (config.provider === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }, redirect: 'error' });
        const value: unknown = await response.json();
        const parsed = z.object({ data: z.array(z.object({ id: z.string(), display_name: z.string() })) }).safeParse(value);
        return parsed.success ? parsed.data.data.map((model) => ({ id: model.id, name: model.display_name, instance: config.id, provider: config.provider })) : [];
      }
      const models = await listModels(config.relay?companionFetch(config.relay):async (input, init) => fetch(input, { ...init, redirect: 'error' }), config.baseUrl, config.apiKey);
      return models.ok ? models.models.filter((model) => !isEvaluationModel(model.id, model.type)).map((model) => ({ id: model.id, name: model.name ?? model.id, instance: config.id, provider: config.provider })) : [];
    }));
    return json({ models: result.flat(), geldConfigured: !!configured(process.env.AI_GATEWAY_API_KEY) });
  } catch { return json({ error: 'Models could not be loaded', models: [] }, 503); }
}
