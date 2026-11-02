import { describeRepository, repositoryKey } from '@geld/core';
import { providerFullSha, providerNativeSourceElement, providerSourcePath } from '../providers/source-facts';
import type { ProviderNewFileRevision } from '../providers/source-facts';
import type { ProviderDiffEntry } from '../providers/types';
import { ProviderHttpAdmission } from '../providers/http-admission';
import { readProviderWholeSource } from '../providers/whole-source';
import type { ProviderWholeTestAdapter, ProviderNativeContextStep } from '../providers/whole-test-context';

const controls = 'button[data-click="expandLines"][data-expand-direction="up"],button[data-click="expandLines"][data-expand-direction="down"],button[data-click="expandLines"][data-expand-direction="both"]';
const forbidden = '[data-geld-ui],.note,.note-text,.md,[data-testid="noteable-note-container"],form,textarea,[contenteditable],dialog,[role="dialog"]';
function headers(entry: ProviderDiffEntry): readonly HTMLElement[] {
  return [...entry.root.querySelectorAll<HTMLElement>('table.rd-text-view-root tr.rd-hunk-header[data-hunk-header]')].filter((row) => row.closest(forbidden) === null && row.closest('diff-file') === entry.root && row.querySelector(controls) !== null && row.querySelector('.rd-line-content') === null);
}

export function gitLabWholeSourceURL(revision: ProviderNewFileRevision): URL {
  const { repository, headSha, path } = revision;
  const found = describeRepository(`${repository.origin}/${repository.path}/-/`, 'gitlab');
  if (repository.provider !== 'gitlab' || found === null || repositoryKey(found) !== repositoryKey(repository) || !providerFullSha(headSha) || !providerSourcePath(path)) throw new Error('Unverified GitLab new source');
  return new URL(`/${repository.path.split('/').map(encodeURIComponent).join('/')}/-/raw/${headSha}/${path.split('/').map(encodeURIComponent).join('/')}`, repository.origin);
}

