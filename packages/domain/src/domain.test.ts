import { describe, expect, it } from 'vitest';
import { accessRequestExpired, bitbucketAccessPath, effectivePermission, grantMechanism, mayAct, revocationFor } from './access';
import type { Grant } from './access';
import { canSpend, guideCredits } from './billing';
import { DEFAULT_GUIDE_POLICY, effectiveGuidePolicy, shouldGenerateGuide } from './guides';
import { parseDashboardRoute, pullPath, validEnterpriseHost } from './routes';

const grant: Grant = { id: 'grant', teamId: 'team', userId: 'user', mechanism: 'collaborator', source: 'sync', permission: 'write', previous: 'read', state: 'active', providerGrantId: 'external-grant' };
describe('provider authority', () => {
  it('never elevates a team admin above provider or App privileges', () => {
    expect(effectivePermission('admin', 'read')).toBe('read');
    expect(mayAct(true, ['read'], ['read', 'delete'], 'delete')).toBe(false);
    expect(mayAct(true, ['read', 'merge'], ['read'], 'merge')).toBe(false);
  });
  it('preserves existing access and grants from other teams during revocation', () => {
    expect(revocationFor(grant, 'write')).toEqual({ action: 'restore', permission: 'read' });
    expect(revocationFor(grant, 'write', 'write')).toEqual({ action: 'restore', permission: 'write' });
    expect(revocationFor(grant, 'admin')).toEqual({ action: 'none', reason: 'drifted' });
    expect(revocationFor({ ...grant, providerGrantId: null }, 'write')).toEqual({ action: 'none', reason: 'not_owned' });
  });
  it('uses direct collaboration for outsiders and never organisation invitations', () => {
    expect(grantMechanism(false)).toBe('collaborator');
    expect(grantMechanism(true)).toBe('provider_team');
    expect(bitbucketAccessPath(true, false)).toBe('direct_users');
    expect(bitbucketAccessPath(true, true)).toBe('atlassian_groups');
    expect(bitbucketAccessPath(false, false)).toBe('legacy_groups');
  });
  it('expires access requests at fourteen days', () => {
    expect(accessRequestExpired(0, 14 * 86400000 - 1)).toBe(false);
    expect(accessRequestExpired(0, 14 * 86400000)).toBe(true);
  });
});
describe('billing boundaries', () => {
  it('counts a large initial guide differently from a replan', () => {
    expect(guideCredits(1500, false)).toBe(1);
    expect(guideCredits(1501, false)).toBe(3);
    expect(guideCredits(4000, true)).toBe(1);
  });
  it('requires an upgrade, card and cap without charging included credits', () => {
    const input = { tier: 'starter', seats: 2, used: 79, requested: 3, capCents: 50, spentCents: 0, card: true };
    expect(canSpend({ ...input, tier: 'starter' })).toEqual({ allowed: true, overageCents: 50 });
    expect(canSpend({ ...input, tier: 'starter', card: false })).toEqual({ allowed: false, reason: 'card' });
    expect(canSpend({ ...input, tier: 'starter', capCents: 49 })).toEqual({ allowed: false, reason: 'cap' });
    expect(canSpend({ ...input, tier: 'free' })).toEqual({ allowed: false, reason: 'upgrade' });
  });
});
describe('route identity', () => {
  it('round trips encoded GitLab namespaces and Enterprise hosts', () => {
    const ref = { provider: 'gitlab', host: 'gitlab.com', owner: 'group/subgroup', repo: 'repo', number: 23 };
    const path = pullPath({ ...ref, provider: 'gitlab' });
    expect(path).toBe('/gitlab/group%2Fsubgroup/repo/pull/23');
    expect(parseDashboardRoute(path.slice(1).split('/').map(decodeURIComponent))).toEqual({ kind: 'pull', ref });
    expect(parseDashboardRoute(['ghe', 'company.ghe.com', 'org', 'repo', 'pull', '5'])?.kind).toBe('pull');
    expect(parseDashboardRoute(['github', 'org', '~settings'])).toMatchObject({ kind: 'organisation', settings: true });
    expect(parseDashboardRoute(['github', 'org', 'repo', 'pull', '1e2'])).toBeNull();
    expect(validEnterpriseHost('127.0.0.1')).toBe(false);
  });
});
describe('guide inheritance', () => {
  it('honors a parent lock and excludes closed PRs and drafts by default', () => {
    const locked = { ...DEFAULT_GUIDE_POLICY, trigger: 'created', override: true, locked: true };
    const policy = effectiveGuidePolicy([{ ...locked, trigger: 'created' }, { ...DEFAULT_GUIDE_POLICY, override: true, trigger: 'push' }]);
    expect(policy.trigger).toBe('created');
    expect(shouldGenerateGuide(policy, 'push', 'open', false)).toBe(false);
    expect(shouldGenerateGuide(policy, 'created', 'closed', false)).toBe(false);
    expect(shouldGenerateGuide(policy, 'created', 'open', true)).toBe(false);
    expect(shouldGenerateGuide(policy, 'created', 'open', false)).toBe(true);
  });
});

it('uses a verified negotiated Enterprise pool and never guesses a quote',()=>{
  const input={tier:'enterprise',seats:2,used:99,requested:2,capCents:100,spentCents:0,card:true} satisfies Parameters<typeof canSpend>[0];
  expect(canSpend(input)).toEqual({allowed:false,reason:'quote'});
  expect(canSpend({...input,negotiated:{included:100,overageCents:10}})).toEqual({allowed:true,overageCents:10});
  expect(canSpend({...input,capCents:0,negotiated:{included:100,overageCents:10}})).toEqual({allowed:false,reason:'cap'});
});
