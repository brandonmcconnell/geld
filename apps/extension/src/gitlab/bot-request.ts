import { providerReviewUrl, sourceLink } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { ProviderBotRequest } from '../providers/bot-request';
import { gitLabActionVisit, readGitLabMainCommentAction } from './actions';
import { gitLabReviewIdentity } from './review';
import { describeGitLabPage } from './page';
import { isProviderReviewPage } from '../providers/types';

// Each service needs GitLab-specific command evidence; native account trust remains separate.
const REQUESTS = [
  { id: 'coderabbit', label: 'CodeRabbit', commands: [
    { id: 'incremental', label: 'Incremental review', text: '@coderabbitai review' },
    { id: 'full', label: 'Full review', text: '@coderabbitai full review' },
  ] },
  // Greptile Developer Essentials explicitly documents this literal for GitHub/GitLab comments.
  { id: 'greptile', label: 'Greptile', commands: [{ id: 'review', label: 'Review', text: '@greptileai' }] },
] as const;

function nativeNote(comment: ProviderReviewComment, doc: Document): HTMLElement | null {
  if (!/^[1-9]\d*$/.test(comment.id) || comment.anchor !== `note_${comment.id}` || !/^[1-9]\d*$/.test(comment.author.id)) return null;
  const roots = [...doc.querySelectorAll<HTMLElement>('[data-testid="noteable-note-container"][id]')].filter((root) => root.id === comment.anchor && root.closest('[data-geld-ui], .note-body, [data-testid="description-content"]') === null);
  const root = roots.length === 1 ? roots[0] : undefined;
  if (root === undefined || root.querySelector('.note-body .note-text') === null) return null;
  const authors = root.querySelectorAll<HTMLAnchorElement>(':scope > .timeline-entry-inner > .timeline-content > .note-header > .note-header-info > a.author-name-link[data-user-id][data-username]');
  return authors.length === 1 && authors[0]?.dataset.userId === comment.author.id && authors[0].dataset.username === comment.author.login ? root : null;
}

export function readGitLabBotRequests(doc: Document, input: ProviderReviewInput, comments: readonly ProviderReviewComment[], signedIn: boolean, current: () => boolean): readonly ProviderBotRequest[] {
  const { subject } = input;
  if (subject.provider !== 'gitlab' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(subject.headSha)) return [];
  let reviewUrl: string;
  try { reviewUrl = providerReviewUrl(subject); } catch { return []; }
  const route = doc.URL.split('#')[0];
  const viewer = gitLabReviewIdentity(doc);
  const visit = { ...gitLabActionVisit(doc, subject.headSha), reviewUrl };
  const sameReview = (): boolean => {
    if (!current() || doc.URL.split('#')[0] !== route || gitLabReviewIdentity(doc) !== viewer) return false;
    try {
      const page = describeGitLabPage(new URL(doc.URL), doc);
      return page !== null && isProviderReviewPage(page) && page.url === reviewUrl && (page.headSha === null || page.headSha === subject.headSha);
    } catch { return false; }
  };
  if (!sameReview()) return [];
  return (input.bots ?? []).flatMap((bot): ProviderBotRequest[] => {
    const request = REQUESTS.find((request) => request.id === bot.id);
    if (request === undefined) return [];
    const sources = comments.filter((comment) => comment.author.id === bot.authorId && (bot.login === undefined || comment.author.login === bot.login)
      && sourceLink({ kind: 'comment', anchor: comment.anchor, author: comment.author.login, url: comment.url }, subject) === comment.url);
    const source = sources.find((comment) => nativeNote(comment, doc) !== null);
    if (source === undefined) return [];
    const root = nativeNote(source, doc);
    const valid = (): boolean => sameReview() && nativeNote(source, doc) === root;
    const comment = readGitLabMainCommentAction(doc, signedIn, visit);
    return [{ key: JSON.stringify([subject, bot.id, source.id, source.author.id, source.author.login, source.url]), botId: bot.id, label: request.label, sourceUrl: source.url, commands: request.commands,
      current: valid,
      comment: { available: valid() && comment.available, ...(comment.reason === undefined ? {} : { reason: comment.reason }), activate: async () => valid() && await comment.activate() && valid() },
    }];
  });
}
