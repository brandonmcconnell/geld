import type { RelatedLink } from '../related-links';
import { at, capBody, failed, isResponse, list, readJson, request, text, titleLine } from './http';
import { MESSAGE_CAP, type FetchLike, type LinkMessage, type LinkResolver, type Resolution } from './types';

export const SLACK_API = 'https://slack.com/api';

/**
 * The scopes Geld's Slack app asks for, as the reader: public and private channels they are in, their names, and
 * people's names. Direct messages are left out.
 */
export const SLACK_USER_SCOPES = ['channels:history', 'groups:history', 'channels:read', 'groups:read', 'users:read'] as const;

/** The methods Slack limits to about one call a minute per workspace for apps not yet in its Marketplace. */
export const SLACK_LIMITED_METHODS = ['conversations.replies', 'conversations.history'] as const;

type Target = { readonly workspace: string; readonly channel: string; readonly ts: string | null };

function targetOf(link: RelatedLink): Target | null {
  if (!link.key.startsWith('slack:')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const client = /^\/client\/(T[A-Z0-9]+)\/([CGZ][A-Z0-9]{6,})(?:\/thread\/[CGZ][A-Z0-9]{6,}-(\d{10}\.\d{6}))?\/?$/.exec(url.pathname);
  if (url.hostname === 'app.slack.com' && client !== null) return { workspace: (client[1] ?? '').toLowerCase(), channel: client[2] ?? '', ts: client[3] ?? null };
  const archive = /^\/archives\/([CGZ][A-Z0-9]{6,})(?:\/p(\d{10})(\d{6}))?\/?$/.exec(url.pathname);
  const host = /^([a-z0-9][a-z0-9-]*)(?:\.enterprise)?\.slack\.com$/.exec(url.hostname);
  if (archive === null || host === null || host[1] === 'app') return null;
  const thread = url.searchParams.get('thread_ts');
  const ts = archive[2] === undefined ? null : `${archive[2]}.${archive[3] ?? ''}`;
  return { workspace: (host[1] ?? '').toLowerCase(), channel: archive[1] ?? '', ts: thread !== null && /^\d{10}\.\d{6}$/.test(thread) ? thread : ts };
}

const headers = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** What a Slack error means for a link: Slack answers 200 with `ok: false` and a code. */
export function slackFailure(code: string | null, response?: Response): Resolution {
  if (code === 'ratelimited' || response?.status === 429) {
    const seconds = Number(response?.headers.get('retry-after') ?? '60');
    return failed('rate-limited', 'Slack asked Geld to wait before reading more', Number.isFinite(seconds) ? seconds * 1000 : 60_000);
  }
  if (code === 'invalid_auth' || code === 'not_authed' || code === 'token_revoked' || code === 'token_expired' || code === 'account_inactive') return failed('unauthorized', 'Slack refused this connection');
  if (code === 'channel_not_found' || code === 'not_in_channel' || code === 'thread_not_found' || code === 'missing_scope' || code === 'access_denied') return { status: 'no-access' };
  return failed('invalid', code === null ? 'Slack did not answer' : `Slack answered ${code}`);
}

async function call(fetch: FetchLike, token: string, method: string, params: Readonly<Record<string, string>>): Promise<{ readonly body: unknown } | Resolution> {
  const response = await request(fetch, `${SLACK_API}/${method}?${new URLSearchParams(params)}`, { headers: headers(token) });
  if (!isResponse(response)) return response;
  if (response.status === 429) return slackFailure('ratelimited', response);
  const body = await readJson(response);
  if (body === null || typeof body !== 'object' || !('ok' in body) || body.ok !== true) return slackFailure(text(body, 'error'), response);
  return { body };
}

const isAnswer = (value: { readonly body: unknown } | Resolution): value is { readonly body: unknown } => 'body' in value;

/** Slack's message markup as plain words: mentions by name, links by their label, the entities decoded. */
export function slackText(markup: string, names: ReadonlyMap<string, string> = new Map()): string {
  return markup
    .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (_all, id: string, label: string | undefined) => `@${label ?? names.get(id) ?? 'someone'}`)
    .replace(/<#[CG][A-Z0-9]+\|([^>]*)>/g, (_all, name: string) => `#${name}`)
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, '$1')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function names(fetch: FetchLike, token: string, ids: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const id of ids.slice(0, 8)) {
    const answer = await call(fetch, token, 'users.info', { user: id });
    if (!isAnswer(answer)) continue;
    const name = text(answer.body, 'user', 'profile', 'display_name') ?? text(answer.body, 'user', 'real_name') ?? text(answer.body, 'user', 'name');
    if (name !== null) found.set(id, name);
  }
  return found;
}

