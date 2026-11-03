import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';

import { ExternalLink } from '@/components/external-link';
import { HERO_WORDMARK_ID } from '@/components/header-brand';
import { InstallButtons } from '@/components/install-buttons';
import { LogoReel } from '@/components/logo-reel';
import { Wordmark } from '@/components/logo';
import { PathTester } from '@/components/path-tester';
import { Section } from '@/components/section';
import { Tour } from '@/components/tour/tour';
import { buttonVariants } from '@/components/ui/button';
import { HEADLINE, REPO_URL } from '@/lib/site';

export default function HomePage() {
  const [firstLine, secondLine] = HEADLINE;
  return (
    <>
      <section aria-labelledby="hero-heading" className="container-site pt-20 pb-14 sm:pt-28 sm:pb-20">
        <div className="max-w-3xl @container">
          <div id={HERO_WORDMARK_ID} className="mb-8 w-fit sm:mb-10">
            <Wordmark height={44} alt="Geld" priority />
          </div>
          {/* Sized to the column, not the viewport, so each line fills it at most and never wraps. */}
          <h1 id="hero-heading" className="text-[min(9.4cqi,4.5rem)] leading-[1.04] font-semibold tracking-tight whitespace-nowrap">
            <span className="block">{firstLine}</span> <span className="block">{secondLine}</span>
          </h1>
          <p className="mt-6 text-xl tracking-tight text-muted-foreground text-balance sm:text-2xl">Less noise. More shipping.</p>
          <InstallButtons className="mt-8" size="lg" />
        </div>
      </section>

      <LogoReel className="pb-16 sm:pb-24" />

      <section id="tour" aria-labelledby="tour-heading" className="pb-16 sm:pb-20">
        <div className="container-site border-t pt-16 sm:pt-20">
          <div className="max-w-2xl">
            <p className="mb-4 font-mono text-[0.9375rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">What it does</p>
            <h2 id="tour-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything a review needs, on the page you already have open.
            </h2>
            <p className="mt-3 text-base text-muted-foreground text-balance">
              Geld works inside GitHub&apos;s own pages, so replies, resolves, reactions and merges still go through GitHub. Every window below is live,
              so try them as you scroll.
            </p>
          </div>
        </div>
        {/* Wider than the page's column: the scenes need a GitHub-sized window beside their words. */}
        <div className="mx-auto mt-12 w-full max-w-7xl px-5 sm:px-8 stage:mt-24">
          <Tour />
        </div>
        <div className="container-site mt-20 flex flex-col items-center text-center stage:mt-12">
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">Plus the parts you set once</h3>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground text-balance">
            Categories of your own, rules per repository or organisation, a <code className="code-chip">.github/geld.yml</code> everyone who reviews
            shares, and GitHub Enterprise Server.
          </p>
          <p className="mt-2 max-w-2xl text-base text-muted-foreground text-balance">How it works covers every change Geld makes, and what it leaves alone.</p>
          <Link href="/how-it-works" className={buttonVariants({ variant: 'outline', className: 'mt-6' })}>
            Everything Geld changes
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
      </section>

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
        <InstallButtons />
        <p className="mt-6 text-sm text-muted-foreground">
          AGPL-3.0 licensed.{' '}
          <ExternalLink href={REPO_URL} className="underline underline-offset-3 hover:text-foreground">
            Read the source
          </ExternalLink>{' '}
          or build it yourself.
        </p>
      </Section>
    </>
  );
}
