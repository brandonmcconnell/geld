import { allHosts, DEFAULT_SETTINGS } from '@geld/core';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Kbd } from '@/components/kbd';
import { PageIntro, Prose } from '@/components/section';
import { ISSUES_URL, KEYBOARD_SHORTCUT, REPO_SLUG, REPO_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Answers about how Geld reads diffs without the GitHub API, what it collects (nothing), optional settings sync, why *.spec.* is limited to code, and how to turn it off per repository or add Enterprise hosts.',
  alternates: { canonical: '/faq' },
};

interface Question {
  readonly id: string;
  readonly question: string;
  readonly answer: React.ReactNode;
}

const QUESTIONS: readonly Question[] = [
  {
    id: 'api',
    question: 'Does Geld use the GitHub API?',
    answer: (
      <>
        <p>
          Not for anything it shows you. When a page renders per-file diffs, the counts are read straight from the page. When it does not (the pull
          request conversation tab, pull request lists, large pull requests that GitHub loads progressively), the background script fetches the same{' '}
          <code>.diff</code> file you get by appending <code>.diff</code> to a pull request URL. That is a normal page request to GitHub, not an API
          call, so there is no token and no API quota involved.
        </p>
        <p>
          Parsed diffs are cached in extension storage keyed by the pull request&apos;s head commit, so a pull request you have already looked at costs
          no request until it gets a new commit. List rows are fetched only when scrolled near the viewport, at most four at a time, and fetching
          pauses for a minute if GitHub ever answers <code>429</code>.
        </p>
        <p>
          The one exception is the optional <em>Sign in with GitHub</em> for settings sync (see below), which talks to GitHub&apos;s Gist API on your
          behalf, and only once you have signed in.
        </p>
      </>
    ),
  },
  {
    id: 'data',
    question: 'What does Geld collect or send?',
    answer: (
      <p>
        Nothing. There is no analytics, no error reporting and no server of ours. The only network requests Geld makes are to GitHub (
        {allHosts(DEFAULT_SETTINGS).join(', ')} plus any Enterprise hosts you add): to fetch diffs GitHub would serve you anyway and, if you opt into
        sign-in, to read and write a secret gist on your own account. Settings live in your browser&apos;s sync storage. See the{' '}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    ),
  },
  {
    id: 'deleted',
    question: 'Are the test files removed from the page?',
    answer: (
      <p>
        No. Geld never deletes or moves GitHub&apos;s DOM nodes, which would break the React-based view. Hidden entries are given a higher flex order
        and a data attribute that hides them; a <em>Show test files</em> row at the bottom (and a panel in the file tree) brings them back in place.
        Header numbers are rewritten while the originals are remembered, so switching Geld off restores the page exactly.
      </p>
    ),
  },
  {
    id: 'spec',
    question: 'Why does *.spec.* only match code extensions?',
    answer: (
      <p>
        Because OpenAPI and AsyncAPI documents are commonly named <code>api.spec.yaml</code>, and silently hiding a schema change would be far worse
        than showing a test. <code>*.spec.*</code>, <code>*_spec.*</code> and their relatives are therefore restricted to source-code extensions
        (JavaScript, TypeScript, Python, Go, Rust, Java, …). <code>*.test.*</code> stays open because the only non-test files it catches are
        configuration for a &ldquo;test&rdquo; environment. The full list is on the <Link href="/patterns">patterns page</Link>.
      </p>
    ),
  },
  {
    id: 'off',
    question: 'How do I turn Geld off for one repository or organisation?',
    answer: (
      <>
        <p>
          Open the toolbar popup on any page of that repository and use <em>Turn off for this repo</em> or <em>Turn off for this org</em>. Those
          actions append a repository rule for you. You can also edit the rules directly in the options; they read like a <code>.gitignore</code>:
        </p>
        <pre>
          <code>{`acme/widgets    # off in this repository
acme            # off in the whole organisation
!acme/widgets   # …except here (last match wins)`}</code>
        </pre>
        <p>
          To hide the tests on a single page for the rest of your visit without changing anything, press <Kbd keys={KEYBOARD_SHORTCUT} />.
        </p>
      </>
    ),
  },
  {
    id: 'ghes',
    question: 'How do I use Geld with GitHub Enterprise Server?',
    answer: (
      <p>
        Open the options page and add your server&apos;s hostname (for example <code>github.example.com</code>) under <em>Enterprise hosts</em>. Your
        browser will ask you to allow Geld on that host; once granted, the content script is registered there. Geld never contacts any host you have
        not listed. GHES runs GitHub&apos;s interface a few versions behind github.com, so if something looks off please{' '}
        <a href={ISSUES_URL} rel="noopener">
          open an issue
        </a>{' '}
        with a screenshot.
      </p>
    ),
  },
  {
    id: 'categories',
    question: 'Can it hide more than tests?',
    answer: (
      <p>
        Yes. Generated files (lockfiles, build output), vendored code, AI agent configuration, docs, tooling &amp; CI and fixtures are each a switch in
        the popup or options, off by default. Custom patterns let you add your own conventions, optionally scoped to a repository with{' '}
        <code>[owner/repo]</code> headers.
      </p>
    ),
  },
  {
    id: 'whitespace',
    question: 'Does “hide whitespace” re-implement GitHub’s diff?',
    answer: (
      <p>
        No. It flips GitHub&apos;s own <em>Hide whitespace changes</em> setting the way you would, and only if it is not already on. GitHub remembers
        the preference for signed-in users, so this happens once; signed-out users get the <code>?w=1</code> URL.
      </p>
    ),
  },
  {
    id: 'sync',
    question: 'Do my settings follow me between devices?',
    answer: (
      <>
        <p>
          Within one browser, yes: settings are stored in <code>browser.storage.sync</code>, so they follow your browser profile wherever it syncs, and
          apply instantly to open tabs. You can also export and import them as JSON from the options page.
        </p>
        <p>
          Across browsers, optionally: <em>Sign in with GitHub</em> (top right of the popup or options) uses GitHub&apos;s OAuth device flow, so you
          confirm a short code on github.com and no secret is involved. The only scope is <code>gist</code>. Your settings are kept in a secret gist on
          your own account (<code>geld-settings.json</code>); there is no Geld server or database, and the token stays on the device that signed in.
          Changes push within a couple of seconds and pull when the popup or options open or the browser starts.
        </p>
      </>
    ),
  },
  {
    id: 'source',
    question: 'Is it open source?',
    answer: (
      <p>
        Yes, MIT licensed at{' '}
        <a href={REPO_URL} rel="noopener">
          github.com/{REPO_SLUG}
        </a>
        . The extension is built with WXT from one codebase for Chrome, Edge, Firefox and Safari, and this website is in the same repository.
      </p>
    ),
  },
];

export default function FaqPage() {
  return (
    <>
      <PageIntro eyebrow="FAQ" title="Questions, answered." description="Short answers about how Geld works and what it does not do." />
      <div className="container-site grid gap-12 pb-24 lg:grid-cols-[260px_1fr] lg:gap-16">
        <nav aria-label="Questions" className="hidden lg:block">
          <ul className="sticky top-20 flex flex-col gap-1.5 border-l text-sm">
            {QUESTIONS.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`} className="-ml-px block border-l border-transparent py-0.5 pl-4 text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
                  {entry.question}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col divide-y">
          {QUESTIONS.map((entry) => (
            <section key={entry.id} id={entry.id} aria-labelledby={`${entry.id}-heading`} className="scroll-mt-24 py-8 first:pt-0">
              <h2 id={`${entry.id}-heading`} className="text-xl font-semibold tracking-tight text-balance">
                {entry.question}
              </h2>
              <Prose className="mt-2">{entry.answer}</Prose>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
