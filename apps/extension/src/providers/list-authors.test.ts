// @vitest-environment happy-dom
import { DEFAULT_SETTINGS, normalizeSettings } from '@geld/core';
import { ProviderListAuthors } from './list-authors';
import { ProviderHiddenAuthors, PROVIDER_AUTHOR_HIDDEN } from './hidden-authors';
import type { ProviderListAuthor, ProviderListAuthorFetcher, ProviderListRow } from './types';

const URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED';
const KEY = 'bitbucket.org/uuid/7177c565-3bb4-44d3-b17b-e791dfb8fed8';
const OTHER = 'bitbucket.org/uuid/11111111-1111-1111-1111-111111111111';
const SETTINGS = { ...DEFAULT_SETTINGS, hiddenAuthors: [KEY], showListStats: false };
function row(id: number): ProviderListRow {
  const root = document.createElement('article');const host = document.createElement('span');const title = document.createElement('a');
  const url = `https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/${id}`;title.href = url;title.textContent = `Native PR${id}`;root.append(title, host);document.body.append(root);
  return { root, host, author: null, url };
}
function author(row: ProviderListRow, key = KEY): ProviderListAuthor { return { url: row.url, author: key, authorName: 'Albert Sundjaja' }; }
async function flush(): Promise<void> { for (let count = 0; count < 10; count += 1) await Promise.resolve(); }
function pending() { let resolve: (value: readonly ProviderListAuthor[]) => void = () => undefined;const promise = new Promise<readonly ProviderListAuthor[]>((done) => { resolve = done; });return { promise, resolve }; }
beforeEach(() => { window.location.href = URL;document.body.replaceChildren(); });
afterEach(() => { document.body.replaceChildren();vi.restoreAllMocks(); });

it.each([{ rules: [] }, { rules: ['', ' #comment'] }, { rules: ['Albert Sundjaja'] }, { rules: ['@'] }, { rules: [' @ '] }])('uses compiled author-rule demand rather than raw list length: $rules', async ({ rules }) => {
  const read = vi.fn<ProviderListAuthorFetcher>();const source = new ProviderListAuthors(read, vi.fn());
  const rows = [row(27)];expect(source.update(rows, { ...SETTINGS, hiddenAuthors: rules }, URL)).toBe(rows);await flush();expect(read).not.toHaveBeenCalled();source.clear();
});
it('fetches once per active visit, deduplicates responsive hosts and survives temporary native remounts without another request', async () => {
  const first = row(27);const second = row(25);const duplicate = { ...first, host: first.root.querySelector('a') ?? first.host };
  const read = vi.fn<ProviderListAuthorFetcher>().mockResolvedValue([author(first)]);const changed = vi.fn();const source = new ProviderListAuthors(read, changed);
  source.update([first, duplicate, second], SETTINGS, URL);await flush();
  expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0]?.[1]).toEqual([first.url, second.url]);
  source.update([], SETTINGS, URL);
  for (let count = 0; count < 200; count += 1) source.update([first, second], SETTINGS, URL);
  expect(read).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledTimes(1);
  expect(source.update([first, second], SETTINGS, URL)).toMatchObject([{ author: KEY, authorName: 'Albert Sundjaja' }, { author: null }]);source.clear();
});
it('hides only the qualified UUID match while names stay separate, unknown/same-name accounts remain visible and Show preserves originals', async () => {
  const first = row(27);const sameName = row(25);const unknown = row(22);const original = [...first.root.childNodes];
  const read = vi.fn<ProviderListAuthorFetcher>().mockResolvedValue([author(first), author(sameName, OTHER)]);const source = new ProviderListAuthors(read, vi.fn());
  source.update([first, sameName, unknown], SETTINGS, URL);await flush();
  const rows = source.update([first, sameName, unknown], SETTINGS, URL);const hidden = new ProviderHiddenAuthors('bitbucket');
  expect([...hidden.update(rows, SETTINGS, URL)]).toEqual([first.root]);
  expect(sameName.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);expect(unknown.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);
  const note = document.querySelector('[data-geld-provider-author-note]');expect(note?.textContent).toBe('1 pull request by Albert Sundjaja hiddenShow');expect(note?.textContent).not.toContain(KEY);
  expect([...first.root.childNodes]).toEqual(original);
  const show = note?.querySelector('button');if (show === null || show === undefined) throw new Error('Missing Show');show.focus();show.click();
  expect(first.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);expect(document.activeElement).toBe(first.root.querySelector('a'));
  expect(hidden.update(rows, SETTINGS, URL).size).toBe(0);hidden.clear();source.clear();
});
it('keeps nickname-like rules from matching the UUID and preserves one shared settings payload', async () => {
  const item = row(27);const read = vi.fn<ProviderListAuthorFetcher>().mockResolvedValue([author(item)]);const source = new ProviderListAuthors(read, vi.fn());
  const settings = { ...SETTINGS, hiddenAuthors: ['Albert*'] };source.update([item], settings, URL);await flush();const hidden = new ProviderHiddenAuthors('bitbucket');
  expect(hidden.update(source.update([item], settings, URL), settings, URL).size).toBe(0);
  expect(normalizeSettings(JSON.parse(JSON.stringify(SETTINGS))).hiddenAuthors).toEqual([KEY]);hidden.clear();source.clear();
});
it('aborts old route/settings generations and cannot attach late identities to a new visit or reused row', async () => {
  const item = row(27);const old = pending();const next = pending();const read = vi.fn<ProviderListAuthorFetcher>().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);const changed = vi.fn();const source = new ProviderListAuthors(read, changed);
  source.update([item], SETTINGS, URL);await flush();source.update([item], SETTINGS, URL.replace('MERGED', 'OPEN'));await flush();
  expect(read.mock.calls[0]?.[2].aborted).toBe(true);old.resolve([author(item)]);await flush();expect(changed).not.toHaveBeenCalled();
  const reused = { ...item, url: item.url.replace('/27', '/25') };next.resolve([author(item)]);await flush();expect(source.update([reused], SETTINGS, URL.replace('MERGED', 'OPEN'))[0]?.author).toBeNull();
  source.update([reused], { ...SETTINGS, hiddenAuthors: [' #empty'] }, URL);expect(read.mock.calls[1]?.[2].aborted).toBe(true);expect(source.update([reused], { ...SETTINGS, enabled: false }, URL)[0]?.author).toBeNull();source.clear();
});
it('does not retry failures or background-pause aborts on mutation pulses', async () => {
  const item = row(27);const read = vi.fn<ProviderListAuthorFetcher>().mockRejectedValue(new Error('429/unavailable'));const source = new ProviderListAuthors(read, vi.fn());
  source.update([item], SETTINGS, URL);await flush();source.pause();
  for (let count = 0; count < 200; count += 1) expect(source.update([item], SETTINGS, URL)[0]?.author).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);source.clear();
});

it('keeps a redacted readable name separate from the opaque UUID key while retaining identity matching', async () => {
  const item = row(27);const read = vi.fn<ProviderListAuthorFetcher>().mockResolvedValue([{ ...author(item), authorName: null }]);const source = new ProviderListAuthors(read, vi.fn());
  source.update([item], SETTINGS, URL);await flush();const hiding = new ProviderHiddenAuthors('bitbucket');
  expect(hiding.update(source.update([item], SETTINGS, URL), SETTINGS, URL).has(item.root)).toBe(true);
  const label = document.querySelector('[data-geld-provider-author-note]')?.textContent;
  expect(label).toBe('1 pull request by Unknown account hiddenShow');expect(label).not.toContain(KEY);hiding.clear();source.clear();
});
