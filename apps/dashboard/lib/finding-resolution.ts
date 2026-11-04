import { providerFindings, findingFingerprint } from '@geld/review/provider-findings';
import type { ProviderClient, ProviderThread, PullRef } from '@geld/domain';
export async function resolveSourceThreads(input: {
  readonly client: Pick<ProviderClient, 'pull' | 'threads' | 'comments' | 'resolve'>;
  readonly ref: PullRef;
  readonly headSha: string;
  readonly itemId: string;
  readonly fingerprint: string;
  readonly ids: readonly string[];
  readonly originalThreads: readonly ProviderThread[];
}): Promise<{
  readonly completed: readonly string[];
  readonly remaining: readonly string[];
}> {
  const { client, ref } = input;
  const completed: string[] = [];
  for (const id of input.ids) {
    const head = await client.pull(ref);
    if (!head.ok || head.value.headSha !== input.headSha) break;
    const [threads, comments] = await Promise.all([client.threads(ref), client.comments(ref)]);
    if (!threads.ok || !comments.ok) break;
    const fresh = providerFindings(
      threads.value.map((thread) =>
        completed.includes(thread.id)
          ? {
              ...thread,
              resolved:
                input.originalThreads.find((original) => original.id === thread.id)?.resolved ?? thread.resolved,
            }
          : thread,
      ),
      comments.value,
    );
    const item = fresh.items.find((item) => item.id === input.itemId);
    if (!item || (await findingFingerprint(fresh, item)) !== input.fingerprint) break;
    const result = await client.resolve(ref, id, true);
    if (!result.ok) break;
    completed.push(id);
  }
  return {
    completed,
    remaining: input.ids.filter((id) => !completed.includes(id)),
  };
}
