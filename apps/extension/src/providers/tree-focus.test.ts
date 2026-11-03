// @vitest-environment happy-dom
import { BUNDLED_CATALOG, createMatcher, DEFAULT_SETTINGS } from '@geld/core';
import type { FileStats } from '@geld/core';
import { breakdownFromFiles } from '../github/breakdown';
import { ProviderCategoryTree } from './tree';
import type { ProviderCategoryActions } from './tree';
import type { ProviderDiffView, ProviderTreeEntry } from './types';

const files: readonly FileStats[] = [
  { path: 'src/main.ts', additions: 2, deletions: 0, status: 'modified' },
  { path: 'spec/main.test.ts', additions: 4, deletions: 1, status: 'added' },
];
const { all, hidden } = breakdownFromFiles(files, createMatcher(DEFAULT_SETTINGS, null, BUNDLED_CATALOG));
const trees: ProviderCategoryTree[] = [];
const required = <T>(value: T | null | undefined): T => { if (value == null) throw new Error('Missing source protocol node.');return value; };

function fixture(provider: 'gitlab' | 'bitbucket' = 'gitlab') {
  document.documentElement.setAttribute('data-geld-provider', provider);
  document.body.innerHTML = '<button id="outside">Elsewhere</button><section id="tree"><nav aria-label="File tree"><div id="main"><a href="/review?file_path=src%2Fmain.ts">main.ts</a><button type="button" aria-label="3 unresolved threads"><span>3</span></button></div><div id="spec"><a href="/review?file_path=spec%2Fmain.test.ts">main.test.ts</a><button type="button" aria-label="1 unresolved thread"><span>1</span></button></div></nav></section>';
  const host = required(document.querySelector<HTMLElement>('#tree'));
  const nav = required(host.querySelector<HTMLElement>('nav'));
  const main = required(document.querySelector<HTMLElement>('#main'));
  const spec = required(document.querySelector<HTMLElement>('#spec'));
  const link = required(main.querySelector<HTMLAnchorElement>('a'));
  const specLink = required(spec.querySelector<HTMLAnchorElement>('a'));
  const treeRows: ProviderTreeEntry[] = [{ path: files[0]!.path, root: link, link, presentationRoot: main }, { path: files[1]!.path, root: specLink, link: specLink, presentationRoot: spec }];
  const view: ProviderDiffView = { kind: 'reduced-native-tree-protocol', container: document.body, entries: [], tree: treeRows, treeHost: host, treeContainer: nav, filteredPaths: new Set(), virtualized: true };
  const actions: ProviderCategoryActions = { revealPath: vi.fn(), setExpanded: vi.fn(), subjectKey: `${provider}:repo:review:full-head-a`, selectedCategoryId: 'essential' };
  const tree = new ProviderCategoryTree();trees.push(tree);
  const update = (next: ProviderCategoryActions = actions, nextFiles: readonly FileStats[] = files): void => tree.update(view, hidden, all, nextFiles, next);
  const source = (category: 'essential' | 'tests'): HTMLElement => category === 'essential' ? main : spec;
  const mark = (category: 'essential' | 'tests', count = 4): void => { const row = source(category);required(row.querySelector('button')).setAttribute('aria-label', `${count} unresolved threads`);required(row.querySelector('span')).textContent = String(count); };
  const region = (category: 'essential' | 'tests'): HTMLElement => required(host.querySelector<HTMLElement>(category === 'essential' ? '.geld-provider-essential-content' : '.geld-provider-category-content'));
  const control = (category: 'essential' | 'tests', kind: 'file' | 'action' | 'folder'): HTMLElement => required(region(category).querySelector<HTMLElement>(kind === 'folder' ? '.geld-provider-category-folder' : `[data-geld-category-path] ${kind === 'file' ? 'a' : 'button'}`));
  return { host, nav, main, spec, link, specLink, tree, treeRows, view, actions, update, source, mark, region, control };
}

afterEach(() => { for (const tree of trees) tree.clear();trees.length = 0;document.body.replaceChildren();document.documentElement.removeAttribute('data-geld-provider');vi.restoreAllMocks(); });

