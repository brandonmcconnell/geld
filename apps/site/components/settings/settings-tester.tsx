'use client';

import type { GeldSettings } from '@geld/core';
import { compileRepoRules, createMatcher, decideRepo } from '@geld/core';
import { EyeIcon, EyeOffIcon, PowerOffIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Input } from '@/components/ui/input';

/** Like the extension's options tester: repository rules first, then the matcher with these settings. */
export function SettingsTester({ settings }: { readonly settings: GeldSettings }) {
  const [repo, setRepo] = useState('');
  const [path, setPath] = useState('src/Button.test.tsx');
  const repoId = useId();
  const pathId = useId();
  const resultId = useId();

  const trimmedRepo = repo.trim();
  const trimmedPath = path.trim();
  const decision = trimmedRepo === '' ? null : decideRepo(compileRepoRules(settings.repoRules), trimmedRepo);
  const verdict = trimmedPath === '' || (decision !== null && !decision.allowed) ? null : createMatcher(settings, trimmedRepo === '' ? null : trimmedRepo).explain(trimmedPath);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={repoId} className="text-xs font-medium text-muted-foreground">
            Repository (optional)
          </label>
          <Input id={repoId} value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="acme/widgets" spellCheck={false} autoCapitalize="off" className="font-mono" aria-describedby={resultId} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={pathId} className="text-xs font-medium text-muted-foreground">
            Path
          </label>
          <Input id={pathId} value={path} onChange={(event) => setPath(event.target.value)} placeholder="src/Button.test.tsx" spellCheck={false} autoCapitalize="off" className="font-mono" aria-describedby={resultId} />
        </div>
      </div>
      <p id={resultId} role="status" aria-live="polite" className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        {trimmedPath === '' ? (
          <span className="text-muted-foreground">Type a path to see what happens to it.</span>
        ) : !settings.enabled ? (
          <>
            <PowerOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>Geld is turned off (General → Enabled on GitHub), so nothing is hidden anywhere.</span>
          </>
        ) : decision !== null && !decision.allowed ? (
          <>
            <PowerOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              Geld is off in <code className="code-chip">{trimmedRepo}</code> because of the rule <code className="code-chip">{decision.rule?.raw ?? ''}</code>.
            </span>
          </>
        ) : verdict === null ? null : verdict.category !== null ? (
          <>
            <EyeOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              Hidden as {verdict.category.title.toLowerCase()} — matched {verdict.source} pattern{' '}
              <code className="code-chip break-all whitespace-normal">{verdict.pattern}</code>.
            </span>
          </>
        ) : (
          <>
            <EyeIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              {verdict.rescuedBy !== null ? (
                <>
                  Visible: rescued by your custom pattern <code className="code-chip">{verdict.rescuedBy}</code>.
                </>
              ) : (
                'Visible: no enabled pattern matches this path.'
              )}
            </span>
          </>
        )}
      </p>
    </div>
  );
}
