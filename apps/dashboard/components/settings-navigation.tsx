'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CreditCard, KeyRound, Settings2, ShieldCheck, UserRound, Building2 } from 'lucide-react';

const links = [
  { href: '/settings', name: 'Overview', icon: Settings2 },
  { href: '/settings/account', name: 'Account', icon: UserRound },
  { href: '/settings/review', name: 'Review preferences', icon: Settings2 },
  { href: '/settings/providers', name: 'AI providers', icon: KeyRound },
  { href: '/settings/models', name: 'Models', icon: BookOpen },
  { href: '/settings/billing', name: 'Billing', icon: CreditCard },
  { href: '/settings/security', name: 'Security log', icon: ShieldCheck },
  { href: '/settings/enterprise', name: 'Enterprise', icon: Building2 },
];
export function SettingsNavigation({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.endsWith('/reset-password')) return children;
  return (
    <div className="settings-layout">
      <nav className="settings-navigation" aria-label="Settings navigation">
        <p>Settings</p>
        {links.map(({ href, name, icon: Icon }) => (
          <Link href={href} key={href} aria-current={pathname === href ? 'page' : undefined}>
            <Icon size={16} />
            {name}
          </Link>
        ))}
      </nav>
      <div className="settings-content">{children}</div>
    </div>
  );
}
