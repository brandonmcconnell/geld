// @vitest-environment happy-dom
import { repositoryKey } from '@geld/core';
import { readGitLabDiff } from './diff';
import { createGitLabWholeTestAdapter, gitLabNextTestContext, gitLabWholeSourceURL } from './whole-test-context';
import { ProviderHttpAdmission } from '../providers/http-admission';
import type { ProviderNewFileRevision } from '../providers/source-facts';
const H = 'a'.repeat(40);
function revision(path = 'spec/file.test.ts'): ProviderNewFileRevision { const repository = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/repo' } as const;return { repository, headSha: H, path, key: JSON.stringify([repositoryKey(repository), H, path]) }; }
function fixture() {
  window.location.href = 'https://gitlab.com/group/repo/-/merge_requests/1/diffs';
  const line = (number: number): string => `<tr class="rd-hunk-lines-inline"><td class="rd-line-number" data-position="old"><a data-line-number="${number}"></a></td><td class="rd-line-number" data-position="new"><a data-line-number="${number}"></a></td><td class="rd-line-content"><pre class="rd-line-text">line${number}\n</pre></td></tr>`;
  const gap = (direction: string): string => `<tr class="rd-hunk-header" data-hunk-header><td><button type="button" data-click="expandLines" data-expand-direction="${direction}">Show lines</button></td></tr>`;
  document.body.innerHTML = `<article data-rapid-diffs><div data-diffs-list><diff-file data-file-data='{"new_path":"spec/file.test.ts"}'><header data-testid="rd-diff-file-header" aria-label="Diff file controls"><div class="rd-diff-file-info"><input data-viewed-checkbox type="checkbox" disabled></div></header><details data-file-body open><table class="rd-text-view-root"><tbody class="rd-text-view-content">${gap('up')}${line(100)}${line(115)}</tbody><tbody class="rd-text-view-content">${gap('both')}${line(131)}${line(158)}</tbody><tbody class="rd-text-view-content">${gap('down')}</tbody></table></details></diff-file></div></article>`;
  return readGitLabDiff(document)!.entries[0]!;
}
afterEach(() => { document.body.replaceChildren();vi.restoreAllMocks(); });
it('constructs only exact immutable new paths, encoding each original segment once', () => {
  expect(gitLabWholeSourceURL(revision('spec/sp ace%#é.test.ts')).href).toBe(`https://gitlab.com/group/repo/-/raw/${H}/spec/sp%20ace%25%23%C3%A9.test.ts`);
  expect(() => gitLabWholeSourceURL(revision('../secret'))).toThrow();expect(() => gitLabWholeSourceURL({ ...revision(), headSha: H.slice(0, 7) })).toThrow();
});
for (const [missing, direction] of [[[96, 97, 98, 99], 'up'], [[125, 126, 127, 128, 129, 130], 'both'], [[160], 'down']] as const) it(`selects original${direction} context across separate TBODY elements`, () => {
  const entry = fixture();const original = entry.root.querySelector<HTMLButtonElement>(`button[data-expand-direction="${direction}"]`)!;const html = original.outerHTML;const viewed = entry.root.querySelector<HTMLInputElement>('input')!;const click = vi.fn();original.addEventListener('click', click);
  const step = gitLabNextTestContext(entry, missing)!;expect(step).not.toBeNull();expect(step.current()).toBe(true);step.activate();expect(click).toHaveBeenCalledTimes(1);expect(original.outerHTML).toBe(html);expect(viewed.checked).toBe(false);
});
it('does not use a dummy/no-newline/foreign control or invent a step outside the actual missing interval', () => {
  const entry = fixture();expect(gitLabNextTestContext(entry, [100])).toBeNull();
  entry.root.querySelector('[data-expand-direction="both"]')!.setAttribute('data-click', 'other');expect(gitLabNextTestContext(entry, [125])).toBeNull();
  entry.root.querySelector('[data-expand-direction="up"]')!.closest('tr')!.setAttribute('data-geld-ui', '');expect(gitLabNextTestContext(entry, [96])).toBeNull();
});
it('retires an enabled control when its source boundary, native scope or owner changes', () => {
  const entry = fixture();const step = gitLabNextTestContext(entry, [96])!;const button = entry.root.querySelector<HTMLButtonElement>('[data-expand-direction="up"]')!;const click = vi.fn();button.addEventListener('click', click);
  button.disabled = true;step.activate();expect(click).not.toHaveBeenCalled();button.disabled = false;
  button.closest('tr')!.removeAttribute('data-hunk-header');expect(step.current()).toBe(false);step.activate();expect(click).not.toHaveBeenCalled();
  const current = fixture();const late = gitLabNextTestContext(current, [96])!;current.root.remove();expect(late.current()).toBe(false);
});
it('uses only the verified original file header for explicit intent', () => {
  const entry = fixture();const feature = createGitLabWholeTestAdapter(new ProviderHttpAdmission(undefined, 0));expect(feature.intentHost(entry)?.className).toBe('rd-diff-file-info');
  entry.root.querySelector('header')!.removeAttribute('data-testid');expect(feature.intentHost(entry)).toBeNull();
});
it('reads through injected admission, checks its live lease, and refuses redirected source', async () => {
  const fetcher = vi.fn(async () => new Response('it source\nend', { headers: { 'content-type': 'text/plain' } }));const lane = new ProviderHttpAdmission(undefined, 0);const feature = createGitLabWholeTestAdapter(lane, fetcher);
  const body = await feature.readSource(revision(), new AbortController().signal, () => true);expect(body.lines).toEqual(['it source', 'end']);expect(fetcher).toHaveBeenCalledWith(gitLabWholeSourceURL(revision()), expect.objectContaining({ redirect: 'error', credentials: 'same-origin' }));
  await expect(feature.readSource(revision(), new AbortController().signal, () => false)).rejects.toThrow('selection changed');expect(fetcher).toHaveBeenCalledTimes(1);
  const response = new Response('other', { headers: { 'content-type': 'text/plain' } });Object.defineProperty(response, 'url', { value: `https://gitlab.com/group/repo/-/raw/${'b'.repeat(40)}/spec/file.test.ts` });fetcher.mockResolvedValueOnce(response);
  await expect(feature.readSource(revision(), new AbortController().signal, () => true)).rejects.toThrow('redirected');
});

function insertedFocusFixture() {
  const entry = fixture(), step = gitLabNextTestContext(entry, [96, 97, 98, 99])!, holder = document.createElement('tbody');holder.className = 'rd-text-view-content';holder.innerHTML = '<tr class="rd-hunk-lines-inline"><td class="rd-line-number" data-position="old"><a class="rd-line-link" data-line-number="99" href="#line"></a></td><td class="rd-line-number" data-position="new"><a class="rd-line-link" data-line-number="99" href="#line"></a></td><td class="rd-line-content"><pre class="rd-line-text">new-side text\n</pre></td></tr>';
  const anchor = holder.querySelector<HTMLAnchorElement>('a')!, row = anchor.closest('tr')!;return { entry, step, holder, anchor, row, insert: () => entry.root.querySelector('tbody')!.before(holder) };
}
it('recognizes an activated-gap newly inserted OLD99 focus only by its physical NEW99 row projection', () => { const f = insertedFocusFixture();expect(f.step.insertedFocus?.(f.anchor)).toBeNull();f.step.activate();f.insert();expect(f.step.insertedFocus?.(f.anchor)).toEqual({ row: f.row, newLine: 99, newText: 'new-side text' }); });
for (const mode of ['existing row', 'wrong gap', 'missing new', 'ambiguous new', 'bad number', 'nested anchor', 'owned', 'authored', 'other table', 'detached table', 'duplicate code', 'hidden', 'inert', 'aria-hidden', 'popover', 'tooltip', 'source description'] as const) it(`rejects inserted focus candidate with ${mode}`, () => {
  const f = insertedFocusFixture();f.step.activate();f.insert();let target = f.anchor;
  if (mode === 'existing row') { target = f.entry.root.querySelector<HTMLAnchorElement>('a[data-line-number="100"]')!;target.className = 'rd-line-link'; }
  if (mode === 'wrong gap') f.row.querySelector('[data-position="new"] a')!.setAttribute('data-line-number', '131');
  if (mode === 'missing new') f.row.querySelector('[data-position="new"]')!.remove();
  if (mode === 'ambiguous new') { const cell = f.row.querySelector('[data-position="new"]')!;cell.after(cell.cloneNode(true)); }
  if (mode === 'bad number') f.anchor.dataset.lineNumber = '099';
  if (mode === 'nested anchor') { const wrap = document.createElement('span');f.anchor.replaceWith(wrap);wrap.append(f.anchor); }
  if (mode === 'owned') f.row.dataset.geldUi = '';if (mode === 'authored') f.row.classList.add('md');
  if (mode === 'other table') { const table = document.createElement('table');f.entry.root.append(table);table.append(f.holder); }
  if (mode === 'detached table') f.entry.root.querySelector('table')!.remove();
  if (mode === 'duplicate code') { const code = f.row.querySelector('.rd-line-content')!;code.after(code.cloneNode(true)); }
  if (mode === 'hidden' || mode === 'inert' || mode === 'popover') f.row.setAttribute(mode, '');
  if (mode === 'aria-hidden') f.row.setAttribute('aria-hidden', 'true');
  if (mode === 'tooltip') f.row.setAttribute('role', 'tooltip');
  if (mode === 'source description') f.row.setAttribute('data-testid', 'description-content');
  expect(f.step.insertedFocus?.(target)).toBeNull();
});

it('does not mistake a previously present opaque native row filled later for a newly inserted row', () => {
  const entry = fixture(), row = document.createElement('tr');row.className = 'rd-hunk-lines-inline';entry.root.querySelector('tbody')!.append(row);const step = gitLabNextTestContext(entry, [99])!;step.activate();row.innerHTML = '<td class="rd-line-number" data-position="old"><a class="rd-line-link" data-line-number="99"></a></td><td class="rd-line-number" data-position="new"><a class="rd-line-link" data-line-number="99"></a></td><td class="rd-line-content"><pre class="rd-line-text">later native text\n</pre></td>';expect(step.insertedFocus?.(row.querySelector('a')!)).toBeNull();
});

it('snapshots every physical row immediately before activation rather than accepting a row already inserted since step selection', () => { const f = insertedFocusFixture();f.insert();f.step.activate();expect(f.step.insertedFocus?.(f.anchor)).toBeNull(); });
it('rejects a matching new-line number inserted beyond the original activated physical gap', () => { const f = insertedFocusFixture();f.step.activate();f.entry.root.querySelector('table')!.append(f.holder);expect(f.step.insertedFocus?.(f.anchor)).toBeNull(); });
