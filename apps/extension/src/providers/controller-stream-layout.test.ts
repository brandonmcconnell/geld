// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import { readGitLabDiff } from '../gitlab/diff';
import { ProviderController } from './controller';
import type { ProviderAdapter, ProviderReviewPage } from './types';

vi.mock('wxt/utils/storage', () => ({ storage: {
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }),
  getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
} }));

// Reduced from installed public GitLab!162842 run41341156090: five direct images and six streamed images.
const PATHS = [
  'doc/tutorials/observability/img/django_metrics.png',
  'doc/tutorials/observability/img/django_traces.png',
  'doc/tutorials/observability/img/java_configuration_menu.png',
  'doc/tutorials/observability/img/java_edit_configuration.png',
  'doc/tutorials/observability/img/maven_changes.png',
  'doc/user/application_security/vulnerabilities/img/example_code_flow_of_python_applications_v17_3.png',
  'doc/user/infrastructure/clusters/connect/img/variables_civo.png',
  'doc/user/project/img/issue_boards_blocked_icon_v17_3.png',
  'doc/user/project/merge_requests/img/status_checks_create_form_v14_0.png',
  'doc/user/project/merge_requests/img/status_checks_list_view_v14_0.png',
  'doc/user/project/merge_requests/img/status_checks_update_form_v14_0.png',
];
const SETTINGS: GeldSettings = { ...DEFAULT_SETTINGS, hideWhitespace: false, categoryPatterns: { tests: [PATHS[0] ?? '', PATHS[5] ?? ''] } };
const running: ProviderController[] = [];
const CSS = readFileSync('src/providers/style.css', 'utf8');

function node(selector: string): HTMLElement {
  const value = document.querySelector<HTMLElement>(selector);
  if (value === null) throw new Error(`Missing fixture ${selector}`);
  return value;
}
function image(path: string, index: number): string {
  return `<diff-file id="native-image-${index}" data-file-data='${JSON.stringify({ new_path: path, viewer: 'image' })}'><article>
    <header><button aria-label="Hide file contents" data-click="toggleFile"></button><button aria-label="Show file contents" data-click="toggleFile"></button><input data-viewed-checkbox type="checkbox" disabled></header>
    <details data-file-body open><summary></summary><img alt="Native before image"><img alt="Native after image"></details>
    </article><diff-file-mounted></diff-file-mounted></diff-file>`;
}
function nativeControls(root: ParentNode): void {
  for (const file of root.querySelectorAll<HTMLElement>('diff-file')) {
    const body = file.querySelector<HTMLDetailsElement>('details[data-file-body]');
    file.querySelector('[aria-label="Hide file contents"]')?.addEventListener('click', () => { if (body !== null) body.open = false; });
    file.querySelector('[aria-label="Show file contents"]')?.addEventListener('click', () => { if (body !== null) body.open = true; });
  }
}
function markup(mounted = 11): void {
  document.body.innerHTML = `<style>${CSS}</style><header><span id="files">11 files</span></header><article data-rapid-diffs data-app-data='{"file_by_file_mode":false}'>
    <div data-diffs-list>${PATHS.slice(0, Math.min(5, mounted)).map(image).join('')}
      <div data-stream-remaining-diffs style="display:block;color:rgb(1,2,3)"><streaming-element style="display:inline;color:rgb(4,5,6)">${PATHS.slice(5, mounted).map((path, offset) => image(path, offset + 5)).join('')}<server-timings></server-timings></streaming-element></div>
    </div></article><section data-testid="file-tree-container"><nav class="mr-tree-list" aria-label="File tree">${PATHS.map((path, index) => `<a data-testid="file-row" data-file-row="native-image-${index}" href="?file_path=${encodeURIComponent(path)}#native-image-${index}">${path}</a>`).join('')}</nav></section>`;
  nativeControls(document);
}
function start(mounted = 11, settings = SETTINGS) {
  markup(mounted);
  const url = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/162842';
  const page: ProviderReviewPage = { provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'gitlab-org/gitlab' }, number: '162842', kind: 'diff',
    url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, headSha: 'a'.repeat(40), version: '1093051604' };
  const adapter: ProviderAdapter = { id: 'gitlab', describe: (current) => current.pathname.endsWith('/diffs') ? page : null, readDiff: readGitLabDiff,
    headerTargets: () => [{ additions: null, deletions: null, files: node('#files') }], listRows: () => [],
    fetchDiff: async () => ({ complete: true, revision: page.headSha ?? '', files: PATHS.map((path) => ({ path, additions: 0, deletions: 0 })) }) };
  const controller = new ProviderController(adapter, settings, () => undefined);
  running.push(controller);
  controller.start();
  return controller;
}
async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(140); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.location.href = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/162842/diffs';
});
afterEach(() => { for (const controller of running.splice(0)) controller.stop();vi.restoreAllMocks();vi.useRealTimers();document.body.replaceChildren();document.head.querySelector('[data-stream-position-test]')?.remove(); });

