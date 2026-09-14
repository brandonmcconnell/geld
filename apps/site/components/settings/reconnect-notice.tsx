import { RECONNECT_COPY } from '@geld/github';

import { GitHubIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';

/**
 * Shown above the form to people whose session still comes from the retired
 * OAuth App: the same copy as the extension's notice, and just as
 * undismissable. Signing in again through the App replaces the token; the
 * callback also revokes the old one.
 */
export function ReconnectNotice({ next }: { readonly next: string }) {
  return (
    <div role="status" className="mb-8 max-w-2xl border border-foreground bg-muted/40 p-5 sm:p-6">
      <p className="font-mono text-xs font-medium tracking-[0.12em] uppercase">{RECONNECT_COPY.title}</p>
      <p className="mt-2 text-sm">{RECONNECT_COPY.body}</p>
      <div className="mt-5">
        <a href={`/auth/start?next=${encodeURIComponent(next)}`} className={buttonVariants({ size: 'sm' })}>
          <GitHubIcon />
          {RECONNECT_COPY.action}
        </a>
      </div>
    </div>
  );
}
