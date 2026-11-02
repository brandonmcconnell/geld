import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { appPermissions, permissionFingerprint } from './repository-apps';
describe('repository App permission sets', () => {
  it('shares a canonical fingerprint independent of key ordering', () => {
    expect(permissionFingerprint({ contents: 'read', pull_requests: 'write' })).toBe(
      permissionFingerprint({ pull_requests: 'write', contents: 'read' }),
    );
  });
  it('keeps identity scopes out of repository Apps and adds managed access permissions only when selected', () => {
    const base = appPermissions({
      managedAccess: false,
      merge: false,
      settings: false,
      deletion: false,
    });
    expect(base).toEqual({
      contents: 'read',
      metadata: 'read',
      pull_requests: 'write',
      issues: 'write',
    });
    const managed = appPermissions({
      managedAccess: true,
      merge: true,
      settings: false,
      deletion: false,
    });
    expect(managed).toMatchObject({
      members: 'write',
      administration: 'write',
      contents: 'write',
    });
    expect(permissionFingerprint(base)).not.toBe(permissionFingerprint(managed));
  });
});
