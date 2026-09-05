const SHA = /^[0-9a-f]{40}$/i;

/**
 * Find the head commit of the pull request on the current page without any
 * network request. Both GitHub UIs leak it in a few stable places.
 */
export function detectHeadSha(): string | null {
  // Legacy files view: progressive diff loaders carry `sha2=<head>`.
  for (const element of document.querySelectorAll('[data-fragment-url*="sha2="]')) {
    const url = element.getAttribute('data-fragment-url') ?? '';
    const match = /[?&]sha2=([0-9a-f]{40})/i.exec(url);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  // Stale-comparison poller (both views): `end_commit_oid=<head>`.
  for (const element of document.querySelectorAll('[data-url*="end_commit_oid="]')) {
    const url = element.getAttribute('data-url') ?? '';
    const match = /[?&]end_commit_oid=([0-9a-f]{40})/i.exec(url);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  // React views embed their initial payload as JSON.
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent ?? '';
    const match = /"(?:headSha|headRefOid)"\s*:\s*"([0-9a-f]{40})"/i.exec(text);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  return null;
}

/** Commit pages are immutable: the SHA in the URL is the cache key. */
export function shaFromCommitUrl(pathname: string): string | null {
  const match = /\/commit\/([0-9a-f]{40})(?:\/|$)/i.exec(pathname);
  const sha = match?.[1];
  return sha !== undefined && SHA.test(sha) ? sha.toLowerCase() : null;
}
