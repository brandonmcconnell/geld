// @vitest-environment happy-dom
import { DEFAULT_SETTINGS, repositoryKey } from '@geld/core';
import { readBitbucketDiff } from './diff';
import { describeBitbucketProviderPage } from './page';
import { bitbucketAdapter } from './index';
import { bitbucketNextTestContext, bitbucketWholeSourceURL, createBitbucketWholeTestAdapter } from './whole-test-context';
import { createBitbucketTransport } from './transport';
import { ProviderHttpAdmission } from '../providers/http-admission';
import { providerDiffSourceFacts, providerOutlineContext } from '../providers/source-facts';
import type { ProviderNewFileRevision } from '../providers/source-facts';
import { ProviderWholeTestContext } from '../providers/whole-test-context';
import type { ProviderDiffResult } from '../providers/types';
import { applyBitbucketWorkflowSyntax, removeBitbucketWorkflowSyntax } from './workflow-syntax';

vi.mock('wxt/utils/storage', () => ({ storage: { getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }) } }));

const H = 'a'.repeat(40), PATH = 'spec/file.test.ts';
const source = ["it('whole declaration', () => {", '  first();', '  second();', '});', 'export const next = 1;'];
function revision(path = PATH): ProviderNewFileRevision {
  const repository = { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'team/repo' } as const;
  return { repository, headSha: H, path, key: JSON.stringify([repositoryKey(repository), H, path]) };
}
function line(number: number, text = `line${number}`): string {
  return `<div class="lines-wrapper" role="row" data-key="code-line"><div data-qa="code-line"><div data-key="code-line-number" data-old-line-number="${number}" data-new-line-number="${number}"></div><pre><span data-line-type=" ">${text}</span></pre></div></div>`;
}
function gap(directions: readonly string[]): string {
  return `<div class="chunk-heading-wrapper"><div class="show-more-lines-wrapper">${directions.map((direction) => `<div role="presentation"><button type="button" data-qa="pr-diff-show-more-lines-${direction}">Show more lines</button></div>`).join('')}</div></div>`;
}
function chunk(contents: string): string { return `<div class="diff-chunk" role="rowgroup"><div class="diff-chunk-inner">${contents}</div></div>`; }
function fixture(body = chunk(gap(['above']) + line(100) + line(115)) + chunk(gap(['below', 'above']) + line(131) + line(158)) + chunk(gap(['below']))) {
  window.location.href = `https://bitbucket.org/team/repo/commits/${H}`;
  document.body.innerHTML = `<main role="main"><h1 data-qa="page-header">${H.slice(0, 12)}</h1><div role="group"><a href="/team/repo/src/${H}/">View source</a></div><div role="region" aria-label="Diff"><div><div id="chg-${PATH}"></div><div><article data-qa="branch-diff-file"><div data-qa="bk-file__header" data-testid="file-header"><span aria-label="Expand/collapse file"></span><div data-qa="bk-file__actions" data-testid="file-actions"><button type="button">Original file menu</button></div><label>Viewed<input type="checkbox" disabled></label></div><div data-qa="bk-file__content" data-testid="file-content">${body}</div></article></div></div></div></main>`;
  return readBitbucketDiff(document)!.entries[0]!;
}
function transport() { return createBitbucketTransport({ origin: () => 'https://bitbucket.org', store: { read: async () => 0, write: async () => undefined } }); }
function syntaxOn(root: HTMLElement): void {
  for (const group of root.querySelectorAll('[role="rowgroup"]')) {
    const codes = [...group.querySelectorAll<HTMLElement>('[data-line-type]')];
    for (const [index, code] of codes.entries()) {
      code.className = 'code-diff syntax-highlighted __rbb_syntax_highlight';code.setAttribute('role', 'gridcell');code.setAttribute('aria-label', `Unchanged: ${code.textContent ?? ''}`);
      if (index < codes.length - 1) code.append('\n');
    }
  }
}
afterEach(() => { removeBitbucketWorkflowSyntax();vi.unstubAllGlobals();document.body.replaceChildren();vi.restoreAllMocks(); });

