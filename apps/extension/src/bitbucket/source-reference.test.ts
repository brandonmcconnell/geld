// @vitest-environment happy-dom
import { DEFAULT_SETTINGS } from '@geld/core';
import { readBitbucketDiff } from './diff';
import { describeBitbucketProviderPage } from './page';
import { bitbucketAdapter } from './index';
import { BitbucketSourceReferences } from './source-reference';
import { createBitbucketWholeTestAdapter } from './whole-test-context';
import { createBitbucketTransport } from './transport';
import { ProviderHttpAdmission } from '../providers/http-admission';
import { providerDiffSourceFacts, providerOutlineContext } from '../providers/source-facts';
import type { ProviderDiffSourceFacts } from '../providers/source-facts';
import { ProviderWholeTestContext } from '../providers/whole-test-context';
import type { ProviderDiffResult } from '../providers/types';

vi.mock('wxt/utils/storage', () => ({ storage: { getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }) } }));

const H = 'a'.repeat(40), B = 'b'.repeat(40), REF = H.slice(0, 12), PATH = 'test/test.py';
const source = ['def test_example():', '    first()', '    last()', ''];
const sessions: (() => void)[] = [];
function trustedClick(target: Element): void { const event = new MouseEvent('click', { bubbles: true });Object.defineProperty(event, 'isTrusted', { value: true });target.dispatchEvent(event); }
function fixture(options: { popup?: 'valid' | 'absent' | 'duplicate' | 'foreign' | 'form' | 'wrong-ref' | 'wrong-path' | 'existing'; sourceRef?: string; source?: string; focus?: 'native' | 'external' } = {}) {
  window.location.href = 'https://bitbucket.org/team/repo/pull-requests/27/diff';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(10, 10, 200, 24));
  document.body.innerHTML = `<div data-testid="pr-header"><div data-qa="pr-branches-and-state-styles"><div role="button" aria-haspopup="true" aria-expanded="false">source</div><div role="button" aria-haspopup="true" aria-expanded="false">main</div></div><div>#27 • updated</div><a href="/team/repo/src">repo</a></div><button data-selection aria-haspopup="true" aria-expanded="false">All changes</button>
    <div role="region" aria-label="Diff"><div><div id="chg-${PATH}"></div><div><article data-qa="branch-diff-file"><div data-qa="bk-file__header" data-testid="file-header"><span aria-label="Expand/collapse file"></span><h2 data-qa="bk-filepath">${PATH}</h2><div data-qa="bk-file__actions" data-testid="file-actions"><div data-qa="bk-file__menu"><button type="button" aria-haspopup="true" aria-expanded="false"><span role="img" aria-label="Diff actions"></span></button></div></div><label>Viewed<input type="checkbox" disabled></label></div><div data-qa="bk-file__content" data-testid="file-content"><div class="diff-chunk"><div class="diff-chunk-inner"><div class="chunk-heading-wrapper"><div><button data-qa="pr-diff-show-more-lines-above">Show more</button></div></div><div class="lines-wrapper" role="row" data-key="code-line"><div data-qa="code-line"><div data-key="code-line-number" data-old-line-number="3" data-new-line-number="3"></div><pre><span data-line-type=" ">    last()</span></pre></div></div></div></div></div></article></div></div></div>`;
  const page = describeBitbucketProviderPage(new URL(document.URL))!, entry = readBitbucketDiff(document)!.entries[0]!;
  const facts = providerDiffSourceFacts(page, { kind: 'bitbucket-review', headSha: H, baseSha: B, sourceRepository: 'team/repo', sourceRef: options.sourceRef ?? REF, topic: true }, [{ path: PATH, newPath: PATH }])!;
  const result: ProviderDiffResult = { files: [{ path: PATH, additions: 1, deletions: 0, status: 'modified' }], revision: `${B}..${H}`, complete: true, sourceFacts: facts };
  const changed = vi.fn(), native = new BitbucketSourceReferences(document, changed);native.update(page, result);
  const opener = entry.root.querySelector<HTMLButtonElement>('[data-qa="bk-file__menu"] button')!, clicks: boolean[] = [];const ownedPopups: HTMLElement[] = [];
  const outside = document.createElement('button');outside.textContent = 'Outside action';document.body.append(outside);
  const popup = (): HTMLElement => {
    const root = document.createElement('div');root.setAttribute('role', 'menu');
    root.innerHTML = `<a href="/team/repo/src/${options.popup === 'wrong-ref' ? B.slice(0, 12) : REF}/${options.popup === 'wrong-path' ? 'other.py' : PATH}">Native source wording</a>${options.popup === 'form' ? '<input>' : ''}`;
    if (options.popup === 'foreign') root.className = 'ak-renderer-document';document.body.append(root);ownedPopups.push(root);
    if (options.focus === 'native') { const link = root.querySelector<HTMLAnchorElement>('a')!;link.tabIndex = 0;link.focus(); }
    if (options.focus === 'external') outside.focus();
    return root;
  };
  if (options.popup === 'existing') popup();
  opener.addEventListener('click', (event) => {
    clicks.push(event.isTrusted === true);const open = opener.getAttribute('aria-expanded') !== 'true';opener.setAttribute('aria-expanded', String(open));
    if (!open) { for (const node of ownedPopups) node.remove();if (options.focus === 'native') opener.focus();return; }
    if (options.popup !== 'absent' && options.popup !== 'existing') popup();if (options.popup === 'duplicate') popup();
  });
  const transport = createBitbucketTransport({ origin: () => 'https://bitbucket.org', store: { read: async () => 0, write: async () => undefined } });
  const fetcher = vi.fn(async () => new Response(options.source ?? source.join('\n'), { headers: { 'content-type': 'text/plain' } }));
  const feature = createBitbucketWholeTestAdapter(new ProviderHttpAdmission(undefined, 0), transport, fetcher);
  const refresh = vi.fn(), manager = new ProviderWholeTestContext(bitbucketAdapter, feature, refresh);
  const update = (enabled = true): void => { const view = readBitbucketDiff(document)!;manager.update(page, result, view, { ...DEFAULT_SETTINGS, enabled }, providerOutlineContext(page, result, view));manager.mount(entry); };
  update();
  sessions.push(() => { manager.destroy();native.stop();transport.dispose(); });
  const click = (): void => { const button = entry.root.querySelector('[data-geld-test-boundaries]');if (button === null) throw new Error('Missing Find control');trustedClick(button); };
  return { page, entry, facts, result, native, changed, opener, outside, clicks, ownedPopups, fetcher, manager, update, click };
}
afterEach(() => { for (const stop of sessions.splice(0)) stop();document.body.replaceChildren();vi.useRealTimers();vi.restoreAllMocks(); });

