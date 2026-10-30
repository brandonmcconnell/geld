// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { MergeSubmission } from './merge-actions';
import { actionErrorText, autoMergeRequest, bypassBeside, parseStack, stackQueueRequest, closeRequest, mergeableNow, mergeOffer, mergeRequest, parseMergeBox, queueRequest, readyRequest, viewerVerdict } from './merge-actions';

/** A `page_data/merge_box` answer as GitHub gave it on brandonmcconnell/geld#74 (Oct 2026), trimmed. */
function payload(overrides: { readonly state?: string; readonly draft?: boolean; readonly canClose?: boolean; readonly canBypass?: boolean; readonly direct?: string; readonly stacked?: boolean; readonly queue?: string; readonly queued?: boolean; readonly auto?: boolean; readonly autoOn?: boolean; readonly email?: string; readonly emails?: readonly string[] | null } = {}): unknown {
  return {
    pullRequest: {
      state: 'OPEN',
      isDraft: overrides.draft ?? false,
      viewerCanClose: overrides.canClose ?? true,
      viewerCanAdminBypassMergeRequirements: overrides.canBypass ?? false,
      viewerCanMarkReadyForReview: overrides.draft ?? false,
      isInMergeQueue: overrides.queued ?? false,
      viewerCanEnableAutoMerge: overrides.auto ?? false,
      autoMergeRequest: overrides.autoOn === true ? { mergeMethod: 'SQUASH' } : null,
      latestOpinionatedReviews: [
        { id: 1, author: { login: 'aeschli' }, state: 'APPROVED' },
        { id: 2, author: { login: 'Alice' }, state: 'CHANGES_REQUESTED' },
      ],
      viewerMergeActions: [
        { allowableStatus: overrides.queue ?? 'BLOCKED', name: 'MERGE_QUEUE', mergeMethods: [{ allowableStatus: overrides.queue ?? 'BLOCKED', isDefault: true, name: 'MERGE' }] },
        {
          allowableStatus: overrides.direct ?? 'ALLOWED',
          name: 'DIRECT_MERGE',
          mergeMethods: [
            { allowableStatus: 'ALLOWED', isDefault: false, name: 'MERGE' },
            { allowableStatus: 'ALLOWED', isDefault: true, name: 'SQUASH' },
            { allowableStatus: 'BLOCKED', isDefault: false, name: 'REBASE' },
          ],
        },
      ],
    },
    mergeRequirements: {
      state: overrides.state ?? 'MERGEABLE',
      conditions: [{ type: 'STACK', result: 'PASSED', isStacked: overrides.stacked ?? false }],
      defaultCommitAuthorEmail: overrides.email ?? 'brandon@dreamthinkbuild.com',
      ...(overrides.emails === null ? {} : { possibleCommitAuthorEmails: overrides.emails ?? ['brandon@dreamthinkbuild.com', 'brandonmcconnell@users.noreply.github.com'] }),
      commitMessageHeadline: 'Submit review from any pull request tab (#74)',
      commitMessageBody: '* Submit review from any pull request tab',
    },
  };
}