export function gitLabNextTestContext(entry: ProviderDiffEntry, missing: readonly number[]): ProviderNativeContextStep | null {
  const rows = entry.readLines?.() ?? [];
  for (const row of headers(entry)) {
    const index = rows.findIndex((line) => line.kind === 'hunk' && line.root === row);if (index < 0) continue;
    const beforeLine = rows.slice(0, index).findLast((line) => line.newLine !== null), afterLine = rows.slice(index + 1).find((line) => line.newLine !== null);
    const before = beforeLine?.newLine ?? null, after = afterLine?.newLine ?? null;
    if (!missing.some((line) => line > (before ?? 0) && line < (after ?? Number.POSITIVE_INFINITY))) continue;
    const direction = before === null ? 'up' : after === null ? 'down' : 'both';
    const matches = [...row.querySelectorAll<HTMLButtonElement>(controls)].filter((button) => button.closest('tr') === row && button.closest(forbidden) === null && button.dataset.expandDirection === direction);
    if (matches.length !== 1) continue;
    const button = matches[0]!;const table = row.closest('table');
    let previousRows: ReadonlySet<Element> | null = null;
    const current = (): boolean => {
      if (!row.matches('tr.rd-hunk-header[data-hunk-header]') || row.querySelector('.rd-line-content') !== null || button.closest(forbidden) !== null || table?.matches('table.rd-text-view-root') !== true || !entry.root.isConnected || !row.isConnected || button.closest('tr') !== row || row.closest('diff-file') !== entry.root || row.closest('table') !== table || !row.contains(button) || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.dataset.click !== 'expandLines' || button.dataset.expandDirection !== direction) return false;
      const latest = entry.readLines?.() ?? [];const at = latest.findIndex((line) => line.kind === 'hunk' && line.root === row);
      return at >= 0 && (latest.slice(0, at).findLast((line) => line.newLine !== null)?.newLine ?? null) === before && (latest.slice(at + 1).find((line) => line.newLine !== null)?.newLine ?? null) === after;
    };
    return {
      current, activate: () => { if (previousRows === null && current()) { previousRows = new Set(entry.root.querySelectorAll('tr'));button.click(); } },
      insertedFocus: (target) => {
        if (previousRows === null || !target.matches('a.rd-line-link[data-line-number]') || !target.isConnected || !providerNativeSourceElement(target) || target.closest(forbidden) !== null || target.closest('diff-file') !== entry.root) return null;
        const cell = target.parentElement, line = cell?.parentElement;
        if (!cell?.matches('td.rd-line-number[data-position="old"],td.rd-line-number[data-position="new"]') || !line?.matches('tr.rd-hunk-lines-inline,tr.rd-hunk-lines-parallel')
          || previousRows.has(line) || line.closest('table') !== table || !table?.isConnected || line.closest('diff-file') !== entry.root || !line.parentElement?.matches('tbody.rd-text-view-content')) return null;
        for (const [boundary, following] of [[beforeLine?.root, line], [line, afterLine?.root]]) {
          if (boundary === undefined || following === undefined) continue;
          if (!boundary.isConnected || !following.isConnected || boundary.closest('table') !== table || following.closest('table') !== table
            || !(boundary.compareDocumentPosition(following) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
        }
        for (const side of ['old', 'new']) {
          const cells = [...line.children].filter((node) => node.matches(`td.rd-line-number[data-position="${side}"]`));if (cells.length > 1) return null;
          const anchors = [...cells[0]?.querySelectorAll('a[data-line-number]') ?? []];
          if (anchors.length > 1 || anchors.some((anchor) => anchor.parentElement !== cells[0] || !anchor.matches('a.rd-line-link') || !/^[1-9]\d*$/.test(anchor.getAttribute('data-line-number') ?? '') || !Number.isSafeInteger(Number(anchor.getAttribute('data-line-number'))))) return null;
        }
        if (cell.querySelectorAll('a[data-line-number]').length !== 1) return null;
        if (line.querySelectorAll('td.rd-line-number').length !== [...line.children].filter((node) => node.matches('td.rd-line-number[data-position="old"],td.rd-line-number[data-position="new"]')).length) return null;
        const code = [...line.children].filter((node) => node.matches('td.rd-line-content'));
        if (line.classList.contains('rd-hunk-lines-parallel') ? code.length !== 2 || ['old', 'new'].some((side) => code.filter((node) => node.getAttribute('data-position') === side).length !== 1) : code.length !== 1) return null;
        const readings = entry.readLines?.().filter((item) => item.root === line && item.newLine !== null && item.newText !== null) ?? [], reading = readings[0];
        return readings.length === 1 && reading !== undefined && reading.newLine !== null && reading.newText !== null && missing.includes(reading.newLine)
          && reading.newLine > (before ?? 0) && reading.newLine < (after ?? Number.POSITIVE_INFINITY) ? { row: line, newLine: reading.newLine, newText: reading.newText } : null;
      },
    };
  }
  return null;
}

export function createGitLabWholeTestAdapter(admission: ProviderHttpAdmission, fetcher: typeof fetch = (...args) => fetch(...args)): ProviderWholeTestAdapter {
  return {
    createIntent: (doc) => { const button = doc.createElement('button');button.className = 'btn btn-default btn-sm gl-button';const text = doc.createElement('span');text.className = 'gl-button-text';button.append(text);return { button, text }; },
    readSource: (revision, signal, current) => {
      const url = gitLabWholeSourceURL(revision);
      return admission.run(url.origin, { signal, priority: 0, current }, async () => {
        const response = await fetcher(url, { signal, credentials: 'same-origin', redirect: 'error', headers: { Accept: 'text/plain' } });
        if (response.redirected || response.url && new URL(response.url).href !== url.href) { await response.body?.cancel().catch(() => undefined);throw new Error('GitLab source context redirected'); }
        const body = await readProviderWholeSource(response, signal);if (!current()) throw new Error('GitLab source context changed');return body;
      });
    },
    paused: (origin) => admission.paused(origin),
    contextOmitted: (entry) => headers(entry).length > 0,
    intentHost: (entry) => {
      const matches = [...entry.root.querySelectorAll<HTMLElement>('header[data-testid="rd-diff-file-header"][aria-label="Diff file controls"] > .rd-diff-file-info')].filter((node) => node.closest(forbidden) === null && node.closest('diff-file') === entry.root);
      return matches.length === 1 ? matches[0]! : null;
    },
    nextContext: gitLabNextTestContext,
  };
}
