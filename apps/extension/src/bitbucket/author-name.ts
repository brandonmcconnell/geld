import { normalizeReviewAccountId } from '@geld/core';
import { providerReviewKey, providerReviewUrl } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject } from '@geld/review';
import type { ProviderReviewAuthorPresentation } from '../providers/review-panel';
import type { BitbucketComment } from './api';

export type BitbucketApiAuthorPresentation = (comment: ProviderReviewComment, subject: ProviderReviewSubject) => ProviderReviewAuthorPresentation | null;

export function bitbucketAuthorSubjectKey(subject: ProviderReviewSubject): string | null {
  if (subject.provider !== 'bitbucket' || subject.origin !== 'https://bitbucket.org' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(subject.headSha)) return null;
  try { return JSON.stringify([providerReviewKey(subject), subject.headSha]); } catch { return null; }
}

export function bitbucketCommentIdentity(comment: ProviderReviewComment): string {
  return JSON.stringify([comment.id, comment.anchor, comment.url, comment.author.id, comment.author.login, comment.body, comment.createdAt, comment.updatedAt ?? null]);
}

export function createBitbucketApiAuthorPresentation(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], originals: readonly BitbucketComment[]): BitbucketApiAuthorPresentation {
  const subject = { ...input.subject };
  const key = bitbucketAuthorSubjectKey(subject);
  if (key === null) return () => null;
  const reviewUrl = providerReviewUrl(subject);
  const reviewPath = new URL(reviewUrl).pathname;
  const raw = new Map<string, BitbucketComment | null>();
  const names = new Map<string, string | null>();
  for (const original of originals) {
    const id = String(original.id);
    raw.set(id, raw.has(id) ? null : original);
    const author = original.author;
    if (author === null || normalizeReviewAccountId('bitbucket', author.id) === null) continue;
    const name = author.name.trim();
    if (name === '' || name.length > 512) continue;
    names.set(author.id, names.has(author.id) && names.get(author.id) !== name ? null : name);
  }
  const sources = new Map<string, { readonly identity: string; readonly name: string; readonly authorId: string } | null>();
  for (const comment of [...input.threads.flatMap((thread) => thread.comments), ...comments]) {
    if (sources.has(comment.id)) { sources.set(comment.id, null); continue; }
    const original = raw.get(comment.id);
    const author = original?.author;
    const name = author === null || author === undefined ? null : names.get(author.id);
    let url: URL;
    try { url = new URL(comment.url); } catch { continue; }
    if (original === null || original === undefined || original.deleted || author === null || author === undefined || !name
      || normalizeReviewAccountId('bitbucket', author.id) === null || author.id !== comment.author.id || author.login !== comment.author.login
      || original.url !== comment.url || original.body !== comment.body || original.createdAt !== comment.createdAt || original.updatedAt !== comment.updatedAt
      || comment.anchor !== `comment-${comment.id}` || url.hash !== `#${comment.anchor}`
      || url.origin !== subject.origin || ![reviewPath, `${reviewPath}/_/diff`, `${reviewPath}/_/overview`, `${reviewPath}/diff`, `${reviewPath}/overview`].includes(url.pathname)
      || url.username !== '' || url.password !== '' || url.search !== '') continue;
    sources.set(comment.id, { identity: bitbucketCommentIdentity(comment), name, authorId: author.id });
  }
  return (comment, current) => {
    if (bitbucketAuthorSubjectKey(current) !== key) return null;
    const source = sources.get(comment.id);
    return source !== null && source !== undefined && source.identity === bitbucketCommentIdentity(comment) ? { authorId: source.authorId, displayName: source.name } : null;
  };
}
