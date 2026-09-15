/**
 * GitHub answers some `raw/HEAD/<path>` requests with a 200 **HTML page**
 * instead of the file or a 404: SAML SSO interstitials, "sign in to view"
 * pages, repositories that are unavailable for the moment. Parsing such a
 * page as YAML produces dozens of nonsense problems, so responses are checked
 * before their text is believed. Real raw files come back as `text/plain`.
 */
export function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType !== null && /^\s*text\/html\b/i.test(contentType)) return true;
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(body.slice(0, 512));
}
