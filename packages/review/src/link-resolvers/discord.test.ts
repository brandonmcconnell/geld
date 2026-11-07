import { describe, expect, it } from 'vitest';
import { relatedLinkOf, type RelatedLink } from '../related-links';
import { canRead, channelPermissions, discordTargetOf, resolveDiscordAsBot } from './discord';
import { resolverFor, type Connection, type FetchLike } from './index';

function linkOf(href: string): RelatedLink {
  const link = relatedLinkOf({ href, text: '' });
  if (link === null) throw new Error(href);
  return link;
}

const GUILD = '613425648685547541';
const CHANNEL = '1000000000000000001';
const THREAD = '1000000000000000009';
const MESSAGE = '1000000000000000042';
const USER = '200000000000000001';
const ROLE = '300000000000000001';
const VIEW_AND_HISTORY = String((1n << 10n) | (1n << 16n));

describe('channelPermissions', () => {
  const base = { guildId: GUILD, ownerId: '9', userId: USER, memberRoles: [ROLE], roles: [{ id: GUILD, permissions: VIEW_AND_HISTORY }, { id: ROLE, permissions: '0' }], overwrites: [] };

  it('lets @everyone read a channel nobody closed', () => {
    expect(canRead(channelPermissions(base))).toBe(true);
  });

  it('applies @everyone, then roles together, then the member, as Discord does', () => {
    const closed = [{ id: GUILD, type: 0, allow: '0', deny: String(1n << 10n) }];
    expect(canRead(channelPermissions({ ...base, overwrites: closed }))).toBe(false);
    expect(canRead(channelPermissions({ ...base, overwrites: [...closed, { id: ROLE, type: 0, allow: String(1n << 10n), deny: '0' }] }))).toBe(true);
    expect(canRead(channelPermissions({ ...base, overwrites: [...closed, { id: ROLE, type: 0, allow: String(1n << 10n), deny: '0' }, { id: USER, type: 1, allow: '0', deny: String(1n << 10n) }] }))).toBe(false);
  });

  it('gives the owner and an administrator everything', () => {
    const closed = [{ id: GUILD, type: 0, allow: '0', deny: VIEW_AND_HISTORY }];
    expect(canRead(channelPermissions({ ...base, ownerId: USER, overwrites: closed }))).toBe(true);
    expect(canRead(channelPermissions({ ...base, roles: [{ id: GUILD, permissions: '0' }, { id: ROLE, permissions: String(1n << 3n) }], overwrites: closed }))).toBe(true);
  });
});

describe('discordTargetOf', () => {
  it('reads a message, a thread and a channel, and never a direct message', () => {
    expect(discordTargetOf(linkOf(`https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`))).toEqual({ guild: GUILD, channel: CHANNEL, message: MESSAGE });
    expect(discordTargetOf(linkOf(`https://discord.com/channels/${GUILD}/${CHANNEL}/threads/${THREAD}`))).toEqual({ guild: GUILD, channel: THREAD, message: null });
    expect(discordTargetOf(linkOf(`https://discord.com/channels/${GUILD}/${CHANNEL}`))).toEqual({ guild: GUILD, channel: CHANNEL, message: null });
    expect(discordTargetOf(linkOf(`https://discord.com/channels/@me/${CHANNEL}/${MESSAGE}`))).toBeNull();
  });
});

function discord(answers: Readonly<Record<string, { status?: number; body?: unknown }>>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace('https://discord.com/api/v10', '');
    calls.push(`${new Headers(init?.headers).get('Authorization')?.split(' ')[0] ?? ''} ${path}`);
    const answer = answers[path] ?? { status: 404 };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  };
  return { fetch, calls };
}

const world = {
  '/users/@me': { body: { id: USER, username: 'ada' } },
  [`/guilds/${GUILD}`]: { body: { owner_id: '9', name: 'Acme', roles: [{ id: GUILD, permissions: VIEW_AND_HISTORY }] } },
  [`/guilds/${GUILD}/members/${USER}`]: { body: { roles: [] } },
  [`/channels/${CHANNEL}`]: { body: { guild_id: GUILD, type: 0, name: 'eng', topic: 'Shipping', permission_overwrites: [] } },
  [`/channels/${CHANNEL}/messages/${MESSAGE}`]: { body: { content: 'Can we land #7 today?', author: { username: 'grace', global_name: 'Grace' }, timestamp: '2026-11-01T10:00:00Z', edited_timestamp: null } },
};

