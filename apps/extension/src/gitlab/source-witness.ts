import { readGitLabStandaloneSourceFrame } from './standalone-source-witness';
import { readGitLabPageFrame, jsonAttribute, record, SHA } from './page';
import { providerSourceId, providerSourcePath, providerSourceSubject, providerSourceSubjectKey, providerNativeSourceElement } from '../providers/source-facts';
import type { ProviderGitLabTarget, ProviderNativeSourceFrame } from '../providers/source-facts';
import { currentGitLabRenderedView, gitLabNativeResource, readGitLabRenderedView } from './native-whitespace';

function selected(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const found: Record<string, unknown>[] = [];
  for (const entry of value) if (record(entry) && entry.selected === true) found.push(entry);
  return found.length === 1 ? found[0] ?? null : null;
}

export function readGitLabSourceFrame(doc: Document, appRoot: HTMLElement): ProviderNativeSourceFrame | null {
  const frame = readGitLabPageFrame(doc, appRoot);
  if (frame === null) return null;
  const { page, appData: app, sourceVersion: source, url, serialized } = frame;
  const standalone = page.kind === 'commit' || page.kind === 'compare';
  if ((page.kind === 'commit' || page.kind === 'compare') && !Object.hasOwn(app, 'project_path')) return readGitLabStandaloneSourceFrame(doc, appRoot, { ...frame, page });
  if (app.project_path !== page.repository.path) return null;
  const versions = record(app.versions) ? app.versions : null;
  const target = selected(versions?.target_versions);
  const subject = providerSourceSubject(page);
  const owner = page.repository;
  if (!standalone) {
    if (typeof app.mr_path !== 'string') return null;
    try { if (new URL(app.mr_path, owner.origin).href !== page.url) return null; } catch { return null; }
  }
  const sourceId = providerSourceId(source?.id);
  const targetId = providerSourceId(target?.id);
  const sourceHead = typeof source?.head_sha === 'string' && SHA.test(source.head_sha) ? source.head_sha.toLowerCase() : null;
  const targetFacts: ProviderGitLabTarget | null = targetId !== null && typeof target?.head_sha === 'string' && SHA.test(target.head_sha)
    && typeof target.start_sha === 'string' && SHA.test(target.start_sha) && typeof target.is_merge_head === 'boolean'
    ? { id: targetId, headSha: target.head_sha.toLowerCase(), startSha: target.start_sha.toLowerCase(), mergeHead: target.is_merge_head } : null;
  const sameProject = app.is_fork === false || app.is_fork === 'false';
  const parent = appRoot.parentNode;
  const rendered = standalone ? undefined : readGitLabRenderedView(doc, appRoot);
  if (rendered === null) return null;
  if (rendered !== undefined) {
    const files = new Map(rendered.files.map((file) => [file.root, file]));
    return {
    key: rendered.key,
    current: () => readGitLabRenderedView(doc, appRoot) === rendered,
    read: (entry) => {
      const file = files.get(entry.root);
      return !currentGitLabRenderedView(doc, appRoot, rendered) || file === undefined || !file.root.isConnected || entry.path !== file.path || file.root.getAttribute('data-file-data') !== file.serialized ? null : { subject, repository: owner, path: file.path, headSha: file.headSha,
        comparison: { kind: 'gitlab-native-reload', sourceId: rendered.sourceId, sourceHeadSha: rendered.sourceHeadSha, baseSha: file.baseSha, startSha: file.startSha, nativeViewKey: rendered.key } };
    },
    };
  }
  const current = (): boolean => (standalone || readGitLabRenderedView(doc, appRoot) === undefined) && doc.URL === url && appRoot.isConnected && appRoot.hasAttribute('data-rapid-diffs') && providerNativeSourceElement(appRoot) && appRoot.ownerDocument === doc && appRoot.parentNode === parent && appRoot.getAttribute('data-app-data') === serialized;
  return {
    key: JSON.stringify([providerSourceSubjectKey(subject), sourceId, sourceHead, targetFacts, standalone]),
    current,
    read: (entry) => {
      if (!current()) return null;
      const root = entry.root;
      if (!root.isConnected || root.ownerDocument !== doc || root.closest('[data-rapid-diffs]') !== appRoot || !providerNativeSourceElement(root)) return null;
      if (!standalone && (!sameProject || sourceId === null || sourceHead === null || targetFacts === null)) return null;
      const data = jsonAttribute(root, 'data-file-data');
      const refs = data?.diff_refs;
      if (!providerSourcePath(data?.new_path) || !record(refs) || typeof refs.head_sha !== 'string' || !SHA.test(refs.head_sha)) return null;
      const headSha = refs.head_sha.toLowerCase();
      const path = data.new_path;
      if (!gitLabNativeResource(data.blob_raw_path, owner.origin, owner.path, headSha, path, true) || !gitLabNativeResource(data.diff_lines_path, owner.origin, owner.path, headSha, path, false)) return null;
      const common = { subject, repository: owner, path, headSha };
      if (standalone) return { ...common, comparison: { kind: 'gitlab-standalone' } };
      if (sourceId === null || sourceHead === null || targetFacts === null || headSha !== targetFacts.headSha || typeof refs.base_sha !== 'string' || !SHA.test(refs.base_sha) || typeof refs.start_sha !== 'string' || !SHA.test(refs.start_sha)) return null;
      return { ...common, comparison: { kind: 'gitlab-review', sourceId, sourceHeadSha: sourceHead, baseSha: refs.base_sha.toLowerCase(), startSha: refs.start_sha.toLowerCase(), target: targetFacts } };
    },
  };
}