it('offers Find before a source grant and mediates one original open/close only after genuine intent', async () => {
  const f = fixture(), original = f.entry.root.querySelector('[data-qa="code-line"]')!, originalText = original.textContent;
  const initial = providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!);expect(initial.newSources.size).toBe(0);
  expect(f.entry.root.querySelector('[data-geld-test-boundaries]')?.textContent).toBe('Find test boundaries');expect(f.clicks).toEqual([]);expect(f.fetcher).not.toHaveBeenCalled();
  f.entry.root.querySelector<HTMLButtonElement>('[data-geld-test-boundaries]')!.click();await Promise.resolve();expect(f.clicks).toEqual([]);
  f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));f.update();await vi.waitFor(() => expect(f.manager.source(f.entry)?.lines).toEqual(source));
  expect(f.clicks).toEqual([false, false]);expect(f.opener.getAttribute('aria-expanded')).toBe('false');expect(document.querySelector('[role="menu"]')).toBeNull();
  const context = providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!);expect(context.newSources.get(f.entry.root)).toMatchObject({ headSha: H, provenance: 'provider-resolved-native-reference' });
  const nativeFrame = readBitbucketDiff(document)!.readNewSourceFrame!()!;expect(nativeFrame.read(f.entry)).toBeNull();expect(nativeFrame.readReference?.(f.entry)).toMatchObject({ literalRef: REF });
  expect(original.isConnected).toBe(true);expect(original.textContent).toBe(originalText);expect(f.entry.root.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
  f.update();f.click();expect(f.clicks).toHaveLength(2);expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it('keeps the same frame while its own popup and controller refresh settle', async () => {
  const f = fixture();const key = providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).subjectKey;
  f.click();f.update();f.manager.retain(new Set([f.entry.root]));
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));f.update();
  expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).subjectKey).toBe(key);expect(f.manager.source(f.entry)).not.toBeNull();
});