describe('parseMergeBox', () => {
  it('reads what the reader may do and the commit GitHub would write', () => {
    const box = parseMergeBox(payload());
    expect(box).toEqual({
      state: 'OPEN',
      open: true,
      canConvertToDraft: false,
      draft: false,
      canClose: true,
      canMarkReady: false,
      verdicts: [
        { login: 'aeschli', state: 'APPROVED', id: 1 },
        { login: 'Alice', state: 'CHANGES_REQUESTED', id: 2 },
      ],
      mergeable: true,
      canBypass: false,
      methods: ['SQUASH', 'MERGE'],
      commitTitle: 'Submit review from any pull request tab (#74)',
      commitMessage: '* Submit review from any pull request tab',
      authorEmail: 'brandon@dreamthinkbuild.com',
      stacked: false,
      canQueue: false,
      canAutoMerge: false,
      queued: false,
      autoMerging: false,
    });
    expect(parseMergeBox({ nope: true })).toBeNull();
  });

  it('knows when the pull request is in the merge queue or set to merge automatically', () => {
    const queued = parseMergeBox(payload({ queue: 'ALLOWED', queued: true }));
    expect([queued?.queued, queued?.autoMerging, queued?.canQueue]).toEqual([true, false, false]);
    const auto = parseMergeBox(payload({ auto: true, autoOn: true }));
    expect([auto?.queued, auto?.autoMerging, auto?.canAutoMerge]).toEqual([false, true, false]);
  });

  it('sends no commit email where GitHub offers none to pick, as its merge box does', () => {
    // mintlify/docs#8081 (Oct 2026): a pull request mintlify[bot] opened defaults to the bot's noreply address with no
    // emails to pick, and sending it answered "Invalid email for web commit".
    expect(parseMergeBox(payload({ email: '109931778+mintlify[bot]@users.noreply.github.com', emails: [] }))?.authorEmail).toBeNull();
    expect(parseMergeBox(payload({ emails: null }))?.authorEmail).toBeNull();
  });

  it('knows the reader’s own standing verdict, whatever the case of their login', () => {
    const box = parseMergeBox(payload());
    if (box === null) throw new Error('fixture');
    expect(viewerVerdict(box, 'alice')).toBe('CHANGES_REQUESTED');
    expect(viewerVerdict(box, 'bob')).toBeNull();
  });
});

describe('mergeableNow', () => {
  it('reads a pull request that waits only on statuses that have passed as mergeable, as GitHub’s merge box does', () => {
    expect(mergeableNow('MERGEABLE', undefined)).toBe(true);
    // mintlify/mint#13535 (Oct 2026): GitHub's merge box offered Squash and merge.
    expect(mergeableNow('MERGEABLE_IF_STATUSES_PASS', 'CLEAN')).toBe(true);
    expect(mergeableNow('MERGEABLE_IF_STATUSES_PASS', 'HAS_HOOKS')).toBe(true);
    for (const status of ['BEHIND', 'BLOCKED', 'UNSTABLE', 'DIRTY', 'UNKNOWN', undefined]) expect(mergeableNow('MERGEABLE_IF_STATUSES_PASS', status)).toBe(false);
    expect(mergeableNow('BLOCKED', 'CLEAN')).toBe(false);
  });
});

