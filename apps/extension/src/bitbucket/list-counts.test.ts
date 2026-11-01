// @vitest-environment happy-dom
import { DEFAULT_SETTINGS } from '@geld/core';
import { ProviderController } from '../providers/controller';
import type { ProviderAdapter } from '../providers/types';
import { bitbucketListRows } from './list-surfaces';
import { describeBitbucketPage } from './page';

vi.mock('wxt/utils/storage', () => ({ storage: {
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }),
  getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
} }));

let controller: ProviderController | null = null;

afterEach(() => {
  controller?.stop();
  controller = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('mounts a keyboard breakdown beside the native title tooltip and cleans up only owned nodes', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED';
  // Native title ancestry from installed Chrome, with unit-only tooltip/event and geometry instrumentation.
  document.body.innerHTML = '<table><tbody><tr data-qa="pull-request-row"><td><div><div role="presentation" aria-describedby="native-title-tooltip"><span style="anchor-name: --anchor-native-title"><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></span></div></div></td></tr></tbody></table>';
  const title = document.querySelector<HTMLAnchorElement>('a');
  const trigger = title?.parentElement?.parentElement;
  if (title === null || trigger === null || trigger === undefined) throw new Error('Missing native title fixture');
  const native = trigger.outerHTML;
  const nativeFocus = vi.fn();
  trigger.addEventListener('focusin', nativeFocus);
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>(async () => ({
    revision: 'a'.repeat(40), complete: true,
    files: [{ path: 'src/app.ts', additions: 41, deletions: 28 }, { path: 'src/app.test.ts', additions: 5, deletions: 1 }],
  }));
  const adapter: ProviderAdapter = {
    id: 'bitbucket', describe: describeBitbucketPage, listRows: bitbucketListRows,
    readDiff: () => null, headerTargets: () => [], eagerListDiffs: () => false, fetchDiff,
  };
  controller = new ProviderController(adapter, DEFAULT_SETTINGS, () => undefined);
  controller.start();
  await vi.advanceTimersByTimeAsync(120);
  const chip = document.querySelector<HTMLElement>('.geld-provider-list-counts');
  if (chip === null) throw new Error('Missing owned count chip');
  expect(chip.parentElement).toBe(trigger.parentElement);
  expect(trigger.contains(chip)).toBe(false);
  expect(chip.tabIndex).toBe(0);
  expect(fetchDiff).not.toHaveBeenCalled();
  vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 360, 120, 20));
  chip.focus();
  await vi.advanceTimersByTimeAsync(350);
  expect(nativeFocus).not.toHaveBeenCalled();
  expect(fetchDiff).toHaveBeenCalledOnce();
  const tooltip = document.querySelector<HTMLElement>('#geld-provider-count-tooltip');
  expect(tooltip?.hidden).toBe(false);
  expect(tooltip?.textContent).toContain('Essential');
  expect(tooltip?.textContent).toContain('Total');
  expect(chip.getAttribute('aria-describedby')).toBe('geld-provider-count-tooltip');
  expect(trigger.outerHTML).toBe(native);
  expect(trigger.querySelector('a')).toBe(title);
  controller.updateSettings({ ...DEFAULT_SETTINGS, showListStats: false });
  await vi.advanceTimersByTimeAsync(120);
  expect(document.querySelector('.geld-provider-list-counts')).toBeNull();
  expect(trigger.outerHTML).toBe(native);
  title.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  expect(nativeFocus).toHaveBeenCalledOnce();
});
