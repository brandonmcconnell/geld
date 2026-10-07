/**
 * `pull-review` is Geld's own tab: the files page (`/files` or `/changes`)
 * opened at `#geld-review`, where the Review view stands in for GitHub's
 * files layout. GitHub serves its files view underneath, which is what the
 * steps borrow their diffs from. A hash, not a query: GitHub's page script
 * `replaceState`s the files URL to its canonical form once loaded, dropping
 * any query it does not know (`?geld=review` was gone within a second,
 * measured Oct 2026) and keeping the fragment.
 */
export type PageKind = 'pull-files' | 'pull-review' | 'pull-conversation' | 'pull-other' | 'commit' | 'compare' | 'other';

export const REVIEW_TAB_HASH = '#geld-review';

/** Whether a URL asks for the Review tab (the files page at `#geld-review`). */
export function isReviewTabUrl(url: URL): boolean {
  return url.hash === REVIEW_TAB_HASH;
}

export interface PageInfo {
  readonly kind: PageKind;
  /** Same-origin URL of the raw unified diff for this page, when one exists. */
  readonly diffUrl: string | null;
  /** Key used to remember per-page UI state (expanded/collapsed) across tab switches. */
  readonly stateKey: string;
}

const PULL = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^/]+))?/;
const COMMIT = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,64})/i;
const COMPARE = /^\/([^/]+)\/([^/]+)\/compare\/([^?#]+)/;

export function describePage(url: URL): PageInfo {
  const path = url.pathname;

  const pull = PULL.exec(path);
  if (pull !== null) {
    const [, owner, repo, number, tab] = pull;
    const base = `/${owner}/${repo}/pull/${number}`;
    // `/files` is the classic tab; `/changes` is the newer React experience.
    const files = tab === 'files' || tab === 'changes';
    const kind: PageKind = files ? (isReviewTabUrl(url) ? 'pull-review' : 'pull-files') : tab === undefined || tab === 'conversation' ? 'pull-conversation' : 'pull-other';
    return { kind, diffUrl: `${url.origin}${base}.diff`, stateKey: base };
  }

  const commit = COMMIT.exec(path);
  if (commit !== null) {
    const [, owner, repo, sha] = commit;
    const base = `/${owner}/${repo}/commit/${sha}`;
    return { kind: 'commit', diffUrl: `${url.origin}${base}.diff`, stateKey: base };
  }

  const compare = COMPARE.exec(path);
  if (compare !== null) {
    const [, owner, repo, range] = compare;
    const base = `/${owner}/${repo}/compare/${range ?? ''}`.replace(/\.diff$|\.patch$/, '');
    return { kind: 'compare', diffUrl: `${url.origin}${base}.diff`, stateKey: base };
  }

  return { kind: 'other', diffUrl: null, stateKey: path };
}

/**
 * GitHub answered a repository URL with a sign-in page: the login form, an
 * organisation's single sign-on prompt ("Single sign-on to Mintlify"), or a
 * two-factor check. The URL still reads as a pull request, so without this
 * the pass would ask for the page's JSON (the files-tab summaries, the
 * Commits tab, the repository's directory listing) and every one would
 * answer 401 — a red console error on a page Geld has nothing to do on.
 * GitHub marks those pages with `session-authentication` on `<body>`; a
 * repository page never carries it. Before `<body>` exists nothing is known,
 * and nothing is fetched that early either.
 */
export function isSignInInterstitial(doc: Document = document): boolean {
  return doc.body?.classList.contains('session-authentication') === true;
}
