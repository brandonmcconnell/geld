export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops';

/** What the report may still name: the page's own repository and host, when its address goes into the issue too. */
export interface NamedPage {
  readonly repo: string;
  readonly host: string;
}

const GITHUB_HOSTS = /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i;

/**
 * Which provider an address is on: by its host when it is one of the hosted
 * services, else by the shape of its path (GitLab's `/-/`, Azure DevOps's
 * `/_git/`, Bitbucket Server's `/projects/KEY/repos/`), else GitHub, which
 * is what an Enterprise host Geld runs on is.
 */
export function providerOf(host: string, path: string): GitProvider {
  const name = host.toLowerCase().replace(/:\d+$/, '');
  if (name === 'gitlab.com') return 'gitlab';
  if (name === 'bitbucket.org') return 'bitbucket';
  if (name === 'dev.azure.com' || name.endsWith('.visualstudio.com')) return 'azure-devops';
  if (/\/-\//.test(path)) return 'gitlab';
  if (/\/(_git|_workitems)\//.test(path)) return 'azure-devops';
  if (/^\/projects\/[^/]+\/repos\//.test(path)) return 'bitbucket';
  return 'github';
}

/** The provider in words for the issue: "GitHub (github.com)", "GitHub Enterprise (ghe.example.com)". */
export function providerLabel(url: URL): string {
  const provider = providerOf(url.host, url.pathname);
  const name =
    provider === 'gitlab' ? 'GitLab' : provider === 'bitbucket' ? 'Bitbucket' : provider === 'azure-devops' ? 'Azure DevOps' : GITHUB_HOSTS.test(url.hostname) ? 'GitHub' : 'GitHub Enterprise';
  return `${name} (${url.host})`;
}

/** GitHub's routes that look like an owner but are not one: `/orgs/…`, `/settings`, `/pulls`. */
const GITHUB_ROUTES = new Set(['orgs', 'settings', 'notifications', 'pulls', 'issues', 'search', 'marketplace', 'sponsors', 'apps', 'users', 'login', 'explore', 'topics', 'features', 'enterprises', 'codespaces', 'dashboard']);

/** The placeholder for the item a route names, by provider: a pull request, an issue, a merge request, a commit. */
const ITEMS: Readonly<Record<string, string>> = {
  pull: '[pr]',
  pulls: '',
  'pull-requests': '[pr]',
  pullrequest: '[pr]',
  merge_requests: '[mr]',
  issues: '[issue]',
  discussions: '[discussion]',
  commit: '[commit]',
  commits: '[ref]',
  tree: '[ref]',
  blob: '[ref]',
  compare: '[ref]',
  src: '[ref]',
  branch: '[ref]',
  releases: '[ref]',
  actions: '[ref]',
};

/** A pull request's own tabs, safe to keep after its number. */
const TABS = new Set(['files', 'changes', 'commits', 'checks', 'diff', 'overview']);

function route(kind: string | undefined, rest: readonly string[]): string {
  if (kind === undefined) return '';
  const item = ITEMS[kind];
  if (item === undefined) return `/${kind}${rest.length > 0 ? '/[path]' : ''}`;
  const [, ...after] = rest;
  const tail = after.length === 0 ? '' : after.every((segment) => TABS.has(segment)) ? `/${after.join('/')}` : '/[path]';
  return `/${kind}${item === '' || rest.length === 0 ? '' : `/${item}`}${tail}`;
}

function githubPath(segments: readonly string[]): string {
  const [owner, repo, kind, ...rest] = segments;
  if (owner === undefined) return '';
  if (GITHUB_ROUTES.has(owner.toLowerCase())) return `/${owner}${segments.length > 1 ? '/[path]' : ''}`;
  if (repo === undefined) return '/[org]';
  return `/[org]/[repo]${route(kind, rest)}`;
}

function gitlabPath(segments: readonly string[]): string {
  const dash = segments.indexOf('-');
  const namespace = dash === -1 ? segments : segments.slice(0, dash);
  if (namespace.length === 0) return '';
  const masked = namespace.length === 1 ? ['[group]'] : [...namespace.slice(0, -1).map(() => '[group]'), '[project]'];
  if (dash === -1) return `/${masked.join('/')}`;
  const [kind, ...rest] = segments.slice(dash + 1);
  return `/${masked.join('/')}/-${route(kind, rest)}`;
}

function bitbucketPath(segments: readonly string[]): string {
  if (segments[0] === 'projects' && segments[2] === 'repos') {
    const [kind, ...rest] = segments.slice(4);
    return `/projects/[project]/repos/[repo]${route(kind, rest)}`;
  }
  const [workspace, repo, kind, ...rest] = segments;
  if (workspace === undefined) return '';
  if (repo === undefined) return '/[workspace]';
  return `/[workspace]/[repo]${route(kind, rest)}`;
}

function azurePath(segments: readonly string[], onDevAzure: boolean): string {
  const marker = segments.findIndex((segment) => segment === '_git' || segment === '_workitems');
  const before = marker === -1 ? segments : segments.slice(0, marker);
  const scope = before.map((_, index) => (index === before.length - 1 && (before.length > 1 || !onDevAzure) ? '[project]' : '[org]'));
  if (marker === -1) return scope.length === 0 ? '' : `/${scope.join('/')}`;
  const after = segments.slice(marker + 1);
  if (segments[marker] === '_workitems') return `/${[...scope, '_workitems'].join('/')}${after.length > 0 ? `/${after[0] === 'edit' ? 'edit/[work-item]' : '[path]'}` : ''}`;
  const [, kind, ...rest] = after;
  return `/${[...scope, '_git', '[repo]'].join('/')}${route(kind, rest)}`;
}

/**
 * An address with its organization, repository and item names put in its
 * provider's placeholders, the host kept since it says which provider: the one
 * exception is the organization an Azure DevOps `*.visualstudio.com` host
 * carries. A query or fragment is dropped, since it can hold anything.
 */
export function obfuscateAddress(host: string, path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '');
  switch (providerOf(host, path)) {
    case 'gitlab':
      return `${host}${gitlabPath(segments)}`;
    case 'bitbucket':
      return `${host}${bitbucketPath(segments)}`;
    case 'azure-devops':
      return `${host.replace(/^[^.]+(?=\.visualstudio\.com)/i, '[org]')}${azurePath(segments, /^dev\.azure\.com/i.test(host))}`;
    case 'github':
      return `${host}${githubPath(segments)}`;
  }
}

/** An address on a host, up to whitespace; punctuation closing a sentence is not part of it. */
const ADDRESS = /\bhttps?:\/\/([^\s/?#]+)([^\s?#]*)(?:[?#][^\s]*)?/g;
/** `host/owner/repo`, then `#N` or `@sha`: how the log names a page (`tabSubject`). */
const HOSTED_REFERENCE = /(?<![\w./:-])([A-Za-z0-9][A-Za-z0-9.-]*)\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)(?:(#)\d+|(@)[0-9a-f]{7,40})?(?![\w-])/;
/** `owner/repo#N` with no host, as logs written before the host was added name github.com's pages. */
const BARE_REFERENCE = /(?<![\w./-])([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)(?:(#)\d+|(@)[0-9a-f]{7,40})?(?![\w-])/;
/** All three in one pass, earliest first: an address or reference is read once, so nothing inside one left whole is read again. */
const REFERENCE = new RegExp(`${ADDRESS.source}|${HOSTED_REFERENCE.source}|${BARE_REFERENCE.source}`, 'g');
const TRAILING = /[).,;:'"\]!]+$/;

/**
 * The diagnostics report with every organization, repository, pull request,
 * issue, discussion and commit it names put in its provider's placeholders:
 * `github.com/[org]/[repo]#[pr]`,
 * `https://github.com/[org]/[repo]/pull/[pr]`,
 * `https://gitlab.com/[group]/[project]/-/merge_requests/[mr]`. Hosts stay,
 * since they say which provider. The report covers every open tab, so even
 * with the page's address in the issue only that page's own repository on its
 * own host keeps its name: the same `owner/repo` on another host is another
 * repository.
 */
export function obfuscateRepos(report: string, named: NamedPage | null): string {
  const kept = named?.repo.toLowerCase() ?? null;
  const keptHost = named?.host.toLowerCase() ?? null;
  const sameHost = (host: string): boolean => host.toLowerCase().replace(/:\d+$/, '') === keptHost;
  const isKept = (owner: string, repo: string): boolean => `${owner}/${repo}`.toLowerCase() === kept;
  const tail = (pull: string | undefined, sha: string | undefined): string => (pull !== undefined ? '#[pr]' : sha !== undefined ? '@[commit]' : '');
  return report.replace(REFERENCE, (whole: string, ...groups: unknown[]) => {
    const part = (index: number): string | undefined => {
      const value = groups[index];
      return typeof value === 'string' ? value : undefined;
    };
    // Credentials written into an address (`user:token@host`) never go further.
    const urlHost = part(0)?.replace(/^[^@]*@/, '');
    if (urlHost !== undefined) {
      const rawPath = part(1) ?? '';
      const closing = TRAILING.exec(rawPath)?.[0] ?? '';
      const path = rawPath.slice(0, rawPath.length - closing.length);
      const [owner, repo] = path.split('/').filter((segment) => segment !== '');
      if (owner !== undefined && repo !== undefined && isKept(owner, repo) && sameHost(urlHost) && providerOf(urlHost, path) === 'github') return whole;
      return `${whole.startsWith('http://') ? 'http' : 'https'}://${obfuscateAddress(urlHost, path)}${closing}`;
    }
    const [host, hostedOwner, hostedRepo] = [part(2), part(3), part(4)];
    if (host !== undefined && hostedOwner !== undefined && hostedRepo !== undefined) {
      if (isKept(hostedOwner, hostedRepo) && sameHost(host)) return whole;
      return `${host}/[org]/[repo]${tail(part(5), part(6))}`;
    }
    const [owner, repo] = [part(7), part(8)];
    if (owner !== undefined && repo !== undefined && isKept(owner, repo) && keptHost === 'github.com') return whole;
    return `[org]/[repo]${tail(part(9), part(10))}`;
  });
}
