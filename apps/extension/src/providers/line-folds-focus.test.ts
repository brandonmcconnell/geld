// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { ProviderDiffLine, ProviderDiffView } from './types';
import type { ProviderWholeTestSession } from './whole-test-context';
import { applyProviderLineFolds, clearProviderLineFolds } from './line-folds';

function fixture() {
  window.location.href = 'https://gitlab.com/gitlab-org/gitlab/-/commit/13215ca460cd4f75d3765a882ef486aa2dacf549';
  const path = 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb';
  const source = Array<string>(101).fill('');source[95] = "      it 'generates an error' do";source[96] = '        prepare();';source[97] = '        assert_value();';source[98] = '        assert_original();';source[99] = '      end';
  const root = document.createElement('section'), table = document.createElement('table'), body = document.createElement('tbody'), viewed = document.createElement('input');viewed.type = 'checkbox';root.setAttribute('data-native-source', 'immutable13215');body.className = 'rd-text-view-content';body.style.setProperty('--virtual-total-rows', '17');root.append(viewed, table);table.append(body);document.body.append(root);
  const lines: ProviderDiffLine[] = [];
  const add = (number: number, before: Node | null = null): HTMLElement => {
    const row = document.createElement('tr'), cell = document.createElement('td');row.id = `original-R${number}`;cell.textContent = source[number - 1]!;row.append(cell);body.insertBefore(row, before);
    lines.push({ root: row, oldLine: number, newLine: number, oldText: source[number - 1]!, newText: source[number - 1]!, kind: 'context' });lines.sort((a, b) => a.newLine! - b.newLine!);return row;
  };
  const original = add(100);add(101);
  const entry = { root, path, anchor: null, additions: 0, deletions: 0, readLines: () => lines, expand: () => true, collapse: () => true };
  const view: ProviderDiffView = { kind: 'gitlab-rapid', container: root, entries: [entry], tree: [], treeHost: null, filteredPaths: new Set(), virtualized: false };
  let ready = true;
  const whole: ProviderWholeTestSession = { mount: vi.fn(), source: () => ready ? { lines: source, bytes: source.join('\n').length, token: 1 } : null, reveal: vi.fn(), cancelReveal: vi.fn(), retain: vi.fn() };
  const apply = () => applyProviderLineFolds(view, [{ path, additions: 0, deletions: 0 }], DEFAULT_SETTINGS, undefined, whole);
  const button = (): HTMLButtonElement => { const value = root.querySelector<HTMLButtonElement>('[data-geld-provider-fold-row="test:new:R96"] button');if (value === null) throw Error('Missing owned whole test96');return value; };
  const prefix = (): HTMLElement => { const note = button().closest('tr');if (note === null) throw Error('Missing owned row');let first: HTMLElement | undefined;for (const number of [96, 97, 98, 99]) { const row = add(number, note);first ??= row; }if (first === undefined) throw Error('Missing new original96');return first; };
  apply();const control = button();control.focus();
  // Synthetic unit protocol only; the separate private production-helper replay uses actual browser Enter.
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });Object.defineProperty(click, 'isTrusted', { value: true });control.dispatchEvent(click);
  const text = original.firstChild?.firstChild, html = original.outerHTML, sourceKey = root.getAttribute('data-native-source');
  const unchanged = () => { expect(document.getElementById('original-R100')).toBe(original);expect(original.parentElement).toBe(body);expect(original.firstChild?.firstChild).toBe(text);expect(original.outerHTML).toBe(html);expect(root.getAttribute('data-native-source')).toBe(sourceKey);expect(viewed.checked).toBe(false); };
  return { root, body, control, whole, apply, button, prefix, unchanged, revoke: () => { ready = false; } };
}

afterEach(() => { clearProviderLineFolds();document.body.replaceChildren();window.location.hash = '';vi.restoreAllMocks(); });

