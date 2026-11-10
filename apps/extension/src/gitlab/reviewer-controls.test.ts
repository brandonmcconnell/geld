// @vitest-environment happy-dom
import type { ProviderReviewSubject } from '@geld/review';
import { gitLabActionVisit } from './actions';
import { readGitLabReviewerControls } from './reviewer-controls';
import type { GitLabReviewerScope } from './reviewer-controls';

const head = 'a'.repeat(40);
const reviewUrl = 'https://gitlab.com/group/subgroup/repo/-/merge_requests/7';
const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/repo', id: '7', headSha: head };
const scope: GitLabReviewerScope = { subject, projectId: '27', noteableId: '81' };

function mount(kind: 'legacy' | 'modern' | 'assign' = 'legacy'): HTMLButtonElement {
  document.body.innerHTML = `<div id="js-vue-mr-discussions" data-current-user-data='{"id":10}' data-noteable-type="MergeRequest"></div>
    <aside data-testid="issuable-sidebar" data-issuable-type="merge_request"><div data-testid="reviewers-block-container">${kind === 'assign'
      ? '<button type="button" data-testid="sidebar-reviewers-assign-button">Assign</button>'
      : kind === 'legacy'
      ? `<div class="selectbox"><input type="hidden" name="merge_request[reviewer_ids][]" value="14"><div class="dropdown"><button type="button" class="js-reviewer-search" data-toggle="dropdown" data-current-user="true" data-iid="7" data-issuable-type="merge_request" data-project-id="27" data-field-name="merge_request[reviewer_ids][]" data-issue-update="/group/subgroup/repo/-/merge_requests/7.json" data-ability-name="merge_request">Select reviewers</button><div class="dropdown-menu" style="display:none"><input type="search" data-testid="dropdown-input-field"></div></div></div>`
      : `<div class="reviewers-dropdown gl-new-dropdown"><div data-testid="base-dropdown-toggle"><button type="button" data-testid="reviewers-edit-button">Edit</button></div><div class="gl-new-dropdown-container"><div data-testid="base-dropdown-menu" class="gl-new-dropdown-panel" style="display:none"><input data-testid="listbox-search-input"></div></div></div>`}</div></aside>
    <textarea id="note-body">Existing comment draft</textarea>`;
  setNote();
  const button = document.querySelector<HTMLButtonElement>('aside button');
  if (button === null) throw new Error('Missing native fixture button');
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => button);
  return button;
}

function setNote(changes: Readonly<Record<string, unknown>> = {}): void {
  document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-noteable-data', JSON.stringify({ id: 81, iid: 7, project_id: 27, diff_head_sha: head, current_user: { can_update: true }, ...changes }));
}

function read(complete = true): ReturnType<typeof readGitLabReviewerControls> {
  return readGitLabReviewerControls(document, scope, gitLabActionVisit(document), complete);
}

beforeEach(() => {
  window.location.href = reviewUrl;
  // Explicit measured-layout unit protocol, never a public signed-in acceptance fixture.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 50, 20));
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
});
afterEach(() => { document.body.replaceChildren();vi.restoreAllMocks(); });

