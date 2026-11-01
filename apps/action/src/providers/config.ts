export type CiProvider = 'gitlab' | 'bitbucket';

export interface ProviderCiConfig {
  readonly provider: CiProvider;
  readonly origin: string;
  readonly apiBase: string;
  readonly repository: string;
  readonly number: string;
  readonly token: string;
  readonly tokenType: 'bearer' | 'basic';
  readonly username: string;
}

export class ProviderCiError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'ProviderCiError';
  }
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === '') throw new ProviderCiError(`${label} is required.`);
  return value.trim();
}

function origin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '') return url.origin;
  } catch {
    throw new ProviderCiError('The provider origin must be an HTTPS origin.');
  }
  throw new ProviderCiError('The provider origin must be an HTTPS origin.');
}

export function readProviderCiConfig(env: Readonly<Record<string, string | undefined>>): ProviderCiConfig {
  const provider = env.GELD_PROVIDER;
  if (provider !== 'gitlab' && provider !== 'bitbucket') throw new ProviderCiError('GELD_PROVIDER must be gitlab or bitbucket.');
  const host = origin(env.GELD_PROVIDER_ORIGIN ?? (provider === 'gitlab' ? env.CI_SERVER_URL ?? 'https://gitlab.com' : 'https://bitbucket.org'));
  if (provider === 'bitbucket' && host !== 'https://bitbucket.org') throw new ProviderCiError('This integration supports Bitbucket Cloud only.');
  const apiBase = env.GELD_API_BASE ?? (provider === 'gitlab' ? `${host}/api/v4` : 'https://api.bitbucket.org/2.0');
  if (apiBase !== (provider === 'gitlab' ? `${host}/api/v4` : 'https://api.bitbucket.org/2.0')) throw new ProviderCiError('The API base does not match the selected provider origin.');
  const repository = required(env.GELD_REPOSITORY ?? (provider === 'gitlab' ? env.CI_MERGE_REQUEST_PROJECT_PATH ?? env.CI_PROJECT_PATH : env.BITBUCKET_REPO_FULL_NAME), 'GELD_REPOSITORY');
  const parts = repository.split('/');
  if (parts.length < 2 || provider === 'bitbucket' && parts.length !== 2 || parts.some((part) => part === '' || part === '.' || part === '..' || /[\s\\?#%\u0000-\u001f]/.test(part))) throw new ProviderCiError('GELD_REPOSITORY must be a full provider repository path.');
  const number = required(env.GELD_REVIEW_NUMBER ?? (provider === 'gitlab' ? env.CI_MERGE_REQUEST_IID : env.BITBUCKET_PR_ID), 'GELD_REVIEW_NUMBER');
  if (!/^[1-9]\d*$/.test(number)) throw new ProviderCiError('GELD_REVIEW_NUMBER must be a positive native review number.');
  const token = required(env.GELD_TOKEN, 'GELD_TOKEN');
  if (/[\r\n]/.test(token)) throw new ProviderCiError('GELD_TOKEN must not contain newlines.');
  const tokenType = env.GELD_TOKEN_TYPE ?? 'bearer';
  if (tokenType !== 'bearer' && tokenType !== 'basic') throw new ProviderCiError('GELD_TOKEN_TYPE must be bearer or basic.');
  if (provider === 'gitlab' && tokenType !== 'bearer') throw new ProviderCiError('The GitLab integration requires bearer authentication.');
  const username = tokenType === 'basic' ? required(env.GELD_BITBUCKET_USERNAME, 'GELD_BITBUCKET_USERNAME') : '';
  if (/[\r\n:]/.test(username)) throw new ProviderCiError('GELD_BITBUCKET_USERNAME is invalid.');
  return { provider, origin: host, apiBase, repository, number, token, tokenType, username };
}
