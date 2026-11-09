import { gitLabAttachmentLink } from './attachment';
import type { ProviderCommentRenderContext } from '../providers/comment-render';
import { isProviderReviewPage } from '../providers/types';
import type { ProviderAdapter } from '../providers/types';
import { gitLabFlowHost, gitLabHeaderTargets, readGitLabDiff } from './diff';
import { gitLabListRows } from './list-surfaces';
import { describeGitLabPage } from './page';
import { fetchGitLabDiff } from './source';
import { fetchGitLabStandaloneDiff } from './standalone-source';
import { fetchGitLabReview } from './review';
import type { GitLabNativeThreadCapabilities } from './review';
import { gitLabActionVisit, readGitLabActions } from './actions';
import type { ProviderReviewComment } from '@geld/review';
import { readGitLabThreadActions, syncGitLabNativeReviewState } from './thread-actions';
import { fetchGitLabConfig } from './config';
import { renderGitLabComment } from './comment-render';
import { gitLabConversationRoots, gitLabPersonRoots, gitLabDescriptionHost } from './conversation';
import { createGitLabAuthorPresentationReader } from './author-presentation';
import { gitLabReferenceAnchor, readGitLabReferences } from './references';
import { readGitLabBotRequests } from './bot-request';
import { readGitLabReviewerControls } from './reviewer-controls';
import { readGitLabOpenReview } from './open-review';
import { ProviderHttpAdmission } from '../providers/http-admission';
import { createGitLabWholeTestAdapter } from './whole-test-context';
import { GitLabNativeWhitespace } from './native-whitespace';
import { createGitLabDiffSyntax } from './diff-syntax';

export const gitlabAdapter: ProviderAdapter = {
  id: 'gitlab',
  attachmentLink: gitLabAttachmentLink,
  createNativeView: (doc, changed, choice) => new GitLabNativeWhitespace(doc, changed, choice),
  diffSyntax: createGitLabDiffSyntax(),
  describe: describeGitLabPage,
  readDiff: readGitLabDiff,
  headerTargets: gitLabHeaderTargets,
  diffFlowHost: gitLabFlowHost,
  listRows: gitLabListRows,
  readReferences: readGitLabReferences,
  referenceAnchor: gitLabReferenceAnchor,
  conversationRoots: gitLabConversationRoots,
  personRoots: gitLabPersonRoots,
  descriptionHost: gitLabDescriptionHost,
  fetchDiff: (page, signal) => isProviderReviewPage(page) ? fetchGitLabDiff(page, signal) : fetchGitLabStandaloneDiff(page, signal),
  fetchConfig: fetchGitLabConfig,
  reviewHost: (doc) => doc.querySelector<HTMLElement>('.issuable-discussion .detail-page-description'),
  actionHost: (doc) => doc.querySelector('button[data-testid="review-drawer-toggle"]')?.parentElement ?? null,
  fetchReview: async (page, signal, doc) => {
    const actionVisit = gitLabActionVisit(doc);
    const snapshot = await fetchGitLabReview(page, signal, doc);
    const authorPresentation = createGitLabAuthorPresentationReader(snapshot.input, snapshot.comments, doc);
    const permissionsForNote = new Map<string, GitLabNativeThreadCapabilities>();
    for (const thread of snapshot.threadCapabilities.values()) {
      for (const note of thread.notes) permissionsForNote.set(note.noteId, thread);
    }
    return {
      ...snapshot,
      botRequests: (input, comments, current) => readGitLabBotRequests(doc, input, comments, snapshot.capabilities.signedIn, current),
      get input() { return syncGitLabNativeReviewState(snapshot.input, doc); },
      get reviewerControls() { return readGitLabReviewerControls(doc, snapshot.reviewerScope, { ...actionVisit, url: doc.URL.split('#')[0] ?? doc.URL }, snapshot.complete); },
      get actions() {
        const visit = { ...actionVisit, url: doc.URL.split('#')[0] ?? doc.URL, headSha: snapshot.input.subject.headSha, reviewUrl: page.url };
        const actions = readGitLabActions(doc, snapshot.capabilities, visit);
        const open = readGitLabOpenReview(doc, snapshot.reviewerScope, visit, snapshot.complete && snapshot.capabilities.signedIn, snapshot);
        return open === null ? actions : [...actions, open];
      },
      renderComment: (comment: ProviderReviewComment, host: HTMLElement, context?: ProviderCommentRenderContext) => renderGitLabComment(comment, host, doc, snapshot.renderedNotes.get(comment.id), context === undefined ? undefined : {
        ...context,
        current: () => {
          if (!context.current()) return false;
          const current = describeGitLabPage(new URL(doc.URL), doc);
          return current !== null && isProviderReviewPage(current) && current.kind === page.kind && current.number === page.number
            && current.repository.origin === snapshot.input.subject.origin && current.repository.path === snapshot.input.subject.repository
            && current.headSha === snapshot.input.subject.headSha && current.version === page.version;
        },
      }),
      authorPresentation,
      sourceActions: (comment: ProviderReviewComment) => {
        const permissions = permissionsForNote.get(comment.id);
        if (permissions === undefined) return [];
        return readGitLabThreadActions(doc, { discussionId: permissions.discussionId, noteId: comment.id, url: comment.url }, permissions, {
          signedIn: snapshot.capabilities.signedIn,
          onReveal: (target) => {
            const original = doc.getElementById(`note_${target.noteId}`);
            if (original === null || original.closest('[data-geld-ui]') !== null) return false;
            original.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return true;
          },
        });
      },
    };
  },
};

export function createGitLabAdapter(admission = new ProviderHttpAdmission()): ProviderAdapter {
  return { ...gitlabAdapter, wholeTests: createGitLabWholeTestAdapter(admission), fetchDiff: (page, signal) => isProviderReviewPage(page) ? fetchGitLabDiff(page, signal, admission) : fetchGitLabStandaloneDiff(page, signal, admission) };
}