it('constructs only immutable same-cloud file resources and encodes the original path once', () => {
  expect(bitbucketWholeSourceURL(revision('spec/sp ace%#é.test.ts')).href).toBe(`https://api.bitbucket.org/2.0/repositories/team/repo/src/${H}/spec/sp%20ace%25%23%C3%A9.test.ts`);
  for (const path of ['../secret', 'a//b', '/absolute', 'a\\b', 'a/./b']) expect(() => bitbucketWholeSourceURL(revision(path))).toThrow();
  expect(() => bitbucketWholeSourceURL({ ...revision(), headSha: H.slice(0, 12) })).toThrow();
  expect(() => bitbucketWholeSourceURL({ ...revision(), repository: { ...revision().repository, origin: 'https://other.example' } })).toThrow();
});

for (const [missing, direction] of [[[96], 'above'], [[117], 'below'], [[129], 'above'], [[160], 'below']] as const) it(`activates one original ${direction} control for missing${missing[0]}`, () => {
  const entry = fixture(), viewed = entry.root.querySelector<HTMLInputElement>('input')!;
  const step = bitbucketNextTestContext(entry, missing)!;expect(step).not.toBeNull();expect(step.current()).toBe(true);
  const clicks = [...entry.root.querySelectorAll('button')].map((button) => { const click = vi.fn();button.addEventListener('click', click);return { button, click }; });
  step.activate();step.activate();const used = clicks.filter(({ click }) => click.mock.calls.length > 0);
  expect(used).toHaveLength(1);expect(used[0]?.click).toHaveBeenCalledTimes(1);expect(used[0]?.button.dataset.qa).toBe(`pr-diff-show-more-lines-${direction}`);expect(viewed.checked).toBe(false);
});

it('declines displayed lines, dummy-only gaps, duplicate directions and authored controls', () => {
  const entry = fixture();expect(bitbucketNextTestContext(entry, [100])).toBeNull();
  for (const button of entry.root.querySelectorAll<HTMLElement>('[data-qa^="pr-diff-show-more"]')) button.dataset.qa = 'pr-diff-show-more-lines-is-dummy-chunk';
  expect(bitbucketNextTestContext(entry, [99])).toBeNull();
  const duplicate = fixture(), original = duplicate.root.querySelector('button[data-qa="pr-diff-show-more-lines-above"]')!;original.after(original.cloneNode(true));expect(bitbucketNextTestContext(duplicate, [99])).toBeNull();
  const authored = fixture();authored.root.querySelector('.chunk-heading-wrapper')!.classList.add('ak-renderer-document');expect(bitbucketNextTestContext(authored, [99])).toBeNull();
});

for (const mode of ['disabled', 'removed', 'boundary', 'relocated', 'foreign', 'duplicate'] as const) it(`invalidates the chosen native control after ${mode} drift`, () => {
  const entry = fixture(), step = bitbucketNextTestContext(entry, [99])!, button = entry.root.querySelector<HTMLButtonElement>('button[data-qa="pr-diff-show-more-lines-above"]')!, click = vi.fn();button.addEventListener('click', click);
  if (mode === 'disabled') button.disabled = true;
  if (mode === 'removed') button.remove();
  if (mode === 'boundary') entry.root.querySelector('[data-new-line-number="100"]')!.setAttribute('data-new-line-number', '101');
  if (mode === 'relocated') button.closest('.chunk-heading-wrapper')!.append(button);
  if (mode === 'foreign') button.parentElement!.setAttribute('data-geld-ui', '');
  if (mode === 'duplicate') button.after(button.cloneNode(true));
  expect(step.current()).toBe(false);step.activate();expect(click).not.toHaveBeenCalled();
});

it('mounts a themed explicit intent only in one original file-actions host', () => {
  const entry = fixture(), feature = createBitbucketWholeTestAdapter();expect(feature.intentHost(entry)?.dataset.testid).toBe('file-actions');
  const intent = feature.createIntent(document);expect(intent.button.classList.contains('geld-provider-toggle')).toBe(true);
  const host = feature.intentHost(entry)!;host.after(host.cloneNode(true));expect(feature.intentHost(entry)).toBeNull();
});

