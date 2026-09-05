/**
 * Client-side view of who is signed in, read from the `geld_account` cookie
 * the callback sets next to the encrypted session. It holds only the login
 * and avatar (no token) and exists so the header can render the account
 * without a request; the server never trusts it.
 */
export const ACCOUNT_COOKIE_NAME = 'geld_account';

export interface AccountView {
  readonly login: string;
  readonly avatarUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseAccountCookie(cookieHeader: string): AccountView | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== ACCOUNT_COOKIE_NAME) continue;
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(rest.join('=')));
      if (isRecord(parsed) && typeof parsed.login === 'string' && typeof parsed.avatarUrl === 'string') {
        return { login: parsed.login, avatarUrl: parsed.avatarUrl };
      }
    } catch {
      return null;
    }
  }
  return null;
}
