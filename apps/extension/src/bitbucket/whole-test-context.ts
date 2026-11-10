import { describeRepository, repositoryKey } from '@geld/core';
import { providerFullSha, providerNativeSourceElement, providerSourcePath } from '../providers/source-facts';
import type { ProviderNewFileRevision } from '../providers/source-facts';
import type { ProviderDiffEntry } from '../providers/types';
import { ProviderHttpAdmission } from '../providers/http-admission';
import { readProviderWholeSource } from '../providers/whole-source';
import type { ProviderNativeContextSource, ProviderNativeContextStep, ProviderWholeTestAdapter } from '../providers/whole-test-context';
import { bitbucketTransport, BitbucketTransportError } from './transport';
import type { BitbucketTransport } from './transport';
import { bitbucketPrepareSource, bitbucketPrepareContext } from './source-reference';

const headerSelector = '.diff-chunk > .diff-chunk-inner > .chunk-heading-wrapper';
const controlSelector = 'button[data-qa="pr-diff-show-more-lines-above"], button[data-qa="pr-diff-show-more-lines-below"]';

function headers(entry: ProviderDiffEntry): readonly HTMLElement[] {
  return [...entry.root.querySelectorAll<HTMLElement>(headerSelector)].filter((row) => providerNativeSourceElement(row)
    && row.closest('article[data-qa="branch-diff-file"]')?.parentElement?.parentElement === entry.root
    && row.querySelector('[data-qa="code-line"]') === null
    && [...row.querySelectorAll(controlSelector)].some((button) => providerNativeSourceElement(button.parentElement ?? button) && button.closest('.chunk-heading-wrapper') === row));
}

export function bitbucketWholeSourceURL(revision: ProviderNewFileRevision): URL {
  const { repository, headSha, path } = revision;
  const found = describeRepository(`${repository.origin}/${repository.path}`, 'bitbucket');
  if (repository.provider !== 'bitbucket' || repository.origin !== 'https://bitbucket.org' || found === null || repositoryKey(found) !== repositoryKey(repository)
    || !providerFullSha(headSha) || !providerSourcePath(path) || repository.path.split('/').some((part) => /[\s\\?#%\u0000-\u001f]/.test(part))) throw new Error('Unverified Bitbucket new source');
  return new URL(`/2.0/repositories/${repository.path.split('/').map(encodeURIComponent).join('/')}/src/${headSha}/${path.split('/').map(encodeURIComponent).join('/')}`, 'https://api.bitbucket.org');
}

export function bitbucketNextTestContext(entry: ProviderDiffEntry, missing: readonly number[], source?: ProviderNativeContextSource): ProviderNativeContextStep | null {
  const lines = entry.readLines?.() ?? [];
  for (const row of headers(entry)) {
    const at = lines.findIndex((line) => line.kind === 'hunk' && line.root === row);
    if (at < 0) continue;
    const beforeLine = lines.slice(0, at).findLast((line) => line.newLine !== null), afterLine = lines.slice(at + 1).find((line) => line.newLine !== null);
    const before = beforeLine?.newLine ?? null, after = afterLine?.newLine ?? null;
    const target = missing.find((line) => Number.isSafeInteger(line) && line > (before ?? 0) && line < (after ?? Number.POSITIVE_INFINITY));
    if (target === undefined) continue;
    const direction = before === null || after !== null && after - target < target - before ? 'above' : 'below';
    const buttons = [...row.querySelectorAll<HTMLButtonElement>(controlSelector)].filter((button) => button.dataset.qa === `pr-diff-show-more-lines-${direction}` && button.closest('.chunk-heading-wrapper') === row);
    if (buttons.length !== 1) continue;
    const button = buttons[0]!;const parent = button.parentElement;const article = row.closest('article[data-qa="branch-diff-file"]');
    let activated = false;
    const current = (): boolean => {
      if (!entry.root.isConnected || !row.isConnected || !button.isConnected || button.parentElement !== parent || article === null
        || row.closest('article[data-qa="branch-diff-file"]') !== article || article.parentElement?.parentElement !== entry.root
        || !providerNativeSourceElement(row) || parent === null || !providerNativeSourceElement(parent)
        || !row.matches(headerSelector) || button.closest('.chunk-heading-wrapper') !== row || button.disabled || button.getAttribute('aria-disabled') === 'true'
        || button.dataset.qa !== `pr-diff-show-more-lines-${direction}` || row.querySelector('[data-qa="code-line"]') !== null) return false;
      const matches = [...row.querySelectorAll(controlSelector)].filter((node) => node.getAttribute('data-qa') === button.dataset.qa && node.closest('.chunk-heading-wrapper') === row);
      if (matches.length !== 1 || matches[0] !== button) return false;
      const latest = entry.readLines?.() ?? [];const index = latest.findIndex((line) => line.kind === 'hunk' && line.root === row);
      const previous = latest.slice(0, index).findLast((line) => line.newLine !== null), following = latest.slice(index + 1).find((line) => line.newLine !== null);
      return index >= 0 && previous?.root === beforeLine?.root && following?.root === afterLine?.root && (previous?.newLine ?? null) === before && (following?.newLine ?? null) === after;
    };
    return { current, activate: () => {
      if (activated || !current()) return;
      if (source?.revision.provenance === 'provider-resolved-native-reference' && !bitbucketPrepareContext(entry, button, before, after, source)) return;
      activated = true;button.click();
    } };
  }
  return null;
}

export function createBitbucketWholeTestAdapter(admission = new ProviderHttpAdmission(), transport: BitbucketTransport = bitbucketTransport, fetcher: typeof fetch = (...args) => fetch(...args)): ProviderWholeTestAdapter {
  return {
    keepIntentFocusable: true,
    prepareSource: bitbucketPrepareSource,
    createIntent: (doc) => { const button = doc.createElement('button');button.className = 'geld-provider-toggle';const text = doc.createElement('span');button.append(text);return { button, text }; },
    readSource: (revision, signal, current) => {
      const url = bitbucketWholeSourceURL(revision);
      return admission.run(revision.repository.origin, { signal, priority: 0, current }, async () => {
        try {
          const response = await transport.fetch(url, { signal, headers: { Accept: 'text/plain' } }, fetcher);
          if (response.url !== '' && response.url !== url.href) { await response.body?.cancel().catch(() => undefined);throw new Error('Bitbucket source context changed'); }
          const body = await readProviderWholeSource(response, signal);if (!current()) throw new Error('Bitbucket source context changed');return body;
        } catch (error: unknown) {
          if (error instanceof BitbucketTransportError && error.reason === 'rate-limited') throw Object.assign(error, { status: 429, retryAfter: String((error.retryAfterMs ?? 60 * 60_000) / 1000) });
          throw error;
        }
      });
    },
    paused: (origin) => admission.paused(origin),
    contextOmitted: (entry) => headers(entry).length > 0,
    intentHost: (entry) => {
      const hosts = [...entry.root.querySelectorAll<HTMLElement>('article[data-qa="branch-diff-file"] [data-qa="bk-file__header"][data-testid="file-header"] [data-qa="bk-file__actions"][data-testid="file-actions"]')]
        .filter((node) => providerNativeSourceElement(node) && node.closest('article[data-qa="branch-diff-file"]')?.parentElement?.parentElement === entry.root);
      return hosts.length === 1 ? hosts[0]! : null;
    },
    nextContext: bitbucketNextTestContext,
  };
}
