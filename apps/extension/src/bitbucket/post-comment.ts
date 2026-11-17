import type { ProviderReviewSubject } from '@geld/review';
import { pageFetch } from '../github/page-fetch';
import { bitbucketAuthenticated } from './actions';

/** Bitbucket's Django CSRF token, which its own page sends with every write as `X-CSRFToken`. */
export function bitbucketCsrfToken(doc: Document = document): string {
  for (const part of doc.cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'csrftoken') return decodeURIComponent(value.join('='));
  }
  return '';
}

/**
 * A top-level comment on the pull request, as the reader: the page's own `/!api/2.0/` route with the session and the
 * CSRF token, never a token of Geld's. Only on bitbucket.org, where that route is the page's own origin.
 */
export async function postBitbucketComment(subject: ProviderReviewSubject, text: string, doc: Document = document): Promise<boolean> {
  const csrf = bitbucketCsrfToken(doc);
  if (subject.origin !== 'https://bitbucket.org' || csrf === '' || !bitbucketAuthenticated(doc)) return false;
  const [workspace, repo, ...rest] = subject.repository.split('/');
  if (workspace === undefined || repo === undefined || rest.length > 0 || !/^\d+$/.test(subject.id)) return false;
  const url = `${subject.origin}/!api/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/pullrequests/${subject.id}/comments`;
  try {
    const response = await pageFetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ content: { raw: text } }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
