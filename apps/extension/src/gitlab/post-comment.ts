import type { ProviderReviewSubject } from '@geld/review';
import { pageFetch } from '../github/page-fetch';

/** A top-level note on the merge request, as the reader: the REST notes route with the session and the page's CSRF token. */
export async function postGitLabComment(subject: ProviderReviewSubject, text: string, doc: Document = document): Promise<boolean> {
  const csrf = doc.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
  if (csrf === '') return false;
  const url = `${subject.origin}/api/v4/projects/${encodeURIComponent(subject.repository)}/merge_requests/${encodeURIComponent(subject.id)}/notes`;
  try {
    const response = await pageFetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ body: text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
