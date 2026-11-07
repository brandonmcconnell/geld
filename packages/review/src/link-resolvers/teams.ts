import type { RelatedLink } from '../related-links';
import { capBody, httpFailure, identifyMessage, isResponse, list, readJson, request, text, titleLine } from './http';
import { MESSAGE_CAP, type LinkMessage, type LinkResolver } from './types';

export const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * The delegated Microsoft Graph scopes Geld's Teams app asks for, as the reader: channel messages and replies in the
 * teams they are in (which needs a tenant admin's consent), channel names, their own profile, and a refresh token.
 * Chats are left out.
 */
export const TEAMS_SCOPES = ['offline_access', 'User.Read', 'ChannelMessage.Read.All', 'Channel.ReadBasic.All', 'Team.ReadBasic.All'] as const;

type Target =
  | { readonly kind: 'message'; readonly tenant: string | null; readonly team: string; readonly channel: string; readonly message: string }
  | { readonly kind: 'channel'; readonly tenant: string | null; readonly team: string; readonly channel: string };

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Teams writes a channel message's link as `/l/message/<channel id>/<message id>?tenantId=…&groupId=<team id>&
 * parentMessageId=<root>`, and a channel's as `/l/channel/<channel id>/<name>?groupId=…`. A chat's message carries no
 * team and is not read: Chat.Read is not asked for.
 */
function targetOf(link: RelatedLink): Target | null {
  if (!link.key.startsWith('teams:')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const path = /^\/l\/(message|channel)\/([^/]+)(?:\/([^/]+))?/.exec(url.pathname);
  const team = url.searchParams.get('groupId');
  if (path === null || team === null || !/^[0-9a-f-]{36}$/i.test(team)) return null;
  const channel = decode(path[2] ?? '');
  if (!/^19:[^@]+@thread\.(?:tacv2|skype)$/.test(channel)) return null;
  const tenant = url.searchParams.get('tenantId')?.toLowerCase() ?? null;
  if (path[1] === 'channel') return { kind: 'channel', tenant, team, channel };
  const root = url.searchParams.get('parentMessageId');
  const message = root !== null && /^\d+$/.test(root) && root !== '0' ? root : (path[3] ?? '');
  return /^\d+$/.test(message) ? { kind: 'message', tenant, team, channel, message } : null;
}

/** A Teams message body (HTML) as plain lines: paragraphs and breaks as new lines, tags dropped, entities decoded. */
export function teamsText(html: string): string {
  return html
    .replace(/<at[^>]*>(.*?)<\/at>/gi, '@$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const headers = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

function messageOf(value: unknown): LinkMessage {
  const content = text(value, 'body', 'content') ?? '';
  const html = text(value, 'body', 'contentType') === 'html';
  return {
    author: text(value, 'from', 'user', 'displayName') ?? text(value, 'from', 'application', 'displayName'),
    at: text(value, 'createdDateTime'),
    text: html ? teamsText(content) : content.trim(),
  };
}

export const teamsResolver: LinkResolver = {
  service: 'teams',
  reads: (link) => targetOf(link) !== null,
  workspaceOf: (link) => targetOf(link)?.tenant ?? null,
  hintKeys: (link) => {
    const target = targetOf(link);
    return target === null ? [] : [`teams/${target.team.toLowerCase()}`];
  },
  // Geld's token proxy renews the access, so it is reached too.
  origins: () => ['https://graph.microsoft.com/*', 'https://www.geld.sh/*'],
  async identify(draft, fetch) {
    const me = await request(fetch, `${GRAPH}/me?$select=displayName,userPrincipalName`, { headers: headers(draft.secret) });
    if (!isResponse(me)) return { ok: false, message: 'Microsoft could not be reached' };
    if (!me.ok) return { ok: false, message: identifyMessage(me.status, 'Microsoft') };
    const body = await readJson(me);
    const organization = await request(fetch, `${GRAPH}/organization?$select=id,displayName`, { headers: headers(draft.secret) });
    const org = isResponse(organization) && organization.ok ? list(await readJson(organization), 'value')[0] : undefined;
    const tenant = text(org, 'id');
    return {
      ok: true,
      identity: {
        account: text(body, 'userPrincipalName') ?? text(body, 'displayName') ?? 'Microsoft account',
        covers: tenant === null ? [] : [tenant.toLowerCase()],
        suggestedLabel: text(org, 'displayName'),
        host: null,
      },
    };
  },
  async resolve(link, connection, fetch) {
    const target = targetOf(link);
    if (target === null) return { status: 'unsupported' };
    const channelPath = `${GRAPH}/teams/${encodeURIComponent(target.team)}/channels/${encodeURIComponent(target.channel)}`;
    const channel = await request(fetch, `${channelPath}?$select=displayName,description`, { headers: headers(connection.secret) });
    if (!isResponse(channel)) return channel;
    if (!channel.ok) return httpFailure(channel);
    const channelBody = await readJson(channel);
    const where = text(channelBody, 'displayName');
    if (target.kind === 'channel') {
      return {
        status: 'ok',
        details: { title: where === null ? 'Teams channel' : where, state: null, tone: null, author: null, updatedAt: null, where: null, body: capBody(text(channelBody, 'description')), messages: [] },
      };
    }
    const root = await request(fetch, `${channelPath}/messages/${target.message}`, { headers: headers(connection.secret) });
    if (!isResponse(root)) return root;
    if (!root.ok) return httpFailure(root);
    const first = messageOf(await readJson(root));
    const replies = await request(fetch, `${channelPath}/messages/${target.message}/replies?$top=${MESSAGE_CAP - 1}`, { headers: headers(connection.secret) });
    const replyList = isResponse(replies) && replies.ok ? list(await readJson(replies), 'value').map(messageOf) : [];
    const ordered = [...replyList].sort((a, b) => Date.parse(a.at ?? '') - Date.parse(b.at ?? ''));
    const messages = [first, ...ordered].slice(0, MESSAGE_CAP);
    const count = replyList.length;
    return {
      status: 'ok',
      details: {
        title: titleLine(first.text) || 'Teams message',
        state: count > 0 ? `${count}${count >= MESSAGE_CAP - 1 ? '+' : ''} ${count === 1 ? 'reply' : 'replies'}` : null,
        tone: count > 0 ? 'neutral' : null,
        author: first.author,
        updatedAt: messages[messages.length - 1]?.at ?? first.at,
        where: where === null ? null : `#${where}`,
        body: null,
        messages,
      },
    };
  },
};
