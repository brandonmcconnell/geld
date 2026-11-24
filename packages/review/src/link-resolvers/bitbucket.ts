import type { RelatedLink } from '../related-links';
import { at, basicAuth, capBody, httpFailure, identifyMessage, isResponse, readJson, request, text } from './http';
import type { Connection, ConnectionDraft, DetailsTone, LinkResolver } from './types';

const API = 'https://api.bitbucket.org/2.0';

type Target = { readonly workspace: string; readonly repo: string; readonly kind: 'issues' | 'pullrequests'; readonly id: string };

function targetOf(link: RelatedLink): Target | null {
  if (!link.key.startsWith('bitbucket:')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const path = /^\/([\w.-]+)\/([\w.-]+)\/(issues|pull-requests)\/(\d+)(?:\/|$)/.exec(url.pathname);
  if (path === null) return null;
  return { workspace: path[1] ?? '', repo: path[2] ?? '', kind: path[3] === 'issues' ? 'issues' : 'pullrequests', id: path[4] ?? '' };
}

/** An Atlassian API token goes with the account's email; a legacy app password with the Bitbucket username. */
function headers(connection: Pick<Connection | ConnectionDraft, 'secret' | 'email'>): Record<string, string> {
  const user = connection.email?.trim() ?? '';
  return { Accept: 'application/json', Authorization: user === '' ? `Bearer ${connection.secret}` : basicAuth(user, connection.secret) };
}

const PULL_TONES: Readonly<Record<string, DetailsTone>> = { OPEN: 'open', MERGED: 'done', DECLINED: 'closed', SUPERSEDED: 'closed' };
const ISSUE_TONES: Readonly<Record<string, DetailsTone>> = {
  new: 'open',
  open: 'open',
  submitted: 'open',
  'on hold': 'neutral',
  resolved: 'done',
  closed: 'done',
  invalid: 'closed',
  duplicate: 'closed',
  wontfix: 'closed',
};

const capitalized = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export const bitbucketResolver: LinkResolver = {
  service: 'bitbucket',
  reads: (link) => targetOf(link) !== null,
  workspaceOf: (link) => targetOf(link)?.workspace.toLowerCase() ?? null,
  hintKeys: (link) => {
    const target = targetOf(link);
    return target === null ? [] : [`bitbucket/${target.workspace.toLowerCase()}/${target.repo.toLowerCase()}`, `bitbucket/${target.workspace.toLowerCase()}`];
  },
  origins: () => ['https://api.bitbucket.org/*'],
  async identify(draft, fetch) {
    const response = await request(fetch, `${API}/user`, { headers: headers(draft) });
    if (!isResponse(response)) return { ok: false, message: response.status === 'failed' ? (response.message ?? 'Bitbucket could not be reached') : 'Bitbucket could not be reached' };
    if (!response.ok) return { ok: false, message: identifyMessage(response.status, 'Bitbucket') };
    const body = await readJson(response);
    const account = text(body, 'username') ?? text(body, 'display_name');
    if (account === null) return { ok: false, message: 'Bitbucket did not say whose token this is' };
    // Workspaces are not listed for an API token without the workspace scope, so every Bitbucket link may try this one.
    return { ok: true, identity: { account, covers: [], suggestedLabel: text(body, 'display_name'), host: null } };
  },
  async resolve(link, connection, fetch) {
    const target = targetOf(link);
    if (target === null) return { status: 'unsupported' };
    const url = `${API}/repositories/${encodeURIComponent(target.workspace)}/${encodeURIComponent(target.repo)}/${target.kind}/${target.id}`;
    const response = await request(fetch, url, { headers: headers(connection) });
    if (!isResponse(response)) return response;
    if (!response.ok) return httpFailure(response);
    const body = await readJson(response);
    const title = text(body, 'title');
    if (title === null) return { status: 'no-access' };
    const state = text(body, 'state');
    const pull = target.kind === 'pullrequests';
    const draft = pull && state === 'OPEN' && at(body, 'draft') === true;
    return {
      status: 'ok',
      details: {
        title,
        state: draft ? 'Draft' : state === null ? null : capitalized(state),
        tone: draft ? 'draft' : state === null ? null : ((pull ? PULL_TONES[state] : ISSUE_TONES[state]) ?? 'neutral'),
        author: text(body, pull ? 'author' : 'reporter', 'display_name'),
        updatedAt: text(body, 'updated_on'),
        where: `${target.workspace}/${target.repo}#${target.id}`,
        body: capBody(text(body, pull ? 'description' : 'content', ...(pull ? [] : ['raw'])) ?? text(body, 'summary', 'raw')),
        messages: [],
      },
    };
  },
};
