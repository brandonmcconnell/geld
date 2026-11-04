import { readJson } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
import { connection } from 'next/server';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  findSettingsGist,
  readRemoteValidated,
  writeRemote,
  validateSettingsDocument,
  SignedOutError,
} from '@geld/core';
import { currentActor, providerTokenSource } from '@/lib/session';
import { database } from '@/lib/db';
import { json, sameOrigin } from '@/lib/http';
async function readGET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in first' }, 401);
  const db = database();
  if (!db) return json({ error: 'Preference storage is unavailable' }, 503);
  const row = z
    .object({ settings: z.unknown() })
    .safeParse((await db.query('SELECT settings FROM users WHERE id=$1', [actor.id])).rows[0]);
  const value = row.success ? validateSettingsDocument(JSON.stringify(row.data.settings)) : null;
  return json({ settings: value?.ok ? value.settings : DEFAULT_SETTINGS });
}
async function handlePOST(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in first' }, 401);
  const input = z
    .object({
      action: z.enum(['save', 'import_gist', 'export_gist']),
      document: z.string().max(200000).optional(),
    })
    .safeParse(await readJson(request));
  if (!input.success) return json({ error: 'Invalid preferences request' }, 400);
  const db = database();
  if (!db) return json({ error: 'Preference storage is unavailable' }, 503);
  const parsed = validateSettingsDocument(input.data.document ?? '{}');
  if (input.data.action !== 'import_gist' && !parsed.ok)
    return json(
      {
        error: 'The settings document contains invalid values',
        issues: parsed.issues,
      },
      400,
    );
  if (input.data.action === 'save' && parsed.ok) {
    await db.query('UPDATE users SET settings=$2 WHERE id=$1', [actor.id, JSON.stringify(parsed.settings)]);
    return json({ saved: true, settings: parsed.settings });
  }
  const source = await providerTokenSource('github', undefined, true);
  async function withToken<T>(work: (token: string) => Promise<T>): Promise<T> {
    const first = await source.get();
    if (first.status !== 'ok') throw new Error('Identity access unavailable');
    try {
      return await work(first.token);
    } catch (error) {
      if (!(error instanceof SignedOutError)) throw error;
      const second = await source.get({ force: true });
      if (second.status !== 'ok') throw new Error('Identity access unavailable');
      return work(second.token);
    }
  }
  try {
    const gist = await withToken((token) => findSettingsGist(token));
    if (input.data.action === 'import_gist') {
      if (!gist) return json({ error: 'No Geld settings gist was found' }, 404);
      const read = await withToken((token) => readRemoteValidated(token, gist.id));
      return read.kind === 'valid'
        ? json({
            settings: read.remote.settings,
            updatedAt: read.remote.updatedAt,
          })
        : json(
            {
              error: 'The gist is missing or invalid. It has not been overwritten.',
            },
            409,
          );
    }
    if (!parsed.ok) return json({ error: 'Invalid settings' }, 400);
    if (gist) {
      const current = await withToken((token) => readRemoteValidated(token, gist.id));
      if (current.kind === 'invalid')
        return json(
          {
            error: 'The existing gist is invalid. Repair it before overwriting.',
          },
          409,
        );
    }
    const written = await withToken((token) => writeRemote(token, gist?.id ?? null, parsed.settings));
    return json({ saved: true, updatedAt: written.updatedAt });
  } catch {
    return json({ error: 'Reconnect the GitHub identity App to sync gist settings' }, 503);
  }
}

export const POST = auditedRoute(handlePOST, 'preferences.post');

export const GET = auditedRoute(readGET, 'preferences.get');
