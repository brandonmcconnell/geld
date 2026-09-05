import { cn } from 'cn';
import { DownloadIcon, ExternalLinkIcon } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { installLinks } from '@/lib/downloads';
import { getLatestRelease } from '@/lib/release';
import { INSTALL_GUIDE_URL } from '@/lib/site';
import { EXTENSION_VERSION } from '@/lib/version';

/**
 * One button per browser. Points at store listings where they exist and at
 * the latest GitHub Release otherwise (see `lib/downloads.ts`).
 */
export async function InstallButtons({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const release = await getLatestRelease();
  const links = installLinks(release);
  const anyStore = links.some((link) => link.source === 'store');
  const allStores = links.every((link) => link.source === 'store');

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ul className="flex flex-wrap gap-2" aria-label="Install Geld">
        {links.map((link, index) => (
          <li key={link.browser.id}>
            <a
              href={link.href}
              className={buttonVariants({ variant: index === 0 ? 'default' : 'outline', size: compact ? 'default' : 'lg' })}
              rel="noopener"
              data-source={link.source}
            >
              {link.source === 'store' ? <ExternalLinkIcon aria-hidden="true" /> : <DownloadIcon aria-hidden="true" />}
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      {!allStores ? (
        <p className="text-xs text-muted-foreground">
          {anyStore ? 'Browsers without a store listing yet install from the ' : 'Store listings are coming. Until then, install from the '}
          {release.tag !== null ? (
            <>
              latest release (<span className="font-mono">{release.tag}</span>)
            </>
          ) : (
            'GitHub releases'
          )}
          {' — '}
          <a href={INSTALL_GUIDE_URL} className="underline underline-offset-3 hover:text-foreground" rel="noopener">
            unpacked-install instructions
          </a>
          . Current version: <span className="font-mono">{EXTENSION_VERSION}</span>.
        </p>
      ) : null}
    </div>
  );
}
