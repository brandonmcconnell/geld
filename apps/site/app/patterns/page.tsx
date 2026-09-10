import { CATEGORIES } from '@geld/core';
import { cn } from 'cn';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ExternalLink } from '@/components/external-link';
import { PageIntro, Prose } from '@/components/section';
import { RichText } from '@/components/settings/rich-text';
import { SubBar } from '@/components/sub-bar';
import { REPO_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Patterns',
  description: 'Every built-in pattern Geld uses to classify files as tests, generated, vendored, agent config, docs, tooling or fixtures — rendered from the extension source.',
  alternates: { canonical: '/patterns' },
};

const CORE_SOURCE_URL = `${REPO_URL}/blob/main/packages/core/src`;

export default function PatternsPage() {
  const total = CATEGORIES.reduce((sum, category) => sum + category.groups.reduce((groupSum, group) => groupSum + group.patterns.length, 0), 0);
  return (
    <>
      <PageIntro
        eyebrow="Patterns"
        title="What gets hidden."
        description={
          <>
            {CATEGORIES.length} categories, {total} built-in patterns. This page is generated from{' '}
            <ExternalLink href={CORE_SOURCE_URL} className="underline underline-offset-3 hover:text-foreground">
              <code className="font-mono text-[0.9em]">@geld/core</code>
            </ExternalLink>
            , the same package the extension ships, so it cannot drift from what actually runs.
          </>
        }
      />

      <div className="container-site">
        <Prose className="mb-12">
          <h2 id="semantics">Semantics</h2>
          <p>
            Patterns are matched against repository-relative paths with gitignore semantics. A pattern without a slash matches a filename at any depth
            (<code>*.snap</code> is <code>**/*.snap</code>). A trailing slash matches a directory at any depth and everything inside it (
            <code>tests/</code> is <code>**/tests/**</code>). A pattern containing a slash is matched against the whole path from the repository root.{' '}
            <code>**</code> spans directories, <code>{'{a,b}'}</code> expands alternatives, <code>?</code> matches one character and{' '}
            <code>!pattern</code> rescues a path. Only paths are inspected, never contents.
          </p>
          <p>
            A path belongs to the first category that matches, in the order below; categories you define yourself are checked first, and your extra patterns for a built-in category are attributed to it. You can try
            any path on the <Link href="/#try">home page</Link>.
          </p>
        </Prose>
      </div>

      {/* Full-bleed bar that sticks under the top bar (h-14) so the category jumps stay reachable while reading. */}
      <SubBar aria-label="Categories" className="py-3">
        <ul className="container-site flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((category) => (
            <li key={category.id} className="shrink-0">
              <a
                href={`#${category.id}`}
                className="geld-corners geld-cut-[7px] inline-block border bg-background/60 px-3 py-1 text-sm whitespace-nowrap text-foreground/80 hover:border-foreground hover:bg-background hover:text-foreground"
              >
                {category.title}
              </a>
            </li>
          ))}
        </ul>
      </SubBar>

      <div className="container-site pt-12 pb-24">
        <div className="flex flex-col gap-20">
          {CATEGORIES.map((category, index) => (
            <section key={category.id} id={category.id} aria-labelledby={`${category.id}-heading`} className="scroll-mt-36">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-base tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                <h2 id={`${category.id}-heading`} className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {category.title}
                </h2>
                <span className="border px-2.5 py-0.5 text-xs leading-5 text-muted-foreground">{category.defaultEnabled ? 'on by default' : 'opt-in'}</span>
              </div>
              <p className="mt-2 max-w-2xl text-pretty text-muted-foreground">
                <RichText copy={category.description} />
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Label: <span className="font-mono">{category.shortNounPlural}</span> · Section: <span className="font-mono">{category.nounPlural}</span>
              </p>

              <div className="mt-6 flex flex-col gap-6">
                {category.groups.map((group) => (
                  // Groups decided from the diff have no pattern column, so their text runs the full width instead of wrapping in a narrow one.
                  <div key={group.id} className={cn('grid gap-3 border p-5', group.patterns.length > 0 && 'md:grid-cols-[240px_1fr] md:gap-8')}>
                    <div className={cn(group.patterns.length === 0 && 'max-w-2xl')}>
                      <h3 className="text-base font-semibold">{group.label}</h3>
                      <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{group.description}</p>
                      <p className="mt-2 font-mono text-sm text-muted-foreground">
                        {group.patterns.length === 0 ? 'decided from the diff, no patterns' : `${group.patterns.length} ${group.patterns.length === 1 ? 'pattern' : 'patterns'}`}
                        {category.id === 'tests' ? ' · toggle individually' : ''}
                      </p>
                    </div>
                    {group.patterns.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5" aria-label={`${group.label} patterns`}>
                        {group.patterns.map((pattern) => (
                          <li key={pattern}>
                            <code className="code-chip inline-block max-w-full break-all whitespace-normal">{pattern}</code>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <Prose className="mt-16">
          <h2 id="spec">Why <code>*.spec.*</code> is limited to code extensions</h2>
          <p>
            OpenAPI and AsyncAPI documents are commonly named <code>api.spec.yaml</code>, and hiding a schema change would be worse than showing a test.
            So <code>*.spec.*</code>, <code>*_spec.*</code> and friends are only applied to source-code extensions, which is why they appear above as
            long brace expansions. <code>*.test.*</code> is left open: the only non-test files it catches are configuration for a &ldquo;test&rdquo;
            environment (<code>appsettings.test.json</code>), which is test-related anyway.
          </p>
          <p>
            Missing a convention? Add it as a custom pattern in the options, or{' '}
            <ExternalLink href={`${REPO_URL}/issues`}>open an issue</ExternalLink>
            .
          </p>
        </Prose>
      </div>
    </>
  );
}
