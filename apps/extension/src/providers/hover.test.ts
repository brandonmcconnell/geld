// @vitest-environment happy-dom
import type { GeldSettings } from '@geld/core';
import { BUNDLED_CATALOG, createMatcher, DEFAULT_SETTINGS } from '@geld/core';
import { breakdownFromFiles, statsBreakdown } from '../github/breakdown';
import type { ProviderDiffState } from './diff-source';
import { ProviderHover, providerHoverPlacement } from './hover';
import type { ProviderAdapter, ProviderCommitPage, ProviderPage } from './types';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const ROOT = 'https://gitlab.com/group/repo';
const URL = `${ROOT}/-/merge_requests/7`;
const instances: ProviderHover[] = [];
let settings: GeldSettings;
let currentHead: string;

function commit(sha = SHA): ProviderCommitPage {
  return {
    provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/repo' },
    kind: 'commit', ref: sha, headSha: sha, version: sha, url: `${ROOT}/-/commit/${sha}`, diffPageUrl: `${ROOT}/-/commit/${sha}`, diffUrl: `${ROOT}/-/commit/${sha}.diff`,
  };
}

function ready(extra: { readonly provisional?: true; readonly refreshing?: true; readonly refreshError?: string } = {}): ProviderDiffState {
  return {
    status: 'ready',
    result: { complete: true, revision: SHA, files: [{ path: 'src/fix.ts', additions: 4, deletions: 1 }, { path: 'src/fix.test.ts', additions: 3, deletions: 0 }] },
    ...extra,
  };
}

function adapter(): ProviderAdapter {
  return {
    id: 'gitlab',
    describe: (url) => {
      const match = /\/-\/commit\/([a-f0-9]{40})$/.exec(url.pathname);
      if (match?.[1] !== undefined) return { ...commit(match[1]), repository: { ...commit().repository, origin: url.origin } };
      const review = /^\/group\/repo\/-\/merge_requests\/(7|8)(\/diffs)?$/.exec(url.pathname);
      const base = `${ROOT}/-/merge_requests/${review?.[1] ?? '7'}`;
      return review === null ? null : { ...commit(currentHead), kind: review[2] === undefined ? 'overview' : 'diff', number: review[1] ?? '7', url: base, diffPageUrl: `${base}/diffs`, diffUrl: `${base}.diff` };
    },
    readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => ({ files: [], complete: true, revision: SHA }),
  };
}

function geometry(host: HTMLElement, rect = new DOMRect(80, 60, 100, 20)): void {
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect);
}

function link(sha = SHA, title = 'Native commit title'): HTMLAnchorElement {
  const host = document.createElement('a');
  host.href = commit(sha).url;
  host.textContent = sha.slice(0, 8);
  host.title = title;
  document.body.append(host);
  geometry(host);
  return host;
}

function hover(host: HTMLElement): void { host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientY: 65 })); }
function leave(host: HTMLElement): void { host.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); }
function tooltip(): HTMLElement | null { return document.getElementById('geld-provider-count-tooltip'); }

function create(get: (page: ProviderPage, priority?: boolean) => ProviderDiffState, options: ConstructorParameters<typeof ProviderHover>[4] = {}): ProviderHover {
  const instance = new ProviderHover(adapter(), { get }, () => settings, () => BUNDLED_CATALOG, options);
  instances.push(instance);
  instance.start();
  return instance;
}

beforeEach(() => {
  vi.useFakeTimers();
  settings = DEFAULT_SETTINGS;
  currentHead = SHA;
  window.location.href = URL;
  document.body.innerHTML = '';
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});

