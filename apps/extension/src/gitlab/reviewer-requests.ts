import type { ProviderReviewSubject } from '@geld/review';
import { pageFetch } from '../github/page-fetch';
import type { ReviewersMenuCandidate } from '../review/reviewers-menu';
import type { ProviderReviewerRequests } from '../providers/types';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const record = (value: unknown): Readonly<Record<string, unknown>> | null => (isRecord(value) ? value : null);

const integer = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null);

/** GitLab's project members as the menu lists them: people only, active, with GitLab's own avatar. */
export function parseGitLabCandidates(value: unknown, origin: string): readonly ReviewersMenuCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const found: ReviewersMenuCandidate[] = [];
  for (const entry of value) {
    const user = record(entry);
    const id = integer(user?.id);
    if (user === null || id === null || typeof user.username !== 'string' || user.username === '' || user.bot === true || (user.state !== undefined && user.state !== 'active')) continue;
    let avatar = '';
    if (typeof user.avatar_url === 'string') {
      try { avatar = new URL(user.avatar_url, origin).protocol === 'https:' ? new URL(user.avatar_url, origin).href : ''; } catch { avatar = ''; }
    }
    found.push({ id, login: user.username, name: typeof user.name === 'string' ? user.name : '', avatar, suggested: false, team: false });
  }
  return found;
}

/**
 * Asking people to review on GitLab, as the reader, with the page's session and CSRF token: someone new joins the
 * merge request's reviewers (`reviewer_ids` is the whole set, read afresh so nobody is dropped), and someone who is a
 * reviewer already is asked again with GitLab's re-request (`mergeRequestReviewerRereview`), as its sidebar does.
 */
export function gitLabReviewerRequests(subject: ProviderReviewSubject, doc: Document = document): ProviderReviewerRequests | null {
  const csrf = doc.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
  if (csrf === '' || !/^\d+$/.test(subject.id)) return null;
  const project = `${subject.origin}/api/v4/projects/${encodeURIComponent(subject.repository)}`;
  const send = async (url: string, method: 'GET' | 'PUT' | 'POST', body?: unknown): Promise<{ readonly ok: boolean; readonly body: unknown }> => {
    try {
      const response = await pageFetch(url, {
        method,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try { parsed = text === '' ? null : JSON.parse(text); } catch { parsed = null; }
      return { ok: response.ok, body: parsed };
    } catch {
      return { ok: false, body: null };
    }
  };
  return {
    hostName: 'GitLab',
    reask: true,
    loadCandidates: async () => {
      const answer = await send(`${project}/users?per_page=100`, 'GET');
      return answer.ok ? parseGitLabCandidates(answer.body, subject.origin) : null;
    },
    request: async (ids) => {
      const chosen = ids.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
      if (chosen.length === 0) return false;
      const merge = await send(`${project}/merge_requests/${subject.id}`, 'GET');
      const reviewers = record(merge.body)?.reviewers;
      if (!merge.ok || !Array.isArray(reviewers)) return false;
      const current = reviewers.map((reviewer) => integer(record(reviewer)?.id)).filter((id): id is number => id !== null);
      const added = chosen.filter((id) => !current.includes(id));
      const again = chosen.filter((id) => current.includes(id));
      if (added.length > 0 && !(await send(`${project}/merge_requests/${subject.id}`, 'PUT', { reviewer_ids: [...current, ...added] })).ok) return false;
      for (const id of again) {
        const answer = await send(`${subject.origin}/api/graphql`, 'POST', {
          query: 'mutation($projectPath: ID!, $iid: String!, $userId: UserID!) { mergeRequestReviewerRereview(input: { projectPath: $projectPath, iid: $iid, userId: $userId }) { errors } }',
          variables: { projectPath: subject.repository, iid: subject.id, userId: `gid://gitlab/User/${id}` },
        });
        const errors = record(record(record(answer.body)?.data)?.mergeRequestReviewerRereview)?.errors;
        if (!answer.ok || record(answer.body)?.errors !== undefined || (Array.isArray(errors) && errors.length > 0)) return false;
      }
      return true;
    },
  };
}