it('uses same-origin API transport, refuses a retired lease, and preserves shared 429 cooldown', async () => {
  const fetcher = vi.fn(async () => new Response(source.join('\n'), { headers: { 'content-type': 'text/plain' } }));
  const lane = new ProviderHttpAdmission(undefined, 0), client = transport(), feature = createBitbucketWholeTestAdapter(lane, client, fetcher);
  expect((await feature.readSource(revision(), new AbortController().signal, () => true)).lines).toEqual(source);
  expect(fetcher).toHaveBeenCalledWith(`https://bitbucket.org/!api/2.0/repositories/team/repo/src/${H}/${PATH}`, expect.objectContaining({ method: 'GET', credentials: 'same-origin', redirect: 'manual' }));
  await expect(feature.readSource(revision(), new AbortController().signal, () => false)).rejects.toThrow('selection changed');expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(new Response('limited', { status: 429, headers: { 'retry-after': '60' } }));
  await expect(feature.readSource(revision(), new AbortController().signal, () => true)).rejects.toMatchObject({ reason: 'rate-limited' });expect(feature.paused('https://bitbucket.org')).toBe(true);
  await expect(client.fetch('https://api.bitbucket.org/2.0/repositories/team/repo/commit/abcd', {}, fetcher)).rejects.toMatchObject({ reason: 'rate-limited' });expect(fetcher).toHaveBeenCalledTimes(2);client.dispose();
});

for (const kind of ['html', 'redirect', 'binary', 'late source'] as const) it(`refuses ${kind} as whole source`, async () => {
  let current = true;
  const fetcher = vi.fn(async () => {
    if (kind === 'late source') current = false;
    if (kind === 'redirect') return new Response(null, { status: 302, headers: { location: '/login' } });
    return new Response(kind === 'binary' ? 'a\0b' : kind === 'html' ? '<html>Login</html>' : 'source', { headers: { 'content-type': kind === 'html' ? 'text/html' : 'text/plain' } });
  });
  const client = transport(), feature = createBitbucketWholeTestAdapter(new ProviderHttpAdmission(undefined, 0), client, fetcher);
  await expect(feature.readSource(revision(), new AbortController().signal, () => current)).rejects.toThrow();client.dispose();
});

it('wires whole context for a bound full commit without granting PR or abbreviated routes', () => {
  const entry = fixture(), page = describeBitbucketProviderPage(new URL(document.URL))!;
  const facts = providerDiffSourceFacts(page, { kind: 'bitbucket-commit', headSha: H, baseSha: null }, [{ path: PATH, newPath: PATH }])!;
  const result: ProviderDiffResult = { files: [{ path: PATH, additions: 1, deletions: 0, status: 'modified' }], revision: `commit:${H}`, complete: true, sourceFacts: facts };
  const feature = bitbucketAdapter.wholeTests!;expect(feature).toBeDefined();
  const manager = new ProviderWholeTestContext(bitbucketAdapter, feature, () => undefined);
  try {
    const view = readBitbucketDiff(document)!;const context = providerOutlineContext(page, result, view);expect(context.newSources.has(entry.root)).toBe(true);
    manager.update(page, result, view, DEFAULT_SETTINGS, context);manager.mount(entry);expect(entry.root.querySelector('[data-geld-test-boundaries]')).not.toBeNull();
    manager.retire();
    for (const route of [`/team/repo/commits/${H.slice(0, 12)}`, '/team/repo/pull-requests/1/diff']) {
      window.location.href = `https://bitbucket.org${route}`;const unsupported = describeBitbucketProviderPage(new URL(document.URL))!;const current = readBitbucketDiff(document)!;
      manager.update(unsupported, result, current, DEFAULT_SETTINGS, providerOutlineContext(unsupported, result, current));manager.mount(entry);expect(entry.root.querySelector('[data-geld-test-boundaries]')).toBeNull();
    }
  } finally { manager.destroy(); }
});

