import { describeRepository, parseUnifiedDiff, repositoryKey } from '@geld/core';
import type { ProviderDiffResult, ProviderStandalonePage } from '../providers/types';
import { record, SHA } from './page';
import { gitLabMetadataCount, gitLabMetadataFiles, readGitLabDiffJson, readGitLabDiffResource } from './source';

function whitespace(page: ProviderStandalonePage): string | null {
  const value = new URL(page.diffPageUrl).searchParams.get('w');
  return value === '0' || value === '1' ? value : null;
}

async function resolveRef(page: ProviderStandalonePage, ref: string, signal: AbortSignal, project = encodeURIComponent(page.repository.path)): Promise<string> {
  if (SHA.test(ref)) return ref.toLowerCase();
  const url = new URL(`/api/v4/projects/${project}/repository/commits/${encodeURIComponent(ref)}`, page.repository.origin);
  const value = await readGitLabDiffJson(url, signal);
  if (!record(value) || typeof value.id !== 'string' || !SHA.test(value.id) || (/^[0-9a-f]{7,64}$/i.test(ref) && !value.id.toLowerCase().startsWith(ref.toLowerCase()))) throw new Error('GitLab did not resolve the selected revision');
  return value.id.toLowerCase();
}

export async function fetchGitLabStandaloneDiff(page: ProviderStandalonePage, signal: AbortSignal): Promise<ProviderDiffResult> {
  const repository = describeRepository(page.url, 'gitlab');
  if (page.provider !== 'gitlab' || repository === null || repositoryKey(repository) !== repositoryKey(page.repository)) throw new Error('Invalid GitLab standalone diff identity');
  const root = `${repository.origin}/${repository.path.split('/').map(encodeURIComponent).join('/')}/-/`;
  let head: string;
  let base: string | null;
  let metadataUrl: URL;
  let statsUrl: URL;
  let rawUrl: URL;
  if (page.kind === 'commit') {
    head = await resolveRef(page, page.ref, signal);
    base = null;
    metadataUrl = new URL(`${root}commit/${head}/diff_files_metadata`);
    statsUrl = new URL(`${root}commit/${head}/diffs_stats`);
    rawUrl = new URL(`${root}commit/${head}.diff`);
  } else {
    const target = page.targetProjectId;
    if (target !== undefined && !/^[1-9]\d*$/.test(target)) throw new Error('Invalid GitLab comparison project');
    [base, head] = await Promise.all([resolveRef(page, page.from, signal, target), resolveRef(page, page.to, signal)]);
    metadataUrl = new URL(`${root}compare/diff_files_metadata`);
    statsUrl = new URL(`${root}compare/diffs_stats`);
    rawUrl = new URL(`${root}compare/${base}...${head}`);
    rawUrl.searchParams.set('format', 'diff');
    for (const url of [metadataUrl, statsUrl]) { url.searchParams.set('from', base); url.searchParams.set('to', head); }
    for (const url of [metadataUrl, statsUrl, rawUrl]) {
      if (page.straight) url.searchParams.set('straight', 'true');
      if (target !== undefined) url.searchParams.set('from_project_id', target);
    }
  }
  if (page.headSha !== null && page.headSha !== head) throw new Error('GitLab selected revision changed while loading');
  const w = whitespace(page);
  if (w !== null) for (const url of [metadataUrl, statsUrl, rawUrl]) url.searchParams.set('w', w);
  const [metadata, statistics, patch] = await Promise.all([readGitLabDiffJson(metadataUrl, signal), readGitLabDiffJson(statsUrl, signal), readGitLabDiffResource(rawUrl, signal)]);
  if (!record(metadata) || !record(statistics) || !record(statistics.diffs_stats)) throw new Error('GitLab standalone change metadata is unavailable');
  const summaries = gitLabMetadataFiles(metadata.diff_files);
  if (summaries === null) throw new Error('GitLab standalone file metadata is incomplete');
  if (patch.trim() !== '' && !/^diff --git /m.test(patch)) throw new Error('GitLab returned invalid standalone diff content');
  const files = parseUnifiedDiff(patch);
  const stats = statistics.diffs_stats;
  const expected = new Map(summaries.map((file) => [file.path, file]));
  const parsed = new Set(files.map((file) => file.path));
  const complete = metadata.render_overflow_warning !== true && statistics.render_overflow_warning !== true
    && gitLabMetadataCount(stats.real_size) === summaries.length && gitLabMetadataCount(stats.diffs_count) === summaries.length
    && gitLabMetadataCount(stats.added_lines) === summaries.reduce((sum, file) => sum + file.additions, 0)
    && gitLabMetadataCount(stats.removed_lines) === summaries.reduce((sum, file) => sum + file.deletions, 0)
    && expected.size === summaries.length && parsed.size === files.length && files.length === summaries.length
    && files.every((file) => { const expectedFile = expected.get(file.path); return expectedFile !== undefined && expectedFile.additions === file.additions && expectedFile.deletions === file.deletions; });
  if (page.kind === 'compare' && (!SHA.test(page.from) || !SHA.test(page.to))) {
    const [afterBase, afterHead] = await Promise.all([resolveRef(page, page.from, signal, page.targetProjectId), resolveRef(page, page.to, signal)]);
    if (afterBase !== base || afterHead !== head) throw new Error('GitLab comparison refs changed while loading');
  }
  const patches = new Map<string, string>();
  for (const content of patch.split(/(?=^diff --git )/m)) {
    const file = parseUnifiedDiff(content)[0];
    if (file !== undefined) patches.set(file.path, content);
  }
  return { files, complete, patches, revision: page.kind === 'commit' ? `commit:${head}:w=${w ?? '0'}` : `compare:${page.targetProjectId ?? repository.path}:${base}..${head}:${page.straight ? 'straight' : 'merge-base'}:w=${w ?? '0'}` };
}
