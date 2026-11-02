import { z } from 'zod';
import type { Provider, RepositoryRef } from './models';

const profileSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  account_id: z.string().optional(),
  uuid: z.string().optional(),
  login: z.string().optional(),
  username: z.string().optional(),
  nickname: z.string().optional(),
});
export function providerProfileIdentity(provider: Provider, raw: unknown): { readonly externalId: string; readonly username: string } | null {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const profile = parsed.data;
  const id = profile.id ?? profile.account_id ?? profile.uuid;
  const username = provider === 'github' ? profile.login : provider === 'gitlab' ? profile.username : profile.nickname ?? profile.username;
  if (id === undefined || !username || username.length > 255) return null;
  return { externalId: String(id), username };
}
export function providerViewer(viewers: Readonly<Record<string, string>> | undefined, ref: Pick<RepositoryRef, 'provider' | 'host'>): string | null {
  const scoped = viewers?.[`${ref.provider}@${ref.host}`];
  if (scoped) return scoped;
  const publicHost = ref.provider === 'github' ? 'github.com' : ref.provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org';
  return ref.host === publicHost ? viewers?.[ref.provider] ?? null : null;
}
