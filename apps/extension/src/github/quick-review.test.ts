// @vitest-environment happy-dom
import type { HeaderStatGroup } from './header-stats';
import { rememberStatusHint, resetStatusHints } from './status-pill';
import { applyQuickReview, canSubmit, isInstantClick, pullPathOf, quickReviewStandBusy, reassertStatusPills, removeQuickReview, reviewErrorText, segmentHint, submitReviewRequest, timelineCommentRequest } from './quick-review';

const SHA = 'a'.repeat(40);

function groupAt(host: HTMLElement): HeaderStatGroup {
  return { host, additions: null, deletions: null, srOnly: null, fileCounts: [], original: null, sentence: false };
}

describe('submitReviewRequest', () => {
  it('sends what GitHub’s review dialog sends', () => {
    const { url, init } = submitReviewRequest('/acme/widgets/pull/7', { body: 'Looks good', event: 'request changes', headSha: SHA }, 'v2:nonce');
    expect(url).toBe('/acme/widgets/pull/7/page_data/submit_review');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({ 'GitHub-Verified-Fetch': 'true', 'X-Fetch-Nonce': 'v2:nonce', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ body: 'Looks good', event: 'request changes', headSha: SHA });
    expect(submitReviewRequest('/acme/widgets/pull/7', { body: '', event: 'approve', headSha: SHA }, '').init.headers).not.toHaveProperty('X-Fetch-Nonce');
  });
});

