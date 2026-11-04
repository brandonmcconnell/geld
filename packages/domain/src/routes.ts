import type { Provider, PullRef, RepositoryRef } from './models';

const hosts: Readonly<Record<Provider, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};
const segment = (value: string): string => encodeURIComponent(value);

export function validEnterpriseHost(host: string): boolean {
  if (host.length > 253 || host === 'localhost' || host === 'github.com' || /^\d+(\.\d+){3}$/.test(host)) return false;
  return host.includes('.') && host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

export function repositoryPath(ref: RepositoryRef): string {
  const prefix =
    ref.provider === 'github' && ref.host !== hosts.github ? `/ghe/${segment(ref.host)}` : `/${ref.provider}`;
  return `${prefix}/${segment(ref.owner)}/${segment(ref.repo)}`;
}

export function pullPath(ref: PullRef): string {
  return `${repositoryPath(ref)}/pull/${ref.number}`;
}

export type DashboardRoute =
  | {
      readonly kind: 'organisation';
      readonly provider: Provider;
      readonly host: string;
      readonly owner: string;
      readonly settings: boolean;
    }
  | {
      readonly kind: 'repository';
      readonly ref: RepositoryRef;
      readonly settings: boolean;
    }
  | { readonly kind: 'pull'; readonly ref: PullRef };

export function parseDashboardRoute(parts: readonly string[]): DashboardRoute | null {
  const [first, ...rest] = parts;
  let provider: Provider;
  let host: string;
  let path: readonly string[];
  if (first === 'ghe') {
    const [candidate, ...remaining] = rest;
    if (candidate === undefined || !validEnterpriseHost(candidate)) return null;
    provider = 'github';
    host = candidate;
    path = remaining;
  } else {
    if (first !== 'github' && first !== 'gitlab' && first !== 'bitbucket') return null;
    provider = first;
    host = hosts[provider];
    path = rest;
  }
  const [owner, repo, action, number] = path;
  if (
    !owner ||
    owner.startsWith('~') ||
    owner.includes('\\') ||
    owner.split('/').some((s) => !s || s === '.' || s === '..')
  )
    return null;
  if (path.length === 1 || (repo === '~settings' && path.length === 2))
    return {
      kind: 'organisation',
      provider,
      host,
      owner,
      settings: repo === '~settings',
    };
  if (!repo || repo.startsWith('~') || /[/\\]/.test(repo) || repo === '.' || repo === '..') return null;
  const ref: RepositoryRef = { provider, host, owner, repo };
  if (path.length === 2 || (action === '~settings' && path.length === 3))
    return { kind: 'repository', ref, settings: action === '~settings' };
  if (action !== 'pull' || path.length !== 4 || !number || !/^[1-9]\d*$/.test(number)) return null;
  const n = Number(number);
  return Number.isSafeInteger(n) ? { kind: 'pull', ref: { ...ref, number: n } } : null;
}

export function resourceKey(ref: RepositoryRef): string {
  return [ref.provider, ref.host.toLowerCase(), ref.owner, ref.repo].map(segment).join(':');
}

export function parseDashboardPathname(pathname: string): DashboardRoute | null {
  try {
    return parseDashboardRoute(pathname.split('/').filter(Boolean).map(decodeURIComponent));
  } catch {
    return null;
  }
}
export function githubEndpoints(host = 'github.com'): {
  readonly api: string;
  readonly graphql: string;
  readonly web: string;
} {
  if (host === 'github.com')
    return { api: 'https://api.github.com/', graphql: 'https://api.github.com/', web: 'https://github.com/' };
  if (!validEnterpriseHost(host)) throw new Error('Invalid Enterprise host');
  return host.endsWith('.ghe.com')
    ? { api: `https://api.${host}/`, graphql: `https://api.${host}/`, web: `https://${host}/` }
    : { api: `https://${host}/api/v3/`, graphql: `https://${host}/api/`, web: `https://${host}/` };
}

export function organisationPath(ref: Pick<RepositoryRef, 'provider' | 'host' | 'owner'>): string {
  const prefix =
    ref.provider === 'github' && ref.host !== 'github.com' ? `/ghe/${segment(ref.host)}` : `/${ref.provider}`;
  return `${prefix}/${segment(ref.owner)}`;
}
export function providerAuthKey(provider: Provider, host: string): string {
  return provider === 'github' && host !== 'github.com' ? `github@${host}` : provider;
}
