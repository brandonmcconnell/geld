'use client';

import type { SettingsIssue } from '@geld/core';
import { CORRUPTED_SETTINGS_COPY } from '@geld/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { resetRemoteSettings } from '@/app/settings/actions';
import { ExternalLink } from '@/components/external-link';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * Shown instead of the form when the gist fails strict validation: the same
 * copy and actions as the extension's alert. Nothing can be saved until the
 * file is fixed on GitHub or reset to defaults.
 */
export function CorruptedSettings({ gistId, htmlUrl, issues }: { readonly gistId: string; readonly htmlUrl: string; readonly issues: readonly SettingsIssue[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    if (!confirm('Replace the settings in your gist with the defaults? This cannot be undone, but the gist keeps its revision history on GitHub.')) return;
    startTransition(async () => {
      const result = await resetRemoteSettings(gistId);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  return (
    <div role="alert" className="max-w-2xl border border-destructive/55 bg-muted/40 p-5 sm:p-6">
      <p className="font-mono text-xs font-medium tracking-[0.12em] text-destructive uppercase">{CORRUPTED_SETTINGS_COPY.title}</p>
      <p className="mt-2 text-sm">{CORRUPTED_SETTINGS_COPY.body}</p>
      {issues.length > 0 ? (
        <ul className="mt-4 grid list-disc gap-2 pl-5 text-sm text-muted-foreground marker:text-muted-foreground">
          {issues.map((issue, index) => (
            <li key={`${issue.path}-${index}`} className="leading-6">
              {/* `$` means the whole file; a chip saying so would only puzzle people. */}
              {issue.path !== '$' ? (
                <>
                  <code className="code-chip break-all whitespace-normal text-foreground">{issue.path}</code>{' '}
                </>
              ) : null}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ExternalLink href={htmlUrl} className={buttonVariants({ size: 'sm' })}>
          {CORRUPTED_SETTINGS_COPY.openGist}
        </ExternalLink>
        <Button type="button" variant="outline" size="sm" onClick={reset} disabled={pending}>
          {CORRUPTED_SETTINGS_COPY.reset}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => router.refresh()} disabled={pending}>
          {CORRUPTED_SETTINGS_COPY.recheck}
        </Button>
        {error !== null ? (
          <span role="status" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