it('groups both direct and streamed native images after the full source is mounted without moving nodes or handlers', async () => {
  const controller = start();
  const first = node('#native-image-0'); const nested = node('#native-image-5');
  const outer = node('[data-stream-remaining-diffs]'); const stream = node('streaming-element');
  const outerStyle = outer.getAttribute('style'); const streamStyle = stream.getAttribute('style');
  const firstParent = first.parentElement; const nestedParent = nested.parentElement;
  const control = node('#native-image-5 button[aria-label="Hide file contents"]');
  const clicks = vi.fn(); control.addEventListener('click', clicks);
  await settle();
  expect(controller.getTabState().visible).toEqual({ files: 9, additions: 0, deletions: 0 });
  for (const root of [first, nested]) {
    expect(root.getAttribute('data-geld-provider-hidden')).toBe('closed');
    expect(getComputedStyle(root).display).toBe('none');
    expect(getComputedStyle(root).order).toBe('2');
  }
  expect(getComputedStyle(node('.geld-provider-hidden')).order).toBe('1');
  expect(getComputedStyle(outer).display).toBe('contents');
  expect(getComputedStyle(stream).display).toBe('contents');
  expect(outer.getAttribute('style')).toBe(outerStyle); expect(stream.getAttribute('style')).toBe(streamStyle);
  expect(document.querySelector('.geld-provider-categories')).not.toBeNull();
  controller.toggleHidden();
  for (const root of [first, nested]) { expect(root.getAttribute('data-geld-provider-hidden')).toBe('open');expect(getComputedStyle(root).display).not.toBe('none'); }
  expect(first.parentElement).toBe(firstParent); expect(nested.parentElement).toBe(nestedParent);
  expect(node('#native-image-5 button[aria-label="Hide file contents"]')).toBe(control);
  control.click(); expect(clicks).toHaveBeenCalledOnce();
  expect(nested.querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
});

it('keeps a still-loading stream box intact, then groups when all eleven unique source paths arrive', async () => {
  const controller = start(5);
  const outer = node('[data-stream-remaining-diffs]'); const stream = node('streaming-element');
  await settle();
  expect(readGitLabDiff(document)?.virtualized).toBe(false);
  expect(outer.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(stream.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(getComputedStyle(stream).display).toBe('inline');
  expect(node('[data-diffs-list]').classList.contains('geld-provider-diffs')).toBe(false);
  expect(node('#native-image-0').hasAttribute('data-geld-provider-inline')).toBe(true);
  expect(document.querySelector('.geld-provider-hidden')).toBeNull();
  expect(document.querySelector('.geld-provider-categories')).toBeNull();
  stream.insertAdjacentHTML('afterbegin', PATHS.slice(5).map((path, index) => image(path, index + 5)).join(''));
  nativeControls(stream);
  controller.requestRefresh(); await settle();
  expect(stream.getAttribute('data-geld-provider-flow-wrapper')).toBe('');
  expect(node('#native-image-5').getAttribute('data-geld-provider-hidden')).toBe('closed');
  expect(getComputedStyle(node('#native-image-5')).display).toBe('none');
  expect(document.querySelector('.geld-provider-hidden')).not.toBeNull();
});

it('waits for the final native component mount marker even when all eleven file metadata tags already exist', async () => {
  const controller = start();
  const last = node('#native-image-10');
  const mounted = last.querySelector('diff-file-mounted');
  if (mounted === null) throw new Error('Missing captured native mount marker.');
  mounted.remove();
  await settle();
  expect(readGitLabDiff(document)?.entries).toHaveLength(11);
  expect(readGitLabDiff(document)?.groupingReady).toBe(false);
  expect(document.querySelector('[data-geld-provider-flow-wrapper]')).toBeNull();
  last.append(mounted);
  controller.requestRefresh(); await settle();
  expect(readGitLabDiff(document)?.groupingReady).toBe(true);
  expect(node('streaming-element').getAttribute('data-geld-provider-flow-wrapper')).toBe('');
});

it('preserves fallback-inline reveal ownership across ordinary refresh and native row remount', async () => {
  const controller = start(5);
  await settle();
  controller.revealPath(PATHS[0] ?? '');
  await vi.advanceTimersByTimeAsync(2200);
  expect(node('#native-image-0').querySelector<HTMLDetailsElement>('details')?.open).toBe(true);
  node('#native-image-0 button[aria-label="Hide file contents"]').click();
  controller.requestRefresh(); await settle();
  expect(node('#native-image-0').querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
  const replacement = document.createElement('template');
  replacement.innerHTML = image(PATHS[0] ?? '', 0);
  const next = replacement.content.firstElementChild;
  if (next === null) throw new Error('Missing replacement native row.');
  node('#native-image-0').replaceWith(next);
  nativeControls(node('[data-diffs-list]'));
  node('#native-image-0 button[aria-label="Hide file contents"]').click();
  controller.requestRefresh(); await settle();
  expect(node('#native-image-0').querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
});

it.each(['position', 'transform', 'hidden style', 'hidden attribute', 'file by file', 'unknown wrapper'] as const)('preserves conservative inline behavior for a %s stream', async (kind) => {
  const controller = start();
  const outer = node('[data-stream-remaining-diffs]'); const stream = node('streaming-element');
  if (kind === 'position') document.head.insertAdjacentHTML('beforeend', '<style data-stream-position-test>streaming-element{position:absolute}</style>');
  if (kind === 'transform') stream.style.transform = 'translateY(12px)';
  if (kind === 'hidden style') outer.style.display = 'none';
  if (kind === 'hidden attribute') outer.hidden = true;
  if (kind === 'file by file') node('[data-rapid-diffs]').setAttribute('data-app-data', '{"file_by_file_mode":true}');
  if (kind === 'unknown wrapper') outer.removeAttribute('data-stream-remaining-diffs');
  const originalOuter = outer.getAttribute('style'); const originalStream = stream.getAttribute('style');
  await settle();
  expect(outer.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(stream.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(outer.getAttribute('style')).toBe(originalOuter); expect(stream.getAttribute('style')).toBe(originalStream);
  expect(document.querySelector('.geld-provider-hidden')).toBeNull();
  expect(document.querySelector('.geld-provider-categories') !== null).toBe(readGitLabDiff(document)?.virtualized === true);
  controller.requestRefresh(); await settle();
  expect(stream.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
});

it('retains category navigation in genuine file-by-file mode while reveal preserves inline manual ownership', async () => {
  const controller = start();
  node('[data-rapid-diffs]').setAttribute('data-app-data', '{"file_by_file_mode":true}');
  await settle();
  expect(readGitLabDiff(document)?.virtualized).toBe(true);
  expect(document.querySelector('[data-geld-provider-flow-wrapper]')).toBeNull();
  expect(document.querySelector('.geld-provider-hidden')).toBeNull();
  const categories = [...document.querySelectorAll<HTMLButtonElement>('.geld-provider-category-header')];
  expect(categories.map((button) => button.textContent)).toEqual(['Essential (9 files)', 'Tests (2 tests)']);
  categories[1]?.click();
  const row = document.querySelector<HTMLElement>(`[data-geld-category-path="${PATHS[0]}"] .geld-provider-category-native-row`);
  if (row === null) throw new Error('Missing projected category file control.');
  row.click();
  await vi.advanceTimersByTimeAsync(2200);
  expect(node('#native-image-0').querySelector<HTMLDetailsElement>('details')?.open).toBe(true);
  const replacement = document.createElement('template'); replacement.innerHTML = image(PATHS[0] ?? '', 0);
  const next = replacement.content.firstElementChild;
  if (next === null) throw new Error('Missing replacement native row.');
  node('#native-image-0').replaceWith(next);
  nativeControls(node('[data-diffs-list]'));
  node('#native-image-0 button[aria-label="Hide file contents"]').click();
  controller.requestRefresh(); await settle();
  expect(node('#native-image-0').querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
  expect(document.querySelector('.geld-provider-categories')).not.toBeNull();
});

it('refuses flattening when an equally sized mounted inventory has a duplicate or unknown source path', async () => {
  const controller = start();
  node('#native-image-10').setAttribute('data-file-data', JSON.stringify({ new_path: PATHS[0], viewer: 'image' }));
  await settle();
  expect(document.querySelector('[data-geld-provider-flow-wrapper]')).toBeNull();
  node('#native-image-10').setAttribute('data-file-data', '{"new_path":"doc/unknown.png","viewer":"image"}');
  controller.requestRefresh(); await settle();
  expect(document.querySelector('[data-geld-provider-flow-wrapper]')).toBeNull();
});

it('restores original native wrapper styles on disable, layout remount, navigation and teardown', async () => {
  const controller = start();
  const oldOuter = node('[data-stream-remaining-diffs]'); const oldStream = node('streaming-element');
  const originalOuter = oldOuter.getAttribute('style'); const originalStream = oldStream.getAttribute('style');
  await settle();
  controller.updateSettings({ ...SETTINGS, enabled: false }); await settle();
  expect(oldOuter.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(oldStream.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(oldOuter.getAttribute('style')).toBe(originalOuter); expect(oldStream.getAttribute('style')).toBe(originalStream);
  controller.updateSettings(SETTINGS); await settle();
  markup(); controller.requestRefresh(); await settle();
  expect(oldOuter.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(oldStream.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  const current = node('streaming-element');
  expect(current.hasAttribute('data-geld-provider-flow-wrapper')).toBe(true);
  window.history.replaceState(null, '', '/gitlab-org/gitlab/-/merge_requests/162842');
  controller.requestRefresh(); await settle();
  expect(current.hasAttribute('data-geld-provider-flow-wrapper')).toBe(false);
  expect(current.getAttribute('style')).toBe(originalStream);
  controller.stop();
  expect(current.getAttribute('style')).toBe(originalStream);
});

it('leaves explicit inline mode and a newer layout marker owner untouched', async () => {
  const controller = start(11, { ...SETTINGS, groupHidden: false });
  await settle();
  expect(document.querySelector('[data-geld-provider-flow-wrapper]')).toBeNull();
  expect(node('#native-image-0').hasAttribute('data-geld-provider-inline')).toBe(true);
  expect(document.querySelector('.geld-provider-hidden')).toBeNull();
  controller.updateSettings(SETTINGS); await settle();
  const stream = node('streaming-element');
  stream.setAttribute('data-geld-provider-flow-wrapper', 'new-owner');
  controller.updateSettings({ ...SETTINGS, enabled: false }); await settle();
  expect(stream.getAttribute('data-geld-provider-flow-wrapper')).toBe('new-owner');
  expect(getComputedStyle(stream).display).toBe('inline');
});
