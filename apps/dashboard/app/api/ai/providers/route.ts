import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { json, sameOrigin } from '@/lib/http';
import { encryptCredential } from '@/lib/crypto';
import { allowedAiUrl } from '@/lib/ai-config';
const inputSchema = z.object({ id: z.string().uuid().optional(), provider: z.enum(['geld','gateway','openai','claude']), mode:z.enum(['api','login']).default('api'), label: z.string().min(1).max(100), baseUrl: z.string().optional(), key: z.string().max(4000).optional(), enabled: z.boolean(), models: z.array(z.string().min(1).max(200)).max(10), automaticLadder: z.boolean(), billed: z.boolean().optional(), safetyNet: z.boolean().optional(), capCents: z.number().int().nonnegative().max(100000).optional(), teamId: z.string().optional() });
const safeRows = z.array(z.object({ id: z.string(), provider: z.string(), label: z.string(), base_url: z.string().nullable(), enabled: z.boolean(), has_key: z.boolean(), settings: z.unknown() }));
export async function GET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to manage providers' }, 401);
  const db = database();
  if (!db) return json({ providers: [], configured: false });
  try { const result = await db.query('SELECT id,provider,label,base_url,enabled,(encrypted_key IS NOT NULL) AS has_key,settings FROM ai_providers WHERE user_id = $1 ORDER BY CASE WHEN provider = \'geld\' THEN 0 ELSE 1 END,label', [actor.id]); const parsed = safeRows.safeParse(result.rows); return parsed.success ? json({ providers: parsed.data, configured: true }) : json({ error: 'Provider settings could not be loaded' }, 503); } catch { return json({ error: 'Provider settings could not be loaded' }, 503); }
}
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to manage providers' }, 401);
  const value: unknown = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return json({ error: 'Invalid provider settings' }, 400);
  const input = parsed.data;
  if (input.provider !== 'geld' && !(input.provider==='claude'&&input.mode==='login') && (!input.baseUrl || !allowedAiUrl(input.baseUrl))) return json({ error: 'Choose an approved HTTPS provider or ask the deployment operator to allow your gateway host' }, 400);
  const db = database();
  if (!db) return json({ error: 'Provider storage is not configured' }, 503);
  try {
    if (input.safetyNet) {
      if (!input.teamId) return json({ error: 'Choose a team before enabling the safety net' }, 400);
      const eligible = await db.query('SELECT s.team_id FROM subscriptions s JOIN team_members m ON m.team_id = s.team_id WHERE s.team_id = $1 AND m.user_id = $2 AND m.role = \'admin\' AND s.card_on_file = true', [input.teamId, actor.id]);
      if (!eligible.rows.length || !input.capCents) return json({ error: 'The safety net requires a team admin, a card on file and a positive spending cap' }, 403);
    }
    const encrypted = input.key ? await encryptCredential(input.key) : null;
    const id = input.id ?? crypto.randomUUID();
    if (input.id) {
      const owner = await db.query('SELECT id FROM ai_providers WHERE id = $1 AND user_id = $2 AND provider = $3', [id, actor.id, input.provider]);
      if (!owner.rows.length) return json({ error: 'Provider not found' }, 404);
    }
    const settings = { mode:input.mode, models: input.models, automaticLadder: input.automaticLadder, billed: input.billed ?? true, safetyNet: input.safetyNet ?? false, capCents: input.capCents ?? 0 };
    await db.query('INSERT INTO ai_providers(id,user_id,provider,label,base_url,encrypted_key,enabled,settings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET label = EXCLUDED.label,base_url = EXCLUDED.base_url,encrypted_key = COALESCE(EXCLUDED.encrypted_key,ai_providers.encrypted_key),enabled = EXCLUDED.enabled,settings = EXCLUDED.settings WHERE ai_providers.user_id = $2', [id, actor.id, input.provider, input.label, input.baseUrl ?? null, encrypted, input.enabled, JSON.stringify(settings)]);
    if (input.provider === 'geld' && input.teamId) await db.query('UPDATE subscriptions s SET safety_net = $3, cap_cents = $4 FROM team_members m WHERE s.team_id = $1 AND m.team_id = s.team_id AND m.user_id = $2 AND m.role = \'admin\'', [input.teamId, actor.id, input.safetyNet ?? false, input.capCents ?? 0]);
    return json({ id });
  } catch { return json({ error: 'Provider settings could not be saved. Check encryption configuration and try again.' }, 503); }
}
export async function DELETE(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor(); const db = database();
  if (!actor) return json({ error: 'Sign in to remove a provider' }, 401);
  if (!db) return json({ error: 'Provider storage is not configured' }, 503);
  const input = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: 'Invalid provider' }, 400);
  await db.query("UPDATE relay_channels SET enabled=false WHERE user_id=$2 AND id IN(SELECT relay_channel FROM ai_providers WHERE id=$1 AND user_id=$2)",[input.data.id,actor.id]);
  await db.query('DELETE FROM ai_providers WHERE id = $1 AND user_id = $2 AND provider <> \'geld\'', [input.data.id, actor.id]);
  return json({ removed: true });
}
