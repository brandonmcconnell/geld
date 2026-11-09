// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMatcher, DEFAULT_SETTINGS } from '@geld/core';
import { providerDiffSourceFacts } from './source-facts';
import type { ProviderNewFileRevision } from './source-facts';
import { providerFlowRevision } from './file-flow-source';
import { ProviderFileFlow } from './file-flow';
import type { ProviderAdapter, ProviderDiffResult, ProviderReviewPage } from './types';
import type { ProviderWholeSourceBody } from './whole-source';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const page: ProviderReviewPage = { provider: 'bitbucket', repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'team/project' }, number: '1', kind: 'overview', url: 'https://bitbucket.org/team/project/pull-requests/1', diffPageUrl: 'https://bitbucket.org/team/project/pull-requests/1/diff', diffUrl: '', headSha: head, version: head };
const files = [{ path: 'a.ts', additions: 2, deletions: 1, removedImports: ['./old'], status: 'modified' as const }, { path: 'b.ts', additions: 1, deletions: 0, status: 'added' as const }];
function result(owner: string | null = 'fork/project'): ProviderDiffResult {
  const facts = providerDiffSourceFacts(page, { kind: 'bitbucket-review', headSha: head, baseSha: base, sourceRepository: owner, topic: true }, files.map(file => ({ path: file.path, newPath: file.path })));
  if (facts === null) throw new Error('Invalid fixture');
  return { files, revision: head, complete: true, sourceFacts: facts };
}
let manager: ProviderFileFlow | null = null;
beforeEach(() => {
  window.location.href = page.url;document.body.replaceChildren();
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false;this.dispatchEvent(new Event('close')); });
});
afterEach(() => { manager?.clear();manager = null;vi.restoreAllMocks(); });

it('pins source reads to the observed fork and refuses missing or mismatched evidence', () => {
  expect(providerFlowRevision(page, result(), 'a.ts')).toMatchObject({ repository: { path: 'fork/project' }, headSha: head, path: 'a.ts' });
  expect(providerFlowRevision(page, result(null), 'a.ts')).toBeNull();
  expect(providerFlowRevision({ ...page, version: 'other' }, result(), 'a.ts')).toBeNull();
  expect(providerFlowRevision(page, { files, revision: head, complete: true }, 'a.ts')).toBeNull();
  expect(providerFlowRevision(page, result(), 'unlisted.ts')).toBeNull();
});

function fixture(read: NonNullable<ProviderAdapter['wholeTests']>['readSource']): HTMLElement {
  const host = document.createElement('main');document.body.append(host);
  const adapter: ProviderAdapter = { id: 'bitbucket', describe: () => page, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => result(), wholeTests: {
    readSource: read, createIntent: () => ({ button: document.createElement('button'), text: document.createElement('span') }), intentHost: () => null, contextOmitted: () => true, nextContext: () => null, paused: () => false,
  } };
  manager = new ProviderFileFlow(adapter);manager.update(page, host, result(), createMatcher(DEFAULT_SETTINGS), null);return host;
}

it('reads only after the reader opens Flow and draws imports from verified source text', async () => {
  const read = vi.fn(async (revision: ProviderNewFileRevision) => ({ lines: [revision.path === 'a.ts' ? "import './b';" : 'export const b = 1;'], bytes: 30 }));
  const host = fixture(read);expect(read).not.toHaveBeenCalled();host.querySelector('button')?.click();
  await vi.waitFor(() => expect(document.querySelector('[data-geld-flow-from="a.ts"][data-geld-flow-to="b.ts"]')).not.toBeNull());
  expect(read).toHaveBeenCalledTimes(2);
  for (const [revision] of read.mock.calls) expect(revision.repository.path).toBe('fork/project');
  expect(document.querySelector('[data-geld-flow-path="a.ts"]')?.getAttribute('href')).toBe(page.diffPageUrl);
  document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(document.querySelector('dialog')).toBeNull();expect(document.activeElement).toBe(host.querySelector('button'));
});

it('reports unreadable sources instead of claiming an empty dependency graph is complete', async () => {
  const host = fixture(async () => { throw new Error('Access denied'); });host.querySelector('button')?.click();
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('2 unavailable'));
  expect(document.querySelectorAll('[data-geld-flow-path]')).toHaveLength(2);
});

it('does not let a late source read reopen or update a closed dialog', async () => {
  let complete: (value: ProviderWholeSourceBody) => void = () => {};
  const read = vi.fn(() => new Promise<ProviderWholeSourceBody>(resolve => { complete = resolve; }));
  const host = fixture(read);host.querySelector('button')?.click();
  document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
  complete({ lines: ["import './b';"], bytes: 20 });await Promise.resolve();await Promise.resolve();
  expect(document.querySelector('dialog')).toBeNull();expect(read).toHaveBeenCalledOnce();
});
