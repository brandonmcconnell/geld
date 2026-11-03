import { describe, expect, it } from 'vitest';
import { BitbucketWhitespaceLease } from './whitespace-lease';
import type { NativeWhitespaceSnapshot } from './whitespace-lease';
function fixture(raw: boolean | 'unset' = false) {
  const value = raw === true;
  let now = 0;
  let state: NativeWhitespaceSnapshot = { owner: {}, settings: { globalShouldIgnoreWhitespace: raw === 'unset' ? undefined : raw }, subject: 'acme/repo!1:a', panel: {}, current: true, loadingCurrent: false, detached: false, value, unset: raw === 'unset', open: false, loading: false, busy: false, failed: false, diffLoading: false, statsLoading: false, diff: [], stats: [] };
  const values: (boolean | undefined)[] = [];
  const lease = new BitbucketWhitespaceLease(() => state, value => { values.push(value);state = { ...state, settings: { ...state.settings, globalShouldIgnoreWhitespace: value }, value: value === true, unset: value === undefined }; }, () => undefined, () => now);
  return { lease, values, raw: () => Reflect.get(state.settings, 'globalShouldIgnoreWhitespace'), patch: (patch: Partial<NativeWhitespaceSnapshot>) => { now += 250;state = { ...state, ...patch };lease.tick(); }, settle: () => { now += 250;state = { ...state, diffLoading: true, statsLoading: true, busy: true };lease.tick();state = { ...state, diffLoading: false, statsLoading: false, diff: [], stats: [], busy: false };lease.tick(); } };
}
describe('Bitbucket native in-memory whitespace lease', () => {
  it.each([false, true, 'unset'] as const)('retains an acknowledged idle mode across native context array replacements: %s', raw => {
    const f = fixture(raw);f.lease.update(true, false);f.patch({});const receipt = f.lease.state();
    expect(receipt.status).toBe('ready');
    f.patch({ diff: [] });f.patch({ diff: [], stats: [] });
    expect(f.lease.state()).toBe(receipt);expect(f.values).toEqual([]);expect(f.raw()).toBe(raw === 'unset' ? undefined : raw);
  });
  it('retains the owned ready mode through context refresh and still restores the exact unset baseline', () => {
    const f = fixture('unset');f.lease.update(true);f.settle();const receipt = f.lease.state();
    f.patch({ diff: [] });expect(f.lease.state()).toBe(receipt);expect(f.values).toEqual([true]);
    f.lease.stop();expect(f.values).toEqual([true, undefined]);
  });
  it.each(['owner', 'panel', 'subject', 'busy', 'open', 'failed', 'unset', 'value'] as const)('does not preserve ready after %s changes during an array refresh', change => {
    const f = fixture();f.lease.update(true, false);f.patch({});const receipt = f.lease.state();
    const patch: Partial<NativeWhitespaceSnapshot> = { diff: [], stats: [], [change]: change === 'owner' || change === 'panel' ? {} : change === 'subject' ? 'other' : true };
    f.patch(patch);expect(f.lease.state()).not.toBe(receipt);expect(f.lease.state().status).not.toBe('ready');
  });
  it('holds only its existing acquisition through source-qualified missing-region loading', () => {
    const f = fixture('unset');f.lease.update(true);f.patch({ current: false, loadingCurrent: true, diffLoading: true, statsLoading: true, busy: true });
    expect(f.values).toEqual([true]);expect(f.lease.state()).toMatchObject({ status: 'pending', value: null });
    f.patch({ current: false, loadingCurrent: true, diffLoading: false, statsLoading: false, busy: false, diff: [], stats: [] });
    expect(f.values).toEqual([true]);expect(f.lease.state()).toMatchObject({ status: 'pending', value: null });
    f.patch({ current: true, loadingCurrent: false });
    expect(f.values).toEqual([true]);expect(f.lease.state()).toMatchObject({ status: 'ready', value: true });
    f.lease.stop();expect(f.values).toEqual([true, undefined]);
  });
  it.each(['disable', 'suspend'])('restores exact undefined on %s during region-free loading without reacquiring', action => {
    const f = fixture('unset');f.lease.update(true);f.patch({ current: false, loadingCurrent: true, diffLoading: true, statsLoading: true, busy: true });
    if (action === 'disable') f.lease.update(false);else f.lease.suspend();
    expect(f.values).toEqual([true, undefined]);
    f.patch({ current: true, loadingCurrent: false, diffLoading: false, statsLoading: false, busy: false, diff: [], stats: [] });f.patch({});
    expect(f.values).toEqual([true, undefined]);expect(f.lease.state().value).not.toBe(true);
  });
  it('restores exact undefined before original Settings opens during the owned loading transition', () => {
    const f = fixture('unset');f.lease.update(true);f.patch({ current: false, loadingCurrent: true, diffLoading: true, statsLoading: true, busy: true });
    expect(f.lease.beforePreferences()).toBe(true);expect(f.values).toEqual([true, undefined]);expect(f.raw()).toBeUndefined();
    f.patch({ current: true, loadingCurrent: false, open: true });f.settle();f.patch({ open: false });
    expect(f.values).toEqual([true, undefined, true]);f.settle();expect(f.lease.state()).toMatchObject({ status: 'ready', value: true });
  });
  it('does not acquire merely because a loading snapshot is qualified', () => {
    const f = fixture();f.patch({ current: false, loadingCurrent: true, diffLoading: true, busy: true });f.lease.update(true);expect(f.values).toEqual([]);
  });
  it.each(['owner', 'subject', 'panel'])('does not retain a pending acquisition after %s custody changes', key => {
    const f = fixture('unset');f.lease.update(true);
    f.patch({ current: false, loadingCurrent: true, diffLoading: true, statsLoading: true, busy: true, [key]: key === 'subject' ? 'other' : {} });
    expect(f.values).toEqual(key === 'owner' ? [true] : [true, undefined]);expect(f.lease.state().status).not.toBe('ready');
  });
  it('restores an owned acquisition when loading ends without a qualified region', () => {
    const f = fixture('unset');f.lease.update(true);f.patch({ current: false, loadingCurrent: true, diffLoading: true, statsLoading: true, busy: true });
    f.patch({ current: false, loadingCurrent: false, diffLoading: false, statsLoading: false, busy: false, diff: [], stats: [] });
    expect(f.values).toEqual([true, undefined]);expect(f.lease.state().status).not.toBe('ready');
  });

  it('restores own undefined before Settings and re-acquires only after Cancel', () => {
    const f = fixture('unset');f.lease.update(true);f.settle();expect(f.values).toEqual([true]);
    expect(f.lease.beforePreferences()).toBe(true);expect(f.values).toEqual([true, undefined]);expect(f.raw()).toBeUndefined();
    f.patch({ open: true });f.patch({ open: false });expect(f.values).toEqual([true, undefined, true]);f.settle();
    f.lease.stop();expect(f.values).toEqual([true, undefined, true, undefined]);expect(f.raw()).toBeUndefined();
  });
  it('observes undefined Off as false without changing the native field when forcing is disabled', () => {
    const f = fixture('unset');f.lease.update(true, false);f.patch({});expect(f.lease.state()).toMatchObject({ status: 'ready', value: false });expect(f.values).toEqual([]);expect(f.raw()).toBeUndefined();
  });
  it('does not restore an undefined baseline over an independent same-value native replacement', () => {
    const f = fixture('unset');f.lease.update(true);f.settle();f.patch({ settings: { globalShouldIgnoreWhitespace: true } });f.lease.stop();expect(f.values).toEqual([true]);
  });
  it('requires exact unset restoration rather than accepting a distinct false field as restored', () => {
    const f = fixture('unset');f.lease.update(true);f.settle();f.lease.update(false);
    f.patch({ value: false, unset: false, settings: { globalShouldIgnoreWhitespace: false } });f.settle();expect(f.lease.state().status).toBe('pending');
    f.patch({ value: false, unset: true, settings: { globalShouldIgnoreWhitespace: undefined } });f.settle();expect(f.lease.state().status).toBe('legacy');
  });

  it('waits for both replacement native sources, then restores only its field after unrelated settings changed', () => {
    const f = fixture();f.lease.update(true);expect(f.values).toEqual([true]);expect(f.lease.state().status).toBe('pending');
    f.patch({ diff: [] });expect(f.lease.state().status).toBe('pending');f.patch({ stats: [] });expect(f.lease.state().status).toBe('pending');f.settle();expect(f.lease.state()).toMatchObject({ status: 'ready', value: true });
    f.patch({ settings: { tabSize: 4 } });f.lease.update(false);expect(f.values).toEqual([true, false]);f.settle();expect(f.lease.state().status).toBe('legacy');
  });
  it('respects an already enabled native preference and observes its mode when Geld hide whitespace is off', () => {
    const f = fixture(true);f.lease.update(true, false);f.settle();f.patch({});expect(f.values).toEqual([]);expect(f.lease.state()).toMatchObject({ status: 'ready', value: true });
    f.patch({ value: false });f.patch({});expect(f.lease.state()).toMatchObject({ status: 'ready', value: false });
  });
  it('restores before the original settings handler, reapplies on Cancel, and respects a successful Save', () => {
    const f = fixture();f.lease.update(true);f.settle();expect(f.lease.beforePreferences()).toBe(true);expect(f.values).toEqual([true, false]);
    f.patch({ open: true });f.patch({ open: false });expect(f.values).toEqual([true, false, true]);f.settle();
    f.lease.beforePreferences();f.patch({ open: true });f.lease.preferenceIntent(false);f.lease.preferenceSubmit();f.patch({ loading: true });f.patch({ loading: false, open: false, value: false });
    f.patch({});expect(f.lease.state()).toMatchObject({ status: 'ready', value: false });expect(f.values).toEqual([true, false, true, false]);
    f.lease.update(false);expect(f.values).toEqual([true, false, true, false]);
  });
  it('does not treat a failed or cancelled Save as a native opt-out', () => {
    const f = fixture();f.lease.update(true);f.settle();f.lease.beforePreferences();f.patch({ open: true });f.lease.preferenceIntent(false);f.lease.preferenceSubmit();f.patch({ open: false });
    expect(f.values.at(-1)).toBe(true);f.settle();expect(f.lease.state().value).toBe(true);
  });
  it('invalidates the receipt on a same-mode head change and restores before acquiring the next subject', () => {
    const f = fixture();f.lease.update(true);f.settle();const epoch = f.lease.state().epoch;
    f.patch({ subject: 'acme/repo!1:b' });expect(f.values).toEqual([true, false]);expect(f.lease.state()).toMatchObject({ status: 'pending' });expect(f.lease.state().epoch).toBeGreaterThan(epoch);
    f.settle();expect(f.values).toEqual([true, false, true]);f.settle();expect(f.lease.state().status).toBe('ready');
  });
  it('restores on native source failure before error preference controls can open', () => {
    const f = fixture();f.lease.update(true);f.settle();f.patch({ failed: true, busy: true });expect(f.values).toEqual([true, false]);expect(f.lease.state().status).toBe('pending');
  });
  it('relinquishes an independent same-value native action without undoing it on disable', () => {
    const f = fixture();f.lease.update(true);f.settle();f.patch({ settings: { globalShouldIgnoreWhitespace: true } });f.lease.update(false);expect(f.values).toEqual([true]);
  });
  it('does not wait for nonexistent off-page restoration requests on returning to a new review', () => {
    const f = fixture();f.lease.update(true);f.settle();f.patch({ current: false, detached: true });f.patch({});f.patch({ current: true, detached: false, subject: 'acme/repo!2:b' });
    expect(f.values).toEqual([true, false, true]);f.settle();expect(f.lease.state().status).toBe('ready');
  });
  it('keeps repeated visible-alert mutations stable after native restoration settles', () => {
    const f = fixture();f.lease.update(true);f.settle();f.lease.suspend();f.patch({ current: false });f.settle();const epoch = f.lease.state().epoch;
    for (let i = 0; i < 3; i++) { f.lease.suspend();f.patch({}); }
    expect(f.lease.state()).toMatchObject({ status: 'legacy', epoch });expect(f.values).toEqual([true, false]);
  });
  it('never overwrites a native value change and does not reacquire that visit', () => {
    const f = fixture();f.lease.update(true);f.settle();f.patch({ value: false });f.settle();f.lease.update(false);expect(f.values).toEqual([true]);
  });
  it('restores on losing the current All changes context and remains pending until both native sources settle', () => {
    const f = fixture();f.lease.update(true);f.settle();f.patch({ current: false });expect(f.values).toEqual([true, false]);expect(f.lease.state().status).toBe('pending');f.settle();expect(f.lease.state().status).toBe('legacy');
  });
});
