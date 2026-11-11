export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops';

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
