import { z } from 'zod';
import type { Capability, PullDetail, PullRef, PullSummary, RepositorySummary } from '@geld/domain';

const ghUser = z.object({ login: z.string(), avatar_url: z.string().optional() });
export const githubPullSchema = z.object({
  id: z.number(), number: z.number().int().positive(), title: z.string(), body: z.string().nullable().optional(),
  user: ghUser.nullable(), state: z.enum(['open', 'closed']), draft: z.boolean().optional(), merged: z.boolean().optional(), merged_at: z.string().nullable().optional(),
  updated_at: z.string(), html_url: z.string(), head: z.object({ sha: z.string() }), base: z.object({ sha: z.string() }),
  additions: z.number().optional(), deletions: z.number().optional(),
  labels: z.array(z.object({ name: z.string() })).optional(), requested_reviewers: z.array(ghUser).optional(),
});
export function githubPull(value: unknown, ref: PullRef, capabilities: readonly Capability[] = ['read']): PullDetail | null {
  const result = githubPullSchema.safeParse(value);
  if (!result.success) return null;
  const d = result.data;
  return { ref, id: String(d.id), title: d.title, body: d.body ?? '', author: d.user?.login ?? 'unknown', authorAvatar: d.user?.avatar_url ?? null, state: d.merged === true || d.merged_at ? 'merged' : d.state, draft: d.draft ?? false, updatedAt: d.updated_at, url: d.html_url, headSha: d.head.sha, baseSha: d.base.sha, additions: d.additions ?? 0, deletions: d.deletions ?? 0, labels: d.labels?.map((l) => l.name) ?? [], reviewers: d.requested_reviewers?.map((r) => r.login) ?? [], capabilities };
}
export const githubRepoSchema = z.object({ id: z.number(), name: z.string(), owner: ghUser, private: z.boolean(), html_url: z.string(), permissions: z.object({ admin: z.boolean().optional(), maintain: z.boolean().optional(), push: z.boolean().optional(), triage: z.boolean().optional(), pull: z.boolean().optional() }).optional() });
export function githubRepo(value: unknown, host: string): RepositorySummary | null {
  const result = githubRepoSchema.safeParse(value);
  if (!result.success) return null;
  const d = result.data;
  const p = d.permissions;
  return { ref: { provider: 'github', host, owner: d.owner.login, repo: d.name }, id: String(d.id), private: d.private, url: d.html_url, permission: p?.admin ? 'admin' : p?.maintain ? 'maintain' : p?.push ? 'write' : p?.triage ? 'triage' : 'read' };
}
export const gitlabPullSchema = z.object({
  id: z.number(), iid: z.number().int().positive(), title: z.string(), description: z.string().nullable().optional(), state: z.enum(['opened', 'closed', 'merged', 'locked']), draft: z.boolean().optional(), work_in_progress: z.boolean().optional(), updated_at: z.string(), web_url: z.string(), sha: z.string().nullable().optional(),
  author: z.object({ username: z.string(), avatar_url: z.string().nullable().optional() }), labels: z.array(z.string()).optional(), reviewers: z.array(z.object({ username: z.string() })).optional(), diff_refs: z.object({ base_sha: z.string(), head_sha: z.string(), start_sha: z.string().optional() }).nullable().optional(),
});
export function gitlabPull(value: unknown, ref: PullRef, capabilities: readonly Capability[] = ['read']): PullDetail | null {
  const result = gitlabPullSchema.safeParse(value);
  if (!result.success) return null;
  const d = result.data;
  return { ref, ...(d.diff_refs?.start_sha ? { startSha: d.diff_refs.start_sha } : {}), id: String(d.id), title: d.title, body: d.description ?? '', author: d.author.username, authorAvatar: d.author.avatar_url ?? null, state: d.state === 'opened' || d.state === 'locked' ? 'open' : d.state, draft: d.draft ?? d.work_in_progress ?? false, updatedAt: d.updated_at, url: d.web_url, headSha: d.diff_refs?.head_sha ?? d.sha ?? '', baseSha: d.diff_refs?.base_sha ?? '', additions: 0, deletions: 0, labels: d.labels ?? [], reviewers: d.reviewers?.map((r) => r.username) ?? [], capabilities };
}
export const bitbucketPullSchema = z.object({ id: z.number().int().positive(), title: z.string(), description: z.string().optional(), state: z.enum(['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']), draft: z.boolean().optional(), updated_on: z.string(), links: z.object({ html: z.object({ href: z.string() }) }), author: z.object({ nickname: z.string().optional(), display_name: z.string(), links: z.object({ avatar: z.object({ href: z.string() }) }).optional() }), source: z.object({ commit: z.object({ hash: z.string() }) }), destination: z.object({ commit: z.object({ hash: z.string() }) }), reviewers: z.array(z.object({ nickname: z.string().optional(), display_name: z.string() })).optional() });
export function bitbucketPull(value: unknown, ref: PullRef, capabilities: readonly Capability[] = ['read']): PullDetail | null {
  const result = bitbucketPullSchema.safeParse(value);
  if (!result.success) return null;
  const d = result.data;
  return { ref, id: String(d.id), title: d.title, body: d.description ?? '', author: d.author.nickname ?? d.author.display_name, authorAvatar: d.author.links?.avatar.href ?? null, state: d.state === 'OPEN' ? 'open' : d.state === 'MERGED' ? 'merged' : 'closed', draft: d.draft ?? false, updatedAt: d.updated_on, url: d.links.html.href, headSha: d.source.commit.hash, baseSha: d.destination.commit.hash, additions: 0, deletions: 0, labels: [], reviewers: d.reviewers?.map((r) => r.nickname ?? r.display_name) ?? [], capabilities };
}
export function pullSummary(detail: PullDetail): PullSummary {
  const { body: _body, capabilities: _capabilities, ...summary } = detail;
  return summary;
}
