import type { RelatedLink } from '../related-links';
import { at, capBody, failed, httpFailure, identifyMessage, isResponse, list, readJson, request, text } from './http';
import type { DetailsTone, FetchLike, LinkResolver, Resolution } from './types';

const API = 'https://api.linear.app/graphql';

type Target = { readonly workspace: string; readonly kind: 'issue' | 'project' | 'document'; readonly id: string };

function targetOf(link: RelatedLink): Target | null {
  if (!link.key.startsWith('linear:')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const issue = /^\/([\w-]+)\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+|[0-9a-f-]{36})(?:\/|$)/.exec(url.pathname);
  if (issue !== null) {
    const id = issue[2] ?? '';
    return { workspace: issue[1] ?? '', kind: 'issue', id: /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : id.toUpperCase() };
  }
  const other = /^\/([\w-]+)\/(project|document)\/(?:[\w%.~-]*-)?([0-9a-f]{12})(?:\/|$)/.exec(url.pathname);
  if (other !== null) return { workspace: other[1] ?? '', kind: other[2] === 'project' ? 'project' : 'document', id: other[3] ?? '' };
  return null;
}

/** A personal API key goes as is; an OAuth token takes the Bearer scheme. */
function authorization(secret: string): string {
  return secret.startsWith('lin_api_') ? secret : `Bearer ${secret}`;
}

const TONES: Readonly<Record<string, DetailsTone>> = {
  triage: 'neutral',
  backlog: 'neutral',
  unstarted: 'neutral',
  started: 'open',
  completed: 'done',
  canceled: 'closed',
  duplicate: 'closed',
};

const QUERIES = {
  issue: `query GeldIssue($id: String!) { issue(id: $id) { identifier title description updatedAt state { name type } creator { name } team { name } } }`,
  project: `query GeldProject($id: String!) { project(id: $id) { name description updatedAt state creator { name } } }`,
  document: `query GeldDocument($id: String!) { document(id: $id) { title content updatedAt creator { name } project { name } } }`,
} as const;

async function graphql(fetch: FetchLike, secret: string, query: string, variables: Readonly<Record<string, string>>): Promise<Response | Resolution> {
  return request(fetch, API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization(secret) },
    body: JSON.stringify({ query, variables }),
  });
}

function graphqlFailure(body: unknown): Resolution | null {
  const errors = list(body, 'errors');
  if (errors.length === 0) return null;
  const codes = errors.map((error) => text(error, 'extensions', 'code') ?? text(error, 'extensions', 'type') ?? '');
  const message = text(errors[0], 'message');
  if (codes.some((code) => /AUTHENTICATION/i.test(code))) return failed('unauthorized', message);
  if (codes.some((code) => /RATELIMITED/i.test(code))) return failed('rate-limited', message, 60_000);
  if (codes.some((code) => /FORBIDDEN|NOT_FOUND|INVALID_INPUT/i.test(code)) || /not found|entity/i.test(message ?? '')) return { status: 'no-access' };
  return failed('invalid', message);
}

export const linearResolver: LinkResolver = {
  service: 'linear',
  reads: (link) => targetOf(link) !== null,
  workspaceOf: (link) => targetOf(link)?.workspace.toLowerCase() ?? null,
  hintKeys: (link) => {
    const target = targetOf(link);
    return target === null ? [] : [`linear/${target.workspace.toLowerCase()}`];
  },
  origins: () => ['https://api.linear.app/*'],
  async identify(draft, fetch) {
    const response = await graphql(fetch, draft.secret, 'query GeldViewer { viewer { name email organization { name urlKey } } }', {});
    if (!isResponse(response)) return { ok: false, message: response.status === 'failed' ? (response.message ?? 'Linear could not be reached') : 'Linear could not be reached' };
    if (!response.ok) return { ok: false, message: identifyMessage(response.status, 'Linear') };
    const body = await readJson(response);
    const urlKey = text(body, 'data', 'viewer', 'organization', 'urlKey');
    if (urlKey === null) return { ok: false, message: text(list(body, 'errors')[0], 'message') ?? 'Linear did not say which workspace this key is for' };
    return {
      ok: true,
      identity: {
        account: text(body, 'data', 'viewer', 'email') ?? text(body, 'data', 'viewer', 'name') ?? urlKey,
        covers: [urlKey.toLowerCase()],
        suggestedLabel: text(body, 'data', 'viewer', 'organization', 'name'),
        host: null,
      },
    };
  },
  async resolve(link, connection, fetch) {
    const target = targetOf(link);
    if (target === null) return { status: 'unsupported' };
    const response = await graphql(fetch, connection.secret, QUERIES[target.kind], { id: target.id });
    if (!isResponse(response)) return response;
    if (!response.ok && response.status !== 400) return httpFailure(response);
    const body = await readJson(response);
    const failure = graphqlFailure(body);
    if (failure !== null) return failure;
    const node = at(body, 'data', target.kind);
    if (node === null || node === undefined) return { status: 'no-access' };
    if (target.kind === 'issue') {
      const title = text(node, 'title');
      if (title === null) return { status: 'no-access' };
      const stateType = text(node, 'state', 'type');
      return {
        status: 'ok',
        details: {
          title,
          state: text(node, 'state', 'name'),
          tone: stateType === null ? null : (TONES[stateType] ?? 'neutral'),
          author: text(node, 'creator', 'name'),
          updatedAt: text(node, 'updatedAt'),
          where: [text(node, 'identifier'), text(node, 'team', 'name')].filter((part) => part !== null).join(' · ') || null,
          body: capBody(text(node, 'description')),
          messages: [],
        },
      };
    }
    const title = text(node, target.kind === 'project' ? 'name' : 'title');
    if (title === null) return { status: 'no-access' };
    const state = target.kind === 'project' ? text(node, 'state') : null;
    return {
      status: 'ok',
      details: {
        title,
        state: state === null ? null : state.charAt(0).toUpperCase() + state.slice(1),
        tone: state === null ? null : state === 'completed' ? 'done' : state === 'canceled' ? 'closed' : state === 'started' ? 'open' : 'neutral',
        author: text(node, 'creator', 'name'),
        updatedAt: text(node, 'updatedAt'),
        where: target.kind === 'document' ? text(node, 'project', 'name') : null,
        body: capBody(text(node, target.kind === 'project' ? 'description' : 'content')),
        messages: [],
      },
    };
  },
};