describe.each(['gitlab', 'bitbucket'] as const)('%s owned accordion focus continuity', (provider) => {
  it.each(['essential', 'tests'] as const)('preserves the focused %s file on an original native comment-mark update', (category) => {
    const f = fixture(provider);const options = { ...f.actions, selectedCategoryId: category };f.update(options);
    const old = f.control(category, 'file');old.focus();expect(document.activeElement).toBe(old);
    const parent = f.source(category).parentNode;const nativeLink = required(f.source(category).querySelector('a'));
    f.mark(category);const sourceMarkup = f.nav.innerHTML;f.update(options);
    expect(old.isConnected).toBe(false);expect(document.activeElement).toBe(f.control(category, 'file'));
    expect(f.source(category).parentNode).toBe(parent);expect(f.source(category).querySelector('a')).toBe(nativeLink);expect(f.nav.innerHTML).toBe(sourceMarkup);
    expect(f.actions.revealPath).not.toHaveBeenCalled();expect(f.actions.setExpanded).not.toHaveBeenCalled();
  });

  it.each(['essential', 'tests'] as const)('keeps focus on the same %s native comment action instead of its file link', (category) => {
    const f = fixture(provider);const options = { ...f.actions, selectedCategoryId: category };f.update(options);
    const native = required(f.source(category).querySelector<HTMLButtonElement>('button'));const click = vi.fn();native.addEventListener('click', click);
    const old = f.control(category, 'action');old.focus();f.mark(category);f.update(options);
    expect(old.isConnected).toBe(false);expect(document.activeElement).toBe(f.control(category, 'action'));expect(document.activeElement).not.toBe(f.control(category, 'file'));
    expect(f.control(category, 'action').getAttribute('aria-label')).toBe('4 unresolved threads');expect(click).not.toHaveBeenCalled();
    f.control(category, 'action').click();expect(click).toHaveBeenCalledOnce();expect(f.source(category).querySelector('button')).toBe(native);
  });

  it.each(['essential', 'tests'] as const)('preserves the focused %s folder and its collapsed choice on a status update', (category) => {
    const f = fixture(provider);const options = { ...f.actions, selectedCategoryId: category };f.update(options);
    const old = f.control(category, 'folder');old.click();old.focus();expect(old.getAttribute('aria-expanded')).toBe('false');
    f.mark(category);f.update(options);
    expect(old.isConnected).toBe(false);expect(document.activeElement).toBe(f.control(category, 'folder'));expect(f.control(category, 'folder').getAttribute('aria-expanded')).toBe('false');
  });
});

it.each(['removed', 'replaced', 'disabled', 'readonly', 'aria-disabled', 'hidden', 'reindexed', 'changed-role'] as const)('does not retarget focus when the original trailing action is %s', (change) => {
  const f = fixture();const options = { ...f.actions, selectedCategoryId: 'tests' };f.update(options);f.control('tests', 'action').focus();
  const native = required(f.spec.querySelector<HTMLButtonElement>('button'));
  if (change === 'removed') native.remove();
  if (change === 'replaced') native.replaceWith(native.cloneNode(true));
  if (change === 'disabled') native.disabled = true;
  if (change === 'readonly') native.setAttribute('readonly', '');
  if (change === 'aria-disabled') native.setAttribute('aria-disabled', 'true');
  if (change === 'hidden') native.hidden = true;
  if (change === 'reindexed') native.before(native.cloneNode(true));
  if (change === 'changed-role') native.setAttribute('role', 'link');
  f.specLink.setAttribute('aria-label', 'Updated native annotation');
  f.update(options);
  expect(document.activeElement).toBe(document.body);expect(document.activeElement).not.toBe(f.control('tests', 'file'));
});

it('does not restore a removed file or a folder no longer in the complete inventory', () => {
  for (const kind of ['file', 'folder'] as const) {
    const f = fixture();f.update();f.control('essential', kind).focus();
    f.update(f.actions, files.filter((file) => file.path !== 'src/main.ts'));
    expect(document.activeElement).toBe(document.body);f.tree.clear();
  }
});

it.each(['aria-disabled', 'aria-hidden', 'readonly', 'inert', 'role'] as const)('does not focus a new file control marked %s', (attribute) => {
  const f = fixture();f.update();f.control('essential', 'file').focus();
  f.link.setAttribute(attribute, attribute === 'role' ? 'button' : attribute.startsWith('aria-') ? 'true' : '');f.update();
  expect(document.activeElement).toBe(document.body);
});

it.each(['subject', 'provider', 'category'] as const)('cancels focus restoration across a changed %s', (change) => {
  const f = fixture();f.update();f.control('essential', 'file').focus();f.mark('essential');
  if (change === 'provider') document.documentElement.setAttribute('data-geld-provider', 'bitbucket');
  f.update({ ...f.actions, ...(change === 'subject' ? { subjectKey: 'gitlab:repo:other-review:head-b' } : {}), ...(change === 'category' ? { selectedCategoryId: 'tests' } : {}) });
  expect(document.activeElement).not.toBe(f.control('essential', 'file'));expect(document.activeElement).not.toBe(f.control('tests', 'file'));
});

it('preserves unrelated focus that moves during the same owned replacement', () => {
  const f = fixture();f.update();f.control('essential', 'file').focus();f.mark('essential');
  const outside = required(document.querySelector<HTMLButtonElement>('#outside'));
  const content = f.region('essential');const replace = content.replaceChildren.bind(content);
  vi.spyOn(content, 'replaceChildren').mockImplementation((...nodes) => { replace(...nodes);outside.focus(); });
  f.update();expect(document.activeElement).toBe(outside);
});

it('leaves outside focus and the native active link untouched while updating owned rows', () => {
  const f = fixture();f.update();f.link.focus();f.mark('essential');f.update();expect(document.activeElement).toBe(f.link);
  const outside = required(document.querySelector<HTMLButtonElement>('#outside'));outside.focus();f.mark('essential', 5);f.update();expect(document.activeElement).toBe(outside);
});

it('keeps stable focused controls when there is no visual change and never restores after clear', () => {
  const f = fixture();f.update();const original = f.control('essential', 'file');original.focus();f.update();expect(f.control('essential', 'file')).toBe(original);expect(document.activeElement).toBe(original);
  f.tree.clear();f.update();expect(document.activeElement).toBe(document.body);expect(document.activeElement).not.toBe(f.control('essential', 'file'));
});
