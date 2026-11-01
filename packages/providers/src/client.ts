import { z } from 'zod';
import type { Capability, LineComment, Provider, ProviderClient, ProviderComment, ProviderResult, PullDetail, PullRef, PullSummary, RepositoryRef, RepositorySummary, ReviewSubmission } from '@geld/domain';
import { validEnterpriseHost } from '@geld/domain';
import { createApiTransport } from '@geld/github';
import type { ApiTransport, FetchLike, TokenSource } from '@geld/github';
import { bitbucketPull, bitbucketPullSchema, githubPull, githubPullSchema, githubRepo, gitlabPull, gitlabPullSchema } from './parse';

const e = encodeURIComponent;
const recordSchema = z.record(z.string(), z.unknown());
const ghRepos = z.array(z.unknown());
const glRepoSchema = z.object({ id: z.number(), path: z.string(), path_with_namespace: z.string(), visibility: z.string(), web_url: z.string(), permissions: z.object({ project_access: z.object({ access_level: z.number() }).nullable().optional(), group_access: z.object({ access_level: z.number() }).nullable().optional() }).optional() });
const bbRepoSchema = z.object({ uuid: z.string(), slug: z.string(), full_name: z.string(), is_private: z.boolean(), links: z.object({ html: z.object({ href: z.string() }) }) });
const bbPageSchema = z.object({ values: z.array(z.unknown()), next: z.string().optional(), size: z.number().optional() });
const idSchema = z.object({ id: z.union([z.string(), z.number()]), html_url: z.string().optional() });

function pageNumber(cursor: string | null | undefined): number | null {
  if (!cursor) return 1;
  return /^[1-9]\d{0,5}$/.test(cursor) ? Number(cursor) : null;
}
function parsed<T>(value: T | null): ProviderResult<T> {
  return value === null ? { ok: false, reason: 'invalid_response' } : { ok: true, value };
}
function capabilities(permission: RepositorySummary['permission']): readonly Capability[] {
  if (permission === 'admin') return ['read', 'comment', 'review', 'merge', 'settings', 'manage_access', 'delete'];
  if (permission === 'maintain') return ['read', 'comment', 'review', 'merge', 'settings'];
  if (permission === 'write') return ['read', 'comment', 'review', 'merge'];
  return ['read', 'comment', 'review'];
}
export interface ProviderClientOptions {
  readonly provider: Provider;
  readonly host?: string;
  readonly source: TokenSource;
  readonly fetch?: FetchLike;
  readonly anonymousReads?: boolean;
}

export function createProviderClient(options: ProviderClientOptions): ProviderClient {
  const { provider } = options;
  const host = options.host ?? (provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org');
  if (provider === 'github' && host !== 'github.com' && !validEnterpriseHost(host)) throw new Error('Invalid Enterprise host');
  if (provider === 'gitlab' && host !== 'gitlab.com') throw new Error('GitLab host is not registered');
  if (provider === 'bitbucket' && host !== 'bitbucket.org') throw new Error('Bitbucket host is not registered');
  const baseUrl = provider === 'github' ? host === 'github.com' ? 'https://api.github.com/' : host.endsWith('.ghe.com') ? `https://api.${host}/` : `https://${host}/api/v3/` : provider === 'gitlab' ? 'https://gitlab.com/api/v4/' : 'https://api.bitbucket.org/2.0/';
  const api = createApiTransport({ baseUrl, source: options.source, ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.anonymousReads === undefined ? {} : { anonymousReads: options.anonymousReads }) });
  return clientFor(api, provider, host);
}

