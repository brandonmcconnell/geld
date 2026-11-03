import { CONFIG_SHA, configJson, configRecord, loadProviderConfig, ProviderConfigError, readConfigResource } from '../providers/repo-config';
import type { ProviderConfigPath, ProviderRepositoryConfig } from '../providers/repo-config';
import type { ProviderPage } from '../providers/types';
import { bitbucketTransport, BitbucketTransportError, canonicalBitbucketApiUrl } from './transport';
import type { BitbucketTransport } from './transport';

const API = 'https://api.bitbucket.org';

function selection(url: URL): string {
  const params = new URLSearchParams(url.search);
  for (const key of ['page', 'pagelen', 'cursor']) params.delete(key);
  params.sort();
  return params.toString();
}

export async function fetchBitbucketConfig(page: ProviderPage, signal: AbortSignal, fetcher: typeof fetch = fetch, transport: BitbucketTransport = bitbucketTransport): Promise<ProviderRepositoryConfig> {
  const requestResource: typeof fetch = async (input, init) => {
    try { return await transport.fetch(input, init, fetcher); }
    catch (error) { if (error instanceof BitbucketTransportError) throw new ProviderConfigError(error.message, error.retryAfterMs); throw error; }
  };
  const repository = page.repository;
  const segments = repository.path.split('/');
  if (page.provider !== 'bitbucket' || repository.provider !== 'bitbucket' || repository.origin !== 'https://bitbucket.org' || segments.length !== 2
    || segments.some((part) => part === '' || part === '.' || part === '..' || /[\\\0?#]/.test(part))) throw new ProviderConfigError('Invalid Bitbucket configuration repository');
  const project = new URL(`/2.0/repositories/${segments.map(encodeURIComponent).join('/')}`, API);
  const metadata = (await configJson(project, signal, requestResource, 'omit')).value;
  if (!configRecord(metadata) || typeof metadata.full_name !== 'string' || metadata.full_name.toLowerCase() !== repository.path.toLowerCase()
    || !configRecord(metadata.mainbranch) || typeof metadata.mainbranch.name !== 'string' || metadata.mainbranch.name === '') throw new ProviderConfigError('Bitbucket default branch is unavailable');
  const branch = (await configJson(new URL(`${project.href}/refs/branches/${encodeURIComponent(metadata.mainbranch.name)}`), signal, requestResource, 'omit')).value;
  if (!configRecord(branch) || branch.name !== metadata.mainbranch.name || !configRecord(branch.target) || typeof branch.target.hash !== 'string' || !CONFIG_SHA.test(branch.target.hash)) throw new ProviderConfigError('Bitbucket default branch revision is unavailable');
  const ref = branch.target.hash;
  const listings = new Map<string, Promise<ReadonlyMap<string, 'file' | 'directory'>>>();
  const listing = (directory: string): Promise<ReadonlyMap<string, 'file' | 'directory'>> => {
    const existing = listings.get(directory);
    if (existing !== undefined) return existing;
    const request = (async (): Promise<ReadonlyMap<string, 'file' | 'directory'>> => {
      const initial = new URL(`${project.href}/src/${ref}/${directory === '' ? '' : `${directory}/`}`);
      initial.searchParams.set('pagelen', '100');
      let current: URL | null = initial;
      const visited = new Set<string>();
      const entries = new Map<string, 'file' | 'directory'>();
      let total: number | null = null;
      while (current !== null) {
        if (visited.has(current.href) || visited.size >= 100) throw new ProviderConfigError('Bitbucket repository tree is incomplete');
        visited.add(current.href);
        const response: unknown = (await configJson(current, signal, requestResource, 'omit')).value;
        if (!configRecord(response) || !Array.isArray(response.values)) throw new ProviderConfigError('Bitbucket repository tree is unavailable');
        for (const item of response.values) {
          const entry: unknown = item;
          if (!configRecord(entry) || typeof entry.path !== 'string' || (entry.type !== 'commit_file' && entry.type !== 'commit_directory') || entries.has(entry.path)) throw new ProviderConfigError('Bitbucket repository tree is invalid');
          entries.set(entry.path, entry.type === 'commit_file' ? 'file' : 'directory');
        }
        if (response.size !== undefined) {
          if (typeof response.size !== 'number' || !Number.isSafeInteger(response.size) || response.size < 0 || (total !== null && total !== response.size)) throw new ProviderConfigError('Bitbucket repository tree total is invalid');
          total = response.size;
        }
        if (response.next === undefined || response.next === null) current = null;
        else {
          if (typeof response.next !== 'string') throw new ProviderConfigError('Bitbucket repository tree pagination is invalid');
          let next: URL;
          try { next = canonicalBitbucketApiUrl(response.next, initial); } catch { throw new ProviderConfigError('Bitbucket repository tree pagination left its pinned revision'); }
          if (next.origin !== API || next.pathname !== initial.pathname || next.username !== '' || next.password !== '' || next.hash !== '' || selection(next) !== selection(initial)) throw new ProviderConfigError('Bitbucket repository tree pagination left its pinned revision');
          current = next;
        }
      }
      if (total !== null && total !== entries.size) throw new ProviderConfigError('Bitbucket repository tree is incomplete');
      return entries;
    })();
    listings.set(directory, request);
    return request;
  };
  const readFile = async (path: ProviderConfigPath): Promise<string | null> => {
    const root = await listing('');
    if (path === '.gitattributes') { if (root.get(path) !== 'file') return null; }
    else {
      if (root.get('.github') !== 'directory') return null;
      if ((await listing('.github')).get(path) !== 'file') return null;
    }
    const url = new URL(`${project.href}/src/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`);
    return (await readConfigResource(url, signal, requestResource, { missing: true, credentials: 'omit' })).text;
  };
  return loadProviderConfig(repository, ref, signal, readFile, (path) => `${repository.origin}/${repository.path}/src/${ref}/${path}`);
}
