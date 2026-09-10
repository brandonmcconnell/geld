import { CATEGORIES, TESTS_CATEGORY } from '@geld/core';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Frame } from '@/components/demo/before-after';
import { FileRow } from '@/components/demo/file-row';
import { HiddenRow } from '@/components/demo/hidden-row';
import { PrHeader } from '@/components/demo/pr-header';
import { PrListRow } from '@/components/demo/pr-list-row';
import { ALL_TOTALS, HIDDEN_FILES, HIDDEN_TOTALS, VISIBLE_FILES, VISIBLE_TOTALS } from '@/components/demo/sample-pr';
import { SidebarAccordion } from '@/components/demo/sidebar-accordion';
import { Kbd } from '@/components/kbd';
import { PageIntro, Prose } from '@/components/section';
import { RichText } from '@/components/settings/rich-text';
import { SectionNavMobile } from '@/components/section-nav-mobile';
import type { TocEntry } from '@/components/section-toc';
import { SectionToc } from '@/components/section-toc';
import { KEYBOARD_SHORTCUT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'What Geld changes on GitHub: hidden files, honest header counts, a file-tree accordion, PR list stats, categories, repository rules and custom patterns.',
  alternates: { canonical: '/how-it-works' },
};

interface Step {
  readonly id: string;
  /** Section heading. */
  readonly title: string;
  /** Short label for the table of contents. */
  readonly short: string;
}

const STEPS: readonly Step[] = [
  { id: 'hidden-row', title: 'Hidden files move to the bottom', short: 'Hidden files' },
  { id: 'counts', title: 'Header counts exclude them', short: 'Header counts' },
  { id: 'sidebar', title: 'The file tree becomes an accordion', short: 'File tree' },
  { id: 'lists', title: 'Pull request lists get real numbers', short: 'PR lists' },
  { id: 'categories', title: 'Categories', short: 'Categories' },
  { id: 'repo-rules', title: 'Repository rules', short: 'Repository rules' },
  { id: 'custom-patterns', title: 'Your patterns & categories', short: 'Your patterns' },
  { id: 'repo-config', title: 'Repository configs', short: 'Repository configs' },
  { id: 'whitespace', title: 'Hide whitespace', short: 'Hide whitespace' },
  { id: 'shortcut', title: 'Keyboard shortcut', short: 'Keyboard shortcut' },
  { id: 'enterprise', title: 'GitHub Enterprise Server', short: 'Enterprise Server' },
];

const TOC_ENTRIES: readonly TocEntry[] = STEPS.map((step) => ({ id: step.id, label: step.short }));