for (const highlighted of [false, true]) it(`keeps native rows and Viewed intact during whole-source expansion with syntax${highlighted ? 'On' : 'Off'}`, async () => {
  const entry = fixture(chunk(gap(['above']) + line(4, source[3]) + line(5, source[4]))), page = describeBitbucketProviderPage(new URL(document.URL))!;
  if (highlighted) syntaxOn(entry.root);
  const facts = providerDiffSourceFacts(page, { kind: 'bitbucket-commit', headSha: H, baseSha: null }, [{ path: PATH, newPath: PATH }])!;
  const result: ProviderDiffResult = { files: [{ path: PATH, additions: 1, deletions: 0, status: 'modified' }], revision: `commit:${H}`, complete: true, sourceFacts: facts };
  const fetcher = vi.fn(async () => new Response(source.join('\n'), { headers: { 'content-type': 'text/plain' } })), client = transport();
  const feature = createBitbucketWholeTestAdapter(new ProviderHttpAdmission(undefined, 0), client, fetcher), refresh = vi.fn();const manager = new ProviderWholeTestContext(bitbucketAdapter, feature, refresh);
  try {
    const view = readBitbucketDiff(document)!;manager.update(page, result, view, DEFAULT_SETTINGS, providerOutlineContext(page, result, view));manager.mount(entry);
    const intent = entry.root.querySelector<HTMLButtonElement>('[data-geld-test-boundaries]')!;intent.click();await Promise.resolve();expect(fetcher).not.toHaveBeenCalled();
    const event = new MouseEvent('click', { bubbles: true });Object.defineProperty(event, 'isTrusted', { value: true });intent.dispatchEvent(event);
    await vi.waitFor(() => expect(manager.source(entry)?.lines).toEqual(source));
    const original = entry.root.querySelector('[data-qa="code-line"]')!, originalText = original.textContent, native = entry.root.querySelector<HTMLButtonElement>('[data-qa="pr-diff-show-more-lines-above"]')!, click = vi.fn();native.addEventListener('click', click);
    native.addEventListener('click', () => { const group = native.closest('.diff-chunk-inner')!, holder = document.createElement('div');holder.innerHTML = [1, 2, 3].map((n) => line(n, source[n - 1])).join('');native.closest('.chunk-heading-wrapper')!.after(...holder.childNodes);group.querySelector('.chunk-heading-wrapper')!.remove(); });
    manager.reveal(entry, { id: 'R1', kind: 'test', title: 'whole declaration', status: 'unchanged', headKey: 'R1', start: 1, headingKeys: ['R1'], bodyKeys: ['R2', 'R3', 'R4'], additions: 0, deletions: 0 }, () => true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));expect(click).toHaveBeenCalledTimes(1);expect(original.isConnected).toBe(true);expect(original.textContent).toBe(originalText);expect(entry.root.querySelector<HTMLInputElement>('input')!.checked).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { manager.destroy();client.dispose(); }
});

for (const fault of ['aria', 'double LF', 'middle LF', 'missing LF', 'final LF', 'missing group', 'wrong role', 'unhighlighted LF'] as const) it(`declines ambiguous renderer text with ${fault}`, () => {
  const entry = fixture(chunk(line(1, source[0]) + line(2, source[1])));syntaxOn(entry.root);const codes = [...entry.root.querySelectorAll<HTMLElement>('[data-line-type]')], first = codes[0]!;
  if (fault === 'aria') first.setAttribute('aria-label', 'Unchanged: different');
  if (fault === 'double LF') first.append('\n');
  if (fault === 'middle LF') first.textContent = `first\nsecond\n`;
  if (fault === 'missing LF') first.textContent = source[0]!;
  if (fault === 'final LF') codes[1]!.append('\n');
  if (fault === 'missing group') first.closest('[role="rowgroup"]')!.removeAttribute('role');
  if (fault === 'wrong role') first.setAttribute('role', 'cell');
  if (fault === 'unhighlighted LF') first.className = '';
  expect(entry.readLines?.().some((item) => item.newText === null)).toBe(true);
});

