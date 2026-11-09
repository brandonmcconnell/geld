// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderHeaderHints } from './header-hints';
import type { ProviderHeaderTarget } from './types';

const hints = new ProviderHeaderHints();
afterEach(() => { hints.clear(); document.body.replaceChildren(); });
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
