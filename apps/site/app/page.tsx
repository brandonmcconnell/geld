import { CATEGORIES } from '@geld/core';
import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';

import { BeforeAfter } from '@/components/demo/before-after';
import { InstallButtons } from '@/components/install-buttons';
import { Wordmark } from '@/components/logo';
import { PathTester } from '@/components/path-tester';
import { Section } from '@/components/section';
import { buttonVariants } from '@/components/ui/button';
import { REPO_URL, TAGLINE } from '@/lib/site';

export default function HomePage() {
  const optIn = CATEGORIES.filter((category) => !category.defaultEnabled);
  return (
    <>
      <section aria-labelledby="hero-heading" className="container-site pt-20 pb-12 sm:pt-28 sm:pb-16">
        <div className="max-w-3xl">
          <Wordmark height={44} alt="Geld" priority className="mb-8 sm:mb-10" />
          <h1 id="hero-heading" className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            {TAGLINE}.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground text-pretty sm:text-xl">
            Geld is a browser extension that hides test files from GitHub diffs. Tests move to a collapsible row at the bottom, the header counts
            exclude them, and nothing is ever deleted from the page.
          </p>
          <InstallButtons className="mt-8" compact />
          <p className="mt-6 text-sm text-muted-foreground">Free and open source. No account, no data collection, no GitHub API calls.</p>
        </div>
      </section>

      <section aria-label="Before and after" className="container-site pb-16 sm:pb-24">
        <BeforeAfter />
      </section>

      <Section
        id="why"
        eyebrow="Why"
        title="A pull request is easier to judge without its scaffolding."
        description="Tests matter, but they rarely need to be read first. Geld gets them out of the way and keeps the numbers honest."
      >
        <ul className="grid gap-x-10 gap-y-10 sm:grid-cols-3">
          <Feature title="Counts you can trust">
            <code className="code-chip">+93 −53</code> becomes <code className="code-chip">6 tests +42 −26</code>. Hover the label for the full
            breakdown: excluding tests, including tests, tests only.
          </Feature>
          <Feature title="Nothing disappears">
            Hidden files collapse into one row at the bottom of the diff and their own panel in the file tree. One click brings them back, in place.
          </Feature>
          <Feature title="Your rules">
            Tests are hidden by default. {optIn.map((category) => category.title).join(', ')} are one switch away, plus custom patterns and
            per-repository rules.
          </Feature>
        </ul>
        <Link href="/how-it-works" className={buttonVariants({ variant: 'outline', className: 'mt-10' })}>
          How it works
          <ArrowRightIcon aria-hidden="true" />
        </Link>
      </Section>

      <Section
        id="try"
        eyebrow="Try it"
        title="Try a path"
        description={
          <>
            This runs the extension&apos;s own matcher in your browser, with the default settings. Patterns use gitignore semantics; see the{' '}
            <Link href="/patterns" className="underline underline-offset-3 hover:text-foreground">
              full list
            </Link>
            .
          </>
        }
        className="border-t"
      >
        <PathTester className="max-w-2xl" />
      </Section>

      <Section id="install" eyebrow="Install" title="Works where you review." description="Chrome, Edge, Firefox and Safari, on github.com and GitHub Enterprise Server." className="border-t">
        <InstallButtons compact />
        <p className="mt-6 text-sm text-muted-foreground">
          MIT licensed.{' '}
          <a href={REPO_URL} className="underline underline-offset-3 hover:text-foreground" rel="noopener">
            Read the source
          </a>{' '}
          or build it yourself.
        </p>
      </Section>
    </>
  );
}

function Feature({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm leading-6 text-muted-foreground">{children}</p>
    </li>
  );
}
