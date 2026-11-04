import type { Capability, Permission, Visibility } from './models';

const ranks: Readonly<Record<Permission, number>> = {
  none: 0,
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5,
};

export function effectivePermission(entitlement: Permission, providerPermission: Permission): Permission {
  return ranks[entitlement] <= ranks[providerPermission] ? entitlement : providerPermission;
}

export function mayAct(
  entitled: boolean,
  providerCapabilities: readonly Capability[],
  appCapabilities: readonly Capability[],
  action: Capability,
): boolean {
  return entitled && providerCapabilities.includes(action) && appCapabilities.includes(action);
}

export function hiddenRepositoryView(
  mode: Visibility,
  count: number,
): {
  readonly names: boolean;
  readonly request: boolean;
  readonly count: number | null;
} {
  return {
    names: mode === 'names' || mode === 'request',
    request: mode === 'request',
    count: mode === 'count' ? count : null,
  };
}

export interface Grant {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly mechanism: 'provider_team' | 'collaborator';
  readonly source: 'sync' | 'request_access' | 'audit';
  readonly permission: Permission;
  readonly previous: Permission;
  readonly state: 'pending' | 'active' | 'revoking' | 'revoked' | 'drifted';
  readonly providerGrantId: string | null;
}

export type RevocationDecision =
  | {
      readonly action: 'none';
      readonly reason: 'not_owned' | 'drifted' | 'already_revoked';
    }
  | { readonly action: 'restore'; readonly permission: Permission }
  | { readonly action: 'remove' };

export function revocationFor(
  grant: Grant,
  current: Permission,
  otherTeamPermission: Permission = 'none',
): RevocationDecision {
  if (grant.state === 'revoked') return { action: 'none', reason: 'already_revoked' };
  if (grant.providerGrantId === null || grant.state === 'pending') return { action: 'none', reason: 'not_owned' };
  if (grant.state === 'drifted' || current !== grant.permission) return { action: 'none', reason: 'drifted' };
  const restore = ranks[grant.previous] >= ranks[otherTeamPermission] ? grant.previous : otherTeamPermission;
  return restore === 'none' ? { action: 'remove' } : { action: 'restore', permission: restore };
}

export function grantMechanism(organisationMember: boolean): 'provider_team' | 'collaborator' {
  return organisationMember ? 'provider_team' : 'collaborator';
}

export function canDisableManagedAccess(grants: readonly Grant[]): boolean {
  return grants.every((grant) => grant.state === 'revoked');
}

export function accessRequestExpired(createdAt: number, now: number): boolean {
  return now >= createdAt + 14 * 24 * 60 * 60 * 1000;
}

export type BitbucketAccessPath = 'legacy_groups' | 'atlassian_groups' | 'direct_users';
export function bitbucketAccessPath(migrated: boolean, adminKeyAvailable: boolean): BitbucketAccessPath {
  if (!migrated) return 'legacy_groups';
  return adminKeyAvailable ? 'atlassian_groups' : 'direct_users';
}
