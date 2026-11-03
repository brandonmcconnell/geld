// @vitest-environment happy-dom
import type { ProviderReviewAction } from '../providers/types';
import { gitLabActionVisit } from './actions';
import { readGitLabOpenReview } from './open-review';
import type { GitLabReviewerScope } from './reviewer-controls';

const head = 'a'.repeat(40);
const url = 'https://gitlab.com/group/subgroup/repo/-/merge_requests/7';
const review: GitLabReviewerScope = {
  subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/repo', id: '7', headSha: head },
  projectId: '27', noteableId: '81',
};
let generation: object;
const context = { current: () => true };

function note(changes: Readonly<Record<string, unknown>> = {}): void {
  document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-noteable-data', JSON.stringify({ id: 81, iid: 7, project_id: 27, diff_head_sha: head,
    current_user: { can_update: false, can_approve: false }, ...changes }));
}

function mount(outcome = 'approved'): HTMLButtonElement {
  document.body.innerHTML = `<section><div id="js-vue-mr-discussions" data-noteable-type="MergeRequest" data-current-user-data='{"id":10}'></div></section>
    <header><button type="button" data-testid="review-drawer-toggle">Your review</button></header>
    <div data-testid="review-drawer-toggle" class="merge-request-review-drawer" style="display:none"><form data-testid="submit-gl-form">
      <div data-testid="reviewer_states"><input type="radio" name="state" value="reviewed"><input type="radio" name="state" value="approved"><input type="radio" name="state" value="requested_changes"></div>
      <textarea data-testid="comment-textarea">Keep this review draft.</textarea><button type="submit" data-testid="submit-review-button">Submit review</button>
      <button type="button" data-testid="discard-review-btn">Discard review</button></form></div><textarea id="note-body">Keep main draft.</textarea>`;
  note();
  const button = document.querySelector<HTMLButtonElement>('header button');
  const radio = document.querySelector<HTMLInputElement>(`input[value="${outcome}"]`);
  const writer = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"]');
  if (button === null || radio === null || writer === null) throw new Error('Missing native unit protocol control.');
  radio.checked = true;writer.setSelectionRange(5, 9, 'backward');
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => button);
  return button;
}

function read(complete = true, scope: GitLabReviewerScope | null = review): ProviderReviewAction | null {
  return readGitLabOpenReview(document, scope, gitLabActionVisit(document), complete, generation);
}

function required(): ProviderReviewAction {
  const action = read();if (action === null) throw new Error('Missing unit protocol opener.');return action;
}

beforeEach(() => {
  window.location.href = url;generation = {};
  // Measured layout and identity are explicit unit inputs, never authenticated acceptance.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 50, 20));
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
});
afterEach(() => { document.body.replaceChildren();vi.restoreAllMocks(); });

