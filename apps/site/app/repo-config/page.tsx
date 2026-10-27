import { CATEGORIES, CATEGORY_ICON_NAMES, catalogGroupKeys, ORG_CONFIG_PATHS, REPO_CONFIG_PATH } from '@geld/core';
import { REVIEW_BOTS } from '@geld/review/bots';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ExternalLink } from '@/components/external-link';
import { PageIntro, Prose } from '@/components/section';
import { SubBar } from '@/components/sub-bar';
import { REPO_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Repository config',
  description: 'Every key a repository can set in .github/geld.yml, its valid values, and how the file is applied — rendered from the same catalogs the extension ships.',
  alternates: { canonical: '/repo-config' },
};

const SECTIONS = [
  { id: 'where', label: 'Where it lives' },
  { id: 'version', label: 'version' },
  { id: 'categories', label: 'categories' },
  { id: 'groups', label: 'groups' },
  { id: 'categoryPatterns', label: 'categoryPatterns' },
  { id: 'customCategories', label: 'customCategories' },
  { id: 'reviewBots', label: 'reviewBots' },
  { id: 'rejected', label: 'What is rejected' },
  { id: 'applied', label: 'How it is applied' },
] as const;

const EXAMPLE = `# ${REPO_CONFIG_PATH}
version: 1

categories:
  docs: true                     # hide docs here, even for people who keep them
  stories: true

groups:
  tests/snapshots: false         # but always show snapshot changes

categoryPatterns:
  generated:
    - src/api/__generated__/**
    - "!src/api/__generated__/README.md"

customCategories:
  - id: custom:fixtures
    title: Fixtures
    icon: package
    patterns:
      - fixtures/**
    noun: fixture

reviewBots:
  - coderabbit
  - greptile
`;

/** `code` with the page's chip look, for ids and values in the tables. */
function Code({ children }: { readonly children: React.ReactNode }) {
  return <code className="code-chip">{children}</code>;
}

