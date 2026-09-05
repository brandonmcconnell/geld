/**
 * Where to send the user after sign-in. Only same-site relative paths are
 * accepted (`/settings`, `/settings#hide`); anything that could leave the site
 * — absolute URLs, protocol-relative `//host`, backslashes — falls back to
 * `/settings`.
 */
export const DEFAULT_NEXT_PATH = '/settings';

export function safeNextPath(candidate: string | null | undefined): string {
  if (candidate === null || candidate === undefined) return DEFAULT_NEXT_PATH;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) return DEFAULT_NEXT_PATH;
  if (/[\s\\]/.test(candidate) || candidate.includes('://')) return DEFAULT_NEXT_PATH;
  // Sign-in routes themselves are never a destination.
  if (candidate === '/auth' || candidate.startsWith('/auth/') || candidate.startsWith('/auth?')) return DEFAULT_NEXT_PATH;
  return candidate;
}
