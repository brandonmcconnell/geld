import type { ReactNode } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { currentActor } from '@/lib/session';

export default async function WorkspaceLayout({ children }: { readonly children: ReactNode }) {
  await connection();
  if (!(await currentActor())) redirect('/sign-in');
  return <AppShell>{children}</AppShell>;
}