function KeyTable({ rows, head, ariaLabel }: { readonly rows: ReadonlyArray<readonly [React.ReactNode, React.ReactNode]>; readonly head: readonly [string, string]; readonly ariaLabel: string }) {
  return (
    <div className="my-6 overflow-x-auto border">
      <table className="w-full text-left text-sm" aria-label={ariaLabel}>
        <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              {head[0]}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, value], index) => (
            <tr key={index} className="border-t align-top">
              <td className="px-4 py-2 font-mono text-[0.8125rem] whitespace-nowrap">{key}</td>
              <td className="px-4 py-2 leading-6 text-foreground/90">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RepoConfigPage() {
  const groupKeys = catalogGroupKeys();
  const requestable = REVIEW_BOTS.filter((bot) => bot.triggers.length > 0);
  return (
    <>
      <PageIntro
        eyebrow="Repository config"
        title="One file, every reviewer."
        description={
          <>
            A repository can configure Geld for everyone who reviews it by committing <code className="code-chip">{REPO_CONFIG_PATH}</code>. This page
            lists every key the file accepts and every valid value, generated from{' '}
            <ExternalLink href={`${REPO_URL}/blob/main/packages/core/src/repo-config.ts`} className="underline underline-offset-3 hover:text-foreground">
              <code className="font-mono text-[0.9em]">@geld/core</code>
            </ExternalLink>{' '}
            and the review-bot registry the extension ships, so it cannot drift from what is actually accepted.
          </>
        }
      />

      <SubBar aria-label="Keys" className="py-3">
        <ul className="container-site flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((section) => (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                className="geld-corners geld-cut-[7px] inline-block border bg-background/60 px-3 py-1 font-mono text-sm whitespace-nowrap text-foreground/80 hover:border-foreground hover:bg-background hover:text-foreground"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </SubBar>

      <div className="container-site pt-12 pb-24">
        <Prose>
          <h2 id="where">Where it lives</h2>
          <p>
            <code>{REPO_CONFIG_PATH}</code> on the default branch of the repository. An organisation puts its defaults in its public{' '}
            <code>.github</code> repository (<code>acme/.github</code>, where GitHub reads default community files from), as{' '}
            {ORG_CONFIG_PATHS.map((path, index) => (
              <span key={path}>
                {index > 0 ? ' or ' : ''}
                <code>{path}</code>
              </span>
            ))}
            ; the first that exists is used, and a repository&apos;s own file is layered on top. The file is YAML with the keys below; keys Geld does not
            know are ignored, so a newer Geld can accept more without an older one reporting an error. A full example:
          </p>
          <pre>
            <code>{EXAMPLE}</code>
          </pre>

          <h2 id="version">
            <code>version</code>
          </h2>
          <p>
            Optional. The only accepted value is <code>1</code>. Any other value is reported as a problem and the file is not applied.
          </p>

          <h2 id="categories">
            <code>categories</code>
          </h2>
          <p>
            A mapping of category id to <code>true</code> (hide these files for everyone reviewing here) or <code>false</code> (never hide them here, even for
            people who have the category on). The repository&apos;s value wins over each reviewer&apos;s own switch for the categories it names and leaves the
            rest alone. Ids are the built-in ones below and, once defined under <code>customCategories</code>, <code>custom:&lt;slug&gt;</code> ids. The
            patterns behind each built-in category are on the <Link href="/patterns">Patterns</Link> page.
          </p>
        </Prose>
        <KeyTable
          head={['Category id', 'What it hides']}
          ariaLabel="Built-in category ids"
          rows={CATEGORIES.map((category) => [
            <Code key={category.id}>{category.id}</Code>,
            <>
              <strong className="font-semibold text-foreground">{category.title}</strong>
              {category.defaultEnabled ? ' (on by default)' : ''}. {category.groups.length} {category.groups.length === 1 ? 'group' : 'groups'}.
            </>,
          ])}
        />

        <Prose>
          <h2 id="groups">
            <code>groups</code>
          </h2>
          <p>
            A mapping of <code>category/group</code> to <code>true</code> or <code>false</code>: the off-switch for one pattern group inside a built-in category,
            for everyone. A group is only consulted while its category is on. The keys are every group of every built-in category:
          </p>
          <ul className="my-4 flex flex-wrap gap-1.5 !list-none !pl-0" aria-label="Pattern group keys">
            {groupKeys.map((key) => (
              <li key={key} className="!my-0">
                <code className="code-chip">{key}</code>
              </li>
            ))}
          </ul>

          <h2 id="categoryPatterns">
            <code>categoryPatterns</code>
          </h2>
          <p>
            A mapping of built-in category id to a list of extra pattern lines for that category. Lines use gitignore semantics (a pattern without a slash
            matches a file name at any depth, a trailing slash a directory and everything in it, <code>**</code> spans directories, <code>{'{a,b}'}</code>{' '}
            expands alternatives); a line starting with <code>!</code> rescues a path the category would otherwise hide, and a line of the form{' '}
            <code>[owner/repo]</code> scopes the lines after it to one repository (<code>[*]</code> returns to everywhere). Every pattern is compiled when
            the file is read; one that does not compile is reported with its line.
          </p>

          <h2 id="customCategories">
            <code>customCategories</code>
          </h2>
          <p>A list of categories of the repository&apos;s own. Each entry is an object with these keys:</p>
        </Prose>
        <KeyTable
          head={['Key', 'Value']}
          ariaLabel="Custom category keys"
          rows={[
            [
              <Code key="id">id</Code>,
              <>
                Required. <Code>custom:&lt;slug&gt;</Code> where the slug is lowercase letters, digits and dashes, unique in the file. The id is what{' '}
                <code className="code-chip">categories</code> and every reviewer&apos;s settings refer to, so it should not change once published.
              </>,
            ],
            [<Code key="title">title</Code>, <>Required. The name shown in the panel and the sidebar, up to 40 characters.</>],
            [
              <Code key="icon">icon</Code>,
              <>
                Optional. One of the Octicon names below; <Code>package</Code> when left out.
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Icon names">
                  {CATEGORY_ICON_NAMES.map((name) => (
                    <li key={name}>
                      <code className="code-chip">{name}</code>
                    </li>
                  ))}
                </ul>
              </>,
            ],
            [
              <Code key="patterns">patterns</Code>,
              <>
                Required. A list of pattern lines with the same syntax as <code className="code-chip">categoryPatterns</code>. Custom categories are matched before
                the built-in ones.
              </>,
            ],
            [
              <>
                <Code>noun</Code>, <Code>nounPlural</Code>
              </>,
              <>
                Optional. Short words for counts (&ldquo;2 fixtures&rdquo;); the lower-cased title when left out.
              </>,
            ],
          ]}
        />

        <Prose>
          <h2 id="reviewBots">
            <code>reviewBots</code>
          </h2>
          <p>
            A list of the review bots installed on the repository, by id. Geld can only tell a bot is available from what it has already done on a pull
            request, which is nothing on one that is waiting for its first review; a repository that names its bots here makes the panel&apos;s{' '}
            <strong>Request a review</strong> menu list them on every pull request, for every reviewer, with no sign-in. Only the ids below are accepted:
            Geld knows what to post, read and show for each of them, which a bare login would not tell it. The menu also offers a bot whose own config
            file is in the repository, and the rest of the registry behind &ldquo;Other bots&rdquo;.
          </p>
        </Prose>
        <KeyTable
          head={['Bot id', 'What Run posts']}
          ariaLabel="Review bot ids"
          rows={requestable.map((bot) => [
            <Code key={bot.id}>{bot.id}</Code>,
            <>
              <strong className="font-semibold text-foreground">{bot.title}</strong>: the comment <code className="code-chip">{bot.triggers[0]}</code>
              {bot.configFiles.length > 0 ? (
                <>
                  . Also offered when the repository holds{' '}
                  {bot.configFiles.map((path, index) => (
                    <span key={path}>
                      {index > 0 ? ' or ' : ''}
                      <code className="code-chip">{path}</code>
                    </span>
                  ))}
                  .
                </>
              ) : (
                '.'
              )}
            </>,
          ])}
        />

        <Prose>
          <h2 id="rejected">What is rejected</h2>
          <p>
            Personal settings have no place in a repository&apos;s file and are reported as problems: <code>enabled</code>, <code>repoRules</code>,{' '}
            <code>hiddenAuthors</code>, layout and display switches, the keyboard shortcut, Enterprise hosts, the <code>repoConfigs</code> choice itself and
            the AI settings. A file with any problem is not applied at all; the popup lists the problems with their path in the file (
            <code>customCategories[1].icon</code>, <code>reviewBots[0]</code>, <code>line 3, column 9</code> for a YAML error) so they can be fixed in one
            pass. Keys Geld does not know are ignored on purpose.
          </p>

          <h2 id="applied">How it is applied</h2>
          <p>
            Hiding is Geld&apos;s whole point, which makes a repository config an attack surface: a <code>*.ts</code> pattern in a compromised repository
            would hide a backdoor from its reviewers. So the file is only applied when the reviewer allows it (the <strong>Repository configs</strong>{' '}
            setting: <em>always</em>, <em>ask once per repository</em>, the default, or <em>never</em>), files it hides are counted and listed exactly like
            the ones the reviewer&apos;s own patterns hide, and the popup names whose config is in use. Files are fetched through the reviewer&apos;s own
            GitHub session, so private repositories work with no extra permission, and cached for half an hour. Repositories that mark files{' '}
            <code>linguist-generated</code> in <code>.gitattributes</code> feed the Generated category the same way, with nothing to configure.
          </p>
          <p>
            Missing a key or a bot? <ExternalLink href={`${REPO_URL}/issues`}>Open an issue</ExternalLink>.
          </p>
        </Prose>
      </div>
    </>
  );
}
