import type { RepositoryIdentity } from './providers';
import { providerRepositoryScope, repositoryKey } from './providers';
import { normalizeReviewAccountId } from './review-accounts';

export interface TrustedSummaryPublisher {
  readonly repository: RepositoryIdentity;
  readonly authorId: string;
}

function read(line: string): { readonly binding: TrustedSummaryPublisher | null; readonly problem: string | null } {
  if (/[\r\n\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) return { binding: null, problem: 'Keep each summary publisher on one line without control characters.' };
  const text = line.trim();
  if (text === '' || text.startsWith('#')) return { binding: null, problem: null };
  const parts = text.split(/\s+/);
  if (parts.length !== 2) return { binding: null, problem: 'Use one exact repository path and native account id, separated by a space.' };
  const [scope, account] = parts;
  if (scope === undefined || account === undefined) return { binding: null, problem: 'A summary publisher needs a repository and native account id.' };
  const segments = scope.split('/');
  const host = segments.shift()?.toLowerCase();
  const provider = host === 'gitlab.com' ? 'gitlab' : host === 'bitbucket.org' ? 'bitbucket' : null;
  if (provider === null || segments.length < 2 || (provider === 'bitbucket' && segments.length !== 2)
    || segments.some((segment) => segment === '.' || segment === '..' || !/^[\p{L}\p{N}_.-]+$/u.test(segment))) {
    return { binding: null, problem: 'Use an exact gitlab.com/group/project or bitbucket.org/workspace/repo path. Wildcards are not trusted.' };
  }
  const authorId = normalizeReviewAccountId(provider, account);
  if (authorId === null) return { binding: null, problem: provider === 'gitlab' ? 'Use the numeric GitLab account id, not its username.' : 'Use the Bitbucket account UUID, not its nickname or a token.' };
  return { binding: { repository: { provider, origin: `https://${host}`, path: segments.join('/') }, authorId }, problem: null };
}

export function parseTrustedSummaryPublisher(line: string): TrustedSummaryPublisher | null { return read(line).binding; }
export function trustedSummaryPublisherProblem(line: string): string | null { return read(line).problem; }

function bindingKey(binding: TrustedSummaryPublisher): string { return JSON.stringify([repositoryKey(binding.repository), binding.authorId]); }
function serialize(binding: TrustedSummaryPublisher): string { return `${providerRepositoryScope(binding.repository)} ${binding.authorId}`; }

export function trustedSummaryPublishersProblem(lines: readonly string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const problem = trustedSummaryPublisherProblem(lines[index] ?? '');
    if (problem !== null) return `Line ${index + 1}: ${problem}`;
  }
  return null;
}

export function normalizeTrustedSummaryPublishers(value: unknown): readonly string[] {
  const isList = (candidate: unknown): candidate is readonly unknown[] => Array.isArray(candidate);
  if (!isList(value)) return [];
  const bindings = new Map<string, TrustedSummaryPublisher>();
  for (const line of value) {
    const binding = typeof line === 'string' ? parseTrustedSummaryPublisher(line) : null;
    if (binding !== null) bindings.set(bindingKey(binding), binding);
  }
  return Array.from(bindings.values(), serialize);
}

export function trustedSummaryPublishersFor(lines: readonly string[], repository: RepositoryIdentity): readonly TrustedSummaryPublisher[] {
  if ((repository.provider !== 'gitlab' || repository.origin !== 'https://gitlab.com')
    && (repository.provider !== 'bitbucket' || repository.origin !== 'https://bitbucket.org')) return [];
  const key = repositoryKey(repository);
  return normalizeTrustedSummaryPublishers(lines).flatMap((line) => {
    const binding = parseTrustedSummaryPublisher(line);
    return binding !== null && repositoryKey(binding.repository) === key ? [binding] : [];
  });
}

export function trustedSummaryPublisherIdsFor(lines: readonly string[], repository: RepositoryIdentity): readonly string[] {
  return trustedSummaryPublishersFor(lines, repository).map((binding) => binding.authorId);
}

export function withTrustedSummaryPublisher(lines: readonly string[], repository: RepositoryIdentity, nativeAuthorId: string): readonly string[] {
  const candidate = read(`${providerRepositoryScope(repository)} ${nativeAuthorId}`);
  if (candidate.binding === null || candidate.problem !== null || candidate.binding.repository.origin !== repository.origin || repositoryKey(candidate.binding.repository) !== repositoryKey(repository)) throw new TypeError(candidate.problem ?? 'Unsupported trusted summary repository.');
  const key = bindingKey(candidate.binding);
  const kept = normalizeTrustedSummaryPublishers(lines).filter((line) => {
    const binding = parseTrustedSummaryPublisher(line);
    return binding === null || bindingKey(binding) !== key;
  });
  return [...kept, serialize(candidate.binding)];
}

export function mergeTrustedSummaryPublishers(base: readonly string[], edited: readonly string[], latest: readonly string[]): readonly string[] {
  const bindings = (lines: readonly string[]): Map<string, TrustedSummaryPublisher> => {
    const result = new Map<string, TrustedSummaryPublisher>();
    for (const line of normalizeTrustedSummaryPublishers(lines)) {
      const binding = parseTrustedSummaryPublisher(line);
      if (binding !== null) result.set(bindingKey(binding), binding);
    }
    return result;
  };
  const before = bindings(base);
  const changes = bindings(edited);
  const current = bindings(latest);
  for (const key of before.keys()) if (!changes.has(key)) current.delete(key);
  for (const [key, binding] of changes) if (!before.has(key)) current.set(key, binding);
  return Array.from(current.values(), serialize);
}
