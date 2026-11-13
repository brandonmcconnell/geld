import type { RelatedLink } from '../related-links';
import { at, capBody, hostOf, httpFailure, identifyMessage, isResponse, readJson, request, text } from './http';
import type { Connection, DetailsTone, LinkResolver } from './types';

type Target = { readonly host: string; readonly project: string; readonly kind: 'issues' | 'merge_requests' | 'work_items' | 'epics'; readonly iid: string };

function targetOf(link: RelatedLink): Target | null {
  if (!link.key.startsWith('gitlab:')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const path = /^\/((?:[\w.-]+\/)*[\w.-]+)\/-\/(issues|merge_requests|work_items|epics)\/(\d+)\/?$/.exec(url.pathname);
  if (path === null) return null;
  const kind = path[2];
  if (kind !== 'issues' && kind !== 'merge_requests' && kind !== 'work_items' && kind !== 'epics') return null;
  return { host: url.hostname.toLowerCase(), project: (path[1] ?? '').replace(/^groups\//, ''), kind, iid: path[3] ?? '' };
}

const connectionHost = (connection: Pick<Connection, 'host'>): string => hostOf(connection.host, 'gitlab.com');

const TONES: Readonly<Record<string, DetailsTone>> = { opened: 'open', merged: 'done', closed: 'closed', locked: 'closed' };
const STATES: Readonly<Record<string, string>> = { opened: 'Open', merged: 'Merged', closed: 'Closed', locked: 'Locked' };

export const gitlabResolver: LinkResolver = {
  service: 'gitlab',
  reads: (link) => targetOf(link) !== null,
  workspaceOf: (link) => targetOf(link)?.host ?? null,
  hintKeys: (link) => {
    const target = targetOf(link);
    return target === null ? [] : [`gitlab/${target.host}/${target.project.toLowerCase()}`, `gitlab/${target.host}/${(target.project.split('/')[0] ?? '').toLowerCase()}`];
  },
  origins: (connection) => [`https://${connectionHost(connection)}/*`],
  async identify(draft, fetch) {
    const host = hostOf(draft.host, 'gitlab.com');
    const response = await request(fetch, `https://${host}/api/v4/user`, { headers: { 'PRIVATE-TOKEN': draft.secret } });
    if (!isResponse(response)) return { ok: false, message: response.status === 'failed' ? (response.message ?? 'GitLab could not be reached') : 'GitLab could not be reached' };
    if (!response.ok) return { ok: false, message: identifyMessage(response.status, 'GitLab') };
    const username = text(await readJson(response), 'username');
    if (username === null) return { ok: false, message: 'GitLab did not say whose token this is' };
    return { ok: true, identity: { account: username, covers: [host], suggestedLabel: host === 'gitlab.com' ? username : host, host: host === 'gitlab.com' ? null : host } };
  },
  async resolve(link, connection, fetch) {
    const target = targetOf(link);
    if (target === null || target.host !== connectionHost(connection)) return { status: 'unsupported' };
    if (target.kind === 'epics') return { status: 'unsupported' };
    const kind = target.kind === 'work_items' ? 'issues' : target.kind;
    const url = `https://${target.host}/api/v4/projects/${encodeURIComponent(target.project)}/${kind}/${target.iid}`;
    const response = await request(fetch, url, { headers: { 'PRIVATE-TOKEN': connection.secret } });
    if (!isResponse(response)) return response;
    if (!response.ok) return httpFailure(response);
    const body = await readJson(response);
    const title = text(body, 'title');
    if (title === null) return { status: 'no-access' };
    const state = text(body, 'state');
    const draft = kind === 'merge_requests' && state === 'opened' && at(body, 'draft') === true;
    return {
      status: 'ok',
      details: {
        title,
        state: draft ? 'Draft' : state === null ? null : (STATES[state] ?? state),
        tone: draft ? 'draft' : state === null ? null : (TONES[state] ?? 'neutral'),
        author: text(body, 'author', 'username'),
        updatedAt: text(body, 'updated_at'),
        where: text(body, 'references', 'full') ?? `${target.project}${kind === 'merge_requests' ? '!' : '#'}${target.iid}`,
        body: capBody(text(body, 'description')),
        messages: [],
      },
    };
  },
};
