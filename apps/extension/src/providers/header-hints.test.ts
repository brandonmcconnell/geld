// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderHeaderHints } from './header-hints';
import type { ProviderHeaderTarget } from './types';

const hints = new ProviderHeaderHints();
afterEach(() => { hints.clear(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function node(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector);
  if (result === null) throw new Error(`Missing native fixture ${selector}`);
  return result;
}
function target(host = node('header')): ProviderHeaderTarget {
  return { files: node('#files'), additions: node('#add'), deletions: null, hintHost: host, hintBefore: node('#native') };
}
function fixture(): void {
  document.body.innerHTML = '<header><div id="native" aria-label="Added 4 lines."><span id="files">2 files</span><span id="add">+4</span><button>Native action</button></div></header>';
}

it('adds one category label outside native count ARIA without moving native nodes or handlers', () => {
  fixture();
  const native = node('#native'); const markup = native.outerHTML;
  const click = vi.fn(); node('button').addEventListener('click', click);
  const current = target();
  hints.update([current, current], '0 tests');
  const label = hints.forTarget(current);
  expect(label?.textContent).toBe('0 tests');
  expect(label?.getAttribute('aria-label')).toBe('0 tests hidden');
  expect(label?.tabIndex).toBe(0);
  expect(label?.nextSibling).toBe(native);
  expect(native.outerHTML).toBe(markup);
  hints.update([current], '1 test');
  expect(hints.forTarget(current)).toBe(label);
  expect(label?.textContent).toBe('1 test');
  node('button').click(); expect(click).toHaveBeenCalledOnce();
  hints.clear(); expect(node('header').innerHTML).toBe(markup);
});

it('lets the native keyboard group own focus when it already contains the label', () => {
  fixture(); const current = { ...target(), keyboardHoverHosts: [node('header')] };
  hints.update([current], '2 hidden');
  expect(hints.forTarget(current)?.tabIndex).toBe(-1);
  expect(hints.forTarget(current)?.getAttribute('aria-label')).toBe('2 hidden');
  expect(node('header').hasAttribute('tabindex')).toBe(false);
});

it('repairs only owned labels after native removal and clears old or disabled surfaces', () => {
  fixture(); const current = target(); hints.update([current], '1 test');
  const old = hints.forTarget(current); old?.remove();
  expect(hints.needsRepair()).toBe(true);
  hints.update([current], '1 test');
  expect(hints.needsRepair()).toBe(false);
  expect(hints.forTarget(current)).not.toBe(old);
  expect(node('#native').parentElement).toBe(node('header'));
  hints.update([current], null);
  expect(document.querySelector('.geld-provider-header-hidden-count')).toBeNull();
  expect(hints.forTarget(current)).toBeNull();
});

it.each(['aria-hidden="true"', 'hidden', 'inert', 'data-geld-ui'])('does not create a count hint inside a native excluded %s surface', (attribute) => {
  fixture(); node('header').outerHTML = `<section ${attribute}>${node('header').outerHTML}</section>`;
  const current = target(); hints.update([current], '1 test');
  expect(hints.forTarget(current)).toBeNull();
  expect(document.querySelector('.geld-provider-header-hidden-count')).toBeNull();
});

const totals = { files: 2, additions: 7, deletions: 3 };
function lineFixture(): ProviderHeaderTarget {
  fixture();
  node('#native').insertAdjacentHTML('beforeend', '<span id="del">−3</span>');
  for (const selector of ['#add', '#del']) vi.spyOn(node(selector), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 24, 16));
  return { ...target(), deletions: node('#del') };
}

it('supplements absent line counts with exact visible totals and preserves native nodes and actions', () => {
  fixture();
  const current = { ...target(), additions: null };
  const native = node('#native');
  const markup = native.outerHTML;
  const action = vi.fn(); node('button').addEventListener('click', action);
  hints.update([current], '1 test', totals);
  const anchor = hints.forTarget(current);
  expect(anchor?.className).toBe('geld-provider-header-stats');
  expect(node('.geld-provider-header-hidden-count').textContent).toBe('1 test');
  expect(node('.geld-provider-header-line-counts__add').textContent).toBe('+7');
  expect(node('.geld-provider-header-line-counts__del').textContent).toBe('−3');
  expect(node('.geld-provider-header-line-counts').getAttribute('aria-label')).toBe('Added 7 lines. Removed 3 lines.');
  expect(anchor?.hidden).toBe(false);
  expect(anchor?.tabIndex).toBe(0);
  hints.update([current], '1 test', { ...totals, additions: 9 });
  expect(hints.forTarget(current)).toBe(anchor);
  expect(node('.geld-provider-header-line-counts__add').textContent).toBe('+9');
  expect(native.outerHTML).toBe(markup);
  node('button').click(); expect(action).toHaveBeenCalledOnce();
  hints.clear(); expect(node('header').innerHTML).toBe(markup);
});

it('does not duplicate native visible line counts, including Bitbucket aria-hidden presentation', () => {
  const current = lineFixture();
  node('#native').setAttribute('aria-hidden', 'true');
  hints.update([current], '1 test', totals);
  expect(document.querySelector('.geld-provider-header-line-counts')).toBeNull();
  expect(hints.forTarget(current)?.textContent).toBe('1 test');
  expect(hints.needsRepair()).toBe(false);
});

it.each(['display: none', 'visibility: hidden', 'opacity: 0'])('supplements native counts hidden by %s and keeps the same hover anchor after resize', (style) => {
  const current = lineFixture();
  hints.update([current], '1 test', totals);
  const anchor = hints.forTarget(current);
  node('#native').setAttribute('style', style);
  expect(hints.needsRepair()).toBe(true);
  window.dispatchEvent(new Event('resize'));
  expect(node('.geld-provider-header-line-counts__add').textContent).toBe('+7');
  expect(node('.geld-provider-header-line-counts__del').textContent).toBe('−3');
  expect(hints.forTarget(current)).toBe(anchor);
  expect(hints.needsRepair()).toBe(false);
  node('#native').removeAttribute('style');
  window.dispatchEvent(new Event('resize'));
  expect(document.querySelector('.geld-provider-header-line-counts')).toBeNull();
  expect(hints.forTarget(current)).toBe(anchor);
});

it('supplements only the missing sign and follows replaced native count nodes', () => {
  const current = lineFixture();
  node('#add').hidden = true;
  hints.update([current], '1 test', totals);
  expect(node('.geld-provider-header-line-counts__add').textContent).toBe('+7');
  expect(document.querySelector('.geld-provider-header-line-counts__del')).toBeNull();
  node('#add').outerHTML = '<span id="add">+7</span>';
  vi.spyOn(node('#add'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 24, 16));
  const replacement = { ...current, additions: node('#add') };
  hints.update([replacement], '1 test', totals);
  expect(document.querySelector('.geld-provider-header-line-counts')).toBeNull();
  expect(hints.needsRepair()).toBe(false);
});

it('shows totals with no hidden category label and retains its anchor as native counts become visible', () => {
  const current = lineFixture();
  node('#native').hidden = true;
  hints.update([current], null, totals);
  const anchor = hints.forTarget(current);
  expect(anchor?.textContent).toBe('+7−3');
  expect(anchor?.hidden).toBe(false);
  expect(document.querySelector('.geld-provider-header-hidden-count')).toBeNull();
  node('#native').hidden = false;
  window.dispatchEvent(new Event('resize'));
  expect(hints.forTarget(current)).toBe(anchor);
  expect(anchor?.hidden).toBe(true);
  node('#native').hidden = true;
  window.dispatchEvent(new Event('resize'));
  expect(hints.forTarget(current)).toBe(anchor);
  expect(anchor?.hidden).toBe(false);
  hints.clear(); window.dispatchEvent(new Event('resize'));
  expect(document.querySelector('.geld-provider-header-stats')).toBeNull();
});

it('does not count a clipped screen-reader-only number as a visible native total', () => {
  const current = lineFixture();
  vi.mocked(node('#add').getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 1, 1));
  node('#del').style.clipPath = 'inset(50%)';
  hints.update([current], '1 test', totals);
  expect(node('.geld-provider-header-line-counts__add').textContent).toBe('+7');
  expect(node('.geld-provider-header-line-counts__del').textContent).toBe('−3');
});
