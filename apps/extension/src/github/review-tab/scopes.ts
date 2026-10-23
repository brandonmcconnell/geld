/**
 * The file each loaned hunk comes from, at the pull request's head, so the
 * hunk can be headed with the declarations enclosing it (`@geld/core`'s
 * `enclosingScopes`). Read `/{owner}/{repo}/raw/{sha}/{path}` from the page
 * origin with the session cookie (private repositories work; a pull request's
 * head commit is reachable from the base repository, fork or not), a few at a
 * time, only for the files a step shows, and kept for the page's life. A
 * deleted or binary file has no text at the head and is never asked for.
 */

import type { ScopeLine } from '@geld/core';
import { enclosingScopes } from '@geld/core';

const MAX_CONCURRENT = 3;
const MAX_BYTES = 1024 * 1024;
const RETRY_MS = 30_000;

type FileText = { readonly status: 'loading' } | { readonly status: 'ready'; readonly text: string } | { readonly status: 'failed'; readonly at: number };

const texts = new Map<string, FileText>();
const queue: Array<{ readonly key: string; readonly url: string; readonly onChange: () => void }> = [];
let inFlight = 0;
const scopesMemo = new Map<string, readonly ScopeLine[]>();
let version = 0;

/** Bumped whenever a file's text lands or fails, for the view's rebuild signature. */
export function scopesVersion(): number {
  return version;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function pump(): void {
  while (inFlight < MAX_CONCURRENT) {
    const job = queue.shift();
    if (job === undefined) return;
    inFlight += 1;
    void fetch(job.url, { credentials: 'same-origin', redirect: 'follow' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`http-${response.status}`);
        const length = Number(response.headers.get('content-length') ?? '0');
        if (length > MAX_BYTES) throw new Error('too-large');
        const text = await response.text();
        if (text.length > MAX_BYTES) throw new Error('too-large');
        texts.set(job.key, { status: 'ready', text });
      })
      .catch(() => {
        texts.set(job.key, { status: 'failed', at: Date.now() });
      })
      .finally(() => {
        inFlight -= 1;
        version += 1;
        job.onChange();
        pump();
      });
  }
}

/**
 * The text of `path` at `sha` in `repo` (`owner/name`), or null while it is
 * on its way or could not be had; `onChange` runs when it lands.
 */
export function fileTextAt(repo: string, sha: string, path: string, onChange: () => void): string | null {
  const key = `${repo}@${sha}:${path}`;
  const known = texts.get(key);
  if (known?.status === 'ready') return known.text;
  if (known?.status === 'loading') return null;
  if (known?.status === 'failed' && Date.now() - known.at < RETRY_MS) return null;
  texts.set(key, { status: 'loading' });
  queue.push({ key, url: `${location.origin}/${repo}/raw/${sha}/${encodePath(path)}`, onChange });
  pump();
  return null;
}

/**
 * The declarations enclosing `line` of `path` at `sha`, outermost first, or
 * null while the file is on its way (an empty list once it is known that
 * the line is at the top level). Memoised per file and line.
 */
export function scopesAt(repo: string, sha: string, path: string, line: number, onChange: () => void): readonly ScopeLine[] | null {
  const key = `${repo}@${sha}:${path}#${line}`;
  const memo = scopesMemo.get(key);
  if (memo !== undefined) return memo;
  const text = fileTextAt(repo, sha, path, onChange);
  if (text === null) return null;
  const scopes = enclosingScopes(text, line, path);
  scopesMemo.set(key, scopes);
  return scopes;
}

/** Forget every file but those of `repo` at `sha` (a navigation, a new head). */
export function dropOtherFiles(repo: string, sha: string): void {
  const prefix = `${repo}@${sha}:`;
  for (const key of [...texts.keys()]) if (!key.startsWith(prefix)) texts.delete(key);
  for (const key of [...scopesMemo.keys()]) if (!key.startsWith(prefix)) scopesMemo.delete(key);
}
