import type { ReactNode } from 'react';
import { SettingsNavigation } from '@/components/settings-navigation';
export default function SettingsLayout({ children }: { readonly children: ReactNode }) {
  return <SettingsNavigation>{children}</SettingsNavigation>;
}
