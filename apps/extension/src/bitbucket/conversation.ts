import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { ProviderConversationRoot } from '../providers/types';
import { describeBitbucketPage } from './page';

const COMMENTS = '[data-testid="comment"][id]';

export function nativeBitbucketComment(comment: ProviderReviewComment, doc: Document): HTMLElement | null {
  if (!/^[1-9]\d*$/.test(comment.id) || comment.anchor !== `comment-${comment.id}`) return null;
  let url: URL;
  try { url = new URL(comment.url); } catch { return null; }
  const source = describeBitbucketPage(url);
  const current = describeBitbucketPage(new URL(doc.URL));
  if (source === null || current === null || source.url !== current.url || url.hash !== `#${comment.anchor}`) return null;
  const root = [...doc.querySelectorAll<HTMLElement>(COMMENTS)].find((node) => node.id === comment.anchor && node.closest('[data-geld-ui]') === null);
  if (root === undefined) return null;
  const link = root.querySelector<HTMLAnchorElement>('[data-testid="comment-header"] a[href]');
  if (link === null) return null;
  try {
    const target = new URL(link.getAttribute('href') ?? '', doc.URL);
    return describeBitbucketPage(target)?.url === source.url && target.hash === url.hash ? root : null;
  } catch { return null; }
}

export function bitbucketConversationRoots(doc: Document): readonly ProviderConversationRoot[] {
  return [...doc.querySelectorAll<HTMLElement>(COMMENTS)].flatMap((root) => {
    if (root.closest('[data-geld-ui]') !== null || !/^comment-[1-9]\d*$/.test(root.id) || root.querySelector('form,textarea,[contenteditable="true"], [data-testid="comment"]') !== null) return [];
    return [{ root, anchors: [root.id], kind: 'comment' as const }];
  });
}

export function syncBitbucketNativeReviewState(input: ProviderReviewInput, doc: Document): ProviderReviewInput {
  let changed = false;
  const threads = input.threads.map((thread) => {
    for (const comment of thread.comments) {
      const root = nativeBitbucketComment(comment, doc);
      const content = root?.closest('[data-qa="pull-request-overview-activity-content"]');
      if (content === null || content === undefined || thread.path === null) continue;
      const header = content.querySelector<HTMLElement>('[data-qa="bk-file__header"][data-testid="file-header"]');
      if (header === null || header.querySelector('[data-qa="bk-filepath"]')?.textContent !== thread.path) continue;
      const outdated = [...header.querySelectorAll('span')].some((node) => node.children.length === 0 && node.textContent?.trim() === 'Outdated' && node.closest('[data-qa="bk-filepath"], [data-geld-ui]') === null);
      if (outdated && !thread.outdated) { changed = true; return { ...thread, outdated: true }; }
    }
    return thread;
  });
  return changed ? { ...input, threads } : input;
}