afterEach(() => {
  for (const instance of instances.splice(0)) instance.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('provider commit hover intent', () => {
  it('does not fetch delegated link counts when list statistics are off and closes them when disabled', async () => {
    settings = { ...DEFAULT_SETTINGS, showListStats: false };
    const get = vi.fn(() => ready());
    const instance = create(get);
    const host = link();
    hover(host);
    await vi.advanceTimersByTimeAsync(200);
    expect(get).not.toHaveBeenCalled();
    expect(host.title).toBe('Native commit title');
    settings = DEFAULT_SETTINGS;
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(get).toHaveBeenCalledOnce();
    settings = { ...DEFAULT_SETTINGS, showListStats: false };
    instance.refresh();
    expect(tooltip()?.hidden).toBe(true);
    expect(host.hasAttribute('aria-describedby')).toBe(false);
    expect(host.title).toBe('Native commit title');
    expect(get).toHaveBeenCalledOnce();
  });

  it('does not fetch until a sustained intent, then requests page priority and replaces loading with complete counts', async () => {
    let state: ProviderDiffState = { status: 'loading' };
    const get = vi.fn(() => state);
    const instance = create(get);
    const host = link();
    expect(get).not.toHaveBeenCalled();
    hover(host);
    expect(host.hasAttribute('title')).toBe(false);
    await vi.advanceTimersByTimeAsync(149);
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ kind: 'commit', headSha: SHA }), true);
    expect(tooltip()?.textContent).toBe('Counting changes…');
    state = ready();
    instance.refresh();
    expect(tooltip()?.textContent).toContain('Essential 1 file +4 −1');
    expect(tooltip()?.textContent).toContain('Total 2 files +7 −1');
    expect(tooltip()?.textContent).toContain('Tests 1 file +3 −0');
    expect(host.getAttribute('aria-describedby')).toBe('geld-provider-count-tooltip');
  });

  it('cancels a short hover and cannot reopen from a stale async result after leaving', async () => {
    const get = vi.fn(() => ready());
    const instance = create(get);
    const host = link();
    hover(host);
    leave(host);
    await vi.advanceTimersByTimeAsync(200);
    expect(get).not.toHaveBeenCalled();
    expect(host.title).toBe('Native commit title');
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(get).toHaveBeenCalledOnce();
    leave(host);
    instance.refresh();
    expect(get).toHaveBeenCalledOnce();
    expect(tooltip()?.hidden).toBe(true);
    expect(host.hasAttribute('aria-describedby')).toBe(false);
  });

  it('switches intent to the current commit and never renders a previous commit response', async () => {
    let first: ProviderDiffState = { status: 'loading' };
    const get = vi.fn((page: ProviderPage) => page.headSha === SHA ? first : ready({ provisional: true }));
    const instance = create(get);
    const a = link();
    const b = link(OTHER_SHA);
    hover(a);
    await vi.advanceTimersByTimeAsync(150);
    hover(b);
    await vi.advanceTimersByTimeAsync(150);
    first = { status: 'failed', reason: 'Only the earlier commit failed' };
    instance.refresh();
    expect(get.mock.calls.at(-1)?.[0].headSha).toBe(OTHER_SHA);
    expect(tooltip()?.textContent).toContain('Cached counts. Refresh pending.');
    expect(tooltip()?.textContent).not.toContain('earlier commit failed');
    expect(a.title).toBe('Native commit title');
  });

  it('keeps cached totals explicit after a failed refresh instead of reporting an active update', async () => {
    let state = ready({ provisional: true, refreshing: true });
    const instance = create(() => state);
    const host = link();
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.textContent).toContain('Cached counts. Updating…');
    state = ready({ provisional: true, refreshError: 'Rate limit resets in one hour' });
    instance.refresh();
    expect(tooltip()?.textContent).toContain('Counts may be out of date: Rate limit resets in one hour');
    expect(tooltip()?.textContent).not.toContain('Updating');
    expect(tooltip()?.textContent).toContain('Total 2 files +7 −1');
  });

  it('restores the current title after an owned count enters a loading or deferred state during hover', async () => {
    const instance = create(() => ready());
    const host = document.createElement('span');
    host.dataset.geldUi = '';
    host.title = 'Essential 1 file +4 −1';
    document.body.append(host);
    geometry(host);
    instance.bindBreakdown(host, () => null, { status: () => ({ status: 'loading' }) });
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(host.hasAttribute('title')).toBe(false);
    instance.setTitle(host, 'Focus or hover to count changes.');
    expect(host.hasAttribute('title')).toBe(false);
    leave(host);
    expect(host.title).toBe('Focus or hover to count changes.');
    expect(host.title).not.toContain('Essential');
  });

  it('ignores external, unsupported and repository-excluded links without disturbing titles', async () => {
    const get = vi.fn(() => ready());
    create(get);
    const outside = link();
    outside.href = `https://another.example/group/repo/-/commit/${SHA}`;
    hover(outside);
    const unsupported = link();
    unsupported.href = `${ROOT}/-/issues/7`;
    hover(unsupported);
    settings = { ...DEFAULT_SETTINGS, repoRules: ['gitlab.com/group/repo'] };
    const excluded = link();
    hover(excluded);
    await vi.advanceTimersByTimeAsync(200);
    expect(get).not.toHaveBeenCalled();
    expect(outside.title).toBe('Native commit title');
    expect(excluded.title).toBe('Native commit title');
  });

  it.each(['overview', 'diff'] as const)('counts a %s link after pointer intent and restores its native title', async (kind) => {
    const get = vi.fn(() => ready());
    const instance = create(get);
    const host = link();
    const target = `${ROOT}/-/merge_requests/8`;
    host.href = kind === 'diff' ? `${target}/diffs` : target;
    host.textContent = '!8';
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ number: '8', url: target }), true);
    expect(tooltip()?.textContent).toContain('Tests 1 file +3 −0');
    expect(tooltip()?.textContent).toContain('Essential 1 file +4 −1');
    leave(host);
    instance.refresh();
    expect(host.title).toBe('Native commit title');
    expect(host.hasAttribute('aria-describedby')).toBe(false);
  });

  it('uses qualified settings scopes and waits for repository settings only after intent', async () => {
    let effective: GeldSettings | null = null;
    const settingsForPage = vi.fn(() => effective);
    const get = vi.fn(() => ready());
    const instance = create(get, { settingsForPage });
    settings = { ...DEFAULT_SETTINGS, repoRules: ['group/repo'], categoryPatterns: { tests: ['[group/repo]', 'src/**'] } };
    const host = link();
    hover(host);
    expect(settingsForPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.textContent).toBe('Reading repository settings…');
    expect(get).not.toHaveBeenCalled();
    effective = settings;
    instance.refresh();
    expect(tooltip()?.textContent).toContain('Essential 1 file +4 −1');
    expect(get).toHaveBeenCalledOnce();
  });

  it('does not call inaccessible or incomplete data a zero-line commit', async () => {
    let state: ProviderDiffState = { status: 'failed', reason: 'Sign in to read this diff' };
    const instance = create(() => state);
    const host = link();
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.textContent).toBe('Counts unavailable: Sign in to read this diff');
    state = { status: 'ready', result: { files: [], complete: false, revision: SHA } };
    instance.refresh();
    expect(tooltip()?.textContent).toContain('diff is incomplete');
    expect(tooltip()?.textContent).not.toContain('+0');
  });
});

