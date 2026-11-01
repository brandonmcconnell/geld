import { describeRepository } from '@geld/core';
import type { ProviderPage, ProviderStandalonePage } from '../providers/types';

const MERGE_REQUEST = /^\/(.+)\/-\/merge_requests\/([1-9]\d*)(?:\/(diffs|commits|pipelines))?\/?$/;
export const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
export const SELECTION_PARAMS = ['diff_id', 'start_sha', 'commit_id', 'w', 'only_context_commits'] as const;

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function jsonAttribute(element: Element | null, attribute: string): Record<string, unknown> | null {
  const text = element?.getAttribute(attribute);
  if (text === undefined || text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return record(value) ? value : null;
  } catch {
    return null;
  }
}

export function selection(url: URL): URLSearchParams {
  const result = new URLSearchParams();
  for (const name of SELECTION_PARAMS) {
    const value = url.searchParams.get(name);
    if (value !== null && ((name === 'diff_id' && /^\d+$/.test(value)) || ((name === 'start_sha' || name === 'commit_id') && SHA.test(value)) || (name === 'w' && /^(0|1)$/.test(value)) || (name === 'only_context_commits' && /^(true|1)$/.test(value)))) result.set(name, value);
  }
  return result;
}

export function selectedVersion(doc: Document): Record<string, unknown> | null {
  const app = jsonAttribute(doc.querySelector('[data-rapid-diffs][data-app-data]'), 'data-app-data');
  const versions = app?.versions;
  if (!record(versions) || !Array.isArray(versions.source_versions)) return null;
  for (const value of versions.source_versions) {
    const item: unknown = value;
    if (record(item) && item.selected === true) return item;
  }
  return null;
}

function displayedHead(doc: Document, repository: string, origin: string): string | null {
  for (const node of doc.querySelectorAll('diff-file[data-file-data]')) {
    const data = jsonAttribute(node, 'data-file-data');
    if (typeof data?.diff_lines_path !== 'string') continue;
    try {
      const path = new URL(data.diff_lines_path, origin);
      const prefix = `/${repository}/-/blob/`;
      const sha = path.pathname.startsWith(prefix) ? path.pathname.slice(prefix.length).split('/')[0] : null;
      if (path.origin === origin && typeof sha === 'string' && SHA.test(sha)) return sha.toLowerCase();
    } catch { continue; }
  }
  return null;
}

function validRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= 1024 && !/[\\\s\u0000-\u001f?#]/.test(ref) && !ref.includes('..');
}

function documentReviewVersion(url: URL, doc: Document, repository: string, number: string): Record<string, unknown> | null | false {
  let current: URL;
  try { current = new URL(doc.location.href); } catch { return false; }
  const review = MERGE_REQUEST.exec(current.pathname);
  if (current.origin !== url.origin || review?.[1] !== repository || review[2] !== number) return false;
  const version = selectedVersion(doc);
  const currentParams = selection(current);
  const targetParams = selection(url);
  for (const key of ['diff_id', 'start_sha', 'commit_id', 'only_context_commits'] as const) {
    const target = targetParams.get(key);
    const displayed = currentParams.get(key) ?? (key === 'diff_id' && typeof version?.id === 'number' ? String(version.id) : null);
    if (target === null ? currentParams.has(key) : target !== displayed) return false;
  }
  if (currentParams.has('diff_id') && typeof version?.id === 'number' && currentParams.get('diff_id') !== String(version.id)) return false;
  return version;
}

