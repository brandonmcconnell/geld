export interface QueryToken {
  readonly key: string | null;
  readonly value: string;
  readonly quoted?: boolean;
}
export function parseQuery(query: string): readonly QueryToken[] {
  const words = query.match(/(?:[^\s"\\]|\\.|"(?:\\.|[^"\\])*")+/g) ?? [];
  return words.map((word) => {
    const colon = word.indexOf(':');
    const key = colon > 0 && /^-?[a-z][a-z-]*$/i.test(word.slice(0, colon)) ? word.slice(0, colon).toLowerCase() : null;
    const raw = key === null ? word : word.slice(colon + 1);
    const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\(["\\])/g, '$1') : raw;
    return { key, value, ...(key === null && raw.startsWith('"') && raw.endsWith('"') ? { quoted: true } : {}) };
  });
}
function quote(value: string, force = false): string {
  return force || /[\s"\\]/.test(value) ? `"${value.replace(/["\\]/g, '\\$&')}"` : value;
}
export function serializeQuery(tokens: readonly QueryToken[]): string {
  return tokens
    .map((token) => `${token.key === null ? '' : `${token.key}:`}${quote(token.value, token.quoted === true)}`)
    .join(' ');
}
export function setQualifier(query: string, key: string, value: string | null): string {
  const roles = [
    ['pr', 'issue'],
    ['open', 'closed'],
    ['merged', 'unmerged'],
    ['locked', 'unlocked'],
    ['public', 'private', 'internal'],
  ];
  const values =
    key === 'is'
      ? (roles.find((role) => role.includes((value ?? 'open').toLowerCase())) ?? [value?.toLowerCase()])
      : null;
  const tokens = parseQuery(query).filter(
    (token) => token.key !== key || (values !== null && !values.includes(token.value.toLowerCase())),
  );
  return serializeQuery(value === null ? tokens : [...tokens, { key, value }]);
}
export function withRepos(query: string, repositories: readonly string[]): string {
  return serializeQuery([
    ...parseQuery(query).filter((token) => token.key !== 'repo'),
    ...Array.from(new Set(repositories)).map((value) => ({ key: 'repo', value })),
  ]);
}
export function parseRepositoryInput(input: string): { readonly owner: string; readonly repo: string | null } | null {
  let path = input.trim();
  if (path.startsWith('https://github.com/')) path = path.slice('https://github.com/'.length);
  path = path.replace(/\/$/, '');
  const [owner, repo, ...rest] = path.split('/');
  if (
    !owner ||
    rest.length ||
    !/^[a-z\d][a-z\d-]*$/i.test(owner) ||
    (repo !== undefined && !/^[a-z\d_.-]+$/i.test(repo))
  )
    return null;
  return { owner, repo: repo ?? null };
}
