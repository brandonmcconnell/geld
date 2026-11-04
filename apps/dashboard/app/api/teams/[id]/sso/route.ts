import { readJson } from '@/lib/http';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { getAuth } from '@/lib/auth';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { json, sameOrigin } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
const providerSchema = z.object({
  providerId: z.string(),
  domain: z.string(),
  domainVerified: z.boolean().nullable(),
  issuer: z.string(),
  userId: z.string().nullable(),
});
async function readGET(_request: Request, { params }: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const actor = await currentActor();
  const { id } = await params;
  if (!actor || !(await teamMembership(actor.id, id, true)))
    return json({ error: 'Team admin permission is required' }, 403);
  const db = database();
  return json({
    providers: db
      ? z
          .array(providerSchema)
          .parse(
            (
              await db.query(
                'SELECT p."providerId",p.domain,p."domainVerified",p.issuer,p."userId" FROM "ssoProvider" p JOIN team_sso_providers t ON t.provider_id=p."providerId" WHERE t.team_id=$1',
                [id],
              )
            ).rows,
          )
          .map((row) => ({
            ...row,
            canManage: row.userId === actor.id,
            userId: undefined,
          }))
      : [],
  });
}
async function handle(request: Request, { params }: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  const { id } = await params;
  if (!actor || !(await teamMembership(actor.id, id, true)))
    return json({ error: 'Team admin permission is required' }, 403);
  const auth = getAuth();
  const db = database();
  if (!auth || !db) return json({ error: 'SSO storage is unavailable' }, 503);
  const tier = await db.query(
    "SELECT team_id FROM subscriptions WHERE team_id=$1 AND tier IN('business','enterprise') AND status IN('active','trialing')",
    [id],
  );
  if (!tier.rows.length) return json({ error: 'SSO requires Business or Enterprise' }, 402);
  const input = z
    .discriminatedUnion('action', [
      z.object({
        action: z.literal('register'),
        domain: z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
        issuer: z.url().refine((raw) => {
          const u = new URL(raw);
          return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
        }),
        clientId: z.string().min(1).max(500),
        clientSecret: z.string().min(1).max(4000),
      }),
      z.object({
        action: z.enum(['token', 'verify', 'delete']),
        providerId: z.string().max(200),
      }),
    ])
    .safeParse(await readJson(request));
  if (!input.success) return json({ error: 'Enter a domain, HTTPS OIDC issuer and client credentials' }, 400);
  try {
    if (input.data.action === 'register') {
      const providerId = `geld-${crypto.randomUUID()}`;
      const response = await auth.api.registerSSOProvider({
        headers: await headers(),
        body: {
          providerId,
          issuer: input.data.issuer,
          domain: input.data.domain,
          oidcConfig: {
            clientId: input.data.clientId,
            clientSecret: input.data.clientSecret,
            pkce: true,
            scopes: ['openid', 'profile', 'email'],
          },
        },
      });
      const saved = z
        .object({
          providerId: z.string(),
          domainVerificationToken: z.string().optional(),
          redirectURI: z.string().optional(),
        })
        .parse(response);
      await db.query('INSERT INTO team_sso_providers(provider_id,team_id) VALUES($1,$2)', [providerId, id]);
      return json({ saved: true, ...saved });
    }
    const owned = await db.query(
      'SELECT p.id FROM "ssoProvider" p JOIN team_sso_providers t ON t.provider_id=p."providerId" WHERE t.team_id=$1 AND p."providerId"=$2 AND p."userId"=$3',
      [id, input.data.providerId, actor.id],
    );
    if (!owned.rows.length) return json({ error: 'Only the connection creator can change this SSO provider' }, 403);
    if (input.data.action === 'token') {
      const result = await auth.api.requestDomainVerification({
        headers: await headers(),
        body: { providerId: input.data.providerId },
      });
      return json({
        token: z.object({ domainVerificationToken: z.string() }).parse(result).domainVerificationToken,
      });
    }
    if (input.data.action === 'verify') {
      await auth.api.verifyDomain({
        headers: await headers(),
        body: { providerId: input.data.providerId },
      });
      return json({ verified: true });
    }
    await auth.api.deleteSSOProvider({
      headers: await headers(),
      body: { providerId: input.data.providerId },
    });
    return json({ removed: true });
  } catch {
    return json(
      {
        error: 'SSO setup could not be confirmed. Check discovery, the client credentials and the domain TXT record.',
      },
      409,
    );
  }
}
export const POST = auditedRoute(handle, 'teams.sso');

export const GET = auditedRoute(readGET, 'teams.team.sso.get');