it('ends the terminal-LF convention independently at each native rowgroup without changing source identity', () => {
  const entry = fixture();syntaxOn(entry.root);const code = [...entry.root.querySelectorAll('[data-line-type]')], original = code.map((node) => [...node.childNodes]);
  expect(entry.readLines?.().filter((item) => item.kind !== 'hunk').map((item) => item.newText)).toEqual(['line100', 'line115', 'line131', 'line158']);
  expect(code.map((node) => node.textContent)).toEqual(['line100\n', 'line115', 'line131\n', 'line158']);
  expect(code.map((node) => [...node.childNodes])).toEqual(original);
  const page = describeBitbucketProviderPage(new URL(document.URL))!;window.location.href = 'https://bitbucket.org/team/repo/pull-requests/1/diff';
  const pr = describeBitbucketProviderPage(new URL(document.URL))!, facts = providerDiffSourceFacts(pr, { kind: 'bitbucket-review', headSha: H, baseSha: 'b'.repeat(40), sourceRepository: 'team/repo', topic: true }, [{ path: PATH, newPath: PATH }])!;
  const result: ProviderDiffResult = { files: [{ path: PATH, additions: 1, deletions: 0, status: 'modified' }], revision: page.version, complete: true, sourceFacts: facts };
  expect(providerOutlineContext(pr, result, readBitbucketDiff(document)!).newSources.size).toBe(0);
});

it('reads each highlighted rowgroup once and rebuilds its end after native context insertion', () => {
  const entry = fixture(chunk(Array.from({ length: 200 }, (_, index) => line(index + 1)).join('')));syntaxOn(entry.root);
  const group = entry.root.querySelector('[role="rowgroup"]')!, query = vi.spyOn(group, 'querySelectorAll');
  expect(entry.readLines?.()).toHaveLength(200);expect(query).toHaveBeenCalledTimes(1);
  const holder = document.createElement('div');holder.innerHTML = line(201);group.querySelector('.diff-chunk-inner')!.append(...holder.childNodes);
  expect(entry.readLines?.().filter((item) => item.newLine === 200)[0]?.newText).toBeNull();expect(query).toHaveBeenCalledTimes(2);
});

it('normalizes the qualified terminal LF while keeping shell ranges on original Text nodes', () => {
  const yaml = ['pipelines:', '  default:', '    - step:', '        script:', '          - echo "$FOO"', '    - step:', '        name: Next'];
  const entry = fixture(chunk(yaml.map((text, index) => line(index + 1, text)).join('')));syntaxOn(entry.root);
  const text = entry.root.textContent, originals = [...entry.root.querySelectorAll('[data-line-type]')].map((code) => code.firstChild);
  expect(entry.readLines?.().map((item) => item.newText)).toEqual(yaml);
  const registry = new Map<string, Set<AbstractRange>>();vi.stubGlobal('CSS', { highlights: registry });vi.stubGlobal('Highlight', class extends Set<AbstractRange> {});vi.stubGlobal('StaticRange', class { constructor(init: StaticRangeInit) { Object.assign(this, init); } });
  applyBitbucketWorkflowSyntax([{ ...entry, path: 'bitbucket-pipelines.yml' }], 'enabled');
  const ranges = [...registry.values()].flatMap((group) => [...group]);expect(ranges.length).toBeGreaterThan(0);
  for (const range of ranges) {
    expect(originals).toContain(range.startContainer);expect(range.startContainer).toBe(range.endContainer);
    const value = range.startContainer.textContent ?? '';expect(range.endOffset).toBeLessThanOrEqual(value.endsWith('\n') ? value.length - 1 : value.length);
  }
  expect(entry.root.textContent).toBe(text);expect([...entry.root.querySelectorAll('[data-line-type]')].map((code) => code.firstChild)).toEqual(originals);
});