for (const popup of ['duplicate', 'form', 'wrong-ref', 'wrong-path'] as const) it(`rejects ${popup} native source evidence without requesting bytes`, async () => {
  const f = fixture({ popup });f.click();await vi.waitFor(() => expect(f.entry.root.querySelector('[data-geld-test-boundaries]')?.getAttribute('data-status')).toBe('failed'));
  expect(f.fetcher).not.toHaveBeenCalled();expect(f.clicks).toEqual([false, false]);expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(0);
});

for (const popup of ['absent', 'existing', 'foreign'] as const) it(`bounds ${popup} popup preparation and never retries it automatically`, async () => {
  vi.useFakeTimers();const f = fixture({ popup });f.click();await vi.advanceTimersByTimeAsync(2100);
  expect(f.entry.root.querySelector('[data-geld-test-boundaries]')?.getAttribute('data-status')).toBe('failed');expect(f.fetcher).not.toHaveBeenCalled();f.update();f.click();expect(f.clicks).toHaveLength(2);
});

it('does not give an old counts cache without resolved source-ref provenance a Find control', () => {
  const f = fixture();const comparison = f.facts.comparison;if (comparison.kind !== 'bitbucket-review') throw new Error('Bad fixture');
  const { sourceRef, ...oldComparison } = comparison;void sourceRef;
  f.native.update(f.page, { ...f.result, sourceFacts: { ...f.facts, comparison: oldComparison } });f.update();
  expect(f.entry.root.querySelector('[data-geld-test-boundaries]')).toBeNull();expect(f.fetcher).not.toHaveBeenCalled();
});

for (const drift of ['route', 'comparison', 'file-header', 'source-ref', 'repository'] as const) it(`revokes a sealed source after ${drift} changes`, async () => {
  const f = fixture();f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));f.update();expect(f.manager.source(f.entry)).not.toBeNull();
  if (drift === 'route') window.location.href = document.URL.replace('/27/', '/28/');
  if (drift === 'comparison') document.querySelector('[data-selection]')!.textContent = 'Selected commits';
  if (drift === 'file-header') f.entry.root.querySelector('[data-testid="file-header"]')!.replaceWith(document.createElement('div'));
  if (drift === 'source-ref' || drift === 'repository') {
    const comparison = f.facts.comparison;if (comparison.kind !== 'bitbucket-review') throw new Error('Bad fixture');
    const facts: ProviderDiffSourceFacts = { ...f.facts, comparison: { ...comparison, ...(drift === 'source-ref' ? { sourceRef: H.slice(0, 10) } : { sourceRepository: 'team/other' }) } };
    f.native.update(f.page, { ...f.result, sourceFacts: facts });
  }
  expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(0);expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it('keeps failed raw agreement separate from successful native source preparation', async () => {
  const f = fixture({ source: 'wrong contents' });f.click();await vi.waitFor(() => expect(f.entry.root.querySelector('[data-geld-test-boundaries]')?.getAttribute('data-status')).toBe('failed'));f.update();
  expect(f.manager.source(f.entry)).toBeNull();expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.clicks).toEqual([false, false]);
});

