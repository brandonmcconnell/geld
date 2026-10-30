// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postTopLevelComments } from './actions';
import { catchUpAfterPost, catchUpTimeline } from './timeline-catchup';

const MARKER = (since: string): string => `<div id="partial-timeline" class="js-timeline-marker" data-url="/acme/widgets/pull/7/partials/unread_timeline?since=${since}"></div>`;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('catchUpTimeline', () => {
  it('puts the items since GitHub’s marker in its place, with the fresh marker after them', async () => {
    document.body.innerHTML = `<div class="js-timeline-item" id="old"></div>${MARKER('1')}`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<div class="js-timeline-item" id="new"></div>${MARKER('2')}`, { status: 200 })));
    expect(await catchUpTimeline()).toBe(true);
    expect([...document.body.children].map((child) => child.id)).toEqual(['old', 'new', 'partial-timeline']);
    expect(document.querySelector('#partial-timeline')?.getAttribute('data-url')).toContain('since=2');
  });

  it('counts GitHub’s own refresh landing first as caught up, and puts nothing in twice', async () => {
    document.body.innerHTML = MARKER('1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        document.body.innerHTML = `<div class="js-timeline-item" id="theirs"></div>${MARKER('2')}`;
        return new Response(`<div class="js-timeline-item" id="ours"></div>${MARKER('2')}`, { status: 200 });
      }),
    );
    expect(await catchUpTimeline()).toBe(true);
    expect(document.getElementById('ours')).toBeNull();
    expect(document.querySelectorAll('#partial-timeline')).toHaveLength(1);
  });

  it('keeps the marker when the answer has none, and does nothing without one', async () => {
    document.body.innerHTML = MARKER('1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>Something else</p>', { status: 200 })));
    expect(await catchUpTimeline()).toBe(false);
    expect(document.querySelector('#partial-timeline')?.getAttribute('data-url')).toContain('since=1');
    document.body.innerHTML = '';
    expect(await catchUpTimeline()).toBe(false);
  });
});

describe('catchUpAfterPost', () => {
  it('reads again while GitHub’s partial answers 404 (nothing since yet) right after a post', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = MARKER('1');
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        reads += 1;
        return reads < 3 ? new Response('', { status: 404 }) : new Response(`<div class="js-timeline-item" id="posted"></div>${MARKER('2')}`, { status: 200 });
      }),
    );
    const caught = catchUpAfterPost();
    await vi.runAllTimersAsync();
    expect(await caught).toBe(true);
    expect(reads).toBe(3);
    expect(document.getElementById('posted')).not.toBeNull();
    vi.useRealTimers();
  });

  it('gives up after a few reads without a reload signal, and says null where there is no marker', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = MARKER('1');
    const fetch = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const caught = catchUpAfterPost();
    await vi.runAllTimersAsync();
    expect(await caught).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);
    document.body.innerHTML = '';
    expect(await catchUpAfterPost()).toBeNull();
    vi.useRealTimers();
  });

  it('waits out a read already out from before the post, then reads afresh', async () => {
    document.body.innerHTML = MARKER('1');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(MARKER(String(urls.length + 1)), { status: 200 });
      }),
    );
    const earlier = catchUpTimeline();
    const caught = catchUpAfterPost();
    expect(await earlier).toBe(true);
    expect(await caught).toBe(true);
    expect(urls.map((url) => /since=(\d)/.exec(url)?.[1])).toEqual(['1', '2']);
  });
});

describe('postTopLevelComments', () => {
  it('posts each trigger to GitHub’s comment endpoint in turn, touching no form on the page, then catches the timeline up', async () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
    document.body.innerHTML = `<form><textarea id="new_comment_field"></textarea><button type="submit">Comment</button></form>${MARKER('1')}`;
    const calls: { url: string; body: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
        return url.includes('unread_timeline') ? new Response(MARKER('2'), { status: 200 }) : new Response('{}', { status: 200 });
      }),
    );
    expect(await postTopLevelComments(['@greptileai', 'bugbot run'])).toBe(2);
    expect(calls.slice(0, 2)).toEqual([
      { url: '/acme/widgets/pull/7/page_data/create_timeline_comment', body: JSON.stringify({ text: '@greptileai' }) },
      { url: '/acme/widgets/pull/7/page_data/create_timeline_comment', body: JSON.stringify({ text: 'bugbot run' }) },
    ]);
    expect(calls[2]?.url).toContain('unread_timeline?since=1');
    expect(document.querySelector<HTMLTextAreaElement>('#new_comment_field')?.value).toBe('');
  });

  it('stops at the first refusal', async () => {
    window.history.replaceState(null, '', '/acme/widgets/pull/7');
    const fetch = vi.fn(async () => new Response('{}', { status: 422 }));
    vi.stubGlobal('fetch', fetch);
    expect(await postTopLevelComments(['@greptileai', 'bugbot run'])).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
