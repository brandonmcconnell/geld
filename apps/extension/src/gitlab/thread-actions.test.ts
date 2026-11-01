// @vitest-environment happy-dom
import type { GitLabNativeThreadCapabilities } from './review';
import { activateGitLabThreadAction, readGitLabThreadActions, syncGitLabNativeReviewState } from './thread-actions';
import type { ProviderReviewInput } from '@geld/review';
import type { GitLabThreadTarget } from './thread-actions';
import { captureProviderSourceSelection } from '../providers/source-selection';

const ID = 'a'.repeat(40);
const target: GitLabThreadTarget = { discussionId: ID, noteId: '11', url: 'https://gitlab.com/group/repo/-/merge_requests/7#note_11' };
const permissions: GitLabNativeThreadCapabilities = {
  discussionId: ID, resolvable: true, resolved: false, canResolve: true,
  notes: [{ noteId: '11', canEdit: true, canReact: true, canResolve: true, canResolveDiscussion: true }],
};

function mount(resolved = false, controls = ''): void {
  document.body.innerHTML = `<div data-testid="discussion-content" data-discussion-id="${ID}" data-discussion-resolvable="true" data-discussion-resolved="${resolved}"><li id="note_11" data-testid="noteable-note-container"><div class="note-body"><div class="note-text">The source text to quote.</div></div>${controls}</li><div data-testid="reply-wrapper"></div><button data-testid="resolve-discussion-button">${resolved ? 'Reopen thread' : 'Resolve thread'}</button></div>`;
}

beforeEach(() => { window.location.href = new URL(target.url).origin + new URL(target.url).pathname; });

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; document.getSelection()?.removeAllRanges(); });

function selectedCopy() {
  const native = document.querySelector<HTMLElement>('.note-text');
  if (native === null) throw new Error('Missing native comment.');
  const panel = document.createElement('section'); panel.dataset.geldUi = '';
  const article = document.createElement('article'); article.dataset.geldSource = 'note_11'; article.dataset.geldSourceId = '11'; article.dataset.geldSourceUrl = target.url;
  const body = document.createElement('div'); body.className = 'geld-provider-review__body'; body.innerHTML = native.innerHTML;
  article.append(body); panel.append(article); document.body.append(panel);
  const text = body.firstChild;
  if (text === null) throw new Error('Missing copied text.');
  const range = document.createRange(); range.setStart(text, 4); range.setEnd(text, 10);
  document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
  const selection = captureProviderSourceSelection({ id: '11', anchor: 'note_11', url: target.url, author: { id: '23', login: 'author' }, body: native.textContent ?? '', createdAt: '2026-11-01T12:00:00Z' }, body);
  if (selection === undefined) throw new Error('Missing captured excerpt.');
  return { body, native, selection };
}

