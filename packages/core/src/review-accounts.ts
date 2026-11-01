import type { ProviderId, RepositoryIdentity } from './providers';
import { providerRepositoryScope, repositoryKey } from './providers';

export interface TrustedReviewAccount {
  readonly repository: RepositoryIdentity;
  readonly botId: string;
  readonly authorId: string;
}

const BOT_ID = /^[a-z][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeReviewAccountId(provider: ProviderId, authorId: string): string | null {
  if (provider === 'gitlab') return /^[1-9]\d{0,19}$/.test(authorId) ? authorId : null;
  if (provider !== 'bitbucket') return null;
  const uuid = authorId.startsWith('{') && authorId.endsWith('}') ? authorId.slice(1, -1) : authorId;
  return UUID.test(uuid) ? uuid.toLowerCase() : null;
}

function read(line: string): { readonly binding: TrustedReviewAccount | null; readonly problem: string | null } {
  if (/[\r\n\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) return { binding: null, problem: 'Keep each trusted account on one line without control characters.' };
  const text = line.trim();
  if (text === '' || text.startsWith('#')) return { binding: null, problem: null };
  const parts = text.split(/\s+/);
  if (parts.length !== 3) return { binding: null, problem: 'Use one repository path, bot id and native account id, separated by spaces.' };
  const [scope, botId, account] = parts;
  if (scope === undefined || botId === undefined || account === undefined) return { binding: null, problem: 'A trusted account needs a repository, bot id and native account id.' };
  const segments = scope.split('/');
  const host = segments.shift()?.toLowerCase();
  const provider = host === 'gitlab.com' ? 'gitlab' : host === 'bitbucket.org' ? 'bitbucket' : null;
  if (provider === null || segments.length < 2 || (provider === 'bitbucket' && segments.length !== 2)
    || segments.some((segment) => segment === '.' || segment === '..' || !/^[\p{L}\p{N}_.-]+$/u.test(segment))) {
    return { binding: null, problem: 'Use an exact gitlab.com/group/project or bitbucket.org/workspace/repo path. Wildcards are not trusted.' };
  }
  if (!BOT_ID.test(botId)) return { binding: null, problem: 'A bot id uses lowercase letters, digits and dashes, such as coderabbit.' };
  const authorId = normalizeReviewAccountId(provider, account);
  if (authorId === null) return { binding: null, problem: provider === 'gitlab' ? 'Use the numeric GitLab account id, not its username.' : 'Use the Bitbucket account UUID, not its nickname or a token.' };
  return { binding: { repository: { provider, origin: `https://${host}`, path: segments.join('/') }, botId, authorId }, problem: null };
}

export function parseTrustedReviewAccount(line: string): TrustedReviewAccount | null { return read(line).binding; }
export function trustedReviewAccountProblem(line: string): string | null { return read(line).problem; }

function bindingKey(binding: TrustedReviewAccount): string { return JSON.stringify([repositoryKey(binding.repository), binding.authorId]); }
function serialize(binding: TrustedReviewAccount): string { return `${providerRepositoryScope(binding.repository)} ${binding.botId} ${binding.authorId}`; }

export function trustedReviewAccountConflicts(lines: readonly unknown[]): readonly { readonly index: number; readonly message: string }[] {
  const seen = new Map<string, string>();
  const issues: Array<{ readonly index: number; readonly message: string }> = [];
  lines.forEach((line, index) => {
    const binding = typeof line === 'string' ? parseTrustedReviewAccount(line) : null;
    if (binding === null) return;
    const key = bindingKey(binding);
    const previous = seen.get(key);
    if (previous !== undefined && previous !== binding.botId) issues.push({ index, message: 'This native account is assigned to more than one bot in the same repository.' });
    seen.set(key, binding.botId);
  });
  return issues;
}

export function trustedReviewAccountsProblem(lines: readonly string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const problem = trustedReviewAccountProblem(lines[index] ?? '');
    if (problem !== null) return `Line ${index + 1}: ${problem}`;
  }
  const conflict = trustedReviewAccountConflicts(lines)[0];
  return conflict === undefined ? null : `Line ${conflict.index + 1}: ${conflict.message}`;
}

export function normalizeTrustedReviewAccounts(value: unknown): readonly string[] {
  const isList = (candidate: unknown): candidate is readonly unknown[] => Array.isArray(candidate);
  if (!isList(value)) return [];
  const bindings = new Map<string, TrustedReviewAccount>();
  const conflicts = new Set<string>();
  for (const line of value) {
    const binding = typeof line === 'string' ? parseTrustedReviewAccount(line) : null;
    if (binding === null) continue;
    const key = bindingKey(binding);
    if (conflicts.has(key)) continue;
    const previous = bindings.get(key);
    if (previous !== undefined && previous.botId !== binding.botId) { bindings.delete(key); conflicts.add(key); }
    else bindings.set(key, binding);
  }
  return Array.from(bindings.values(), serialize);
}

export function trustedReviewAccountsFor(lines: readonly string[], repository: RepositoryIdentity): readonly TrustedReviewAccount[] {
  if (repository.provider === 'github') return [];
  const key = repositoryKey(repository);
  return normalizeTrustedReviewAccounts(lines).flatMap((line) => {
    const binding = parseTrustedReviewAccount(line);
    return binding !== null && repositoryKey(binding.repository) === key ? [binding] : [];
  });
}

export function trustedReviewAccountFor(lines: readonly string[], repository: RepositoryIdentity, nativeAuthorId: string): TrustedReviewAccount | null {
  const authorId = normalizeReviewAccountId(repository.provider, nativeAuthorId);
  return authorId === null ? null : trustedReviewAccountsFor(lines, repository).find((binding) => binding.authorId === authorId) ?? null;
}

export function withTrustedReviewAccount(lines: readonly string[], repository: RepositoryIdentity, botId: string, nativeAuthorId: string): readonly string[] {
  const candidate = read(`${providerRepositoryScope(repository)} ${botId} ${nativeAuthorId}`);
  if (candidate.binding === null || candidate.problem !== null || repositoryKey(candidate.binding.repository) !== repositoryKey(repository)) throw new TypeError(candidate.problem ?? 'Unsupported trusted review repository.');
  const key = bindingKey(candidate.binding);
  const kept = normalizeTrustedReviewAccounts(lines).filter((line) => {
    const binding = parseTrustedReviewAccount(line);
    return binding === null || bindingKey(binding) !== key;
  });
  return [...kept, serialize(candidate.binding)];
}

export function mergeTrustedReviewAccounts(base: readonly string[], edited: readonly string[], latest: readonly string[]): readonly string[] {
  const bindings = (lines: readonly string[]): Map<string, TrustedReviewAccount> => {
    const result = new Map<string, TrustedReviewAccount>();
    for (const line of normalizeTrustedReviewAccounts(lines)) {
      const binding = parseTrustedReviewAccount(line);
      if (binding !== null) result.set(bindingKey(binding), binding);
    }
    return result;
  };
  const before = bindings(base);
  const changes = bindings(edited);
  const current = bindings(latest);
  for (const key of before.keys()) if (!changes.has(key)) current.delete(key);
  for (const [key, binding] of changes) if (before.get(key)?.botId !== binding.botId) current.set(key, binding);
  return Array.from(current.values(), serialize);
}
