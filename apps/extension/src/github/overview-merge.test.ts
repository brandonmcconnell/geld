// @vitest-environment happy-dom
import type { MergeActions, MergeBox, Stack, StackMember } from './merge-actions';
import { overviewMergeOf, removeOverviewMerge, syncOverviewMerge } from './overview-merge';

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
    expect(overviewMergeOf(actions(box({}), { offer: 'auto' }))).toBeNull();
    expect(overviewMergeOf(actions(box({}), { offer: 'queue' }))).toBeNull();
    expect(overviewMergeOf(null)).toBeNull();
  });

  // geld#486 (Nov 2026): GitHub's own control leaves a stacked pull request ready to merge with "View merge status" alone.
  it('offers a stacked pull request’s merge when it and every one below it could merge, as GitHub’s sidebar takes them', () => {
    const ready = box({ mergeable: true, stacked: true });
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: stackOf(3, { 3: ready, 2: ready, 1: ready }) }))?.kind).toBe('merge');
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: stackOf(2, { 3: ready, 2: ready, 1: ready }) }))?.kind).toBe('merge');
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: stackOf(3, { 3: ready, 2: box({ stacked: true }), 1: ready }) }))).toBeNull();
    expect(overviewMergeOf(actions(ready, { offer: 'merge', stack: null }))).toBeNull();
  });

  it('offers an admin’s merge past the rules only outside a stack, with the methods the bypass may use', () => {
    expect(overviewMergeOf(actions(box({ methods: [] }), { offer: 'bypass', bypassMethods: ['REBASE'] }))).toEqual({ kind: 'bypass', methods: ['REBASE'] });
    expect(overviewMergeOf(actions(box({ stacked: true }), { offer: 'bypass', bypassMethods: ['SQUASH'] }))).toBeNull();
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

  it('draws GitHub’s own grey merge in its green, as GitHub draws it when all is clear, and puts the grey back on teardown', () => {
    // GitHub's split merge as it renders it (#490, Nov 2026), with the default variant it gives it while checks are not all green.
    render('<div data-component="ButtonGroup"><div><button data-component="Button" data-variant="default" type="button"><span data-component="buttonContent"><span>Squash and merge</span></span></button></div><div><button data-component="IconButton" data-variant="default" aria-labelledby="tip" type="button"></button><span id="tip">Select merge method</span></div></div>');
    syncOverviewMerge(null, 'SQUASH', handlers);
    const variants = (): (string | null)[] => [...document.querySelectorAll('button')].map((button) => button.getAttribute('data-variant'));
    expect(variants()).toEqual(['primary', 'primary']);
    removeOverviewMerge();
    expect(variants()).toEqual(['default', 'default']);
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
