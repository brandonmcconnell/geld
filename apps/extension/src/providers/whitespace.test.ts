import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import { mergeWhitespaceOptOuts, ProviderWhitespace } from './whitespace';

const settings = { ...DEFAULT_SETTINGS, hideWhitespace: true };
const path = 'https://gitlab.com/group/subgroup/repo/-/merge_requests/42/diffs';

describe('provider whitespace preference', () => {
  it('preserves selected version, mode and native anchors while applying the native GitLab parameter', () => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const result = planner.navigation(new URL(`${path}?diff_id=812&view=parallel#note_12`));
    expect(result).toBe(`${path}?diff_id=812&view=parallel&w=1#note_12`);
    expect(planner.navigation(new URL(`${path}?w=1`))).toBeNull();
  });

  it('remembers an explicit native opt-out across visits without contaminating other providers', () => {
    const save = vi.fn();
    const planner = new ProviderWhitespace(settings, {}, save);
    expect(planner.navigation(new URL(`${path}?w=0`))).toBeNull();
    const restored = new ProviderWhitespace(settings, save.mock.calls[0]?.[0] ?? {}, () => undefined);
    expect(restored.navigation(new URL(path))).toBeNull();
    expect(restored.navigation(new URL(path.replace('/42/', '/43/')))).toBe(`${path.replace('/42/', '/43/')}?w=1`);
    const bitbucket = new URL('https://bitbucket.org/group/repo/pull-requests/42/diff');
    expect(restored.navigation(bitbucket)).toBeNull();
  });

  it('honors provider-qualified exclusions, explicit URLs and non-diff pages', () => {
    const planner = new ProviderWhitespace({ ...settings, repoRules: ['gitlab.com/group/**'] }, {}, () => undefined);
    expect(planner.navigation(new URL(path))).toBeNull();
    const enabled = new ProviderWhitespace(settings, {}, () => undefined);
    expect(enabled.navigation(new URL(path.replace('/diffs', '')))).toBeNull();
    expect(enabled.navigation(new URL(`${path}?w=0`))).toBeNull();
    enabled.update({ ...settings, enabled: false });
    expect(enabled.link(new URL(path))).toBe(path);
  });

  it('handles immutable commit and compare UI links without rewriting raw-diff downloads', () => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const base = `https://gitlab.com/group/repo/-/commit/${'a'.repeat(40)}`;
    expect(planner.link(new URL(base))).toBe(`${base}?w=1`);
    expect(planner.link(new URL(`${base}.diff`))).toBe(`${base}.diff`);
    const compare = `https://gitlab.com/group/repo/-/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`;
    expect(planner.link(new URL(`${compare}?format=diff`))).toBe(`${compare}?format=diff`);
    expect(planner.link(new URL(base.slice(0, -33)))).toBe(`${base.slice(0, -33)}?w=1`);
  });

  it('clears a remembered opt-out only after an explicit native opt-in', () => {
    const save = vi.fn();
    const planner = new ProviderWhitespace(settings, {}, save);
    planner.navigation(new URL(`${path}?w=0`));
    expect(planner.link(new URL(path))).toBe(path);
    expect(planner.navigation(new URL(`${path}?w=1`))).toBeNull();
    expect(save.mock.calls).toHaveLength(2);
    expect(save.mock.calls[1]?.[0]).toEqual({});
    expect(planner.link(new URL(path))).toBe(`${path}?w=1`);
  });

  it('stops a redirect loop when the provider removes its whitespace parameter', () => {
    const data = new Map<string, string>();
    const memory = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const initial = new ProviderWhitespace(settings, {}, () => undefined, { memory, now: () => 10_000, navigationStart: () => 9000 });
    expect(initial.navigation(new URL(path))).toBe(`${path}?w=1`);
    expect(initial.navigation(new URL(path))).toBeNull();
    const stripped = new ProviderWhitespace(settings, {}, () => undefined, { memory, now: () => 10_500, navigationStart: () => 10_100 });
    expect(stripped.navigation(new URL(path))).toBeNull();
    const cooldown = new ProviderWhitespace(settings, {}, () => undefined, { memory, now: () => 40_000, navigationStart: () => 39_000 });
    expect(cooldown.navigation(new URL(path))).toBeNull();
    const retry = new ProviderWhitespace(settings, {}, () => undefined, { memory, now: () => 71_000, navigationStart: () => 70_000 });
    expect(retry.navigation(new URL(path))).toBe(`${path}?w=1`);
  });

  it('merges opt-in deletions without losing another tab’s opt-outs', () => {
    expect(mergeWhitespaceOptOuts({ a: 1, b: 2 }, { b: 2 }, { a: 1, b: 3, c: 4 })).toEqual({ b: 3, c: 4 });
    expect(mergeWhitespaceOptOuts({}, { a: 1 }, { c: 4 })).toEqual({ a: 1, c: 4 });
  });
});
