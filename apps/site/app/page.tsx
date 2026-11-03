import { REVIEW_BOTS } from '@geld/review/bots';
import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';

import { ExternalLink } from '@/components/external-link';
import { HERO_WORDMARK_ID } from '@/components/header-brand';
import { InstallButtons } from '@/components/install-buttons';
import { LogoReel } from '@/components/logo-reel';
import { Wordmark } from '@/components/logo';
import { PathTester } from '@/components/path-tester';
import { Section } from '@/components/section';
import { buttonVariants } from '@/components/ui/button';
import { HEADLINE, REPO_URL } from '@/lib/site';

const NAMED_BOTS = ['Bugbot', 'CodeRabbit', 'Greptile', 'Copilot'];

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
          <h1 id="hero-heading" className="text-[min(9.6cqi,4.5rem)] leading-[1.04] font-semibold tracking-tight whitespace-nowrap">
            <span className="block">{firstLine}</span> <span className="block">{secondLine}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground text-pretty sm:text-xl">
            Review agents write the first pass now, yet reading a pull request still means scrolling a long timeline of comments and walking{' '}
            <em>Files changed</em> one file at a time. Geld turns that into one digest of what needs you, a diff that starts with the code, and review
            controls on every tab.
          </p>
          <InstallButtons className="mt-8" size="lg" />
        </div>
      </section>

      <LogoReel className="pb-16 sm:pb-24" />

      <Section
        id="why"
        eyebrow="What changes"
        title="Less to scroll, nothing lost."
        description="Geld works inside GitHub's own pages. Replies, resolves, reactions and merges still go through GitHub, and anything Geld folds away is one click from coming back."
        className="border-t"
      >
        <ul className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          <Feature title="A digest, not a timeline">
            Under the description, one panel lays the pull request out by round: what each push brought in, with its threads, reviews and bot comments,
            open threads first. A thread opens as a chat right where you are.
          </Feature>
          <Feature title="Every review bot in one row">
            {NAMED_BOTS.join(', ')} and {REVIEW_BOTS.length - NAMED_BOTS.length} more each get a verdict: clean, findings, running or skipped. Ask one or
            all of them for another review from the same row.
          </Feature>
          <Feature title="Checks, previews and reports">
            CI, preview deployments, coverage and security reports each get a row, red only when something failed. Who approved, and who is still
            awaited, sits right beside them.
          </Feature>
          <Feature title="A diff that starts with the code">
            Tests move behind one row at the bottom, and generated files, lockfiles and docs can join them. The header counts leave them out:{' '}
            <code className="code-chip">+93 −53</code> becomes <code className="code-chip">6 tests +42 −26</code>.
          </Feature>
          <Feature title="Tests read as titles">
            Open a test file and every test is one line with its name and its own <code className="code-chip">+N −M</code>. Expand only the ones you
            care about.
          </Feature>
          <Feature title="Review from any tab">
            Approve, request changes or comment from any tab, pending comments included. The status pill beside the title merges, queues, drafts or
            closes the pull request.
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

function Feature({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm leading-6 text-muted-foreground">{children}</p>
    </li>
  );
}
