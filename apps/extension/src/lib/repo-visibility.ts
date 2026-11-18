import { repoFromPathname } from '@geld/core';

export type RepoVisibility = 'public' | 'private' | 'unknown';

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Whether anyone could see the repository a page belongs to, asked as a
 * stranger: a request for the repository's own page with no cookies. GitHub
 * answers 404 to a private repository then, and an Enterprise host in private
 * mode sends it to its sign-in page. A page that names no repository, a
 * timeout or any other answer is `unknown`, which is treated as private.
 */
export async function repoVisibility(page: URL, fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<RepoVisibility> {
  const repo = repoFromPathname(page.pathname);
  if (repo === null) return 'unknown';
  try {
    const response = await fetcher(`${page.origin}/${repo}`, {
      method: 'HEAD',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return 'private';
    if (!response.ok) return 'unknown';
    const landed = response.url === '' ? null : new URL(response.url);
    if (landed !== null && /^\/(login|session|sessions)\b/.test(landed.pathname)) return 'private';
    return 'public';
  } catch {
    return 'unknown';
  }
}
