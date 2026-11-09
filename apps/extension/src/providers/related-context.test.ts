// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { ProviderAdapter, ProviderReviewPage, ProviderReviewSnapshot } from './types';
import { ProviderRelatedContext, providerRelatedHost, providerRelatedLinks } from './related-context';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://geld${path}` } } }));

const repository = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/project' } as const;
const page: ProviderReviewPage = { provider: 'gitlab', repository, number: '1', kind: 'overview', url: 'https://gitlab.com/group/project/-/merge_requests/1', diffUrl: '', diffPageUrl: '', headSha: 'a'.repeat(40), version: 'a'.repeat(40) };
const subject = { provider: 'gitlab', origin: repository.origin, repository: repository.path, id: '1', headSha: 'a'.repeat(40) } as const;
const comment = { id: '2', anchor: 'note_2', url: `${page.url}#note_2`, author: { id: 'native-bot', login: 'project_123_bot' }, body: '[Review](https://app.coderabbit.ai/change-stack/project/42)', createdAt: '2026-11-09T00:00:00Z' };
const snapshot: ProviderReviewSnapshot = { input: { subject, threads: [], bots: [{ id: 'coderabbit', authorId: 'native-bot' }] }, comments: [comment], events: [], complete: true, unavailable: [], approvalsRequired: null, approvalsLeft: null, actions: [] };

beforeEach(() => { document.body.replaceChildren(); window.location.href = page.url; });

it('renders external context and description-only native work in the qualified sidebar', () => {
  document.body.innerHTML = `<div id="description"><a href="https://linear.app/team/issue/ENG-12/fix-cache">ENG-12</a><a href="${page.url}?tab=notes#note_9">Self</a><pre><a href="https://linear.app/team/issue/ENG-99/example">Example</a></pre></div><aside data-testid="issuable-sidebar" data-issuable-type="merge_request"><p>Native reviewers</p></aside>`;
  const target = { provider: 'gitlab' as const, origin: repository.origin, repository: repository.path, projectId: '3', nativeId: '9', number: '2', kind: 'merge-request' as const, url: 'https://gitlab.com/group/project/-/merge_requests/2' };
  const adapter: ProviderAdapter = { id: 'gitlab', describe: () => page, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => ({ files: [], revision: page.version, complete: true }), descriptionHost: () => document.getElementById('description'), readReferences: () => [{ id: 'native', direction: 'outgoing', label: '!2', title: null, target, source: { reviewUrl: page.url, anchor: null } }] };
  const context = new ProviderRelatedContext(adapter);
  context.update(page, DEFAULT_SETTINGS, document);
  const sidebar = document.querySelector('aside');
  expect(sidebar?.querySelector('[aria-label="Related links"]')?.textContent).toContain('ENG-12');
  expect(sidebar?.querySelector('[aria-label="Related work"]')?.textContent).toContain('!2');
  expect(sidebar?.textContent).not.toContain('ENG-99');expect(sidebar?.textContent).not.toContain('Self');
  context.update(page, { ...DEFAULT_SETTINGS, relatedLinks: false }, document);
  expect(sidebar?.querySelector('[data-geld-related]')).toBeNull();expect(sidebar?.textContent).toBe('Native reviewers');
});

it('trusts native bot IDs and ignores forged aliases and fenced examples', () => {
  expect(providerRelatedLinks(page, null, snapshot)[0]?.service).toBe('CodeRabbit');
  expect(providerRelatedLinks(page, null, { ...snapshot, input: { ...snapshot.input, bots: [] }, comments: [{ ...comment, author: { id: 'impostor', login: 'coderabbitai[bot]' } }] })).toEqual([]);
  expect(providerRelatedLinks(page, null, { ...snapshot, comments: [{ ...comment, body: `\`\`\`md\n${comment.body}\n\`\`\`` }] })).toEqual([]);
  expect(providerRelatedLinks(page, null, snapshot, ['gitlab:project_123_bot'])).toEqual([]);
  expect(providerRelatedLinks(page, null, snapshot, ['gitlab:project_123_bot'], new Set(['native-bot']))[0]?.service).toBe('CodeRabbit');
});

it('ignores dependency-update context and preserves Bitbucket sidebar ownership', () => {
  const body = document.createElement('div');body.innerHTML = 'This MR contains the following updates:<a href="https://linear.app/team/issue/ENG-12/fix-cache">ENG-12</a>';
  expect(providerRelatedLinks(page, body)).toEqual([]);
  document.body.innerHTML = '<aside><div data-testid="pr-cards-list"><section aria-label="Review status"></section></div></aside>';
  expect(providerRelatedHost('bitbucket', document)).toBe(document.querySelector('[data-testid="pr-cards-list"]'));
});
