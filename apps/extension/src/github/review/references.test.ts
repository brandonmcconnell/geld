// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { byMentionTime, referenceLinksIn } from './references';
import { parseHovercard, refKeyOf } from './refs';

const body = (html: string): Element => {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
};

describe('referenceLinksIn', () => {
  it('reads issues, pull requests and discussions as GitHub renders them, once each', () => {
    const links = referenceLinksIn(
      body(`<p>Testing: <a class="issue-link js-issue-link" href="https://github.com/o/r/pull/1" data-hovercard-type="pull_request" data-hovercard-url="/o/r/pull/1/hovercard">#1</a>,
        again <a class="issue-link" href="https://github.com/o/r/issues/1">#1</a>,
        <a href="https://github.com/o/other/issues/7" data-hovercard-type="issue">Crash on start</a>,
        <a href="https://github.com/o/r/discussions/42" data-hovercard-type="discussion">o/r#42</a>
        and a plain <a href="https://example.com/pull/3">link</a>.</p>`),
    );
    expect(links).toEqual([
      { href: 'https://github.com/o/r/pull/1', ref: 'o/r#1', title: '', discussion: false },
      { href: 'https://github.com/o/other/issues/7', ref: 'o/other#7', title: 'Crash on start', discussion: false },
      { href: 'https://github.com/o/r/discussions/42', ref: 'o/r#42', title: '', discussion: true },
    ]);
    expect(referenceLinksIn(null)).toEqual([]);
  });
});

describe('byMentionTime', () => {
  it('puts a later reply in an earlier thread after a comment written before it, and undated ones last, in place', () => {
    const mentions = [
      { id: 'thread-opened', at: '2026-11-07T06:00:00Z' },
      { id: 'thread-reply', at: '2026-11-07T08:00:00Z' },
      { id: 'undated', at: '' },
      { id: 'comment', at: '2026-11-07T07:00:00Z' },
      { id: 'same-time', at: '2026-11-07T07:00:00Z' },
    ];
    expect(byMentionTime(mentions).map((mention) => mention.id)).toEqual(['thread-opened', 'comment', 'same-time', 'thread-reply', 'undated']);
  });
});

describe('refKeyOf', () => {
  it('asks a discussion’s own hovercard, and an issue’s at the pull path as before', () => {
    expect(refKeyOf('https://github.com/o/r/discussions/42')).toBe('/o/r/discussions/42');
    expect(refKeyOf('https://github.com/o/r/issues/7#issuecomment-1')).toBe('/o/r/pull/7');
    expect(refKeyOf('/o/r/pull/9')).toBe('/o/r/pull/9');
  });

  it('reads a discussion hovercard’s title, with the discussion as its state', () => {
    const doc = new DOMParser().parseFromString('<div><a href="/o/r/discussions/42" class="Link--primary">How do I configure it?</a></div>', 'text/html');
    expect(parseHovercard(doc, '/o/r/discussions/42')).toEqual({ title: 'How do I configure it?', state: 'discussion' });
  });
});
