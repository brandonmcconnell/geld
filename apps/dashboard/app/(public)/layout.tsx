import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
  return <AppShell navigation={false}>{children}</AppShell>;
}
