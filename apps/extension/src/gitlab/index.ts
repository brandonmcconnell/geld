import { isProviderReviewPage } from '../providers/types';
import type { ProviderAdapter } from '../providers/types';
import { gitLabHeaderTargets, gitLabListRows, readGitLabDiff } from './diff';
import { describeGitLabPage } from './page';
import { fetchGitLabDiff } from './source';
import { fetchGitLabStandaloneDiff } from './standalone-source';
import { fetchGitLabReview } from './review';
import type { GitLabNativeThreadCapabilities } from './review';
import { readGitLabActions } from './actions';
import type { ProviderReviewComment } from '@geld/review';
import { readGitLabThreadActions, syncGitLabNativeReviewState } from './thread-actions';
import { fetchGitLabConfig } from './config';
import { renderGitLabComment } from './comment-render';

export const gitlabAdapter: ProviderAdapter = {
  id: 'gitlab',
  describe: describeGitLabPage,
  readDiff: readGitLabDiff,
  headerTargets: gitLabHeaderTargets,
  listRows: gitLabListRows,
  fetchDiff: (page, signal) => isProviderReviewPage(page) ? fetchGitLabDiff(page, signal) : fetchGitLabStandaloneDiff(page, signal),
  fetchConfig: fetchGitLabConfig,
  reviewHost: (doc) => doc.querySelector<HTMLElement>('.issuable-discussion .detail-page-description'),
  actionHost: (doc) => doc.querySelector('button[data-testid="review-drawer-toggle"]')?.parentElement ?? null,
  fetchReview: async (page, signal, doc) => {
    const snapshot = await fetchGitLabReview(page, signal, doc);
    const permissionsForNote = new Map<string, GitLabNativeThreadCapabilities>();
    for (const thread of snapshot.threadCapabilities.values()) {
      for (const note of thread.notes) permissionsForNote.set(note.noteId, thread);
    }
    return {
      ...snapshot,
      get input() { return syncGitLabNativeReviewState(snapshot.input, doc); },
      actions: readGitLabActions(doc, snapshot.capabilities),
      renderComment: (comment: ProviderReviewComment, host: HTMLElement) => renderGitLabComment(comment, host, doc),
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