function standalonePage(url: URL, doc: Document): ProviderStandalonePage | null {
  const repository = describeRepository(url, 'gitlab');
  if (repository === null) return null;
  const path = repository.path.split('/').map(encodeURIComponent).join('/');
  const prefix = `/${path}/-/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const route = url.pathname.slice(prefix.length).replace(/\/$/, '');
  const whitespace = url.searchParams.get('w');
  const options = new URLSearchParams();
  if (whitespace === '0' || whitespace === '1') options.set('w', whitespace);
  const commit = /^commit\/([0-9a-f]{7,64})$/i.exec(route);
  if (commit?.[1] !== undefined) {
    const ref = commit[1].toLowerCase();
    const headSha = SHA.test(ref) ? ref : doc.location?.origin === url.origin && doc.location.pathname === url.pathname ? displayedHead(doc, path, url.origin) : null;
    const base = `${url.origin}${prefix}commit/${ref}`;
    const query = options.size > 0 ? `?${options}` : '';
    return { provider: 'gitlab', repository, kind: 'commit', ref, headSha, url: base, diffPageUrl: `${base}${query}`, diffUrl: `${base}.diff${query}`, version: `commit:${headSha ?? ref}|${options}` };
  }
  if (!route.startsWith('compare/')) return null;
  const range = /^(.*?)\.\.(\.?)(.*?)$/.exec(route.slice('compare/'.length));
  let from: string;
  let to: string;
  try {
    if (range === null) return null;
    from = decodeURIComponent(range[1] ?? '');
    to = decodeURIComponent(range[3] ?? '');
  } catch { return null; }
  if (!validRef(from) || !validRef(to)) return null;
  const project = url.searchParams.get('from_project_id');
  if (project !== null && !/^[1-9]\d*$/.test(project)) return null;
  const straight = url.searchParams.get('straight') === 'true' || (range !== null && range[2] === '');
  if (straight) options.set('straight', 'true');
  if (project !== null) options.set('from_project_id', project);
  const base = `${url.origin}${prefix}compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;
  const query = options.size > 0 ? `?${options}` : '';
  const headSha = SHA.test(to) ? to.toLowerCase() : doc.location?.origin === url.origin && doc.location.pathname === url.pathname ? displayedHead(doc, path, url.origin) : null;
  const diff = new URL(`${base}${query}`); diff.searchParams.set('format', 'diff');
  return { provider: 'gitlab', repository, kind: 'compare', from, to, straight, ...(project === null ? {} : { targetProjectId: project }), headSha, url: base, diffPageUrl: `${base}${query}`, diffUrl: diff.href, version: `compare:${from}:${to}:${straight}:${project ?? ''}|${options}` };
}

export function describeGitLabPage(url: URL, doc: Document): ProviderPage | null {
  if (url.protocol !== 'https:' || doc.querySelector('form#new_user[action*="sign_in"]') !== null) return null;
  const match = MERGE_REQUEST.exec(url.pathname);
  if (match === null) return standalonePage(url, doc);
  const repository = match[1];
  const number = match[2];
  if (repository === undefined || number === undefined || repository.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  const base = `${url.origin}/${repository}/-/merge_requests/${number}`;
  const params = selection(url);
  const documentVersion = documentReviewVersion(url, doc, repository, number);
  const version = documentVersion === false ? null : documentVersion;
  const canReadLatestHead = documentVersion !== false && !params.has('diff_id') && !params.has('start_sha') && !params.has('commit_id');
  if (!params.has('diff_id') && !params.has('commit_id') && typeof version?.id === 'number') params.set('diff_id', String(version.id));
  const note = canReadLatestHead ? jsonAttribute(doc.querySelector('[data-noteable-type="MergeRequest"][data-noteable-data]'), 'data-noteable-data') : null;
  const candidate = params.get('commit_id') ?? (typeof version?.head_sha === 'string' ? version.head_sha : note?.diff_head_sha);
  const headSha = typeof candidate === 'string' && SHA.test(candidate) ? candidate.toLowerCase() : null;
  const query = params.size > 0 ? `?${params}` : '';
  return {
    provider: 'gitlab',
    repository: { provider: 'gitlab', origin: url.origin, path: repository },
    number,
    url: base,
    diffPageUrl: `${base}/diffs${query}`,
    diffUrl: `${base}.diff${query}`,
    kind: match[3] === 'diffs' ? 'diff' : match[3] === undefined ? 'overview' : 'other',
    headSha,
    version: [params.toString(), headSha ?? 'latest'].join('|'),
  };
}
