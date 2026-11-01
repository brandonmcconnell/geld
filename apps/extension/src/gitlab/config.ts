import { CONFIG_SHA, configJson, configRecord, loadProviderConfig, ProviderConfigError, readConfigResource } from '../providers/repo-config';
import type { ProviderConfigPath, ProviderRepositoryConfig } from '../providers/repo-config';
import type { ProviderPage } from '../providers/types';

export async function fetchGitLabConfig(page: ProviderPage, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProviderRepositoryConfig> {
  const repository = page.repository;
  if (page.provider !== 'gitlab' || repository.provider !== 'gitlab' || repository.origin !== 'https://gitlab.com'
    || repository.path.split('/').length < 2 || repository.path.split('/').some((part) => part === '' || part === '.' || part === '..' || /[\\\0?#]/.test(part))) throw new ProviderConfigError('Invalid GitLab configuration repository');
  const project = new URL(`/api/v4/projects/${encodeURIComponent(repository.path)}`, repository.origin);
  const metadata = (await configJson(project, signal, fetcher)).value;
  if (!configRecord(metadata) || metadata.path_with_namespace !== repository.path || typeof metadata.default_branch !== 'string' || metadata.default_branch === '') throw new ProviderConfigError('GitLab default branch is unavailable');
  const branch = (await configJson(new URL(`${project.href}/repository/branches/${encodeURIComponent(metadata.default_branch)}`), signal, fetcher)).value;
  if (!configRecord(branch) || branch.name !== metadata.default_branch || !configRecord(branch.commit) || typeof branch.commit.id !== 'string' || !CONFIG_SHA.test(branch.commit.id)) throw new ProviderConfigError('GitLab default branch revision is unavailable');
  const ref = branch.commit.id;
  const listings = new Map<string, Promise<ReadonlyMap<string, 'blob' | 'tree' | 'commit'>>>();
  const listing = (directory: string): Promise<ReadonlyMap<string, 'blob' | 'tree' | 'commit'>> => {
    const existing = listings.get(directory);
    if (existing !== undefined) return existing;
    const request = (async (): Promise<ReadonlyMap<string, 'blob' | 'tree' | 'commit'>> => {
      const entries = new Map<string, 'blob' | 'tree' | 'commit'>();
      let next: number | null = 1;
      let total: number | null = null;
      for (let count = 0; next !== null && count < 100; count += 1) {
        const url = new URL(`${project.href}/repository/tree`);
        url.searchParams.set('ref', ref); url.searchParams.set('per_page', '100'); url.searchParams.set('page', String(next));
        if (directory !== '') url.searchParams.set('path', directory);
        const response = await configJson(url, signal, fetcher);
        if (!Array.isArray(response.value)) throw new ProviderConfigError('GitLab repository tree is unavailable');
        for (const item of response.value) {
          const entry: unknown = item;
          if (!configRecord(entry) || typeof entry.path !== 'string' || (entry.type !== 'blob' && entry.type !== 'tree' && entry.type !== 'commit') || entries.has(entry.path)) throw new ProviderConfigError('GitLab repository tree is invalid');
          entries.set(entry.path, entry.type);
        }
        const declared = response.headers.get('x-total');
        if (declared !== null) {
          if (!/^\d+$/.test(declared) || (total !== null && total !== Number(declared))) throw new ProviderConfigError('GitLab repository tree total is invalid');
          total = Number(declared);
        }
        const following = response.headers.get('x-next-page');
        if (following === '') next = null;
        else if (following === null) next = response.value.length < 100 ? null : next + 1;
        else if (/^[1-9]\d*$/.test(following) && Number(following) > next) next = Number(following);
        else throw new ProviderConfigError('GitLab repository tree pagination is invalid');
      }
      if (next !== null || (total !== null && total !== entries.size)) throw new ProviderConfigError('GitLab repository tree is incomplete');
      return entries;
    })();
    listings.set(directory, request);
    return request;
  };
  const readFile = async (path: ProviderConfigPath): Promise<string | null> => {
    const root = await listing('');
    if (path === '.gitattributes') { if (root.get(path) !== 'blob') return null; }
    else {
      if (root.get('.github') !== 'tree') return null;
      if ((await listing('.github')).get(path) !== 'blob') return null;
    }
    const url = new URL(`${project.href}/repository/files/${encodeURIComponent(path)}/raw`);
    url.searchParams.set('ref', ref);
    return (await readConfigResource(url, signal, fetcher, { missing: true })).text;
  };
  return loadProviderConfig(repository, ref, signal, readFile, (path) => `${repository.origin}/${repository.path}/-/blob/${ref}/${path}`);
}