const timeOf = (ts: string | null): string | null => {
  const seconds = Number(ts);
  return ts === null || !Number.isFinite(seconds) ? null : new Date(seconds * 1000).toISOString();
};

export const slackResolver: LinkResolver = {
  service: 'slack',
  reads: (link) => targetOf(link) !== null,
  workspaceOf: (link) => targetOf(link)?.workspace ?? null,
  hintKeys: (link) => {
    const target = targetOf(link);
    return target === null ? [] : [`slack/${target.workspace}`];
  },
  origins: () => ['https://slack.com/*'],
  async identify(draft, fetch) {
    const answer = await call(fetch, draft.secret, 'auth.test', {});
    if (!isAnswer(answer)) return { ok: false, message: answer.status === 'failed' ? (answer.message ?? 'Slack could not be reached') : 'Slack did not accept this sign-in' };
    const team = text(answer.body, 'team_id');
    const domain = /^https:\/\/([a-z0-9-]+)(?:\.enterprise)?\.slack\.com\/?$/.exec(text(answer.body, 'url') ?? '')?.[1] ?? null;
    if (team === null) return { ok: false, message: 'Slack did not say which workspace this is' };
    return {
      ok: true,
      identity: { account: text(answer.body, 'user') ?? team, covers: [team.toLowerCase(), ...(domain === null ? [] : [domain])], suggestedLabel: text(answer.body, 'team'), host: null },
    };
  },
  async resolve(link, connection, fetch) {
    const target = targetOf(link);
    if (target === null) return { status: 'unsupported' };
    const info = await call(fetch, connection.secret, 'conversations.info', { channel: target.channel });
    if (!isAnswer(info)) return info;
    const channel = text(info.body, 'channel', 'name');
    const where = channel === null ? null : `#${channel}`;
    if (target.ts === null) {
      return {
        status: 'ok',
        details: {
          title: where ?? 'Slack channel',
          state: null,
          tone: null,
          author: null,
          updatedAt: null,
          where: null,
          body: capBody(text(info.body, 'channel', 'purpose', 'value') ?? text(info.body, 'channel', 'topic', 'value')),
          messages: [],
        },
      };
    }
    const replies = await call(fetch, connection.secret, 'conversations.replies', { channel: target.channel, ts: target.ts, limit: String(MESSAGE_CAP), inclusive: 'true' });
    if (!isAnswer(replies)) return replies;
    const raw = list(replies.body, 'messages');
    if (raw.length === 0) return { status: 'no-access' };
    const authors = [...new Set(raw.map((message) => text(message, 'user')).filter((id): id is string => id !== null))];
    const mentioned = raw.flatMap((message) => [...(text(message, 'text') ?? '').matchAll(/<@([UW][A-Z0-9]+)>/g)].map((match) => match[1] ?? ''));
    const people = await names(fetch, connection.secret, [...new Set([...authors, ...mentioned])]);
    const messages: LinkMessage[] = raw.slice(0, MESSAGE_CAP).map((message) => {
      const user = text(message, 'user');
      return {
        author: (user === null ? null : (people.get(user) ?? null)) ?? text(message, 'username') ?? text(message, 'bot_profile', 'name'),
        at: timeOf(text(message, 'ts')),
        text: slackText(text(message, 'text') ?? '', people),
      };
    });
    const first = messages[0];
    const count = Number(at(raw[0], 'reply_count') ?? 0);
    return {
      status: 'ok',
      details: {
        title: titleLine(first?.text ?? '') || 'Slack message',
        state: count > 0 ? `${count} ${count === 1 ? 'reply' : 'replies'}` : null,
        tone: count > 0 ? 'neutral' : null,
        author: first?.author ?? null,
        updatedAt: timeOf(text(raw[0], 'latest_reply')) ?? first?.at ?? null,
        where,
        body: null,
        messages,
      },
    };
  },
};

