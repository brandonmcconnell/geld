// @vitest-environment happy-dom
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { nativeBitbucketComment, bitbucketConversationRoots, syncBitbucketNativeReviewState } from './conversation';
import { renderBitbucketComment } from './comment-render';
import { bitbucketThreadActions } from './thread-actions';

const comment: ProviderReviewComment = { id: '471253038', anchor: 'comment-471253038', url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/_/diff#comment-471253038', author: { id: '{native-user}', login: 'reviewer' }, body: 'Internal maintenance: Update tests to access token auth.', createdAt: '2024-02-13T15:46:48Z', updatedAt: '2024-02-13T15:46:48Z' };
const path = '.changes/next-release/patch-20240213112019723332.json';

beforeEach(() => {
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\'>';
  // Reduced from anonymous PR22's actual inline outdated conversation in installed Chrome, November 1, 2026.
  document.body.innerHTML = `<div data-qa="pr-activity"><div data-qa="pull-request-activity"><a href="/atlassian/bitbucket-upload-file/pull-requests/22/diff#comment-471253038">patch-20240213112019723332.json</a><div data-qa="pull-request-overview-activity-content"><div>
    <div data-qa="bk-file__header" data-testid="file-header" tabindex="0"><h2 data-qa="bk-filepath"><span>${path}</span></h2><div><span><span><span>Outdated</span></span></span></div></div>
    <div data-qa="bk-file__content"><div id="portal-parent-pr-dialog-conversation-conversation-471253038"><div data-thread-controls-managed="true"><div data-testid="comment-header-actions"></div>
    <div id="comment-471253038" data-testid="comment"><h3><span data-testid="comment-header"><span>Oleksandr Kyrdan</span><a href="#comment-471253038"><time datetime="2024-02-13">2024-02-13</time></a></span></h3>
      <div data-testid="comment-content"><div class="ak-renderer-wrapper"><div class="ak-renderer-document"><p data-renderer-start-pos="1">Internal maintenance: Update tests to access token auth.</p><p>&nbsp;</p></div></div></div>
      <div data-testid="comment-footer"><button type="button"><span>Reply</span></button><span>·</span><button type="button"><span>Resolve</span></button></div>
    </div></div></div></div></div></div></div></div>`;
});

function input(): ProviderReviewInput {
  return { subject: { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'atlassian/bitbucket-upload-file', id: '22', headSha: 'a'.repeat(40) }, threads: [{ id: comment.id, anchor: comment.anchor, url: comment.url, path, line: 3, resolved: false, outdated: false, comments: [comment] }] };
}

it('finds the actual inline comment through its canonical native alias without confusing rendered clones', () => {
  const root = nativeBitbucketComment(comment, document);
  expect(root?.id).toBe(comment.anchor);
  expect(bitbucketConversationRoots(document)).toEqual([{ root, anchors: [comment.anchor], kind: 'comment' }]);
  const clone = root?.cloneNode(true);
  const ui = document.createElement('div');
  ui.setAttribute('data-geld-ui', '');
  if (clone !== undefined) ui.append(clone);
  document.body.prepend(ui);
  expect(nativeBitbucketComment(comment, document)).toBe(root);
  expect(bitbucketConversationRoots(document)).toHaveLength(1);
});

it('copies the provider-rendered rich body without moving native controls or including the diff hunk', () => {
  const root = nativeBitbucketComment(comment, document);
  const parent = root?.parentElement;
  const footer = root?.querySelector('[data-testid="comment-footer"]');
  const host = document.createElement('div');
  expect(renderBitbucketComment(comment, host, document)).toBe(true);
  expect(host.querySelector('.ak-renderer-document p')?.textContent).toBe(comment.body);
  expect(host.querySelector('[data-testid], [id], button')).toBeNull();
  expect(host.textContent).not.toContain('Reply');
  expect(root?.parentElement).toBe(parent);
  expect(root?.querySelector('[data-testid="comment-footer"]')).toBe(footer);
});

it('reconstructs safe rich markup while dropping active elements, handlers and unsafe URLs', () => {
  const body = document.querySelector('.ak-renderer-document');
  if (body === null) throw new Error('Missing body');
  body.innerHTML = '<p id="duplicate" style="position:fixed" onclick="bad()"><strong>Safe</strong><a href="javascript:bad()">link</a><a href="https://example.com/help">help</a><img src="data:text/html,bad" alt="fallback"><script>bad()</script><form><input></form><svg><a href="javascript:bad()">x</a></svg></p><pre><code class="language-python">print(1)</code></pre>';
  const host = document.createElement('div');
  expect(renderBitbucketComment(comment, host, document)).toBe(true);
  expect(host.querySelector('strong')?.textContent).toBe('Safe');
  expect(host.querySelector('[onclick],[style],[id],script,form,input,svg')).toBeNull();
  expect(host.querySelector('a')?.hasAttribute('href')).toBe(false);
  expect(host.querySelector('a[href]')?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(host.querySelector('a[href]')?.getAttribute('target')).toBe('_blank');
  expect(host.textContent).toContain('fallback');
  expect(host.querySelector('code.language-python')?.textContent).toBe('print(1)');
});

it('rejects wrong review, wrong anchor and mismatched native permalink sources without replacing fallback text', () => {
  for (const candidate of [{ ...comment, url: comment.url.replace('/22/', '/27/') }, { ...comment, anchor: 'comment-1' }, { ...comment, url: 'https://example.com/#comment-471253038' }]) {
    const host = document.createElement('div');
    host.textContent = 'fallback';
    expect(renderBitbucketComment(candidate, host, document)).toBe(false);
    expect(host.textContent).toBe('fallback');
  }
  document.querySelector('[data-testid="comment-header"] a')?.setAttribute('href', '#comment-1');
  expect(nativeBitbucketComment(comment, document)).toBeNull();
});

it('overlays the exact inline card Outdated fact without inferring freshness from absence', () => {
  const original = input();
  expect(syncBitbucketNativeReviewState(original, document).threads[0]?.outdated).toBe(true);
  expect(original.threads[0]?.outdated).toBe(false);
  document.querySelector('[data-qa="bk-filepath"]')?.replaceChildren('another-file.json');
  expect(syncBitbucketNativeReviewState(original, document)).toBe(original);
});

it('offers native navigation publicly while requiring explicit authentication for Reply and Resolve relays', async () => {
  const actions = bitbucketThreadActions(comment, document);
  expect(actions.map((action) => [action.kind, action.available])).toEqual([['show', true], ['reply', false], ['resolve', false]]);
  expect(await actions[1]?.activate()).toBe(false);
  expect(await actions[2]?.activate()).toBe(false);
  const root = nativeBitbucketComment(comment, document);
  if (root === null) throw new Error('Missing comment');
  const scroll = vi.spyOn(root, 'scrollIntoView');
  expect(await actions[0]?.activate()).toBe(true);
  expect(scroll).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(root);
  expect(root.getAttribute('tabindex')).toBe('-1');
  root.blur();
  expect(root.hasAttribute('tabindex')).toBe(false);
});

it('does not claim to reveal a natively collapsed conversation without an observed expansion control', async () => {
  const root = nativeBitbucketComment(comment, document);
  if (root === null) throw new Error('Missing comment');
  root.parentElement?.setAttribute('aria-hidden', 'true');
  const action = bitbucketThreadActions(comment, document)[0];
  expect(action?.available).toBe(false);
  expect(await action?.activate()).toBe(false);
});

it('relays only enabled same-comment native controls and rechecks authentication and page identity', async () => {
  document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":true}');
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-testid="comment-footer"] button');
  const reply = vi.fn();
  buttons[0]?.addEventListener('click', reply);
  const actions = bitbucketThreadActions(comment, document);
  expect(actions.map((action) => action.available)).toEqual([true, true, true]);
  expect(await actions[1]?.activate()).toBe(true);
  expect(reply).toHaveBeenCalledOnce();
  if (buttons[1] !== undefined) buttons[1].disabled = true;
  expect(await actions[2]?.activate()).toBe(false);
  document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":false}');
  expect(await actions[1]?.activate()).toBe(false);
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
  expect(await actions[0]?.activate()).toBe(false);
});
