import { TESTS_CATEGORY } from '@geld/core';
import { cn } from 'cn';

import { FileRow } from '@/components/demo/file-row';
import { HiddenRow } from '@/components/demo/hidden-row';
import { PrHeader } from '@/components/demo/pr-header';
import { ALL_TOTALS, HIDDEN_FILES, HIDDEN_TOTALS, SAMPLE_FILES, VISIBLE_FILES, VISIBLE_TOTALS } from '@/components/demo/sample-pr';

/** Side-by-side: the same pull request as GitHub shows it, and as Geld shows it. */
export function BeforeAfter() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <figure className="flex flex-col gap-3">
        <figcaption className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-muted-foreground/60" aria-hidden="true" />
          Without Geld
        </figcaption>
        <Frame>
          <PrHeader shown={ALL_TOTALS} />
          <ul aria-label="Changed files">
            {SAMPLE_FILES.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
        </Frame>
      </figure>
      <figure className="flex flex-col gap-3">
        <figcaption className="flex items-center gap-2 text-sm text-foreground">
          <span className="inline-block size-1.5 rounded-full bg-addition" aria-hidden="true" />
          With Geld
        </figcaption>
        <Frame>
          <PrHeader
            shown={VISIBLE_TOTALS}
            geld={{ hidden: HIDDEN_TOTALS, all: ALL_TOTALS, noun: TESTS_CATEGORY.shortNoun, nounPlural: TESTS_CATEGORY.shortNounPlural }}
          />
          <ul aria-label="Changed files, tests hidden">
            {VISIBLE_FILES.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
          <HiddenRow files={HIDDEN_FILES} noun={TESTS_CATEGORY.noun} nounPlural={TESTS_CATEGORY.nounPlural} />
        </Frame>
      </figure>
    </div>
  );
}

export function Frame({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
  return <div className={cn('overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs', className)}>{children}</div>;
}
