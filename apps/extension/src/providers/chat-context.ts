import type { GeldSettings } from '@geld/core';
import type { ProviderReviewInput, ReviewItem } from '@geld/review';
import { isOpenStatus, providerReviewKey, providerReviewUrl } from '@geld/review';
import type { ChatPageContext } from '../review/chat-sidebar';
import { authorLabels } from '../github/review/panel-model';

const HOSTS: Readonly<Record<string, { readonly name: string; readonly noun: string }>> = {
  gitlab: { name: 'GitLab', noun: 'merge request' },
  bitbucket: { name: 'Bitbucket', noun: 'pull request' },
};

/**
 * What the chat sidebar reads of a GitLab or Bitbucket review, as GitHub's digest hands it the pull request: the key
 * its chat is kept under, the review's address, its words and findings, and the provider's colours for the view.
 */
export function providerChatContext(
  input: ProviderReviewInput,
  items: readonly ReviewItem[],
  settings: GeldSettings,
  intent: (() => { readonly title: string; readonly description: string }) | undefined,
): ChatPageContext {
  const url = providerReviewUrl(input.subject);
  const host = HOSTS[input.subject.provider];
  return {
    pageKey: `provider:${providerReviewKey(input.subject)}`,
    pullPath: new URL(url).pathname,
    prUrl: url,
    linkedAgents: [],
    preferCursor: settings.codingAgent === 'cursor' || settings.codingAgent === 'auto',
    ai: { enabled: settings.aiEnabled, baseUrl: settings.aiBaseUrl, model: settings.aiModel },
    hostClass: 'geld-primer-bridge',
    pull: () => {
      const words = intent?.() ?? { title: '', description: '' };
      return {
        url,
        title: words.title,
        author: null,
        description: words.description,
        findings: items.map((item) => ({ title: item.title, ...(item.path === undefined ? {} : { path: item.path }), ...(item.line === undefined ? {} : { line: item.line }), open: isOpenStatus(item.status), authors: authorLabels(item) })),
        files: [],
        ...(host === undefined ? {} : { host }),
      };
    },
  };
}