it('cancels pending preparation when disabled and grants no stale file source', async () => {
  vi.useFakeTimers();const f = fixture({ popup: 'absent' });f.click();f.update(false);await vi.advanceTimersByTimeAsync(2100);
  expect(f.fetcher).not.toHaveBeenCalled();expect(f.opener.getAttribute('aria-expanded')).toBe('false');expect(f.entry.root.querySelector('[data-geld-test-boundaries]')).toBeNull();expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(0);
});

for (const field of ['headSha', 'baseSha'] as const) it(`never binds an earlier seal to another acquired ${field} sharing the same prefix`, async () => {
  const f = fixture();f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
  const comparison = f.facts.comparison;if (comparison.kind !== 'bitbucket-review') throw new Error('Bad fixture');
  const facts: ProviderDiffSourceFacts = { ...f.facts, comparison: { ...comparison, [field]: field === 'headSha' ? `${REF}${'c'.repeat(28)}` : 'c'.repeat(40) } };
  expect(providerOutlineContext(f.page, { ...f.result, sourceFacts: facts }, readBitbucketDiff(document)!).newSources.size).toBe(0);
});

it('revokes a sealed reference even when the comparison changes and returns before observation', async () => {
  const f = fixture();f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
  const selection = document.querySelector('[data-selection]')!;selection.setAttribute('aria-expanded', 'true');selection.setAttribute('aria-expanded', 'false');
  await Promise.resolve();expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(0);
});

it('observes an ordinary trusted native opener without closing its menu or fetching source', async () => {
  const f = fixture();trustedClick(f.opener);
  await vi.waitFor(() => expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(1));
  expect(f.opener.getAttribute('aria-expanded')).toBe('true');expect(f.clicks).toEqual([true]);expect(f.fetcher).not.toHaveBeenCalled();
  trustedClick(f.opener);expect(f.opener.getAttribute('aria-expanded')).toBe('false');expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(1);
});

for (const change of ['href', 'link owner', 'popup owner'] as const) it(`revokes connected passive source custody after a ${change} change`, async () => {
  const f = fixture();trustedClick(f.opener);await vi.waitFor(() => expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(1));
  const popup = f.ownedPopups[0]!, link = popup.querySelector('a')!;
  if (change === 'href') link.href = `/team/repo/src/${B}/${PATH}`;
  if (change === 'link owner') popup.before(link);
  if (change === 'popup owner') { const holder = document.createElement('div');document.body.append(holder);holder.append(popup); }
  expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(0);expect(f.fetcher).not.toHaveBeenCalled();
});

it('lets explicit Find supersede an unsettled passive open-close without consuming a false failure', async () => {
  const config: { popup: 'absent' | 'valid' } = { popup: 'absent' }, f = fixture(config);
  trustedClick(f.opener);trustedClick(f.opener);config.popup = 'valid';f.click();
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));f.update();expect(f.manager.source(f.entry)).not.toBeNull();expect(f.clicks).toEqual([true, true, false, false]);
});

for (const change of ['replace row', 'code text', 'coordinate'] as const) it(`withdraws a sealed source when original ${change} changes under the same header`, async () => {
  const f = fixture();f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
  const row = f.entry.root.querySelector('[data-qa="code-line"]')!;
  if (change === 'replace row') row.replaceWith(row.cloneNode(true));
  if (change === 'code text') row.querySelector('[data-line-type]')!.textContent = 'different';
  if (change === 'coordinate') row.querySelector('[data-new-line-number]')!.setAttribute('data-new-line-number', '4');
  expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(0);
});

it('retains a sealed source when native context adds rows without replacing original source', async () => {
  const f = fixture();f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
  const original = f.entry.root.querySelector('[data-qa="code-line"]')!, owner = original.parentElement!, extra = owner.cloneNode(true);
  if (!(extra instanceof HTMLElement)) throw new Error('Bad fixture');extra.querySelector('[data-old-line-number]')!.setAttribute('data-old-line-number', '4');extra.querySelector('[data-new-line-number]')!.setAttribute('data-new-line-number', '4');extra.querySelector('[data-line-type]')!.textContent = '';
  owner.after(extra);await Promise.resolve();expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(1);
});

