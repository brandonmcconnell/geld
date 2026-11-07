import { describe, expect, it } from 'vitest';

import { exchangeToken, parseTokenRequest, PROXY_SERVICES } from './connect-token';

const teams = PROXY_SERVICES.teams;
if (teams === undefined) throw new Error('teams');

describe('the token proxy', () => {
  it('takes a code with its verifier, or a refresh token, and nothing else', () => {
    expect(parseTokenRequest({ grant: 'code', code: 'c', verifier: 'v' })).toEqual({ grant: 'code', code: 'c', verifier: 'v' });
    expect(parseTokenRequest({ grant: 'refresh', refresh: 'r' })).toEqual({ grant: 'refresh', refresh: 'r' });
    expect(parseTokenRequest({ grant: 'code', code: 'c' })).toBeNull();
    expect(parseTokenRequest({ grant: 'password', refresh: 'r' })).toBeNull();
    expect(parseTokenRequest({ grant: 'refresh', refresh: 'x'.repeat(5000) })).toBeNull();
  });

  it('adds the secret, the verifier and the redirect, and hands back only the tokens', async () => {
    let sent = new URLSearchParams();
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      sent = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3599, id_token: 'secret-ish' }));
    };
    const result = await exchangeToken(teams, { grant: 'code', code: 'c', verifier: 'v' }, { MICROSOFT_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 's' }, fetch);
    expect(result).toEqual({ status: 200, answer: { ok: true, accessToken: 'a', refreshToken: 'r', expiresIn: 3599 } });
    expect(Object.fromEntries(sent)).toEqual({
      client_id: 'id',
      client_secret: 's',
      redirect_uri: 'https://www.geld.sh/connect/teams/callback',
      scope: 'offline_access User.Read ChannelMessage.Read.All Channel.ReadBasic.All Team.ReadBasic.All',
      grant_type: 'authorization_code',
      code: 'c',
      code_verifier: 'v',
    });
  });

  it('says when it is not set up, and passes the provider’s refusal on in one line', async () => {
    const never = async (): Promise<Response> => {
      throw new Error('not called');
    };
    expect((await exchangeToken(teams, { grant: 'refresh', refresh: 'r' }, {}, never)).status).toBe(503);
    const refused = async (): Promise<Response> => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented.\r\nTrace ID: x' }), { status: 400 });
    expect(await exchangeToken(teams, { grant: 'refresh', refresh: 'r' }, { MICROSOFT_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 's' }, refused)).toEqual({
      status: 400,
      answer: { ok: false, error: 'AADSTS65001: The user or administrator has not consented.' },
    });
  });
});