describe('mergeOffer', () => {
  const read = (overrides: Parameters<typeof payload>[0]) => {
    const box = parseMergeBox(payload(overrides));
    if (box === null) throw new Error('fixture');
    return box;
  };
  it('offers a merge GitHub would take now, a bypass only past the rules, and nothing otherwise', () => {
    expect(mergeOffer(read({}), null)).toBe('merge');
    expect(mergeOffer(read({ state: 'UNMERGEABLE', canBypass: true }), read({ canBypass: true }))).toBe('bypass');
    expect(mergeOffer(read({ state: 'UNMERGEABLE', canBypass: true }), read({ state: 'UNMERGEABLE', canBypass: true }))).toBeNull();
    expect(mergeOffer(read({ state: 'UNMERGEABLE' }), null)).toBeNull();
    expect(mergeOffer(read({ draft: true }), null)).toBeNull();
    // A repository that only merges through its queue allows no direct merge: its queue is offered instead, once.
    expect(mergeOffer(read({ direct: 'BLOCKED' }), null)).toBeNull();
    expect(mergeOffer(read({ direct: 'BLOCKED', queue: 'ALLOWED', state: 'BLOCKED' }), null)).toBe('queue');
    expect(mergeOffer(read({ direct: 'BLOCKED', queue: 'ALLOWED', queued: true }), null)).toBeNull();
    expect(mergeOffer(read({ direct: 'BLOCKED', queue: 'ALLOWED', draft: true }), null)).toBeNull();
    // Waiting on its checks or reviews where the repository allows auto-merge: GitHub's Enable auto-merge, until it is on.
    expect(mergeOffer(read({ state: 'BLOCKED', auto: true }), null)).toBe('auto');
    expect(mergeOffer(read({ state: 'BLOCKED', auto: true, autoOn: true }), null)).toBeNull();
    expect(mergeOffer(read({ auto: true }), null)).toBe('merge');
  });

  it('offers the queue wherever the repository has one, even where a direct merge would also go, as GitHub does', () => {
    expect(mergeOffer(read({ queue: 'ALLOWED' }), null)).toBe('queue');
  });

  it('puts an admin’s bypass beside the queue or auto-merge, never beside a merge GitHub would take now', () => {
    const queued = read({ queue: 'ALLOWED', canBypass: true });
    expect(bypassBeside(queued, read({ canBypass: true }), mergeOffer(queued, null))).toBe(true);
    expect(bypassBeside(queued, read({ state: 'UNMERGEABLE', canBypass: true }), 'queue')).toBe(false);
    expect(bypassBeside(read({ queue: 'ALLOWED' }), read({}), 'queue')).toBe(false);
    const waiting = read({ state: 'BLOCKED', auto: true, canBypass: true });
    expect(mergeOffer(waiting, read({ canBypass: true }))).toBe('auto');
    expect(bypassBeside(waiting, read({ canBypass: true }), 'auto')).toBe(true);
    expect(bypassBeside(read({ canBypass: true }), read({ canBypass: true }), 'merge')).toBe(false);
    // The bypass alone, where nothing else would take it, is the offer itself and stands beside nothing.
    expect(bypassBeside(read({ state: 'UNMERGEABLE', canBypass: true }), read({ canBypass: true }), 'bypass')).toBe(false);
  });
});

describe('the requests', () => {
  it('enables auto-merge as GitHub’s merge box does, with the method and the commit it would write', () => {
    const request = autoMergeRequest('/o/r/pull/7', { method: 'SQUASH', commitTitle: 'Title (#7)', commitMessage: 'Body', authorEmail: 'a@b.c' }, 'n1');
    expect(request.url).toBe('/o/r/pull/7/page_data/enable_auto_merge');
    expect(JSON.parse(String(request.init.body))).toEqual({ mergeMethod: 'SQUASH', commitTitle: 'Title (#7)', commitMessage: 'Body', authorEmail: 'a@b.c' });
  });

  it('adds to the merge queue as GitHub’s Merge when ready does', () => {
    const request = queueRequest('/o/r/pull/7', 'n1');
    expect(request.url).toBe('/o/r/pull/7/page_data/enable_auto_merge');
    expect(request.init.method).toBe('POST');
    expect(JSON.parse(String(request.init.body))).toEqual({ mergeMethod: 'GROUP' });
  });

  const commit: MergeSubmission = { method: 'SQUASH', commitTitle: 'Title (#7)', commitMessage: 'Body', authorEmail: 'a@b.c', bypass: false, stacked: false };
  it('merges as GitHub’s merge box does, through the stack’s request for a stacked pull request', () => {
    const plain = mergeRequest('/o/r/pull/7', commit, 'n1');
    expect(plain.url).toBe('/o/r/pull/7/page_data/merge');
    expect(plain.init.method).toBe('POST');
    expect(JSON.parse(String(plain.init.body))).toEqual({ bypassBranchProtections: false, mergeMethod: 'SQUASH', commitTitle: 'Title (#7)', commitMessage: 'Body', authorEmail: 'a@b.c' });
    const stacked = mergeRequest('/o/r/pull/7', { ...commit, stacked: true, bypass: true }, 'n1');
    expect(stacked.url).toBe('/o/r/pull/7/page_data/enqueue_stack');
    expect(JSON.parse(String(stacked.init.body))).toEqual({ mergeAction: 'DIRECT_MERGE', bypassRules: 'true', mergeMethod: 'SQUASH', commitTitle: 'Title (#7)', commitMessage: 'Body', authorEmail: 'a@b.c' });
    // A rebase writes no commit of its own.
    expect(JSON.parse(String(mergeRequest('/o/r/pull/7', { ...commit, method: 'REBASE' }, '').init.body))).toEqual({ bypassBranchProtections: false, mergeMethod: 'REBASE', authorEmail: 'a@b.c' });
  });

  it('takes a draft out of draft with nothing but the request', () => {
    const ready = readyRequest('/o/r/pull/7', 'n1');
    expect(ready.url).toBe('/o/r/pull/7/page_data/mark_ready_for_review');
    expect(ready.init.method).toBe('POST');
    expect(ready.init.body).toBeUndefined();
  });

  it('closes with nothing but the request', () => {
    const close = closeRequest('/o/r/pull/7', 'n1');
    expect(close.url).toBe('/o/r/pull/7/page_data/close_pull_request');
    expect(close.init.method).toBe('POST');
    expect(close.init.body).toBeUndefined();
  });

  it('says why GitHub refused, rules included', () => {
    expect(actionErrorText('merge', 422, { error: 'Repository rule violations found', metadata: { ruleErrors: [{ message: 'Changes must be made through a pull request.' }] } })).toBe(
      'GitHub could not merge the pull request: Repository rule violations found Changes must be made through a pull request.',
    );
    expect(actionErrorText('close', 500, null)).toBe('GitHub could not close the pull request (HTTP 500).');
  });
});

