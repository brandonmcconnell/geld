import { expect, it } from 'vitest';
import { providerProfileIdentity, providerViewer } from './identities';

it('uses provider logins and accepts Bitbucket UUID profiles without treating display names as logins', () => {
  expect(providerProfileIdentity('github', { id: 1, login: 'code-owner', name: 'Display Name' })).toEqual({ externalId: '1', username: 'code-owner' });
  expect(providerProfileIdentity('gitlab', { id: 2, username: 'git-person', name: 'Display Name' })).toEqual({ externalId: '2', username: 'git-person' });
  expect(providerProfileIdentity('bitbucket', { uuid: '{profile-id}', nickname: 'bb-nick', display_name: 'Display Name' })).toEqual({ externalId: '{profile-id}', username: 'bb-nick' });
  expect(providerProfileIdentity('bitbucket', { uuid: '{profile-id}', display_name: 'Display Name' })).toBeNull();
});
it('keeps Enterprise viewer identities separate from the public provider account', () => {
  const viewers = { github: 'public-user', 'github@github.company.example': 'enterprise-user' };
  expect(providerViewer(viewers, { provider: 'github', host: 'github.com' })).toBe('public-user');
  expect(providerViewer(viewers, { provider: 'github', host: 'github.company.example' })).toBe('enterprise-user');
  expect(providerViewer(viewers, { provider: 'github', host: 'other.company.example' })).toBeNull();
});