export default function HowItWorksPage() {
  const geld = { hidden: HIDDEN_TOTALS, all: ALL_TOTALS, noun: TESTS_CATEGORY.shortNoun, nounPlural: TESTS_CATEGORY.shortNounPlural };
  return (
    <>
      {/* Phones: the sidebar TOC below is hidden, so a bar under the top bar names the section in view (and lists them all on tap). */}
      <SectionNavMobile entries={TOC_ENTRIES} />
      <PageIntro
        eyebrow="How it works"
        title="Everything Geld changes on GitHub, and nothing it doesn't."
        description="Geld only ever inspects file paths. It never reads file contents, never moves GitHub's DOM around, and can be switched off per repository or organisation."
      />

      <div className="container-site grid gap-12 pt-4 pb-32 lg:grid-cols-[220px_1fr] lg:gap-20">
        <nav aria-label="On this page" className="hidden lg:block">
          <SectionToc entries={TOC_ENTRIES} className="sticky top-28" />
        </nav>

        <div className="flex min-w-0 flex-col gap-28 sm:gap-32">
          <Step id="hidden-row" index={1} title={STEPS[0]?.title ?? ''}>
            <Prose>
              <p>
                Anywhere GitHub lists changed files (the <em>Files changed</em> tab, commit pages, compare pages), Geld classifies each entry by its
                path. Matches are not removed; they are pushed below the real changes behind a borderless <em>N test files hidden</em> row with a{' '}
                <em>Show test files</em> toggle that mirrors GitHub&apos;s own collapse controls. Expanding reveals the files in place. When every file
                on a page is hidden there is nothing left to review, so the hidden files start expanded.
              </p>
            </Prose>
            {/* On wide screens an invisible copy with the list open sits in the same grid cell, so collapsing the row shrinks the frame without moving the page below. */}
            <div className="mt-8 lg:grid lg:items-start lg:*:col-start-1 lg:*:row-start-1">
              <Frame>
                <ul aria-label="Changed files with tests hidden">
                  {VISIBLE_FILES.map((file) => (
                    <FileRow key={file.path} file={file} />
                  ))}
                </ul>
                <HiddenRow files={HIDDEN_FILES} noun={TESTS_CATEGORY.noun} nounPlural={TESTS_CATEGORY.nounPlural} defaultOpen />
              </Frame>
              <Frame aria-hidden className="invisible max-lg:hidden">
                <ul>
                  {VISIBLE_FILES.map((file) => (
                    <FileRow key={file.path} file={file} />
                  ))}
                </ul>
                <HiddenRow files={HIDDEN_FILES} noun={TESTS_CATEGORY.noun} nounPlural={TESTS_CATEGORY.nounPlural} defaultOpen />
              </Frame>
            </div>
          </Step>

          <Step id="counts" index={2} title={STEPS[1]?.title ?? ''}>
            <Prose>
              <p>
                <code>+93 −53</code>, <em>Files changed 12</em>, the compare-page summary and the commit header are rewritten in place so they exclude
                hidden files, and prefixed with a gray <code>6 tests</code> label. The label is always shown, even <code>0 tests</code>, so you know
                the numbers were checked. Hovering it shows three rows: excluding tests, including tests and tests only. The originals are remembered and
                restored the moment Geld is switched off.
              </p>
            </Prose>
            <Frame className="mt-8">
              <PrHeader shown={VISIBLE_TOTALS} geld={geld} className="border-b-0" />
            </Frame>
            <p className="mt-3 text-sm text-muted-foreground">Hover, tap or focus the label to see the breakdown.</p>
          </Step>

          <Step id="sidebar" index={3} title={STEPS[2]?.title ?? ''}>
            <div className="grid gap-10 md:grid-cols-[1fr_260px] md:items-start">
              <Prose>
                <p>
                  GitHub&apos;s file tree becomes a full-height accordion. The original tree is the <strong>Changes</strong> panel, and every hidden
                  category gets a panel of its own (<em>Tests</em>, <em>Generated</em>, <em>Docs</em>, …) with a descriptive icon. One panel is open at a
                  time and fills the sidebar with its own scrollbar, so every heading stays visible.
                </p>
                <p>
                  Category panels mirror GitHub&apos;s tree: the same row geometry, collapsible folders, merged single-child directories and status
                  icons. Browsing them never changes the diff; clicking a file auto-expands the hidden diffs and jumps to it, even on large pull requests
                  where GitHub has not rendered it yet.
                </p>
              </Prose>
              {/* An invisible copy with the taller panel open shares the grid cell, so switching panels never moves the page below on wide screens. */}
              <div className="md:grid md:items-start md:*:col-start-1 md:*:row-start-1">
                <SidebarAccordion
                  visible={VISIBLE_FILES}
                  hidden={HIDDEN_FILES}
                  hiddenTitle={TESTS_CATEGORY.title}
                  hiddenNoun={TESTS_CATEGORY.noun}
                  hiddenNounPlural={TESTS_CATEGORY.nounPlural}
                />
                <SidebarAccordion
                  visible={VISIBLE_FILES}
                  hidden={HIDDEN_FILES}
                  hiddenTitle={TESTS_CATEGORY.title}
                  hiddenNoun={TESTS_CATEGORY.noun}
                  hiddenNounPlural={TESTS_CATEGORY.nounPlural}
                  initialPanel="hidden"
                  aria-hidden
                  className="invisible max-md:hidden"
                />
              </div>
            </div>
          </Step>

          <Step id="lists" index={4} title={STEPS[3]?.title ?? ''}>
            <Prose>
              <p>
                On <code>/pulls</code>, the global pull request dashboard and search results, every row gets <code>N tests +A −D</code> excluding hidden
                files, with the same hover breakdown. Because list pages contain no diffs, the counts come from the same <code>.diff</code> file GitHub
                serves when you append <code>.diff</code> to a pull request URL. Rows are fetched a few at a time, only when scrolled near the viewport,
                and cached by the pull request&apos;s head commit. It can be switched off in the options.
              </p>
              <p>
                Lists can also hide pull requests by author: add logins under <strong>Hidden authors</strong> (<code>*[bot]</code> covers every GitHub
                App such as dependabot[bot] or renovate[bot]) and those rows fold into a line that says how many by whom, with a <em>Show</em> to bring
                them back for the visit. And when GitHub&apos;s own file filter is active on a diff (by extension, viewed state or <em>only files you
                own</em> from CODEOWNERS), Geld leaves those files out of its counts too, which GitHub&apos;s header does not.
              </p>
            </Prose>
            <Frame className="mt-8">
              <PrListRow
                number={128}
                title="Add a controlled mode to Button"
                author="octocat"
                when="2 days ago"
                comments={3}
                shown={VISIBLE_TOTALS}
                hidden={HIDDEN_TOTALS}
                all={ALL_TOTALS}
                noun={TESTS_CATEGORY.shortNoun}
                nounPlural={TESTS_CATEGORY.shortNounPlural}
              />
              <PrListRow
                number={127}
                title="Fix focus ring on disabled toggles"
                author="hubot"
                when="3 days ago"
                comments={1}
                shown={{ files: 2, additions: 11, deletions: 4 }}
                hidden={{ files: 1, additions: 9, deletions: 2 }}
                all={{ files: 3, additions: 20, deletions: 6 }}
                noun={TESTS_CATEGORY.shortNoun}
                nounPlural={TESTS_CATEGORY.shortNounPlural}
              />
            </Frame>
          </Step>

          <Step id="categories" index={5} title={STEPS[4]?.title ?? ''}>
            <Prose>
              <p>
                Files are grouped into categories, each with its own switch. <strong>Tests</strong> is on by default; the rest are opt-in from the
                popup or the options page. A path is attributed to the first matching category, in this order:
              </p>
            </Prose>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2">
              {CATEGORIES.map((category, index) => (
                <li key={category.id} className="flex gap-3 border p-4">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {category.title}
                      <span className="border px-1.5 py-px text-[0.6875rem] font-normal text-muted-foreground">
                        {category.defaultEnabled ? 'on by default' : 'opt-in'}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-pretty text-muted-foreground">
                      <RichText copy={category.description} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <Prose>
              <p>
                With one category on, labels read <code>6 tests</code>; with several, <code>9 hidden</code> with the per-category split in the tooltip,
                chips in the bottom row (<code>6 tests · 2 generated · 1 doc</code>) and one panel per category in the file tree. Every pattern is
                listed on the <Link href="/patterns">patterns page</Link>, rendered from the same source the extension uses.
              </p>
              <p>
                Two categories are different: <strong>Trivial changes</strong> and <strong>Large diffs</strong> are decided from the diff rather than
                from paths. Trivial changes are kinds of change: renames and permission changes with no edited lines, binary and deleted files,
                whitespace-only and comment-only edits. Large diffs (a thousand or more changed lines in one file) are kept apart on purpose: they
                are often where the real work is, so hiding them is a deliberate opt-in; by default Geld does the opposite and expands the ones GitHub
                collapses (<strong>Expand large diffs</strong>, in General). A file that a path category claims stays there; the rest is checked
                against the kinds you left on. Separately, the{' '}
                <strong>Hide comment-only lines</strong> setting works inside files that stay visible: changed lines that only add, remove or edit
                code comments (in a language Geld recognises) collapse into a row that says how many and shows them on click, and the header counts
                leave them out.
              </p>
            </Prose>
          </Step>

          <Step id="repo-rules" index={6} title={STEPS[5]?.title ?? ''}>
            <Prose>
              <p>
                Repository rules decide where Geld runs, and read like a <code>.gitignore</code> for repositories. The last matching line wins, and
                matching is case-insensitive because GitHub treats owner and repository names that way. The popup&apos;s{' '}
                <em>turn off for this repo / org</em> actions append these rules for you.
              </p>
              <pre>
                <code>{`acme/widgets     # off in one repository
acme              # off in the whole org (same as acme/*)
!acme/widgets     # …but back on here; last match wins
*                 # off everywhere
!acme/*           # …except this org: an allowlist`}</code>
              </pre>
            </Prose>
          </Step>

          <Step id="custom-patterns" index={7} title={STEPS[6]?.title ?? ''}>
            <Prose>
              <p>
                Every category can be opened to its advanced settings: untick any of its built-in pattern groups, or add extra patterns of your own.
                They use the same gitignore-style syntax as the built-in ones: a pattern without a slash matches a filename at any depth, a trailing
                slash matches a directory at any depth, <code>**</code> spans directories, <code>{'{a,b}'}</code> expands alternatives, and{' '}
                <code>!pattern</code> rescues a path from that category. <code>[owner/repo]</code> headers scope the lines below them to matching
                repositories; <code>[*]</code> returns to global. The options page includes a path tester that shows which pattern decided.
              </p>
              <p>
                You can also create categories of your own — a name, an icon and a list of patterns. Each gets a switch, its own panel in the file
                tree and its own count in the header, and is matched before the built-in categories.
              </p>
              <pre>
                <code>{`*.golden           # everywhere
!src/legacy/**     # …but never inside src/legacy

[acme/*]           # only in the acme organisation
fixtures/**/*.json
sandbox/

[*]                # back to global
*.story.tsx`}</code>
              </pre>
            </Prose>
          </Step>

          <Step id="repo-config" index={8} title={STEPS[7]?.title ?? ''}>
            <Prose>
              <p>
                A repository can carry its own Geld config for everyone who reviews it: commit <code>.github/geld.yml</code> to the default branch.
                It is versioned and reviewed like any other file, and whoever may merge there decides what it says; Geld stores nothing. An
                organisation puts its defaults in <code>geld.yml</code> at the root of its <code>.github</code> repository (
                <code>acme/.github</code>), and a repository&apos;s own file is layered on top.
              </p>
              <p>
                The file uses the same keys as the settings document: <code>categories</code> switches categories on or off, <code>groups</code>{' '}
                built-in pattern groups, <code>categoryPatterns</code> adds patterns to a built-in category and <code>customCategories</code> defines
                new ones. Personal settings (<code>enabled</code>, <code>repoRules</code>, layout) are rejected. Repositories that mark files{' '}
                <code>linguist-generated</code> in <code>.gitattributes</code> feed the Generated category the same way, for free.
              </p>
              <pre>
                <code>{`# .github/geld.yml
categories:
  docs: true                    # hide docs here even for people who keep them
groups:
  tests/snapshots: false        # …but always show snapshot changes
categoryPatterns:
  generated:
    - src/api/__generated__/**
customCategories:
  - id: custom:fixtures
    title: Fixtures
    icon: package
    patterns:
      - fixtures/**`}</code>
              </pre>
              <p>
                Because hiding is the whole point, a repository config is treated with care. Files it hides are counted and listed exactly like the
                ones your own patterns hide, the popup names whose config is in use, and a <strong>Repository configs</strong> setting decides
                whether they apply at all: <em>always</em>, <em>ask once per repository</em> (the default; the popup asks the first time and
                remembers your answer on that device) or <em>never</em>. Files are fetched through your own GitHub session, so private repositories
                work without any extra permission, and they are cached for half an hour.
              </p>
            </Prose>
          </Step>

          <Step id="whitespace" index={9} title={STEPS[8]?.title ?? ''}>
            <Prose>
              <p>
                <strong>Hide whitespace changes</strong> uses GitHub&apos;s own diff setting rather than a re-implementation. Geld first reads GitHub&apos;s
                persisted preference and does nothing if it is already on. If it is off, it flips GitHub&apos;s setting the way you would, through the
                diff-settings menu on the React view or the <em>Apply and reload</em> form on the classic view. GitHub remembers this for signed-in
                users, so it happens once. Signed-out users get the <code>?w=1</code> URL instead.
              </p>
            </Prose>
          </Step>

          <Step id="shortcut" index={10} title={STEPS[9]?.title ?? ''}>
            <Prose>
              <p>
                <Kbd keys={KEYBOARD_SHORTCUT} /> shows or hides the hidden files on the current page for the rest of the visit, without touching your
                settings. Rebind it in your browser&apos;s extension-shortcut settings, or turn it off in the options. The toolbar icon carries the
                hidden-file count as a badge, and the popup lists the hidden paths for the current tab.
              </p>
              <p>
                Settings live in your browser&apos;s sync storage and can be exported as JSON. To share them between browsers, sign in with GitHub
                (device flow, <code>gist</code> scope only) and Geld keeps them in a secret gist on your own account; see the{' '}
                <Link href="/faq#sync">FAQ</Link>.
              </p>
            </Prose>
          </Step>

          <Step id="enterprise" index={11} title={STEPS[10]?.title ?? ''}>
            <Prose>
              <p>
                Add your server&apos;s hostname in the options. The browser asks you to allow Geld on that host, and the content script is registered
                there (Chrome, Edge and Safari via <code>scripting</code>, Firefox via <code>contentScripts</code>). Geld makes no requests to any host
                other than the GitHub hosts you have configured. GHES runs GitHub&apos;s UI a few versions behind, so if something looks off, please open
                an issue with a screenshot.
              </p>
            </Prose>
          </Step>
        </div>
      </div>
    </>
  );
}

function Step({ id, index, title, children }: { readonly id: string; readonly index: number; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
      <p className="mb-3 font-mono text-base tabular-nums text-muted-foreground">{String(index).padStart(2, '0')}</p>
      <h2 id={`${id}-heading`} className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}
