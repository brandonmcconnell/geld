import type { RelatedLink } from '../related-links';
import { at, capBody, hostOf, httpFailure, identifyMessage, isResponse, readJson, request, text } from './http';
import type { Connection, LinkDetails, LinkResolver } from './types';

type Target = { readonly host: string; readonly owner: string; readonly repo: string; readonly number: string; readonly discussion: boolean };

function targetOf(link: RelatedLink): Target | null {
  if (!link.key.startsWith('github:')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const path = /^\/([\w.-]+)\/([\w.-]+)\/(issues|pull|discussions)\/(\d+)(?:\/|$)/.exec(url.pathname);
  if (path === null) return null;
  return { host: url.hostname.toLowerCase(), owner: path[1] ?? '', repo: path[2] ?? '', number: path[4] ?? '', discussion: path[3] === 'discussions' };
}

const apiBase = (host: string): string => (host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`);
const graphqlUrl = (host: string): string => (host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`);

const headers = (secret: string): Record<string, string> => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${secret}`, 'X-GitHub-Api-Version': '2022-11-28' });

const connectionHost = (connection: Pick<Connection, 'host'>): string => hostOf(connection.host, 'github.com');

function issueDetails(body: unknown, target: Target, merged: boolean): LinkDetails | null {
  const title = text(body, 'title');
  if (title === null) return null;
  const pull = text(body, 'pull_request', 'url') !== null;
  const draft = at(body, 'draft') === true;
  const open = text(body, 'state') === 'open';
  const reason = text(body, 'state_reason');
  const state = pull ? (merged ? 'Merged' : open ? (draft ? 'Draft' : 'Open') : 'Closed') : open ? 'Open' : reason === 'not_planned' ? 'Closed as not planned' : 'Closed';
  return {
    title,
    state,
    tone: merged ? 'done' : open ? (draft ? 'draft' : 'open') : pull || reason === 'not_planned' ? 'closed' : 'done',
    author: text(body, 'user', 'login'),
    updatedAt: text(body, 'updated_at'),
    where: `${target.owner}/${target.repo}#${target.number}`,
    body: capBody(text(body, 'body')),
    messages: [],
  };
}

export const githubResolver: LinkResolver = {
  service: 'github',
  reads: (link) => targetOf(link) !== null,
  workspaceOf: (link) => targetOf(link)?.host ?? null,
  hintKeys: (link) => {
    const target = targetOf(link);
    if (target === null) return [];
    const owner = `github/${target.host}/${target.owner.toLowerCase()}`;
    return [`${owner}/${target.repo.toLowerCase()}`, owner];
  },
  origins: (connection) => {
    const host = connectionHost(connection);
    return host === 'github.com' ? ['https://api.github.com/*'] : [`https://${host}/*`];
  },
  async identify(draft, fetch) {
    const host = hostOf(draft.host, 'github.com');
    const response = await request(fetch, `${apiBase(host)}/user`, { headers: headers(draft.secret) });
    if (!isResponse(response)) return { ok: false, message: response.status === 'failed' ? (response.message ?? 'GitHub could not be reached') : 'GitHub could not be reached' };
    if (!response.ok) return { ok: false, message: identifyMessage(response.status, 'GitHub') };
    const login = text(await readJson(response), 'login');
    if (login === null) return { ok: false, message: 'GitHub did not say whose token this is' };
    // A token reaches every repository its account can, so the link's host is the only thing it is chosen by.
    return { ok: true, identity: { account: login, covers: [host], suggestedLabel: login, host: host === 'github.com' ? null : host } };
  },
  async resolve(link, connection, fetch) {
    const target = targetOf(link);
    if (target === null || target.host !== connectionHost(connection)) return { status: 'unsupported' };
    if (target.discussion) {
      const query = 'query GeldDiscussion($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { discussion(number: $number) { title body updatedAt closed answerChosenAt author { login } category { name } } } }';
      const response = await request(fetch, graphqlUrl(target.host), {
        method: 'POST',
        headers: { ...headers(connection.secret), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { owner: target.owner, repo: target.repo, number: Number(target.number) } }),
      });
      if (!isResponse(response)) return response;
      if (!response.ok) return httpFailure(response);
      const body = await readJson(response);
      const discussion = (...path: string[]): string | null => text(body, 'data', 'repository', 'discussion', ...path);
      const title = discussion('title');
      if (title === null) return { status: 'no-access' };
      const answered = discussion('answerChosenAt') !== null;
      return {
        status: 'ok',
        details: {
          title,
          state: answered ? 'Answered' : null,
          tone: answered ? 'done' : null,
          author: discussion('author', 'login'),
          updatedAt: discussion('updatedAt'),
          where: [`${target.owner}/${target.repo}`, discussion('category', 'name')].filter((part) => part !== null).join(' · '),
          body: capBody(discussion('body')),
          messages: [],
        },
      };
    }
    const base = `${apiBase(target.host)}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
    const response = await request(fetch, `${base}/issues/${target.number}`, { headers: headers(connection.secret) });
    if (!isResponse(response)) return response;
    if (!response.ok) return httpFailure(response);
    const body = await readJson(response);
    const merged = text(body, 'pull_request', 'merged_at') !== null;
    const details = issueDetails(body, target, merged);
    return details === null ? { status: 'no-access' } : { status: 'ok', details };
  },
};
