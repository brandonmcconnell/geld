import 'server-only';
import { z } from 'zod';
import { configured } from './env';
const flagsSchema = z.object({
  projects: z.boolean().default(false),
  roadmaps: z.boolean().default(false),
});
export type FeatureFlags = z.infer<typeof flagsSchema>;
export function localFeatureFlags(raw: string | undefined): FeatureFlags {
  try {
    const parsed = flagsSchema.safeParse(JSON.parse(raw ?? '{}'));
    return parsed.success ? parsed.data : { projects: false, roadmaps: false };
  } catch {
    return { projects: false, roadmaps: false };
  }
}
let cached: { expires: number; value: FeatureFlags } | null = null;
/** Global release flags use no user, repository or device identifiers and emit no flag-called events. */
export async function featureFlags(): Promise<FeatureFlags> {
  const local = configured(process.env.GELD_FEATURE_FLAGS);
  if (local) return localFeatureFlags(local);
  if (process.env.POSTHOG_FLAGS_ENABLED !== 'true') return localFeatureFlags(undefined);
  if (cached && cached.expires > Date.now()) return cached.value;
  const key = configured(process.env.NEXT_PUBLIC_POSTHOG_KEY);
  const origin = configured(process.env.POSTHOG_FLAGS_HOST) ?? 'https://us.i.posthog.com';
  if (!key) return localFeatureFlags(undefined);
  try {
    const url = new URL('/flags/?v=2', origin);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid flag host');
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        distinct_id: 'geld-global-release-flags',
        disable_geoip: true,
        flag_keys_to_evaluate: ['projects', 'roadmaps'],
      }),
    });
    if (!response.ok) throw new Error('Flags unavailable');
    const value: unknown = await response.json();
    const parsed = z
      .object({
        featureFlags: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
        flags: z
          .record(
            z.string(),
            z.object({
              enabled: z.boolean(),
              variant: z.string().nullable().optional(),
            }),
          )
          .optional(),
      })
      .parse(value);
    const enabled = (key: string) =>
      parsed.featureFlags?.[key] === true ||
      (!parsed.featureFlags && parsed.flags?.[key]?.enabled === true && !parsed.flags[key]?.variant);
    const flags = flagsSchema.parse({
      projects: enabled('projects'),
      roadmaps: enabled('roadmaps'),
    });
    cached = { expires: Date.now() + 60000, value: flags };
    return flags;
  } catch {
    return localFeatureFlags(undefined);
  }
}
