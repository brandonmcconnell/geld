/** A link in a comment or description to an issue, a pull request or a discussion. */
export interface ReferenceLink {
  readonly href: string;
  /** `owner/repo#N`: issues, pull requests and discussions share a repository's numbers, so it names one of them. */
  readonly ref: string;
  /** The link's own words, or empty where they only repeat the number. */
  readonly title: string;
  readonly discussion: boolean;
}

/** GitHub's rendered references: `#12`, `owner/repo#12` and pasted URLs all become one of these. */
const REFERENCE_LINK = 'a.issue-link[href], a[data-hovercard-type="pull_request"][href], a[data-hovercard-type="issue"][href], a[data-hovercard-type="discussion"][href]';

/** Each issue, pull request and discussion `body` links to, once per reference, in document order. */
export function referenceLinksIn(body: Element | null): readonly ReferenceLink[] {
  if (body === null) return [];
  const seen = new Set<string>();
  const links: ReferenceLink[] = [];
  for (const link of body.querySelectorAll<HTMLAnchorElement>(REFERENCE_LINK)) {
    const href = link.getAttribute('href') ?? '';
    const match = /\/([^/]+)\/([^/]+)\/(pull|issues|discussions)\/(\d+)/.exec(href);
    if (match === null) continue;
    const ref = `${match[1]}/${match[2]}#${match[4]}`;
    if (seen.has(ref.toLowerCase())) continue;
    seen.add(ref.toLowerCase());
    const title = (link.getAttribute('title') ?? link.getAttribute('aria-label') ?? link.textContent ?? '').replace(/\s+/g, ' ').trim();
    links.push({ href, ref, title: title === '' || /^(?:[\w.-]+\/[\w.-]+)?#?\d+$/.test(title) ? '' : title, discussion: match[3] === 'discussions' });
  }
  return links;
}
