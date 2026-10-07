/**
 * What an issue or pull request is called and what state it is in, for
 * references the page only names by number. GitHub's own hovercard endpoint
 * (`/owner/repo/pull/N/hovercard`, the one its hovercards load) answers
 * with the title and a `State--open|closed|merged|draft` badge; one fetch
 * per reference per visit, remembered here. Nothing is fetched until a
 * view asks, so a page whose mentions fold is never opened costs nothing.
 */

import { fragmentHeaders } from './deeplink';

export type RefState = 'open' | 'closed' | 'merged' | 'draft' | 'issue-open' | 'issue-closed' | 'unknown';

export interface RefDetails {
  readonly title: string;
  readonly state: RefState;
}

const details = new Map<string, RefDetails>();
const pending = new Set<string>();
const failed = new Set<string>();
let version = 0;

/** Bumped whenever a lookup lands, so a view built from these can tell it is stale. */
export function refsVersion(): number {
  return version;
}

/** `/owner/repo/pull/N` for any issue or pull request URL on this host, else null. */
export function refKeyOf(href: string): string | null {
  const match = /\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/.exec(href);
  return match === null ? null : `/${match[1]}/${match[2]}/pull/${match[3]}`;
}

/**
 * Details for `href`, or null while they are on their way (then `onChange`
 * runs once they land) or when GitHub would not say.
 */
export function refDetails(href: string, onChange: () => void): RefDetails | null {
  const key = refKeyOf(href);
  if (key === null) return null;
  const known = details.get(key);
  if (known !== undefined) return known;
  if (pending.has(key) || failed.has(key)) return null;
  pending.add(key);
  void fetchDetails(key)
    .then((found) => {
      if (found === null) failed.add(key);
      else details.set(key, found);
      version += 1;
      onChange();
    })
    .finally(() => pending.delete(key));
  return null;
}

async function fetchDetails(key: string): Promise<RefDetails | null> {
  try {
    const response = await fetch(new URL(`${key}/hovercard`, location.href), { headers: fragmentHeaders(), credentials: 'same-origin' });
    if (!response.ok) return null;
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    return parseHovercard(parsed, key);
  } catch {
    return null;
  }
}

/** Exported for tests: the title and state a hovercard document carries. */
export function parseHovercard(doc: Document, key: string): RefDetails | null {
  const number = key.slice(key.lastIndexOf('/') + 1);
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((link) => (link.getAttribute('href') ?? '').includes(`/${number}`) && (link.textContent ?? '').trim() !== '');
  const link = links.sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length)[0];
  if (link === undefined) return null;
  // "Add page mention email (ENG-10574) #84": the number is not part of the title.
  const title = (link.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(new RegExp(`\\s*#${number}$`), '')
    .trim();
  if (title === '') return null;
  const badge = doc.querySelector('.State');
  const issue = doc.querySelector('.octicon-issue-opened, .octicon-issue-closed') !== null && doc.querySelector('.octicon-git-pull-request, .octicon-git-merge, .octicon-git-pull-request-closed, .octicon-git-pull-request-draft') === null;
  return { title, state: stateOf(badge?.className ?? '', badge?.textContent ?? '', issue) };
}

function stateOf(className: string, text: string, issue: boolean): RefState {
  const value = `${className} ${text}`.toLowerCase();
  if (/merged/.test(value)) return 'merged';
  if (/draft/.test(value)) return 'draft';
  if (/closed|not planned|completed/.test(value)) return issue ? 'issue-closed' : 'closed';
  if (/open/.test(value)) return issue ? 'issue-open' : 'open';
  return 'unknown';
}

/** Forget everything (a new visit). */
export function resetRefs(): void {
  details.clear();
  pending.clear();
  failed.clear();
}
