import type { RelatedLink } from '../related-links';
import { at, basicAuth, capBody, hostOf, httpFailure, identifyMessage, isResponse, list, readJson, record, request, text } from './http';
import type { Connection, ConnectionDraft, DetailsTone, LinkResolver } from './types';

function hostnameOf(link: RelatedLink): string | null {
  try {
    return new URL(link.href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function keyOf(link: RelatedLink): string | null {
  return link.key.startsWith('jira:') && link.ref !== null && /^[A-Z][A-Z0-9_]*-\d+$/.test(link.ref) ? link.ref : null;
}

const isCloud = (host: string): boolean => host.endsWith('.atlassian.net');

/** Jira Cloud pairs an API token with the account's email; a self-hosted Jira takes a personal access token alone. */
function headers(connection: Pick<Connection | ConnectionDraft, 'secret' | 'email'>): Record<string, string> {
  const email = connection.email?.trim() ?? '';
  return {
    Accept: 'application/json',
    Authorization: email === '' ? `Bearer ${connection.secret}` : basicAuth(email, connection.secret),
  };
}

const apiBase = (host: string): string => `https://${host}/rest/api/${isCloud(host) ? '3' : '2'}`;

/** Atlassian Document Format, the Cloud API's description, as plain text: one line per block. */
export function adfText(node: unknown): string {
  const value = record(node);
  if (value === null) return typeof node === 'string' ? node : '';
  if (value.type === 'text') return typeof value.text === 'string' ? value.text : '';
  if (value.type === 'hardBreak') return '\n';
  if (value.type === 'mention') return text(value, 'attrs', 'text') ?? '';
  const inner = list(value, 'content').map(adfText).join('');
  const blocks = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'rule', 'panel', 'tableRow']);
  return typeof value.type === 'string' && blocks.has(value.type) ? `${inner}\n` : inner;
}

const TONES: Readonly<Record<string, DetailsTone>> = { new: 'neutral', indeterminate: 'open', done: 'done' };

export const jiraResolver: LinkResolver = {
  service: 'jira',
  reads: (link) => keyOf(link) !== null,
  workspaceOf: hostnameOf,
  hintKeys: (link) => {
    const host = hostnameOf(link);
    return host === null ? [] : [`jira/${host}`];
  },
  origins: (connection) => (connection.host === null ? [] : [`https://${connection.host}/*`]),
  async identify(draft, fetch) {
    if (draft.host === null || draft.host.trim() === '') return { ok: false, message: 'Add the Jira site, such as acme.atlassian.net' };
    const host = hostOf(draft.host, '');
    if (isCloud(host) && (draft.email ?? '').trim() === '') return { ok: false, message: 'Jira Cloud needs the email of the account the token belongs to' };
    const response = await request(fetch, `${apiBase(host)}/myself`, { headers: headers(draft) });
    if (!isResponse(response)) return { ok: false, message: response.status === 'failed' ? (response.message ?? 'Jira could not be reached') : 'Jira could not be reached' };
    if (!response.ok) return { ok: false, message: identifyMessage(response.status, 'Jira') };
    const body = await readJson(response);
    return {
      ok: true,
      identity: { account: text(body, 'emailAddress') ?? text(body, 'displayName') ?? text(body, 'name') ?? host, covers: [host], suggestedLabel: host.replace(/\.atlassian\.net$/, ''), host },
    };
  },
  async resolve(link, connection, fetch) {
    const key = keyOf(link);
    const host = hostnameOf(link);
    if (key === null || host === null) return { status: 'unsupported' };
    const fields = 'summary,status,reporter,updated,description,project';
    const response = await request(fetch, `${apiBase(host)}/issue/${encodeURIComponent(key)}?fields=${fields}`, { headers: headers(connection) });
    if (!isResponse(response)) return response;
    if (!response.ok) return httpFailure(response);
    const body = await readJson(response);
    const title = text(body, 'fields', 'summary');
    if (title === null) return { status: 'no-access' };
    const raw = at(body, 'fields', 'description');
    const description = typeof raw === 'string' ? raw : raw === null || raw === undefined ? null : adfText(raw);
    const category = text(body, 'fields', 'status', 'statusCategory', 'key');
    return {
      status: 'ok',
      details: {
        title,
        state: text(body, 'fields', 'status', 'name'),
        tone: category === null ? null : (TONES[category] ?? 'neutral'),
        author: text(body, 'fields', 'reporter', 'displayName'),
        updatedAt: text(body, 'fields', 'updated'),
        where: [key, text(body, 'fields', 'project', 'name')].filter((part) => part !== null).join(' · '),
        body: capBody(description),
        messages: [],
      },
    };
  },
};
