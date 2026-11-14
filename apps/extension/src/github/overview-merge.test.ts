// @vitest-environment happy-dom
import type { MergeActions, MergeBox, Stack, StackMember } from './merge-actions';
import { greenOverviewMerges, liveOverviewMerge, overviewMergeOf, removeOverviewMerge, setOverviewMergeBusy, syncOverviewMerge } from './overview-merge';
import { ATTR_HYDRATION_WATCH } from './react-hydration';

const box = (over: Partial<MergeBox>): MergeBox => ({
  state: 'OPEN',
  open: true,
  draft: false,
  canClose: false,
  canConvertToDraft: false,
  canMarkReady: false,
  verdicts: [],
  mergeable: false,
  canBypass: false,
  unbypassable: false,
  methods: ['SQUASH', 'MERGE', 'REBASE'],
  bypassMethods: [],
  commitTitle: '',
  commitMessage: '',
  authorEmail: null,
  stacked: false,
  canQueue: false,
  canAutoMerge: false,
  queued: false,
  autoMerging: false,
  ...over,
});

const actions = (read: MergeBox, over: Partial<MergeActions> = {}): MergeActions => ({ box: read, offer: null, stack: null, bypass: false, bypassMethods: [], ...over });

const member = (number: number, current = false): StackMember => ({ number, path: `/o/r/pull/${number}`, title: `PR ${number}`, current });
const stackOf = (current: number, boxes: { readonly [number: number]: MergeBox }): Stack => ({
  members: [3, 2, 1].map((number) => member(number, number === current)),
  boxes: new Map(Object.entries(boxes).map(([number, read]) => [Number(number), read])),
});

describe('overviewMergeOf', () => {
  it('offers the merge GitHub would take now, its default method first', () => {
    expect(overviewMergeOf(actions(box({ mergeable: true }), { offer: 'merge' }))).toEqual({ kind: 'merge', methods: ['SQUASH', 'MERGE', 'REBASE'] });
    expect(overviewMergeOf(actions(box({}), { offer: null }))).toBeNull();
    expect(overviewMergeOf(null)).toBeNull();
  });

  it('offers the queue and auto-merge the status menu offers, GitHub’s own control standing in for them where it shows', () => {
    expect(overviewMergeOf(actions(box({ canQueue: true }), { offer: 'queue' }))).toEqual({ kind: 'queue', methods: [] });
    expect(overviewMergeOf(actions(box({ canAutoMerge: true }), { offer: 'auto' }))).toEqual({ kind: 'auto', methods: [] });
  });

  // geld#678 (Nov 2026): the pull request below it had merged, which leaves a stack of one GitHub still shows no merge for.
  it('offers a stack of one whatever it would offer outside a stack, a merge past the rules included', () => {
    const single = (read: MergeBox): Stack => ({ members: [member(2, true)], boxes: new Map([[2, read]]) });
    const ready = box({ mergeable: true, stacked: true });
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: single(ready) }))?.kind).toBe('merge');
    const blocked = box({ stacked: true, canBypass: true, methods: [] });
    expect(overviewMergeOf(actions(blocked, { offer: 'bypass', bypassMethods: ['SQUASH'], stack: single(blocked) }))).toEqual({ kind: 'bypass', methods: ['SQUASH'] });
    expect(overviewMergeOf(actions(blocked, { offer: 'bypass', bypassMethods: ['SQUASH'], stack: null }))).toBeNull();
  });

  // geld#486 (Nov 2026): GitHub's own control leaves a stacked pull request ready to merge with "View merge status" alone.
  it('offers a stacked pull request’s merge when it and every one below it could merge, as GitHub’s sidebar takes them', () => {
    const ready = box({ mergeable: true, stacked: true });
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: stackOf(3, { 3: ready, 2: ready, 1: ready }) }))?.kind).toBe('merge');
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: stackOf(2, { 3: ready, 2: ready, 1: ready }) }))?.kind).toBe('merge');
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: stackOf(3, { 3: ready, 2: box({ stacked: true }), 1: ready }) }))).toBeNull();
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: null }))).toBeNull();
  });

  it('offers a stacked pull request’s place in the queue through it, as its menu does', () => {
    const queued = box({ canQueue: true, stacked: true });
    expect(overviewMergeOf(actions(queued, { offer: 'queue', stack: stackOf(3, { 3: queued, 2: queued, 1: queued }) }))?.kind).toBe('queue');
    expect(overviewMergeOf(actions(queued, { offer: 'queue', stack: stackOf(3, { 3: queued, 2: box({ stacked: true }), 1: queued }) }))).toBeNull();
  });

  it('offers an admin’s merge past the rules with the methods the bypass may use, and none in a stack of several, whose menu has none', () => {
    expect(overviewMergeOf(actions(box({ methods: [] }), { offer: 'bypass', bypassMethods: ['REBASE'] }))).toEqual({ kind: 'bypass', methods: ['REBASE'] });
    const blocked = box({ stacked: true });
    expect(overviewMergeOf(actions(blocked, { offer: 'bypass', bypassMethods: ['SQUASH'], stack: stackOf(3, { 3: blocked, 2: blocked, 1: blocked }) }))).toBeNull();
  });
});

