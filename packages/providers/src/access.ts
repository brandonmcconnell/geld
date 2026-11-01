import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import type { ApiTransport, FetchLike, TokenSource } from '@geld/github';
import type { Permission, Provider, ProviderResult, RepositoryRef, RepositorySummary } from '@geld/domain';
import { githubRepo } from './parse';
const e = encodeURIComponent;
const permissionSchema = z.enum(['none','read','triage','write','maintain','admin']);
export interface AccessUser { readonly id: string; readonly login: string; readonly permission: Permission; readonly organisationMember: boolean }
export interface ManagedAccessAdapter {
  repository(ref: RepositoryRef): Promise<ProviderResult<RepositorySummary>>;
  user(ref: RepositoryRef, login: string): Promise<ProviderResult<AccessUser>>;
  collaborators(ref: RepositoryRef, page?: number): Promise<ProviderResult<{ readonly users: readonly AccessUser[]; readonly more: boolean }>>;
  grant(ref: RepositoryRef, user: AccessUser, permission: Permission): Promise<ProviderResult<string>>;
  revoke(ref: RepositoryRef, user: AccessUser, grantId?: string): Promise<ProviderResult<void>>;
  createGroup(organisation: string, name: string): Promise<ProviderResult<string>>;
  deleteGroup(organisation: string, group: string): Promise<ProviderResult<void>>;
  groupMember(organisation: string, group: string, user: AccessUser, remove?: boolean): Promise<ProviderResult<void>>;
  share(ref: RepositoryRef, group: string, permission: Permission, remove?: boolean): Promise<ProviderResult<void>>;
}
export interface AccessOptions { readonly provider: Provider; readonly source: TokenSource; readonly fetch?: FetchLike; readonly bitbucket?: { readonly path: 'legacy_groups' | 'atlassian_groups' | 'direct_users'; readonly organisationId?: string; readonly directoryId?: string; readonly adminSource?: TokenSource } }
function level(p: Permission): number { return p === 'admin' ? 50 : p === 'maintain' ? 40 : p === 'write' ? 30 : p === 'triage' ? 20 : 10; }
function glPermission(n: number): Permission { return n >= 50 ? 'admin' : n >= 40 ? 'maintain' : n >= 30 ? 'write' : n >= 20 ? 'read' : 'none'; }
function simple(p: Permission): 'read' | 'write' | 'admin' { return p === 'admin' ? 'admin' : p === 'write' || p === 'maintain' ? 'write' : 'read'; }
function ghPermission(p: Permission): string { return p === 'read' ? 'pull' : p === 'write' ? 'push' : p; }
function bad<T>(): ProviderResult<T> { return { ok: false, reason: 'invalid_response' }; }
function identifier(data: unknown): string | null { const p = z.object({ id: z.union([z.string(),z.number()]).optional(), slug: z.string().optional(), uuid: z.string().optional(), groupId: z.string().optional(), data: z.object({ id: z.string() }).optional() }).safeParse(data); return p.success ? String(p.data.slug ?? p.data.id ?? p.data.uuid ?? p.data.groupId ?? p.data.data?.id ?? '') || null : null; }
export function managedAccessAdapter(options: AccessOptions): ManagedAccessAdapter {
  const p = options.provider;
  const api = createApiTransport({ baseUrl: p === 'github' ? 'https://api.github.com/' : p === 'gitlab' ? 'https://gitlab.com/api/v4/' : 'https://api.bitbucket.org/2.0/', source: options.source, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const legacy = createApiTransport({ baseUrl: 'https://api.bitbucket.org/1.0/', source: options.source, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const admin = options.bitbucket?.adminSource ? createApiTransport({ baseUrl: 'https://api.atlassian.com/admin/', source: options.bitbucket.adminSource, ...(options.fetch ? { fetch: options.fetch } : {}) }) : null;
  const repo = (r: RepositoryRef) => p === 'github' ? `repos/${e(r.owner)}/${e(r.repo)}` : p === 'gitlab' ? `projects/${e(`${r.owner}/${r.repo}`)}` : `repositories/${e(r.owner)}/${e(r.repo)}`;
  const orgGroup = (org: string, group: string) => p === 'github' ? `orgs/${e(org)}/teams/${e(group)}` : p === 'gitlab' ? `groups/${e(group)}` : `groups/${e(org)}/${e(group)}`;
  async function write(transport: ApiTransport, path: string, method: 'POST'|'PUT'|'DELETE', body?: unknown): Promise<ProviderResult<void>> { const r = await transport.request(path, { method, ...(body === undefined ? {} : { body }) }); return r.ok ? { ok: true, value: undefined } : r; }
  async function user(ref: RepositoryRef, login: string): Promise<ProviderResult<AccessUser>> {
    if (p === 'github') {
      const profile = await api.request(`users/${e(login)}`); if (!profile.ok) return profile;
      const u = z.object({ id: z.number(), login: z.string() }).safeParse(profile.value); if (!u.success) return bad();
      const membership = await api.request(`orgs/${e(ref.owner)}/members/${e(u.data.login)}`);
      if (!membership.ok && membership.reason !== 'not_found') return membership;
      const permission = await api.request(`${repo(ref)}/collaborators/${e(u.data.login)}/permission`);
      if (!permission.ok && permission.reason !== 'not_found') return permission;
      const role = permission.ok ? z.object({ permission: permissionSchema }).safeParse(permission.value) : null;
      if (permission.ok && !role?.success) return bad();
      return { ok: true, value: { id: String(u.data.id), login: u.data.login, permission: role?.success ? role.data.permission : 'none', organisationMember: membership.ok } };
    }
    if (p === 'gitlab') {
      const profile = await api.request(`users?username=${e(login)}`); if (!profile.ok) return profile;
      const u = z.array(z.object({ id: z.number(), username: z.string() })).safeParse(profile.value); const first = u.success ? u.data[0] : null; if (!first) return bad();
      const membership = await api.request(`groups/${e(ref.owner)}/members/all/${first.id}`);
      if (!membership.ok && membership.reason !== 'not_found') return membership;
      const permission = await api.request(`${repo(ref)}/members/all/${first.id}`); if (!permission.ok && permission.reason !== 'not_found') return permission;
      const access = permission.ok ? z.object({ access_level: z.number() }).safeParse(permission.value) : null;
      if (permission.ok && !access?.success) return bad();
      return { ok: true, value: { id: String(first.id), login: first.username, permission: access?.success ? glPermission(access.data.access_level) : 'none', organisationMember: membership.ok } };
    }
    const profile = await api.request(`users/${e(login)}`); if (!profile.ok) return profile;
    const u = z.object({ account_id: z.string(), nickname: z.string().optional() }).safeParse(profile.value); if (!u.success) return bad();
    const permission = await api.request(`${repo(ref)}/permissions-config/users/${e(u.data.account_id)}`); if (!permission.ok && permission.reason !== 'not_found') return permission;
    const access = permission.ok ? z.object({ permission: permissionSchema }).safeParse(permission.value) : null;
    if (permission.ok && !access?.success) return bad();
    const member = await api.request(`workspaces/${e(ref.owner)}/members/${e(u.data.account_id)}`); if (!member.ok && member.reason !== 'not_found') return member;
    return { ok: true, value: { id: u.data.account_id, login: u.data.nickname ?? login, permission: access?.success ? access.data.permission : 'none', organisationMember: member.ok } };
  }
  return {
    user,
    async repository(ref) {
      const result = await api.request(repo(ref)); if (!result.ok) return result;
      if (p === 'github') { const value = githubRepo(result.value, ref.host); return value ? { ok: true, value } : bad(); }
      if (p === 'gitlab') {
        const r = z.object({ id: z.number(), visibility: z.string(), web_url: z.string(), permissions: z.object({ project_access: z.object({ access_level: z.number() }).nullable().optional(), group_access: z.object({ access_level: z.number() }).nullable().optional() }).optional() }).safeParse(result.value);
        return r.success ? { ok: true, value: { id: String(r.data.id), ref, private: r.data.visibility !== 'public', permission: glPermission(Math.max(r.data.permissions?.project_access?.access_level ?? 0,r.data.permissions?.group_access?.access_level ?? 0)), url: r.data.web_url } } : bad();
      }
      const r = z.object({ uuid: z.string(), is_private: z.boolean(), links: z.object({ html: z.object({ href: z.string() }) }) }).safeParse(result.value); if (!r.success) return bad();
      const mine = await api.request(`user/permissions/repositories?q=${e(`repository.uuid="${r.data.uuid}"`)}`); if (!mine.ok) return mine;
      const permission = z.object({ values: z.array(z.object({ permission: permissionSchema })) }).safeParse(mine.value);
      return permission.success ? { ok: true, value: { id: r.data.uuid, ref, private: r.data.is_private, url: r.data.links.html.href, permission: permission.data.values[0]?.permission ?? 'none' } } : bad();
    },
    async collaborators(ref, page = 1) {
      const r = await api.request(p === 'github' ? `${repo(ref)}/collaborators?affiliation=outside&per_page=30&page=${page}` : p === 'gitlab' ? `${repo(ref)}/members?per_page=30&page=${page}` : `${repo(ref)}/permissions-config/users?pagelen=30&page=${page}`); if (!r.ok) return r;
      const list = p === 'bitbucket' ? z.object({ values: z.array(z.object({ user: z.object({ account_id: z.string(), nickname: z.string().optional() }), permission: permissionSchema })), next: z.string().optional() }).safeParse(r.value) : null;
      if (p === 'bitbucket') return list?.success ? { ok: true, value: { users: list.data.values.map((v) => ({ id: v.user.account_id, login: v.user.nickname ?? v.user.account_id, permission: v.permission, organisationMember: false })), more: !!list.data.next } } : bad();
      const entries = z.array(z.object({ id: z.number(), login: z.string().optional(), username: z.string().optional(), role_name: permissionSchema.optional(), access_level: z.number().optional() })).safeParse(r.value);
      return entries.success ? { ok: true, value: { users: entries.data.map((u) => ({ id: String(u.id), login: u.login ?? u.username ?? '', permission: u.role_name ?? glPermission(u.access_level ?? 10), organisationMember: false })), more: entries.data.length === 30 } } : bad();
    },
    async grant(ref, u, permission) {
      if (permission === 'none') return bad();
      const path = p === 'github' ? `${repo(ref)}/collaborators/${e(u.login)}` : p === 'gitlab' ? `${repo(ref)}/members${u.permission === 'none' ? '' : `/${e(u.id)}`}` : `${repo(ref)}/permissions-config/users/${e(u.id)}`;
      const r = await api.request(path, { method: p === 'gitlab' && u.permission === 'none' ? 'POST' : 'PUT', body: p === 'gitlab' ? { user_id: u.id, access_level: level(permission) } : { permission: p === 'github' ? ghPermission(permission) : simple(permission) } });
      return r.ok ? { ok: true, value: identifier(r.value) ?? `${u.id}:${ref.owner}/${ref.repo}` } : r;
    },
    revoke: (ref,u,grantId) => write(api, p === 'github' && grantId && /^\d+$/.test(grantId) && u.permission === 'none' ? `${repo(ref)}/invitations/${e(grantId)}` : p === 'github' ? `${repo(ref)}/collaborators/${e(u.login)}` : p === 'gitlab' ? `${repo(ref)}/members/${e(u.id)}` : `${repo(ref)}/permissions-config/users/${e(u.id)}`, 'DELETE'),
    async createGroup(org,name) {
      if (p === 'bitbucket' && options.bitbucket?.path === 'direct_users') return { ok: false, reason: 'unsupported' };
      let parentId: number | null = null;
      if (p === 'gitlab') { const parent = await api.request(`groups/${e(org)}`); if (!parent.ok) return parent; const parsed = z.object({ id: z.number() }).safeParse(parent.value); if (!parsed.success) return bad(); parentId = parsed.data.id; }
      const r = p === 'bitbucket' && options.bitbucket?.path === 'atlassian_groups'
        ? admin && options.bitbucket.organisationId && options.bitbucket.directoryId ? await admin.request(`v2/orgs/${e(options.bitbucket.organisationId)}/directories/${e(options.bitbucket.directoryId)}/groups`, { method: 'POST', body: { name, description: 'Managed by Geld' } }) : null
        : p === 'bitbucket' ? await legacy.request(`groups/${e(org)}/`, { method: 'POST', rawBody: new URLSearchParams({ name, permission: 'none', auto_add: 'false' }).toString(), contentType: 'application/x-www-form-urlencoded' })
        : await api.request(p === 'github' ? `orgs/${e(org)}/teams` : 'groups', { method: 'POST', body: p === 'github' ? { name, privacy: 'closed', permission: 'pull' } : { name, path: name.toLowerCase(), parent_id: parentId, visibility: 'private' } });
      if (!r) return { ok: false, reason: 'unsupported' }; if (!r.ok) return r;
      const id = identifier(r.value); return id ? { ok: true, value: id } : bad();
    },
    async deleteGroup(org,group) {
      if (p === 'bitbucket' && options.bitbucket?.path === 'atlassian_groups') return admin && options.bitbucket.organisationId ? write(admin, `v1/orgs/${e(options.bitbucket.organisationId)}/directory/groups/${e(group)}`, 'DELETE') : { ok: false, reason: 'unsupported' };
      return write(p === 'bitbucket' ? legacy : api, orgGroup(org,group), 'DELETE');
    },
    async groupMember(org,group,u,remove = false) {
      if (!u.organisationMember) return { ok: false, reason: 'permission', required: 'Existing organisation membership', url: null };
      if (p === 'bitbucket' && options.bitbucket?.path === 'atlassian_groups') return admin && options.bitbucket.organisationId ? write(admin, `v1/orgs/${e(options.bitbucket.organisationId)}/directory/groups/${e(group)}/memberships${remove ? `/${e(u.id)}` : ''}`, remove ? 'DELETE' : 'POST', remove ? undefined : { account_id: u.id }) : { ok: false, reason: 'unsupported' };
      return write(p === 'bitbucket' ? legacy : api, `${orgGroup(org,group)}/${p === 'github' ? `memberships/${e(u.login)}` : p === 'gitlab' ? `members${remove ? `/${e(u.id)}` : ''}` : `members/${e(u.id)}`}`, remove ? 'DELETE' : p === 'gitlab' ? 'POST' : 'PUT', remove ? undefined : p === 'github' ? { role: 'member' } : p === 'gitlab' ? { user_id: u.id, access_level: 30 } : undefined);
    },
    async share(ref,group,permission,remove = false) {
      if (p === 'bitbucket' && options.bitbucket?.path === 'legacy_groups') {
        const r = await legacy.request(`group-privileges/${e(ref.owner)}/${e(ref.repo)}/${e(ref.owner)}/${e(group)}`, { method: remove ? 'DELETE' : 'PUT', ...(remove ? {} : { rawBody: simple(permission), contentType: 'text/plain' }) }); return r.ok ? { ok: true, value: undefined } : r;
      }
      return write(api, p === 'github' ? `orgs/${e(ref.owner)}/teams/${e(group)}/repos/${e(ref.owner)}/${e(ref.repo)}` : p === 'gitlab' ? `${repo(ref)}/share${remove ? `/${e(group)}` : ''}` : `${repo(ref)}/permissions-config/groups/${e(group)}`, remove ? 'DELETE' : p === 'gitlab' ? 'POST' : 'PUT', remove ? undefined : p === 'gitlab' ? { group_id: group, group_access: level(permission) } : { permission: p === 'github' ? ghPermission(permission) : simple(permission) });
    },
  };
}
