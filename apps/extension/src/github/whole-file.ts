import { looksLikeHtml } from '../lib/http';

/**
 * Whole files at a commit, for the test outline: a diff shows a file only
 * around its changes, and a test cut by a hunk's edge needs the rest of the
 * file to be read whole. Read from `/owner/repo/raw/<sha>/<path>` on the
 * page's origin (the session cookie decides access, as for repository
 * configs) and kept per commit and path for the page's life; a file is asked
 * for once, and a failure is not asked again.
 */

const MAX_BYTES = 1_000_000;
const MAX_FILES = 200;

type Entry = { readonly state: 'pending' } | { readonly state: 'ready'; readonly lines: readonly string[] } | { readonly state: 'failed' };

const files = new Map<string, Entry>();

/** The file's lines (line 1 first) once read, else null, starting the read and calling `onReady` when it lands. */
export function wholeFile(origin: string, repo: string, sha: string, path: string, onReady: () => void): readonly string[] | null {
  const key = `${origin}/${repo}@${sha}:${path}`;
  const entry = files.get(key);
  if (entry !== undefined) return entry.state === 'ready' ? entry.lines : null;
  if (files.size >= MAX_FILES) {
    const oldest = files.keys().next().value;
    if (oldest !== undefined) files.delete(oldest);
  }
  files.set(key, { state: 'pending' });
  void read(origin, repo, sha, path).then(
    (lines) => {
      files.set(key, lines === null ? { state: 'failed' } : { state: 'ready', lines });
      if (lines !== null) onReady();
    },
    () => files.set(key, { state: 'failed' }),
  );
  return null;
}

async function read(origin: string, repo: string, sha: string, path: string): Promise<readonly string[] | null> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${origin}/${repo}/raw/${sha}/${encoded}`, { credentials: 'same-origin', redirect: 'follow' });
  if (!response.ok) return null;
  const body = await response.text();
  if (body.length > MAX_BYTES || looksLikeHtml(response.headers.get('content-type'), body)) return null;
  const lines = body.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
