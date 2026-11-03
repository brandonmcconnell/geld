import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { ProviderConversationRoot, ProviderReviewSnapshot } from '../providers/types';
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

function activityRoot(entry: HTMLElement): HTMLElement {
  const parent = entry.parentElement;
  const row = parent?.parentElement;
  return parent?.children.length === 1 && row !== null && row !== undefined
    && row.querySelectorAll('[data-qa="pull-request-activity"]').length === 1
    && row.closest('[data-qa="pr-activity"]') !== null
    && row.querySelector('form,textarea,input,[contenteditable="true"]') === null ? row : entry;
}

export function bitbucketConversationRoots(doc: Document, snapshot?: ProviderReviewSnapshot): readonly ProviderConversationRoot[] {
  const roots: ProviderConversationRoot[] = [];
  const seen = new Set<HTMLElement>();
  for (const comment of doc.querySelectorAll<HTMLElement>(COMMENTS)) {
    if (comment.closest('[data-geld-ui]') !== null || !/^comment-[1-9]\d*$/.test(comment.id) || comment.querySelector('form,textarea,[contenteditable="true"], [data-testid="comment"]') !== null) continue;
    const activity = comment.closest<HTMLElement>('[data-qa="pull-request-activity"]');
    const candidate = activity === null ? comment : activityRoot(activity);
    const root = candidate.querySelector('form,textarea,input,[contenteditable="true"]') === null ? candidate : comment;
    if (seen.has(root)) continue;
    const anchors = root === comment ? [comment.id] : [...root.querySelectorAll<HTMLElement>(COMMENTS)].map((node) => node.id);
    if (anchors.some((anchor) => !/^comment-[1-9]\d*$/.test(anchor))) continue;
    seen.add(root);roots.push({ root, anchors, kind: 'comment' });
  }
  if (snapshot === undefined) return roots;
  const current = describeBitbucketPage(new URL(doc.URL));
  if (current === null || current.repository.path !== snapshot.input.subject.repository || current.number !== snapshot.input.subject.id) return roots;
  for (const entry of doc.querySelectorAll<HTMLElement>('[data-qa="pr-activity"] [data-qa="pull-request-activity"]')) {
    if (entry.closest('[data-geld-ui]') !== null || entry.querySelector(COMMENTS) !== null || entry.querySelector('form,textarea,input,[contenteditable="true"]') !== null) continue;
    const times = [...entry.querySelectorAll<HTMLTimeElement>('time[datetime]')];
    if (times.length !== 1) continue;
    const time = times[0];
    if (time === undefined) continue;
    const at = Date.parse(/^\d{4}-\d{2}-\d{2}T/.test(time.dateTime) ? time.dateTime : time.title.replace(' at ', ' '));
    if (!Number.isFinite(at)) continue;
    const matching = snapshot.events.filter((event) => Date.parse(event.createdAt) === at);
    if (matching.length !== 1 || matching[0] === undefined) continue;
    const event = matching[0];
    const text = (entry.textContent ?? '').toLowerCase();
    const verb = event.body.split(' ')[0]?.toLowerCase();
    if (event.headSha !== undefined ? !text.includes(event.headSha.slice(0, 7)) : verb === undefined || !text.includes(verb)) continue;
    const root = activityRoot(entry);
    if (seen.has(root)) continue;
    seen.add(root);roots.push({ root, anchors: [], eventIds: [matching[0].id], kind: 'activity' });
  }
  return roots;
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
