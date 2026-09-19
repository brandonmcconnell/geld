/**
 * GitHub trims the start of long file paths server-side on the conversation
 * tab ("...dashboard/components/ui/Format.ts") and the whole path is nowhere
 * in the markup. It can be recovered: every file link anchors to
 * `#diff-<sha256 of the path>`, so a guess can be checked. Guesses come from
 * the paths that are known whole — the pull request's diff, and any path
 * the page shows untrimmed — by borrowing the part they have before the
 * segment the trimmed one starts with ("apps/" before "dashboard/").
 * Hashing is asynchronous, so a completion lands a moment after it is asked
 * for; the caller is told and asks again.
 */

const resolved = new Map<string, string>();
const pending = new Set<string>();

const TRIMMED = /^(?:\.{3}|…)\/?(.+)$/;

/** Whether GitHub trimmed the start of this path. */
export function isTrimmedPath(path: string): boolean {
  return TRIMMED.test(path);
}

/** The 64-hex path digest in a `#diff-…` anchor, when the link has one. */
export function diffHashOf(root: Element | null): string | null {
  if (root === null) return null;
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href*="#diff-"]')) {
    const match = /#diff-([0-9a-f]{64})/.exec(link.getAttribute('href') ?? '');
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/**
 * The whole path for a trimmed one, once known; until then (or when it
 * cannot be told) the trimmed one. `known` are paths that are whole;
 * `hash` is the file's `#diff-` digest, which settles a guess for certain.
 * Without a hash, a guess is taken only when exactly one known path ends
 * with the trimmed part.
 */
export function wholePath(path: string, hash: string | null, known: readonly string[], onChange: () => void): string {
  const match = TRIMMED.exec(path);
  if (match === null) return path;
  const found = resolved.get(path);
  if (found !== undefined) return found;
  const tail = match[1] ?? '';
  const exact = known.filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`));
  if (exact.length === 1 && exact[0] !== undefined) {
    resolved.set(path, exact[0]);
    return exact[0];
  }
  if (hash === null || pending.has(path) || typeof crypto === 'undefined' || crypto.subtle === undefined) return path;
  pending.add(path);
  void settle(tail, hash, known).then((whole) => {
    pending.delete(path);
    if (whole === null) return;
    resolved.set(path, whole);
    onChange();
  });
  return path;
}

async function settle(tail: string, hash: string, known: readonly string[]): Promise<string | null> {
  // GitHub cuts wherever the width ran out — "...ard/components" is the tail of "apps/dashboard/components" — so
  // the prefix is whatever a known path has before any place the tail's first piece occurs in it.
  const first = `${tail.split('/')[0] ?? ''}/`;
  const prefixes = new Set<string>(['']);
  for (const candidate of known) {
    for (let at = candidate.indexOf(first); at !== -1; at = candidate.indexOf(first, at + 1)) prefixes.add(candidate.slice(0, at));
  }
  for (const prefix of prefixes) {
    const guess = `${prefix}${tail}`;
    if ((await sha256Hex(guess)) === hash) return guess;
  }
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Forget everything (a new visit). */
export function resetWholePaths(): void {
  resolved.clear();
  pending.clear();
}
