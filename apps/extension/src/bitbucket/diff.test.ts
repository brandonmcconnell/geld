// @vitest-environment happy-dom
import { ProviderCounts } from '../providers/dom';
import { bitbucketActionHost, bitbucketDescriptionHost, bitbucketHeaderTargets, bitbucketReviewHost, readBitbucketDiff } from './diff';

beforeEach(() => {
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff';
  // Reduced from installed Chrome's anonymous PR27 capture on November 1, 2026.
  document.body.innerHTML = `<header data-testid="pr-header"><div data-qa="pr-header-actions-drop-down-menu-styles"><button>More actions</button></div></header>
    <a role="tab" id="pull-request-tabs-1" href="/atlassian/bitbucket-upload-file/pull-requests/27/diff"><div>Files changed<span><span>5</span></span></div></a>
    <div role="region" aria-label="File view"><div id="file-tree"><div><div><span><h5>Lines updated</h5></span><div><span aria-hidden="true"><span>+46</span></span><span aria-hidden="true"><span>-29</span></span></div></div></div>
      <ul role="list"><li><a href="#chg-bitbucket-pipelines.yml"><div role="presentation"><span>Modified file</span></div><span role="presentation">bitbucket-pipelines.yml</span><div><span aria-hidden="true"><span>+12</span></span><span>12 lines added,</span><span aria-hidden="true"><span>-6</span></span><span>6 lines removed,</span></div></a></li>
      <li><a href="#chg-README.md"><div role="presentation">Modified file</div><span>README.md</span><div><span>+24</span><span>-21</span></div></a></li>
      <li><a href="#chg-requirements.txt"><span>requirements.txt</span><div><span>+1</span><span>-1</span></div></a></li>
      <li><button aria-expanded="true"><span aria-label="Directory">.changes/next-release</span></button><ul role="list"><li><a href="#chg-.changes/next-release/patch-20250701070558543229.json"><span>Added file</span><span>patch-20250701070558543229.json</span><div><span>+4</span></div></a></li></ul></li>
      <li><button aria-expanded="true">pipe</button><ul role="list"><li><a href="#chg-pipe/pipe.py"><span>Modified file</span><span>pipe.py</span><div><span>+5</span><span>-1</span></div></a></li></ul></li></ul></div></div>
    <div role="region" aria-label="Diff"><div></div>
      <div><div id="chg-bitbucket-pipelines.yml"></div><div><article data-qa="branch-diff-file" aria-label="Diff of file bitbucket-pipelines.yml"><div>
        <div data-qa="bk-file__header" data-testid="file-header" tabindex="0"><span role="img" aria-label="Expand/collapse file"></span><h2 data-qa="bk-filepath">bitbucket-pipelines.yml</h2><label><input type="checkbox" name="controlled-checkbox"><span>Viewed</span></label></div>
        <div aria-hidden="false"><div><div data-qa="bk-file__content" data-testid="file-content"><div role="grid" aria-label="Diff content">
          <div class="lines-wrapper" data-key="code-line" role="row"><div class="line-wrapper type-normal" data-qa="code-line"><div data-key="code-line-number" data-old-line-number="1" data-new-line-number="1"></div><pre><span class="diff-line-type"> </span><span data-line-type=" ">image:</span></pre></div></div>
          <div class="lines-wrapper" data-key="code-line" role="row"><div class="line-wrapper type-del" data-qa="code-line"><div data-key="code-line-number" data-old-line-number="4"></div><pre><span class="diff-line-type">-</span><span data-line-type="-">test: &amp;test</span></pre></div></div>
          <div class="lines-wrapper" data-key="code-line" role="row"><div class="line-wrapper type-add" data-qa="code-line"><div data-key="code-line-number" data-new-line-number="4"></div><pre><span class="diff-line-type">+</span><span data-line-type="+">lint: &amp;lint</span></pre></div></div>
        </div></div></div></div></div></article></div></div>
      <div><div id="chg-README.md"></div><div><div><pre data-testid="pr-diff-placeholder-wrapper"><h2>README.md</h2>12,12  example</pre></div></div></div>
      <div><div id="chg-requirements.txt"></div><div><div><pre data-testid="pr-diff-placeholder-wrapper"><h2>requirements.txt</h2>1, - old</pre></div></div></div>
      <div><div id="chg-.changes/next-release/patch-20250701070558543229.json"></div><div><div><pre data-testid="pr-diff-placeholder-wrapper"><h2>patch-20250701070558543229.json</h2>,1 + {</pre></div></div></div>
      <div><div id="chg-pipe/pipe.py"></div><div><div><pre data-testid="pr-diff-placeholder-wrapper"><h2>pipe.py</h2>1,1 import</pre></div></div></div>
      <div data-qa="diff-end-of-list" aria-hidden="true"></div>
    </div>`;
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing fixture node');
  return value;
}

it('reads all normal-flow native file wrappers, including lazy placeholders and nested tree paths', () => {
  const view = required(readBitbucketDiff(document));
  expect(view.virtualized).toBe(false);
  expect(view.entries.map((file) => file.path)).toEqual(['bitbucket-pipelines.yml', 'README.md', 'requirements.txt', '.changes/next-release/patch-20250701070558543229.json', 'pipe/pipe.py']);
  expect(view.entries.every((file) => file.root.parentElement === view.container)).toBe(true);
  expect(view.entries[0]).toMatchObject({ anchor: 'chg-bitbucket-pipelines.yml', additions: 12, deletions: 6 });
  expect(view.tree.map((file) => file.path)).toEqual(view.entries.map((file) => file.path));
  expect(view.tree[0]?.presentationRoot).toBe(view.tree[0]?.link);
  expect(view.tree[0]?.root.tagName).toBe('LI');
  expect(view.treeContainer?.tagName).toBe('UL');
  expect(view.treeContainer?.contains(required(view.tree[4]).root)).toBe(true);
  expect(view.entries[3]?.deletions).toBe(0);
  expect(view.entries[1]?.expand()).toBe(false);
  expect(view.entries[1]?.collapse()).toBe(false);
  expect(view.entries[1]?.isViewed?.()).toBeNull();
});

it('prepares lazy reveal through viewport hydration without claiming native expansion succeeded', () => {
  const file = required(readBitbucketDiff(document)?.entries[1]);
  const scroll = vi.spyOn(file.root, 'scrollIntoView');
  expect(file.expand()).toBe(false);
  expect(scroll).not.toHaveBeenCalled();
  file.prepareReveal?.();
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
});

it('mounts the accordion beside the native toolbar and statistics inside the actual nested tree wrapper', () => {
  // Reduced from anonymous PR27's full-height native file tree in the installed Chrome capture.
  const tree = required(document.querySelector<HTMLElement>('#file-tree'));
  tree.innerHTML = '<div><div><button type="button"><span>Filter files</span></button><button type="button"><span>Search changes</span></button></div><div><div><span><h5>Lines updated</h5></span><div><span aria-hidden="true"><span>+46</span></span><span aria-hidden="true"><span>-29</span></span></div></div></div><ul role="list"><li><a href="#chg-bitbucket-pipelines.yml"><span>bitbucket-pipelines.yml</span></a></li></ul></div>';
  const view = required(readBitbucketDiff(document));
  const list = required(tree.querySelector<HTMLElement>('ul[role="list"]'));
  const toolbar = required(tree.querySelector('button'));
  expect(view.treeHost).toBe(tree.firstElementChild);
  expect(view.treeHost).not.toBe(tree);
  expect(view.treeContainer).toBe(list);
  expect(view.treeContainer?.parentElement).toBe(view.treeHost);
  const owned = document.createElement('nav');
  owned.setAttribute('data-geld-ui', '');
  view.treeHost?.append(owned);
  expect(owned.parentElement).toBe(list.parentElement);
  expect(tree.querySelector('button')).toBe(toolbar);
  expect(bitbucketHeaderTargets(document)[1]?.additions?.textContent).toBe('+46');
  expect(bitbucketHeaderTargets(document)[1]?.deletions?.textContent).toBe('-29');
});

it('uses native collapse and viewed controls without moving or replacing native nodes', () => {
  const view = required(readBitbucketDiff(document));
  const file = required(view.entries[0]);
  const header = required(file.root.querySelector<HTMLElement>('[data-testid="file-header"]'));
  const animation = required(file.root.querySelector('[data-testid="file-content"]')?.parentElement?.parentElement);
  header.addEventListener('click', () => { animation.setAttribute('aria-hidden', String(animation.getAttribute('aria-hidden') === 'false')); });
  const parent = file.root.parentElement;
  const code = file.root.querySelector('[data-qa="code-line"]');
  expect(file.isExpanded?.()).toBe(true);
  expect(file.collapse()).toBe(true);
  expect(file.isExpanded?.()).toBe(false);
  expect(file.expand()).toBe(true);
  expect(file.isExpanded?.()).toBe(true);
  expect(file.root.parentElement).toBe(parent);
  expect(file.root.querySelector('[data-qa="code-line"]')).toBe(code);
  expect(file.isViewed?.()).toBe(false);
  expect(file.markViewed?.()).toBe(true);
  expect(file.isViewed?.()).toBe(true);
  const checkbox = required(file.root.querySelector<HTMLInputElement>('input'));
  checkbox.disabled = true;
  expect(file.markViewed?.()).toBe(false);
  expect(file.isViewed?.()).toBeNull();
});

it('reads native line numbers and exact code text independently of display signs', () => {
  const file = required(readBitbucketDiff(document)?.entries[0]);
  expect(file.readLines?.().map(({ oldLine, newLine, oldText, newText, kind }) => ({ oldLine, newLine, oldText, newText, kind }))).toEqual([
    { oldLine: 1, newLine: 1, oldText: 'image:', newText: 'image:', kind: 'context' },
    { oldLine: 4, newLine: null, oldText: 'test: &test', newText: null, kind: 'removed' },
    { oldLine: null, newLine: 4, oldText: null, newText: 'lint: &lint', kind: 'added' },
  ]);
});

it('rewrites only count text and restores native counts, badge nodes, and tab accessibility', () => {
  const targets = bitbucketHeaderTargets(document);
  const tab = required(document.querySelector('#pull-request-tabs-1'));
  const badge = required(targets[0]?.files);
  const counts = new ProviderCounts();
  expect(targets).toHaveLength(2);
  expect(targets[0]?.hoverHosts).toEqual([tab]);
  const stats = required(targets[1]?.additions?.parentElement?.parentElement?.parentElement);
  expect(targets[1]?.keyboardHoverHosts).toEqual([stats]);
  expect(targets[1]?.accessibleSummaryHost).toBe(stats);
  counts.write(badge, 3);
  counts.write(targets[1]?.additions ?? null, 20);
  counts.write(targets[1]?.deletions ?? null, 10);
  expect(tab.textContent).toBe('Files changed3');
  expect(targets[1]?.additions?.textContent).toBe('+20');
  expect(targets[1]?.deletions?.textContent).toBe('-10');
  expect(bitbucketHeaderTargets(document)[0]?.files).toBe(badge);
  counts.restore();
  expect(tab.getAttribute('role')).toBe('tab');
  expect(tab.textContent).toBe('Files changed5');
  expect(targets[1]?.additions?.textContent).toBe('+46');
  expect(targets[1]?.deletions?.textContent).toBe('-29');
});

it('ignores extension clones and foreign nested anchors, preserving provider-filtered paths', () => {
  const view = required(readBitbucketDiff(document));
  required(view.entries[1]).root.hidden = true;
  const clone = view.container.cloneNode(true);
  const ui = document.createElement('section');
  ui.setAttribute('data-geld-ui', '');
  ui.append(clone, required(view.treeHost).cloneNode(true));
  document.body.prepend(ui);
  view.container.insertAdjacentHTML('beforeend', '<section><div><div id="chg-fake"><article data-qa="branch-diff-file"></article></div></div></section>');
  const result = required(readBitbucketDiff(document));
  expect(result.container).toBe(view.container);
  expect(result.entries).toHaveLength(5);
  expect(result.tree).toHaveLength(5);
  expect(result.filteredPaths).toEqual(new Set(['README.md']));
  expect(bitbucketHeaderTargets(document)).toHaveLength(2);
});

it('finds the observed overview host outside activity pagination and the exact description body', () => {
  document.body.insertAdjacentHTML('beforeend', '<section data-qa="pull-request-description"><div class="ak-renderer-wrapper"><div class="ak-renderer-document"><p>Support API token</p></div></div></section><div id="activity-column"><div data-qa="pr-activity"><h2>Activity</h2><section data-qa="conversations-global-style"><input data-testid="chrome-collapsed"></section><div data-qa="pull-request-activity"></div></div></div>');
  expect(bitbucketReviewHost(document)).toBe(document.querySelector('#activity-column'));
  expect(bitbucketActionHost(document)).toBe(document.querySelector('[data-qa="pr-header-actions-drop-down-menu-styles"]'));
  expect(bitbucketDescriptionHost(document)).toBe(document.querySelector('.ak-renderer-document'));
});

it('leaves unsupported shells and unrelated file regions untouched', () => {
  document.body.innerHTML = '<div id="root"></div><div role="region" aria-label="Other"><div id="chg-nope"></div></div>';
  expect(readBitbucketDiff(document)).toBeNull();
  expect(bitbucketHeaderTargets(document)).toEqual([]);
  expect(bitbucketReviewHost(document)).toBeNull();
  expect(bitbucketActionHost(document)).toBeNull();
  expect(bitbucketDescriptionHost(document)).toBeNull();
});

it('reads the actual standalone commit diff and both native file-count surfaces', () => {
  // Reduced from anonymous commit 9777bca47119 in the installed Chrome capture.
  document.body.innerHTML = '<h1 data-qa="page-header">9777bca</h1><button data-testid="commit-more-button--trigger">more</button><div role="region" aria-label="Diff"><div></div><div><div><h2>1 file</h2></div><div></div></div><div><div id="chg-pipe/pipe.py"></div><div><article data-qa="branch-diff-file"><div data-qa="bk-file__header" data-testid="file-header"><span aria-label="Expand/collapse file"></span><h2 data-qa="bk-filepath">pipe/pipe.py</h2></div><div aria-hidden="false"><div data-qa="bk-file__content" data-testid="file-content"><div data-qa="code-line"><div data-key="code-line-number" data-new-line-number="18"></div><span data-line-type="+"># These are the variables that are used in the pipe code.</span></div><div data-qa="code-line"><div data-key="code-line-number" data-new-line-number="19"></div><span data-line-type="+"># The variables are listed in README.md.</span></div></div></div></article></div></div><div data-qa="diff-end-of-list"></div></div><div data-testid="sidebar-tab-files" role="tab"><span><div><span>Files</span><span><span>1</span></span></div></span></div>';
  const view = required(readBitbucketDiff(document));
  expect(view.entries.map((file) => file.path)).toEqual(['pipe/pipe.py']);
  expect(view.entries[0]?.readLines?.().filter((line) => line.kind === 'added')).toHaveLength(2);
  const targets = bitbucketHeaderTargets(document);
  expect(targets.map((target) => target.files?.textContent)).toEqual(['1 file', '1']);
  expect(targets[0]?.keyboardHoverHosts).toEqual([targets[0]?.files]);
  expect(targets[1]?.hoverHosts).toEqual([document.querySelector('[data-testid="sidebar-tab-files"]')]);
  const counts = new ProviderCounts();
  for (const target of targets) counts.write(target.files, 0);
  expect(targets.map((target) => target.files?.textContent)).toEqual(['0 files', '0']);
  counts.restore();
  expect(targets.map((target) => target.files?.textContent)).toEqual(['1 file', '1']);
});
