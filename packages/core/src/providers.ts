import { repoFromPathname } from './repo-rules';

export type ProviderId = 'github' | 'gitlab' | 'bitbucket';

export interface RepositoryIdentity {
  readonly provider: ProviderId;
  readonly origin: string;
  readonly path: string;
}

export const CLOUD_PROVIDER_HOSTS: readonly string[] = ['github.com', 'gitlab.com', 'bitbucket.org'];

export function providerForHost(host: string): ProviderId | null {
  switch (host.toLowerCase()) {
    case 'github.com': return 'github';
    case 'gitlab.com': return 'gitlab';
    case 'bitbucket.org': return 'bitbucket';
    default: return null;
  }
}

export function repositoryKey(identity: RepositoryIdentity): string {
  const origin = new URL(identity.origin).origin;
  return JSON.stringify([identity.provider, origin, identity.path]);
}

export function providerRepositoryScope(identity: RepositoryIdentity): string {
  return identity.provider === 'github' ? identity.path : `${new URL(identity.origin).host}/${identity.path}`;
}

const BITBUCKET_WORKSPACE_ROUTES = new Set(['workspace', 'projects', 'repositories', 'members', 'settings', 'snippets', 'overview']);

function projectPath(path: string): string | null {
  const segments = path.split('/');
  if (segments.length < 2 || segments.some((segment) => segment === '' || segment === '.' || segment === '..' || /[\\\s?#\u0000-\u001f]/.test(segment))) return null;
  return path;
}

export function describeRepository(input: URL | string, explicitProvider?: ProviderId): RepositoryIdentity | null {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  const knownProvider = providerForHost(url.hostname);
  if (explicitProvider !== undefined && knownProvider !== null && explicitProvider !== knownProvider) return null;
  const provider = knownProvider ?? explicitProvider;
  if (provider === undefined) return null;
  let path: string | null;
  if (provider === 'github') {
    path = repoFromPathname(url.pathname);
  } else if (provider === 'gitlab') {
    const boundary = url.pathname.indexOf('/-/');
    // A nested group's landing page is indistinguishable from a project's without a project route.
    path = boundary < 0 ? null : projectPath(url.pathname.slice(1, boundary));
  } else {
    const segments = url.pathname.split('/');
    const workspace = segments[1];
    const repo = segments[2];
    path = workspace === undefined || repo === undefined || BITBUCKET_WORKSPACE_ROUTES.has(repo.toLowerCase()) || ['account', 'dashboard', 'repo', 'product'].includes(workspace.toLowerCase())
      ? null
      : projectPath(`${workspace}/${repo}`);
  }
  if (path === null) return null;
  try {
    const decoded = path.split('/').map((segment) => decodeURIComponent(segment));
    if (decoded.some((segment) => segment.includes('/'))) return null;
    const clean = projectPath(decoded.join('/'));
    return clean === null ? null : { provider, origin: url.origin, path: clean };
  } catch {
    return null;
  }
}
