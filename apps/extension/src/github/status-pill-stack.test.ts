// @vitest-environment happy-dom
import type { MergeBox, Stack, StackMember } from './merge-actions';
import type { StackGroup } from './status-pill';
import { stackConfirmWords, stackGroups } from './status-pill';

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
  methods: ['MERGE'],
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

describe('stackGroups', () => {
  const member = (number: number, current = false): StackMember => ({ number, path: `/o/r/pull/${number}`, title: `PR ${number}`, current });
  const open = box({ canClose: true, canConvertToDraft: true, mergeable: true });
  const stackOf = (current: number, boxes: { readonly [number: number]: MergeBox }): Stack => ({
    members: [4, 3, 2, 1].map((number) => member(number, number === current)),
    boxes: new Map(Object.entries(boxes).map(([number, read]) => [Number(number), read])),
  });
  const read = (groups: readonly StackGroup[] | null): string[][] => (groups ?? []).map((group) => [group.action, group.note, ...group.choices.map((choice) => `${choice.label} via #${choice.via.number}: ${choice.targets.map((target) => target.number).join(',')}`)]);

  it('is null for a stack of one, whose menu is the flat one', () => {
    expect(stackGroups({ members: [member(1, true)], boxes: new Map([[1, open]]) }, 'SQUASH')).toBeNull();
  });

  it('offers each type by itself, forward first and closing last, from the middle of a stack where every one allows everything', () => {
    expect(read(stackGroups(stackOf(3, { 4: open, 3: open, 2: open, 1: open }), 'SQUASH'))).toEqual([
      // A stacked pull request merges with every one below it: never alone from the middle.
      ['merge', 'Squash and merge', 'This and 2 below via #3: 3,2,1', 'Entire stack (4) via #4: 4,3,2,1'],
      ['draft', 'Convert to draft', 'This pull request via #3: 3', 'This and 2 below via #3: 3,2,1', 'Entire stack (4) via #4: 4,3,2,1'],
      ['close', 'Close', 'This pull request via #3: 3', 'This and 2 below via #3: 3,2,1', 'Entire stack (4) via #4: 4,3,2,1'],
    ]);
  });

  it('merges alone at the foot, and offers the entire stack once from its top', () => {
    expect(read(stackGroups(stackOf(1, { 4: open, 3: open, 2: open, 1: open }), 'MERGE'))[0]).toEqual(['merge', 'Create a merge commit', 'This pull request via #1: 1', 'Entire stack (4) via #4: 4,3,2,1']);
    expect(read(stackGroups(stackOf(4, { 4: open, 3: open, 2: open, 1: open }), 'SQUASH'))[0]).toEqual(['merge', 'Squash and merge', 'Entire stack (4) via #4: 4,3,2,1']);
  });

  it('shows a choice only when every pull request it takes allows it, and a type only with a choice left', () => {
    const blocked = box({ canClose: true, canConvertToDraft: true, mergeable: false });
    expect(read(stackGroups(stackOf(3, { 4: blocked, 3: open, 2: open, 1: open }), 'SQUASH'))[0]).toEqual(['merge', 'Squash and merge', 'This and 2 below via #3: 3,2,1']);
    expect(read(stackGroups(stackOf(3, { 4: open, 3: open, 2: blocked, 1: open }), 'SQUASH')).map((group) => group[0])).toEqual(['draft', 'close']);
    // A member whose merge box could not be read allows nothing.
    expect(read(stackGroups(stackOf(3, { 3: open, 2: open, 1: open }), 'SQUASH')).find((group) => group[0] === 'close')).toEqual(['close', 'Close', 'This pull request via #3: 3', 'This and 2 below via #3: 3,2,1']);
  });

  it('marks drafts ready, goes through the queue where the repository has one, and reopens closed ones', () => {
    const draft = box({ draft: true, canMarkReady: true, canClose: true });
    expect(read(stackGroups(stackOf(2, { 4: draft, 3: draft, 2: draft, 1: draft }), 'SQUASH'))[0]).toEqual(['ready', 'Ready for review', 'This pull request via #2: 2', 'This and 1 below via #2: 2,1', 'Entire stack (4) via #4: 4,3,2,1']);
    const queued = box({ canQueue: true, canClose: true });
    expect(read(stackGroups(stackOf(2, { 4: queued, 3: queued, 2: queued, 1: queued }), 'SQUASH'))[0]).toEqual(['queue', 'Merge when ready', 'This and 1 below via #2: 2,1', 'Entire stack (4) via #4: 4,3,2,1']);
    const closed = box({ state: 'CLOSED', open: false, canClose: true });
    expect(read(stackGroups(stackOf(2, { 4: closed, 3: closed, 2: closed, 1: closed }), 'SQUASH'))).toEqual([['reopen', 'Reopen', 'This pull request via #2: 2', 'This and 1 below via #2: 2,1', 'Entire stack (4) via #4: 4,3,2,1']]);
  });

  it('names every pull request a choice of more than one changes, before it changes them', () => {
    const groups = stackGroups(stackOf(3, { 4: open, 3: open, 2: open, 1: open }), 'SQUASH') ?? [];
    const close = groups.find((group) => group.action === 'close');
    const [, below, entire] = close?.choices ?? [];
    if (below === undefined || entire === undefined) throw new Error('fixture');
    expect(stackConfirmWords('close', below)).toBe('Close 3 pull requests (#3, #2 and #1)?');
    expect(stackConfirmWords('merge', entire)).toBe('Merge the entire stack of 4 pull requests (#4, #3, #2 and #1)?');
  });
});
