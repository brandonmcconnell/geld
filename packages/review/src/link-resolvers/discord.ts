import type { RelatedLink } from '../related-links';
import { at, capBody, failed, identifyMessage, isResponse, list, readJson, request, text, titleLine } from './http';
import { MESSAGE_CAP, type FetchLike, type LinkDetails, type LinkMessage, type LinkResolver, type Resolution } from './types';

/**
 * Discord has no way to read messages as a person, so a link is read by Geld's bot, in servers that added it, and
 * only for a reader who is a member there and whose roles may see the channel. The reader signs in with Discord
 * (`identify`, `guilds`); the extension sends that token with the link to Geld's resolver on geld.sh, which checks
 * who the reader is, computes their permissions in the channel the way Discord does, and only then reads as the bot.
 * Nothing is stored there.
 */

export const DISCORD_API = 'https://discord.com/api/v10';
export const DISCORD_RESOLVER = 'https://www.geld.sh/api/discord/resolve';
export const DISCORD_USER_SCOPES = ['identify', 'guilds'] as const;

const VIEW_CHANNEL = 1n << 10n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const ADMINISTRATOR = 1n << 3n;
const ALL = (1n << 64n) - 1n;

/** The bot's permissions in a server: see channels and read their history, nothing else. */
export const DISCORD_BOT_PERMISSIONS = String(VIEW_CHANNEL | READ_MESSAGE_HISTORY);

export interface DiscordOverwrite {
  readonly id: string;
  /** 0 a role, 1 a member. */
  readonly type: number;
  readonly allow: string;
  readonly deny: string;
}

export interface DiscordPermissionInput {
  readonly guildId: string;
  readonly ownerId: string;
  readonly userId: string;
  readonly memberRoles: readonly string[];
  readonly roles: readonly { readonly id: string; readonly permissions: string }[];
  readonly overwrites: readonly DiscordOverwrite[];
}

const big = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

/**
 * A member's permissions in a channel, as Discord's documentation computes them: the base from @everyone and the
 * member's roles (all of them for the owner or an administrator), then the channel's @everyone overwrite, its role
 * overwrites together, and the member's own.
 */
export function channelPermissions(input: DiscordPermissionInput): bigint {
  if (input.userId === input.ownerId) return ALL;
  const roleOf = new Map(input.roles.map((role) => [role.id, big(role.permissions)]));
  let base = roleOf.get(input.guildId) ?? 0n;
  for (const role of input.memberRoles) base |= roleOf.get(role) ?? 0n;
  if ((base & ADMINISTRATOR) === ADMINISTRATOR) return ALL;
  let permissions = base;
  const everyone = input.overwrites.find((overwrite) => overwrite.type === 0 && overwrite.id === input.guildId);
  if (everyone !== undefined) permissions = (permissions & ~big(everyone.deny)) | big(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const overwrite of input.overwrites) {
    if (overwrite.type !== 0 || !input.memberRoles.includes(overwrite.id)) continue;
    allow |= big(overwrite.allow);
    deny |= big(overwrite.deny);
  }
  permissions = (permissions & ~deny) | allow;
  const own = input.overwrites.find((overwrite) => overwrite.type === 1 && overwrite.id === input.userId);
  if (own !== undefined) permissions = (permissions & ~big(own.deny)) | big(own.allow);
  return permissions;
}

export const canRead = (permissions: bigint): boolean => (permissions & (VIEW_CHANNEL | READ_MESSAGE_HISTORY)) === (VIEW_CHANNEL | READ_MESSAGE_HISTORY);

export interface DiscordTarget {
  readonly guild: string;
  readonly channel: string;
  readonly message: string | null;
}

const SNOWFLAKE = /^\d{17,20}$/;

