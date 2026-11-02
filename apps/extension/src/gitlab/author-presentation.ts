import { providerReviewUrl } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject } from '@geld/review';
import type { ProviderReviewAuthorPresentation } from '../providers/review-panel';
import { isProviderReviewPage } from '../providers/types';
import { describeGitLabPage, jsonAttribute, record } from './page';
import { readNativeAuthorAvatarGeometry } from '../providers/author-geometry';

const FULL_HEAD = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function profile(href: string | null, doc: Document): string | null {
  if (href === null) return null;
  try { const url = new URL(href, doc.URL); return url.origin === doc.location.origin && url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null; } catch { return null; }
}

function nativeRoots(comment: ProviderReviewComment, doc: Document): readonly HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(`[id="${comment.anchor}"]`)];
}

function validSource(comment: ProviderReviewComment, doc: Document): boolean {
  if (!/^[1-9]\d*$/.test(comment.id) || comment.anchor !== `note_${comment.id}` || !/^[1-9]\d*$/.test(comment.author.id) || !comment.author.login.trim()) return false;
  let sourceUrl: URL;
  try { sourceUrl = new URL(comment.url); } catch { return false; }
  if (sourceUrl.username !== '' || sourceUrl.password !== '') return false;
  const source = describeGitLabPage(sourceUrl, doc);
  const current = describeGitLabPage(new URL(doc.URL), doc);
  return source !== null && current !== null && isProviderReviewPage(source) && isProviderReviewPage(current) && source.url === current.url && sourceUrl.hash === `#${comment.anchor}`;
}

export function gitLabAuthorPresentation(comment: ProviderReviewComment, doc: Document): ProviderReviewAuthorPresentation | null {
  if (!validSource(comment, doc)) return null;
  const roots = nativeRoots(comment, doc);
  const root = roots.length === 1 ? roots[0] : undefined;
  if (root === undefined || !root.isConnected || root.getAttribute('data-testid') !== 'noteable-note-container' || root.getAttribute('data-note-id') !== comment.id
    || root.closest('[data-geld-ui]') !== null || root.parentElement?.closest('[data-testid="noteable-note-container"], .note-body, [data-testid="description-content"], form') !== null) return null;
  const headers = root.querySelectorAll<HTMLElement>(':scope > .timeline-entry-inner > .timeline-content > .note-header');
  const header = headers.length === 1 ? headers[0] : undefined;
  const authors = header?.querySelectorAll<HTMLAnchorElement>(':scope > .note-header-info > a.author-name-link[data-user-id][data-username]');
  const author = authors?.length === 1 ? authors[0] : undefined;
  if (header === undefined || author === undefined || author.closest('[data-geld-ui]') !== null || author.getAttribute('data-user-id') !== comment.author.id || author.getAttribute('data-username') !== comment.author.login) return null;
  const displayName = author.querySelector('[data-testid="author-name"]')?.textContent?.trim();
  const profileUrl = profile(author.getAttribute('href'), doc);
  if (!displayName || profileUrl === null) return null;
  const alias = header.querySelector<HTMLAnchorElement>(':scope > .note-header-info > .author-username > a.author-username-link');
  const username = alias?.textContent?.trim();
  const avatarLink = root.querySelector<HTMLAnchorElement>(':scope > .timeline-entry-inner > .timeline-avatar > a.gl-avatar-link[data-user-id][data-username]');
  const image = avatarLink?.getAttribute('data-user-id') === comment.author.id && avatarLink.getAttribute('data-username') === comment.author.login && profile(avatarLink.getAttribute('href'), doc) === profileUrl ? avatarLink.querySelector<HTMLImageElement>('img.gl-avatar') : null;
  const geometry = image === null || image === undefined ? null : readNativeAuthorAvatarGeometry(image);
  const badges = [...header.querySelectorAll<HTMLElement>(':scope > .note-actions > .gl-badge')].flatMap((badge) => {
    const label = badge.querySelector(':scope > .gl-badge-content')?.textContent?.trim();
    if (!label || badge.closest('[data-geld-ui]') !== null) return [];
    const className = [...badge.classList].filter((name) => name === 'gl-badge' || name === 'badge' || name.startsWith('badge-')).join(' ');
    const title = badge.getAttribute('title');
    return [{ label, className, ...(title === null ? {} : { title }) }];
  });
  return { authorId: comment.author.id, displayName, profileUrl,
    ...(username && profile(alias?.getAttribute('href') ?? null, doc) === profileUrl ? { username } : {}),
    ...(geometry === null ? {} : { avatar: { ...geometry, className: image?.className ?? '' } }), ...(badges.length === 0 ? {} : { badges }),
  };
}

