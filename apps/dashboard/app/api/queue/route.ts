import { connection } from 'next/server';
import type { PullSummary, RepositorySummary } from '@geld/domain';
import { currentActor } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { json } from '@/lib/http';
export async function GET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to see your review queue', pulls: [], repositories: [] }, 401);
  const clients = await Promise.all([providerClient('github'), providerClient('gitlab'), providerClient('bitbucket')]);
  const results = await Promise.all(clients.map(async (client) => {
    const repositories = await client.repositories();
    if (!repositories.ok) return { provider: client.provider, repositories: [], pulls: [], more: false, error: repositories.reason };
    const selected = repositories.value.items.slice(0, 8);
    const pages = await Promise.all(selected.map((repo) => client.pulls(repo.ref)));
    const pulls: PullSummary[] = [];
    for (const page of pages) if (page.ok) pulls.push(...page.value.items);
    return { provider: client.provider, repositories: repositories.value.items, pulls, more: !!repositories.value.cursor || repositories.value.items.length > 8 || pages.some((p) => p.ok && !!p.value.cursor), error: pages.some((p) => !p.ok) ? 'Some repositories could not be loaded' : null };
  }));
  const pulls: PullSummary[] = results.flatMap((result) => result.pulls);
  const repositories: RepositorySummary[] = results.flatMap((result) => result.repositories);
  return json({ pulls, repositories, sources: results.map(({ provider, error, more }) => ({ provider, error, more })) });
}