export function discordTargetOf(link: RelatedLink): DiscordTarget | null {
  if (!link.key.startsWith('discord:')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const path = /^\/channels\/(\d+)\/(\d+)(?:\/(?:threads\/)?(\d+))?\/?$/.exec(url.pathname);
  if (path === null) return null;
  const [, guild = '', channel = '', third] = path;
  const thread = url.pathname.includes('/threads/');
  if (!SNOWFLAKE.test(guild) || !SNOWFLAKE.test(channel)) return null;
  // A thread's link names the thread after its parent channel: the thread is the channel to read.
  return thread ? { guild, channel: third ?? channel, message: null } : { guild, channel, message: third ?? null };
}

export function isDiscordTarget(value: unknown): value is DiscordTarget {
  if (typeof value !== 'object' || value === null) return false;
  const entry = Object.fromEntries(Object.entries(value));
  return typeof entry.guild === 'string' && SNOWFLAKE.test(entry.guild) && typeof entry.channel === 'string' && SNOWFLAKE.test(entry.channel) && (entry.message === null || (typeof entry.message === 'string' && SNOWFLAKE.test(entry.message)));
}

/** The answer the resolver on geld.sh gives, as `Resolution` already is: the extension reads it back as it is. */
export function parseResolution(value: unknown): Resolution | null {
  const status = text(value, 'status');
  if (status === 'no-access' || status === 'unsupported') return { status };
  if (status === 'failed') {
    const reason = text(value, 'reason');
    const retry = at(value, 'retryAfterMs');
    return failed(reason === 'unauthorized' || reason === 'rate-limited' || reason === 'unavailable' ? reason : 'invalid', text(value, 'message'), typeof retry === 'number' ? retry : null);
  }
  if (status !== 'ok') return null;
  const title = text(value, 'details', 'title');
  if (title === null) return null;
  const messages = list(value, 'details', 'messages').map((message): LinkMessage => ({ author: text(message, 'author'), at: text(message, 'at'), text: text(message, 'text') ?? '' }));
  return {
    status: 'ok',
    details: {
      title,
      state: text(value, 'details', 'state'),
      tone: text(value, 'details', 'state') === null ? null : 'neutral',
      author: text(value, 'details', 'author'),
      updatedAt: text(value, 'details', 'updatedAt'),
      where: text(value, 'details', 'where'),
      body: capBody(text(value, 'details', 'body')),
      messages: messages.slice(0, MESSAGE_CAP),
    },
  };
}

export const discordResolver: LinkResolver = {
  service: 'discord',
  reads: (link) => discordTargetOf(link) !== null,
  workspaceOf: (link) => discordTargetOf(link)?.guild ?? null,
  hintKeys: (link) => {
    const target = discordTargetOf(link);
    return target === null ? [] : [`discord/${target.guild}`];
  },
  origins: () => ['https://discord.com/*', 'https://www.geld.sh/*'],
  async identify(draft, fetch) {
    const response = await request(fetch, `${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${draft.secret}` } });
    if (!isResponse(response)) return { ok: false, message: 'Discord could not be reached' };
    if (!response.ok) return { ok: false, message: identifyMessage(response.status, 'Discord') };
    const body = await readJson(response);
    const name = text(body, 'username');
    if (name === null) return { ok: false, message: 'Discord did not say who signed in' };
    // Servers come and go, and the resolver checks membership on every read, so every Discord link may try this account.
    return { ok: true, identity: { account: name, covers: [], suggestedLabel: text(body, 'global_name') ?? name, host: null } };
  },
  async resolve(link, connection, fetch) {
    const target = discordTargetOf(link);
    if (target === null) return { status: 'unsupported' };
    const response = await request(fetch, DISCORD_RESOLVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: connection.secret, ...target }) });
    if (!isResponse(response)) return response;
    if (response.status >= 500 && response.status !== 503) return failed('unavailable', `Geld’s Discord service answered ${response.status}`);
    return parseResolution(await readJson(response)) ?? failed('invalid', 'Geld’s Discord service did not answer');
  },
};

/* ------------------------------------------------------------------------------------------------------------------ */
/* The resolver's side, run on geld.sh with the bot's token                                                          */
/* ------------------------------------------------------------------------------------------------------------------ */

async function discord(fetch: FetchLike, path: string, authorization: string): Promise<{ readonly status: number; readonly body: unknown; readonly retry: number | null }> {
  const response = await request(fetch, `${DISCORD_API}${path}`, { headers: { Authorization: authorization } });
  if (!isResponse(response)) return { status: 0, body: null, retry: null };
  const retry = Number(response.headers.get('retry-after'));
  return { status: response.status, body: await readJson(response), retry: Number.isFinite(retry) ? retry * 1000 : null };
}

const THREAD_TYPES = new Set([10, 11, 12]);

function overwritesOf(channel: unknown): DiscordOverwrite[] {
  return list(channel, 'permission_overwrites').flatMap((entry) => {
    const id = text(entry, 'id');
    const type = at(entry, 'type');
    return id === null || typeof type !== 'number' ? [] : [{ id, type, allow: text(entry, 'allow') ?? '0', deny: text(entry, 'deny') ?? '0' }];
  });
}