function clientFor(api: ApiTransport, provider: Provider, host: string): ProviderClient {
  const owns = (repo: RepositoryRef): boolean => repo.provider === provider && repo.host === host;
  const repoPath = (repo: RepositoryRef): string => provider === 'gitlab' ? `projects/${e(`${repo.owner}/${repo.repo}`)}` : `repositories/${e(repo.owner)}/${e(repo.repo)}`;
  const pullBase = (ref: PullRef): string => provider === 'github' ? `repos/${e(ref.owner)}/${e(ref.repo)}/pulls/${ref.number}` : `${repoPath(ref)}/${provider === 'gitlab' ? 'merge_requests' : 'pullrequests'}/${ref.number}`;
  const parsePull = (data: unknown, ref: PullRef, caps?: readonly Capability[]): PullDetail | null => provider === 'github' ? githubPull(data, ref, caps) : provider === 'gitlab' ? gitlabPull(data, ref, caps) : bitbucketPull(data, ref, caps);
  const numberOf = (data: unknown): number | null => {
    if (provider === 'github') { const d = githubPullSchema.safeParse(data); return d.success ? d.data.number : null; }
    if (provider === 'gitlab') { const d = gitlabPullSchema.safeParse(data); return d.success ? d.data.iid : null; }
    const d = bitbucketPullSchema.safeParse(data); return d.success ? d.data.id : null;
  };
  async function write(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<ProviderResult<string>> {
    const result = await api.request(path, { method, ...(body === undefined ? {} : { body }) });
    if (!result.ok) return result;
    if (result.value === null) return { ok: true, value: '' };
    const id = idSchema.safeParse(result.value);
    return id.success ? { ok: true, value: id.data.html_url ?? String(id.data.id) } : { ok: true, value: '' };
  }
  return {
    provider,
    async repositories(cursor) {
      const page = pageNumber(cursor);
      if (page === null) return { ok: false, reason: 'invalid_response' };
      const path = provider === 'github' ? `user/repos?per_page=30&page=${page}&sort=updated` : provider === 'gitlab' ? `projects?membership=true&per_page=30&page=${page}&order_by=last_activity_at` : `user/permissions/repositories?pagelen=30&page=${page}`;
      const result = await api.request(path);
      if (!result.ok) return result;
      const list = provider === 'bitbucket' ? bbPageSchema.safeParse(result.value) : ghRepos.safeParse(result.value);
      if (!list.success) return { ok: false, reason: 'invalid_response' };
      const data = Array.isArray(list.data) ? list.data : list.data.values;
      const items: RepositorySummary[] = [];
      for (const value of data) {
        if (provider === 'github') {
          const repo = githubRepo(value, host);
          if (repo === null) return { ok: false, reason: 'invalid_response' };
          items.push(repo);
        } else if (provider === 'gitlab') {
          const repo = glRepoSchema.safeParse(value);
          if (!repo.success) return { ok: false, reason: 'invalid_response' };
          const d = repo.data;
          const level = Math.max(d.permissions?.project_access?.access_level ?? 0, d.permissions?.group_access?.access_level ?? 0);
          items.push({ id: String(d.id), ref: { provider, host, owner: d.path_with_namespace.slice(0, -(d.path.length + 1)), repo: d.path }, private: d.visibility !== 'public', url: d.web_url, permission: level >= 50 ? 'admin' : level >= 40 ? 'maintain' : level >= 30 ? 'write' : 'read' });
        } else {
          const wrapped = z.object({ repository: bbRepoSchema, permission: z.string() }).safeParse(value);
          if (!wrapped.success) return { ok: false, reason: 'invalid_response' };
          const d = wrapped.data.repository;
          items.push({ id: d.uuid, ref: { provider, host, owner: d.full_name.split('/')[0] ?? '', repo: d.slug }, private: d.is_private, url: d.links.html.href, permission: wrapped.data.permission === 'admin' ? 'admin' : wrapped.data.permission === 'write' ? 'write' : 'read' });
        }
      }
      const bb = bbPageSchema.safeParse(result.value);
      const more = provider === 'bitbucket' ? bb.success && !!bb.data.next : items.length === 30;
      return { ok: true, value: { items, cursor: more ? String(page + 1) : null, total: null, capped: false } };
    },
    async pulls(repo, cursor) {
      const page = pageNumber(cursor);
      if (!owns(repo) || page === null) return { ok: false, reason: 'invalid_response' };
      const path = provider === 'github' ? `repos/${e(repo.owner)}/${e(repo.repo)}/pulls?state=open&per_page=30&page=${page}` : `${repoPath(repo)}/${provider === 'gitlab' ? `merge_requests?state=opened&per_page=30` : 'pullrequests?state=OPEN&pagelen=30'}&page=${page}`;
      const result = await api.request(path);
      if (!result.ok) return result;
      const list = provider === 'bitbucket' ? bbPageSchema.safeParse(result.value) : ghRepos.safeParse(result.value);
      if (!list.success) return { ok: false, reason: 'invalid_response' };
      const data = Array.isArray(list.data) ? list.data : list.data.values;
      const items: PullSummary[] = [];
      for (const value of data) {
        const number = numberOf(value);
        const pull = number === null ? null : parsePull(value, { ...repo, number });
        if (!pull) return { ok: false, reason: 'invalid_response' };
        items.push(pull);
      }
      const bb = bbPageSchema.safeParse(result.value);
      const more = provider === 'bitbucket' ? bb.success && !!bb.data.next : items.length === 30;
      return { ok: true, value: { items, cursor: more ? String(page + 1) : null, total: null, capped: false } };
    },
    async pull(ref) {
      if (!owns(ref)) return { ok: false, reason: 'invalid_response' };
      const result = await api.request(pullBase(ref));
      if (!result.ok) return result;
      let caps: readonly Capability[] = ['read'];
      if (provider === 'github') {
        const repo = await api.request(`repos/${e(ref.owner)}/${e(ref.repo)}`);
        const parsedRepo = repo.ok ? githubRepo(repo.value, host) : null;
        if (parsedRepo) caps = capabilities(parsedRepo.permission);
      } else {
        const access = await api.request(provider === 'gitlab' ? repoPath(ref) : `user/permissions/repositories?q=${e(`repository.full_name="${ref.owner}/${ref.repo}"`)}`);
        if (access.ok && provider === 'gitlab') {
          const r = glRepoSchema.safeParse(access.value);
          if (r.success) { const level = Math.max(r.data.permissions?.project_access?.access_level ?? 0, r.data.permissions?.group_access?.access_level ?? 0); caps = capabilities(level >= 50 ? 'admin' : level >= 40 ? 'maintain' : level >= 30 ? 'write' : 'read'); }
        }
        if (access.ok && provider === 'bitbucket') {
          const p = z.object({ values: z.array(z.object({ permission: z.string() })) }).safeParse(access.value);
          const permission = p.success ? p.data.values[0]?.permission : null;
          if (permission) caps = capabilities(permission === 'admin' ? 'admin' : permission === 'write' ? 'write' : 'read');
        }
      }
      return parsed(parsePull(result.value, ref, caps));
    },
    async diff(ref) {
      if (!owns(ref)) return { ok: false, reason: 'invalid_response' };
      const result = await api.request(`${pullBase(ref)}${provider === 'gitlab' ? '/raw_diffs' : provider === 'bitbucket' ? '/diff' : ''}`, { text: true, ...(provider === 'github' ? { accept: 'application/vnd.github.diff' } : {}) });
      if (!result.ok) return result;
      if (typeof result.value !== 'string' || !result.value.startsWith('diff --git ') || result.value.length > 8_000_000) return { ok: false, reason: 'invalid_response' };
      return { ok: true, value: result.value };
    },
    async comments(ref) {
      if (!owns(ref)) return { ok: false, reason: 'invalid_response' };
      const path = provider === 'github' ? `repos/${e(ref.owner)}/${e(ref.repo)}/issues/${ref.number}/comments?per_page=100` : `${pullBase(ref)}/${provider === 'gitlab' ? 'notes?per_page=100' : 'comments?pagelen=100'}`;
      const result = await api.request(path);
      if (!result.ok) return result;
      const list = provider === 'bitbucket' ? bbPageSchema.safeParse(result.value) : ghRepos.safeParse(result.value);
      if (!list.success) return { ok: false, reason: 'invalid_response' };
      const data = Array.isArray(list.data) ? list.data : list.data.values;
      const items: ProviderComment[] = [];
      for (const entry of data) {
        const r = recordSchema.safeParse(entry);
        if (!r.success) continue;
        const author = z.object({ login: z.string().optional(), username: z.string().optional(), display_name: z.string().optional() }).safeParse(r.data.user ?? r.data.author);
        const content = z.object({ raw: z.string() }).safeParse(r.data.content);
        if (typeof r.data.id !== 'number' && typeof r.data.id !== 'string') continue;
        items.push({ id: String(r.data.id), author: author.success ? author.data.login ?? author.data.username ?? author.data.display_name ?? 'unknown' : 'unknown', body: typeof r.data.body === 'string' ? r.data.body : content.success ? content.data.raw : '', path: null, line: null, url: typeof r.data.html_url === 'string' ? r.data.html_url : '' });
      }
      return { ok: true, value: items };
    },
    async comment(ref, body) {
      if (!owns(ref) || !body.trim()) return { ok: false, reason: 'invalid_response' };
      const path = provider === 'github' ? `repos/${e(ref.owner)}/${e(ref.repo)}/issues/${ref.number}/comments` : `${pullBase(ref)}/${provider === 'gitlab' ? 'notes' : 'comments'}`;
      return write(path, 'POST', provider === 'bitbucket' ? { content: { raw: body } } : { body });
    },
    async lineComment(ref: PullRef, comment: LineComment) {
      if (!owns(ref) || comment.line < 1 || !comment.body.trim()) return { ok: false, reason: 'invalid_response' };
      if (provider === 'github') return write(`${pullBase(ref)}/comments`, 'POST', { body: comment.body, path: comment.path, line: comment.line, side: comment.side === 'new' ? 'RIGHT' : 'LEFT', commit_id: comment.headSha });
      if (provider === 'bitbucket') return write(`${pullBase(ref)}/comments`, 'POST', { content: { raw: comment.body }, inline: { path: comment.path, ...(comment.side === 'new' ? { to: comment.line } : { from: comment.line }) } });
      return { ok: false, reason: 'unsupported' };
    },
    async review(ref: PullRef, review: ReviewSubmission) {
      if (!owns(ref)) return { ok: false, reason: 'invalid_response' };
      if (provider === 'github') return write(`${pullBase(ref)}/reviews`, 'POST', { event: review.event === 'approve' ? 'APPROVE' : review.event === 'request_changes' ? 'REQUEST_CHANGES' : 'COMMENT', body: review.body, commit_id: review.headSha });
      if (provider === 'gitlab') {
        if (review.event === 'approve') return write(`${pullBase(ref)}/approve`, 'POST', { sha: review.headSha });
        if (review.event === 'comment') return write(`${pullBase(ref)}/notes`, 'POST', { body: review.body });
        return { ok: false, reason: 'unsupported' };
      }
      if (review.event === 'comment') return write(`${pullBase(ref)}/comments`, 'POST', { content: { raw: review.body } });
      return write(`${pullBase(ref)}/${review.event === 'approve' ? 'approve' : 'request-changes'}`, 'POST');
    },
    async requestReviewers(ref, reviewers) {
      if (!owns(ref)) return { ok: false, reason: 'invalid_response' };
      if (provider !== 'github') return { ok: false, reason: 'unsupported' };
      const result = await api.request(`${pullBase(ref)}/requested_reviewers`, { method: 'POST', body: { reviewers } });
      return result.ok ? { ok: true, value: undefined } : result;
    },
  };
}
