import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: async () => true } } }));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => undefined, setValue: async () => undefined, watch: () => () => undefined }) } }));

import { authorizeUrl, exchangeSlackCode, pkceChallenge, SLACK_REDIRECT } from './slack-connect';
import { SLACK_READ_INTERVAL_MS, slackPacedFetch } from './connections';

describe('Connect Slack', () => {
  it('hashes the verifier as Slack’s PKCE example does', async () => {
    expect(await pkceChallenge('secretpassword')).toBe('ldMBaaWcQYtSATMV_IG8mf3wp7A6EW80arYoSW80ntU');
  });

  it('asks for the reader’s scopes only, with the challenge and back to geld.sh', () => {
    const url = new URL(authorizeUrl('123.456', 'st', 'ch'));
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '123.456',
      user_scope: 'channels:history,groups:history,channels:read,groups:read,users:read',
      redirect_uri: SLACK_REDIRECT,
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('exchanges the code with the verifier and no secret, keeping the user token', async () => {
    let sent = '';
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ ok: true, authed_user: { id: 'U1', access_token: 'xoxp-1' }, team: { id: 'T1' } }));
    };
    expect(await exchangeSlackCode(fetch, '123.456', 'code-1', 'verifier-1')).toEqual({ token: 'xoxp-1' });
    const body = new URLSearchParams(sent);
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.has('client_secret')).toBe(false);
    const refused = async (): Promise<Response> => new Response(JSON.stringify({ ok: false, error: 'invalid_code_verifier' }));
    expect(await exchangeSlackCode(refused, '123.456', 'code-1', 'v')).toEqual({ message: 'Slack did not sign you in (invalid_code_verifier)' });
  });
});

describe('slackPacedFetch', () => {
  it('spaces message reads per token and answers one asked too soon as Slack would', async () => {
    let now = 1_000_000;
    const calls: string[] = [];
    const paced = slackPacedFetch(async (url) => {
      calls.push(url);
      return new Response('{"ok":true}');
    }, () => now);
    const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
    await paced('https://slack.com/api/conversations.replies?ts=1', auth('a'));
    const early = await paced('https://slack.com/api/conversations.replies?ts=2', auth('a'));
    expect(early.status).toBe(429);
    expect(early.headers.get('Retry-After')).toBe(String(SLACK_READ_INTERVAL_MS / 1000));
    await paced('https://slack.com/api/conversations.info?channel=C', auth('a'));
    await paced('https://slack.com/api/conversations.replies?ts=3', auth('b'));
    now += SLACK_READ_INTERVAL_MS;
    await paced('https://slack.com/api/conversations.history?x', auth('a'));
    expect(calls.map((url) => url.slice(url.indexOf('/api/') + 5))).toEqual(['conversations.replies?ts=1', 'conversations.info?channel=C', 'conversations.replies?ts=3', 'conversations.history?x']);
  });
});
