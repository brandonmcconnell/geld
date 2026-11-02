// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { readGitLabBotRequests } from './bot-request';
import { renderProviderBotRequest } from '../providers/bot-request';

const url = 'https://gitlab.com/group/nested/repo/-/merge_requests/42';
const head = 'a'.repeat(40);
const source: ProviderReviewComment = { id: '3436654383', anchor: 'note_3436654383', url: `${url}#note_3436654383`, author: { id: '38968537', login: 'group_117740890_bot_opaque', automated: true }, body: 'CodeRabbit walkthrough', createdAt: '2026-06-09T10:02:51.459Z' };
function input(): ProviderReviewInput { return { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/nested/repo', id: '42', headSha: head }, threads: [], bots: [{ id: 'coderabbit', authorId: source.author.id, login: source.author.login }] }; }
function mount(signedIn = false, nativeSource = source, displayName = 'CodeRabbit', route = url): void {
  window.location.href = route;
  document.body.innerHTML = `<div id="js-vue-mr-discussions" data-current-user-data='${signedIn ? '{"id":10}' : '{}'}' data-noteable-type="MergeRequest" data-noteable-data='{"diff_head_sha":"${head}"}'></div>
    <div id="${nativeSource.anchor}" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a class="author-name-link" data-user-id="${nativeSource.author.id}" data-username="${nativeSource.author.login}">${displayName}</a></div></div><div class="note-body"><div class="note-text">Original review</div></div></div></div></div>`;
}
beforeEach(() => mount());

describe('GitLab CodeRabbit command preparation evidence', () => {
  it('offers exact verified commands for an explicitly bound native account while anonymous', () => {
    const [request] = readGitLabBotRequests(document, input(), [source], false, () => true);
    expect(request?.commands.map((mode) => mode.text)).toEqual(['@coderabbitai review', '@coderabbitai full review']);
    expect(request?.current()).toBe(true);
    expect(request?.comment.available).toBe(false);
    expect(request?.sourceUrl).toBe(source.url);
    expect(source.author.login).not.toBe('coderabbitai');
  });

  it.each(['unbound', 'unsupported-service', 'wrong-id', 'wrong-login', 'bitbucket', 'short-head', 'wrong-review', 'wrong-origin', 'wrong-anchor', 'no-native-source'])('fails closed for %s', (condition) => {
    let review = input();let comment = source;
    if (condition === 'unbound') review = { ...review, bots: [] };
    if (condition === 'unsupported-service') review = { ...review, bots: [{ id: 'bugbot', authorId: source.author.id }] };
    if (condition === 'wrong-id') review = { ...review, bots: [{ id: 'coderabbit', authorId: '15780915' }] };
    if (condition === 'wrong-login') review = { ...review, bots: [{ id: 'coderabbit', authorId: source.author.id, login: 'copied-github-alias' }] };
    if (condition === 'bitbucket') review = { ...review, subject: { ...review.subject, provider: 'bitbucket' } };
    if (condition === 'short-head') review = { ...review, subject: { ...review.subject, headSha: 'aaaaaaa' } };
    if (condition === 'wrong-review') comment = { ...source, url: source.url.replace('/42#', '/43#') };
    if (condition === 'wrong-origin') comment = { ...source, url: source.url.replace('gitlab.com', 'evil.example') };
    if (condition === 'wrong-anchor') comment = { ...source, anchor: 'note_1' };
    if (condition === 'no-native-source') document.getElementById(source.anchor)?.remove();
    expect(readGitLabBotRequests(document, review, [comment], false, () => true)).toEqual([]);
  });

  it('does not treat a command-advertising body as account trust', () => {
    expect(readGitLabBotRequests(document, { ...input(), bots: [] }, [{ ...source, body: '@coderabbitai review' }], false, () => true)).toEqual([]);
  });

  it('rejects a source-shaped note inside user-controlled description content', () => {
    const description = document.createElement('div');description.dataset.testid = 'description-content';document.body.append(description);
    description.append(document.getElementById(source.anchor)!);
    expect(readGitLabBotRequests(document, input(), [source], false, () => true)).toEqual([]);
  });

  it('keeps copy available without promoting an SSR signed-in flag into a known composer account', () => {
    document.getElementById('js-vue-mr-discussions')?.removeAttribute('data-current-user-data');
    document.body.insertAdjacentHTML('beforeend', '<div class="js-mr-title-actions" data-is-signed-in="true"></div><textarea id="note-body">Keep draft</textarea>');
    const [request] = readGitLabBotRequests(document, input(), [source], true, () => true);
    expect(request?.current()).toBe(true);expect(request?.comment.available).toBe(false);
  });

  it.each(['route', 'head', 'viewer', 'remount', 'author', 'lifecycle', 'duplicate'])('invalidates captured source after %s changes', (condition) => {
    let live = true;
    const [request] = readGitLabBotRequests(document, input(), [source], false, () => live);
    expect(request?.current()).toBe(true);
    if (condition === 'route') window.location.href = url.replace('/42', '/43');
    if (condition === 'head') document.getElementById('js-vue-mr-discussions')?.setAttribute('data-noteable-data', JSON.stringify({ diff_head_sha: 'b'.repeat(40) }));
    if (condition === 'viewer') document.getElementById('js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":10}');
    if (condition === 'remount') { const root = document.getElementById(source.anchor)!;root.replaceWith(root.cloneNode(true)); }
    if (condition === 'author') document.querySelector('.author-name-link')?.setAttribute('data-user-id', '999');
    if (condition === 'lifecycle') live = false;
    if (condition === 'duplicate') document.body.append(document.getElementById(source.anchor)!.cloneNode(true));
    expect(request?.current()).toBe(false);
  });

  it('only focuses the exact native main writer and preserves its draft/selection without submission', async () => {
    mount(true);
    const field = document.createElement('textarea');field.id = 'note-body';field.value = 'Existing native draft';document.body.append(field);field.setSelectionRange(3, 9, 'backward');
    const submit = vi.fn();document.body.addEventListener('submit', submit);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const [request] = readGitLabBotRequests(document, input(), [source], true, () => true);
    expect(request?.comment.available).toBe(true);
    expect(await request?.comment.activate()).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Existing native draft');expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([3, 9, 'backward']);
    expect(submit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();document.body.removeEventListener('submit', submit);
  });

  it.each(['summary', 'thread', 'duplicate', 'readonly', 'disabled', 'hidden', 'rich', 'remount', 'focus-remount'])('never substitutes or restores over %s writer state', async (condition) => {
    mount(true);
    const field = document.createElement('textarea');field.id = condition === 'thread' ? 'note_note' : 'note-body';field.value = 'Keep draft';document.body.append(field);
    if (condition === 'summary') { const form = document.createElement('form');form.dataset.testid = 'submit-gl-form';field.before(form);form.append(field); }
    if (condition === 'duplicate') document.body.append(field.cloneNode(true));
    if (condition === 'readonly') field.readOnly = true;
    if (condition === 'disabled') field.disabled = true;
    if (condition === 'hidden') field.hidden = true;
    if (condition === 'rich') field.setAttribute('contenteditable', 'true');
    const [request] = readGitLabBotRequests(document, input(), [source], true, () => true);
    if (condition === 'remount') field.replaceWith(field.cloneNode(true));
    if (condition === 'focus-remount') field.addEventListener('focus', () => field.replaceWith(field.cloneNode(true)), { once: true });
    expect(await request?.comment.activate()).toBe(false);
    expect(field.value).toBe('Keep draft');
  });
});

// Reduced original Greptile note3381334808, retained from whitebox!272.
// The footer is observed native source, not the authority for a comment trigger or account trust.
const greptileUrl = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
const greptile: ProviderReviewComment = {
  id: '3381334808', anchor: 'note_3381334808', url: `${greptileUrl}#note_3381334808`,
  author: { id: '37628862', login: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b', automated: true },
  body: '<h3>Greptile Summary</h3>\n\n<h3>Confidence Score: 5/5</h3>\n\n<sub>Reviews (6): Last reviewed commit: ["ship it"](https://gitlab.com/whitebox-aero/whitebox/-/commit/5da09f9e31ad0d59c6f804a71380992955d1040f) | [Re-trigger Greptile](https://app.greptile.com/api/retrigger?id=33736413)</sub>',
  createdAt: '2026-05-25T08:20:44.347Z', updatedAt: '2026-06-17T03:55:42.680Z',
};
function greptileInput(): ProviderReviewInput {
  return { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/whitebox', id: '272', headSha: head }, threads: [], bots: [{ id: 'greptile', authorId: greptile.author.id, login: greptile.author.login }] };
}

describe('GitLab Greptile command preparation', () => {
  it('copies the one native-scoped command without following the source retrigger link or touching a draft', async () => {
    mount(false, greptile, 'Greptile', greptileUrl);
    const field = document.createElement('textarea');field.id = 'note-body';field.value = 'Keep my native draft';document.body.append(field);field.setSelectionRange(2, 8, 'backward');
    const root = document.getElementById(greptile.anchor)!;const original = root.outerHTML;const review = greptileInput();const facts = structuredClone(review);
    const [request] = readGitLabBotRequests(document, review, [greptile], false, () => true);
    if (request === undefined) throw new Error('Missing explicitly bound Greptile request.');
    const host = document.createElement('div');document.body.append(host);const copy = vi.fn(async () => undefined);const fetch = vi.spyOn(globalThis, 'fetch');
    const control = renderProviderBotRequest(host, request, copy);
    try {
      expect(host.querySelector('summary')?.textContent).toBe('Prepare Greptile request');
      expect(host.querySelector('[role="group"][aria-label="Review command mode"]')).toBeNull();
      expect(host.querySelector('code')?.textContent).toBe('@greptileai');
      expect(host.querySelector<HTMLButtonElement>('[data-geld-bot-request-action="comment"]')?.disabled).toBe(true);
      host.querySelector<HTMLButtonElement>('[data-geld-bot-request-action="copy"]')!.click();
      await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain('Command copied'));
      expect(copy).toHaveBeenCalledExactlyOnceWith('@greptileai');expect(fetch).not.toHaveBeenCalled();
      expect(root.outerHTML).toBe(original);expect(document.getElementById(greptile.anchor)).toBe(root);expect(review).toEqual(facts);
      expect(field.value).toBe('Keep my native draft');expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 8, 'backward']);
      expect(host.textContent).not.toMatch(/Review requested|Rerun started|Review running/);
    } finally { control.destroy();fetch.mockRestore(); }
  });

  it('offers only the documented GitLab Review literal for an explicitly bound native account', () => {
    mount(false, greptile, 'Greptile', greptileUrl);
    const original = structuredClone(greptile);
    const [request] = readGitLabBotRequests(document, greptileInput(), [greptile], false, () => true);
    expect(request?.label).toBe('Greptile');expect(request?.botId).toBe('greptile');
    expect(request?.commands).toEqual([{ id: 'review', label: 'Review', text: '@greptileai' }]);
    expect(request?.comment.available).toBe(false);expect(request?.sourceUrl).toBe(greptile.url);expect(request?.current()).toBe(true);
    expect(greptile).toEqual(original);expect(greptile.body).not.toContain('@greptileai');
  });

  it.each(['no-binding', 'wrong-account', 'github-alias', 'body-marker-only', 'missing-source', 'remounted-source', 'wrong-native-header', 'short-head', 'bitbucket'])('rejects %s rather than adopting the footer or an alias as trust', (condition) => {
    mount(false, greptile, 'Greptile', greptileUrl);
    let review = greptileInput();let comment = greptile;
    if (condition === 'no-binding' || condition === 'body-marker-only') review = { ...review, bots: [] };
    if (condition === 'body-marker-only') comment = { ...greptile, body: 'Greptile Summary @greptileai' };
    if (condition === 'wrong-account') review = { ...review, bots: [{ id: 'greptile', authorId: '15780915' }] };
    if (condition === 'github-alias') review = { ...review, bots: [{ id: 'greptile', authorId: greptile.author.id, login: 'greptile-apps[bot]' }] };
    if (condition === 'missing-source') document.getElementById(greptile.anchor)?.remove();
    if (condition === 'wrong-native-header') document.querySelector('.author-name-link')?.setAttribute('data-user-id', '999');
    if (condition === 'short-head') review = { ...review, subject: { ...review.subject, headSha: 'aaaaaaa' } };
    if (condition === 'bitbucket') review = { ...review, subject: { ...review.subject, provider: 'bitbucket' } };
    if (condition === 'remounted-source') {
      const [retained] = readGitLabBotRequests(document, review, [comment], false, () => true);
      const root = document.getElementById(greptile.anchor)!;root.replaceWith(root.cloneNode(true));
      expect(retained?.current()).toBe(false);return;
    }
    expect(readGitLabBotRequests(document, review, [comment], false, () => true)).toEqual([]);
  });

  it('makes service-specific descriptor keys even if the reader rebinds the same native account', () => {
    mount(false, greptile, 'Greptile', greptileUrl);
    const review = greptileInput();
    const [before] = readGitLabBotRequests(document, review, [greptile], false, () => true);
    const [after] = readGitLabBotRequests(document, { ...review, bots: [{ id: 'coderabbit', authorId: greptile.author.id }] }, [greptile], false, () => true);
    expect(before?.key).not.toBe(after?.key);expect(after?.commands.map((mode) => mode.text)).toEqual(['@coderabbitai review', '@coderabbitai full review']);
  });

  it('opens only the native writer, retaining its draft and selection without fetching or posting', async () => {
    mount(true, greptile, 'Greptile', greptileUrl);
    const field = document.createElement('textarea');field.id = 'note-body';field.value = 'An existing native draft';document.body.append(field);field.setSelectionRange(3, 12, 'backward');
    const submit = vi.fn();document.body.addEventListener('submit', submit);const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const [request] = readGitLabBotRequests(document, greptileInput(), [greptile], true, () => true);
      expect(await request?.comment.activate()).toBe(true);expect(document.activeElement).toBe(field);
      expect(field.value).toBe('An existing native draft');expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([3, 12, 'backward']);
      expect(submit).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
    } finally { document.body.removeEventListener('submit', submit);fetch.mockRestore(); }
  });
});
