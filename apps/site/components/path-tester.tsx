'use client';

import type { CategoryId, GeldSettings, PathMatcher } from '@geld/core';
import { CATEGORIES, createMatcher, DEFAULT_SETTINGS } from '@geld/core';
import { cn } from 'cn';
import { CheckIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';

const EXAMPLES: readonly string[] = ['src/Button.test.tsx', 'e2e/login.cy.ts', 'api.spec.yaml', 'pnpm-lock.yaml', 'docs/guide.md', 'src/Button.tsx'];

/** Settings with every category switched on, for exploring the opt-in ones. */
const ALL_CATEGORIES: GeldSettings = {
  ...DEFAULT_SETTINGS,
  categories: CATEGORIES.reduce<Partial<Record<CategoryId, boolean>>>((enabled, category) => ({ ...enabled, [category.id]: true }), {}),
};

type Verdict = ReturnType<PathMatcher['explain']>;

/**
 * Classifies a path in the browser with the same `createMatcher` the
 * extension uses, and says which pattern decided.
 */
export function PathTester({ className }: { readonly className?: string }) {
  const [path, setPath] = useState(EXAMPLES[0] ?? '');
  const [everything, setEverything] = useState(false);
  const inputId = useId();
  const resultId = useId();

  const matcher = useMemo(() => createMatcher(everything ? ALL_CATEGORIES : DEFAULT_SETTINGS), [everything]);
  const trimmed = path.trim();
  const verdict: Verdict | null = trimmed === '' ? null : matcher.explain(trimmed);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={inputId} className="sr-only">
          File path to classify
        </label>
        <Input
          id={inputId}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="src/components/Button.test.tsx"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className="font-mono"
          aria-describedby={resultId}
        />
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
          <input type="checkbox" checked={everything} onChange={(event) => setEverything(event.target.checked)} className="peer sr-only" />
          <span
            aria-hidden="true"
            className="flex size-4 items-center justify-center rounded-[4px] border bg-background text-background peer-checked:border-foreground peer-checked:bg-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/40"
          >
            <CheckIcon className={cn('size-3', !everything && 'opacity-0')} />
          </span>
          Every category on
        </label>
      </div>

      <div id={resultId} role="status" aria-live="polite" className="rounded-lg border bg-muted/40 p-4 text-sm">
        {verdict === null ? (
          <p className="text-muted-foreground">Type a path to see how Geld treats it.</p>
        ) : verdict.category !== null ? (
          <div className="flex flex-col gap-2">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <EyeOffIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="font-medium">Hidden</span>
              <span className="text-muted-foreground">·</span>
              <span>{verdict.category.title}</span>
              {!verdict.category.defaultEnabled ? <span className="text-xs text-muted-foreground">(opt-in category)</span> : null}
            </p>
            <p className="text-muted-foreground">
              Matched by <code className="code-chip break-all whitespace-normal">{verdict.pattern}</code>
              {verdict.source === 'custom' ? ' from your custom patterns.' : '.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2">
              <EyeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="font-medium">Visible</span>
            </p>
            <p className="text-muted-foreground">
              {verdict.rescuedBy !== null ? (
                <>
                  Rescued by <code className="code-chip">{verdict.rescuedBy}</code>.
                </>
              ) : (
                'No pattern matches, so this file stays where GitHub put it.'
              )}
            </p>
          </div>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="Example paths">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => setPath(example)}
              aria-pressed={example === path}
              className={cn(
                'code-chip cursor-pointer transition-colors hover:border-ring hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-pressed:border-foreground',
                example === path ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