it('uses a supported state-preserving same-parent move for the same owned control after original R96 appears before it', () => {
  // Happy DOM lacks native moveBefore; model its state-preserving contract, separately verified in real Chromium.
  const f = fixture();const move = vi.fn((node: Node, before: Node | null) => { const focused = document.activeElement === f.control;f.body.insertBefore(node, before);if (focused) f.control.focus({ preventScroll: true }); });Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: move });
  const line = f.prefix();expect(f.control.isConnected).toBe(true);expect(line.previousElementSibling).not.toBe(f.control.closest('tr'));
  expect(f.apply()).toEqual({ hiddenAdditions: 0, hiddenDeletions: 0 });expect(move).toHaveBeenCalledExactlyOnceWith(f.control.closest('tr'), line);expect(f.button()).toBe(f.control);expect(document.activeElement).toBe(f.control);expect(line.previousElementSibling).toBe(f.control.closest('tr'));f.unchanged();
});
for (const mode of ['unsupported', 'throws']) it(`preserves only immediately held control focus when ${mode} moveBefore requires the ordinary connected-move fallback`, () => {
  const f = fixture();Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: mode === 'unsupported' ? undefined : () => { throw Error('State preserving move unavailable'); } });const line = f.prefix(), before = line.before.bind(line);
  // Happy DOM does not reproduce Chrome's connected-move blur; replay that proven browser effect at the actual operation.
  vi.spyOn(line, 'before').mockImplementation((...nodes) => { before(...nodes);f.control.blur(); });const focus = vi.spyOn(f.control, 'focus');f.apply();expect(f.button()).toBe(f.control);expect(document.activeElement).toBe(f.control);expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });f.unchanged();
});
it('does not move or refocus an already correctly seated owned control on harmless refresh', () => {
  const f = fixture();const move = vi.fn();Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: move });const focus = vi.spyOn(f.control, 'focus');f.apply();expect(move).not.toHaveBeenCalled();expect(focus).not.toHaveBeenCalled();expect(document.activeElement).toBe(f.control);f.unchanged();
});
it('never manufactures fallback focus after a supported move completed without using ordinary before insertion', () => {
  const f = fixture();Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: (node: Node, before: Node | null) => { f.body.insertBefore(node, before);f.control.blur(); } });f.prefix();const focus = vi.spyOn(f.control, 'focus');f.apply();expect(document.activeElement).toBe(document.body);expect(focus).not.toHaveBeenCalled();f.unchanged();
});
it('does not steal reader focus that moved outside before the owned row relocation', () => {
  const f = fixture();const outside = document.createElement('button');document.body.append(outside);outside.focus();Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: undefined });f.prefix();const focus = vi.spyOn(f.control, 'focus');f.apply();expect(document.activeElement).toBe(outside);expect(focus).not.toHaveBeenCalled();f.unchanged();
});
it('does not revive a previously focused connected control when BODY already held focus before this move', () => {
  const f = fixture();f.control.blur();Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: undefined });f.prefix();const focus = vi.spyOn(f.control, 'focus');f.apply();expect(document.activeElement).toBe(document.body);expect(focus).not.toHaveBeenCalled();f.unchanged();
});
it('does not override another reader control focused synchronously by a blur/move listener', () => {
  const f = fixture();const outside = document.createElement('button');document.body.append(outside);Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: undefined });const line = f.prefix(), before = line.before.bind(line);vi.spyOn(line, 'before').mockImplementation((...nodes) => { before(...nodes);outside.focus(); });const focus = vi.spyOn(f.control, 'focus');f.apply();expect(document.activeElement).toBe(outside);expect(focus).not.toHaveBeenCalled();f.unchanged();
});
it('does not restore focus into stale connected markup after a move/blur listener changes the current route', () => {
  const f = fixture();Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: undefined });const line = f.prefix(), before = line.before.bind(line);vi.spyOn(line, 'before').mockImplementation((...nodes) => { before(...nodes);f.control.blur();window.history.replaceState({}, '', '/gitlab-org/gitlab/-/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); });const focus = vi.spyOn(f.control, 'focus');f.apply();expect(f.control.isConnected).toBe(true);expect(document.activeElement).toBe(document.body);expect(focus).not.toHaveBeenCalled();f.unchanged();
});
it('does not refocus a control whose ownership was destroyed during the fallback operation', () => {
  const f = fixture();Object.defineProperty(f.body, 'moveBefore', { configurable: true, value: undefined });const line = f.prefix(), before = line.before.bind(line);vi.spyOn(line, 'before').mockImplementation((...nodes) => { before(...nodes);clearProviderLineFolds();f.control.blur(); });const focus = vi.spyOn(f.control, 'focus');f.apply();expect(f.control.isConnected).toBe(false);expect(document.activeElement).toBe(document.body);expect(focus).not.toHaveBeenCalled();f.unchanged();
});
it('releases the owned focused control when the whole source is revoked rather than retaining stale focus intent', () => {
  const f = fixture();const focus = vi.spyOn(f.control, 'focus');f.revoke();f.apply();expect(f.root.querySelector('[data-geld-provider-fold-row]')).toBeNull();expect(f.control.isConnected).toBe(false);expect(focus).not.toHaveBeenCalled();expect(f.whole.reveal).toHaveBeenCalledOnce();f.control.click();expect(f.whole.reveal).toHaveBeenCalledOnce();f.unchanged();
});