describe('GitLab focus-only native reviewer handoff', () => {
  it.each(['legacy', 'modern', 'assign'] as const)('focuses the exact %s control without opening, saving or modifying native nodes', async (kind) => {
    const button = mount(kind);
    const original = document.body.innerHTML;
    const events = vi.fn();
    for (const type of ['click', 'change', 'input', 'submit', 'hidden.bs.dropdown', 'hidden.gl.dropdown', 'sidebar.saveReviewers']) document.addEventListener(type, events);
    try {
      const action = read();expect(action.available).toBe(true);
      expect(await action.activate()).toBe(true);
      expect(document.activeElement).toBe(button);expect(events).not.toHaveBeenCalled();
      expect(button.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
      expect(document.body.innerHTML).toBe(original);
      expect(document.querySelector<HTMLInputElement>('input[type="hidden"]')?.value).toBe(kind === 'legacy' ? '14' : undefined);
      expect(document.querySelector<HTMLTextAreaElement>('#note-body')?.value).toBe('Existing comment draft');
      expect(button.hasAttribute('tabindex')).toBe(false);expect(button.hasAttribute('role')).toBe(false);
    } finally { for (const type of ['click', 'change', 'input', 'submit', 'hidden.bs.dropdown', 'hidden.gl.dropdown', 'sidebar.saveReviewers']) document.removeEventListener(type, events); }
  });

  it.each(['legacy', 'modern'] as const)('keeps the existing %s picker when native Assign is also present', async (kind) => {
    const button = mount(kind);
    const assign = document.createElement('button');assign.type = 'button';assign.dataset.testid = 'sidebar-reviewers-assign-button';assign.textContent = 'Assign';
    document.querySelector('[data-testid="reviewers-block-container"]')?.append(assign);
    const click = vi.fn();assign.addEventListener('click', click);
    expect(await read().activate()).toBe(true);expect(document.activeElement).toBe(button);expect(click).not.toHaveBeenCalled();
    button.disabled = true;expect(read().available).toBe(false);
    button.disabled = false;
    const menu = document.querySelector('.dropdown-menu, [data-testid="base-dropdown-menu"]');const parent = menu?.parentElement;
    if (menu === null || parent === null || parent === undefined) throw new Error('Missing native picker menu');
    menu.remove();expect(read().available).toBe(false);parent.append(menu);
    button.parentElement?.append(button.cloneNode(true));expect(read().available).toBe(false);
  });

  it('requires one original Assign fallback and ignores owned or authored replicas', async () => {
    const button = mount('assign');
    const owned = document.createElement('div');owned.dataset.geldUi = '';owned.append(button.cloneNode(true));document.body.append(owned);
    expect(read().available).toBe(true);
    button.parentElement?.append(button.cloneNode(true));expect(read().available).toBe(false);
    mount('assign');const original = document.querySelector('aside button');
    const authored = document.createElement('div');authored.className = 'note-body';original?.replaceWith(authored);if (original !== null) authored.append(original);
    expect(read().available).toBe(false);expect(await read().activate()).toBe(false);
  });

  it.each(['menu', 'metadata'] as const)('keeps the legacy %s veto when a picker also carries the Assign marker', async (invalid) => {
    const button = mount('legacy');button.dataset.testid = 'sidebar-reviewers-assign-button';
    expect(read().available).toBe(true);
    if (invalid === 'menu') document.querySelector('.dropdown-menu')?.remove();
    else button.dataset.projectId = '28';
    const action = read();expect(action.available).toBe(false);expect(await action.activate()).toBe(false);
    expect(button.scrollIntoView).not.toHaveBeenCalled();expect(document.activeElement).not.toBe(button);
  });

  it.each(['disabled', 'readonly', 'hidden', 'inert', 'aria-disabled', 'aria-readonly'])('refuses a native Assign control marked %s', (attribute) => {
    const button = mount('assign');button.setAttribute(attribute, attribute.startsWith('aria-') ? 'true' : '');expect(read().available).toBe(false);
  });

  it.each(['account', 'head', 'project', 'noteable', 'permission', 'incomplete', 'generic-viewer', 'unknown-head'] as const)('preserves the native Assign scope boundary for %s', async (change) => {
    mount('assign');
    if (change === 'account') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{}');
    if (change === 'head') setNote({ diff_head_sha: 'b'.repeat(40) });
    if (change === 'project') setNote({ project_id: 28 });
    if (change === 'noteable') setNote({ id: 82 });
    if (change === 'permission') setNote({ current_user: { can_update: false } });
    if (change === 'unknown-head') setNote({ diff_head_sha: null });
    if (change === 'generic-viewer') {
      document.querySelector('#js-vue-mr-discussions')?.removeAttribute('data-current-user-data');
      document.body.insertAdjacentHTML('beforeend', '<div class="js-mr-title-actions" data-is-signed-in="true"></div>');
    }
    const action = read(change !== 'incomplete');expect(action.available).toBe(false);expect(await action.activate()).toBe(false);
  });

  it.each(['route', 'account', 'head', 'control', 'sidebar', 'overlay', 'expanded'] as const)('retires Assign focus after native %s drift without opening anything', async (change) => {
    const button = mount('assign');const action = read();expect(action.available).toBe(true);
    const click = vi.fn();button.addEventListener('click', click);
    if (change === 'route') window.history.replaceState(null, '', reviewUrl.replace('/7', '/8'));
    if (change === 'account') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":11}');
    if (change === 'head') setNote({ diff_head_sha: 'b'.repeat(40) });
    if (change === 'control') button.replaceWith(button.cloneNode(true));
    if (change === 'sidebar') {
      const sidebar = button.closest('aside');if (sidebar === null) throw new Error('Missing native sidebar');
      sidebar.replaceWith(sidebar.cloneNode(true));document.querySelector('aside button')?.replaceWith(button);
    }
    if (change === 'overlay') document.body.insertAdjacentHTML('beforeend', '<div class="gl-drawer"><input value="Keep native assignment"></div>');
    if (change === 'expanded') button.setAttribute('aria-expanded', 'true');
    expect(await action.activate()).toBe(false);expect(button.scrollIntoView).not.toHaveBeenCalled();expect(click).not.toHaveBeenCalled();
  });

  it.each(['scroll', 'focus', 'occluded', 'digest'] as const)('rechecks Assign handoff at the %s boundary', async (phase) => {
    const button = mount('assign');const action = read();const click = vi.fn();button.addEventListener('click', click);
    if (phase === 'scroll') vi.spyOn(button, 'scrollIntoView').mockImplementation(() => setNote({ project_id: 28 }));
    if (phase === 'focus') button.addEventListener('focus', () => button.replaceWith(button.cloneNode(true)));
    if (phase === 'occluded') vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body);
    expect(await action.activate({ current: () => phase !== 'digest' })).toBe(false);expect(click).not.toHaveBeenCalled();
    if (phase !== 'focus') expect(document.activeElement).not.toBe(button);
  });

  it.each(['null', '{}', '{"id":0}', '{"id":"author"}', '{"id":true}'])('rejects nonnumeric viewer data %s despite data-current-user=true', async (viewer) => {
    mount();document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', viewer);
    expect(read().available).toBe(false);expect(await read().activate()).toBe(false);
  });

  it('does not adopt the generic signed-in fallback or an incomplete snapshot', () => {
    mount();expect(read(false).available).toBe(false);
    document.querySelector('#js-vue-mr-discussions')?.removeAttribute('data-current-user-data');
    document.body.insertAdjacentHTML('beforeend', '<div class="js-mr-title-actions" data-is-signed-in="true"></div>');
    expect(gitLabActionVisit(document).user).toBe('signed-in');expect(read().available).toBe(false);
  });

  it.each([{ project_id: 28 }, { id: 82 }, { iid: 8 }, { diff_head_sha: 'b'.repeat(40) }, { diff_head_sha: null }, { current_user: { can_update: false } }])('rejects conflicting native scope %j', (changes) => {
    mount();setNote(changes);expect(read().available).toBe(false);
  });

  it.each(['disabled', 'readonly', 'hidden', 'inert', 'aria-disabled', 'aria-readonly'])('rejects a native %s control', (attribute) => {
    const button = mount();button.setAttribute(attribute, attribute.startsWith('aria-') ? 'true' : '');expect(read().available).toBe(false);
  });

  it.each(['projectId', 'iid', 'issuableType', 'fieldName', 'issueUpdate', 'abilityName'])('does not trust a legacy control with changed %s', (field) => {
    const button = mount();button.dataset[field] = 'another-review';expect(read().available).toBe(false);
  });

  it.each(['legacy', 'modern'] as const)('requires positive closed-menu evidence for %s', async (kind) => {
    mount(kind);
    const menu = document.querySelector<HTMLElement>('.dropdown-menu, .gl-new-dropdown-panel');
    if (menu === null) throw new Error('Missing menu');
    menu.style.display = 'block';menu.style.visibility = 'hidden';
    expect(read().available).toBe(false);
    menu.style.display = 'none';menu.style.visibility = '';
    expect(read().available).toBe(true);
    menu.remove();expect(read().available).toBe(false);expect(await read().activate()).toBe(false);
  });

  it.each(['legacy', 'modern'] as const)('never closes an open %s picker and rejects unrelated open native overlays', (kind) => {
    const button = mount(kind);const action = read();
    button.setAttribute('aria-expanded', 'true');expect(read().available).toBe(false);
    button.removeAttribute('aria-expanded');
    document.body.insertAdjacentHTML('beforeend', '<div role="listbox"><input></div>');
    expect(read().available).toBe(false);expect(action.available).toBe(true);
  });

  it('rejects native opening-state overlays even before they acquire visible geometry', () => {
    mount();const overlay = document.createElement('div');overlay.className = 'gl-new-dropdown-panel !gl-block';overlay.style.display = 'none';document.body.append(overlay);
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect());expect(read().available).toBe(false);
    overlay.className = 'gl-new-dropdown-panel';overlay.style.display = 'block';overlay.style.opacity = '0';expect(read().available).toBe(false);
  });

  it('does not focus a native control transplanted into a replacement sidebar', async () => {
    const button = mount();const action = read();const sidebar = document.querySelector('aside');
    if (sidebar === null) throw new Error('Missing sidebar');
    const replacement = sidebar.cloneNode(true);sidebar.replaceWith(replacement);
    document.querySelector('aside button')?.replaceWith(button);
    expect(await action.activate()).toBe(false);expect(button.scrollIntoView).not.toHaveBeenCalled();
  });

  it('declines unmeasured controls and ambiguous modern native menu associations', () => {
    const button = mount('modern');vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect());expect(read().available).toBe(false);
    vi.mocked(button.getBoundingClientRect).mockReturnValue(new DOMRect(10, 10, 50, 20));
    const menu = document.querySelector('[data-testid="base-dropdown-menu"]');menu?.parentElement?.append(menu.cloneNode(true));expect(read().available).toBe(false);
  });

  it('ignores owned replicas but rejects duplicate native controls, scope roots and reviewer blocks', () => {
    const button = mount();
    const replica = document.createElement('section');replica.dataset.geldUi = '';replica.append(button.cloneNode(true));document.body.append(replica);
    expect(read().available).toBe(true);
    button.parentElement?.append(button.cloneNode(true));expect(read().available).toBe(false);
    mount();document.body.append(document.querySelector('#js-vue-mr-discussions')!.cloneNode(true));expect(read().available).toBe(false);
    mount();document.querySelector('aside')?.append(document.querySelector('[data-testid="reviewers-block-container"]')!.cloneNode(true));expect(read().available).toBe(false);
  });

  it.each(['account', 'head', 'route', 'root', 'control', 'overlay', 'disabled'])('invalidates a retained descriptor after native %s change', async (change) => {
    const button = mount();const action = read();expect(action.available).toBe(true);
    if (change === 'account') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":11}');
    if (change === 'head') setNote({ diff_head_sha: 'b'.repeat(40) });
    if (change === 'route') window.history.replaceState(null, '', `${reviewUrl}/diffs`);
    if (change === 'root') document.querySelector('#js-vue-mr-discussions')?.replaceWith(document.querySelector('#js-vue-mr-discussions')!.cloneNode(true));
    if (change === 'control') button.replaceWith(button.cloneNode(true));
    if (change === 'overlay') document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>');
    if (change === 'disabled') button.disabled = true;
    expect(await action.activate()).toBe(false);expect(button.scrollIntoView).not.toHaveBeenCalled();
  });

  it('allows a fresh same-MR route descriptor while rejecting the previous visit and another MR', async () => {
    mount();const old = read();window.history.replaceState(null, '', `${reviewUrl}/diffs`);
    expect(await old.activate()).toBe(false);expect(await read().activate()).toBe(true);
    window.history.replaceState(null, '', reviewUrl.replace('/7', '/8'));expect(read().available).toBe(false);
  });

  it('rechecks the live control on disable, re-enable, removal and hydration', async () => {
    const button = mount();button.disabled = true;const unavailable = read();
    button.disabled = false;expect(unavailable.available).toBe(false);expect(await unavailable.activate()).toBe(false);expect(read().available).toBe(true);
    const old = read();button.remove();expect(await old.activate()).toBe(false);expect(read().available).toBe(false);
  });

  it('rejects obscured controls without focusing them', async () => {
    mount();vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body);
    expect(await read().activate()).toBe(false);expect(document.activeElement).toBe(document.body);
  });

  it.each(['scroll', 'focus'] as const)('rechecks native scope after %s handlers run', async (phase) => {
    const button = mount();const action = read();
    const mutate = (): void => setNote({ diff_head_sha: 'b'.repeat(40) });
    if (phase === 'scroll') vi.spyOn(button, 'scrollIntoView').mockImplementation(mutate);
    else button.addEventListener('focus', mutate);
    expect(await action.activate()).toBe(false);
    if (phase === 'scroll') expect(document.activeElement).not.toBe(button);
  });

  it('checks the owning digest lifetime before scrolling and again before focus', async () => {
    const button = mount();const action = read();let current = false;
    expect(await action.activate({ current: () => current })).toBe(false);expect(button.scrollIntoView).not.toHaveBeenCalled();
    current = true;vi.spyOn(button, 'scrollIntoView').mockImplementation(() => { current = false; });
    expect(await action.activate({ current: () => current })).toBe(false);expect(document.activeElement).not.toBe(button);
  });
});