describe('isInstantClick', () => {
  it('sends Approve or Request changes at once on ⌘-click on a Mac and Ctrl-click elsewhere, Comment only with comments pending', () => {
    expect(isInstantClick('approve', { metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(isInstantClick('request changes', { metaKey: true, ctrlKey: false }, true)).toBe(true);
    expect(isInstantClick('approve', { metaKey: false, ctrlKey: true }, true)).toBe(false);
    expect(isInstantClick('approve', { metaKey: false, ctrlKey: true }, false)).toBe(true);
    expect(isInstantClick('approve', { metaKey: false, ctrlKey: false }, true)).toBe(false);
    expect(isInstantClick('comment', { metaKey: true, ctrlKey: true }, true)).toBe(false);
    expect(isInstantClick('comment', { metaKey: true, ctrlKey: false }, true, true)).toBe(true);
  });
});

describe('segmentHint', () => {
  it('names the verdict and the shortcut, or what a click does while the key is held', () => {
    expect(segmentHint('approve', '⌘')).toEqual(['Approve', '⌘ 1-click review']);
    expect(segmentHint('request changes', 'Ctrl')).toEqual(['Request changes', 'Ctrl 1-click review']);
    expect(segmentHint('comment', '⌘')).toEqual(['Comment']);
    // While the key is held a click sends at once, and the tooltip says that alone.
    expect(segmentHint('approve', '⌘', true)).toEqual(['Approve without comments']);
    expect(segmentHint('request changes', 'Ctrl', true)).toEqual(['Request changes without comments']);
    expect(segmentHint('comment', '⌘', true)).toEqual(['Comment']);
    // With comments pending, 💬 has a 1-click review that submits them.
    expect(segmentHint('comment', '⌘', false, true)).toEqual(['Comment', '⌘ 1-click review']);
    expect(segmentHint('comment', 'Ctrl', true, true)).toEqual(['Submit pending comments']);
  });
});

describe('canSubmit', () => {
  it('needs words for a comment or a change request, unless pending comments go with it', () => {
    expect(canSubmit('approve', '', false)).toBe(true);
    expect(canSubmit('comment', '  ', false)).toBe(false);
    expect(canSubmit('comment', 'Nice', false)).toBe(true);
    expect(canSubmit('request changes', '', false)).toBe(false);
    expect(canSubmit('request changes', '', true)).toBe(true);
  });
});

describe('reviewErrorText', () => {
  it('says what GitHub said, or the status', () => {
    expect(reviewErrorText(422, { error: 'Review cannot be empty' })).toBe('GitHub could not submit the review: Review cannot be empty');
    expect(reviewErrorText(422, { errors: ['One.', { message: 'Two.' }] })).toBe('GitHub could not submit the review: One. Two.');
    expect(reviewErrorText(500, null)).toBe('GitHub could not submit the review (HTTP 500).');
  });
});

describe("the tab bar button while GitHub's counts load", () => {
  const page = { kind: 'pull-conversation' as const, diffUrl: null, stateKey: '/acme/widgets/pull/7' };
  const wrapper = (): HTMLElement => {
    const element = document.querySelector('[class*="rightContentWrapper"]');
    if (!(element instanceof HTMLElement)) throw new Error('fixture');
    return element;
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Not Found"}', { status: 404 })));
    document.head.innerHTML = '<meta name="user-login" content="alice">';
    // The tab row as GitHub first renders it: its counts wrapper holds a skeleton (a Suspense fallback) until they load.
    document.body.innerHTML = `
      <div data-component="PageHeader">
        <a class="text-bold" href="/bob">bob</a>
        <div class="prc-PageHeader-Navigation--uLav">
          <div class="rightContentWrapper__DE7XPN"><div class="skeleton__c5fLaY"></div></div>
          <div class="flex-auto"><nav class="TabNav__qHkBGx"><a id="prs-files-anchor-tab" href="/acme/widgets/pull/7/changes">Files changed</a></nav></div>
        </div>
      </div>`;
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
  });

  afterEach(() => {
    removeQuickReview();
    vi.unstubAllGlobals();
  });

  it('stays out until the counts replace the skeleton, then first appears directly before them', () => {
    applyQuickReview(true, { page, groups: [], headSha: () => SHA });
    expect(document.querySelector('.geld-quick-review')).toBeNull();
    expect(document.querySelector('.geld-quick-review__mark')).toBeNull();
    wrapper().innerHTML = '<div class="counts">+3 −1</div>';
    const counts = wrapper().querySelector<HTMLElement>('.counts');
    if (counts === null) throw new Error('fixture');
    applyQuickReview(true, { page, groups: [groupAt(counts)], headSha: () => SHA });
    expect(counts.previousElementSibling?.classList.contains('geld-quick-review')).toBe(true);
  });

  it('takes the end of the row once the skeleton resolves to nothing (a change of binary files only)', () => {
    applyQuickReview(true, { page, groups: [], headSha: () => SHA });
    expect(document.querySelector('.geld-quick-review')).toBeNull();
    wrapper().replaceChildren();
    applyQuickReview(true, { page, groups: [], headSha: () => SHA });
    expect(wrapper().querySelector('.geld-quick-review + .geld-quick-review__mark')).not.toBeNull();
  });

  it('reads its fallback stand as busy the moment the skeleton comes back, and leaves on the pass that asks', () => {
    wrapper().replaceChildren();
    applyQuickReview(true, { page, groups: [], headSha: () => SHA });
    expect(quickReviewStandBusy()).toBe(false);
    wrapper().insertAdjacentHTML('afterbegin', '<div class="skeleton__c5fLaY"></div>');
    expect(quickReviewStandBusy()).toBe(true);
    applyQuickReview(true, { page, groups: [], headSha: () => SHA });
    expect(document.querySelector('.geld-quick-review')).toBeNull();
    expect(quickReviewStandBusy()).toBe(false);
  });

  it('reads nothing busy while the group rides in the compact sticky header, whatever that row holds', () => {
    wrapper().innerHTML = '<div class="counts">+3 −1</div>';
    const counts = wrapper().querySelector<HTMLElement>('.counts');
    if (counts === null) throw new Error('fixture');
    document.body.insertAdjacentHTML('beforeend', '<div class="PageHeader stickyHeader__x prHeader__y is-stuck"><div class="PageHeader-TitleArea"><h2>Title</h2></div></div>');
    applyQuickReview(true, { page, groups: [groupAt(counts)], headSha: () => SHA });
    expect(document.querySelector('.PageHeader-TitleArea > .geld-quick-review')).not.toBeNull();
    expect(quickReviewStandBusy()).toBe(false);
  });
});

describe('the tab bar button', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Not Found"}', { status: 404 })));
    document.head.innerHTML = '<meta name="user-login" content="alice">';
    document.body.innerHTML = `
      <div data-component="PageHeader">
        <a class="text-bold" href="/bob">bob</a>
        <div class="rightContentWrapper"><div class="counts">+3 −1</div></div>
      </div>
      <div class="toolbar"><button class="ReviewMenuButton__x">Submit review</button></div>`;
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
  });

  afterEach(() => {
    removeQuickReview();
    vi.unstubAllGlobals();
  });

  const counts = (): HTMLElement => {
    const element = document.querySelector('.counts');
    if (!(element instanceof HTMLElement)) throw new Error('fixture');
    return element;
  };

  it('rides in the Files changed toolbar the moment it sticks, where GitHub’s own button would be', async () => {
    document.body.insertAdjacentHTML('beforeend', '<section class="stickyHeader__x toolbar__y" style="top: 0px"><div class="row"><button class="ReviewMenuButton__z">Submit review</button></div></section>');
    const toolbar = document.querySelector('section');
    if (toolbar === null) throw new Error('fixture');
    let top = 262;
    toolbar.getBoundingClientRect = () => new DOMRect(0, top, 1000, 48);
    const page = { kind: 'pull-files' as const, diffUrl: null, stateKey: '/acme/widgets/pull/7' };
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const group = document.querySelector('.geld-quick-review');
    const own = document.querySelector('.ReviewMenuButton__z');
    expect(counts().previousElementSibling).toBe(group);
    // The scroll that sticks it moves the group in the same task, before GitHub's class (a frame later) says so.
    top = 0;
    window.dispatchEvent(new Event('scroll'));
    expect(own?.previousElementSibling).toBe(group);
    expect(group?.getAttribute('data-geld-place')).toBe('toolbar');
    // A pass while stuck keeps it there, without measuring.
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    expect(own?.previousElementSibling).toBe(group);
    // Its box is fixed under the toolbar, and keeps to the room left in the window so its buttons stay in view.
    document.querySelector<HTMLButtonElement>('.geld-quick-review__segment[data-event="comment"]')?.click();
    const box = document.querySelector<HTMLElement>('.geld-quick-review__panel');
    expect(box?.style.position).toBe('fixed');
    expect(box?.style.maxHeight).toMatch(/^\d+px$/);
    box?.querySelector<HTMLButtonElement>('.btn-invisible:not(.geld-quick-review__discard)')?.click();
    top = 262;
    window.dispatchEvent(new Event('scroll'));
    expect(counts().previousElementSibling).toBe(group);
    expect(group?.hasAttribute('data-geld-place')).toBe(false);
  });

  it('rides at the end of the compact header the other tabs show once it sticks', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="PageHeader stickyHeader__x prHeader__y"><div class="PageHeader-TitleArea"><h2>Title</h2></div></div>');
    const header = document.querySelector('.prHeader__y');
    const page = { kind: 'pull-conversation' as const, diffUrl: null, stateKey: '/acme/widgets/pull/7' };
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    const group = document.querySelector('.geld-quick-review');
    expect(counts().previousElementSibling).toBe(group);
    // GitHub shows the header on the same class flip that the group follows, so it is there as the header appears.
    header?.classList.add('is-stuck__w');
    await Promise.resolve();
    expect(header?.querySelector('.PageHeader-TitleArea')?.lastElementChild).toBe(group);
    expect(group?.getAttribute('data-geld-place')).toBe('header');
    header?.classList.remove('is-stuck__w');
    await Promise.resolve();
    expect(counts().previousElementSibling).toBe(group);
  });

  it('sits left of the line counts on every pull request tab, once', () => {
    const page = { kind: 'pull-conversation' as const, diffUrl: null, stateKey: '/acme/widgets/pull/7' };
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    const buttons = document.querySelectorAll('.geld-quick-review');
    expect(buttons).toHaveLength(1);
    expect(counts().previousElementSibling).toBe(buttons[0]);
    expect(document.documentElement.hasAttribute('data-geld-quick-review')).toBe(true);
    // Off, or on a page that is not a pull request, it goes and GitHub's own button is back.
    applyQuickReview(false, { page, groups: [groupAt(counts())], headSha: () => SHA });
    expect(document.querySelector('.geld-quick-review')).toBeNull();
    expect(document.documentElement.hasAttribute('data-geld-quick-review')).toBe(false);
  });

  it('is not shown signed out', () => {
    document.head.innerHTML = '';
    applyQuickReview(true, { page: { kind: 'pull-files', diffUrl: null, stateKey: '/acme/widgets/pull/7' }, groups: [groupAt(counts())], headSha: () => SHA });
    expect(document.querySelector('.geld-quick-review')).toBeNull();
  });

  it('stays out of the way where GitHub hides the header’s counts, so its own review button shows', () => {
    counts().style.display = 'none';
    applyQuickReview(true, { page: { kind: 'pull-files', diffUrl: null, stateKey: '/acme/widgets/pull/7' }, groups: [groupAt(counts())], headSha: () => SHA });
    expect(document.querySelector('.geld-quick-review')).toBeNull();
    expect(document.documentElement.hasAttribute('data-geld-quick-review')).toBe(false);
  });

  const page = { kind: 'pull-conversation' as const, diffUrl: null, stateKey: '/acme/widgets/pull/7' };
  const mount = (): void => applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
  const segment = (event: string): HTMLButtonElement => {
    const button = document.querySelector(`.geld-quick-review__segment[data-event="${event}"]`);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`no ${event} segment`);
    return button;
  };
  const instant = { metaKey: true, ctrlKey: true, bubbles: true };
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const submitButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.geld-quick-review__panel .geld-quick-review__submit');
  /** The verdict the box will send: its submit button says it. */
  const chosen = (): string | undefined => submitButton()?.textContent ?? undefined;

  it('is one group of three segments, ✓ ✗ 💬, named and explained', () => {
    mount();
    const group = document.querySelector('.geld-quick-review__group');
    expect(group?.getAttribute('role')).toBe('group');
    expect([...(group?.children ?? [])].map((child) => child.getAttribute('aria-label'))).toEqual(['Approve', 'Request changes', 'Comment']);
    expect([...(group?.children ?? [])].every((child) => child.classList.contains('BtnGroup-item'))).toBe(true);
    // The page here defines no `tool-tip`, so the words are each segment's title.
    expect(segment('approve').title).toMatch(/^Approve\n(⌘|Ctrl) 1-click review$/);
    expect(segment('comment').title).toBe('Comment');
    // ✓ and ✗ carry their sending glyph for the instant key; 💬 has none.
    expect(segment('approve').querySelector('.geld-quick-review__glyph--instant')).not.toBeNull();
    expect(segment('request changes').querySelector('.geld-quick-review__glyph--instant')).not.toBeNull();
    // 💬 has one too, which the stylesheet shows only while comments are pending (⌘-click then submits them).
    expect(segment('comment').querySelector('.geld-quick-review__glyph--instant')).not.toBeNull();
    expect(document.querySelector('.geld-quick-review__panel')).toBeNull();
  });

  it('opens the comment box with the verdict chosen on a click, as the confirmation', () => {
    mount();
    segment('approve').click();
    const box = document.querySelector('.geld-quick-review__panel');
    // No title and no choices: the submit button names the verdict, in GitHub's colour for it.
    expect(box?.querySelector('.Overlay-title, input[type="radio"]')).toBeNull();
    expect(chosen()).toBe('Approve');
    expect(submitButton()?.classList.contains('btn-primary')).toBe(true);
    expect(segment('approve').getAttribute('aria-expanded')).toBe('true');
    // Approving needs no words, so the box's Approve is the confirmation.
    expect(submitButton()?.disabled).toBe(false);
    // Another segment gives the same box the other verdict, words kept.
    const words = box?.querySelector('textarea');
    if (words instanceof HTMLTextAreaElement) {
      words.value = 'Needs a test.';
      words.dispatchEvent(new Event('input', { bubbles: true }));
    }
    segment('request changes').click();
    expect(document.querySelector('.geld-quick-review__panel')).toBe(box);
    expect(box?.querySelector('textarea')?.value).toBe('Needs a test.');
    expect(chosen()).toBe('Request changes');
    expect(submitButton()?.classList.contains('geld-quick-review__submit--danger')).toBe(true);
    expect(segment('approve').getAttribute('aria-expanded')).toBe('false');
    expect(segment('request changes').getAttribute('aria-expanded')).toBe('true');
    segment('comment').click();
    expect(chosen()).toBe('Comment');
    expect(submitButton()?.classList.contains('btn-primary')).toBe(false);
    segment('request changes').click();
    if (words instanceof HTMLTextAreaElement) {
      words.value = '';
      words.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // The same segment again closes it.
    segment('request changes').click();
    expect(document.querySelector('.geld-quick-review__panel')).toBeNull();
  });

  it('marks the group while the instant key is held, and lets go on release or blur', () => {
    mount();
    const root = document.querySelector('.geld-quick-review');
    // ⌘ on a Mac, Ctrl elsewhere: both set here, so the test holds on either platform.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: true }));
    expect(root?.hasAttribute('data-instant')).toBe(true);
    expect(segment('approve').title).toBe('Approve without comments');
    expect(segment('request changes').title).toBe('Request changes without comments');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false, ctrlKey: false }));
    expect(root?.hasAttribute('data-instant')).toBe(false);
    expect(segment('approve').title).toMatch(/^Approve\n(⌘|Ctrl) 1-click review$/);
    // The key may have gone down in another window: the pointer over the group reads it too.
    root?.dispatchEvent(new MouseEvent('pointermove', { metaKey: true, ctrlKey: true }));
    expect(root?.hasAttribute('data-instant')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(root?.hasAttribute('data-instant')).toBe(false);
    // Gone with the group: nothing listens after it is removed.
    removeQuickReview();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: true }));
    expect(root?.hasAttribute('data-instant')).toBe(false);
  });

  it('opens the box from 💬 even with the instant key held', () => {
    mount();
    segment('comment').dispatchEvent(new MouseEvent('click', instant));
    expect(chosen()).toBe('Comment');
  });

  it('approves at once on the instant click, without the box', async () => {
    const sent: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/submit_review')) {
        sent.push({ url, body: String(init?.body) });
        return new Response('{}', { status: 200 });
      }
      return new Response('{"error":"Not Found"}', { status: 404 });
    }));
    mount();
    segment('approve').dispatchEvent(new MouseEvent('click', instant));
    await settle();
    await settle();
    expect(sent).toEqual([{ url: '/acme/widgets/pull/7/page_data/submit_review', body: JSON.stringify({ body: '', event: 'approve', headSha: SHA }) }]);
    expect(document.querySelector('.geld-quick-review__panel')).toBeNull();
    expect(document.querySelector('.geld-quick-review__status')?.textContent).toBe('Approved');
    // The new verdict is the reader's standing one now: ✓ pressed, ✗ not.
    expect(segment('approve').hasAttribute('data-current')).toBe(true);
    expect(segment('request changes').hasAttribute('data-current')).toBe(false);
  });

  it('holds the approval just sent over GitHub’s lagging reads, and brings the conversation up to date without a reload', async () => {
    document.head.innerHTML = '<meta name="user-login" content="alice">';
    document.body.insertAdjacentHTML('beforeend', '<div id="partial-timeline" class="js-timeline-marker" data-url="/acme/widgets/pull/7/partials/unread_timeline?since=1"></div>');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, pathname: window.location.pathname, hash: '', search: '', href: window.location.href });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/submit_review')) return new Response('{}', { status: 200 });
      // GitHub answers from before the review for a while: no verdict in the merge box, nobody in the Reviewers block.
      if (url.includes('/page_data/merge_box')) return new Response(mergeBox('MERGEABLE', true), { status: 200 });
      if (url.includes('show_partial')) return new Response('<form id="pull-request-reviewers-form-1"></form>', { status: 200 });
      if (url.includes('unread_timeline')) return new Response('<div class="js-timeline-item" id="new-review"></div><div id="partial-timeline" class="js-timeline-marker" data-url="/acme/widgets/pull/7/partials/unread_timeline?since=2"></div>', { status: 200 });
      return new Response('{}', { status: 404 });
    }));
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    segment('approve').dispatchEvent(new MouseEvent('click', instant));
    for (let i = 0; i < 6; i += 1) await settle();
    expect(segment('approve').hasAttribute('data-current')).toBe(true);
    expect(document.querySelector('.geld-quick-review__tally')?.getAttribute('aria-label')).toBe('1 approval');
    expect(document.getElementById('new-review')).not.toBeNull();
    expect(document.querySelector('#partial-timeline')?.getAttribute('data-url')).toContain('since=2');
    expect(reload).not.toHaveBeenCalled();
  });

  it('freezes the group while a review is on its way, the pressed segment’s glyph giving way to a spinner', async () => {
    let answer: ((response: Response) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => (String(input).endsWith('/submit_review') ? new Promise<Response>((resolve) => { answer = resolve; }) : Promise.resolve(new Response('{}', { status: 404 })))));
    mount();
    segment('approve').dispatchEvent(new MouseEvent('click', instant));
    await settle();
    expect(segment('approve').hasAttribute('data-sending')).toBe(true);
    expect(segment('approve').querySelector('.geld-quick-review__glyph--sending .geld-spinner')).not.toBeNull();
    expect(segment('request changes').hasAttribute('data-sending')).toBe(false);
    expect(document.querySelector('.geld-quick-review')?.getAttribute('aria-busy')).toBe('true');
    if (answer === null) throw new Error('no request');
    const resolve: (response: Response) => void = answer;
    resolve(new Response('{}', { status: 200 }));
    await settle();
    await settle();
    expect(segment('approve').hasAttribute('data-sending')).toBe(false);
    expect(segment('approve').hasAttribute('data-current')).toBe(true);
  });

  it('opens the box with the verdict instead of sending when words wait in it', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      sent.push(String(input));
      return new Response('{}', { status: 200 });
    }));
    mount();
    segment('comment').click();
    const typed = (value: string): void => {
      const words = document.querySelector('.geld-quick-review__panel textarea');
      if (!(words instanceof HTMLTextAreaElement)) return;
      words.value = value;
      words.dispatchEvent(new Event('input', { bubbles: true }));
    };
    typed('Looks right.');
    segment('comment').click();
    segment('approve').dispatchEvent(new MouseEvent('click', instant));
    await settle();
    expect(sent.filter((url) => url.endsWith('/submit_review'))).toEqual([]);
    expect(chosen()).toBe('Approve');
    expect(document.querySelector<HTMLTextAreaElement>('.geld-quick-review__panel textarea')?.value).toBe('Looks right.');
    typed('');
    segment('approve').click();
  });

  it('asks for words with GitHub’s reason when it refuses an instant verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/submit_review') ? new Response('{"error":"Review body is required"}', { status: 422 }) : new Response('{}', { status: 404 }),
    ));
    mount();
    segment('request changes').dispatchEvent(new MouseEvent('click', instant));
    await settle();
    await settle();
    expect(chosen()).toBe('Request changes');
    expect(document.querySelector('.geld-quick-review__error')?.textContent).toBe('GitHub could not submit the review: Review body is required');
    expect(document.querySelector('.geld-quick-review__status')?.textContent).toBe('');
  });

  it('leaves the author 💬 alone, since GitHub refuses their own approval and change request', () => {
    document.head.innerHTML = '<meta name="user-login" content="bob">';
    mount();
    const group = document.querySelector('.geld-quick-review__group');
    expect([...(group?.children ?? [])].map((child) => child.getAttribute('data-event'))).toEqual(['comment']);
    segment('comment').click();
    expect(chosen()).toBe('Comment');
  });

  const mergeBox = (state: string, canClose: boolean, extra: { readonly draft?: boolean; readonly reviews?: readonly unknown[]; readonly convert?: boolean; readonly pull?: string } = {}): string =>
    JSON.stringify({
      pullRequest: { state: extra.pull ?? 'OPEN', isDraft: extra.draft ?? false, viewerCanMarkReadyForReview: extra.draft ?? false, viewerCanConvertToDraft: extra.convert ?? false, latestOpinionatedReviews: extra.reviews ?? [], viewerCanClose: canClose, viewerCanAdminBypassMergeRequirements: false, viewerMergeActions: [{ name: 'DIRECT_MERGE', allowableStatus: 'ALLOWED', mergeMethods: [{ name: 'SQUASH', allowableStatus: 'ALLOWED', isDefault: true }] }] },
      mergeRequirements: { state, conditions: [], commitMessageHeadline: 'Title (#7)', commitMessageBody: '' },
    });
  /** GitHub's status label in the header, as React's StateLabel renders it. */
  const withLabel = (words: string, status: string): HTMLElement => {
    document.querySelector('[data-component="PageHeader"]')?.insertAdjacentHTML('afterbegin', `<span class="prc-StateLabel-x" data-component="StateLabel" data-size="medium" data-status="${status}"><svg></svg>${words}</span>`);
    const label = document.querySelector<HTMLElement>('[data-component="StateLabel"]');
    if (label === null) throw new Error('fixture');
    return label;
  };
  const pill = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('button[data-geld-status-pill]');
  const menuRows = (): string[][] =>
    [...document.querySelectorAll('.geld-quick-review__status-menu .geld-quick-review__menu-item')].map((item) => [item.getAttribute('data-status') ?? '', item.querySelector('.geld-quick-review__menu-label')?.textContent ?? '']);
  const stubBox = (box: () => string, sent: string[] = []): string[] => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/page_data/merge_box')) return new Response(box(), { status: 200 });
        if (init?.method === 'POST') {
          sent.push(url.replace(/^.*\/page_data\//, ''));
          return new Response(url.includes('convert_to_draft') ? '{"error":"Not allowed"}' : '{}', { status: url.includes('convert_to_draft') ? 422 : 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    return sent;
  };

  const stubStacked = (stack: string | null): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/page_data/stacks')) return stack === null ? new Response('{}', { status: 500 }) : new Response(stack, { status: 200 });
        if (!url.includes('/page_data/merge_box')) return new Response('{}', { status: 404 });
        const payload: unknown = JSON.parse(mergeBox('MERGEABLE', true));
        const requirements: unknown = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'mergeRequirements') : null;
        if (typeof requirements !== 'object' || requirements === null) throw new Error('fixture');
        Reflect.set(requirements, 'conditions', [{ type: 'STACK', result: 'PASSED', isStacked: true }]);
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
  };

  it('says a stacked pull request merges the stack below it too', async () => {
    window.localStorage.clear();
    resetStatusHints();
    stubStacked(JSON.stringify({ stack: { pulls: [{ number: 7, title: 'Title', state: 'OPEN', url: '/acme/widgets/pull/7' }] } }));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="merged"]')?.click();
    expect(document.querySelector<HTMLElement>('.geld-quick-review__stack-note')?.hidden).toBe(false);
  });

  it('offers a stacked pull request no merge while its stack cannot be read, since the merge takes every one below it', async () => {
    window.localStorage.clear();
    resetStatusHints();
    stubStacked(null);
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(menuRows()).toEqual([['closed', 'Close pull request']]);
  });



  it('lists an admin’s bypass beside the merge queue, badged, opening the merge box with GitHub’s bypass checkbox', async () => {
    window.localStorage.clear();
    resetStatusHints();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes('/page_data/merge_box')) return new Response('{}', { status: 404 });
        const past = url.includes('bypass_requirements=true');
        const payload = JSON.parse(mergeBox(past ? 'MERGEABLE' : 'BLOCKED', true));
        payload.pullRequest.viewerCanAdminBypassMergeRequirements = true;
        payload.pullRequest.viewerMergeActions.push({ name: 'MERGE_QUEUE', allowableStatus: 'ALLOWED', mergeMethods: [{ name: 'GROUP', allowableStatus: 'ALLOWED', isDefault: true }] });
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(menuRows()).toEqual([
      ['queued', 'Merge when ready'],
      ['merged', 'Bypass rules and merge'],
      ['closed', 'Close pull request'],
    ]);
    expect(document.querySelector('.geld-quick-review__status-menu [data-status="queued"] .geld-quick-review__menu-badge')).toBeNull();
    expect(document.querySelector('.geld-quick-review__status-menu [data-status="merged"] .geld-quick-review__menu-visual[data-bypass] > .geld-quick-review__menu-badge svg')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="merged"]')?.click();
    expect(document.querySelector<HTMLElement>('.geld-quick-review__bypass')?.hidden).toBe(false);
  });

  it('groups a stack’s menu by type, each opening its choices beside it, and confirms one that changes several', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const posts: string[] = [];
    let refuse: string | null = null;
    const closed = new Set<string>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push(url);
          if (refuse !== null && url.includes(refuse)) return new Response('{"error":"Not allowed"}', { status: 422 });
          closed.add(url.replace(/\/page_data\/.*$/, ''));
          return new Response('{}', { status: 200 });
        }
        if (url.endsWith('/page_data/stacks')) {
          return new Response(JSON.stringify({ stack: { pulls: [9, 7, 5].map((number) => ({ number, title: `PR ${number}`, state: 'OPEN', url: `/acme/widgets/pull/${number}` })) } }), { status: 200 });
        }
        if (url.includes('/page_data/merge_box')) {
          const shut = closed.has(url.replace(/\/page_data\/.*$/, ''));
          const payload: unknown = JSON.parse(mergeBox('BLOCKED', true, shut ? { pull: 'CLOSED' } : { convert: true }));
          const requirements: unknown = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'mergeRequirements') : null;
          if (typeof requirements !== 'object' || requirements === null) throw new Error('fixture');
          Reflect.set(requirements, 'conditions', [{ type: 'STACK', result: 'PASSED', isStacked: true }]);
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, pathname: window.location.pathname, hash: '', search: '' });
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 6; i += 1) await settle();
    pill()?.click();
    // None of them would merge now: no merge type, and each type is a parent, not a choice.
    expect(menuRows()).toEqual([
      ['draft', 'Convert to draft'],
      ['closed', 'Close'],
    ]);
    const close = document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-action="close"]');
    expect(close?.getAttribute('aria-haspopup')).toBe('menu');
    close?.click();
    expect(close?.getAttribute('aria-expanded')).toBe('true');
    const choices = (): string[] => [...document.querySelectorAll('.geld-quick-review__status-submenu .geld-quick-review__menu-label')].map((label) => label.textContent ?? '');
    expect(choices()).toEqual(['This pull request', 'This and 1 below', 'Entire stack (3)']);
    expect(document.activeElement?.textContent).toBe('This pull request');
    // Back out with the arrow toward the parent, which keeps focus.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.querySelector('.geld-quick-review__status-submenu')).toBeNull();
    expect(document.activeElement).toBe(close);
    // Declined, nothing is sent.
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    close?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-submenu [data-scope="stack"]')?.click();
    expect(confirm).toHaveBeenCalledWith('Close the entire stack of 3 pull requests (#9, #7 and #5)?');
    await settle();
    expect(posts).toEqual([]);
    // Refused partway: GitHub's reason for the one it refused, and nothing reloads.
    confirm.mockReturnValue(true);
    refuse = '/pull/7/';
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-action="close"]')?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-submenu [data-scope="stack"]')?.click();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(posts).toEqual(['/acme/widgets/pull/9/page_data/close_pull_request', '/acme/widgets/pull/7/page_data/close_pull_request']);
    expect(document.querySelector('.geld-quick-review__panel .geld-quick-review__error')?.textContent).toBe('#7: GitHub could not close the pull request: Not allowed');
    expect(reload).not.toHaveBeenCalled();
    // The menu was read again: #9 is closed now, so the entire stack can no longer be closed, this and the one below can.
    document.querySelector<HTMLButtonElement>('.geld-quick-review__panel .btn.btn-invisible')?.click();
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-action="close"]')?.click();
    expect(choices()).toEqual(['This pull request', 'This and 1 below']);
    // Refused at the second of two, then tried again: only what was left goes out, and the page reloads.
    refuse = '/pull/5/';
    posts.length = 0;
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-submenu [data-scope="below"]')?.click();
    expect(confirm).toHaveBeenLastCalledWith('Close 2 pull requests (#7 and #5)?');
    for (let i = 0; i < 4; i += 1) await settle();
    expect(posts).toEqual(['/acme/widgets/pull/7/page_data/close_pull_request', '/acme/widgets/pull/5/page_data/close_pull_request']);
    expect(document.querySelector('.geld-quick-review__panel .geld-quick-review__confirm-submit')?.textContent).toBe('Close pull request');
    refuse = null;
    posts.length = 0;
    document.querySelector<HTMLButtonElement>('.geld-quick-review__panel .geld-quick-review__confirm-submit')?.click();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(posts).toEqual(['/acme/widgets/pull/5/page_data/close_pull_request']);
    expect(reload).toHaveBeenCalled();
  });

  it('completes nothing and reloads nothing when a change comes back after the reader moved to another pull request', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const where = { ...window.location, reload: vi.fn(), pathname: window.location.pathname, hash: '', search: '' };
    vi.stubGlobal('location', where);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          where.pathname = '/acme/widgets/pull/8';
          return new Response('{}', { status: 200 });
        }
        if (url.includes('/page_data/merge_box')) return new Response(mergeBox('BLOCKED', true), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );
    vi.stubGlobal('confirm', vi.fn(() => true));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="closed"]')?.click();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(where.reload).not.toHaveBeenCalled();
    where.pathname = '/acme/widgets/pull/7';
  });

  it('stops a stack’s changes, and reloads nothing, once the reader has left the pull request they began on', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const posts: string[] = [];
    const where = { ...window.location, reload: vi.fn(), pathname: window.location.pathname, hash: '', search: '' };
    vi.stubGlobal('location', where);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push(url);
          // The reader moves on to another pull request while the first change is out.
          where.pathname = '/acme/widgets/pull/8';
          return new Response('{}', { status: 200 });
        }
        if (url.endsWith('/page_data/stacks')) {
          return new Response(JSON.stringify({ stack: { pulls: [9, 7, 5].map((number) => ({ number, title: `PR ${number}`, state: 'OPEN', url: `/acme/widgets/pull/${number}` })) } }), { status: 200 });
        }
        if (url.includes('/page_data/merge_box')) {
          const payload: unknown = JSON.parse(mergeBox('BLOCKED', true, { convert: true }));
          const requirements: unknown = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'mergeRequirements') : null;
          if (typeof requirements !== 'object' || requirements === null) throw new Error('fixture');
          Reflect.set(requirements, 'conditions', [{ type: 'STACK', result: 'PASSED', isStacked: true }]);
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    vi.stubGlobal('confirm', vi.fn(() => true));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 6; i += 1) await settle();
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-action="close"]')?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-submenu [data-scope="stack"]')?.click();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(posts).toEqual(['/acme/widgets/pull/9/page_data/close_pull_request']);
    expect(where.reload).not.toHaveBeenCalled();
    where.pathname = '/acme/widgets/pull/7';
  });

  it('confirms a merge only with the chosen method’s commit, whatever order GitHub answers in', async () => {
    const held: { [method: string]: (() => void) | undefined } = {};
    const slow = new Set<string>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes('/page_data/merge_box')) return new Response('{}', { status: 404 });
        const method = /merge_method=([A-Z]+)/.exec(url)?.[1] ?? 'SQUASH';
        const payload = JSON.parse(mergeBox('MERGEABLE', true));
        payload.pullRequest.viewerMergeActions[0].mergeMethods = [
          { name: 'SQUASH', allowableStatus: 'ALLOWED', isDefault: true },
          { name: 'MERGE', allowableStatus: 'ALLOWED', isDefault: false },
        ];
        payload.mergeRequirements.commitMessageHeadline = method === 'MERGE' ? 'Merge pull request #7 from acme/topic' : 'Title (#7)';
        if (slow.has(method)) {
          await new Promise<void>((resolve) => {
            held[method] = resolve;
          });
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
    window.localStorage.clear();
    resetStatusHints();
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    // Both reads the box makes from here on are slow.
    slow.add('SQUASH');
    slow.add('MERGE');
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="merged"]')?.click();
    const select = document.querySelector<HTMLSelectElement>('.geld-quick-review__method');
    const title = document.querySelector<HTMLInputElement>('.geld-quick-review__commit-title');
    const submit = document.querySelector<HTMLButtonElement>('.geld-quick-review__panel .geld-quick-review__submit');
    if (select === null || title === null || submit === null) throw new Error('no merge box');
    expect(title.value).toBe('Title (#7)');
    expect(submit.disabled).toBe(false);
    select.value = 'MERGE';
    select.dispatchEvent(new Event('change'));
    // The squash commit is not this method's: nothing to confirm until the merge commit comes.
    expect(title.value).toBe('');
    expect(submit.disabled).toBe(true);
    held.MERGE?.();
    for (let i = 0; i < 3; i += 1) await settle();
    expect(title.value).toBe('Merge pull request #7 from acme/topic');
    expect(submit.disabled).toBe(false);
    // The read made as the box opened (the squash commit) lands last and changes nothing.
    held.SQUASH?.();
    for (let i = 0; i < 3; i += 1) await settle();
    expect(title.value).toBe('Merge pull request #7 from acme/topic');
  });

  it('leaves the commit to the reader when the chosen method’s commit could not be read', async () => {
    let failMerge = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes('/page_data/merge_box')) return new Response('{}', { status: 404 });
        const method = /merge_method=([A-Z]+)/.exec(url)?.[1] ?? 'SQUASH';
        if (method === 'MERGE' && failMerge) return new Response('{}', { status: 500 });
        const payload = JSON.parse(mergeBox('MERGEABLE', true));
        payload.pullRequest.viewerMergeActions[0].mergeMethods = [
          { name: 'SQUASH', allowableStatus: 'ALLOWED', isDefault: true },
          { name: 'MERGE', allowableStatus: 'ALLOWED', isDefault: false },
        ];
        payload.mergeRequirements.commitMessageHeadline = 'Title (#7)';
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    failMerge = true;
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="merged"]')?.click();
    for (let i = 0; i < 3; i += 1) await settle();
    const select = document.querySelector<HTMLSelectElement>('.geld-quick-review__method');
    const title = document.querySelector<HTMLInputElement>('.geld-quick-review__commit-title');
    if (select === null || title === null) throw new Error('no merge box');
    expect(title.value).toBe('Title (#7)');
    select.value = 'MERGE';
    select.dispatchEvent(new Event('change'));
    for (let i = 0; i < 3; i += 1) await settle();
    // The squash commit stays out of a merge commit's fields.
    expect(title.value).toBe('');
  });

  it('opens the status menu with a line that says why when there is nothing to offer', async () => {
    window.localStorage.clear();
    resetStatusHints();
    // An earlier visit could change this repository's status, so the pill is a menu at once; every read of the merge box
    // fails (GitHub busy), and the menu still opens, says it is loading, then that it could not.
    rememberStatusHint('acme/widgets', true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(document.querySelector('.geld-quick-review__status-menu')).not.toBeNull();
    expect(document.querySelector('.geld-quick-review__menu-empty')?.textContent).toBe('Loading options…');
    // The menu holds focus itself, having no control to give it to, so Escape reaches it.
    expect(document.activeElement).toBe(document.querySelector('.geld-quick-review__status-menu'));
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review__menu-empty')?.textContent).toBe('The options could not be read. Try again shortly.');
    pill()?.click();
    expect(document.querySelector('.geld-quick-review__status-menu')).toBeNull();
    // The merge box answers while the menu is open, offering this reader nothing: the menu says so.
    stubBox(() =>
      JSON.stringify({
        pullRequest: { state: 'OPEN', isDraft: false, viewerCanMarkReadyForReview: false, viewerCanConvertToDraft: false, latestOpinionatedReviews: [], viewerCanClose: false, viewerCanAdminBypassMergeRequirements: false, viewerMergeActions: [] },
        mergeRequirements: { state: 'BLOCKED', conditions: [], commitMessageHeadline: 'Title (#7)', commitMessageBody: '' },
      }),
    );
    pill()?.click();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review__menu-empty')?.textContent).toBe('No options available');
    expect(document.querySelector('.geld-quick-review__status-menu button')).toBeNull();
    // Closed with Escape, the pill steps aside for GitHub's own label (this reader has nothing to switch to here), and
    // the keyboard lands on the review group rather than on a button that has left the page.
    document.querySelector('.geld-quick-review__status-menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.geld-quick-review__status-menu')).toBeNull();
    expect(pill()?.hasAttribute('aria-haspopup') ?? false).toBe(false);
    expect(document.activeElement?.closest('.geld-quick-review__group')).not.toBeNull();
  });

  it('gives Escape’s focus to the control after the status label where the review group has no place', async () => {
    window.localStorage.clear();
    resetStatusHints();
    rememberStatusHint('acme/widgets', true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    const label = withLabel('Open', 'pullOpened');
    label.insertAdjacentHTML('afterend', '<a href="/rexdotsh" class="author">rexdotsh</a>');
    // Narrow: GitHub hides the counts, so the review group is not on the page, while the pill still works.
    counts().style.display = 'none';
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review')).toBeNull();
    stubBox(() =>
      JSON.stringify({
        pullRequest: { state: 'OPEN', isDraft: false, viewerCanMarkReadyForReview: false, viewerCanConvertToDraft: false, latestOpinionatedReviews: [], viewerCanClose: false, viewerCanAdminBypassMergeRequirements: false, viewerMergeActions: [] },
        mergeRequirements: { state: 'BLOCKED', conditions: [], commitMessageHeadline: 'Title (#7)', commitMessageBody: '' },
      }),
    );
    pill()?.click();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review__menu-empty')?.textContent).toBe('No options available');
    document.querySelector('.geld-quick-review__status-menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pill()?.hasAttribute('aria-haspopup') ?? false).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('a.author'));
  });

  it('shows options that a later read finds while the menu says there are none', async () => {
    window.localStorage.clear();
    resetStatusHints();
    rememberStatusHint('acme/widgets', true);
    let offer = false;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    stubBox(() =>
      offer
        ? mergeBox('MERGEABLE', true)
        : JSON.stringify({
            pullRequest: { state: 'OPEN', isDraft: false, viewerCanMarkReadyForReview: false, viewerCanConvertToDraft: false, latestOpinionatedReviews: [], viewerCanClose: false, viewerCanAdminBypassMergeRequirements: false, viewerMergeActions: [] },
            mergeRequirements: { state: 'BLOCKED', conditions: [], commitMessageHeadline: 'Title (#7)', commitMessageBody: '' },
          }),
    );
    pill()?.click();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review__menu-empty')?.textContent).toBe('No options available');
    // A check lands and the reader may now merge: the next read (here, the tab shown again) fills the open menu.
    offer = true;
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 4; i += 1) await settle();
    expect(menuRows()).toEqual([
      ['merged', 'Squash and merge'],
      ['closed', 'Close pull request'],
    ]);
  });

  it('shows the options when the newest read lands, even after an older read finished first', async () => {
    window.localStorage.clear();
    resetStatusHints();
    rememberStatusHint('acme/widgets', true);
    const answers: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input).includes('/page_data/merge_box') && answers.length > 0 ? new Promise<Response>((resolve) => answers.push(resolve)) : new Response('busy', { status: 503 }))));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    answers.push(() => undefined);
    pill()?.click();
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 2; i += 1) await settle();
    const [, older, newer] = answers;
    if (older === undefined || newer === undefined) throw new Error('two reads expected');
    older(new Response(mergeBox('MERGEABLE', true), { status: 200 }));
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review__menu-empty')?.textContent).toBe('Loading options…');
    newer(new Response(mergeBox('MERGEABLE', true), { status: 200 }));
    for (let i = 0; i < 4; i += 1) await settle();
    expect(menuRows()).toEqual([
      ['merged', 'Squash and merge'],
      ['closed', 'Close pull request'],
    ]);
  });

  it('takes the pill away with the controls even while its menu is on the loading line', async () => {
    window.localStorage.clear();
    resetStatusHints();
    rememberStatusHint('acme/widgets', true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    const label = withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(document.querySelector('.geld-quick-review__menu-empty')).not.toBeNull();
    removeQuickReview();
    expect(pill()).toBeNull();
    expect(label.hasAttribute('data-geld-status-hidden')).toBe(false);
  });

  it('turns the header’s status pill into a menu of the statuses the reader may switch to, closed last', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const sent = stubBox(() => mergeBox('MERGEABLE', true, { convert: true }));
    const label = withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    // GitHub's label stays, hidden; Geld's pill stands beside it in the label's own classes and status, with a caret.
    expect(label.hasAttribute('data-geld-status-hidden')).toBe(true);
    expect(label.nextElementSibling).toBe(pill());
    expect(pill()?.classList.contains('prc-StateLabel-x')).toBe(true);
    expect(pill()?.getAttribute('data-status')).toBe('pullOpened');
    expect(pill()?.querySelector('.geld-status-pill__label')?.textContent).toBe('Open');
    expect(pill()?.querySelector('.geld-status-pill__caret')).not.toBeNull();
    expect(document.querySelector('.geld-quick-review__actions-group')).toBeNull();
    pill()?.click();
    expect(menuRows()).toEqual([
      ['merged', 'Squash and merge'],
      ['draft', 'Convert to draft'],
      ['closed', 'Close pull request'],
    ]);
    // Merged opens the merge box on GitHub's commit for its default method, under the pill.
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="merged"]')?.click();
    expect(document.querySelector('.geld-quick-review__status-menu')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('.geld-quick-review__commit-title')?.value).toBe('Title (#7)');
    expect(document.querySelector('.geld-quick-review__panel .geld-quick-review__submit')?.textContent).toBe('Confirm squash and merge');
    // Closing asks the browser's own confirmation first, then closes at once.
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="closed"]')?.click();
    expect(confirm).toHaveBeenCalledWith('Close this pull request?');
    await settle();
    expect(sent).toEqual([]);
    // Declined, the reader carries on from the pill: the menu item that had focus is gone.
    expect(document.activeElement).toBe(pill());
    confirm.mockReturnValue(true);
    vi.stubGlobal('location', { ...window.location, reload: vi.fn(), pathname: window.location.pathname, hash: '', search: '' });
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="closed"]')?.click();
    await settle();
    expect(sent).toEqual(['close_pull_request']);
    expect(document.querySelector('.geld-quick-review__panel')).toBeNull();
  });

  it('shows Open, not “Ready for review”, on a draft, and marks it ready at once; a refusal opens the box with GitHub’s reason', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const sent = stubBox(() => mergeBox('UNMERGEABLE', true, { draft: true, reviews: [{ author: { login: 'alice' }, state: 'APPROVED' }] }));
    withLabel('Draft', 'draft');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(segment('approve').hasAttribute('data-current')).toBe(true);
    expect(segment('approve').getAttribute('aria-label')).toBe('Approve (your current review)');
    pill()?.click();
    expect(menuRows()).toEqual([
      ['open', 'Ready for review'],
      ['closed', 'Close pull request'],
    ]);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, pathname: window.location.pathname, hash: '', search: '' });
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="open"]')?.click();
    await settle();
    expect(sent).toEqual(['mark_ready_for_review']);
  });

  it('unpresses the last pull request’s verdict when the controls move to another whose merge box cannot be read', async () => {
    window.localStorage.clear();
    resetStatusHints();
    stubBox(() => mergeBox('MERGEABLE', true, { reviews: [{ author: { login: 'alice' }, state: 'APPROVED' }] }));
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(segment('approve').hasAttribute('data-current')).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    window.history.replaceState(null, '', '/acme/widgets/pull/8');
    applyQuickReview(true, { page: { kind: 'pull-conversation', diffUrl: null, stateKey: '/acme/widgets/pull/8' }, groups: [groupAt(counts())], headSha: () => SHA });
    for (let i = 0; i < 4; i += 1) await settle();
    expect(segment('approve').hasAttribute('data-current')).toBe(false);
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
  });

  it('reopens a closed pull request, and leaves a merged one’s pill as GitHub drew it', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const sent = stubBox(() => mergeBox('UNMERGEABLE', true, { pull: 'CLOSED' }));
    withLabel('Closed', 'pullClosed');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(menuRows()).toEqual([
      ['open', 'Reopen pull request'],
    ]);
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="open"]')?.click();
    await settle();
    expect(sent).toEqual(['reopen_pull_request']);
    removeQuickReview();
    expect(pill()).toBeNull();
    expect(document.querySelector('[data-component="StateLabel"]')?.hasAttribute('data-geld-status-hidden')).toBe(false);
  });

  it('keeps GitHub’s own pill where there is nothing to switch to, a merged pull request', async () => {
    window.localStorage.clear();
    resetStatusHints();
    stubBox(() => mergeBox('UNMERGEABLE', false, { pull: 'MERGED' }));
    const merged = withLabel('Merged', 'pullMerged');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(pill()).toBeNull();
    expect(merged.hasAttribute('data-geld-status-hidden')).toBe(false);
    // Nothing is learnt about the reader's rights in this repository from a merged pull request.
    expect(window.localStorage.getItem('geld:status-menu')).toBeNull();
  });

  it('offers a merge queue’s Merge when ready where a merge would stand, and queues after the browser’s confirmation', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const queueBox = JSON.stringify({
      pullRequest: {
        state: 'OPEN',
        isDraft: false,
        isInMergeQueue: false,
        viewerCanClose: true,
        viewerCanConvertToDraft: false,
        viewerCanMarkReadyForReview: false,
        latestOpinionatedReviews: [],
        viewerCanAdminBypassMergeRequirements: false,
        viewerMergeActions: [
          { name: 'MERGE_QUEUE', allowableStatus: 'ALLOWED', mergeMethods: [{ name: 'MERGE', allowableStatus: 'ALLOWED', isDefault: true }] },
          { name: 'DIRECT_MERGE', allowableStatus: 'BLOCKED', mergeMethods: [{ name: 'SQUASH', allowableStatus: 'BLOCKED', isDefault: true }] },
        ],
      },
      mergeRequirements: { state: 'BLOCKED', conditions: [], commitMessageHeadline: '', commitMessageBody: '' },
    });
    const sent = stubBox(() => queueBox);
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(menuRows()).toEqual([
      ['queued', 'Merge when ready'],
      ['closed', 'Close pull request'],
    ]);
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, pathname: window.location.pathname, hash: '', search: '' });
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="queued"]')?.click();
    expect(confirm).toHaveBeenCalledWith('Add this pull request to the merge queue?');
    for (let i = 0; i < 3; i += 1) await settle();
    expect(sent).toEqual(['enable_auto_merge']);
    // The header stays as it was: nothing reloads, GitHub's merge box and timeline update themselves.
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelector('.geld-quick-review__status')?.textContent).toBe('Added to the merge queue');
  });

  it('ends a slow Merge when ready once the merge box shows the pull request queued, without waiting on GitHub’s answer', async () => {
    window.localStorage.clear();
    resetStatusHints();
    let queued = false;
    const queueBox = (): string =>
      JSON.stringify({
        pullRequest: {
          state: 'OPEN',
          isDraft: false,
          isInMergeQueue: queued,
          viewerCanClose: true,
          latestOpinionatedReviews: [],
          viewerMergeActions: [{ name: 'MERGE_QUEUE', allowableStatus: 'ALLOWED', mergeMethods: [{ name: 'MERGE', allowableStatus: 'ALLOWED', isDefault: true }] }],
        },
        mergeRequirements: { state: 'BLOCKED', conditions: [], commitMessageHeadline: '', commitMessageBody: '' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/page_data/merge_box')) return new Response(queueBox(), { status: 200 });
        if (init?.method === 'POST') {
          queued = true;
          return new Promise<Response>(() => undefined);
        }
        return new Response('{}', { status: 404 });
      }),
    );
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('location', { ...window.location, reload: vi.fn(), pathname: window.location.pathname, hash: '', search: '' });
    vi.useFakeTimers();
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="queued"]')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.geld-quick-review__root, .geld-quick-review')?.getAttribute('aria-busy')).toBe('true');
    await vi.advanceTimersByTimeAsync(3100);
    expect(document.querySelector('.geld-quick-review__status')?.textContent).toBe('Added to the merge queue');
    expect(document.querySelector('.geld-quick-review__root, .geld-quick-review')?.hasAttribute('aria-busy')).toBe(false);
    vi.useRealTimers();
  });

  it('stops reading the merge box for a slow Merge when ready once the controls are gone', async () => {
    window.localStorage.clear();
    resetStatusHints();
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/page_data/merge_box')) {
          reads += 1;
          return new Response(
            JSON.stringify({
              pullRequest: { state: 'OPEN', isDraft: false, isInMergeQueue: false, viewerCanClose: true, latestOpinionatedReviews: [], viewerMergeActions: [{ name: 'MERGE_QUEUE', allowableStatus: 'ALLOWED', mergeMethods: [] }] },
              mergeRequirements: { state: 'BLOCKED', conditions: [] },
            }),
            { status: 200 },
          );
        }
        if (init?.method === 'POST') return new Promise<Response>(() => undefined);
        return new Response('{}', { status: 404 });
      }),
    );
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('location', { ...window.location, reload: vi.fn(), pathname: window.location.pathname, hash: '', search: '' });
    vi.useFakeTimers();
    pill()?.click();
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="queued"]')?.click();
    await vi.advanceTimersByTimeAsync(3100);
    const polled = reads;
    removeQuickReview();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toBe(polled);
    vi.useRealTimers();
  });

  it('opens GitHub’s reason when converting to a draft is refused', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const sent = stubBox(() => mergeBox('BLOCKED', false, { convert: true }));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(menuRows().map((row) => row[0])).toEqual(['draft']);
    document.querySelector<HTMLButtonElement>('.geld-quick-review__status-menu [data-status="draft"]')?.click();
    await settle();
    await settle();
    expect(sent).toEqual(['convert_to_draft']);
    expect(document.querySelector('.geld-quick-review__panel .geld-quick-review__error')?.textContent).toBe('GitHub could not convert the pull request to a draft: Not allowed');
  });

  it('is a 1-click merge while ⌘ (Ctrl) is held on an approved pull request, and turns Merged when it goes through', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const posts: { url: string; body: string }[] = [];
    let answer = 200;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/page_data/merge_box')) return new Response(mergeBox('MERGEABLE', true, { reviews: [{ author: { login: 'ann' }, state: 'APPROVED' }] }), { status: 200 });
        if (init?.method === 'POST') {
          posts.push({ url: url.replace(/^.*\/page_data\//, ''), body: String(init.body) });
          return new Response(answer === 200 ? '{"status":"merged"}' : '{"error":"Required status check is failing"}', { status: answer });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, pathname: window.location.pathname, hash: '', search: '' });
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: true }));
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(true);
    expect(pill()?.getAttribute('aria-label')).toBe('Merge now: Squash and merge');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(false);
    // Refused: the merge box opens under the pill with GitHub's reason.
    answer = 405;
    pill()?.dispatchEvent(new MouseEvent('click', instant));
    for (let i = 0; i < 3; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review__panel .geld-quick-review__error')?.textContent).toBe('GitHub could not merge the pull request: Required status check is failing');
    // Through: GitHub's default method and commit, then GitHub's merged pill until the page reloads.
    answer = 200;
    posts.length = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: true }));
    expect(pill()?.getAttribute('aria-label')).toBe('Merge now: Squash and merge');
    pill()?.dispatchEvent(new MouseEvent('click', instant));
    for (let i = 0; i < 3; i += 1) await settle();
    expect(posts).toEqual([{ url: 'merge', body: JSON.stringify({ bypassBranchProtections: false, mergeMethod: 'SQUASH', commitTitle: 'Title (#7)', commitMessage: '' }) }]);
    expect(pill()?.getAttribute('data-status')).toBe('pullMerged');
    expect(pill()?.querySelector('.geld-status-pill__label')?.textContent).toBe('Merged');
    expect(pill()?.hasAttribute('aria-haspopup')).toBe(false);
    expect(pill()?.hasAttribute('aria-label')).toBe(false);
    expect(reload).toHaveBeenCalled();
    // A pass before the reload, the key still held, leaves it merged: no Merge face, no "Merge now" name.
    reassertStatusPills();
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(false);
    expect(pill()?.hasAttribute('aria-label')).toBe(false);
    expect(pill()?.querySelector('.geld-status-pill__label')?.textContent).toBe('Merged');
  });

  it('reads GitHub again before a 1-click merge, and merges nothing when the approval was dismissed meanwhile', async () => {
    window.localStorage.clear();
    resetStatusHints();
    let approved = true;
    const sent = stubBox(() => mergeBox('MERGEABLE', true, { reviews: approved ? [{ author: { login: 'ann' }, state: 'APPROVED' }] : [] }));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: true }));
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(true);
    // Dismissed since the last read, which still showed the approval.
    approved = false;
    pill()?.dispatchEvent(new MouseEvent('click', instant));
    for (let i = 0; i < 4; i += 1) await settle();
    expect(sent).toEqual([]);
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(false);
    expect(menuRows().map((row) => row[0])).toEqual(['merged', 'closed']);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
  });

  it('has no 1-click merge without an approval: ⌘-click opens the menu', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const sent = stubBox(() => mergeBox('MERGEABLE', true));
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: true }));
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(false);
    pill()?.dispatchEvent(new MouseEvent('click', instant));
    await settle();
    expect(sent).toEqual([]);
    expect(menuRows().map((row) => row[0])).toEqual(['merged', 'closed']);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
  });

  it('has no 1-click merge in a stack, which would merge the pull requests below it too', async () => {
    window.localStorage.clear();
    resetStatusHints();
    const sent = stubBox(() => {
      const payload = JSON.parse(mergeBox('MERGEABLE', true, { reviews: [{ author: { login: 'alice' }, state: 'APPROVED' }] }));
      payload.mergeRequirements.conditions = [{ type: 'STACK', result: 'PASSED', isStacked: true }];
      return JSON.stringify(payload);
    });
    withLabel('Open', 'pullOpened');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, ctrlKey: true }));
    expect(pill()?.hasAttribute('data-geld-instant-merge')).toBe(false);
    pill()?.dispatchEvent(new MouseEvent('click', instant));
    await settle();
    expect(sent).toEqual([]);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
  });

  it('keeps the status pill working where the review group stands aside, and takes it away when switched off', async () => {
    window.localStorage.clear();
    resetStatusHints();
    stubBox(() => mergeBox('MERGEABLE', true));
    withLabel('Open', 'pullOpened');
    // Narrow: GitHub hides the counts, so the review group is not placed and GitHub's own button shows.
    counts().style.display = 'none';
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector('.geld-quick-review')).toBeNull();
    expect(document.documentElement.hasAttribute('data-geld-quick-review')).toBe(false);
    pill()?.click();
    expect(menuRows().map((row) => row[0])).toEqual(['merged', 'closed']);
    // Focus leaving the menu (Tab) closes it.
    document.querySelector('.geld-quick-review__status-menu')?.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body }));
    expect(document.querySelector('.geld-quick-review__status-menu')).toBeNull();
    applyQuickReview(false, { page, groups: [groupAt(counts())], headSha: () => SHA });
    expect(pill()).toBeNull();
    expect(document.querySelector('[data-component="StateLabel"]')?.hasAttribute('data-geld-status-hidden')).toBe(false);
  });

  it('swaps the pill from the first paint where the reader could change the status last time in this repository', async () => {
    window.localStorage.clear();
    resetStatusHints();
    window.localStorage.setItem('geld:status-menu', JSON.stringify({ 'acme/widgets': true }));
    stubBox(() => mergeBox('MERGEABLE', true));
    withLabel('Open', 'pullOpened');
    mount();
    // Before the merge box answers.
    expect(pill()).not.toBeNull();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(pill()).not.toBeNull();
  });

  it('reads the merge box again when the header’s state changes in place, as a draft marked ready does', async () => {
    window.localStorage.clear();
    resetStatusHints();
    let draft = true;
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).includes('/page_data/merge_box')) return new Response('{}', { status: 404 });
        reads += 1;
        return new Response(mergeBox(draft ? 'UNMERGEABLE' : 'MERGEABLE', true, { draft }), { status: 200 });
      }),
    );
    const label = withLabel('Draft', 'draft');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    pill()?.click();
    expect(menuRows().map((row) => row[0])).toEqual(['open', 'closed']);
    pill()?.click();
    const afterLoad = reads;
    // A pass with nothing changed reads nothing.
    mount();
    expect(reads).toBe(afterLoad);
    // GitHub's live update: the pull request is ready for review, and the label says so.
    draft = false;
    label.setAttribute('data-status', 'pullOpened');
    label.lastChild?.replaceWith('Open');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(reads).toBeGreaterThan(afterLoad);
    expect(pill()?.querySelector('.geld-status-pill__label')?.textContent).toBe('Open');
    pill()?.click();
    expect(menuRows().map((row) => row[0])).toEqual(['merged', 'closed']);
  });

  it('keeps the newest reading when an older read of the merge box answers last', async () => {
    let draft = true;
    const gate: { release: (() => void) | null } = { release: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).includes('/page_data/merge_box')) return new Response('{}', { status: 404 });
        const answer = new Response(mergeBox(draft ? 'UNMERGEABLE' : 'MERGEABLE', true, { draft }), { status: 200 });
        // The first read (still a draft) is slow, and answers only after the second.
        if (gate.release === null && draft) {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
        }
        return answer;
      }),
    );
    window.localStorage.clear();
    resetStatusHints();
    const label = withLabel('Draft', 'draft');
    const statuses = (): string[] => {
      pill()?.click();
      const rows = menuRows().map((row) => row[0] ?? '');
      pill()?.click();
      return rows;
    };
    mount();
    await settle();
    draft = false;
    label.setAttribute('data-status', 'pullOpened');
    label.lastChild?.replaceWith('Open');
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(statuses()).toEqual(['merged', 'closed']);
    if (gate.release === null) throw new Error('the first read was not held');
    gate.release();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(statuses()).toEqual(['merged', 'closed']);
  });

  it('tallies the standing reviews from the Reviewers block, left of the group', async () => {
    const row = (login: string, words: string): string => `<p><span data-assignee-name="${login}"><img src="/a.png"></span><span class="reviewers-status-icon" aria-label="${words}"></span></p>`;
    const partial = `<form id="pull-request-reviewers-form-1">${row('ann', 'ann approved these changes')}${row('ben', 'ben approved these changes')}${row('cy', 'cy requested changes')}${row('dee', 'dee left review comments')}</form>`;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input).includes('show_partial') ? new Response(partial, { status: 200 }) : new Response('{}', { status: 404 }))));
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    const tally = document.querySelector<HTMLElement>('.geld-quick-review__tally');
    expect(tally?.hidden).toBe(false);
    expect([...(tally?.children ?? [])].map((part) => part.textContent)).toEqual(['2', '1', '1']);
    expect(tally?.getAttribute('aria-label')).toBe('2 approvals, 1 request for changes, 1 reviewer commented');
    // Left of the group.
    expect(tally?.nextElementSibling?.classList.contains('geld-quick-review__status')).toBe(true);
    // Another pull request in the same tab whose reviews cannot be read shows no counts, not the last one's.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    window.history.replaceState(null, '', '/acme/widgets/pull/8');
    applyQuickReview(true, { page: { kind: 'pull-conversation', diffUrl: null, stateKey: '/acme/widgets/pull/8' }, groups: [groupAt(counts())], headSha: () => SHA });
    for (let i = 0; i < 4; i += 1) await settle();
    expect(document.querySelector<HTMLElement>('.geld-quick-review__tally')?.hidden).toBe(true);
  });

  it('wears the kind of comment its box will post: a review while comments are pending or once chosen, a plain comment otherwise', async () => {
    // A pull request of its own: the box's choice is kept per pull request for the visit.
    window.history.replaceState(null, '', '/acme/widgets/pull/8');
    applyQuickReview(true, { page: { kind: 'pull-conversation', diffUrl: null, stateKey: '/acme/widgets/pull/8' }, groups: [groupAt(counts())], headSha: () => SHA });
    expect(segment('comment').getAttribute('data-kind')).toBe('comment');
    expect(segment('comment').querySelector('.octicon-comment')).not.toBeNull();
    segment('comment').click();
    const box = document.querySelector('.geld-quick-review__panel');
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    [...(box?.querySelectorAll<HTMLButtonElement>('.geld-quick-review__menu-item') ?? [])].find((item) => item.textContent?.startsWith('Review'))?.click();
    expect(segment('comment').getAttribute('data-kind')).toBe('review');
    expect(segment('comment').querySelector('.geld-quick-review__glyph:not(.geld-quick-review__glyph--instant) .octicon-code-review')).not.toBeNull();
    expect(segment('comment').getAttribute('aria-label')).toBe('Review');
    // No word beside the glyph, ever: the choice is in the box.
    expect(segment('comment').textContent?.trim()).toBe('');
    // And back: the plain comment glyph.
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    [...(box?.querySelectorAll<HTMLButtonElement>('.geld-quick-review__menu-item') ?? [])].find((item) => item.textContent?.startsWith('Comment'))?.click();
    expect(segment('comment').getAttribute('data-kind')).toBe('comment');
  });

  it('renames an open 💬 box when a comment is left pending meanwhile, so its button says what a click sends', () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/9');
    const context = { page: { kind: 'pull-files' as const, diffUrl: null, stateKey: '/acme/widgets/pull/9' }, groups: [groupAt(counts())], headSha: () => SHA };
    applyQuickReview(true, context);
    segment('comment').click();
    const submit = (): string | null | undefined => document.querySelector('.geld-quick-review__panel .geld-quick-review__submit')?.textContent;
    expect(submit()).toBe('Comment');
    const counter = document.createElement('button');
    counter.className = 'ReviewMenuButton__x';
    counter.innerHTML = '<span>Submit review</span><span data-component="ButtonCounter">1</span>';
    document.body.append(counter);
    applyQuickReview(true, context);
    expect(submit()).toBe('Review');
    counter.remove();
  });

  it('turns an open ✓ box into a comment when the page then says the reader is the author', () => {
    document.head.innerHTML = '<meta name="user-login" content="alice">';
    mount();
    segment('approve').click();
    expect(chosen()).toBe('Approve');
    document.head.innerHTML = '<meta name="user-login" content="bob">';
    mount();
    expect(chosen()).toBe('Comment');
  });

  it('follows GitHub’s own count on Files changed, down to none once the pending review is discarded there', async () => {
    const pending = { id: '1', path: 'src/a.ts', line: 3, isOutdated: false, subject: { diffLines: [] }, commentsData: { comments: [{ id: 'c1', state: 'pending', viewerDidAuthor: true, body: 'Typo.', currentDiffResourcePath: '/acme/widgets/pull/13/files#r1' }] } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('/thread_previews') ? new Response(JSON.stringify([pending]), { status: 200 }) : new Response('{}', { status: 200 }))));
    window.history.replaceState(null, '', '/acme/widgets/pull/13/changes');
    const context = { page: { kind: 'pull-files' as const, diffUrl: null, stateKey: '/acme/widgets/pull/13' }, groups: [groupAt(counts())], headSha: () => SHA };
    const own = document.querySelector('.ReviewMenuButton__x');
    own?.insertAdjacentHTML('beforeend', '<span data-component="ButtonCounter">1</span>');
    applyQuickReview(true, context);
    await settle();
    applyQuickReview(true, context);
    const badge = (): string | null | undefined => document.querySelector('.geld-quick-review__badged > .geld-quick-review__count')?.textContent;
    expect(badge()).toBe('1');
    // Discarded on Files changed: GitHub drops its counter, and the badge goes with it though the last read said one.
    own?.querySelector('[data-component="ButtonCounter"]')?.remove();
    applyQuickReview(true, context);
    expect(badge()).toBe('');
  });

  it('counts the pending comments, lists them and discards the review as GitHub does', async () => {
    const pending = {
      id: '1',
      path: 'src/a.ts',
      line: 3,
      isOutdated: false,
      subject: { diffLines: [{ html: '@@ -1 +1 @@', left: null, right: null, type: 'HUNK' }, { html: 'const a = 1;', left: null, right: 3, type: 'ADDITION' }] },
      commentsData: { comments: [{ id: 'c1', state: 'pending', viewerDidAuthor: true, body: 'Rename `a` to something clearer. It reads as a typo.', currentDiffResourcePath: '/acme/widgets/pull/7/files#r1' }] },
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/thread_previews')) return new Response(JSON.stringify([pending]), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    const page = { kind: 'pull-conversation' as const, diffUrl: null, stateKey: '/acme/widgets/pull/7' };
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    await new Promise((resolve) => setTimeout(resolve, 0));
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    const button = document.querySelector<HTMLButtonElement>('.geld-quick-review__segment[data-event="comment"]');
    // A badge on the group's corner, outside the group (Primer rounds its last child); the segment's name says it.
    const badge = document.querySelector<HTMLElement>('.geld-quick-review__badged > .geld-quick-review__count');
    expect(badge?.textContent).toBe('1');
    expect(button?.querySelector('.geld-quick-review__count')).toBeNull();
    // With a comment pending 💬's box submits a review by default, and the button says so.
    expect(button?.getAttribute('aria-label')).toBe('Review, 1 pending comment');
    expect(button?.getAttribute('data-kind')).toBe('review');
    // Another pull request in the same tab: none of this one's comments until its own are read.
    window.history.replaceState(null, '', '/acme/widgets/pull/8');
    applyQuickReview(true, { page: { kind: 'pull-conversation', diffUrl: null, stateKey: '/acme/widgets/pull/8' }, groups: [groupAt(counts())], headSha: () => SHA });
    expect(document.querySelector<HTMLElement>('.geld-quick-review__badged > .geld-quick-review__count')?.hidden).toBe(true);
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    await new Promise((resolve) => setTimeout(resolve, 0));
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA });
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const box = document.querySelector('.geld-quick-review__panel');
    const toggle = box?.querySelector<HTMLButtonElement>('.geld-quick-review__pending-toggle');
    expect(toggle?.textContent).toBe('Pending comments1');
    // Folded at first: the count, no rows until it is opened.
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(box?.querySelector('.geld-quick-review__pending-row')).toBeNull();
    toggle?.click();
    // One line per comment: its first sentence (inline code kept) and where it is, leading there on Files changed.
    const row = box?.querySelector('.geld-quick-review__pending-row');
    expect(row?.getAttribute('href')).toBe('/acme/widgets/pull/7/files#r1');
    expect(row?.querySelector('.geld-quick-review__pending-text')?.textContent).toBe('Rename a to something clearer.');
    expect(row?.querySelector('.geld-quick-review__pending-text code')?.textContent).toBe('a');
    expect(row?.querySelector('.geld-quick-review__pending-where')?.textContent).toBe('a.ts:3');
    expect(row?.getAttribute('title')).toBe('src/a.ts, line 3');
    // With comments pending 💬's box submits a review by default, and they go with it, so it needs no words of its own.
    const submit = [...(box?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === 'Review');
    expect(submit?.disabled).toBe(false);
    // As a plain comment instead, it needs words, and the pending comments stay pending.
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    const plain = [...(box?.querySelectorAll<HTMLButtonElement>('.geld-quick-review__menu-item') ?? [])].find((item) => item.textContent?.startsWith('Comment'));
    plain?.click();
    expect(submit?.textContent).toBe('Comment');
    expect(submit?.disabled).toBe(true);
    const discard = [...(box?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === 'Discard review');
    expect(discard?.hidden).toBe(false);
    vi.stubGlobal('confirm', vi.fn(() => true));
    discard?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContain('DELETE /acme/widgets/pull/7/page_data/abandon_review');
    expect(badge?.hidden).toBe(true);
  });

  it('posts a plain comment from 💬 by default, and a review once chosen', async () => {
    const sent: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' || init?.method === 'PUT') sent.push({ url, body: String(init.body) });
      return new Response('{}', { status: url.includes('create_timeline_comment') || url.includes('submit_review') ? 200 : 404 });
    }));
    // Off the conversation, where a posted comment would reload the page to show it; a pull request of its own, as the box's choice is kept per pull request.
    window.history.replaceState(null, '', '/acme/widgets/pull/9/commits');
    applyQuickReview(true, { page: { kind: 'pull-other', diffUrl: null, stateKey: '/acme/widgets/pull/9' }, groups: [groupAt(counts())], headSha: () => SHA });
    segment('comment').click();
    const box = document.querySelector('.geld-quick-review__panel');
    const words = box?.querySelector('textarea');
    if (!(words instanceof HTMLTextAreaElement)) throw new Error('no box');
    words.value = 'Looks close.';
    words.dispatchEvent(new Event('input', { bubbles: true }));
    // The choice: icon, name and a one-line note each, the current one checked.
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    const items = [...(box?.querySelectorAll<HTMLButtonElement>('.geld-quick-review__menu-item') ?? [])];
    expect(items.map((item) => [item.querySelector('.geld-quick-review__menu-label')?.textContent, item.querySelector('.geld-quick-review__menu-note')?.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Comment', 'Add to the conversation', 'true'],
      ['Review', 'Submit as a review', 'false'],
    ]);
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__submit')?.click();
    await settle();
    await settle();
    expect(sent).toEqual([{ url: '/acme/widgets/pull/9/page_data/create_timeline_comment', body: JSON.stringify({ text: 'Looks close.' }) }]);
    expect(document.querySelector('.geld-quick-review__status')?.textContent).toBe('Commented');
    // A review instead goes through GitHub's review request, as a comment review.
    segment('comment').click();
    const again = document.querySelector('.geld-quick-review__panel');
    const field = again?.querySelector('textarea');
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('no box');
    field.value = 'As a review.';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    again?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    [...(again?.querySelectorAll<HTMLButtonElement>('.geld-quick-review__menu-item') ?? [])].find((item) => item.textContent?.startsWith('Review'))?.click();
    again?.querySelector<HTMLButtonElement>('.geld-quick-review__submit')?.click();
    await settle();
    await settle();
    expect(sent[1]).toEqual({ url: '/acme/widgets/pull/9/page_data/submit_review', body: JSON.stringify({ body: 'As a review.', event: 'comment', headSha: SHA }) });
    // The box's words went with it; the choice of a review stays for the visit.
    segment('comment').click();
    const third = document.querySelector('.geld-quick-review__panel');
    expect(third?.querySelector('textarea')?.value).toBe('');
    expect(third?.querySelector('.geld-quick-review__submit')?.textContent).toBe('Review');
    // The choice menu is fixed where its caret was: scrolling the page closes it rather than leave it behind.
    third?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    expect(third?.querySelector<HTMLElement>('.geld-quick-review__menu')?.hidden).toBe(false);
    window.dispatchEvent(new Event('scroll'));
    expect(third?.querySelector<HTMLElement>('.geld-quick-review__menu')?.hidden).toBe(true);
  });

  it('opens a refused ⌘-click on 💬 as a review of the pending comments, whatever the usual choice', async () => {
    const pending = {
      id: '1',
      path: 'src/a.ts',
      line: 3,
      isOutdated: false,
      subject: { diffLines: [] },
      commentsData: { comments: [{ id: 'c1', state: 'pending', viewerDidAuthor: true, body: 'Typo.', currentDiffResourcePath: '/acme/widgets/pull/12/files#r1' }] },
    };
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/thread_previews')) return new Response(JSON.stringify([pending]), { status: 200 });
      if (init?.method === 'PUT' || init?.method === 'POST') {
        sent.push(url.replace(/^.*\/page_data\//, ''));
        return new Response('{"error":"Try again"}', { status: 422 });
      }
      return new Response('{}', { status: 404 });
    }));
    window.history.replaceState(null, '', '/acme/widgets/pull/12/commits');
    const page12 = { kind: 'pull-other' as const, diffUrl: null, stateKey: '/acme/widgets/pull/12' };
    applyQuickReview(true, { page: page12, groups: [groupAt(counts())], headSha: () => SHA });
    await settle();
    applyQuickReview(true, { page: page12, groups: [groupAt(counts())], headSha: () => SHA });
    // The reader's usual choice is a plain comment.
    segment('comment').click();
    const box = document.querySelector('.geld-quick-review__panel');
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__kind-toggle')?.click();
    [...(box?.querySelectorAll<HTMLButtonElement>('.geld-quick-review__menu-item') ?? [])].find((item) => item.textContent?.startsWith('Comment'))?.click();
    segment('comment').click();
    expect(document.querySelector('.geld-quick-review__panel')).toBeNull();
    segment('comment').dispatchEvent(new MouseEvent('click', instant));
    for (let i = 0; i < 3; i += 1) await settle();
    expect(sent).toEqual(['submit_review']);
    const refused = document.querySelector('.geld-quick-review__panel');
    expect(refused?.querySelector('.geld-quick-review__submit')?.textContent).toBe('Review');
  });

  it('writes a comment as GitHub’s conversation composer does', () => {
    const request = timelineCommentRequest('/o/r/pull/7', 'Hello', 'n1');
    expect(request.url).toBe('/o/r/pull/7/page_data/create_timeline_comment');
    expect(request.init.method).toBe('POST');
    expect(JSON.parse(String(request.init.body))).toEqual({ text: 'Hello' });
  });

  it('draws the group at once, before GitHub has answered anything, with the tally arriving to its left later', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    mount();
    const root = document.querySelector('.geld-quick-review');
    expect(root?.hasAttribute('data-loading')).toBe(false);
    expect(root?.isConnected).toBe(true);
    expect(document.querySelector<HTMLElement>('.geld-quick-review__tally')?.hidden).toBe(true);
  });

  it('links the tally to the reviews and shows who reviewed on it, each a link to their review', async () => {
    const row = (login: string, words: string): string => `<p><span data-assignee-name="${login}"><img src="/${login}.png"></span><span class="reviewers-status-icon" aria-label="${words}"></span></p>`;
    const partial = `<form id="pull-request-reviewers-form-1">${row('ann', 'ann approved these changes')}${row('dee', 'dee left review comments')}</form>`;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('show_partial')) return new Response(partial, { status: 200 });
      if (url.includes('/page_data/merge_box')) return new Response(mergeBox('MERGEABLE', true, { reviews: [{ id: 42, author: { login: 'ann' }, state: 'APPROVED' }] }), { status: 200 });
      return new Response('{}', { status: 404 });
    }));
    mount();
    for (let i = 0; i < 4; i += 1) await settle();
    const tally = document.querySelector<HTMLAnchorElement>('.geld-quick-review__tally');
    expect(tally?.getAttribute('href')).toBe('/acme/widgets/pull/7#geld-reviews');
    tally?.dispatchEvent(new Event('focus'));
    const rows = [...document.querySelectorAll<HTMLAnchorElement>('.geld-quick-review__snapshot-row')];
    // An approval links to its own review; a comment review, whose id only the timeline has, to the reviewer's marker.
    expect(rows.map((link) => [link.querySelector('.geld-quick-review__snapshot-name')?.textContent, link.querySelector('.geld-quick-review__snapshot-state')?.getAttribute('aria-label'), link.getAttribute('href')])).toEqual([
      ['ann', 'approved', '/acme/widgets/pull/7#pullrequestreview-42'],
      ['dee', 'commented', '/acme/widgets/pull/7#geld-review-by-dee'],
    ]);
    const card = document.querySelector<HTMLElement>('.geld-quick-review__snapshot');
    // Fixed under the tally, the list keeps to the room left in the window.
    expect(card?.style.maxHeight).toMatch(/^\d+px$/);
    // The keyboard walks into the card after the tally, and out of it to the review buttons.
    tally?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[0]);
    rows[1]?.focus();
    rows[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.querySelector('.geld-quick-review__snapshot')).toBeNull();
    expect(document.activeElement?.classList.contains('geld-quick-review__segment')).toBe(true);
    // It hangs from the tally: when the page scrolls, it goes.
    tally?.dispatchEvent(new Event('focus'));
    expect(document.querySelector('.geld-quick-review__snapshot')).not.toBeNull();
    window.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('.geld-quick-review__snapshot')).toBeNull();
    // Escape inside the card closes it and returns to the tally, once, without the tally's focus opening it again.
    tally?.dispatchEvent(new Event('focus'));
    const first = document.querySelector<HTMLAnchorElement>('.geld-quick-review__snapshot-row');
    first?.focus();
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.geld-quick-review__snapshot')).toBeNull();
    expect(document.activeElement).toBe(tally);
  });

  it('waits for the digest’s Reviews row before settling for the sidebar, while the digest is on', () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="discussion-sidebar-item"><form id="pull-request-reviewers-form-2"></form></div>');
    const item = document.querySelector<HTMLElement>('.discussion-sidebar-item');
    const scrolled: string[] = [];
    if (item !== null) item.scrollIntoView = () => scrolled.push('sidebar');
    window.history.replaceState(null, '', '/acme/widgets/pull/7#geld-reviews');
    applyQuickReview(true, { page, groups: [groupAt(counts())], headSha: () => SHA, digest: true });
    expect(scrolled).toEqual([]);
    expect(window.location.hash).toBe('#geld-reviews');
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
  });

  it('resolves a reviewer marker on the conversation to their latest review’s own anchor', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="pullrequestreview-1"><a class="author" href="/dee">Dee Doe (dee)</a></div><div id="pullrequestreview-2"><a class="author" href="/ann">ann</a></div><div id="pullrequestreview-3"><a class="author" href="/dee">Dee Doe (dee)</a><a id="pullrequestreview-3-permalink"></a></div>');
    window.history.replaceState(null, '', '/acme/widgets/pull/7#geld-review-by-dee');
    mount();
    expect(window.location.hash).toBe('#pullrequestreview-3');
  });

  it('still puts its controls on the page under a malformed reviewer marker', () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/7#geld-review-by-%');
    expect(() => mount()).not.toThrow();
    expect(document.querySelector('.geld-quick-review')).not.toBeNull();
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
  });

  it('brings the reviews into view for the tally’s own link, and drops the marker', () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="discussion-sidebar-item"><form id="pull-request-reviewers-form-1"></form></div>');
    const scrolled: string[] = [];
    const item = document.querySelector<HTMLElement>('.discussion-sidebar-item');
    if (item !== null) item.scrollIntoView = () => scrolled.push('sidebar');
    window.history.replaceState(null, '', '/acme/widgets/pull/7#geld-reviews');
    mount();
    expect(scrolled).toEqual(['sidebar']);
    expect(window.location.hash).toBe('');
  });

  const WRITER_HTML = `
    <form id="new_comment_form"><div class="js-previewable-comment-form preview-selected CommentBox">
      <markdown-toolbar for="new_comment_field"><button id="bold-1" data-md-button="bold" data-hotkey-scope="new_comment_field" aria-labelledby="tip-1"></button><tool-tip id="tip-1" for="bold-1">Bold</tool-tip></markdown-toolbar>
      <file-attachment><textarea id="new_comment_field" class="js-comment-field js-session-resumable" name="comment[body]" required></textarea>
      <div class="d-flex foot"><a href="https://docs.github.com/github/writing-on-github"><svg></svg> Markdown is supported</a><label><input type="file"><span>Paste, drop, or click to add files</span></label></div></file-attachment>
      <div class="js-preview-body"><p>old preview</p></div>
    </div></form>`;

  it('writes in GitHub’s own comment writer, a copy re-id’d away from the page’s box', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') sent.push(String(init.body));
      return new Response('{}', { status: String(input).includes('create_timeline_comment') ? 200 : 404 });
    }));
    document.body.insertAdjacentHTML('beforeend', WRITER_HTML);
    const own = document.querySelector<HTMLTextAreaElement>('#new_comment_field');
    if (own !== null) own.value = 'my unsent words';
    window.history.replaceState(null, '', '/acme/widgets/pull/10');
    applyQuickReview(true, { page: { kind: 'pull-conversation', diffUrl: null, stateKey: '/acme/widgets/pull/10' }, groups: [groupAt(counts())], headSha: () => SHA });
    segment('comment').click();
    const box = document.querySelector('.geld-quick-review__panel');
    const writer = box?.querySelector('.js-previewable-comment-form');
    // Its foot says what the toolbar and the field offer: hidden, the file input still in the page; the form never validates.
    expect(box?.querySelector('.foot')?.hasAttribute('data-geld-writer-foot')).toBe(true);
    expect(box?.querySelector('.foot input[type="file"]')).not.toBeNull();
    expect(box?.querySelector<HTMLFormElement>('form.geld-comment-writer')?.noValidate).toBe(true);
    const field = writer?.querySelector('textarea');
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('no writer');
    expect(writer?.classList.contains('write-selected')).toBe(true);
    expect(box instanceof HTMLElement ? box.style.maxWidth : '').toBe('calc(100vw - 32px)');
    expect(writer?.classList.contains('preview-selected')).toBe(false);
    expect(writer?.querySelector('.js-preview-body')?.textContent).toBe('');
    expect(field.value).toBe('');
    expect(field.id).not.toBe('new_comment_field');
    expect(field.classList.contains('js-session-resumable')).toBe(false);
    expect(writer?.querySelector('markdown-toolbar')?.getAttribute('for')).toBe(field.id);
    const bold = writer?.querySelector('[data-md-button="bold"]');
    expect(bold?.getAttribute('data-hotkey-scope')).toBe(field.id);
    expect(writer?.querySelector('tool-tip')?.getAttribute('for')).toBe(bold?.id);
    expect(bold?.getAttribute('aria-labelledby')).toBe(writer?.querySelector('tool-tip')?.id);
    expect(own?.value).toBe('my unsent words');
    // In a form of its own, as GitHub's preview needs, whose submit (GitHub's Ctrl+Enter) goes nowhere.
    const form = field.form;
    expect(form?.id).not.toBe('new_comment_form');
    const submitted = new Event('submit', { cancelable: true });
    form?.dispatchEvent(submitted);
    expect(submitted.defaultPrevented).toBe(true);
    field.value = 'Ship it.';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    box?.querySelector<HTMLButtonElement>('.geld-quick-review__submit')?.click();
    await settle();
    expect(sent).toEqual([JSON.stringify({ text: 'Ship it.' })]);
  });

  it('fetches the writer off the conversation, on intent, and shows it in place of a placeholder', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      return url === '/acme/widgets/pull/11' ? new Response(`<html><body>${WRITER_HTML}</body></html>`, { status: 200 }) : new Response('{}', { status: 404 });
    }));
    window.history.replaceState(null, '', '/acme/widgets/pull/11/changes');
    applyQuickReview(true, { page: { kind: 'pull-files', diffUrl: null, stateKey: '/acme/widgets/pull/11' }, groups: [groupAt(counts())], headSha: () => SHA });
    expect(asked).not.toContain('/acme/widgets/pull/11');
    segment('comment').click();
    // A placeholder in the writer's shape holds its place, focused so Escape still closes the box; no plain field shows first.
    const placeholder = document.querySelector<HTMLElement>('.geld-quick-review__panel .geld-quick-review__writer-placeholder');
    const stand = document.querySelector<HTMLTextAreaElement>('.geld-quick-review__panel textarea');
    if (placeholder === null || stand === null) throw new Error('no box');
    expect(stand.hidden).toBe(true);
    expect(document.activeElement).toBe(placeholder);
    await settle();
    await settle();
    expect(asked.filter((url) => url === '/acme/widgets/pull/11')).toHaveLength(1);
    const field = document.querySelector('.geld-quick-review__panel .js-previewable-comment-form textarea');
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('no writer');
    expect(placeholder.isConnected).toBe(false);
    expect(stand.isConnected).toBe(false);
    expect(document.activeElement).toBe(field);
    // The next box has the writer at once, from the same fetch.
    document.querySelector<HTMLButtonElement>('.geld-quick-review__panel .btn-invisible:not(.geld-quick-review__discard)')?.click();
    document.querySelector('.geld-quick-review__group[aria-label="Submit review"]')?.dispatchEvent(new Event('pointerenter'));
    segment('comment').click();
    expect(document.querySelector('.geld-quick-review__panel .js-previewable-comment-form textarea')).not.toBeNull();
    expect(asked.filter((url) => url === '/acme/widgets/pull/11')).toHaveLength(1);
  });

  it('falls back to a plain field when the writer cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    window.history.replaceState(null, '', '/acme/widgets/pull/12/changes');
    applyQuickReview(true, { page: { kind: 'pull-files', diffUrl: null, stateKey: '/acme/widgets/pull/12' }, groups: [groupAt(counts())], headSha: () => SHA });
    segment('comment').click();
    await settle();
    await settle();
    const stand = document.querySelector<HTMLTextAreaElement>('.geld-quick-review__panel textarea');
    expect(document.querySelector('.geld-quick-review__panel .geld-quick-review__writer-placeholder')).toBeNull();
    expect(stand?.hidden).toBe(false);
    expect(document.activeElement).toBe(stand);
  });

  it('reads the pull request path', () => {
    expect(pullPathOf('/acme/widgets/pull/7/changes')).toBe('/acme/widgets/pull/7');
    expect(pullPathOf('/acme/widgets/issues/7')).toBeNull();
  });
});
