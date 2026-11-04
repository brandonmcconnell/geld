// @vitest-environment happy-dom
import { linkOnFilesTab, parsePendingComments, pendingCountOnPage } from './pending-review';

/** A `page_data/thread_previews` answer as GitHub gave it on brandonmcconnell/geld#68 (Oct 2026), trimmed. */
const THREAD = {
  id: '2921644721',
  isOutdated: false,
  path: 'packages/crf/schema/crf-v0.schema.json',
  subject: {
    diffLines: [
      { html: '@@ -0,0 +1,630 @@', left: null, right: 0, text: '@@ -0,0 +1,630 @@', type: 'HUNK' },
      { html: '{', left: null, right: 1, text: '+{', type: 'ADDITION' },
      { html: '  <span class="pl-ent">&quot;$schema&quot;</span>', left: null, right: 2, text: '+  "$schema"', type: 'ADDITION' },
      { html: '  <span class="pl-ent">&quot;$id&quot;</span>', left: null, right: 3, text: '+  "$id"', type: 'ADDITION' },
    ],
    endLine: 3,
  },
  line: 3,
  commentsData: {
    comments: [
      {
        id: 'PRRC_kwDOUOpwns8AAAABAX0R8w',
        databaseId: 4319941107,
        body: 'Geld test: pending comment, to be discarded',
        bodyHTML: '<p dir="auto">Geld test: pending comment, to be discarded</p>',
        currentDiffResourcePath: '/brandonmcconnell/geld/pull/68/files#r4319941107',
        url: 'https://github.com/brandonmcconnell/geld/pull/68#discussion_r4319941107',
        state: 'pending',
        viewerDidAuthor: true,
        publishedAt: null,
      },
    ],
  },
};

describe('parsePendingComments', () => {
  it('reads the reader’s pending comments with their file, line and words', () => {
    expect(parsePendingComments([THREAD])).toEqual([
      {
        id: 'PRRC_kwDOUOpwns8AAAABAX0R8w',
        path: 'packages/crf/schema/crf-v0.schema.json',
        line: 3,
        outdated: false,
        body: 'Geld test: pending comment, to be discarded',
        href: '/brandonmcconnell/geld/pull/68/files#r4319941107',
      },
    ]);
  });

  it('skips published comments and other people’s', () => {
    const published = { ...THREAD.commentsData.comments[0], state: 'submitted' };
    const theirs = { ...THREAD.commentsData.comments[0], viewerDidAuthor: false };
    expect(parsePendingComments([{ ...THREAD, commentsData: { comments: [published, theirs] } }])).toEqual([]);
    expect(parsePendingComments({ error: 'Not Found' })).toEqual([]);
  });
});

describe('pendingCountOnPage', () => {
  it('reads the count from GitHub’s own Files changed button', () => {
    document.body.innerHTML = '<button class="ReviewMenuButton__x"><span>Submit review</span><span data-component="ButtonCounter">2</span></button>';
    expect(pendingCountOnPage()).toBe(2);
    // Discarded on the page: GitHub drops the counter, and none are pending.
    document.body.innerHTML = '<button class="ReviewMenuButton__x"><span>Submit review</span></button>';
    expect(pendingCountOnPage()).toBe(0);
    document.body.innerHTML = '';
    expect(pendingCountOnPage()).toBeNull();
  });
});

describe('linkOnFilesTab', () => {
  it('names the Changes tab GitHub now redirects /files to, so a link from that tab jumps in place', () => {
    expect(linkOnFilesTab('/acme/widgets/pull/7/files#r1', '/acme/widgets/pull/7', true)).toBe('/acme/widgets/pull/7/changes#r1');
    expect(linkOnFilesTab(`${location.origin}/acme/widgets/pull/7/files#r1`, '/acme/widgets/pull/7', true)).toBe(`${location.origin}/acme/widgets/pull/7/changes#r1`);
    // A commit's files, another pull request, or a tab still called /files are left alone.
    expect(linkOnFilesTab('/acme/widgets/pull/7/files/abc123#r1', '/acme/widgets/pull/7', true)).toBe('/acme/widgets/pull/7/files/abc123#r1');
    expect(linkOnFilesTab('/acme/widgets/pull/70/files#r1', '/acme/widgets/pull/7', true)).toBe('/acme/widgets/pull/70/files#r1');
    expect(linkOnFilesTab('/acme/widgets/pull/7/files#r1', '/acme/widgets/pull/7', false)).toBe('/acme/widgets/pull/7/files#r1');
  });
});
