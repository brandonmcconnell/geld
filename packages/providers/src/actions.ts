import { githubEndpoints } from '@geld/domain';
import { createApiTransport } from '@geld/github';
import type { ApiTransport, FetchLike, TokenSource } from '@geld/github';
import type { ProviderResult, PullRef, RepositoryRef } from '@geld/domain';

export type RepositoryAction =
  | {
      readonly kind: 'merge';
      readonly headSha: string;
      readonly method: 'merge' | 'squash' | 'rebase';
    }
  | { readonly kind: 'close' | 'reopen' }
  | {
      readonly kind: 'settings';
      readonly description?: string | undefined;
      readonly archived?: boolean | undefined;
    }
  | { readonly kind: 'delete'; readonly confirmation: string };

export async function githubAction(
  api: ApiTransport,
  ref: PullRef,
  action: RepositoryAction,
): Promise<ProviderResult<void>> {
  const repo = `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  if (action.kind === 'delete' && action.confirmation !== `${ref.owner}/${ref.repo}`)
    return { ok: false, reason: 'invalid_response' };
  const result =
    action.kind === 'merge'
      ? await api.request(`${repo}/pulls/${ref.number}/merge`, {
          method: 'PUT',
          body: { sha: action.headSha, merge_method: action.method },
        })
      : action.kind === 'close' || action.kind === 'reopen'
        ? await api.request(`${repo}/pulls/${ref.number}`, {
            method: 'PATCH',
            body: { state: action.kind === 'close' ? 'closed' : 'open' },
          })
        : action.kind === 'settings'
          ? await api.request(repo, {
              method: 'PATCH',
              body: {
                description: action.description,
                archived: action.archived,
              },
            })
          : await api.request(repo, { method: 'DELETE' });
  if (
    result.ok &&
    action.kind === 'merge' &&
    (!result.value || typeof result.value !== 'object' || !('merged' in result.value) || result.value.merged !== true)
  )
    return { ok: false, reason: 'unavailable' };
  return result.ok ? { ok: true, value: undefined } : result;
}

export interface AccessAdapter {
  grantCollaborator(
    ref: RepositoryRef,
    user: string,
    permission: 'read' | 'write' | 'admin',
  ): Promise<ProviderResult<void>>;
  removeCollaborator(ref: RepositoryRef, user: string): Promise<ProviderResult<void>>;
  addOrganisationMemberToTeam(organisation: string, team: string, user: string): Promise<ProviderResult<void>>;
}

export function githubAccessAdapter(options: {
  readonly source: TokenSource;
  readonly fetch?: FetchLike;
}): AccessAdapter {
  const api = createApiTransport({
    baseUrl: 'https://api.github.com/',
    source: options.source,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const repoPath = (ref: RepositoryRef, user: string): string =>
    `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/collaborators/${encodeURIComponent(user)}`;
  async function request(path: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<ProviderResult<void>> {
    const result = await api.request(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    return result.ok ? { ok: true, value: undefined } : result;
  }
  return {
    async grantCollaborator(ref, user, permission) {
      if (ref.provider !== 'github' || ref.host !== 'github.com') return { ok: false, reason: 'unsupported' };
      return request(repoPath(ref, user), 'PUT', {
        permission: permission === 'read' ? 'pull' : permission === 'write' ? 'push' : 'admin',
      });
    },
    async removeCollaborator(ref, user) {
      if (ref.provider !== 'github' || ref.host !== 'github.com') return { ok: false, reason: 'unsupported' };
      return request(repoPath(ref, user), 'DELETE');
    },
    async addOrganisationMemberToTeam(organisation, team, user) {
      const membership = await api.request(
        `orgs/${encodeURIComponent(organisation)}/members/${encodeURIComponent(user)}`,
      );
      if (!membership.ok) return membership;
      return request(
        `orgs/${encodeURIComponent(organisation)}/teams/${encodeURIComponent(team)}/memberships/${encodeURIComponent(user)}`,
        'PUT',
        { role: 'member' },
      );
    },
  };
}

export async function providerAction(
  options: {
    readonly provider: 'github' | 'gitlab' | 'bitbucket';
    readonly source: TokenSource;
    readonly fetch?: FetchLike;
  },
  ref: PullRef,
  action: RepositoryAction,
): Promise<ProviderResult<void>> {
  const api = createApiTransport({
    baseUrl:
      options.provider === 'github'
        ? githubEndpoints(ref.host).api
        : options.provider === 'gitlab'
          ? 'https://gitlab.com/api/v4/'
          : 'https://api.bitbucket.org/2.0/',
    source: options.source,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (options.provider === 'github') return githubAction(api, ref, action);
  const e = encodeURIComponent;
  const repo =
    options.provider === 'gitlab'
      ? `projects/${e(`${ref.owner}/${ref.repo}`)}`
      : `repositories/${e(ref.owner)}/${e(ref.repo)}`;
  const pull = `${repo}/${options.provider === 'gitlab' ? 'merge_requests' : 'pullrequests'}/${ref.number}`;
  if (action.kind === 'delete' && action.confirmation !== `${ref.owner}/${ref.repo}`)
    return { ok: false, reason: 'invalid_response' };
  if (
    options.provider === 'bitbucket' &&
    (action.kind === 'merge' ||
      action.kind === 'reopen' ||
      (action.kind === 'settings' && action.archived !== undefined))
  )
    return { ok: false, reason: 'unsupported' };
  if (options.provider === 'gitlab' && action.kind === 'merge' && action.method === 'rebase')
    return { ok: false, reason: 'unsupported' };
  const result: ProviderResult<unknown> =
    action.kind === 'merge'
      ? await api.request(`${pull}/merge`, {
          method: 'PUT',
          body: { sha: action.headSha, squash: action.method === 'squash' },
        })
      : action.kind === 'close' || action.kind === 'reopen'
        ? await api.request(options.provider === 'gitlab' ? pull : `${pull}/decline`, {
            method: options.provider === 'gitlab' ? 'PUT' : 'POST',
            ...(options.provider === 'gitlab'
              ? { body: { state_event: action.kind === 'close' ? 'close' : 'reopen' } }
              : {}),
          })
        : action.kind === 'delete'
          ? await api.request(repo, { method: 'DELETE' })
          : action.kind === 'settings'
            ? await api.request(repo, { method: 'PUT', body: { description: action.description } })
            : { ok: false, reason: 'unsupported' };
  if (!result.ok) return result;
  if (action.kind === 'settings' && options.provider === 'gitlab' && action.archived !== undefined) {
    const archive = await api.request(`${repo}/${action.archived ? 'archive' : 'unarchive'}`, { method: 'POST' });
    if (!archive.ok) return archive;
  }
  return { ok: true, value: undefined };
}
