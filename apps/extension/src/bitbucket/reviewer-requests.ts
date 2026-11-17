import type { ProviderReviewSubject } from '@geld/review';
import { pageFetch } from '../github/page-fetch';
import type { ReviewersMenuCandidate } from '../review/reviewers-menu';
import type { ProviderReviewerRequests } from '../providers/types';
import { bitbucketAuthenticated } from './actions';
import { bitbucketCsrfToken } from './post-comment';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const record = (value: unknown): Readonly<Record<string, unknown>> | null => (isRecord(value) ? value : null);

const uuid = (value: unknown): string | null => (typeof value === 'string' && /^\{[0-9a-f-]{36}\}$/i.test(value) ? value : null);

/** The workspace's members as the menu lists them: people only, by nickname (the digest's login), with Bitbucket's avatar. */
export function parseBitbucketCandidates(value: unknown): readonly ReviewersMenuCandidate[] | null {
  const values = record(value)?.values;
  if (!Array.isArray(values)) return null;
  const found: ReviewersMenuCandidate[] = [];
  for (const entry of values) {
    const user = record(record(entry)?.user);
    const id = uuid(user?.uuid);
    if (user === null || id === null || user.type === 'app_user') continue;
    const login = typeof user.nickname === 'string' && user.nickname !== '' ? user.nickname : id;
    const href = record(record(user.links)?.avatar)?.href;
    let avatar = '';
    if (typeof href === 'string') {
      try { avatar = new URL(href).protocol === 'https:' ? new URL(href).href : ''; } catch { avatar = ''; }
    }
    found.push({ id, login, name: typeof user.display_name === 'string' ? user.display_name : '', avatar, suggested: false, team: false });
  }
  return found;
}

/**
 * Asking people to review on Bitbucket Cloud, as the reader: the pull request's reviewers are the whole set, read
 * afresh and written back with the new ones (Bitbucket's update wants the title beside them). Bitbucket has no
 * re-request, so someone who is a reviewer already is listed but not ticked (`reask: false`).
 */
export function bitbucketReviewerRequests(subject: ProviderReviewSubject, doc: Document = document): ProviderReviewerRequests | null {
  const [workspace, repo, ...rest] = subject.repository.split('/');
  if (subject.origin !== 'https://bitbucket.org' || workspace === undefined || repo === undefined || rest.length > 0 || !/^\d+$/.test(subject.id) || !bitbucketAuthenticated(doc)) return null;
  const api = `${subject.origin}/!api/2.0`;
  const pull = `${api}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/pullrequests/${subject.id}`;
  const send = async (url: string, method: 'GET' | 'PUT', body?: unknown): Promise<{ readonly ok: boolean; readonly body: unknown }> => {
    try {
      const response = await pageFetch(url, {
        method,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(method === 'GET' ? {} : { 'X-CSRFToken': bitbucketCsrfToken(doc), 'Content-Type': 'application/json' }) },
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
    hostName: 'Bitbucket',
    reask: false,
    loadCandidates: async () => {
      const answer = await send(`${api}/workspaces/${encodeURIComponent(workspace)}/members?pagelen=100`, 'GET');
      return answer.ok ? parseBitbucketCandidates(answer.body) : null;
    },
    request: async (ids) => {
      const chosen = ids.filter((id): id is string => uuid(id) !== null);
      if (chosen.length === 0 || bitbucketCsrfToken(doc) === '') return false;
      const current = await send(pull, 'GET');
      const value = record(current.body);
      const reviewers = value?.reviewers;
      if (!current.ok || value === null || typeof value.title !== 'string' || !Array.isArray(reviewers)) return false;
      const keep = reviewers.map((reviewer) => uuid(record(reviewer)?.uuid)).filter((id): id is string => id !== null);
      const all = [...keep, ...chosen.filter((id) => !keep.includes(id))];
      return (await send(pull, 'PUT', { title: value.title, reviewers: all.map((id) => ({ uuid: id })) })).ok;
    },
  };
}
