'use client';
import { z } from 'zod';
import { createProviderClient } from '@geld/providers';
import { capabilitySchema } from '@geld/domain';
import type { PullRef } from '@geld/domain';
import { createMatcher, parseUnifiedDiffHunks, validateSettingsDocument } from '@geld/core';
import { reviewContextSchema } from './review-contracts';
import type { ReviewData } from './review-contracts';
const bootstrapSchema = z.object({
  token: z.string(),
  settings: z.unknown(),
  warning: z.string().nullable(),
  aiAllowed: z.boolean(),
  capabilities: z.array(capabilitySchema),
});
/** A repository-scoped read token exists only in this closure. Writes use the actor's server token source. */
export async function readEnterpriseInBrowser(ref: PullRef, signal: AbortSignal): Promise<ReviewData | null> {
  if (ref.provider !== 'github' || ref.host === 'github.com') return null;
  try {
    const query = new URLSearchParams({ ...ref, number: String(ref.number) });
    const response = await fetch(`/api/enterprise/reader?${query}`, {
      signal,
      cache: 'no-store',
    });
    const bootstrap = bootstrapSchema.safeParse(await response.json());
    if (!response.ok || !bootstrap.success) return null;
    const data = bootstrap.data;
    const settings = validateSettingsDocument(JSON.stringify(data.settings));
    if (!settings.ok) return null;
    const client = createProviderClient({
      provider: 'github',
      host: ref.host,
      source: {
        get: async () => ({
          status: 'ok',
          token: data.token,
          refreshed: false,
        }),
      },
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
        }),
    });
    const pull = await client.pull(ref);
    if (!pull.ok) return null;
    const [diff, comments, threads] = await Promise.all([client.diff(ref), client.comments(ref), client.threads(ref)]);
    if (!diff.ok) return null;
    const current = await client.pull(ref);
    if (!current.ok || current.value.headSha !== pull.value.headSha) return null;
    const matcher = createMatcher(settings.settings, `${ref.owner}/${ref.repo}`);
    const files = parseUnifiedDiffHunks(diff.value).map((file) => ({
      ...file,
      hidden: matcher.categorizeFile(file) !== null,
    }));
    const result = reviewContextSchema.safeParse({
      pull: { ...pull.value, capabilities: data.capabilities },
      files,
      comments: comments.ok ? comments.value : [],
      commentsUnavailable: !comments.ok,
      threads: threads.ok ? threads.value : [],
      threadsUnavailable: !threads.ok,
      settingsWarning: data.warning,
      aiAllowed: data.aiAllowed,
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
