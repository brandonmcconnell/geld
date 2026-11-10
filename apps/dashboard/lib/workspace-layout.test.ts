import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted((): { actor: { id: string; name: string; email: string } | null } => ({ actor: null }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirect:/sign-in'); }) }));
vi.mock('./session', () => ({ currentActor: vi.fn(async () => fixture.actor) }));
vi.mock('@/components/app-shell', () => ({ AppShell: vi.fn(() => null) }));

import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { AppShell } from '@/components/app-shell';
import WorkspaceLayout from '../app/(workspace)/layout';
import PublicLayout from '../app/(public)/layout';

afterEach(() => {
  fixture.actor = null;
  vi.clearAllMocks();
});

describe('workspace page authentication', () => {
  it('redirects an unverified visitor before rendering the workspace shell', async () => {
    await expect(WorkspaceLayout({ children: 'private workspace' })).rejects.toThrow('redirect:/sign-in');
    expect(connection).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith('/sign-in');
    expect(AppShell).not.toHaveBeenCalled();
  });

  it('renders the workspace only for an authenticated actor', async () => {
    fixture.actor = { id: 'reviewer', name: 'Reviewer', email: 'reviewer@example.test' };
    expect(await WorkspaceLayout({ children: 'private workspace' })).toEqual(
      expect.objectContaining({ type: AppShell, props: { children: 'private workspace' } }),
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it('keeps public auth and recovery pages outside the workspace navigation', () => {
    expect(PublicLayout({ children: 'sign in' })).toEqual(
      expect.objectContaining({ type: AppShell, props: { navigation: false, children: 'sign in' } }),
    );
  });
});
