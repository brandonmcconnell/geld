import { CATEGORIES } from '@geld/core';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageIntro, Prose } from '@/components/section';
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
            <a href={CORE_SOURCE_URL} className="underline underline-offset-3 hover:text-foreground" rel="noopener">
              <code className="font-mono text-[0.9em]">@geld/core</code>
            </a>
            , the same package the extension ships, so it cannot drift from what actually runs.
          </>
        }
      />

      <div className="container-site pb-24">
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
            A path belongs to the first category that matches, in the order below. Custom patterns are checked last and count as tests. You can try
            any path on the <Link href="/#try">home page</Link>.
          </p>
        </Prose>

        <nav aria-label="Categories" className="mb-12 flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <a key={category.id} href={`#${category.id}`} className="rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
              {category.title}
            </a>
          ))}
        </nav>

        <div className="flex flex-col gap-16">
          {CATEGORIES.map((category, index) => (
            <section key={category.id} id={category.id} aria-labelledby={`${category.id}-heading`} className="scroll-mt-24">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                <h2 id={`${category.id}-heading`} className="text-2xl font-semibold tracking-tight">
                  {category.title}
                </h2>
                <span className="rounded-full border px-2 py-px text-xs text-muted-foreground">{category.defaultEnabled ? 'on by default' : 'opt-in'}</span>
              </div>
              <p className="mt-2 max-w-2xl text-muted-foreground">{category.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Label: <span className="font-mono">{category.shortNounPlural}</span> · Section: <span className="font-mono">{category.nounPlural}</span>
              </p>

              <div className="mt-6 flex flex-col gap-6">
                {category.groups.map((group) => (
                  <div key={group.id} className="grid gap-3 rounded-xl border p-5 md:grid-cols-[220px_1fr] md:gap-8">
                    <div>
                      <h3 className="text-sm font-semibold">{group.label}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
                      <p className="mt-2 font-mono text-xs text-muted-foreground">
                        {group.patterns.length} {group.patterns.length === 1 ? 'pattern' : 'patterns'}
                        {category.id === 'tests' ? ' · toggle individually' : ''}
                      </p>
                    </div>
                    <ul className="flex flex-wrap gap-1.5" aria-label={`${group.label} patterns`}>
                      {group.patterns.map((pattern) => (
                        <li key={pattern}>
                          <code className="code-chip inline-block max-w-full break-all whitespace-normal">{pattern}</code>
                        </li>
                      ))}
                    </ul>
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
            <a href={`${REPO_URL}/issues`} rel="noopener">
              open an issue
            </a>
            .
          </p>
        </Prose>
      </div>
    </>
  );
}
