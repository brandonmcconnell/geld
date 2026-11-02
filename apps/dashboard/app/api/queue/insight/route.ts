import { connection } from 'next/server';
import { createMatcher, parseUnifiedDiff } from '@geld/core';
import { pullRefSchema } from '@geld/domain';
import { currentActor } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { reviewSettings } from '@/lib/review-settings';
import { json } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
async function readGET(request: Request): Promise<Response> {
  await connection();
  if (!(await currentActor())) return json({ error: 'Sign in first' }, 401);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const ref = pullRefSchema.safeParse({ ...query, number: Number(query.number) });
  if (!ref.success) return json({ error: 'Invalid pull request' }, 400);
  try {
    const client = await providerClient(ref.data.provider, ref.data.host, ref.data.owner);
    const pull = await client.pull(ref.data);
    if (!pull.ok) return json({ error: pull.reason }, 503);
    const [diff, settings, requests] = await Promise.all([
      client.diff(ref.data),
      reviewSettings(ref.data),
      client.reviewRequesters?.(ref.data),
    ]);
    if (!diff.ok) return json({ error: diff.reason }, 503);
    const current = await client.pull(ref.data);
    if (!current.ok || current.value.headSha !== pull.value.headSha)
      return json({ error: 'Pull request changed' }, 409);
    const matcher = createMatcher(settings.settings, `${ref.data.owner}/${ref.data.repo}`);
    const essential = { files: 0, additions: 0, deletions: 0 };
    const hidden = { files: 0, additions: 0, deletions: 0 };
    const categories = new Map<
      string,
      { id: string; label: string; files: number; additions: number; deletions: number }
    >();
    for (const file of parseUnifiedDiff(diff.value)) {
      const category = matcher.categorizeFile(file);
      const count = category ? hidden : essential;
      count.files++;
      count.additions += file.additions;
      count.deletions += file.deletions;
      if (category) {
        const group = categories.get(category.id) ?? {
          id: category.id,
          label: category.title,
          files: 0,
          additions: 0,
          deletions: 0,
        };
        group.files++;
        group.additions += file.additions;
        group.deletions += file.deletions;
        categories.set(category.id, group);
      }
    }
    return json({
      headSha: pull.value.headSha,
      essential,
      hidden,
      categories: [...categories.values()],
      requesters: requests?.ok
        ? [
            ...new Set(
              requests.value
                .filter((item) => current.value.reviewers.includes(item.reviewer))
                .map((item) => item.requester),
            ),
          ]
        : null,
    });
  } catch {
    return json({ error: 'Change counts are unavailable' }, 503);
  }
}
export const GET = auditedRoute(readGET, 'queue.insight.get');