describe('resolveDiscordAsBot', () => {
  it('reads a message as the bot once the reader is known, a member and allowed in the channel', async () => {
    const { fetch, calls } = discord(world);
    expect(await resolveDiscordAsBot({ guild: GUILD, channel: CHANNEL, message: MESSAGE }, 'user-token', 'bot-token', fetch)).toEqual({
      status: 'ok',
      details: { title: 'Can we land #7 today?', state: null, tone: null, author: 'Grace', updatedAt: '2026-11-01T10:00:00Z', where: '#eng', body: null, messages: [{ author: 'Grace', at: '2026-11-01T10:00:00Z', text: 'Can we land #7 today?' }] },
    });
    expect(calls).toEqual(['Bearer /users/@me', `Bot /guilds/${GUILD}`, `Bot /guilds/${GUILD}/members/${USER}`, `Bot /channels/${CHANNEL}`, `Bot /channels/${CHANNEL}/messages/${MESSAGE}`]);
  });

  it('reads nothing of a channel the reader may not see, or a server they are not in', async () => {
    const closed = { ...world, [`/channels/${CHANNEL}`]: { body: { guild_id: GUILD, type: 0, name: 'secret', permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: String(1n << 10n) }] } } };
    const shut = discord(closed);
    expect(await resolveDiscordAsBot({ guild: GUILD, channel: CHANNEL, message: MESSAGE }, 'u', 'b', shut.fetch)).toEqual({ status: 'no-access' });
    expect(shut.calls.some((call) => call.includes('/messages/'))).toBe(false);
    const stranger = discord({ ...world, [`/guilds/${GUILD}/members/${USER}`]: { status: 404 } });
    expect(await resolveDiscordAsBot({ guild: GUILD, channel: CHANNEL, message: MESSAGE }, 'u', 'b', stranger.fetch)).toEqual({ status: 'no-access' });
  });

  it('says when the bot is not in the server, and when the reader’s token is refused', async () => {
    expect(await resolveDiscordAsBot({ guild: GUILD, channel: CHANNEL, message: null }, 'u', 'b', discord({ ...world, [`/guilds/${GUILD}`]: { status: 403 } }).fetch)).toMatchObject({ status: 'failed', reason: 'invalid', message: 'Geld’s bot is not in this server. A server admin can add it.' });
    expect(await resolveDiscordAsBot({ guild: GUILD, channel: CHANNEL, message: null }, 'u', 'b', discord({ '/users/@me': { status: 401 } }).fetch)).toMatchObject({ status: 'failed', reason: 'unauthorized' });
  });

  it('reads a thread with the parent channel’s permissions, its messages oldest first', async () => {
    const threaded = {
      ...world,
      [`/channels/${THREAD}`]: { body: { guild_id: GUILD, type: 11, name: 'Release 2.0', parent_id: CHANNEL, message_count: 2 } },
      [`/channels/${THREAD}/messages?limit=30`]: { body: [{ content: 'second', author: { username: 'b' }, timestamp: '2' }, { content: 'first', author: { username: 'a' }, timestamp: '1' }] },
    };
    expect(await resolveDiscordAsBot({ guild: GUILD, channel: THREAD, message: null }, 'u', 'b', discord(threaded).fetch)).toMatchObject({
      status: 'ok',
      details: { title: 'Release 2.0', state: '2 messages', where: '#eng', messages: [{ text: 'first' }, { text: 'second' }] },
    });
  });
});

describe('the extension’s side', () => {
  const connection: Connection = { id: 'd', service: 'discord', label: 'ada', host: null, secret: 'user-token', email: null, account: 'ada', covers: [], use: { details: true, ai: false }, expiresAt: null, refresh: null };

  it('sends the link and the reader’s token to Geld’s resolver and reads its answer back', async () => {
    let sent: unknown = null;
    const fetch: FetchLike = async (url, init) => {
      sent = { url, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ status: 'ok', details: { title: 'Can we land #7 today?', state: null, author: 'Grace', updatedAt: null, where: '#eng', body: null, messages: [{ author: 'Grace', at: null, text: 'x' }] } }));
    };
    expect(await resolverFor('discord')?.resolve(linkOf(`https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`), connection, fetch)).toMatchObject({ status: 'ok', details: { title: 'Can we land #7 today?', where: '#eng' } });
    expect(sent).toEqual({ url: 'https://www.geld.sh/api/discord/resolve', body: { token: 'user-token', guild: GUILD, channel: CHANNEL, message: MESSAGE } });
  });
});
