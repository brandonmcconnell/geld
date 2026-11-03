// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://bitbucket.org/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import { createBitbucketWhitespaceMode } from './whitespace-mode';
import { WHITESPACE_READY, WHITESPACE_REQUEST, WHITESPACE_RESPONSE } from './whitespace-main';
import { describeBitbucketProviderPage } from './page';
import { providerDiffKey } from '../providers/diff-cache';
let cleanup = (): void => undefined;
afterEach(() => { cleanup();vi.useRealTimers(); });
function fixture() {
  window.history.replaceState(null, '', 'https://bitbucket.org/acme/repo/pull-requests/42/diff');
  let id = '';
  const listener = (event: Event): void => { if (event instanceof CustomEvent) { const data: unknown = JSON.parse(String(event.detail));if (data && typeof data === 'object' && 'id' in data && typeof data.id === 'string') id = data.id; } };
  document.addEventListener(WHITESPACE_REQUEST, listener);
  const mode = createBitbucketWhitespaceMode(document, () => undefined);mode.update({ ...DEFAULT_SETTINGS, hideWhitespace: true });
  const page = describeBitbucketProviderPage(new URL(document.URL))!;
  cleanup = () => { mode.stop();document.removeEventListener(WHITESPACE_REQUEST, listener); };
  return { mode, page, receipt(status: string, value: boolean | null, epoch: number, head = 'a'.repeat(40), base = 'b'.repeat(40)) { document.dispatchEvent(new CustomEvent(WHITESPACE_RESPONSE, { detail: JSON.stringify({ id, route: document.URL, comparison: JSON.stringify(['acme/repo', '42', 'acme/repo', head, base]), status, value, epoch }) })); } };
}
describe('Bitbucket acknowledged source mode', () => {
  it('bounds a missing bridge startup and retains raw behavior when unsupported', () => {
    vi.useFakeTimers();const f = fixture();expect(f.mode.decorate(f.page)?.diffMode?.current()).toBe(false);
    vi.advanceTimersByTime(5_100);expect(f.mode.decorate(f.page)).toBe(f.page);
  });
  it('preserves the exact original raw page when both Geld and native whitespace hiding are off', () => {
    const f = fixture();f.mode.update({ ...DEFAULT_SETTINGS, hideWhitespace: false });f.receipt('ready', false, 1);expect(f.mode.decorate(f.page)).toBe(f.page);
  });
  it('invalidates an old ready receipt when the MAIN bridge is replaced', () => {
    const f = fixture();f.receipt('ready', true, 1);const old = f.mode.decorate(f.page)!;expect(old.diffMode?.current()).toBe(true);
    document.dispatchEvent(new Event(WHITESPACE_READY));expect(old.diffMode?.current()).toBe(false);expect(f.mode.decorate(f.page)?.diffMode?.current()).toBe(false);
    f.receipt('ready', true, 1);expect(f.mode.decorate(f.page)?.diffMode?.current()).toBe(true);
  });
  it('keeps abbreviated refs mutable and separates a same-head native target update', () => {
    const f = fixture();f.receipt('ready', true, 1, 'a'.repeat(12), 'b'.repeat(12));const first = f.mode.decorate(f.page)!;
    expect(first.headSha).toBeNull();f.receipt('ready', true, 2, 'a'.repeat(12), 'c'.repeat(12));const next = f.mode.decorate(f.page)!;
    expect(first.diffMode?.current()).toBe(false);expect(providerDiffKey(first)).not.toBe(providerDiffKey(next));
  });

  it('keeps unsupported native contracts on the existing source behavior', () => {
    const f = fixture();expect(f.mode.decorate(f.page)?.diffMode?.current()).toBe(false);f.receipt('legacy', null, 0);expect(f.mode.decorate(f.page)).toBe(f.page);
  });
  it('distinguishes legacy, pending, raw and whitespace keys and invalidates retained guards on a generation change', () => {
    const f = fixture();f.receipt('ready', true, 1);const hidden = f.mode.decorate(f.page)!;expect(hidden.diffMode?.current()).toBe(true);expect(hidden.headSha).toBe('a'.repeat(40));
    f.receipt('pending', null, 2);expect(hidden.diffMode?.current()).toBe(false);const pending = f.mode.decorate(f.page)!;expect(pending.diffMode?.current()).toBe(false);
    f.receipt('ready', false, 3);const raw = f.mode.decorate(f.page)!;expect(raw.diffMode?.current()).toBe(true);expect(new Set([f.page, hidden, pending, raw].map(providerDiffKey)).size).toBe(4);
    window.history.replaceState(null, '', '/acme/repo/pull-requests/43/diff');expect(raw.diffMode?.current()).toBe(false);
  });
  it('leaves list/other-review requests legacy and observes native preferences with hideWhitespace off', () => {
    const f = fixture();f.mode.update({ ...DEFAULT_SETTINGS, hideWhitespace: false });f.receipt('ready', true, 1);expect(f.mode.decorate(f.page)?.diffMode?.ignoreWhitespace).toBe(true);
    const other = describeBitbucketProviderPage(new URL('https://bitbucket.org/acme/repo/pull-requests/44'))!;expect(f.mode.decorate(other)).toBe(other);
  });
});
