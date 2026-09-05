'use client';

import Link from 'next/link';

import { useAccount } from '@/lib/account';

const linkClass = 'text-sm text-muted-foreground transition-colors hover:text-foreground';

/** Footer counterpart of the header menu: Settings plus sign in / sign out. */
export function FooterAccount() {
  const account = useAccount();
  return (
    <>
      <li>
        <Link href="/settings" className={linkClass}>
          Settings
        </Link>
      </li>
      <li>
        {account === null || account === undefined ? (
          <a href="/auth/start?next=/settings" className={`${linkClass} [[data-account]_&]:hidden`}>
            Sign in
          </a>
        ) : (
          <form method="post" action="/auth/signout" className="inline">
            <button type="submit" className={`${linkClass} cursor-pointer`}>
              Sign out <span className="text-xs">({account.login})</span>
            </button>
          </form>
        )}
      </li>
    </>
  );
}