describe('parseStack', () => {
  const pulls = [
    { number: 13453, title: 'Top', state: 'DRAFT', url: '/mintlify/mint/pull/13453' },
    { number: 13447, title: 'Middle', state: 'OPEN', url: '/mintlify/mint/pull/13447' },
    { number: 13442, title: 'Merged already', state: 'MERGED', url: '/mintlify/mint/pull/13442' },
    { number: 13440, title: 'Foot', state: 'OPEN', url: '/mintlify/mint/pull/13440' },
  ];
  it('lists the stack top first, as GitHub does, marks the page’s own and leaves merged ones out', () => {
    expect(parseStack({ id: 1, stack: { pulls } }, '/mintlify/mint/pull/13447')).toEqual([
      { number: 13453, path: '/mintlify/mint/pull/13453', title: 'Top', current: false },
      { number: 13447, path: '/mintlify/mint/pull/13447', title: 'Middle', current: true },
      { number: 13440, path: '/mintlify/mint/pull/13440', title: 'Foot', current: false },
    ]);
  });
  it('reads no stack when a member that is not merged cannot be read, since every choice would leave it out', () => {
    expect(parseStack({ stack: { pulls: [{ number: 13447, title: 'Middle', state: 'OPEN', url: '/mintlify/mint/pull/13447' }, { title: 'No number', state: 'OPEN', url: '/mintlify/mint/pull/1' }] } }, '/mintlify/mint/pull/13447')).toBeNull();
    expect(parseStack({ stack: { pulls: [{ number: 13447, title: 'Middle', state: 'OPEN', url: '/mintlify/mint/pull/13447' }, 'not a pull'] } }, '/mintlify/mint/pull/13447')).toBeNull();
    expect(parseStack({ stack: { pulls: [{ number: 13447, title: 'Middle', state: 'OPEN', url: '/mintlify/mint/pull/13447' }, { state: 'MERGED' }] } }, '/mintlify/mint/pull/13447')).toHaveLength(1);
  });

  it('reads nothing from an answer without the page’s own pull request in it', () => {
    expect(parseStack({ stack: { pulls } }, '/mintlify/mint/pull/1')).toBeNull();
    expect(parseStack({}, '/mintlify/mint/pull/13447')).toBeNull();
  });
  it('queues a stacked pull request as GitHub’s stack merge box does, with every one below it', () => {
    const request = stackQueueRequest('/o/r/pull/7', 'n');
    expect(request.url).toBe('/o/r/pull/7/page_data/enqueue_stack');
    expect(request.init.body).toBe('{"mergeAction":"MERGE_QUEUE"}');
  });
});