describe('syncOverviewMerge', () => {
  const handlers = { onMerge: vi.fn(), onMethod: vi.fn() };
  const render = (actionsMarkup: string): void => {
    document.body.innerHTML = `<section aria-label="Recommended action"><ul><li data-testid="for-you-item-row"><div class="Actions"><div></div><div>${actionsMarkup}</div></div></li></ul></section>`;
  };
  afterEach(() => {
    removeOverviewMerge();
    document.body.innerHTML = '';
  });

  it('turns View merge status into an info button and puts the merge beside it, put back on teardown', () => {
    render('<button type="button"><span data-component="buttonContent"><span>View merge status</span></span></button>');
    syncOverviewMerge({ kind: 'merge', methods: ['SQUASH', 'REBASE'] }, 'REBASE', handlers);
    const info = document.querySelector('button[data-geld-merge-info]');
    expect(info?.getAttribute('aria-label')).toBe('View merge status');
    expect(document.querySelector('.geld-overview-merge__main')?.textContent).toBe('Rebase and merge');
    expect(document.querySelector('.geld-overview-merge__caret')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.geld-overview-merge__main')?.click();
    expect(handlers.onMerge).toHaveBeenCalledWith('REBASE', expect.any(HTMLElement));
    removeOverviewMerge();
    expect(document.querySelector('[data-geld-overview-merge]')).toBeNull();
    expect(info?.hasAttribute('aria-label')).toBe(false);
    expect(info?.querySelector('.geld-overview-merge__info')).toBeNull();
  });

  it('names the queue and auto-merge in GitHub’s words, with no method caret', () => {
    render('<button type="button">View merge status</button>');
    syncOverviewMerge({ kind: 'queue', methods: [] }, 'SQUASH', handlers);
    expect(document.querySelector('.geld-overview-merge__main')?.textContent).toBe('Merge when ready');
    expect(document.querySelector('.geld-overview-merge__caret')).toBeNull();
    syncOverviewMerge({ kind: 'auto', methods: [] }, 'SQUASH', handlers);
    expect(document.querySelector('.geld-overview-merge__main')?.textContent).toBe('Enable auto-merge');
  });

  it('stays in place while a request is out, sending nothing, and comes back when it ends', () => {
    render('<button type="button">View merge status</button>');
    const onMerge = vi.fn();
    syncOverviewMerge({ kind: 'merge', methods: ['SQUASH', 'REBASE'] }, 'SQUASH', { onMerge, onMethod: vi.fn() }, true);
    const main = document.querySelector<HTMLButtonElement>('.geld-overview-merge__main');
    expect([...document.querySelectorAll('[data-geld-overview-merge] button')].map((button) => button.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    main?.click();
    expect(onMerge).not.toHaveBeenCalled();
    setOverviewMergeBusy(false);
    main?.click();
    expect(onMerge).toHaveBeenCalledTimes(1);
    syncOverviewMerge({ kind: 'merge', methods: ['SQUASH', 'REBASE'] }, 'SQUASH', { onMerge, onMethod: vi.fn() }, true);
    expect(document.querySelector('.geld-overview-merge__main')).toBe(main);
    expect(main?.getAttribute('aria-disabled')).toBe('true');
  });

  it('finds the control a re-render put in place of the one a box was opened from', () => {
    render('<button type="button">View merge status</button>');
    syncOverviewMerge({ kind: 'queue', methods: [] }, 'SQUASH', handlers);
    const first = document.querySelector<HTMLElement>('[data-geld-overview-merge]');
    expect(liveOverviewMerge(first)).toBe(first);
    first?.remove();
    syncOverviewMerge({ kind: 'queue', methods: [] }, 'SQUASH', handlers);
    const second = document.querySelector<HTMLElement>('[data-geld-overview-merge]');
    expect(second).not.toBe(first);
    expect(liveOverviewMerge(first)).toBe(second);
    expect(liveOverviewMerge(null)).toBeNull();
  });

  it('draws GitHub’s own grey merge in its green, as GitHub draws it when all is clear, and puts the grey back on teardown', () => {
    // GitHub's split merge as it renders it (#490, Nov 2026), with the default variant it gives it while checks are not all green.
    render('<div data-component="ButtonGroup"><div><button data-component="Button" data-variant="default" type="button"><span data-component="buttonContent"><span>Squash and merge</span></span></button></div><div><button data-component="IconButton" data-variant="default" aria-labelledby="tip" type="button"></button><span id="tip">Select merge method</span></div></div>');
    syncOverviewMerge(null, 'SQUASH', handlers);
    const variants = (): (string | null)[] => [...document.querySelectorAll('button')].map((button) => button.getAttribute('data-variant'));
    expect(variants()).toEqual(['primary', 'primary']);
    removeOverviewMerge();
    expect(variants()).toEqual(['default', 'default']);
  });

  it('greens GitHub’s merge before React has hydrated the section, and adds nothing of its own there until it has', () => {
    document.documentElement.setAttribute(ATTR_HYDRATION_WATCH, '');
    document.body.innerHTML =
      '<react-app><section aria-label="Recommended action"><ul><li data-testid="for-you-item-row"><button data-component="Button" data-variant="default" type="button">Squash and merge</button><button type="button">View merge status</button></li></ul></section></react-app>';
    try {
      greenOverviewMerges();
      expect(document.querySelector('button')?.getAttribute('data-variant')).toBe('primary');
      syncOverviewMerge(null, 'SQUASH', handlers);
      expect(document.querySelector('button[data-geld-merge-info]')).toBeNull();
    } finally {
      document.documentElement.removeAttribute(ATTR_HYDRATION_WATCH);
    }
  });

  // mintlify/customer-apps#7 (Nov 2026): approval required, the merge inactive and its method caret still usable.
  it('greens the method caret with its merge and leaves both grey while GitHub blocks the merge', () => {
    const group = (inactive: boolean): string =>
      `<div data-component="ButtonGroup"><div><button ${inactive ? 'aria-disabled="true" data-inactive="true"' : ''} data-component="Button" type="button" data-dd-action-name="pull_requests.merge.open" data-variant="default"><span data-component="buttonContent"><span data-component="text">Merge pull request</span></span></button></div><div><button aria-disabled="false" data-component="IconButton" type="button" aria-label="Select merge method" data-dd-action-name="pull_requests.merge.open_method" data-variant="default"></button></div></div>`;
    const variants = (): (string | null)[] => [...document.querySelectorAll('[data-component="ButtonGroup"] button')].map((button) => button.getAttribute('data-variant'));
    render(group(true));
    syncOverviewMerge(null, 'SQUASH', handlers);
    expect(variants()).toEqual(['default', 'default']);
    render(group(false));
    syncOverviewMerge(null, 'SQUASH', handlers);
    expect(variants()).toEqual(['primary', 'primary']);
  });

  it('turns the caret back and forth with its merge when GitHub blocks and unblocks it in place', async () => {
    render(
      '<div data-component="ButtonGroup"><div><button data-component="Button" type="button" data-dd-action-name="pull_requests.merge.open" data-variant="default">Squash and merge</button></div><div><button aria-disabled="false" data-component="IconButton" type="button" aria-label="Select merge method" data-dd-action-name="pull_requests.merge.open_method" data-variant="default"></button></div></div>',
    );
    const variants = (): (string | null)[] => [...document.querySelectorAll('[data-component="ButtonGroup"] button')].map((button) => button.getAttribute('data-variant'));
    syncOverviewMerge(null, 'SQUASH', handlers);
    expect(variants()).toEqual(['primary', 'primary']);
    const merge = document.querySelector('button[data-component="Button"]');
    merge?.setAttribute('aria-disabled', 'true');
    merge?.setAttribute('data-inactive', 'true');
    await Promise.resolve();
    expect(variants()).toEqual(['default', 'default']);
    expect(document.querySelector('[data-geld-merge-variant]')).toBeNull();
    merge?.setAttribute('aria-disabled', 'false');
    merge?.removeAttribute('data-inactive');
    await Promise.resolve();
    expect(variants()).toEqual(['primary', 'primary']);
  });

  it('leaves a merge GitHub disables grey, and gives it back its grey when GitHub disables it later', () => {
    render('<button data-component="Button" data-variant="default" aria-disabled="true" type="button">Squash and merge</button>');
    syncOverviewMerge(null, 'SQUASH', handlers);
    expect(document.querySelector('button')?.getAttribute('data-variant')).toBe('default');
    const button = document.querySelector('button');
    button?.setAttribute('aria-disabled', 'false');
    syncOverviewMerge(null, 'SQUASH', handlers);
    expect(button?.getAttribute('data-variant')).toBe('primary');
    button?.setAttribute('aria-disabled', 'true');
    syncOverviewMerge(null, 'SQUASH', handlers);
    expect([button?.getAttribute('data-variant'), button?.hasAttribute('data-geld-merge-variant')]).toEqual(['default', false]);
  });

  it('follows GitHub disabling its merge in place, with no pass in between', async () => {
    render('<button data-component="Button" data-variant="default" aria-disabled="false" type="button">Squash and merge</button>');
    syncOverviewMerge(null, 'SQUASH', handlers);
    const button = document.querySelector('button');
    expect(button?.getAttribute('data-variant')).toBe('primary');
    button?.setAttribute('aria-disabled', 'true');
    await Promise.resolve();
    expect(button?.getAttribute('data-variant')).toBe('default');
    button?.setAttribute('aria-disabled', 'false');
    await Promise.resolve();
    expect(button?.getAttribute('data-variant')).toBe('primary');
  });

  it('adds no second merge where GitHub shows its own, and nothing when there is nothing to merge', () => {
    render('<button type="button">Squash and merge</button><button type="button" aria-label="Select merge method"></button>');
    syncOverviewMerge({ kind: 'merge', methods: ['SQUASH'] }, 'SQUASH', handlers);
    expect(document.querySelector('[data-geld-overview-merge]')).toBeNull();
    render('<button type="button">View merge status</button>');
    syncOverviewMerge(null, 'SQUASH', handlers);
    expect(document.querySelector('[data-geld-overview-merge]')).toBeNull();
    expect(document.querySelector('button[data-geld-merge-info]')).not.toBeNull();
  });
});
