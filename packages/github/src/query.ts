export interface QueryToken {
  readonly key: string | null;
  readonly value: string;
}
export function parseQuery(query: string): readonly QueryToken[] {
  const words = query.match(/(?:[^\s"\\]|\\.|"(?:\\.|[^"\\])*")+/g) ?? [];
  return words.map((word) => {
    const colon = word.indexOf(':');
    const key = colon > 0 && /^-?[a-z][a-z-]*$/i.test(word.slice(0, colon)) ? word.slice(0, colon).toLowerCase() : null;
    const raw = key === null ? word : word.slice(colon + 1);
    const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\(["\\])/g, '$1') : raw;
    return { key, value };
  });
}
function quote(value: string): string {
  return /[\s"\\]/.test(value) ? `"${value.replace(/["\\]/g, '\\$&')}"` : value;
}
export function serializeQuery(tokens: readonly QueryToken[]): string {
  return tokens.map((token) => `${token.key === null ? '' : `${token.key}:`}${quote(token.value)}`).join(' ');
}
export function setQualifier(query: string, key: string, value: string | null): string {
  const tokens = parseQuery(query).filter((token) => token.key !== key);
  return serializeQuery(value === null ? tokens : [...tokens, { key, value }]);
}
export function withRepos(query: string, repositories: readonly string[]): string {
  return serializeQuery([...parseQuery(query).filter((token) => token.key !== 'repo'), ...Array.from(new Set(repositories)).map((value) => ({ key: 'repo', value }))]);
}
export function parseRepositoryInput(input: string): { readonly owner: string; readonly repo: string | null } | null {
  let path = input.trim();
  if (path.startsWith('https://github.com/')) path = path.slice('https://github.com/'.length);
  path = path.replace(/\/$/, '');
  const [owner, repo, ...rest] = path.split('/');
  if (!owner || rest.length || !/^[a-z\d][a-z\d-]*$/i.test(owner) || (repo !== undefined && !/^[a-z\d_.-]+$/i.test(repo))) return null;
  return { owner, repo: repo ?? null };
}
