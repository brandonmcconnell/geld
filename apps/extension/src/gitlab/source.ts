import { parseUnifiedDiff } from '@geld/core';
import type { FileStats } from '@geld/core';
import type { ProviderDiffResult, ProviderReviewPage } from '../providers/types';
import { record, selection, SHA } from './page';

const MAX_BYTES = 20 * 1024 * 1024;

export async function readGitLabDiffResource(url: URL, signal: AbortSignal, cache?: RequestCache): Promise<string> {
  const response = await fetch(url, { credentials: 'same-origin', signal, ...(cache === undefined ? {} : { cache }), headers: { Accept: url.searchParams.get('format') === 'diff' || url.pathname.endsWith('.diff') ? 'text/plain' : 'application/json' } });
  if (!response.ok) {
    const error = new Error(response.status === 401 || response.status === 403 ? 'Sign in to GitLab to read these changes' : `GitLab answered HTTP ${response.status}`);
    throw Object.assign(error, { retryAfter: response.headers.get('retry-after') });
  }
  if (response.url && /\/users\/sign_in(?:[/?#]|$)/.test(new URL(response.url).pathname)) throw new Error('Sign in to GitLab to read these changes');
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('GitLab diff too large');
  const reader = response.body?.getReader();
  let text = '';
  if (reader === undefined) text = await response.text();
  else {
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error('GitLab diff too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  }
  if (text.length > MAX_BYTES) throw new Error('GitLab diff too large');
  if (/text\/html/i.test(response.headers.get('content-type') ?? '') || /^\s*<(?:!doctype|html|head|body)\b/i.test(text)) throw new Error('GitLab returned a page instead of changes');
  return text;
}

export async function readGitLabDiffJson(url: URL, signal: AbortSignal, cache?: RequestCache): Promise<unknown> {
  const text = await readGitLabDiffResource(url, signal, cache);
  try { return JSON.parse(text); } catch { throw new Error('GitLab returned invalid change metadata'); }
}

function endpoint(page: ProviderReviewPage, suffix: string, params: URLSearchParams): URL {
  const url = new URL(`${page.url}/${suffix}`);
  url.search = params.toString();
  return url;
}

function chosen(value: unknown, key: string): Record<string, unknown> | null {
  if (!record(value) || !Array.isArray(value[key])) return null;
  for (const candidate of value[key]) {
    const entry: unknown = candidate;
    if (record(entry) && entry.selected === true) return entry;
  }
  return null;
}

export function gitLabMetadataCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function gitLabMetadataFiles(value: unknown): readonly FileStats[] | null {
  if (!Array.isArray(value)) return null;
  const result: FileStats[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.new_path !== 'string' || item.new_path.length === 0) return null;
    const additions = gitLabMetadataCount(item.added_lines);
    const deletions = gitLabMetadataCount(item.removed_lines);
    if (additions === null || deletions === null) return null;
    result.push({ path: item.new_path, additions, deletions, status: item.new_file === true ? 'added' : item.deleted_file === true ? 'deleted' : typeof item.old_path === 'string' && item.old_path !== item.new_path ? 'renamed' : 'modified' });
  }
  return result;
}

export async function fetchGitLabDiff(page: ProviderReviewPage, signal: AbortSignal): Promise<ProviderDiffResult> {
  const params = selection(new URL(page.diffPageUrl));
  if (params.has('only_context_commits')) throw new Error('GitLab context-only comparisons are unavailable');
  const metadata = await readGitLabDiffJson(endpoint(page, 'diffs_metadata.json', params), signal);
  if (!record(metadata)) throw new Error('GitLab change metadata is unavailable');
  const summaries = gitLabMetadataFiles(metadata.diff_files);
  if (summaries === null) throw new Error('GitLab change metadata is incomplete');
  const selected = record(metadata.merge_request_diff) ? metadata.merge_request_diff : null;
  const selectedPath = typeof selected?.version_path === 'string' ? new URL(selected.version_path, page.url) : null;
  const diffId = selectedPath?.searchParams.get('diff_id');
  const commit = params.get('commit_id');
  if (commit === null && params.has('diff_id') && diffId !== params.get('diff_id')) throw new Error('GitLab returned a different diff version');
  if (diffId !== null && diffId !== undefined) params.set('diff_id', diffId);
  let head: string;
  let base: string;
  if (commit !== null) {
    const selectedCommit = record(metadata.commit) ? metadata.commit : null;
    const parents = selectedCommit?.parent_ids;
    if (selectedCommit?.id !== commit || !Array.isArray(parents)) throw new Error('GitLab selected commit is unavailable');
    const parent: unknown = parents[0];
    head = commit;
    base = typeof parent === 'string' && SHA.test(parent) ? parent : commit;
  } else {
    const versions = await readGitLabDiffJson(endpoint(page, 'versions', params), signal);
    const source = chosen(versions, 'source_versions');
    const target = chosen(versions, 'target_versions');
    const candidateHead = source?.head_sha;
    const candidateBase = params.get('start_sha') ?? source?.base_sha;
    if (params.has('start_sha') && target?.start_sha !== params.get('start_sha')) throw new Error('GitLab returned a different comparison base');
    if (typeof candidateHead !== 'string' || !SHA.test(candidateHead) || typeof candidateBase !== 'string' || !SHA.test(candidateBase) || (diffId !== undefined && diffId !== null && String(source?.id) !== diffId) || target === null) throw new Error('GitLab selected diff revisions are unavailable');
    head = candidateHead.toLowerCase();
    base = candidateBase.toLowerCase();
  }
  if (page.headSha !== null && page.headSha !== head) throw new Error('GitLab changes advanced to another revision');
  // MR .diff ignores diff_id and start_sha, so compare the selected immutable refs instead.
  const rawUrl = commit === null
    ? new URL(`${page.repository.origin}/${page.repository.path}/-/compare/${base}...${head}`)
    : new URL(`${page.repository.origin}/${page.repository.path}/-/commit/${head}.diff`);
  if (commit === null) {
    rawUrl.searchParams.set('format', 'diff');
    rawUrl.searchParams.set('straight', 'true');
  }
  if (params.has('w')) rawUrl.searchParams.set('w', params.get('w') ?? '0');
  const raw = await readGitLabDiffResource(rawUrl, signal);
  if (raw.trim() !== '' && !/^diff --git /m.test(raw)) throw new Error('GitLab returned invalid diff content');
  const files = parseUnifiedDiff(raw);
  const expected = new Map(summaries.map((file) => [file.path, file]));
  const parsed = new Set(files.map((file) => file.path));
  const complete = metadata.render_overflow_warning !== true && gitLabMetadataCount(metadata.real_size) === summaries.length && gitLabMetadataCount(metadata.size) === summaries.length && summaries.length === expected.size && files.length === parsed.size && files.length === summaries.length && files.every((file) => {
    const summary = expected.get(file.path);
    return summary !== undefined && file.additions === summary.additions && file.deletions === summary.deletions;
  });
  const patches = new Map<string, string>();
  for (const patch of raw.split(/(?=^diff --git )/m)) {
    const first = parseUnifiedDiff(patch)[0];
    if (first !== undefined) patches.set(first.path, patch);
  }
  return { files, complete, revision: `${diffId ?? 'commit'}:${base}:${head}:${params.get('w') ?? '0'}`, patches };
}
