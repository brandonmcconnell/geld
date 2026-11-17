import type { FileStats, PathMatcher } from '@geld/core';
import { repositoryKey } from '@geld/core';
import type { FlowFile, FlowHost } from '../review/flow';
import { closeFlow, openFlowDialog, setFlowSource } from '../review/flow';
import { element } from './dom';
import { digestIcon } from './digest-icons';
import { providerFlowRevision } from './file-flow-source';
import type { ProviderAdapter, ProviderDiffResult, ProviderDiffView, ProviderReviewPage } from './types';
import { isProviderReviewPage } from './types';
import './file-flow.css';

/** Anonymous provider APIs allow few requests an hour, so fewer files are read than on GitHub, one at a time. */
const MAX_READS = 32;

function flowFile(stats: FileStats, matcher: PathMatcher): FlowFile {
  return {
    path: stats.path,
    status: stats.status ?? 'modified',
    additions: stats.additions,
    deletions: stats.deletions,
    hiddenAs: matcher.categorizeFile(stats)?.title ?? null,
    removedImports: stats.removedImports ?? [],
  };
}

/**
 * The provider's side of the shared Flow dialog (`review/flow.ts`): the button in the digest's toolbar, the
 * changed files from the verified diff, reads at the verified head through the host's own source reader, and a
 * card leading to its file through the native file tree.
 */
export class ProviderFileFlow {
  private page: ProviderReviewPage | null = null;
  private result: ProviderDiffResult | null = null;
  private view: ProviderDiffView | null = null;
  private host: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private review = '';
  constructor(private readonly adapter: ProviderAdapter) {}

  update(page: ProviderReviewPage, host: HTMLElement | null, result: ProviderDiffResult | null, matcher: PathMatcher, view: ProviderDiffView | null, unavailable = 'Loading changed files…'): void {
    if (this.page !== null && (this.page.number !== page.number || repositoryKey(this.page.repository) !== repositoryKey(page.repository))) this.clear();
    this.page = page;
    this.result = result;
    this.view = view;
    this.review = JSON.stringify([repositoryKey(page.repository), page.number]);
    const flowHost = this.flowHost(page);
    if (result === null) {
      const loading = unavailable.startsWith('Loading');
      setFlowSource(flowHost, null, loading ? null : { review: this.review, text: unavailable, retrying: false, reload: true });
    } else {
      const notes: string[] = [];
      if (result.complete === false) notes.push('The changed-file list is partial, so some files and their links are missing.');
      setFlowSource(flowHost, {
        key: JSON.stringify([this.review, page.version, result.revision ?? null]),
        headKnown: true,
        files: result.files.map((stats) => flowFile(stats, matcher)),
        removed: result.files.some((file) => file.summaryOnly === true) ? 'unavailable' : 'known',
        notes,
      });
    }
    if (host !== this.host || this.button?.parentElement !== host) {
      this.button?.remove();
      this.host = host;
      this.button = null;
      if (host !== null) {
        const button = element('button', '', 'geld-provider-review__tool geld-provider-flow-button');
        button.type = 'button';
        button.title = 'Flow: how the changed files connect';
        button.setAttribute('aria-label', button.title);
        button.append(digestIcon('flow'), element('span', 'Flow', 'geld-provider-review__tool-label'));
        button.addEventListener('click', () => openFlowDialog(this.review, button));
        host.append(button);
        this.button = button;
      }
    }
  }

  clear(): void {
    if (this.page !== null) {
      closeFlow();
      setFlowSource(null, null);
    }
    this.button?.remove();
    this.button = null;
    this.host = null;
    this.page = null;
    this.result = null;
    this.view = null;
    this.review = '';
  }

  /**
   * A changed file's lines at the verified head, read through the host's own source reader (its admission and
   * cooldowns), or null when it cannot be had. Flow reads imports from it, and the AI triage the lines a fix rewrites.
   */
  async headLines(path: string, signal: AbortSignal = new AbortController().signal): Promise<readonly string[] | null> {
    const page = this.page;
    const read = this.adapter.wholeTests?.readSource;
    const result = this.result;
    if (page === null || read === undefined || result === null || !this.current(page)) return null;
    const source = providerFlowRevision(page, result, path);
    if (source === null) return null;
    const body = await read(source, signal, () => this.current(page) && !signal.aborted);
    return body.lines;
  }

  private current(page: ProviderReviewPage): boolean {
    const active = this.adapter.describe(new URL(window.location.href), document);
    const known = this.page;
    return known !== null && known.number === page.number && known.version === page.version && repositoryKey(known.repository) === repositoryKey(page.repository) && active !== null && isProviderReviewPage(active) && active.number === page.number && active.version === page.version
      && repositoryKey(active.repository) === repositoryKey(page.repository);
  }

  private flowHost(page: ProviderReviewPage): FlowHost {
    const provider = this.adapter.id;
    return {
      review: this.review,
      reviewNoun: provider === 'gitlab' ? 'merge request' : 'pull request',
      filesTab: provider === 'gitlab' ? 'Changes' : 'Files changed',
      // Nothing is read until someone opens the dialog: these reads count against the host's hourly allowance.
      concurrency: { prefetch: 0, open: 1 },
      maxReads: MAX_READS,
      read: async (path, signal) => {
        const lines = await this.headLines(path, signal);
        return lines === null ? null : lines.join('\n');
      },
      filesHref: () => new URL(page.diffPageUrl, window.location.href).href,
      fileHref: (path) => {
        const target = new URL(this.view?.tree.find((entry) => entry.path === path)?.link?.href ?? page.diffPageUrl, window.location.href);
        const anchor = this.view?.entries.find((entry) => entry.path === path)?.anchor;
        if (anchor) target.hash = anchor;
        return target.href;
      },
      navigate: (path) => this.view?.navigateToPath?.(path) === true,
      skin: { name: provider, dialog: 'geld-primer-bridge', button: 'geld-provider-toggle', closeButton: 'geld-provider-toggle geld-flow__close' },
    };
  }
}