describe('GitLab native thread action relay', () => {
  it('opens a native reply field and never clicks its posting control', async () => {
    mount(false, '<button class="js-reply-button" data-track-label="reply_comment_button">Reply</button>');
    const posted = vi.fn();
    document.querySelector('.js-reply-button')?.addEventListener('click', () => {
      const host = document.querySelector('[data-testid="reply-wrapper"]');
      if (host !== null) {
        host.innerHTML = '<textarea data-testid="reply-field"></textarea><button data-testid="reply-comment-button">Reply</button>';
        host.querySelector('button')?.addEventListener('click', posted);
      }
    });
    const reveal = vi.fn(() => true);
    expect(await activateGitLabThreadAction('reply', document, target, permissions, { signedIn: true, onReveal: reveal })).toBe(true);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('reply-field');
    expect(reveal).toHaveBeenCalledWith(target);
    expect(posted).not.toHaveBeenCalled();
  });

  it('refuses unavailable, unsigned and disabled native mutations', async () => {
    mount(false, '<button data-testid="note-emoji-button">React</button>');
    const resolve = vi.fn();
    document.querySelector('[data-testid="resolve-discussion-button"]')?.addEventListener('click', resolve);
    expect(await activateGitLabThreadAction('resolve', document, target, permissions, { signedIn: false })).toBe(false);
    expect(await activateGitLabThreadAction('resolve', document, target, { ...permissions, canResolve: false }, { signedIn: true })).toBe(false);
    document.querySelector('[data-testid="resolve-discussion-button"]')?.setAttribute('disabled', '');
    expect(await activateGitLabThreadAction('resolve', document, target, permissions, { signedIn: true })).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(readGitLabThreadActions(document, target, permissions, { signedIn: false }).filter((entry) => entry.kind !== 'menu').every((entry) => !entry.available)).toBe(true);
  });

  it('rechecks native resolved state after revealing so stale Resolve cannot reopen a thread', async () => {
    mount();
    const clicked = vi.fn();
    document.querySelector('button')?.addEventListener('click', clicked);
    expect(await activateGitLabThreadAction('resolve', document, target, permissions, {
      signedIn: true,
      onReveal: () => { document.querySelector('[data-discussion-id]')?.setAttribute('data-discussion-resolved', 'true'); },
    })).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
    expect(readGitLabThreadActions(document, target, permissions, { signedIn: true }).find((entry) => entry.kind === 'reopen')?.available).toBe(true);
    expect(await activateGitLabThreadAction('reopen', document, target, permissions, { signedIn: true })).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('abandons a delayed action when revealing crosses to another review', async () => {
    mount();
    const original = window.location.href;
    const clicked = vi.fn();
    document.querySelector('button')?.addEventListener('click', clicked);
    try {
      expect(await activateGitLabThreadAction('resolve', document, target, permissions, {
        signedIn: true,
        onReveal: async () => { window.history.replaceState(null, '', '/group/repo/-/merge_requests/8'); },
      })).toBe(false);
      expect(clicked).not.toHaveBeenCalled();
    } finally { window.history.replaceState(null, '', original); }
  });

  it('opens only the selected note reaction picker', async () => {
    mount(false, '<button data-testid="note-emoji-button">React</button>');
    document.body.insertAdjacentHTML('beforeend', '<li id="note_12" data-testid="noteable-note-container"><button data-testid="note-emoji-button">Other reaction</button></li>');
    const own = vi.fn();
    const other = vi.fn();
    document.querySelector('#note_11 button')?.addEventListener('click', own);
    document.querySelector('#note_12 button')?.addEventListener('click', other);
    expect(await activateGitLabThreadAction('react', document, target, permissions, { signedIn: true })).toBe(true);
    expect(own).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    expect(await activateGitLabThreadAction('react', document, target, { ...permissions, notes: permissions.notes.map((note) => ({ ...note, canReact: false })) }, { signedIn: true })).toBe(false);
  });

  it('edits through its owned native menu without borrowing another note menu', async () => {
    mount(false, '<div class="more-actions"><button id="toggle-11" data-testid="base-dropdown-toggle" aria-controls="menu-11">Menu</button></div>');
    document.body.insertAdjacentHTML('beforeend', '<div id="other-menu"><button data-testid="edit-note-action">Wrong edit</button></div>');
    const wrong = vi.fn();
    document.querySelector('#other-menu button')?.addEventListener('click', wrong);
    document.querySelector('#toggle-11')?.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="menu-11"><ul aria-labelledby="toggle-11"><li data-testid="edit-note-action"><button>Edit</button></li></ul></div>');
      document.querySelector('#menu-11 button')?.addEventListener('click', () => {
        document.querySelector('#note_11')?.insertAdjacentHTML('beforeend', '<textarea>Saved original words</textarea>');
      });
    });
    expect(await activateGitLabThreadAction('edit', document, target, permissions, { signedIn: true })).toBe(true);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    expect(wrong).not.toHaveBeenCalled();
  });

  it('quotes the real native comment through the first-party quoteReply handler', async () => {
    mount(false, '<button class="js-reply-button" data-track-label="reply_comment_button">Reply</button>');
    let selected = '';
    document.querySelector('[data-discussion-id]')?.addEventListener('quoteReply', () => {
      selected = document.getSelection()?.toString() ?? '';
      document.querySelector('[data-testid="reply-wrapper"]')?.insertAdjacentHTML('beforeend', '<textarea data-testid="reply-field"></textarea>');
    });
    expect(await activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true })).toBe(true);
    expect(selected).toBe('The source text to quote.');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('reply-field');
  });

  it('quotes the selected digest excerpt through the native event while preserving the native editor and draft', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    document.querySelector('[data-testid="reply-wrapper"]')?.insertAdjacentHTML('beforeend', '<textarea data-testid="reply-field">Existing native draft</textarea><button data-testid="reply-comment-button">Send</button><button data-testid="cancel">Cancel</button>');
    const field = document.querySelector<HTMLTextAreaElement>('textarea');
    if (field === null) throw new Error('Missing native draft fixture.');
    const { selection, native } = selectedCopy();
    const original = native.firstChild;
    const controls = vi.fn(); document.querySelectorAll('[data-testid="reply-wrapper"] button').forEach((button) => button.addEventListener('click', controls));
    let quoted = '';
    document.querySelector('[data-discussion-id]')?.addEventListener('quoteReply', () => {
      quoted = document.getSelection()?.toString() ?? '';
      // Models the first-party append delegate, not authenticated GitLab acceptance.
      field.value += `\n> ${quoted}`; field.setSelectionRange(2, 4);
    });
    expect(await activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection } })).toBe(true);
    expect(quoted).toBe('source');
    expect(field.value).toBe('Existing native draft\n> source');
    expect(document.querySelector('textarea')).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 4]);
    expect(native.firstChild).toBe(original);
    expect(controls).not.toHaveBeenCalled();
  });

  it('refuses an explicit excerpt after either body or source identity changes instead of quoting the whole comment', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    const { selection, native } = selectedCopy();
    const quoted = vi.fn(); document.querySelector('[data-discussion-id]')?.addEventListener('quoteReply', quoted);
    native.append(' Updated source.');
    expect(await activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection } })).toBe(false);
    expect(quoted).not.toHaveBeenCalled();
    native.lastChild?.remove();
    if (selection.kind !== 'excerpt') throw new Error('Missing excerpt.');
    expect(await activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection: { ...selection, sourceId: '12' } } })).toBe(false);
    expect(quoted).not.toHaveBeenCalled();
  });

  it('keeps a real native-body selection without requiring a digest range', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    const native = document.querySelector('.note-text')?.firstChild;
    if (native === null || native === undefined) throw new Error('Missing native text.');
    const range = document.createRange(); range.setStart(native, 4); range.setEnd(native, 10); document.getSelection()?.addRange(range);
    let quoted = '';
    document.querySelector('[data-discussion-id]')?.addEventListener('quoteReply', () => { quoted = document.getSelection()?.toString() ?? ''; document.querySelector('[data-testid="reply-wrapper"]')?.insertAdjacentHTML('beforeend', '<textarea data-testid="reply-field"></textarea>'); });
    expect(await activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection: { kind: 'unavailable' } } })).toBe(true);
    expect(quoted).toBe('source');
  });

  it('does not quote or overwrite a newer user selection while revealing asynchronously', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    const { selection } = selectedCopy();
    let reveal: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { reveal = resolve; });
    const quoted = vi.fn(); document.querySelector('[data-discussion-id]')?.addEventListener('quoteReply', quoted);
    const pending = activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection }, onReveal: () => waiting });
    const other = document.createElement('p'); other.textContent = 'New user selection'; document.body.append(other);
    const range = document.createRange(); range.selectNodeContents(other); document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
    reveal?.();
    expect(await pending).toBe(false);
    expect(quoted).not.toHaveBeenCalled();
    expect(document.getSelection()?.toString()).toBe('New user selection');
  });

  it('keeps a newer selection and focus when the native reply form arrives later', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    const { selection } = selectedCopy();
    const pending = activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection } });
    const other = document.createElement('p'); other.textContent = 'A newer passage'; document.body.append(other);
    const range = document.createRange(); range.selectNodeContents(other); document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
    document.querySelector('[data-testid="reply-wrapper"]')?.insertAdjacentHTML('beforeend', '<textarea data-testid="reply-field">Later draft</textarea>');
    expect(await pending).toBe(false);
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
    expect(document.getSelection()?.toString()).toBe('A newer passage');
  });

  it('stops a delayed quote on lifecycle invalidation and refuses cross-review target URLs', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    const { selection } = selectedCopy();
    const quoted = vi.fn(); document.querySelector('[data-discussion-id]')?.addEventListener('quoteReply', quoted);
    let current = true;
    expect(await activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection, current: () => current }, onReveal: async () => { current = false; } })).toBe(false);
    expect(quoted).not.toHaveBeenCalled();
    expect(await activateGitLabThreadAction('quote', document, { ...target, url: target.url.replace('/7#', '/8#') }, permissions, { signedIn: true })).toBe(false);
    expect(quoted).not.toHaveBeenCalled();
  });

  it('does not focus or restore a stale selection after the source remounts or the review changes', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    const { selection } = selectedCopy();
    const pending = activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection } });
    window.location.href = target.url.replace('/7#', '/8#');
    document.querySelector('[data-testid="reply-wrapper"]')?.insertAdjacentHTML('beforeend', '<textarea data-testid="reply-field">Different review</textarea>');
    expect(await pending).toBe(false);
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
  });

  it('does not focus a delayed native form after the original body is edited in place', async () => {
    mount(false, '<button class="js-reply-button">Reply</button>');
    const { selection, native } = selectedCopy();
    const pending = activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection } });
    native.append(' Edited while the native handler was waiting.');
    document.querySelector('[data-testid="reply-wrapper"]')?.insertAdjacentHTML('beforeend', '<textarea data-testid="reply-field">Native draft</textarea>');
    expect(await pending).toBe(false);
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
  });

  it('restores the original excerpt only when an unanswered native event still owns the unchanged selection', async () => {
    vi.useFakeTimers();
    mount(false, '<button class="js-reply-button">Reply</button>');
    const { selection, body } = selectedCopy();
    const pending = activateGitLabThreadAction('quote', document, target, permissions, { signedIn: true, context: { selection } });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe(false);
    expect(body.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
    expect(document.getSelection()?.toString()).toBe('source');
  });

  it('cannot resolve an unknown native state or cross into a different discussion', async () => {
    mount();
    const clicked = vi.fn();
    document.querySelector('button')?.addEventListener('click', clicked);
    document.querySelector('[data-discussion-id]')?.removeAttribute('data-discussion-resolved');
    expect(await activateGitLabThreadAction('resolve', document, target, permissions, { signedIn: true })).toBe(false);
    document.querySelector('[data-discussion-id]')?.setAttribute('data-discussion-id', 'b'.repeat(40));
    expect(await activateGitLabThreadAction('resolve', document, target, permissions, { signedIn: true })).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('ignores matching controls inside Geld UI and allows only a native unsigned menu', async () => {
    mount(false, '<div class="more-actions"><button id="toggle-11" data-testid="base-dropdown-toggle" aria-controls="menu-11">Menu</button></div>');
    const clicked = vi.fn();
    document.querySelector('#toggle-11')?.addEventListener('click', clicked);
    expect(await activateGitLabThreadAction('menu', document, target, permissions, { signedIn: false })).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
    document.querySelector('[data-discussion-id]')?.setAttribute('data-geld-ui', '');
    expect(readGitLabThreadActions(document, target, permissions, { signedIn: true }).every((entry) => !entry.available)).toBe(true);
  });

  it('updates resolution from explicit matching native state while retaining outdated state', () => {
    mount(true);
    const input: ProviderReviewInput = {
      subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '7', headSha: 'a'.repeat(40) },
      threads: [{ id: ID, anchor: `discussion_${ID}`, url: target.url, resolved: false, outdated: true, comments: [{ id: '11', anchor: 'note_11', url: target.url, author: { id: '23', login: 'author' }, body: 'Question', createdAt: '2026-11-01T12:00:00Z' }] }],
    };
    const changed = syncGitLabNativeReviewState(input, document);
    expect(changed.threads[0]).toMatchObject({ resolved: true, outdated: true });
    expect(input.threads[0]?.resolved).toBe(false);
    document.querySelector('[data-discussion-id]')?.removeAttribute('data-discussion-resolved');
    expect(syncGitLabNativeReviewState(input, document)).toBe(input);
    document.querySelector('[data-discussion-id]')?.setAttribute('data-discussion-resolved', 'true');
    document.querySelector('[data-discussion-id]')?.setAttribute('data-geld-ui', '');
    expect(syncGitLabNativeReviewState(input, document)).toBe(input);
  });
});
