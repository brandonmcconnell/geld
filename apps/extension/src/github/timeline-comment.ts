/** `/owner/repo/pull/N` from any of the pull request's paths, or null off a pull request. */
export function pullPathOf(pathname: string): string | null {
  return /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(pathname)?.[0] ?? null;
}

/** What GitHub's conversation composer sends to post a comment on the pull request (`create_timeline_comment`, its `text`; verified Oct 2026), from the page's own origin and session. */
export function timelineCommentRequest(pullPath: string, text: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' };
  if (nonce !== '') headers['X-Fetch-Nonce'] = nonce;
  return { url: `${pullPath}/page_data/create_timeline_comment`, init: { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ text }) } };
}

export function fetchNonce(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? '';
}
