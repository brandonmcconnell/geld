import { OAUTH_SCOPE, fetchGitHubProfile } from '@geld/core';
import type { GitHubAccount } from './account';

/**
 * GitHub OAuth **device flow**: no client secret and no server. The extension
 * asks GitHub for a short code, the user confirms it on github.com, and the
 * extension polls until a token scoped to `gist` is issued. (geld.sh uses the
 * same OAuth App with the web flow; the App's callback URL is only used there.)
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export { OAUTH_SCOPE };

export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: number;
  readonly intervalMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function num(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) throw new Error(`GitHub returned an unexpected response (${response.status})`);
  return body;
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  const body = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope: OAUTH_SCOPE });
  const error = str(body, 'error');
  if (error !== null) {
    if (/not found/i.test(error) || /unauthorized_client/i.test(error)) {
      throw new Error('GitHub does not recognise this client id, or Device Flow is not enabled for the OAuth App.');
    }
    throw new Error(str(body, 'error_description') ?? error);
  }
  const deviceCode = str(body, 'device_code');
  const userCode = str(body, 'user_code');
  const verificationUri = str(body, 'verification_uri');
  const expiresIn = num(body, 'expires_in');
  const interval = num(body, 'interval') ?? 5;
  if (deviceCode === null || userCode === null || verificationUri === null || expiresIn === null) {
    throw new Error('GitHub did not return a device code. Is Device Flow enabled on the OAuth App?');
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresAt: Date.now() + expiresIn * 1000,
    intervalMs: Math.max(5, interval) * 1000,
  };
}

export type PollResult =
  | { readonly status: 'pending'; readonly intervalMs: number }
  | { readonly status: 'token'; readonly token: string; readonly scopes: readonly string[] }
  | { readonly status: 'failed'; readonly message: string };

export async function pollForToken(clientId: string, device: DeviceCode): Promise<PollResult> {
  const body = await postForm(ACCESS_TOKEN_URL, {
    client_id: clientId,
    device_code: device.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const token = str(body, 'access_token');
  if (token !== null) {
    const scopes = (str(body, 'scope') ?? '')
      .split(/[,\s]+/)
      .filter((scope) => scope !== '');
    return { status: 'token', token, scopes };
  }
  switch (str(body, 'error')) {
    case 'authorization_pending':
      return { status: 'pending', intervalMs: device.intervalMs };
    case 'slow_down':
      return { status: 'pending', intervalMs: device.intervalMs + 5000 };
    case 'expired_token':
      return { status: 'failed', message: 'The code expired before it was entered. Please start again.' };
    case 'access_denied':
      return { status: 'failed', message: 'Access was declined on GitHub.' };
    default:
      return { status: 'failed', message: str(body, 'error_description') ?? 'GitHub rejected the request.' };
  }
}

export async function fetchAccount(token: string, scopes: readonly string[]): Promise<GitHubAccount> {
  const profile = await fetchGitHubProfile(token);
  return { ...profile, token, scopes };
}
