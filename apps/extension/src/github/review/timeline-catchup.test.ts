// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postTopLevelComments } from './actions';
import { catchUpTimeline } from './timeline-catchup';

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
