import { auditedRoute } from '@/lib/request-audit';
import { connection } from 'next/server';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { exchangeTrackerToken, trackerOAuth } from '@/lib/tracker-oauth';
import { bindTrackerAuthorization } from '@/lib/tracker-authorization';
import { decryptCredential, encryptCredential } from '@/lib/crypto';
import { resourceDigest } from '@/lib/resource-digest';
import { dashboardOrigin } from '@/lib/env';
import { transaction } from '@/lib/transactions';
import { appendAudit } from '@/lib/audit';
import { json } from '@/lib/http';
async function readGET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  const db = database();
  if (!actor || !db) return json({ error: 'Sign in to finish tracker setup' }, 401);
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) return json({ error: 'Tracker authorization was cancelled or did not complete' }, 400);
  const flow = z
    .object({
      team_id: z.string(),
      provider: z.string(),
      config_version: z.union([z.string(), z.number()]),
      encrypted_verifier: z.string(),
    })
    .safeParse(
      (
        await db.query(
          'UPDATE tracker_oauth_flows SET completed_at=now() WHERE state_digest=$1 AND actor_id=$2 AND completed_at IS NULL AND expires_at>now() RETURNING *',
          [resourceDigest(state), actor.id],
        )
      ).rows[0],
    );
  if (!flow.success || !(await teamMembership(actor.id, flow.data.team_id, true)))
    return json({ error: 'This authorization expired' }, 409);
  const selected = z
    .object({
      provider: z.string(),
      config_version: z.union([z.string(), z.number()]),
      base_url: z.string().nullable(),
      settings: z.record(z.string(), z.unknown()),
    })
    .safeParse(
      (
        await db.query('SELECT provider,config_version,base_url,settings FROM tracker_connections WHERE team_id=$1', [
          flow.data.team_id,
        ])
      ).rows[0],
    );
  if (
    !selected.success ||
    selected.data.provider !== flow.data.provider ||
    String(selected.data.config_version) !== String(flow.data.config_version)
  )
    return json({ error: 'Tracker settings changed. Start authorization again for the current configuration.' }, 409);
  const config = trackerOAuth(flow.data.provider);
  const verifier = await decryptCredential(flow.data.encrypted_verifier);
  if (!config || !verifier) return json({ error: 'Tracker OAuth is not configured' }, 503);
  const token = await exchangeTrackerToken(config.provider, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.callback,
    ...(config.provider === 'asana' || config.provider === 'linear' ? { code_verifier: verifier } : {}),
  });
  if (!token) return json({ error: 'The tracker did not confirm authorization. Existing credentials were kept.' }, 409);
  let cloudId: string | null = null;
  if (config.provider === 'linear') {
    const api = createApiTransport({
      baseUrl: 'https://api.linear.app/',
      source: { get: async () => ({ status: 'ok', token: token.access_token, refreshed: false }) },
    });
    const result = await api.request('graphql', {
      method: 'POST',
      body: { query: 'query ConnectedWorkspace { viewer { organization { urlKey } } }' },
    });
    const workspace = result.ok
      ? z
          .object({ data: z.object({ viewer: z.object({ organization: z.object({ urlKey: z.string() }) }) }) })
          .safeParse(result.value)
      : null;
    if (!workspace?.success || selected.data.settings.workspace !== workspace.data.data.viewer.organization.urlKey)
      return json(
        {
          error:
            'The authorized Linear workspace does not match the saved link settings. The existing connection was kept.',
        },
        403,
      );
  }
  if (config.provider === 'jira') {
    const api = createApiTransport({
      baseUrl: 'https://api.atlassian.com/',
      source: { get: async () => ({ status: 'ok', token: token.access_token, refreshed: false }) },
    });
    const result = await api.request('oauth/token/accessible-resources');
    const resources = result.ok ? z.array(z.object({ id: z.string(), url: z.string() })).safeParse(result.value) : null;
    cloudId = resources?.success
      ? (resources.data.find((resource) => resource.url.replace(/\/$/, '') === selected.data.base_url)?.id ?? null)
      : null;
    if (!cloudId) return json({ error: 'This Jira site was not authorized. The existing connection was kept.' }, 403);
  }
  const saved = await transaction(db, async (sql) => {
    const bound = await bindTrackerAuthorization(sql, {
      teamId: flow.data.team_id,
      actorId: actor.id,
      provider: config.provider,
      version: flow.data.config_version,
      encryptedAccess: await encryptCredential(token.access_token),
      encryptedRefresh: token.refresh_token ? await encryptCredential(token.refresh_token) : null,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      cloudId,
    });
    if (bound)
      await appendAudit(sql, {
        teamId: flow.data.team_id,
        actorId: actor.id,
        action: 'tracker.authorize',
        resourceType: 'tracker',
        resourceId: config.provider,
        outcome: 'success',
      });
    return bound;
  });
  return saved
    ? Response.redirect(new URL(`/teams/${flow.data.team_id}/settings?tracker=connected`, dashboardOrigin()))
    : json(
        {
          error:
            'Tracker settings or team permissions changed. The existing connection was kept. Start authorization again.',
        },
        409,
      );
}

export const GET = auditedRoute(readGET, 'tracker.callback.get');