describe('GitLab native Open your review intent', () => {
  it.each(['reviewed', 'approved', 'requested_changes'])('opens the exact zero-draft native button without changing %s or any existing draft', async (outcome) => {
    const button = mount(outcome);const original = document.body.innerHTML;
    const writer = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"]');
    const main = document.querySelector<HTMLTextAreaElement>('#note-body');
    if (writer === null || main === null) throw new Error('Missing native drafts.');
    const nativeClick = vi.fn();button.addEventListener('click', nativeClick);
    const writes = vi.fn();const form = document.querySelector('form');
    for (const event of ['click', 'input', 'change', 'submit', 'reset', 'focusin']) form?.addEventListener(event, writes);
    main.addEventListener('focus', writes);
    const action = required();expect(action.kind).toBe('open-review');expect(action.available).toBe(true);
    expect(action.scopeKey).toMatch(/^gitlab-open-review-\d+$/);
    expect(await action.activate(context)).toBe(true);
    expect(nativeClick).toHaveBeenCalledOnce();expect(writes).not.toHaveBeenCalled();expect(document.activeElement).toBe(button);
    expect(document.body.innerHTML).toBe(original);expect(writer.value).toBe('Keep this review draft.');
    expect([writer.selectionStart, writer.selectionEnd, writer.selectionDirection]).toEqual([5, 9, 'backward']);
    expect(main.value).toBe('Keep main draft.');expect(document.querySelector<HTMLInputElement>(`input[value="${outcome}"]`)?.checked).toBe(true);
    expect(button.hasAttribute('aria-expanded')).toBe(false);expect(button.hasAttribute('tabindex')).toBe(false);
  });

  it('returns only a native open intent even when the original handler has not hydrated a drawer', async () => {
    const button = mount();document.querySelector('form')?.parentElement?.remove();
    const click = vi.fn();button.addEventListener('click', click);
    expect(await required().activate(context)).toBe(true);expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('form')).toBeNull();
  });

  it('does not wait for, select or focus a drawer that the original click mounts', async () => {
    const button = mount('requested_changes');const drawer = document.querySelector<HTMLElement>('.merge-request-review-drawer');
    if (drawer === null) throw new Error('Missing drawer.');
    button.addEventListener('click', () => { drawer.style.display = 'block'; });
    const writes = vi.fn();drawer.addEventListener('input', writes);drawer.addEventListener('change', writes);drawer.addEventListener('submit', writes);
    expect(await required().activate(context)).toBe(true);expect(document.activeElement).toBe(button);expect(writes).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('input[value="requested_changes"]')?.checked).toBe(true);expect(read()).toBeNull();
  });

  it('requires a current caller and never clicks with a missing or false context', async () => {
    const button = mount();const click = vi.fn();button.addEventListener('click', click);const action = required();
    expect(await action.activate()).toBe(false);expect(await action.activate({ current: () => false })).toBe(false);
    expect(click).not.toHaveBeenCalled();expect(button.scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps a stable source scope during harmless reads and retires it on a new fetched generation', async () => {
    mount();const first = required();expect(required().scopeKey).toBe(first.scopeKey);
    generation = {};const next = required();expect(next.scopeKey).not.toBe(first.scopeKey);
    expect(await first.activate(context)).toBe(false);expect(await next.activate(context)).toBe(true);
  });

  it('reads later hydration without adopting a removed control or expired descriptor', async () => {
    const button = mount();const parent = button.parentElement;if (parent === null) throw new Error('Missing native parent.');
    button.remove();expect(read()).toBeNull();parent.append(button);const old = required();
    button.disabled = true;expect(read()).toBeNull();button.disabled = false;const enabled = required();
    expect(enabled.scopeKey).not.toBe(old.scopeKey);expect(await old.activate(context)).toBe(false);
    button.replaceWith(button.cloneNode(true));const next = required();expect(next.scopeKey).not.toBe(enabled.scopeKey);expect(await enabled.activate(context)).toBe(false);
  });

  it.each(['viewer', 'head', 'project', 'iid', 'noteable', 'unknown-head', 'unknown-viewer', 'generic-viewer', 'partial', 'no-scope'] as const)('declines %s without an inferred auth or permission substitute', (invalid) => {
    mount();
    if (invalid === 'viewer') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":0}');
    if (invalid === 'head') note({ diff_head_sha: 'b'.repeat(40) });
    if (invalid === 'project') note({ project_id: 28 });
    if (invalid === 'iid') note({ iid: 8 });
    if (invalid === 'noteable') note({ id: 82 });
    if (invalid === 'unknown-head') note({ diff_head_sha: null });
    if (invalid === 'unknown-viewer') document.querySelector('#js-vue-mr-discussions')?.removeAttribute('data-current-user-data');
    if (invalid === 'generic-viewer') { document.querySelector('#js-vue-mr-discussions')?.removeAttribute('data-current-user-data');document.body.insertAdjacentHTML('beforeend', '<div class="js-mr-title-actions" data-is-signed-in="true"></div>'); }
    expect(read(invalid !== 'partial', invalid === 'no-scope' ? null : review)).toBeNull();
  });

  it.each(['partial-head', 'other-repository', 'other-origin', 'malformed-note', 'duplicate-note'] as const)('requires exact independent snapshot/native scope for %s', (invalid) => {
    mount();let expected = review;
    if (invalid === 'partial-head') { expected = { ...review, subject: { ...review.subject, headSha: head.slice(0, 12) } };note({ diff_head_sha: head.slice(0, 12) }); }
    if (invalid === 'other-repository') expected = { ...review, subject: { ...review.subject, repository: 'other/repo' } };
    if (invalid === 'other-origin') expected = { ...review, subject: { ...review.subject, origin: 'https://other.example' } };
    if (invalid === 'malformed-note') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-noteable-data', '{');
    if (invalid === 'duplicate-note') { const root = document.querySelector('#js-vue-mr-discussions');if (root !== null) document.body.append(root.cloneNode(true)); }
    expect(read(true, expected)).toBeNull();
  });

  it.each(['route', 'tab', 'head', 'viewer', 'root', 'root-parent', 'metadata', 'control', 'parent'] as const)('refuses a captured opener after %s changes', async (change) => {
    const button = mount();const visit = gitLabActionVisit(document);const action = required();const click = vi.fn();button.addEventListener('click', click);
    const root = document.querySelector('#js-vue-mr-discussions');if (root === null) throw new Error('Missing root.');
    if (change === 'route') window.history.replaceState(null, '', url.replace('/7', '/8'));
    if (change === 'tab') window.history.replaceState(null, '', `${url}/diffs`);
    if (change === 'head') note({ diff_head_sha: 'b'.repeat(40) });
    if (change === 'viewer') root.setAttribute('data-current-user-data', '{"id":11}');
    if (change === 'root') root.replaceWith(root.cloneNode(true));
    if (change === 'root-parent') { const replacement = document.createElement('section');root.parentElement?.replaceWith(replacement);replacement.append(root); }
    if (change === 'metadata') note({ current_user: { can_update: true } });
    if (change === 'control') button.replaceWith(button.cloneNode(true));
    if (change === 'parent') { const header = document.createElement('header');button.parentElement?.replaceWith(header);header.append(button); }
    expect(await action.activate(context)).toBe(false);expect(click).not.toHaveBeenCalled();
    if (change === 'tab') {
      expect(readGitLabOpenReview(document, review, visit, true, generation)).toBeNull();
      expect(required().scopeKey).not.toBe(action.scopeKey);
    }
  });

  it.each(['disabled', 'readonly', 'hidden', 'inert', 'aria-disabled', 'aria-readonly', 'aria-busy', 'aria-expanded'])('declines a control marked %s', (attribute) => {
    const button = mount();button.setAttribute(attribute, attribute.startsWith('aria-') ? 'true' : '');expect(read()).toBeNull();
  });

  it.each(['duplicate', 'submit', 'negative-tabindex', 'unmeasured', 'authored', 'owned', 'form', 'opaque', 'no-button'] as const)('declines %s source controls', (invalid) => {
    const button = mount();
    if (invalid === 'duplicate') button.parentElement?.append(button.cloneNode(true));
    if (invalid === 'submit') button.type = 'submit';
    if (invalid === 'negative-tabindex') button.tabIndex = -1;
    if (invalid === 'unmeasured') vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect());
    if (invalid === 'authored') button.parentElement?.classList.add('note-body');
    if (invalid === 'owned') button.parentElement?.setAttribute('data-geld-ui', '');
    if (invalid === 'form') { const form = document.createElement('form');button.replaceWith(form);form.append(button); }
    if (invalid === 'opaque') button.style.opacity = '0';
    if (invalid === 'no-button') button.remove();
    expect(read()).toBeNull();
  });

  it('ignores authored replicas and requires the actual non-button drawer to be closed', () => {
    const button = mount();document.body.insertAdjacentHTML('beforeend', '<div class="note-body"><button type="button" data-testid="review-drawer-toggle">Forged</button></div>');
    expect(read()?.available).toBe(true);button.remove();expect(read()).toBeNull();
    mount();const drawer = document.querySelector<HTMLElement>('.merge-request-review-drawer');if (drawer === null) throw new Error('Missing drawer.');
    drawer.style.display = 'block';drawer.style.opacity = '0';expect(read()).toBeNull();
  });

  it.each(['note', 'note-text', 'md', 'noteable-note-container'])('quarantines the drawer marker under the authored %s surface despite valid viewer and source metadata', async (kind) => {
    const button = mount();const wrapper = document.createElement('div');
    if (kind === 'noteable-note-container') wrapper.dataset.testid = kind;
    else wrapper.className = kind;
    button.replaceWith(wrapper);wrapper.append(button);
    const click = vi.fn();button.addEventListener('click', click);
    expect(read()).toBeNull();expect(click).not.toHaveBeenCalled();expect(button.scrollIntoView).not.toHaveBeenCalled();
    const original = button.cloneNode(true);const nativeParent = document.createElement('header');nativeParent.append(original);document.body.append(nativeParent);
    expect(read()?.available).toBe(true);
  });

  it.each(['note', 'note-text', 'md', 'noteable-note-container'])('still preserves an original writer inside %s when quarantining candidate buttons', async (kind) => {
    const button = mount();const writer = document.querySelector<HTMLTextAreaElement>('#note-body');if (writer === null) throw new Error('Missing native main writer.');
    const wrapper = document.createElement('div');if (kind === 'noteable-note-container') wrapper.dataset.testid = kind;
    else wrapper.className = kind;
    writer.replaceWith(wrapper);wrapper.append(writer);
    const click = vi.fn();button.addEventListener('click', click);button.addEventListener('focus', () => { writer.value = 'Native edit while focusing.'; });
    const action = required();expect(await action.activate(context)).toBe(false);expect(click).not.toHaveBeenCalled();
    expect(writer.value).toBe('Native edit while focusing.');
  });

  it.each(['dialog', 'menu', 'listbox', 'dropdown', 'opening', 'editor'] as const)('does not displace an existing %s surface', (kind) => {
    mount();const overlay = document.createElement('div');
    if (kind === 'dropdown') overlay.className = 'dropdown-menu';
    else if (kind === 'opening') { overlay.className = 'gl-new-dropdown-panel !gl-block';overlay.style.display = 'none'; }
    else if (kind === 'editor') { const field = document.querySelector<HTMLTextAreaElement>('#note-body');field?.focus(); }
    else overlay.setAttribute('role', kind);
    if (kind !== 'editor') document.body.append(overlay);expect(read()).toBeNull();
  });

  it.each(['scroll', 'focus', 'draft', 'selection', 'outcome', 'overlay', 'caller', 'hit', 'focus-hit'] as const)('rechecks native source and drafts at the %s boundary', async (phase) => {
    const button = mount();const action = required();const click = vi.fn();button.addEventListener('click', click);let caller = true;
    const writer = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"]');if (writer === null) throw new Error('Missing writer.');
    if (phase === 'scroll') vi.spyOn(button, 'scrollIntoView').mockImplementation(() => note({ project_id: 28 }));
    if (phase === 'focus') button.addEventListener('focus', () => button.replaceWith(button.cloneNode(true)));
    if (phase === 'draft') button.addEventListener('focus', () => { writer.value = 'Native changed draft.'; });
    if (phase === 'selection') button.addEventListener('focus', () => writer.setSelectionRange(0, 0));
    if (phase === 'outcome') button.addEventListener('focus', () => { const field = document.querySelector<HTMLInputElement>('input[value="reviewed"]');if (field !== null) field.checked = true; });
    if (phase === 'overlay') button.addEventListener('focus', () => document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Native picker</div>'));
    if (phase === 'caller') button.addEventListener('focus', () => { caller = false; });
    if (phase === 'hit') vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body);
    if (phase === 'focus-hit') button.addEventListener('focus', () => { vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body); });
    expect(await action.activate({ current: () => caller })).toBe(false);expect(click).not.toHaveBeenCalled();
    if (phase === 'draft') expect(writer.value).toBe('Native changed draft.');
  });

  it.each(['route', 'head', 'viewer', 'root', 'disabled', 'generation'] as const)('does not click after focus-time %s drift', async (change) => {
    const button = mount();const action = required();const click = vi.fn();button.addEventListener('click', click);
    button.addEventListener('focus', () => {
      if (change === 'route') window.history.replaceState(null, '', `${url}/diffs`);
      if (change === 'head') note({ diff_head_sha: 'b'.repeat(40) });
      if (change === 'viewer') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":11}');
      if (change === 'root') { const root = document.querySelector('#js-vue-mr-discussions');root?.replaceWith(root.cloneNode(true)); }
      if (change === 'disabled') button.disabled = true;
      if (change === 'generation') { generation = {};read(); }
    });
    expect(await action.activate(context)).toBe(false);expect(click).not.toHaveBeenCalled();
  });
});
