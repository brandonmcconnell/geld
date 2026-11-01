import { createApiTransport } from '@geld/github';
import type { ApiTransport, FetchLike, TokenSource } from '@geld/github';
import type { ProviderResult, PullRef, RepositoryRef } from '@geld/domain';

export type RepositoryAction =
  | { readonly kind: 'merge'; readonly headSha: string; readonly method: 'merge' | 'squash' | 'rebase' }
  | { readonly kind: 'close' | 'reopen' }
  | { readonly kind: 'settings'; readonly description: string; readonly archived: boolean }
  | { readonly kind: 'delete'; readonly confirmation: string };

export async function githubAction(api: ApiTransport, ref: PullRef, action: RepositoryAction): Promise<ProviderResult<void>> {
  const repo = `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  if (action.kind === 'delete' && action.confirmation !== `${ref.owner}/${ref.repo}`) return { ok: false, reason: 'invalid_response' };
  const result = action.kind === 'merge'
    ? await api.request(`${repo}/pulls/${ref.number}/merge`, { method: 'PUT', body: { sha: action.headSha, merge_method: action.method } })
    : action.kind === 'close' || action.kind === 'reopen'
      ? await api.request(`${repo}/pulls/${ref.number}`, { method: 'PATCH', body: { state: action.kind === 'close' ? 'closed' : 'open' } })
      : action.kind === 'settings'
        ? await api.request(repo, { method: 'PATCH', body: { description: action.description, archived: action.archived } })
        : await api.request(repo, { method: 'DELETE' });
  return result.ok ? { ok: true, value: undefined } : result;
}

export interface AccessAdapter {
  grantCollaborator(ref: RepositoryRef, user: string, permission: 'read' | 'write' | 'admin'): Promise<ProviderResult<void>>;
  removeCollaborator(ref: RepositoryRef, user: string): Promise<ProviderResult<void>>;
  addOrganisationMemberToTeam(organisation: string, team: string, user: string): Promise<ProviderResult<void>>;
}

export function githubAccessAdapter(options: { readonly source: TokenSource; readonly fetch?: FetchLike }): AccessAdapter {
  const api = createApiTransport({ baseUrl: 'https://api.github.com/', source: options.source, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const repoPath = (ref: RepositoryRef, user: string): string => `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/collaborators/${encodeURIComponent(user)}`;
  async function request(path: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<ProviderResult<void>> {
    const result = await api.request(path, { method, ...(body === undefined ? {} : { body }) });
    return result.ok ? { ok: true, value: undefined } : result;
  }
  return {
    grantCollaborator: (ref, user, permission) => request(repoPath(ref, user), 'PUT', { permission: permission === 'read' ? 'pull' : permission === 'write' ? 'push' : 'admin' }),
    removeCollaborator: (ref, user) => request(repoPath(ref, user), 'DELETE'),
    async addOrganisationMemberToTeam(organisation, team, user) {
      const membership = await api.request(`orgs/${encodeURIComponent(organisation)}/members/${encodeURIComponent(user)}`);
      if (!membership.ok) return membership;
      return request(`orgs/${encodeURIComponent(organisation)}/teams/${encodeURIComponent(team)}/memberships/${encodeURIComponent(user)}`, 'PUT', { role: 'member' });
    },
  };
}
