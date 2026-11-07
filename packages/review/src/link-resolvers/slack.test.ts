import { describe, expect, it } from 'vitest';
import { relatedLinkOf, type RelatedLink } from '../related-links';
import { candidatesFor, resolverFor, type Connection, type FetchLike } from './index';
import { slackText } from './slack';

function linkOf(href: string): RelatedLink {
  const link = relatedLinkOf({ href, text: 'Slack Thread' });
  if (link === null) throw new Error(href);
  return link;
}

const connection: Connection = {
  id: 's1',
  service: 'slack',
  label: 'Acme',
  host: null,
  secret: 'xoxp-1',
  email: null,
  account: 'ada',
  covers: ['t012ab3c4', 'acme'],
  use: { details: true, ai: false },
  expiresAt: null,
  refresh: null,
};

function slack(answers: Readonly<Record<string, unknown>>, status: Readonly<Record<string, number>> = {}): { fetch: FetchLike; methods: string[]; urls: string[] } {
  const methods: string[] = [];
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const method = /\/api\/([\w.]+)\?/.exec(url)?.[1] ?? '';
    methods.push(method);
    return new Response(JSON.stringify(answers[method] ?? { ok: false, error: 'unknown_method' }), { status: status[method] ?? 200, headers: { 'Retry-After': '42' } });
  };
  return { fetch, methods, urls };
}

const resolver = resolverFor('slack');

describe('slack', () => {
  it('reads a thread as its first message, its channel and the people in it', async () => {
    const { fetch, methods, urls } = slack({
      'conversations.info': { ok: true, channel: { name: 'eng-review' } },
      'conversations.replies': {
        ok: true,
        messages: [
          { user: 'U1', ts: '1793123214.352139', text: 'Login loops after SSO for <@U2>, see <https://acme.dev/x|the trace>', reply_count: 2, latest_reply: '1793123300.000100' },
          { user: 'U2', ts: '1793123250.000100', text: 'On it &amp; fixing' },
          { bot_profile: { name: 'Replicas' }, ts: '1793123300.000100', text: 'Opened <https://github.com/acme/web/pull/7>' },
        ],
      },
      'users.info': { ok: true, user: { profile: { display_name: 'ada' } } },
    });
    const result = await resolver?.resolve(linkOf('https://acme.slack.com/archives/C0123456789/p1793123214352139'), connection, fetch);
    expect(result).toMatchObject({
      status: 'ok',
      details: {
        title: 'Login loops after SSO for @ada, see the trace',
        state: '2 replies',
        where: '#eng-review',
        author: 'ada',
        updatedAt: new Date(1793123300000.1).toISOString(),
        messages: [
          { author: 'ada', text: 'Login loops after SSO for @ada, see the trace' },
          { author: 'ada', text: 'On it & fixing' },
          { author: 'Replicas', text: 'Opened https://github.com/acme/web/pull/7' },
        ],
      },
    });
    expect(methods).toEqual(['conversations.info', 'conversations.replies', 'users.info', 'users.info']);
    expect(urls[1]).toBe('https://slack.com/api/conversations.replies?channel=C0123456789&ts=1793123214.352139&limit=30&inclusive=true');
  });

  it('reads the root of a reply link from its thread_ts, and the web client’s thread address', async () => {
    const { fetch, urls } = slack({ 'conversations.info': { ok: true, channel: { name: 'eng' } }, 'conversations.replies': { ok: true, messages: [{ text: 'Root' }] } });
    await resolver?.resolve(linkOf('https://acme.slack.com/archives/C0123456789/p1793123300000100?thread_ts=1793123214.352139&cid=C0123456789'), connection, fetch);
    expect(urls[1]).toContain('ts=1793123214.352139');
    const client = linkOf('https://app.slack.com/client/T012AB3C4/C0123456789/thread/C0123456789-1793123214.352139');
    expect(candidatesFor(client, [connection]).map((candidate) => candidate.id)).toEqual(['s1']);
    await resolver?.resolve(client, connection, fetch);
    expect(urls[3]).toContain('ts=1793123214.352139');
  });

  it('reads a channel link as its name and purpose, without the limited history methods', async () => {
    const { fetch, methods } = slack({ 'conversations.info': { ok: true, channel: { name: 'eng', purpose: { value: 'Shipping things' } } } });
    expect(await resolver?.resolve(linkOf('https://acme.slack.com/archives/C0123456789'), connection, fetch)).toMatchObject({ status: 'ok', details: { title: '#eng', body: 'Shipping things' } });
    expect(methods).toEqual(['conversations.info']);
  });

  it('reads a channel the account is not in as no access, a revoked token as unauthorized and the limit with its wait', async () => {
    const link = linkOf('https://acme.slack.com/archives/C0123456789/p1793123214352139');
    expect(await resolver?.resolve(link, connection, slack({ 'conversations.info': { ok: false, error: 'channel_not_found' } }).fetch)).toEqual({ status: 'no-access' });
    expect(await resolver?.resolve(link, connection, slack({ 'conversations.info': { ok: false, error: 'token_revoked' } }).fetch)).toMatchObject({ status: 'failed', reason: 'unauthorized' });
    const limited = slack({ 'conversations.info': { ok: true, channel: { name: 'eng' } }, 'conversations.replies': { ok: false, error: 'ratelimited' } }, { 'conversations.replies': 429 });
    expect(await resolver?.resolve(link, connection, limited.fetch)).toMatchObject({ status: 'failed', reason: 'rate-limited', retryAfterMs: 42_000 });
  });

  it('never asks an account of another workspace, and leaves direct messages alone', () => {
    const other = { ...connection, id: 's2', covers: ['t999', 'globex'] };
    expect(candidatesFor(linkOf('https://acme.slack.com/archives/C0123456789/p1793123214352139'), [other, connection]).map((candidate) => candidate.id)).toEqual(['s1']);
    expect(resolver?.reads(linkOf('https://acme.slack.com/archives/D0123456789/p1793123214352139'))).toBe(false);
  });

  it('learns the workspace from auth.test', async () => {
    const { fetch } = slack({ 'auth.test': { ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'ada', team_id: 'T012AB3C4' } });
    expect(await resolver?.identify({ service: 'slack', label: '', host: null, secret: 'xoxp-1', email: null }, fetch)).toEqual({
      ok: true,
      identity: { account: 'ada', covers: ['t012ab3c4', 'acme'], suggestedLabel: 'Acme', host: null },
    });
  });

  it('turns Slack markup into words', () => {
    expect(slackText('<!here> <#C1|eng> <!subteam^S1|@oncall> <@U9> &lt;b&gt;', new Map())).toBe('@here #eng @oncall @someone <b>');
  });
});
