import { cn } from 'cn';

import { ExternalLink } from '@/components/external-link';
import { InstallButtonGroup } from '@/components/install-button-group';
import { installLinks } from '@/lib/downloads';
import { getLatestRelease } from '@/lib/release';
import { INSTALL_GUIDE_URL } from '@/lib/site';
import { EXTENSION_VERSION } from '@/lib/version';

/**
 * Install buttons for all four browsers. Points at store listings where they
 * exist and at the latest GitHub Release otherwise (see `lib/downloads.ts`).
 */
export async function InstallButtons({ className, size = 'default' }: { readonly className?: string | undefined; readonly size?: 'default' | 'lg' }) {
  const release = await getLatestRelease();
  const links = installLinks(release);
  // Browsers still waiting for a store listing install from GitHub Releases.
  const pending = links.filter((link) => link.source !== 'store').map((link) => link.browser.name);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <InstallButtonGroup links={links} size={size} />
      {pending.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {pending.length === links.length ? 'Store listings coming soon; for now ' : `${listNames(pending)}: for now `}
          <ExternalLink href={INSTALL_GUIDE_URL} className="underline underline-offset-3 hover:text-foreground">
            install from GitHub
          </ExternalLink>
          {' · '}
          <span className="font-mono">v{EXTENSION_VERSION}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Free and open source · <span className="font-mono">v{EXTENSION_VERSION}</span>
        </p>
      )}
    </div>
  );
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}
