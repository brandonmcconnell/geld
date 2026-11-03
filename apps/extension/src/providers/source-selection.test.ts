// @vitest-environment happy-dom
import type { ProviderReviewComment } from '@geld/review';
import { captureProviderSourceSelection, mapProviderSourceSelection } from './source-selection';

const comment: ProviderReviewComment = { id: '11', anchor: 'note_11', url: 'https://gitlab.com/group/repo/-/merge_requests/7#note_11', author: { id: '23', login: 'author' }, body: 'same word, same word and tail.', createdAt: '2026-11-01T12:00:00Z' };

function fixture() {
  document.body.innerHTML = '<div id="native"><p>same <code>word</code>, same <strong>word</strong> and tail.</p></div><section data-geld-ui><article data-geld-source="note_11"><div class="geld-provider-review__body"><p>same <code>word</code>, same <strong>word</strong> and tail.</p></div></article></section>';
  const body = document.querySelector<HTMLElement>('.geld-provider-review__body');
  const native = document.querySelector<HTMLElement>('#native');
  const article = body?.closest('article');
  if (body === null || native === null || article === null || article === undefined) throw new Error('Missing source selection fixture.');
  article.dataset.geldSourceId = comment.id;
  article.dataset.geldSourceUrl = comment.url;
  return { body, native, article };
}

function select(node: Node | null | undefined, start = 0, end = node?.textContent?.length ?? 0): void {
  if (node === null || node === undefined) throw new Error('Missing selection node.');
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
}

afterEach(() => { document.body.replaceChildren(); document.getSelection()?.removeAllRanges(); });

it('maps the selected occurrence of repeated text to the exact original inline markup without moving nodes', () => {
  const { body, native } = fixture();
  const source = native.querySelector('strong')?.firstChild;
  const html = native.innerHTML;
  select(body.querySelector('strong')?.firstChild);
  const captured = captureProviderSourceSelection(comment, body);
  if (captured === undefined) throw new Error('Missing captured excerpt.');
  const mapped = mapProviderSourceSelection(captured, native, comment.id, comment.anchor, comment.url);
  expect(mapped?.toString()).toBe('word');
  expect(mapped?.startContainer).toBe(source);
  expect(mapped?.endContainer).toBe(source);
  expect(native.innerHTML).toBe(html);
  expect(source?.isConnected).toBe(true);
});

it('maps a range across text nodes and inline formatting through whole-body offsets', () => {
  const { body, native } = fixture();
  const range = document.createRange();
  const start = body.querySelector('code')?.firstChild;
  const end = body.querySelector('strong')?.firstChild;
  if (start === null || start === undefined || end === null || end === undefined) throw new Error('Missing inline nodes.');
  range.setStart(start, 1); range.setEnd(end, 3);
  document.getSelection()?.addRange(range);
  const captured = captureProviderSourceSelection(comment, body);
  if (captured === undefined) throw new Error('Missing captured excerpt.');
  const mapped = mapProviderSourceSelection(captured, native, comment.id, comment.anchor, comment.url);
  expect(mapped?.toString()).toBe('ord, same wor');
  expect(mapped?.startContainer).toBe(native.querySelector('code')?.firstChild);
  expect(mapped?.endContainer).toBe(native.querySelector('strong')?.firstChild);
});

it('refuses changed complete bodies, moved ranges and forged source identity instead of searching for matching prose', () => {
  const { body, native, article } = fixture();
  select(body.querySelector('strong')?.firstChild);
  const captured = captureProviderSourceSelection(comment, body);
  if (captured === undefined) throw new Error('Missing captured excerpt.');
  for (const args of [[comment.id, 'note_12', comment.url], ['12', comment.anchor, comment.url], [comment.id, comment.anchor, `${comment.url}x`]]) {
    const [id, anchor, url] = args;
    if (id === undefined || anchor === undefined || url === undefined) throw new Error('Missing identity argument.');
    expect(mapProviderSourceSelection(captured, native, id, anchor, url)).toBeNull();
  }
  native.querySelector('p')?.append(' changed');
  expect(mapProviderSourceSelection(captured, native, comment.id, comment.anchor, comment.url)).toBeNull();
  native.querySelector('p')?.lastChild?.remove();
  article.dataset.geldSource = 'note_12';
  expect(mapProviderSourceSelection(captured, native, comment.id, comment.anchor, comment.url)).toBeNull();
  article.dataset.geldSource = comment.anchor;
  body.remove();
  expect(mapProviderSourceSelection(captured, native, comment.id, comment.anchor, comment.url)).toBeNull();
});

it('distinguishes an explicit selection in another source or editor from no excerpt', () => {
  const { body } = fixture();
  expect(captureProviderSourceSelection(comment, body)).toBeUndefined();
  const unrelated = document.createElement('p'); unrelated.textContent = 'Other source'; document.body.append(unrelated);
  select(unrelated.firstChild);
  expect(captureProviderSourceSelection(comment, body)).toEqual({ kind: 'unavailable' });
  const editor = document.createElement('span'); editor.contentEditable = 'true'; editor.textContent = 'Draft text'; body.append(editor);
  select(editor.firstChild);
  expect(captureProviderSourceSelection(comment, body)).toEqual({ kind: 'unavailable' });
  document.getSelection()?.removeAllRanges();
  const cross = document.createRange(); cross.setStart(body, 0); cross.setEnd(unrelated, 1); document.getSelection()?.addRange(cross);
  expect(captureProviderSourceSelection(comment, body)).toEqual({ kind: 'unavailable' });
});

it('invalidates an excerpt when its selected text changes even if another matching word remains', () => {
  const { body, native } = fixture();
  select(body.querySelector('strong')?.firstChild);
  const captured = captureProviderSourceSelection(comment, body);
  if (captured === undefined) throw new Error('Missing captured excerpt.');
  body.querySelector('strong')?.replaceChildren('different');
  expect(mapProviderSourceSelection(captured, native, comment.id, comment.anchor, comment.url)).toBeNull();
});
