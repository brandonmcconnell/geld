import type { FlowFailure as SharedFailure, FlowFile, FlowHost, FlowRemovedLinks } from '../../review/flow';
import { closeFlow, flowFiles as sharedFlowFiles, openFlowDialog as openShared, setFlowSource as setShared } from '../../review/flow';
import { looksLikeHtml } from '../../lib/http';
import { pageFetch } from '../page-fetch';

export type { FlowFile, FlowFileStatus, FlowRemovedLinks } from '../../review/flow';
export { closeFlow };

/** What the GitHub controller hands Flow on every conversation pass. */
export interface FlowSource {
  readonly origin: string;
  /** `owner/repo`. */
  readonly repo: string;
  /** `/owner/repo/pull/N`. */
  readonly pullPath: string;
  readonly headSha: string | null;
  readonly files: readonly FlowFile[];
  /** Whether the files carry the imports the diff removed: `known` from the diff, else GitHub's summaries stand in for it. */
  readonly removed: FlowRemovedLinks;
}

/** Why the pull request's diff is not here, when its request failed (`retrying` while it is still asked again on its own). */
export interface FlowFailure {
  readonly origin: string;
  readonly pullPath: string;
  readonly reason: string;
  readonly retrying: boolean;
}

const MAX_READS = 160;
const CONCURRENT_READS = 6;
/** Reads at a time before the dialog is opened: the diagram is prepared in the background without crowding the page's own requests. */
const PREFETCH_READS = 2;

function reviewOf(origin: string, pullPath: string): string {
  return `${origin}${pullPath}`;
}

/** The changed files as the controller last handed them over, for the chat assistant; empty off a pull request. */
export function flowFiles(pullPath: string): readonly FlowFile[] {
  return sharedFlowFiles(reviewOf(location.origin, pullPath));
}

/** What the dialog says in place of the diagram when the diff could not be had, and whether reloading is the way on. */
function failureCopy(failed: FlowFailure): { readonly text: string; readonly reload: boolean } {
  if (failed.reason === 'too-large') return { text: 'This pull request’s diff is over 20 MB, too large for Flow to read.', reload: false };
  if (failed.reason === 'rate-limited') return { text: 'GitHub is limiting diff downloads. Flow tries again shortly.', reload: false };
  if (failed.retrying) return { text: 'GitHub did not hand over the diff yet. Flow tries again shortly.', reload: false };
  if (failed.reason === 'signed-out') return { text: 'GitHub answered with its sign-in page instead of the diff. Sign in, or renew your SSO session, and reload.', reload: true };
  if (failed.reason === 'http-404') return { text: 'GitHub answered 404 for the diff. For a private repository that means you are signed out. Sign in and reload.', reload: true };
  return { text: `Geld could not load this pull request’s diff (${failed.reason}).`, reload: true };
}

function rawUrl(origin: string, repo: string, revision: string, path: string): string {
  return `${origin}/${repo}/raw/${encodeURIComponent(revision)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The Files changed tab as the page links to it (keeping any `?w=1` Geld or the reader put there), else `/files`. */
function filesTabHref(pullPath: string): string {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"]')) {
    const url = new URL(link.href, location.href);
    if (url.pathname === `${pullPath}/files` || url.pathname === `${pullPath}/changes`) {
      url.hash = '';
      return url.toString();
    }
  }
  return `${location.origin}${pullPath}/files`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hostFor(origin: string, repo: string, pullPath: string, headSha: string | null): FlowHost {
  return {
    review: reviewOf(origin, pullPath),
    reviewNoun: 'pull request',
    filesTab: 'Files changed',
    concurrency: { prefetch: PREFETCH_READS, open: CONCURRENT_READS },
    maxReads: MAX_READS,
    // Each surviving file whole at the head, from the page's own `raw` route (same origin, so private repositories work).
    read: async (path, signal) => {
      if (headSha === null) return null;
      const response = await pageFetch(rawUrl(origin, repo, headSha, path), { credentials: 'same-origin', redirect: 'follow', signal });
      if (!response.ok) return null;
      const text = await response.text();
      return looksLikeHtml(response.headers.get('content-type'), text) ? null : text;
    },
    filesHref: () => filesTabHref(pullPath),
    fileHref: async (path) => `${filesTabHref(pullPath)}#diff-${await sha256Hex(path)}`,
    skin: { name: 'github', button: 'btn btn-sm', closeButton: 'close-button' },
  };
}

/** What the diagram is drawn from, set by the controller on every conversation pass (null elsewhere), with the diff's failure while it has none. */
export function setFlowSource(next: FlowSource | null, failed: FlowFailure | null = null): void {
  if (next === null) {
    // Flow is offered before the diff has loaded: on a pull request the dialog opens and waits for it.
    const pullPath = /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(location.pathname)?.[0];
    if (failed === null) return setShared(pullPath === undefined ? null : hostFor(location.origin, pullPath.split('/').slice(1, 3).join('/'), pullPath, null), null);
    const copy = failureCopy(failed);
    const failure: SharedFailure = { review: reviewOf(failed.origin, failed.pullPath), text: copy.text, retrying: failed.retrying, reload: copy.reload };
    return setShared(hostFor(failed.origin, failed.pullPath.split('/').slice(1, 3).join('/'), failed.pullPath, null), null, failure);
  }
  setShared(hostFor(next.origin, next.repo, next.pullPath, next.headSha), {
    key: `${next.origin}/${next.repo}${next.pullPath}@${next.headSha ?? ''}`,
    headKnown: next.headSha !== null,
    files: next.files,
    removed: next.removed,
  });
}

/** Open the Flow dialog for the pull request on the page. */
export function openFlowDialog(opener: HTMLElement | null = null): void {
  const pullPath = /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(location.pathname)?.[0];
  if (pullPath !== undefined) openShared(reviewOf(location.origin, pullPath), opener);
}