it('allows the documented Syntax-on LF adjustment when an original final row gains following context', async () => {
  const f = fixture();f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));
  const original = f.entry.root.querySelector<HTMLElement>('[data-qa="code-line"]')!, owner = original.parentElement!, code = original.querySelector<HTMLElement>('[data-line-type]')!, extra = owner.cloneNode(true);
  if (!(extra instanceof HTMLElement)) throw new Error('Bad fixture');
  owner.closest('.diff-chunk')!.setAttribute('role', 'rowgroup');
  code.className = 'code-diff syntax-highlighted __rbb_syntax_highlight';code.setAttribute('role', 'gridcell');code.setAttribute('aria-label', 'Unchanged:     last()');code.append('\n');
  extra.querySelector('[data-old-line-number]')!.setAttribute('data-old-line-number', '4');extra.querySelector('[data-new-line-number]')!.setAttribute('data-new-line-number', '4');extra.querySelector('[data-line-type]')!.textContent = '';owner.after(extra);
  expect(providerOutlineContext(f.page, f.result, readBitbucketDiff(document)!).newSources.size).toBe(1);expect(f.entry.readLines?.().find((line) => line.newLine === 3)?.newText).toBe('    last()');
});

it('returns native menu autofocus to the original keyboard Find control without allowing repeat reads', async () => {
  const f = fixture({ focus: 'native' }), button = f.entry.root.querySelector<HTMLButtonElement>('[data-geld-test-boundaries]')!;button.focus();const focus = vi.spyOn(button, 'focus');
  f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));f.update();
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });expect(document.activeElement).toBe(button);expect(button.disabled).toBe(false);expect(button.getAttribute('aria-disabled')).toBe('true');
  f.click();expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.clicks).toHaveLength(2);
});

it('does not steal focus back from an unrelated action during source preparation', async () => {
  const f = fixture({ focus: 'external' }), button = f.entry.root.querySelector<HTMLButtonElement>('[data-geld-test-boundaries]')!;button.focus();const focus = vi.spyOn(button, 'focus');
  f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));f.update();expect(document.activeElement).toBe(f.outside);expect(focus).not.toHaveBeenCalled();
});

it('keeps a native abbreviated URL distinct when both API snapshots directly supply its full head', async () => {
  const f = fixture({ sourceRef: H });f.click();await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1));f.update();
  const frame = readBitbucketDiff(document)!.readNewSourceFrame!()!;
  expect(frame.readReference?.(f.entry)).toMatchObject({ literalRef: REF, resolution: 'full-api-head-prefix', url: `https://bitbucket.org/team/repo/src/${REF}/${PATH}` });
  expect(frame.read(f.entry)).toBeNull();expect(f.manager.source(f.entry)?.lines).toEqual(source);expect(f.fetcher).toHaveBeenCalledTimes(1);
});


it('binds native PR source references to the acknowledged whitespace comparison and revokes stale mode authority', async () => {
  const f = fixture();let current = true;
  const page = { ...f.page, version: `${f.page.version}|native-whitespace:source-head-base:true`, diffMode: { ignoreWhitespace: true, current: () => current } };
  const facts = providerDiffSourceFacts(page, { kind: 'bitbucket-review', headSha: H, baseSha: B, sourceRepository: 'team/repo', sourceRef: REF, topic: true }, [{ path: PATH, newPath: PATH }])!;
  const result = { ...f.result, sourceFacts: facts };f.native.update(page, result);trustedClick(f.opener);
  await vi.waitFor(() => expect(providerOutlineContext(page, result, readBitbucketDiff(document)!).newSources.size).toBe(1));
  const frame = readBitbucketDiff(document)!.readNewSourceFrame!()!;
  expect(frame.current()).toBe(true);expect(providerOutlineContext(page, result, readBitbucketDiff(document)!).newSources.get(f.entry.root)).toMatchObject({ headSha: H });
  current = false;expect(frame.current()).toBe(false);expect(providerOutlineContext(page, result, readBitbucketDiff(document)!).newSources.size).toBe(0);
});