describe('count tooltip ownership and lifecycle', () => {
  it('keeps static descriptions, manages only requested focusability and restores host and ancestor titles', async () => {
    const get = vi.fn(() => ready());
    const instance = create(get);
    const host = document.createElement('span');
    const wrapper = document.createElement('div');
    wrapper.title = 'Count context';
    host.title = 'Count detail';
    host.textContent = '+4 −1';
    host.setAttribute('aria-describedby', 'static-description');
    document.body.insertAdjacentHTML('beforeend', '<p id="static-description">A static accessible description</p>');
    document.body.append(wrapper);
    wrapper.append(host);
    geometry(host);
    const { all, hidden } = breakdownFromFiles([], createMatcher(DEFAULT_SETTINGS));
    const unbind = instance.bindBreakdown(host, () => statsBreakdown(all, hidden, 'test files'));
    expect(host.hasAttribute('tabindex')).toBe(false);
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(get).not.toHaveBeenCalled();
    expect(host.getAttribute('aria-describedby')).toBe('static-description geld-provider-count-tooltip');
    expect(wrapper.hasAttribute('title')).toBe(false);
    host.title = 'Native title updated while open';
    leave(host);
    expect(host.title).toBe('Native title updated while open');
    expect(wrapper.title).toBe('Count context');
    expect(host.getAttribute('aria-describedby')).toBe('static-description');
    unbind();
    expect(host.hasAttribute('tabindex')).toBe(false);
  });

  it('shows bound counts on keyboard focus without fetching, and Escape dismisses until focus leaves', async () => {
    const get = vi.fn(() => ready());
    const instance = create(get);
    const host = document.createElement('span');
    host.setAttribute('data-geld-ui', '');
    document.body.append(host);
    geometry(host);
    const { all, hidden } = breakdownFromFiles([], createMatcher(DEFAULT_SETTINGS));
    instance.bindBreakdown(host, () => statsBreakdown(all, hidden, 'test files'));
    expect(host.tabIndex).toBe(0);
    host.focus();
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.hidden).toBe(false);
    expect(get).not.toHaveBeenCalled();
    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(tooltip()?.hidden).toBe(true);
    expect(document.activeElement).toBe(host);
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.hidden).toBe(true);
    instance.stop();
    expect(host.hasAttribute('tabindex')).toBe(false);
    expect(host.hasAttribute('aria-describedby')).toBe(false);
  });

  it('backs off from existing and newly mounted native popovers, including parent-owned descriptions', async () => {
    const get = vi.fn(() => ready());
    const instance = create(get);
    const host = link();
    document.body.insertAdjacentHTML('beforeend', '<div id="native-popover" role="tooltip">Native commit card</div>');
    host.setAttribute('aria-describedby', 'native-popover');
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(get).not.toHaveBeenCalled();
    expect(host.title).toBe('Native commit title');
    host.removeAttribute('aria-describedby');
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.hidden).toBe(false);
    host.setAttribute('aria-describedby', 'geld-provider-count-tooltip native-popover');
    instance.refresh();
    expect(tooltip()?.hidden).toBe(true);
    expect(host.getAttribute('aria-describedby')).toBe('native-popover');
  });

  it('closes when hidden, removed, navigated or the current review head changes', async () => {
    const instance = create(() => ready());
    const host = link();
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    currentHead = OTHER_SHA;
    instance.refresh();
    expect(tooltip()?.hidden).toBe(true);
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    host.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(tooltip()?.hidden).toBe(true);
    document.body.append(host);
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(tooltip()?.hidden).toBe(true);
    expect(host.title).toBe('Native commit title');
  });

  it('retires an earlier instance and does not leave duplicate overlays or listeners after reinjection', async () => {
    const oldGet = vi.fn(() => ready());
    const first = create(oldGet);
    const host = link();
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    const get = vi.fn(() => ready());
    const second = create(get);
    expect(tooltip()).toBeNull();
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(get).toHaveBeenCalledOnce();
    expect(oldGet).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('#geld-provider-count-tooltip')).toHaveLength(1);
    first.stop();
    second.refresh();
    expect(tooltip()?.hidden).toBe(false);
  });

  it('keeps the popup open while its content is hovered and dismisses on leaving both surfaces', async () => {
    create(() => ready());
    const host = link();
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    const box = tooltip();
    if (box === null) throw new Error('Missing count tooltip');
    host.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: box }));
    box.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: host }));
    expect(box.hidden).toBe(false);
    box.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(box.hidden).toBe(true);
    expect(host.title).toBe('Native commit title');
  });

  it('anchors a wrapped link under the actual pointer line without restarting intent or refetching', async () => {
    const get = vi.fn(() => ready());
    create(get);
    const host = link();
    const first = new DOMRect(100, 50, 80, 20);
    const second = new DOMRect(20, 80, 100, 20);
    const rects = [first, second];
    const list: DOMRectList = Object.assign({ length: rects.length, item: (index: number) => rects[index] ?? null, [Symbol.iterator]: () => rects.values() }, rects);
    vi.spyOn(host, 'getClientRects').mockReturnValue(list);
    host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientY: 55 }));
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.style.top).toBe('78px');
    host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientY: 85 }));
    expect(tooltip()?.style.top).toBe('108px');
    expect(get).toHaveBeenCalledOnce();
  });

  it('dismisses for navigation without showing a later source update on the new page', async () => {
    const get = vi.fn(() => ready());
    const instance = create(get);
    const host = link();
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    window.history.pushState({}, '', '/group/repo/-/merge_requests/8');
    window.dispatchEvent(new Event('wxt:locationchange'));
    instance.refresh();
    expect(tooltip()?.hidden).toBe(true);
    expect(host.title).toBe('Native commit title');
    expect(get).toHaveBeenCalledOnce();
  });
});

describe('provider count popup placement', () => {
  it('clamps a popup to the host content column and flips above when the space below is smaller', () => {
    const value = providerHoverPlacement({ left: 700, right: 800, top: 530, bottom: 550 }, { width: 300, height: 160 }, { width: 1000, height: 600 }, { left: 400, right: 820 });
    expect(value.placement).toBe('above');
    expect(value.left).toBe(512);
    expect(value.top).toBe(362);
    expect(value.left + 300).toBeLessThanOrEqual(812);
  });

  it('keeps a tall popup inside a narrow viewport with a bounded scrolling height', () => {
    const value = providerHoverPlacement({ left: 260, right: 290, top: 30, bottom: 50 }, { width: 420, height: 900 }, { width: 320, height: 480 }, { left: 0, right: 320 });
    expect(value.left).toBe(8);
    expect(value.top).toBe(58);
    expect(value.maxHeight).toBe(414);
    expect(value.caret).toBeLessThanOrEqual(292);
  });
});