function sourceKey(comment: ProviderReviewComment): string {
  return JSON.stringify([comment.id, comment.anchor, comment.url, comment.author.id, comment.author.login, comment.author.automated ?? null, comment.body, comment.createdAt, comment.updatedAt ?? null]);
}

function accountKey(comment: ProviderReviewComment): string {
  return JSON.stringify([comment.author.id, comment.author.login]);
}

function latestNativeHead(doc: Document, subject: ProviderReviewSubject, url: string): boolean {
  const current = describeGitLabPage(new URL(doc.URL), doc);
  if (current === null || !isProviderReviewPage(current) || current.url !== url || current.headSha !== subject.headSha.toLowerCase()) return false;
  const location = new URL(doc.URL);
  if (['start_sha', 'commit_id', 'only_context_commits'].some((key) => location.searchParams.has(key)) || location.searchParams.getAll('diff_id').length > 1) return false;
  const carriers = [...doc.querySelectorAll('[data-rapid-diffs][data-app-data]')].filter((node) => node.closest('[data-geld-ui], [data-testid="noteable-note-container"], .note-body, [data-testid="description-content"], form') === null);
  if (carriers.length !== 1) return false;
  const app = jsonAttribute(carriers[0] ?? null, 'data-app-data');
  if (app?.mr_path !== new URL(url).pathname || app.project_path !== subject.repository || String(app.iid) !== subject.id || !record(app.versions) || !Array.isArray(app.versions.source_versions)) return false;
  const selected = app.versions.source_versions.filter((value: unknown) => record(value) && value.selected === true);
  if (selected.length !== 1) return false;
  const version: unknown = selected[0];
  return record(version) && version.latest === true && version.is_merge_head === false && typeof version.head_sha === 'string' && FULL_HEAD.test(version.head_sha)
    && version.head_sha.toLowerCase() === subject.headSha.toLowerCase() && typeof version.id === 'number' && Number.isSafeInteger(version.id) && version.id > 0
    && (!location.searchParams.has('diff_id') || location.searchParams.get('diff_id') === String(version.id));
}

/** Account presentation may be reused only from an independently verified source in this snapshot. */
export function createGitLabAuthorPresentationReader(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], doc: Document): (comment: ProviderReviewComment) => ProviderReviewAuthorPresentation | null {
  const subject = { ...input.subject };
  let url: string;
  try { url = providerReviewUrl(subject); } catch { return () => null; }
  if (subject.provider !== 'gitlab' || !FULL_HEAD.test(subject.headSha) || new URL(url).protocol !== 'https:') return () => null;
  const sources = new Map<string, { readonly comment: ProviderReviewComment; readonly key: string }>();
  for (const original of [...input.threads.flatMap((thread) => thread.comments), ...comments]) {
    const comment = { ...original, author: { ...original.author } };
    const key = sourceKey(comment);
    const previous = sources.get(comment.id);
    if (previous !== undefined) { if (previous.key !== key) return () => null; continue; }
    sources.set(comment.id, { comment, key });
  }
  return (comment) => {
    const source = sources.get(comment.id);
    if (source?.key !== sourceKey(comment) || comment.url !== `${url}#${comment.anchor}` || !validSource(comment, doc)) return null;
    const direct = gitLabAuthorPresentation(comment, doc);
    if (direct !== null) return direct;
    if (nativeRoots(comment, doc).length !== 0 || !latestNativeHead(doc, subject, url)) return null;
    const account = accountKey(comment);
    let donor: ProviderReviewComment | undefined;
    for (const root of doc.querySelectorAll<HTMLElement>('[data-testid="noteable-note-container"][id]')) {
      const candidate = sources.get(root.getAttribute('data-note-id') ?? '')?.comment;
      if (candidate === undefined || candidate.id === comment.id || root.id !== candidate.anchor || accountKey(candidate) !== account
        || candidate.url !== `${url}#${candidate.anchor}` || root.closest('[data-geld-ui]') !== null) continue;
      if (donor !== undefined) return null;
      donor = candidate;
    }
    if (donor === undefined) return null;
    const presentation = gitLabAuthorPresentation(donor, doc);
    if (presentation === null || presentation.profileUrl !== `${subject.origin}/${encodeURIComponent(comment.author.login)}`) return null;
    return { authorId: presentation.authorId, displayName: presentation.displayName, profileUrl: presentation.profileUrl,
      ...(presentation.username === `@${comment.author.login}` ? { username: presentation.username } : {}),
      ...(presentation.avatar === undefined ? {} : { avatar: presentation.avatar }),
    };
  };
}