function messageOf(value: unknown): LinkMessage {
  return { author: text(value, 'author', 'global_name') ?? text(value, 'author', 'username'), at: text(value, 'timestamp'), text: (text(value, 'content') ?? '').trim() };
}

/**
 * Reads a Discord link for the person whose user token came with it, as Geld's bot, after checking that person may
 * see the channel. Every refusal says as little as it can: a server the reader is not in reads as no access whether
 * or not it exists.
 */
export async function resolveDiscordAsBot(target: DiscordTarget, userToken: string, botToken: string, fetch: FetchLike): Promise<Resolution> {
  const bot = `Bot ${botToken}`;
  const me = await discord(fetch, '/users/@me', `Bearer ${userToken}`);
  if (me.status === 401) return failed('unauthorized', 'Discord refused this connection');
  if (me.status === 429) return failed('rate-limited', 'Discord asked Geld to slow down', me.retry);
  const userId = text(me.body, 'id');
  if (me.status !== 200 || userId === null) return failed('unavailable', 'Discord could not be reached');
  const guild = await discord(fetch, `/guilds/${target.guild}`, bot);
  if (guild.status === 403 || guild.status === 404) return failed('invalid', 'Geld’s bot is not in this server. A server admin can add it.');
  if (guild.status !== 200) return failed('unavailable', `Discord answered ${guild.status}`, guild.retry);
  const member = await discord(fetch, `/guilds/${target.guild}/members/${userId}`, bot);
  if (member.status === 404) return { status: 'no-access' };
  if (member.status !== 200) return failed('unavailable', `Discord answered ${member.status}`, member.retry);
  const channel = await discord(fetch, `/channels/${target.channel}`, bot);
  if (channel.status === 403 || channel.status === 404) return { status: 'no-access' };
  if (channel.status !== 200 || text(channel.body, 'guild_id') !== target.guild) return { status: 'no-access' };
  const type = at(channel.body, 'type');
  const isThread = typeof type === 'number' && THREAD_TYPES.has(type);
  const parentId = text(channel.body, 'parent_id');
  const parent = isThread && parentId !== null ? await discord(fetch, `/channels/${parentId}`, bot) : null;
  const permissionsChannel = parent?.status === 200 ? parent.body : channel.body;
  const permissions = channelPermissions({
    guildId: target.guild,
    ownerId: text(guild.body, 'owner_id') ?? '',
    userId,
    memberRoles: list(member.body, 'roles').filter((role): role is string => typeof role === 'string'),
    roles: list(guild.body, 'roles').flatMap((role) => {
      const id = text(role, 'id');
      return id === null ? [] : [{ id, permissions: text(role, 'permissions') ?? '0' }];
    }),
    overwrites: overwritesOf(permissionsChannel),
  });
  if (!canRead(permissions)) return { status: 'no-access' };
  const name = text(channel.body, 'name');
  const where = isThread ? (text(parent?.body, 'name') === null ? null : `#${text(parent?.body, 'name') ?? ''}`) : name === null ? null : `#${name}`;
  let details: LinkDetails;
  if (target.message !== null) {
    const message = await discord(fetch, `/channels/${target.channel}/messages/${target.message}`, bot);
    if (message.status !== 200) return message.status === 429 ? failed('rate-limited', 'Discord asked Geld to slow down', message.retry) : { status: 'no-access' };
    const read = messageOf(message.body);
    details = { title: titleLine(read.text) || 'Discord message', state: null, tone: null, author: read.author, updatedAt: text(message.body, 'edited_timestamp') ?? read.at, where, body: null, messages: [read] };
  } else if (isThread) {
    const messages = await discord(fetch, `/channels/${target.channel}/messages?limit=${MESSAGE_CAP}`, bot);
    const read = messages.status === 200 ? list(messages.body).map(messageOf).reverse() : [];
    const count = at(channel.body, 'message_count');
    details = {
      title: name ?? (titleLine(read[0]?.text ?? '') || 'Discord thread'),
      state: typeof count === 'number' && count > 0 ? `${count} ${count === 1 ? 'message' : 'messages'}` : null,
      tone: null,
      author: read[0]?.author ?? null,
      updatedAt: read[read.length - 1]?.at ?? null,
      where,
      body: null,
      messages: read,
    };
  } else {
    details = { title: where ?? 'Discord channel', state: null, tone: null, author: null, updatedAt: null, where: text(guild.body, 'name'), body: capBody(text(channel.body, 'topic')), messages: [] };
  }
  return { status: 'ok', details };
}
