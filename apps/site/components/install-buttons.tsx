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
  const anyStore = links.some((link) => link.source === 'store');
  const allStores = links.every((link) => link.source === 'store');

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <InstallButtonGroup links={links} size={size} />
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
          <ExternalLink href={INSTALL_GUIDE_URL} className="underline underline-offset-3 hover:text-foreground">
            unpacked-install instructions
          </ExternalLink>
          . Current version: <span className="font-mono">{EXTENSION_VERSION}</span>.
        </p>
      ) : null}
    </div>
  );
}
