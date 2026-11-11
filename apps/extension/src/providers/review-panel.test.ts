// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProviderReviewItems, providerReviewKey } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewReviewer, ProviderReviewThread } from '@geld/review';
import type { ProviderAiState } from './ai';
import type { ProviderCommentRenderContext } from './comment-render';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewAuthorPresentation, ProviderReviewPanelEvent, ProviderSourceActionContext } from './review-panel';

const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/project', id: '42', headSha: 'a'.repeat(40) } as const;
const reviewUrl = 'https://gitlab.com/group/subgroup/project/-/merge_requests/42';

function comment(id: string, body = 'Check the response before reading it.'): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `${reviewUrl}#note_${id}`, author: { id: 'user-1', login: 'alice' }, body, createdAt: '2026-11-01T12:00:00Z' };
}

function thread(id: string, overrides: Partial<ProviderReviewThread> = {}): ProviderReviewThread {
  return { id: id.repeat(40), anchor: `discussion_${id.repeat(40)}`, url: `${reviewUrl}#note_${id === 'b' ? '2' : '1'}`, path: `${id}.ts`, resolved: false, outdated: false, comments: [comment(id === 'b' ? '2' : '1')], ...overrides };
}

function input(threads: readonly ProviderReviewThread[] = []): ProviderReviewInput {
  return { subject, threads, reviewers: [], checks: [] };
}

function host(): HTMLElement {
  const value = document.createElement('div');
  document.body.append(value);
  return value;
}

beforeEach(() => { document.body.replaceChildren();window.location.href = reviewUrl; });

describe('provider conversation digest', () => {
  it('keeps a closed toolbar menu summary focused on unchanged updates', () => {
    const native = input();
    const panel = renderProviderReviewPanel(host(), native, { hasViewChoice: true });
    const summary = panel.element.querySelector<HTMLElement>('[data-geld-toolbar-control="eye"]')!;
    expect(summary.closest('details')?.open).toBe(false);
    summary.focus();
    panel.update(native, { hasViewChoice: true, version: 2 });
    expect(document.activeElement).toBe(summary);
    panel.destroy();
  });

  it('releases focus inside a closed menu without treating its summary as hidden', () => {
    const native = input();
    const panel = renderProviderReviewPanel(host(), native, { hasViewChoice: true });
    const slot = panel.element.querySelector<HTMLElement>('[data-geld-view-slot]')!;
    const menu = slot.closest('details')!;
    const nested = document.createElement('details');
    const summary = document.createElement('summary');summary.textContent = 'Nested menu';nested.append(summary);slot.append(nested);
    menu.open = true;summary.focus();
    expect(document.activeElement).toBe(summary);
    panel.update(native, { hasViewChoice: true, version: 2 });
    expect(document.activeElement).toBe(summary);
    menu.open = false;
    panel.update(native, { hasViewChoice: true, version: 3 });
    expect(document.activeElement).not.toBe(summary);
    panel.destroy();
  });

  it('keeps compact reviewer summaries inline and details behind the closed row', () => {
    const native = { ...input([thread('a')]), reviewers: [
      { author: { id: 'user-1', login: 'alice' }, state: 'approved', reviewRequest: 'pending', url: `${reviewUrl}#note_1`, anchor: 'note_1' },
      { author: { id: 'user-2', login: 'bob' }, state: 'changes_requested', reviewRequest: 'unknown' },
    ] } satisfies ProviderReviewInput;
    const opened = vi.fn((_url: string, _anchor: string, event: MouseEvent) => event.preventDefault());
    const panel = renderProviderReviewPanel(host(), native, {
      onOpenSource: opened,
      authorPresentation: source => ({ authorId: source.author.id, displayName: 'Alice', avatar: { src: 'https://gitlab.com/avatar.png', width: 24, height: 24 } }),
    });
    const section = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-key="reviewers"]');
    expect(section?.open).toBe(false);
    const chips = section?.querySelectorAll('.geld-provider-review__reviewer');expect(chips).toHaveLength(2);
    expect(chips?.[0]?.closest('.geld-provider-review__section-content')).not.toBeNull();
    expect(section?.querySelectorAll('[data-geld-review-toggle] .geld-provider-review__status-chip')).toHaveLength(2);
    expect(chips?.[0]?.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(chips?.[0]?.getAttribute('aria-label')).toBe('alice: Approved · Review requested');
    expect(chips?.[1]?.querySelector('.geld-provider-review__reviewer-avatar')?.textContent).toBe('B');
    expect(chips?.[1]?.querySelector('.geld-provider-review__reviewer-request')).toBeNull();
    expect(section?.textContent).not.toContain('Request state unavailable');
    section?.querySelector<HTMLAnchorElement>('a.geld-provider-review__reviewer')?.click();expect(opened).toHaveBeenCalledWith(`${reviewUrl}#note_1`, 'note_1', expect.any(MouseEvent));
    expect(section?.open).toBe(false);
  });

  it('counts identity-bound conversation activity without claiming it belongs to one review', () => {
    const first = comment('1'), reply = comment('2'), second = comment('3'), top = comment('4');
    const impostor = { ...comment('5'), author: { id: 'different-id', login: 'alice' } };
    const invalid = { ...comment('6'), url: 'https://other.example/#note_6' };
    const native: ProviderReviewInput = { ...input([
      thread('a', { comments: [first, reply, impostor] }), thread('b', { comments: [second] }),
    ]), complete: false, reviewers: [{ author: first.author, state: 'approved', reviewRequest: 'not-pending' }] };
    const panel = renderProviderReviewPanel(host(), native, { comments: [first, top] });
    const activity = panel.element.querySelector('.geld-provider-review__reviewer-activity');
    expect(activity?.textContent).toBe('In this conversation: 2 observed threads started · 4 observed comments');
    expect(activity?.getAttribute('title')).toContain('not grouped into a review');
    expect(panel.element.querySelector('.geld-provider-review__reviewer')?.tagName).toBe('SPAN');
    expect(panel.element.textContent).not.toContain('latest review');
    const secondPanel = renderProviderReviewPanel(host(), { ...input(), reviewers: native.reviewers ?? [] }, { comments: [invalid] });
    expect(secondPanel.element.querySelector('.geld-provider-review__reviewer-activity')).toBeNull();
  });

  it.each(['pending', 'foreign', 'wrong-review', 'missing-anchor'] as const)('does not make an unproven reviewer target clickable: %s', change => {
    const reviewer: ProviderReviewReviewer = { author: { id: '1', login: 'alice' }, state: change === 'pending' ? 'pending' : 'approved', reviewRequest: 'unknown',
      url: change === 'foreign' ? 'https://elsewhere.example/#note_1' : change === 'wrong-review' ? `${reviewUrl}0#note_1` : `${reviewUrl}#note_1`, ...(change === 'missing-anchor' ? {} : { anchor: 'note_1' }) };
    const panel = renderProviderReviewPanel(host(), { ...input(), reviewers: [reviewer] });
    expect(panel.element.querySelector('.geld-provider-review__reviewer')?.tagName).toBe('SPAN');
    expect(panel.element.querySelector('.geld-provider-review__reviewer-request')).toBeNull();
  });

  it('retires a reviewer link when its head changes or the panel is destroyed', () => {
    const opened = vi.fn();
    const native: ProviderReviewInput = { ...input(), reviewers: [{ author: { id: '1', login: 'alice' }, state: 'approved', anchor: 'note_1', url: `${reviewUrl}#note_1` }] };
    const panel = renderProviderReviewPanel(host(), native, { onOpenSource: opened });
    const old = panel.element.querySelector<HTMLAnchorElement>('.geld-provider-review__reviewer');
    panel.update({ ...native, subject: { ...subject, headSha: 'b'.repeat(40) } });old?.click();expect(opened).not.toHaveBeenCalled();
    const current = panel.element.querySelector<HTMLAnchorElement>('.geld-provider-review__reviewer');panel.destroy();current?.click();expect(opened).not.toHaveBeenCalled();
  });
  it('offers an available focus-only reviewer handoff in the existing review action styling, including a known empty reviewer list', async () => {
    const native = document.createElement('button');native.type = 'button';native.textContent = 'Edit';document.body.append(native);
    const activate = vi.fn(async (context?: ProviderSourceActionContext) => { if (context?.current?.() !== true) return false;native.focus();return true; });
    const panel = renderProviderReviewPanel(host(), input(), { reviewerControls: { kind: 'reviewer-controls', label: 'Reviewer controls', available: true, activate } });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-reviewer-controls]');
    expect(button?.textContent).toBe('Reviewer controls');expect(button?.type).toBe('button');
    expect(button?.title).toBe('Focus GitLab’s native reviewer controls.');
    expect(button?.parentElement?.className).toBe('geld-provider-review__source-actions');expect(button?.closest('[data-geld-review-key]')?.getAttribute('data-geld-review-key')).toBe('reviewers');
    button?.click();await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());
    expect(document.activeElement).toBe(native);expect(native.hasAttribute('role')).toBe(false);expect(native.hasAttribute('tabindex')).toBe(false);
    panel.update(input(), { reviewerControls: { kind: 'reviewer-controls', label: 'Reviewer controls', available: false, activate } });
    expect(panel.element.querySelector('[data-geld-reviewer-controls]')).toBeNull();
    panel.update(input(), { reviewerControls: { kind: 'reviewer-controls', label: 'Reviewer controls', available: true, activate } });
    expect(panel.element.querySelector('[data-geld-reviewer-controls]')).not.toBeNull();
  });

  it.each(['head', 'destroy', 'unavailable'] as const)('does not focus native reviewer controls after a queued handoff becomes %s', async (change) => {
    const activate = vi.fn(async () => true);
    const action = { kind: 'reviewer-controls', label: 'Reviewer controls', available: true, activate };
    const panel = renderProviderReviewPanel(host(), input(), { reviewerControls: action });
    panel.element.querySelector<HTMLButtonElement>('[data-geld-reviewer-controls]')?.click();
    if (change === 'destroy') panel.destroy();
    else if (change === 'head') panel.update({ ...input(), subject: { ...subject, headSha: 'b'.repeat(40) } }, { reviewerControls: action });
    else panel.update(input(), { reviewerControls: { ...action, available: false } });
    await new Promise<void>((resolve) => queueMicrotask(resolve));expect(activate).not.toHaveBeenCalled();
  });

  it('keeps a failed native reviewer handoff retryable without reporting a request or saving a review', async () => {
    const activate = vi.fn<(_: ProviderSourceActionContext | undefined) => Promise<boolean>>().mockRejectedValueOnce(new Error('Native control replaced')).mockResolvedValueOnce(false);
    const panel = renderProviderReviewPanel(host(), input(), { reviewerControls: { kind: 'reviewer-controls', label: 'Reviewer controls', available: true, activate } });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-reviewer-controls]');
    button?.click();await vi.waitFor(() => expect(button?.disabled).toBe(false));
    expect(button?.title).toBe('The native reviewer controls are unavailable.');expect(button?.textContent).toBe('Reviewer controls');
    button?.click();await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));
    expect(panel.element.textContent).not.toMatch(/Requested review|Saved/);
  });

  it('keeps a captured quote valid across metadata refreshes and invalidates it after a source remount', async () => {
    let context: ProviderSourceActionContext | undefined;
    const activate = vi.fn(async (value?: ProviderSourceActionContext) => { context = value; return true; });
    const options = { actionsForSource: () => [{ kind: 'quote', label: 'Quote reply', available: true, activate }] };
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), options);
    const body = panel.element.querySelector('.geld-provider-review__body');
    const button = [...panel.element.querySelectorAll('button')].find((control) => control.textContent === 'Quote reply');
    const text = body?.firstChild;
    if (body === null || text === null || text === undefined || button === undefined) throw new Error('Missing quote controls.');
    const range = document.createRange(); range.setStart(text, 6); range.setEnd(text, 18);
    document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
    button.dispatchEvent(new Event('pointerdown'));
    document.getSelection()?.removeAllRanges();
    button.click();
    await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());
    expect(context?.selection).toMatchObject({ kind: 'excerpt', sourceId: '1', anchor: 'note_1', url: comment('1').url, text: 'the response', body });
    expect(context?.current?.()).toBe(true);
    panel.update(input([thread('a')]), { ...options, version: 1 });
    expect(context?.current?.()).toBe(true);
    panel.update(input([thread('a', { comments: [comment('1', 'Changed source content.')] })]), options);
    expect(context?.current?.()).toBe(false);
    panel.destroy();
  });

  it('retains comment DOM, selection and native control lifetimes while status rows update', () => {
    const container = host();container.style.overflowY = 'auto';container.scrollTop = 200;
    Object.defineProperties(container, { scrollHeight: { value: 1200 }, clientHeight: { value: 600 } });
    const mounted = vi.fn(), disposed = vi.fn();
    const contexts: ProviderCommentRenderContext[] = [];
    const renderComment = vi.fn((source: ProviderReviewComment, body: HTMLElement, context?: ProviderCommentRenderContext) => {
      body.textContent = source.body;
      if (context !== undefined) { contexts.push(context);context.onMount(mounted);context.onDispose(disposed); }
      return true;
    });
    const check = { key: 'job:1', name: 'Tests', sha: subject.headSha, status: 'queued', conclusion: null, detailsUrl: 'https://gitlab.com/group/subgroup/project/-/jobs/1' };
    const source: ProviderReviewInput = { ...input([thread('a')]), checks: [check] };
    const panel = renderProviderReviewPanel(container, source, { renderComment });
    const item = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]');
    const body = panel.element.querySelector('.geld-provider-review__body');
    const text = body?.firstChild;
    if (item === null || body === null || text == null) throw new Error('Missing comment body');
    item.open = true;
    vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, panel.element.querySelector('[data-geld-check-state="passed"]') === null ? 100 : 140, 500, 80));
    const range = document.createRange();range.setStart(text, 6);range.setEnd(text, 18);
    document.getSelection()?.removeAllRanges();document.getSelection()?.addRange(range);
    panel.update(source, { renderComment, version: 2, updating: true });
    expect(panel.element.querySelector('[data-geld-review-updating]')?.textContent).toBe('Updating…');
    expect(panel.element.querySelector('.geld-provider-review__body')).toBe(body);
    panel.update({ ...source, checks: [{ ...check, status: 'completed', conclusion: 'success' }], reviewers: [{ author: comment('1').author, state: 'approved' }] }, { renderComment, version: 3 });
    expect(panel.element.querySelector('[data-geld-review-updating]')).toBeNull();
    expect(panel.element.querySelector('[data-geld-review-key="checks"]')?.textContent).toContain('Passed');
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"]')?.textContent).toContain('Approved');
    expect(panel.element.querySelector('[data-geld-item]')).toBe(item);
    expect(panel.element.querySelector('.geld-provider-review__body')).toBe(body);
    expect(document.getSelection()?.toString()).toBe('the response');
    expect(container.scrollTop).toBe(240);
    expect(renderComment).toHaveBeenCalledOnce();expect(mounted).toHaveBeenCalledOnce();expect(disposed).not.toHaveBeenCalled();
    expect(contexts[0]?.current()).toBe(true);
    panel.destroy();expect(disposed).toHaveBeenCalledOnce();expect(contexts[0]?.current()).toBe(false);
  });

  it('keeps an active reviewer handoff mounted while independent CI checks refresh', async () => {
    let finish: ((focused: boolean) => void) | undefined;
    const activate = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const options = { reviewerControls: { kind: 'reviewer-controls', label: 'Reviewer controls', available: true, activate } };
    const panel = renderProviderReviewPanel(host(), input(), options);
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-reviewer-controls]');
    if (button === null) throw new Error('Missing reviewer controls');
    button.click();await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());
    expect(button.disabled).toBe(true);
    panel.update({ ...input(), checks: [{ name: 'Tests', sha: subject.headSha, status: 'completed', conclusion: 'success' }] }, options);
    expect(panel.element.querySelector('[data-geld-reviewer-controls]')).toBe(button);
    expect(button.disabled).toBe(true);
    finish?.(true);await vi.waitFor(() => expect(button.disabled).toBe(false));
    panel.destroy();
  });

  it('uses the latest available source action after an unchanged snapshot refresh', async () => {
    const first = vi.fn(async () => true), latest = vi.fn(async () => true);
    const source = input([thread('a')]);
    const action = { kind: 'quote', label: 'Quote reply', available: true };
    const panel = renderProviderReviewPanel(host(), source, { actionsForSource: () => [{ ...action, activate: first }] });
    const button = [...panel.element.querySelectorAll('button')].find(value => value.textContent === 'Quote reply');
    panel.update(source, { version: 2, actionsForSource: () => [{ ...action, activate: latest }] });
    expect([...panel.element.querySelectorAll('button')].find(value => value.textContent === 'Quote reply')).toBe(button);
    button?.click();await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
    panel.update(source, { actionsForSource: () => [{ ...action, available: false, activate: latest }] });
    expect(button?.isConnected).toBe(false);
    expect([...panel.element.querySelectorAll('button')].find(value => value.textContent === 'Quote reply')).toBeUndefined();
    panel.destroy();
  });

  it('retires native comment bindings when the provider replaces identical source markup', () => {
    const native = document.createElement('article');native.id = 'note_1';native.innerHTML = '<p>Native source</p>';document.body.append(native);
    const contexts: ProviderCommentRenderContext[] = [];
    const dispose = vi.fn();
    const renderComment = (source: ProviderReviewComment, body: HTMLElement, context?: ProviderCommentRenderContext): boolean => {
      body.textContent = source.body;
      if (context !== undefined) { contexts.push(context);context.onDispose(dispose); }
      return true;
    };
    const source = input([thread('a')]);
    const panel = renderProviderReviewPanel(host(), source, { renderComment });
    const body = panel.element.querySelector('.geld-provider-review__body');
    native.replaceChildren(native.firstElementChild?.cloneNode(true) ?? '');
    panel.update(source, { renderComment, version: 2 });
    expect(panel.element.querySelector('.geld-provider-review__body')).not.toBe(body);
    expect(dispose).toHaveBeenCalledOnce();expect(contexts[0]?.current()).toBe(false);expect(contexts[1]?.current()).toBe(true);
    panel.destroy();
  });

  it('captures keyboard quote selection and marks cross-source selections explicitly unavailable', async () => {
    const contexts: Array<ProviderSourceActionContext | undefined> = [];
    const activate = vi.fn(async (value?: ProviderSourceActionContext) => { contexts.push(value); return false; });
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { actionsForSource: () => [{ kind: 'quote', label: 'Quote reply', available: true, activate }] });
    const body = panel.element.querySelector('.geld-provider-review__body');
    const button = [...panel.element.querySelectorAll('button')].find((control) => control.textContent === 'Quote reply');
    if (body === null || button === undefined) throw new Error('Missing quote fixture.');
    const range = document.createRange(); range.selectNodeContents(body); document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); button.click();
    await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());
    expect(contexts[0]?.selection).toMatchObject({ kind: 'excerpt', text: comment('1').body });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    const other = document.createElement('p'); other.textContent = 'Another source'; document.body.append(other);
    const next = document.createRange(); next.selectNodeContents(other); document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(next);
    button.click();
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(2));
    expect(contexts[1]?.selection).toEqual({ kind: 'unavailable' });
    expect(button.title).toBe('Select the passage again in the original comment.');
    panel.destroy();
  });
  it('keeps original untrusted bodies as text and refuses unsafe source and check links', () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const panel = renderProviderReviewPanel(host(), {
      ...input([thread('a', { comments: [comment('1', `**Unsafe** ${attack}`)] })]),
      checks: [{ name: attack, status: 'completed', conclusion: 'success', sha: subject.headSha, detailsUrl: 'javascript:alert(1)' }],
    }, {
      comments: [{ ...comment('8', attack), url: 'https://user:secret@gitlab.com/private' }],
      events: [{ id: 'event-1', url: 'javascript:alert(3)', author: { id: 'u2', login: attack }, body: attack, createdAt: '2026-11-01T12:00:00Z' }],
    });
    expect(panel.element.querySelector('img,script')).toBeNull();
    expect(panel.element.querySelector('[data-geld-source="note_1"] .geld-provider-review__body')?.textContent).toBe(`**Unsafe** ${attack}`);
    expect([...panel.element.querySelectorAll('a')].every((value) => value.href.startsWith(`${reviewUrl}#note_`))).toBe(true);
    expect(panel.element.querySelector('[data-geld-source="note_8"] a')).toBeNull();
    expect(panel.element.textContent).toContain(attack);
  });

  it('preserves expanded conversations and closed groups across replies and state updates', () => {
    const original = thread('a');
    const panel = renderProviderReviewPanel(host(), input([original]));
    const item = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]');
    const group = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-group="open"]');
    expect(item).not.toBeNull();
    if (item !== null) item.open = true;
    if (group !== null) group.open = false;
    panel.update(input([{ ...original, comments: [...original.comments, comment('3', 'The missing response still needs a guard.')] }]));
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]')?.open).toBe(true);
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-group="open"]')?.open).toBe(false);
    expect(panel.element.querySelectorAll('[data-geld-source]')).toHaveLength(2);
    panel.update(input([{ ...original, resolved: true }]));
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]')?.open).toBe(true);
    expect(panel.element.querySelector('[data-geld-review-group="resolved"]')).not.toBeNull();
    panel.update({ ...input([{ ...original, url: original.url.replace('/42#', '/43#'), comments: original.comments.map((entry) => ({ ...entry, url: entry.url.replace('/42#', '/43#') })) }]), subject: { ...subject, id: '43' } });
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]')?.open).toBe(false);
  });

  it('copies one native thread and all its replies without unrelated nearby threads', async () => {
    const write = vi.fn(async (_text: string) => {});
    const source = input([thread('a', { path: 'shared.ts', line: 5, comments: [comment('1'), comment('2')] }), thread('b', { path: 'shared.ts', line: 6, comments: [comment('3')] })]);
    const panel = renderProviderReviewPanel(host(), source, { copyText: write });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]');
    if (button === null) throw new Error('Missing item copy control');
    button.closest('details')?.setAttribute('open', '');
    button.focus();button.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
    expect(button.disabled).toBe(true);expect(button.getAttribute('aria-busy')).toBe('true');
    button.click();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const text = write.mock.calls[0]?.[0];
    expect(text).toContain(`${reviewUrl}#note_1`);expect(text).toContain(`${reviewUrl}#note_2`);
    expect(text).toContain('`shared.ts:5`');expect(text).not.toContain('CI checks:');expect(text).not.toContain(`${reviewUrl}#note_3`);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.parentElement?.querySelector('[role="status"]')?.textContent).toBe('Item copied as Markdown.');
    expect(document.activeElement).toBe(button);
    expect(panel.element.querySelector('[data-geld-item]')?.getAttribute('data-state')).toBe('open');
  });

  it.each(['markdown', 'fix'])('preserves %s copy focus across unchanged review refreshes without stealing external focus', (kind) => {
    const source = input([thread('a')]);
    const options = { suggestedFixes: 'all' as const, transformItems: (items: readonly import('@geld/review').ReviewItem[]) => items.map((item) => ({ ...item, fix: { source: 'human' as const, text: 'fixed();' } })) };
    const panel = renderProviderReviewPanel(host(), source, options);
    const item = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]');
    if (item === null) throw new Error('Missing review item');
    item.open = true;
    const before = panel.element.querySelector<HTMLButtonElement>(`[data-geld-copy-kind="${kind}"]`);
    if (before === null) throw new Error('Missing copy control');
    for (let row = before.parentElement; row !== null; row = row.parentElement) if ('open' in row) Reflect.set(row, 'open', true);
    before.focus();
    panel.update(source, { ...options, version: 2, updating: true });
    const after = panel.element.querySelector(`[data-geld-copy-kind="${kind}"]`);
    expect(after).toBe(before);
    expect(document.activeElement).toBe(after);
    const outside = document.createElement('button');document.body.append(outside);outside.focus();
    panel.update(source, { ...options, version: 3, updating: false });
    expect(document.activeElement).toBe(outside);
    panel.destroy();
  });

  it.each(['head', 'body', 'ineligible', 'hidden', 'route'] as const)('does not restore copy focus after the %s changes', (change) => {
    const source = input([thread('a')]);
    const options = { suggestedFixes: 'all' as const, transformItems: (items: readonly import('@geld/review').ReviewItem[]) => items.map((item) => ({ ...item, fix: { source: 'human' as const, text: 'fixed();' } })) };
    const panel = renderProviderReviewPanel(host(), source, options);
    const item = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]');
    if (item === null) throw new Error('Missing review item');
    item.open = true;
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="fix"]');
    if (button === null) throw new Error('Missing copy control');
    button.focus();
    if (change === 'hidden') item.open = false;
    if (change === 'route') window.history.replaceState(null, '', `${reviewUrl}?changed=1`);
    const next = change === 'head' ? { ...source, subject: { ...subject, headSha: 'b'.repeat(40) } }
      : change === 'body' ? input([thread('a', { comments: [comment('1', 'A different source concern.')] })]) : source;
    panel.update(next, { ...options, version: 2, ...(change === 'ineligible' ? { suggestedFixes: 'off' as const } : {}) });
    expect(document.activeElement?.hasAttribute('data-geld-item-copy')).toBe(false);
    panel.destroy();
  });

  const copyFixModes: readonly { mode: 'all' | 'bots' | 'ai' | 'off'; source: 'human' | 'bot' | 'ai'; visible: boolean }[] = [
    { mode: 'all', source: 'human', visible: true }, { mode: 'all', source: 'bot', visible: true }, { mode: 'all', source: 'ai', visible: true },
    { mode: 'bots', source: 'human', visible: true }, { mode: 'bots', source: 'bot', visible: true }, { mode: 'bots', source: 'ai', visible: false },
    { mode: 'ai', source: 'human', visible: false }, { mode: 'ai', source: 'bot', visible: false }, { mode: 'ai', source: 'ai', visible: true },
    { mode: 'off', source: 'human', visible: false }, { mode: 'off', source: 'bot', visible: false }, { mode: 'off', source: 'ai', visible: false },
  ];
  it.each(copyFixModes)('preserves fixVisible eligibility for $mode/$source in visible and copied notes', async ({ mode, source, visible }) => {
    const write = vi.fn(async (_text: string) => {});
    const value = 'line1();\n  line2();\n';
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { suggestedFixes: mode, copyText: write,
      transformItems: (items) => items.map((item) => ({ ...item, fix: { source, text: value } })),
    });
    const fix = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="fix"]');
    expect(fix !== null).toBe(visible);
    if (fix !== null) {
      fix.click();await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      expect(write.mock.calls[0]?.[0]).toBe(value);
    }
    write.mockClear();
    panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]')?.click();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(write.mock.calls[0]?.[0]?.includes('line1();')).toBe(visible);
  });

  it('keeps clipboard errors retryable and reports success without changing the source or its state', async () => {
    const write = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new DOMException('Clipboard denied', 'NotAllowedError')).mockResolvedValue(undefined);
    const native = document.createElement('p');native.id = 'note_1';native.textContent = 'Original native source';document.body.append(native);
    const nativeBefore = native.outerHTML;
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { copyText: write });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]');
    if (button === null) throw new Error('Missing item copy control');
    const original = panel.element.querySelector('.geld-provider-review__body')?.textContent;
    button.click();
    await vi.waitFor(() => expect(button.parentElement?.querySelector('[role="status"]')?.textContent).toBe('Could not copy. Try again.'));
    expect(button.disabled).toBe(false);expect(button.textContent).toBe('Copy as Markdown');
    button.click();await vi.waitFor(() => expect(button.textContent).toBe('Copied'));
    expect(write).toHaveBeenCalledTimes(2);expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(original);
    expect(panel.element.querySelector('[data-geld-item]')?.getAttribute('data-state')).toBe('open');
    expect(document.getElementById('note_1')).toBe(native);expect(native.outerHTML).toBe(nativeBefore);
  });

  it.each(['update', 'destroy'])('does not launch a queued clipboard action after panel %s', async (action) => {
    const write = vi.fn(async (_text: string) => {});
    const source = input([thread('a')]);
    const panel = renderProviderReviewPanel(host(), source, { copyText: write });
    panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]')?.click();
    if (action === 'destroy') panel.destroy();
    else panel.update({ ...source, subject: { ...subject, headSha: 'b'.repeat(40) } });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(write).not.toHaveBeenCalled();
    if (action === 'update') expect(panel.element.querySelector('[data-geld-copy-kind="markdown"]')?.textContent).toBe('Copy as Markdown');
  });

  it('does not patch a replacement review when an already-issued clipboard write finishes', async () => {
    let finish: (() => void) | undefined;
    const write = vi.fn((_text: string) => new Promise<void>((resolve) => { finish = resolve; }));
    const source = input([thread('a')]);
    const panel = renderProviderReviewPanel(host(), source, { copyText: write });
    const old = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]');
    old?.click();await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    panel.update({ ...source, subject: { ...subject, headSha: 'b'.repeat(40) } });
    finish?.();await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(old?.isConnected).toBe(false);
    expect(panel.element.querySelector('[data-geld-copy-kind="markdown"]')?.textContent).toBe('Copy as Markdown');
    expect(panel.element.querySelector('[data-geld-copy-kind="markdown"]')?.parentElement?.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it.each(['path', 'query', 'fragment'])('checks the actual document visit before clipboard launch after a %s change', async (change) => {
    const write = vi.fn(async (_text: string) => {});
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { copyText: write });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]');
    button?.click();
    window.history.replaceState({}, '', change === 'path' ? reviewUrl.replace('/42', '/43') : change === 'query' ? `${reviewUrl}?version=changed` : `${reviewUrl}#note_1`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(button?.isConnected).toBe(true);
    expect(write).toHaveBeenCalledTimes(change === 'fragment' ? 1 : 0);
    if (change !== 'fragment') expect(button?.textContent).toBe('Copy as Markdown');
  });

  it('ignores a clipboard completion after URL-only navigation while the old panel is still mounted', async () => {
    let finish: (() => void) | undefined;
    const write = vi.fn((_text: string) => new Promise<void>((resolve) => { finish = resolve; }));
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { copyText: write });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]');
    button?.click();await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    window.history.replaceState({}, '', reviewUrl.replace('/42', '/43'));finish?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(button?.isConnected).toBe(true);expect(button?.textContent).toBe('Copy as Markdown');
    expect(button?.parentElement?.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('labels AI and personal triage separately from the canonical source status in item copies', async () => {
    const source = input([thread('a')]);
    const original = buildProviderReviewItems(source)[0];
    if (original === undefined) throw new Error('Missing native item');
    const write = vi.fn(async (_text: string) => {});
    const panel = renderProviderReviewPanel(host(), source, { copyText: write,
      transformItems: (items) => items.map((item) => ({ ...item, title: 'AI wording', rewritten: true, status: 'addressed' })),
      localReviewed: { ids: new Set([original.id]), pending: new Set(), set: () => undefined },
    });
    panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]')?.click();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const copied = write.mock.calls[0]?.[0];
    expect(copied).toContain('Source status: open.');expect(copied).toContain('AI triage wording.');
    expect(copied).toContain('Geld triage status: done-manual.');expect(copied).toContain('Reviewed on this device.');
    expect(copied).not.toContain('Source status: resolved');
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment('1').body);
  });

  it('removes fix copy and cancels a queued write when the current shared fix setting turns off', async () => {
    const source = input([thread('a', { comments: [comment('1', 'Guard the value.\n```suggestion\nfixed();\n```')] })]);
    const write = vi.fn(async (_text: string) => {});
    const panel = renderProviderReviewPanel(host(), source, { copyText: write, suggestedFixes: 'bots' });
    const old = panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="fix"]');
    expect(old).not.toBeNull();old?.click();
    panel.update(source, { copyText: write, suggestedFixes: 'off' });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(write).not.toHaveBeenCalled();expect(panel.element.querySelector('[data-geld-copy-kind="fix"]')).toBeNull();
    panel.element.querySelector<HTMLButtonElement>('[data-geld-copy-kind="markdown"]')?.click();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(write.mock.calls[0]?.[0]).not.toContain('fixed();');
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toContain('fixed();');
  });

  it('keeps outdated and resolved separate and reads no verdict into an unknown bot login', () => {
    const outdated = thread('a', { outdated: true, comments: [{ ...comment('1'), author: { id: 'unknown', login: 'cursor[bot]', automated: true } }] });
    const resolved = thread('b', { resolved: true, outdated: true });
    const panel = renderProviderReviewPanel(host(), input([outdated, resolved]));
    expect(panel.element.querySelector('[data-geld-review-group="outdated"] [data-state="outdated"]')).not.toBeNull();
    expect(panel.element.querySelector('[data-geld-review-group="resolved"] [data-state="resolved"]')).not.toBeNull();
    expect(panel.element.querySelector('[data-geld-review-group="open"]')).toBeNull();
    expect(panel.element.textContent).toContain('Automated account');
    expect(panel.element.textContent).not.toMatch(/Bugbot|Clean|Findings|running review/i);
    expect([...panel.element.querySelectorAll('button')].filter((button) => !button.hasAttribute('data-geld-item-copy') && !button.hasAttribute('data-geld-review-toggle')).map((button) => button.getAttribute('aria-label'))).toEqual(['Copy digest']);
  });

  it('distinguishes a known empty review, an unavailable source and malformed data', () => {
    const panel = renderProviderReviewPanel(host(), input());
    expect(panel.element.dataset.state).toBe('ready');
    expect(panel.element.textContent).toContain('No review threads.');
    panel.update(input(), { complete: false, unavailable: [{ area: 'Discussions', reason: 'Sign in is required.' }] });
    expect(panel.element.dataset.state).toBe('partial');
    expect(panel.element.textContent).toContain('No review threads in the available data.');
    expect(panel.element.querySelector('[data-geld-review-coverage="partial"]')?.textContent).toBe('Partial review');
    expect(panel.element.textContent).not.toContain('Discussions: Sign in is required.');
    panel.update(input([thread('a', { comments: [{ ...comment('1'), url: 'https://evil.example/comment' }] })]), {});
    expect(panel.element.dataset.state).toBe('unavailable');
    expect(panel.element.textContent).toContain('The review source could not be read.');
    expect(panel.element.textContent).not.toContain('No review threads.');
  });

  it('shows one compact partial status while retaining every technical reason in the copied digest', async () => {
    let copied = '';
    const unavailable = [
      { area: 'thread state', reason: 'Bitbucket did not supply the native resolution of thread 12.' },
      { area: 'thread state', reason: 'Bitbucket did not supply the native resolution of thread 13.' },
      { area: 'approval requirements', reason: 'The API did not supply repository approval requirements.' },
      { area: 'reviews', reason: 'The reviewer endpoint returned403.' },
    ];
    const panel = renderProviderReviewPanel(host(), input(), { unavailable, copyText: (text) => { copied = text; } });
    const status = panel.element.querySelector('[data-geld-review-coverage="partial"]');
    expect(panel.element.dataset.state).toBe('partial');
    expect(panel.element.querySelectorAll('[data-geld-review-coverage="partial"]')).toHaveLength(1);
    expect(status?.textContent).toBe('Partial review');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.classList.contains('geld-provider-review__muted')).toBe(true);
    expect(status?.classList.contains('geld-provider-review__unavailable')).toBe(false);
    expect(status?.children).toHaveLength(0);
    for (const source of unavailable) expect(panel.element.textContent).not.toContain(source.reason);
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await Promise.resolve();
    for (const source of unavailable) expect(copied).toContain(source.reason);
    expect(copied).toContain('Reviews source unavailable: The reviewer endpoint returned403.');
    panel.update(input(), {});
    expect(panel.element.dataset.state).toBe('ready');
    expect(panel.element.querySelector('[data-geld-review-coverage]')).toBeNull();
    panel.update(input(), { complete: false });
    expect(panel.element.querySelector('[data-geld-review-coverage="partial"]')?.textContent).toBe('Partial review');
  });

  it('shows native reviewer standings and counts only CI on the current commit', () => {
    const panel = renderProviderReviewPanel(host(), {
      ...input(),
      reviewers: [
        { author: { id: '1', login: 'alice' }, state: 'approved' },
        { author: { id: '2', login: 'bob' }, state: 'changes_requested' },
        { author: { id: '3', login: 'carol' }, state: 'pending' },
      ],
      checks: [
        { name: 'Test', status: 'completed', conclusion: 'success', sha: subject.headSha, detailsUrl: 'https://ci.example/job/1' },
        { name: 'Build', status: 'in_progress', conclusion: null, sha: subject.headSha },
        { name: 'Old failure', status: 'completed', conclusion: 'failure', sha: 'b'.repeat(40) },
        { name: 'Unknown result', status: 'completed', conclusion: null, sha: subject.headSha },
      ],
    }, { approvalsRequired: 2, approvalsLeft: 1 });
    expect(panel.element.textContent).toContain('1/2 required approvals · 1 change request');
    expect(panel.element.textContent).toContain('Review requested');
    const checks = panel.element.querySelector('[data-geld-review-key="checks"]');
    expect(checks?.querySelector('[data-geld-review-toggle]')?.getAttribute('aria-label')).toBe('Checks · 1 passed · 1 running · 1 unknown');
    expect(checks?.textContent).toContain('Earlier commit · Failed');
    expect(checks?.querySelector('a')?.rel).toBe('noopener noreferrer');
  });

  it('keeps queued, running and native manual checks distinct in the visible and copied reading', async () => {
    let copied = '';
    const panel = renderProviderReviewPanel(host(), { ...input(), checksCoverage: 'partial', checks: [
      { key: 'job:1', name: 'Tests', sha: subject.headSha, status: 'queued', conclusion: null, nativeStatus: 'pending' },
      { key: 'job:2', name: 'Tests', sha: subject.headSha, status: 'in_progress', conclusion: null, nativeStatus: 'running' },
      { key: 'job:3', name: 'Deploy', sha: subject.headSha, status: 'completed', conclusion: 'neutral', nativeStatus: 'manual', allowFailure: true },
      { key: 'job:4', name: 'All checks passed', sha: subject.headSha, status: 'completed', conclusion: 'success', nativeStatus: 'unsupported' },
    ] }, { copyText: (text) => { copied = text; } });
    const checks = panel.element.querySelector('[data-geld-review-key="checks"]');
    expect(checks?.querySelector('[data-geld-review-toggle]')?.getAttribute('aria-label')).toBe('Checks · Partial · 1 pending · 1 running · 1 manual · 1 unknown');
    expect(checks?.querySelector('[data-state="manual"]')?.textContent).toContain('ManualAllowed to fail');
    expect(checks?.querySelector('[data-state="manual"] svg')).toBeNull();
    expect(checks?.querySelector('[data-state="passed"]')).toBeNull();
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain('CI checks: Partial'));
    expect(copied).toContain('CI: Tests: Pending');
    expect(copied).toContain('CI: Tests: Running');
    expect(copied).toContain('CI: Deploy: Manual (allowed to fail)');
    expect(copied).toContain('CI: All checks passed: Unknown');
  });

  it.each(['partial', 'unavailable'] as const)('never calls %s CI an empty complete result', (checksCoverage) => {
    const panel = renderProviderReviewPanel(host(), { ...input(), checksCoverage });
    const checks = panel.element.querySelector('[data-geld-review-key="checks"]');
    expect(checks?.textContent).not.toContain('None on this commit');
    expect(checks?.textContent).not.toContain('No CI checks reported');
    expect(checks?.textContent).toContain(checksCoverage === 'unavailable' ? 'Unavailable' : 'Partial');
    panel.update(input());
    expect(panel.element.querySelector('[data-geld-review-key="checks"]')?.textContent).toContain('No CI checks reported.');
  });

  it('labels a lone available pass as partial instead of an overall CI success', () => {
    const panel = renderProviderReviewPanel(host(), { ...input(), checksCoverage: 'partial', checks: [
      { key: 'job:1', name: 'Tests', sha: subject.headSha, status: 'completed', conclusion: 'success' },
    ] });
    const checks = panel.element.querySelector('[data-geld-review-key="checks"]');
    expect(checks?.querySelector('[data-geld-review-toggle]')?.getAttribute('aria-label')).toBe('Checks · Partial · 1 passed');
    expect(checks?.textContent).toContain('Some CI checks could not be read.');
    expect(checks?.getAttribute('data-state')).toBeNull();
  });

  it('restores only an unchanged current-source CI Details focus without stealing focus from outside the digest', () => {
    const check = { key: 'job:1', name: 'Tests', sha: subject.headSha, status: 'queued', conclusion: null, detailsUrl: 'https://gitlab.com/group/subgroup/project/-/jobs/1' };
    const panel = renderProviderReviewPanel(host(), { ...input(), checks: [check] });
    const section = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-key="checks"]');
    if (section === null) throw new Error('Missing CI section');
    section.open = true;
    section.querySelector<HTMLAnchorElement>('a')?.focus();
    panel.update({ ...input(), checks: [{ ...check, status: 'in_progress' }] });
    const focused = panel.element.querySelector('[data-geld-check-key] a');
    expect(document.activeElement).toBe(focused);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    panel.update({ ...input(), checks: [{ ...check, status: 'completed', conclusion: 'success' }] });
    expect(document.activeElement).toBe(outside);
  });

  it.each(['head', 'review', 'url', 'key', 'duplicate'])('does not transfer check focus across a changed %s', (change) => {
    const check = { key: 'job:1', name: 'Tests', sha: subject.headSha, status: 'queued', conclusion: null, detailsUrl: 'https://gitlab.com/group/subgroup/project/-/jobs/1' };
    const panel = renderProviderReviewPanel(host(), { ...input(), checks: [check] });
    const section = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-key="checks"]');
    if (section === null) throw new Error('Missing CI section');
    section.open = true;
    section.querySelector<HTMLAnchorElement>('a')?.focus();
    panel.update({ ...input(), subject: { ...subject, ...(change === 'head' ? { headSha: 'b'.repeat(40) } : change === 'review' ? { id: '43' } : {}) }, checks: [
      { ...check, status: 'in_progress', ...(change === 'key' ? { key: 'job:2' } : change === 'url' ? { detailsUrl: 'https://gitlab.com/group/subgroup/project/-/jobs/2' } : {}) },
      ...(change === 'duplicate' ? [check] : []),
    ] });
    expect(panel.element.contains(document.activeElement)).toBe(false);
  });

  it('counts independent pending requests beside standing approvals and change requests in UI and Markdown', async () => {
    let copied = '';
    const native: ProviderReviewInput = { ...input(), reviewers: [
      { author: { id: '1', login: 'alice' }, state: 'approved', reviewRequest: 'pending', anchor: 'note_1', url: `${reviewUrl}#note_1` },
      { author: { id: '2', login: 'bob' }, state: 'changes_requested', reviewRequest: 'pending' },
      { author: { id: '3', login: 'carol' }, state: 'pending', reviewRequest: 'unknown' },
    ] };
    const panel = renderProviderReviewPanel(host(), native, { copyText: (text) => { copied = text; } });
    const section = panel.element.querySelector('[data-geld-review-key="reviewers"]');
    expect(section?.querySelector('.geld-provider-review__reviewer-summary')?.textContent).toBe('Reviews · 1 approval · 1 change request · 2 pending reviews');
    expect(section?.querySelectorAll('.geld-provider-review__status-chip[data-geld-review-requested]')).toHaveLength(2);
    expect(section?.querySelector('.geld-provider-review__status-chip[data-state="pending"]')?.hasAttribute('data-geld-review-requested')).toBe(false);
    expect(section?.querySelector('[data-state="approved"] .geld-provider-review__reviewer')?.getAttribute('aria-label')).toBe('alice: Approved · Review requested');
    expect(section?.querySelector('[data-state="approved"] .geld-provider-review__reviewer-request')?.textContent).toBe('Review requested');
    expect(section?.querySelector('[data-state="changes_requested"] .geld-provider-review__reviewer')?.getAttribute('aria-label')).toBe('bob: Changes requested · Review requested');
    expect(section?.querySelector('[data-state="pending"] .geld-provider-review__reviewer')?.getAttribute('aria-label')).toBe('carol: Reviewer');
    expect(section?.querySelector('a')?.href).toBe(`${reviewUrl}#note_1`);
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain('- alice: Approved · Review requested'));
    expect(copied).toContain('- bob: Changes requested · Review requested');
    expect(copied).toContain('- carol: Reviewer');
    expect(copied).not.toMatch(/asked again|latest push/i);
    expect(native.reviewers?.[0]?.state).toBe('approved');
    panel.update(native, { approvalsRequired: 2, approvalsLeft: 0 });
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] .geld-provider-review__reviewer-summary')?.textContent).toBe('Reviews · 2/2 required approvals · 1 change request · 2 pending reviews');
    panel.update({ ...native, reviewers: (native.reviewers ?? []).map((reviewer): ProviderReviewReviewer => ({ ...reviewer, reviewRequest: 'not-pending' })) }, {});
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] .geld-provider-review__reviewer-summary')?.textContent).toBe('Reviews · 1 approval · 1 change request');
    expect(panel.element.querySelector('[data-state="approved"] .geld-provider-review__reviewer')?.getAttribute('aria-label')).toBe('alice: Approved');
  });

  it('heads the Reviews row with one pill per person in GitHub order, each verdict as its glyph', () => {
    const panel = renderProviderReviewPanel(host(), { ...input(), reviewers: [
      { author: { id: '4', login: 'dana' }, state: 'pending', reviewRequest: 'pending' },
      { author: { id: '3', login: 'carol' }, state: 'commented' },
      { author: { id: '2', login: 'bob' }, state: 'changes_requested' },
      { author: { id: '1', login: 'alice' }, state: 'approved' },
    ] }, {});
    const chips = [...panel.element.querySelectorAll('[data-geld-review-key="reviewers"] .geld-provider-review__status-chip')];
    expect(chips.map(chip => chip.getAttribute('data-state'))).toEqual(['approved', 'changes_requested', 'commented', 'pending']);
    expect(chips.map(chip => chip.querySelector('svg') !== null)).toEqual([true, true, true, false]);
    expect(chips[3]?.hasAttribute('data-geld-review-requested')).toBe(true);
  });

  it('retains state-only legacy presentation while explicit unknown never invents a request', () => {
    const native: ProviderReviewInput = { ...input(), reviewers: [
      { author: { id: '1', login: 'legacy' }, state: 'pending' },
      { author: { id: '2', login: 'assigned' }, state: 'pending', reviewRequest: 'unknown' },
      { author: { id: '3', login: 'approver' }, state: 'approved', reviewRequest: 'unknown' },
    ] };
    const panel = renderProviderReviewPanel(host(), native, {});
    const section = panel.element.querySelector('[data-geld-review-key="reviewers"]');
    expect(section?.querySelector('.geld-provider-review__reviewer-summary')?.textContent).toBe('Reviews · 1 approval · 1 pending review');
    expect([...section?.querySelectorAll('.geld-provider-review__reviewer') ?? []].map(chip => chip.getAttribute('aria-label'))).toEqual(['approver: Approved', 'legacy: Review requested', 'assigned: Reviewer']);
    expect([...section?.querySelectorAll('.geld-provider-review__status-chip') ?? []].map(chip => chip.getAttribute('data-state'))).toEqual(['approved', 'pending', 'pending']);
  });

  it('copies native source links and leaves navigation to the provider callback', async () => {
    let copied = '';
    const opened = vi.fn((_url: string, _anchor: string, event: MouseEvent) => event.preventDefault());
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { onOpenSource: opened, copyText: (text) => { copied = text; } });
    panel.element.querySelector<HTMLAnchorElement>('[data-geld-source="note_1"] a')?.click();
    expect(opened).toHaveBeenCalledWith(`${reviewUrl}#note_1`, 'note_1', expect.any(MouseEvent));
    panel.element.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() => expect(copied).toContain(`${reviewUrl}#note_1`));
    expect(copied).toContain('Open: Check the response before reading it.');
    expect(copied).not.toContain('github.com');
    panel.destroy();
    expect(document.querySelector('.geld-provider-review')).toBeNull();
    panel.update(input());
    expect(document.querySelector('.geld-provider-review')).toBeNull();
  });

  it('renders bound native bot results without granting a clean verdict to partial data', () => {
    const author = { id: '38968537', login: 'group_117740890_bot_4b22dd1a4e94814ac4828214cbd93cfe', automated: true };
    const finding = { ...comment('1', '**Fix malformed table rows in the properties table.**'), author };
    const native: ProviderReviewInput = { ...input([thread('a', { resolved: true, comments: [finding] })]), bots: [{ id: 'coderabbit', authorId: author.id, login: author.login }], complete: true };
    const summary = { ...comment('2', '**Actionable comments posted: 1**'), author, createdAt: '2026-11-01T11:59:00Z' };
    const panel = renderProviderReviewPanel(host(), native, { comments: [summary] });
    const row = panel.element.querySelector('[data-geld-review-bot="coderabbit"]');
    expect(row?.textContent).toContain('CodeRabbit');
    expect(row?.textContent).toContain('Findings resolved');
    expect(row?.textContent).toContain(author.login);
    expect(row?.querySelector('a')?.href).toBe(finding.url);
    expect(row?.querySelector('[data-geld-bot-summary="coderabbit"]')?.getAttribute('data-geld-source')).toBe(summary.anchor);
    expect(panel.element.querySelectorAll(`[data-geld-source="${summary.anchor}"]`)).toHaveLength(1);
    expect(panel.element.querySelector(`[data-geld-round-group] [data-geld-source="${summary.anchor}"]`)).toBeNull();
    panel.update({ ...native, complete: false }, { comments: [summary] });
    expect(panel.element.dataset.state).toBe('partial');
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).toContain('count unavailable');
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).not.toContain('No findings');
  });

  it('uses the native avatar of a bound bot account for its compact summary', () => {
    const author = { id: 'trusted-bot', login: 'project-reviewer', automated: true };
    const source = { ...comment('1'), author };
    const native: ProviderReviewInput = { ...input([thread('a', { comments: [source] })]), bots: [{ id: 'coderabbit', authorId: author.id }] };
    const panel = renderProviderReviewPanel(host(), native, {
      authorPresentation: value => ({ authorId: value.author.id, displayName: 'Project reviewer', avatar: { src: 'https://gitlab.com/uploads/coderabbit.png', width: 32, height: 32, borderRadius: '50%' } }),
    });
    const image = panel.element.querySelector<HTMLImageElement>('[data-geld-review-key="bots"] .geld-provider-review__bot-icon');
    expect(image?.src).toBe('https://gitlab.com/uploads/coderabbit.png');
    expect(image?.dataset.shape).toBe('round');expect(image?.width).toBe(20);expect(image?.height).toBe(20);
    expect(image?.alt).toBe('');expect(image?.getAttribute('aria-hidden')).toBe('true');expect(image?.referrerPolicy).toBe('no-referrer');
    expect(image?.parentElement?.textContent).toContain('CodeRabbit');
    panel.destroy();
  });

  it.each(['absent', 'unsafe', 'different-author'] as const)('falls back to a registered bot mark when the native avatar is %s', condition => {
    const author = { id: 'trusted-bot', login: 'project-reviewer', automated: true };
    const source = { ...comment('1'), author };
    const native: ProviderReviewInput = { ...input([thread('a', { comments: [source] })]), bots: [{ id: 'greptile', authorId: author.id }] };
    const panel = renderProviderReviewPanel(host(), native, {
      authorPresentation: value => condition === 'absent' ? null : { authorId: condition === 'different-author' ? 'other-account' : value.author.id, displayName: 'Project reviewer', avatar: { src: condition === 'unsafe' ? 'javascript:alert(1)' : 'https://gitlab.com/unrelated.png', width: 32, height: 32 } },
    });
    expect(panel.element.querySelector<HTMLImageElement>('[data-geld-review-key="bots"] .geld-provider-review__bot-icon')?.src).toBe('https://avatars.githubusercontent.com/in/867647?s=40&v=4');
    panel.destroy();
  });

  it('does not assign bot branding based on a comment claiming a registered identity', () => {
    const impostor = { ...comment('1', 'CodeRabbit review completed'), author: { id: 'ordinary-user', login: 'coderabbit', automated: true } };
    const panel = renderProviderReviewPanel(host(), input([thread('a', { comments: [impostor] })]));
    expect(panel.element.querySelector('.geld-provider-review__bot-icon')).toBeNull();
    expect(panel.element.querySelector('[data-geld-review-key="bots"]')).not.toBeNull();
    expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
    panel.destroy();
  });

  it('offers explicit identity only for unbound automated accounts and supported services', async () => {
    const automated = { ...comment('1', '<!-- CodeRabbit marker is not an identity -->'), author: { id: '12345', login: 'unidentified-project-account', automated: true } };
    const save = vi.fn(async (_comment: ProviderReviewComment, _botId: string) => undefined);
    const options = { identifyReviewer: { repository: { provider: subject.provider, origin: subject.origin, path: subject.repository }, choices: [{ id: 'coderabbit', label: 'CodeRabbit' }, { id: 'copilot', label: 'Copilot' }], save } };
    const panel = renderProviderReviewPanel(host(), input([thread('a', { comments: [automated, { ...comment('2'), author: { id: '67890', login: 'human-reviewer', automated: false } }] })]), options);
    expect(save).not.toHaveBeenCalled();
    const identities = panel.element.querySelectorAll('.geld-provider-reviewer-identity');
    expect(identities).toHaveLength(1);
    expect(identities[0]?.textContent).not.toContain('Copilot');
    expect(identities[0]?.textContent).toContain('12345');
    [...panel.element.querySelectorAll<HTMLButtonElement>('.geld-provider-reviewer-identity button')].find((button) => button.textContent === 'CodeRabbit')?.click();
    expect(save).not.toHaveBeenCalled();
    expect(panel.element.querySelector('.geld-provider-reviewer-identity__confirmation')?.textContent).toContain('Trust unidentified-project-account as CodeRabbit for this repository?');
    [...panel.element.querySelectorAll<HTMLButtonElement>('.geld-provider-reviewer-identity button')].find((button) => button.textContent === 'Trust')?.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(automated, 'coderabbit'));
    panel.update({ ...input([thread('a', { comments: [automated] })]), bots: [{ id: 'coderabbit', authorId: '12345' }] }, options);
    expect(panel.element.querySelector('.geld-provider-reviewer-identity')).toBeNull();
  });

  it('runs and cancels AI only from controls and keeps original human text alongside transformed findings', () => {
    const original = input([thread('a')]);
    const base = buildProviderReviewItems(original);
    const run = vi.fn();
    const cancel = vi.fn();
    const state: ProviderAiState = { kind: 'ready', key: providerReviewKey(original.subject), pending: new Set(), stale: false, summary: { tldr: '<script>plain text</script>', updatedAt: '2026-11-01T13:00:00Z', forItems: base.map((item) => item.id) } };
    const options = { ai: { enabled: true, state, run, cancel }, transformItems: (items: typeof base) => items.map((item) => ({ ...item, title: 'AI consolidated title', context: 'Additional context', rewritten: true })) };
    const panel = renderProviderReviewPanel(host(), original, options);
    expect(run).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(panel.element.querySelector('[data-geld-item] > [data-geld-review-toggle]')?.textContent).toContain('AI consolidated title');
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment('1').body);
    expect(panel.element.querySelector('[data-geld-ai-summary]')?.textContent).toContain('<script>plain text</script>');
    expect(panel.element.querySelector('script')).toBeNull();
    panel.element.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.click();
    expect(run).toHaveBeenCalledTimes(1);
    panel.update(original, { ...options, ai: { ...options.ai, state: { ...state, kind: 'running', pending: new Set(['tldr']) } } });
    expect(panel.element.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.disabled).toBe(true);
    panel.element.querySelector<HTMLButtonElement>('[data-geld-ai-cancel]')?.click();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps edited human comments in their creation round and seats new comments after the next native push', () => {
    const original = input([thread('a')]);
    const edited = { ...comment('2', 'Current edited review text.'), updatedAt: '2026-11-01T14:00:00Z' };
    const latest = { ...comment('3', 'New human comment after the second push.'), createdAt: '2026-11-01T13:30:00Z' };
    const events: readonly ProviderReviewPanelEvent[] = [{ id: 'push-1', url: reviewUrl, author: comment('1').author, body: 'Native push event one', createdAt: '2026-11-01T11:00:00Z', kind: 'push' }, { id: 'push-2', url: reviewUrl, author: comment('1').author, body: 'Native push event two', createdAt: '2026-11-01T13:00:00Z', kind: 'push' }];
    const options = { reviewGrouping: 'batch', comments: [edited, latest], events } satisfies Parameters<typeof renderProviderReviewPanel>[2];
    const panel = renderProviderReviewPanel(host(), original, options);
    const rounds = panel.element.querySelectorAll<HTMLElement & { open: boolean }>('[data-geld-review-round]');
    expect(rounds).toHaveLength(2);
    expect([...rounds].map((round) => round.dataset.geldReviewRound)).toEqual(['push-2', 'push-1']);
    expect(rounds[1]?.querySelector('[data-geld-review-pointer]')?.textContent).toContain(comment('1').body);
    expect(rounds[1]?.querySelector('[data-geld-source="note_2"]')?.textContent).toContain(edited.body);
    expect(rounds[1]?.textContent).toContain('Edited');
    expect(rounds[1]?.querySelector<HTMLTimeElement>('[data-geld-source="note_2"] time:last-of-type')?.dateTime).toBe('2026-11-01T14:00:00.000Z');
    expect(rounds[0]?.textContent).toContain('Latest recorded push');
    expect(rounds[0]?.textContent).toContain(latest.body);
    expect(rounds[0]?.querySelector('[data-geld-source="note_2"]')).toBeNull();
    expect(rounds[1]?.querySelector<HTMLAnchorElement>('[data-geld-source="note_2"] a')?.href).toBe(edited.url);
    const item = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-attention] [data-geld-item]');
    if (item !== null && item !== undefined) item.open = true;
    panel.update(original, { ...options, reviewGrouping: 'type' });
    expect(panel.element.querySelector('[data-geld-review-attention]')).toBeNull();
    expect(panel.element.querySelector('[data-geld-round-group="review"] [data-geld-type-round="push-1"] [data-geld-item]')).not.toBeNull();
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]')?.open).toBe(true);
    panel.update(original, { ...options, comments: [] });
    expect(panel.element.querySelector('[data-geld-review-round="push-2"]')?.textContent).toContain('No conversation recorded after this push.');
  });

  it('keeps an edited human thread and later replies with its original push while a new thread joins the later push', () => {
    const first = comment('1', 'Original human thread before the next push.');
    const later = { ...comment('2', 'New thread after the next push.'), createdAt: '2026-11-01T13:30:00Z' };
    const original = input([thread('a', { comments: [first] }), thread('b', { comments: [later] })]);
    const events: readonly ProviderReviewPanelEvent[] = [
      { id: 'push-a', url: reviewUrl, author: first.author, body: 'Native first push', createdAt: '2026-11-01T11:00:00Z', kind: 'push', headSha: 'b'.repeat(40) },
      { id: 'push-b', url: reviewUrl, author: first.author, body: 'Native latest push', createdAt: '2026-11-01T13:00:00Z', kind: 'push', headSha: subject.headSha },
    ];
    const panel = renderProviderReviewPanel(host(), original, { reviewGrouping: 'batch', events });
    const originalLaterId = panel.element.querySelector<HTMLElement>('[data-geld-review-round="push-b"] [data-geld-review-pointer]')?.dataset.geldReviewPointer;
    const edited = { ...first, body: 'Current edited human thread text.', updatedAt: '2026-11-01T14:00:00Z' };
    const reply = { ...comment('3', 'Actual reply after the later push.'), createdAt: '2026-11-01T14:30:00Z' };
    const refreshed = input([thread('a', { comments: [edited, reply] }), thread('b', { comments: [later] })]);
    panel.update(refreshed, { reviewGrouping: 'batch', events });
    const earlierRound = panel.element.querySelector('[data-geld-review-round="push-a"]');
    const laterRound = panel.element.querySelector('[data-geld-review-round="push-b"]');
    expect(panel.element.querySelector('[data-geld-review-attention] [data-geld-source="note_1"]')?.textContent).toContain(edited.body);
    expect(panel.element.querySelector('[data-geld-review-attention] [data-geld-source="note_3"]')?.textContent).toContain(reply.body);
    expect(panel.element.querySelector('[data-geld-review-attention]')?.textContent).toContain('Edited');
    expect(earlierRound?.querySelector('[data-geld-review-pointer]')?.textContent).toContain(edited.body);
    expect(panel.element.querySelector('[data-geld-review-attention] [data-geld-source="note_2"]')?.textContent).toContain(later.body);
    expect(laterRound?.querySelector('[data-geld-review-pointer]')?.textContent).toContain(later.body);
    expect(laterRound?.querySelector('[data-geld-source="note_1"], [data-geld-source="note_3"]')).toBeNull();
    expect(laterRound?.textContent).toContain('Latest recorded push');
    expect(laterRound?.querySelector<HTMLElement>('[data-geld-review-pointer]')?.dataset.geldReviewPointer).toBe(originalLaterId);
    expect([...panel.element.querySelectorAll<HTMLElement>('[data-geld-source]')].map((source) => source.dataset.geldSource)).toEqual(['note_1', 'note_3', 'note_2']);
    expect(refreshed.subject.headSha).toBe(subject.headSha);
    expect(earlierRound?.textContent).not.toContain(first.body);
  });

  it('keeps an automated edited report on its latest edit clock without moving its original finding thread', () => {
    const author = { id: '38968537', login: 'native-review-service', automated: true };
    const finding = { ...comment('1', 'Original native automated finding.'), author, updatedAt: '2026-11-01T14:00:00Z' };
    const report = { ...comment('2', 'Current edited review report.'), author, updatedAt: '2026-11-01T14:00:00Z' };
    const panel = renderProviderReviewPanel(host(), input([thread('a', { comments: [finding] })]), { reviewGrouping: 'batch', comments: [report], events: [
      { id: 'push-a', url: reviewUrl, author, body: 'Native first push', createdAt: '2026-11-01T11:00:00Z', kind: 'push' },
      { id: 'push-b', url: reviewUrl, author, body: 'Native latest push', createdAt: '2026-11-01T13:00:00Z', kind: 'push' },
    ] });
    const earlierRound = panel.element.querySelector('[data-geld-review-round="push-a"]');
    const laterRound = panel.element.querySelector('[data-geld-review-round="push-b"]');
    expect(panel.element.querySelector('[data-geld-review-attention] [data-geld-source="note_1"]')?.textContent).toContain(finding.body);
    expect(earlierRound?.querySelector('[data-geld-source="note_2"]')).toBeNull();
    expect(laterRound?.querySelector('[data-geld-source="note_2"]')?.textContent).toContain(report.body);
    expect(laterRound?.querySelector<HTMLTimeElement>('[data-geld-source="note_2"] time:last-of-type')?.dateTime).toBe('2026-11-01T14:00:00.000Z');
    expect(laterRound?.textContent).toContain('Automated account');
    expect(laterRound?.textContent).toContain('Edited');
    expect(panel.element.querySelectorAll('[data-geld-source="note_2"]')).toHaveLength(1);
  });

  it('does not invent push rounds from comment prose or events with unknown kinds', () => {
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { reviewGrouping: 'batch', comments: [comment('2', 'I pushed a new commit abc1234.')], events: [{ id: 'unknown', url: reviewUrl, author: comment('1').author, body: 'Added 1 commit', createdAt: '2026-11-01T11:00:00Z', kind: 'activity' }] });
    expect(panel.element.querySelector('[data-geld-review-round]')).toBeNull();
    expect(panel.element.querySelector('[data-geld-review-history]')?.textContent).toContain('push boundaries unavailable');
    expect(panel.element.textContent).toContain('I pushed a new commit');
  });

  it('reads reports only from actual current check service hosts, without GitHub check-name inference', () => {
    const panel = renderProviderReviewPanel(host(), { ...input(), checks: [
      { name: 'codecov/project', sha: subject.headSha, status: 'completed', conclusion: 'success', description: '80.12% (+0.03%) compared to abc1234', detailsUrl: 'https://app.codecov.io/gl/group/project/pull/42' },
      { name: 'codecov/patch', sha: subject.headSha, status: 'completed', conclusion: 'success', description: '90% covered', detailsUrl: 'https://codecov.io.evil.example/attack' },
      { name: 'CodeQL', sha: subject.headSha, status: 'completed', conclusion: 'success', description: 'No new alerts in code changed by this pull request', detailsUrl: 'https://gitlab.com/group/project/runs/123' },
      { name: 'codecov/old', sha: 'b'.repeat(40), status: 'completed', conclusion: 'failure', detailsUrl: 'https://codecov.io/gl/group/project' },
    ] });
    expect(panel.element.querySelectorAll('[data-geld-report]')).toHaveLength(1);
    expect(panel.element.querySelector('[data-geld-report="codecov"]')?.textContent).toContain('80.12% (+0.03%)');
    expect(panel.element.querySelector('[data-geld-report="codecov"] a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
  });

  it('attributes preview links to their actual automated source, archives earlier links, and never grants a review vote', () => {
    const author = { id: '12345', login: 'native-deploy-account', automated: true };
    const earlier = { ...comment('2', 'Preview ready: [Preview](https://deploy.example/first)'), author, createdAt: '2026-11-01T10:00:00Z' };
    const latest = { ...comment('3', 'Preview failed: [Preview](https://deploy.example/second)'), author, createdAt: '2026-11-01T11:00:00Z' };
    const human = { ...comment('4', 'Preview ready: [Preview](https://unverified.example/)'), author: { id: '456', login: 'a-person', automated: false } };
    const unsafe = { ...comment('5', 'Preview ready: [Preview](javascript:alert(1))'), author };
    const panel = renderProviderReviewPanel(host(), input(), { comments: [latest, earlier, human, unsafe] });
    const section = panel.element.querySelector('[data-geld-review-key="previews"]');
    expect(section?.querySelector('[data-geld-review-toggle]')?.textContent).toBe('Previews · 1');
    expect(section?.querySelector('[data-geld-preview="note_3"]')?.textContent).toContain('native-deploy-account · Reported status: failed');
    expect(section?.querySelector('[data-geld-preview="note_3"] > a')?.getAttribute('href')).toBe('https://deploy.example/second');
    expect(section?.querySelector('[data-geld-review-key="previews:earlier"] [data-geld-preview]')?.getAttribute('data-geld-preview')).toBe('note_2');
    expect(section?.textContent).not.toContain('a-person');
    expect(section?.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
  });

  it('keeps deployment advice in one finding instead of duplicating it as a preview', () => {
    const source = { ...comment('7', 'Missing dependency.\nIf the sandbox install script (`curl ... | sudo bash`) does not pass --with plugins-temporary to poetry install, the sandbox deploy will break.'), author: { id: 'native-review-bot', login: 'project-reviewer', automated: true } };
    const panel = renderProviderReviewPanel(host(), { ...input([thread('a', { comments: [source] })]), bots: [{ id: 'greptile', authorId: source.author.id }] });
    expect(panel.element.querySelectorAll('[data-geld-source="note_7"]')).toHaveLength(1);
    expect(panel.element.querySelector('[data-geld-review-key="previews"]')).toBeNull();
  });

  it('marks an item reviewed locally without resolving its native thread or erasing bot findings', () => {
    const author = { id: '12345', login: 'native-review-account', automated: true };
    const source: ProviderReviewInput = { ...input([thread('a', { comments: [{ ...comment('1', '**Fix the credentials cache.**'), author }] })]), bots: [{ id: 'coderabbit', authorId: author.id }], complete: true };
    const [native] = buildProviderReviewItems(source);
    if (native === undefined) throw new Error('Missing native item.');
    const set = vi.fn();
    const localReviewed = { ids: new Set([native.id]), pending: new Set<string>(), set };
    const transformItems = (items: readonly typeof native[]) => items.map((item) => ({ ...item, title: 'AI consolidated cache title', context: 'The native words remain below.', rewritten: true }));
    const panel = renderProviderReviewPanel(host(), source, { localReviewed, transformItems });
    expect(set).not.toHaveBeenCalled();
    expect(panel.element.querySelector('[data-geld-review-group="done"] [data-geld-item] > [data-geld-review-toggle]')?.textContent).toContain('AI consolidated cache title');
    expect(panel.element.querySelector('[data-geld-local-review-notice]')?.textContent).toBe('Reviewed on this device. Native status: Open.');
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).toContain('1 open finding');
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe('**Fix the credentials cache.**');
    expect(source.threads[0]?.resolved).toBe(false);
    panel.element.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ id: native.id, title: 'AI consolidated cache title' }), false);
    panel.update(source, { localReviewed: { ...localReviewed, pending: new Set([native.id]) }, transformItems });
    panel.element.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    expect(set).toHaveBeenCalledTimes(1);
    expect(panel.element.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('retains native resolved state and includes the distinct local mark in copied digest history', async () => {
    const source = input([thread('a', { resolved: true })]);
    const [native] = buildProviderReviewItems(source);
    if (native === undefined) throw new Error('Missing native item.');
    let copied = '';
    const panel = renderProviderReviewPanel(host(), source, { localReviewed: { ids: new Set([native.id]), pending: new Set(), set: () => undefined }, copyText: (text) => { copied = text; }, reviewGrouping: 'batch', events: [{ id: 'native-push', url: reviewUrl, author: comment('1').author, body: 'Actual native push', createdAt: '2026-11-01T11:00:00Z', kind: 'push' }] });
    expect(panel.element.querySelector('[data-geld-item]')?.getAttribute('data-state')).toBe('resolved');
    expect(panel.element.querySelector('[data-geld-review-round="native-push"] [data-geld-local-review-notice]')?.textContent).toContain('Native status: Resolved');
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain('Reviewed on this device. Native status: Resolved.'));
    expect(copied).toContain(`${reviewUrl}#note_1`);
  });

  it('keeps keyboard focus with a local review action while its item moves between groups', () => {
    const source = input([thread('a')]);
    const [item] = buildProviderReviewItems(source);
    if (item === undefined) throw new Error('Missing native item.');
    const set = vi.fn();
    const panel = renderProviderReviewPanel(host(), source, { localReviewed: { ids: new Set(), pending: new Set(), set } });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]');
    const details = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]');
    if (details !== null) details.open = true;
    button?.focus();
    panel.update(source, { localReviewed: { ids: new Set(), pending: new Set([item.id]), set } });
    expect(document.activeElement?.getAttribute('data-geld-local-review-focus')).toBe(item.id);
    panel.update(source, { localReviewed: { ids: new Set([item.id]), pending: new Set(), set } });
    expect(document.activeElement?.getAttribute('data-geld-local-reviewed')).toBe(item.id);
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-group="done"]')?.open).toBe(true);
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]')?.open).toBe(true);
  });

  it('retains a verified native avatar, name, profile and role classes without changing source navigation or controls', async () => {
    const source = comment('1');
    const presentation: ProviderReviewAuthorPresentation = {
      authorId: source.author.id, displayName: 'Jorge Tomás', username: '@jotolo_gl', profileUrl: `${subject.origin}/jotolo_gl`,
      avatar: { src: `${subject.origin}/uploads/-/system/user/avatar/33096491/avatar.png`, width: 32, height: 32, borderRadius: '50%', className: 'gl-avatar gl-avatar-circle gl-avatar-s32' },
      badges: [{ label: 'Author', title: 'This user is the author of this merge request.', className: 'gl-badge badge badge-pill badge-neutral' }, { label: 'Developer', title: 'This user has the developer role in the GitLab project.', className: 'gl-badge badge badge-pill badge-neutral' }],
    };
    const opened = vi.fn((_url: string, _anchor: string, event: MouseEvent) => event.preventDefault());
    const activate = vi.fn(async () => true);
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => presentation, onOpenSource: opened, actionsForSource: () => [{ kind: 'reply', label: 'Native reply', available: true, activate }] });
    const avatar = panel.element.querySelector<HTMLImageElement>('[data-geld-author-avatar]');
    expect(avatar?.src).toBe(presentation.avatar?.src);
    expect(avatar?.style.width).toBe('32px');
    expect(avatar?.style.height).toBe('32px');
    expect(avatar?.style.borderRadius).toBe('50%');
    expect(avatar?.classList.contains('gl-avatar-circle')).toBe(true);
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    const profile = panel.element.querySelector<HTMLAnchorElement>('[data-geld-author-profile]');
    expect(profile?.href).toBe(presentation.profileUrl);
    expect(profile?.textContent).toBe('Jorge Tomás');
    expect(panel.element.querySelector('.geld-provider-review__byline')?.textContent).toContain('@jotolo_gl');
    const roles = [...panel.element.querySelectorAll<HTMLElement>('[data-geld-author-badge]')];
    expect(roles.map((role) => role.textContent)).toEqual(['Author', 'Developer']);
    expect(roles.every((role) => role.classList.contains('badge-neutral') && role.style.color === '' && role.style.backgroundColor === '')).toBe(true);
    expect(panel.element.querySelector('time')?.dateTime).toBe(source.createdAt.replace('Z', '.000Z'));
    [...panel.element.querySelectorAll<HTMLAnchorElement>('[data-geld-source="note_1"] a')].find((anchor) => anchor.textContent === 'View original')?.click();
    expect(opened).toHaveBeenCalledWith(source.url, source.anchor, expect.any(MouseEvent));
    [...panel.element.querySelectorAll<HTMLButtonElement>('[data-geld-source="note_1"] button')].find((button) => button.textContent === 'Native reply')?.click();
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(source.body);
  });

  it('falls back to the normalized author when native identity is mismatched, empty or unavailable', () => {
    const forged: ProviderReviewAuthorPresentation = { authorId: 'different-account', displayName: 'Maintainer person', badges: [{ label: 'Owner' }], avatar: { src: 'https://avatars.example/person.png', width: 32, height: 32 } };
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => forged });
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
    expect(panel.element.querySelector('[data-geld-author-avatar],[data-geld-author-badge]')).toBeNull();
    panel.update(input([thread('a')]), { authorPresentation: () => ({ ...forged, authorId: 'user-1', displayName: ' ' }) });
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
    panel.update(input([thread('a')]), { authorPresentation: () => { throw new Error('Native header was replaced.'); } });
    expect(panel.element.dataset.state).toBe('ready');
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
    expect(panel.element.querySelector('[data-geld-source="note_1"] a')?.getAttribute('href')).toBe(comment('1').url);
  });

  it('rejects unsafe avatar/profile URLs and invalid dimensions while keeping verified names as text', () => {
    const sources: readonly ProviderReviewAuthorPresentation[] = [
      { authorId: 'user-1', displayName: 'Native name', profileUrl: 'https://evil.example/alice', avatar: { src: 'javascript:alert(1)', width: 32, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', profileUrl: 'https://alice:secret@gitlab.com/alice', avatar: { src: 'data:image/svg+xml,<svg onload=alert(1)>', width: 32, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', avatar: { src: 'https://avatars.example/alice.png', width: -1, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', avatar: { src: 'https://avatars.example/alice.png', width: Infinity, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', avatar: { src: 'http://avatars.example/alice.png', width: 32, height: 32 } },
    ];
    for (const presentation of sources) {
      const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => presentation });
      expect(panel.element.querySelector('[data-geld-author-profile],[data-geld-author-avatar]')).toBeNull();
      expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('Native name');
      expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment('1').body);
    }
  });

  it('inserts names and roles as text without copying native handlers, ids or arbitrary HTML', () => {
    const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => ({ authorId: 'user-1', displayName: markup, avatar: { src: 'https://avatars.example/alice.png', width: 32, height: 32, className: 'gl-avatar geld-provider-hidden onclick="attack"' }, badges: [{ label: markup, title: markup, className: 'gl-badge badge-neutral id="forged" onclick="attack"' }] }) });
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe(markup);
    const badge = panel.element.querySelector('[data-geld-author-badge]');
    expect(badge?.textContent).toBe(markup);
    expect(badge?.getAttribute('title')).toBe(markup);
    expect(panel.element.querySelector('script,[onerror],[onclick],#forged')).toBeNull();
    expect(panel.element.querySelectorAll('img[data-geld-author-avatar]')).toHaveLength(1);
    expect(panel.element.querySelector('[data-geld-author-avatar]')?.classList.contains('geld-provider-hidden')).toBe(false);
    expect(badge?.classList.contains('badge-neutral')).toBe(true);
  });

  it('refreshes native presentation independently of source text and keeps theme styling in native classes', () => {
    let presentation: ProviderReviewAuthorPresentation = { authorId: 'user-1', displayName: 'First native name', badges: [{ label: 'Developer', className: 'gl-badge badge badge-neutral' }] };
    const source = input([thread('a')]);
    const options = { authorPresentation: () => presentation };
    const panel = renderProviderReviewPanel(host(), source, options);
    const details = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]');
    if (details !== null) details.open = true;
    presentation = { ...presentation, displayName: 'Updated native name', badges: [{ label: 'Maintainer', title: 'Verified native header changed.', className: 'gl-badge badge badge-neutral' }] };
    panel.update(source, options);
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('Updated native name');
    expect(panel.element.querySelector('[data-geld-author-badge]')?.textContent).toBe('Maintainer');
    expect(panel.element.querySelector<HTMLElement>('[data-geld-author-badge]')?.style.cssText).toBe('');
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-item]')?.open).toBe(true);
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment('1').body);
  });

  it('does not attach native presentation to an ordinary comment with an invalid original source URL', () => {
    const presentation = vi.fn(() => ({ authorId: 'user-1', displayName: 'Unverified role owner', badges: [{ label: 'Owner' }] }));
    const panel = renderProviderReviewPanel(host(), input(), { comments: [{ ...comment('1'), url: 'https://evil.example/not-this-review' }], authorPresentation: presentation });
    expect(presentation).not.toHaveBeenCalled();
    expect(panel.element.querySelector('[data-geld-author-badge]')).toBeNull();
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
  });

  it('does not reuse another account’s metadata when ordinary data repeats a native source anchor', () => {
    const original = comment('1');
    const duplicate = { ...original, author: { id: 'different-user', login: 'another-account' } };
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { comments: [duplicate], authorPresentation: (source) => ({ authorId: source.author.id, displayName: source.author.id === original.author.id ? 'Actual native author' : 'Another native author', badges: [{ label: source.author.id === original.author.id ? 'Developer' : 'Maintainer' }] }) });
    expect(panel.element.querySelector('[data-geld-source="note_1"] .geld-provider-review__byline strong')?.textContent).toBe('Actual native author');
    expect(panel.element.querySelector('[data-geld-source="note_1"] [data-geld-author-badge]')?.textContent).toBe('Developer');
  });

  it('shows individual native merge rules without inferring approval counts, review votes or source completeness', () => {
    const panel = renderProviderReviewPanel(host(), { subject, threads: [], reviewers: [{ author: { id: '1', login: 'alice' }, state: 'approved' }] }, {
      complete: false, approvalsRequired: null, approvalsLeft: null,
      unavailable: [{ area: 'CI checks', reason: 'Authentication is required.' }, { area: 'approval requirements', reason: 'The API did not supply approval requirements.' }],
      requirements: [
        { id: 'classicMergeCheckItem-minimum_approvals', label: '1+ approval', state: 'passed' },
        { id: 'classicMergeCheckItem-minimum_default_reviewer_approvals', label: '1+ approval from default reviewers', state: 'passed' },
      ],
    });
    const section = panel.element.querySelector('[data-geld-review-key="checks"]');
    expect(section?.querySelector('[data-geld-review-toggle]')?.getAttribute('aria-label')).toBe('Checks · 2/2 merge checks · CI unavailable');
    expect(section?.querySelector('.geld-provider-review__row-preview')?.textContent).toBe('2/2 merge checks · CI unavailable');
    expect(panel.element.querySelector('[data-geld-review-key="requirements"]')).toBeNull();
    expect(section?.querySelectorAll('[data-geld-native-requirement]')).toHaveLength(2);
    expect(section?.textContent).toContain('1+ approval from default reviewers');
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] .geld-provider-review__reviewer-summary')?.textContent).toBe('Reviews · 1 approval');
    expect(panel.element.textContent).not.toContain('/2 required approvals');
    expect(section?.querySelector('[data-geld-ci-checks]')?.textContent).toContain('CI checks could not be read.');
    expect(panel.element.textContent).not.toContain('Authentication is required.');
    expect(panel.element.textContent).not.toContain('The API did not supply approval requirements.');
    expect(panel.element.dataset.state).toBe('partial');
    expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
  });

  it('updates observed merge rule states, preserves disclosure, and copies source labels as text', async () => {
    let copied = '';
    const label = '<img src=x onerror=alert(1)> Native rule';
    const options = { requirements: [{ id: 'native-rule', label, state: 'passed' }], copyText: (text: string) => { copied = text; } } satisfies Parameters<typeof renderProviderReviewPanel>[2];
    const panel = renderProviderReviewPanel(host(), input(), options);
    const section = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-key="checks"]');
    if (section !== null) section.open = true;
    panel.update(input(), { ...options, requirements: [{ id: 'native-rule', label, state: 'unknown' }] });
    expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-key="checks"]')?.open).toBe(true);
    expect(panel.element.querySelector('[data-geld-native-requirement="native-rule"]')?.textContent).toContain(`${label}Unknown`);
    expect(panel.element.querySelector('img,[onerror]')).toBeNull();
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain(`Merge requirement: ${label}: Unknown`));
    panel.update(input(), { requirements: null });
    expect(panel.element.querySelector('[data-geld-merge-checks]')).toBeNull();
  });
});

describe('review standing availability', () => {
  it('copies partial observed facts and their source reason without claiming an aggregate zero', async () => {
    let copied = '';
    const native: ProviderReviewInput = { ...input(), reviewers: [{ author: { id: '1', login: 'known-approver' }, state: 'approved', reviewRequest: 'unknown' }] };
    const panel = renderProviderReviewPanel(host(), native, { unavailable: [{ area: 'reviews', reason: 'The reviewer endpoint returned403.' }], copyText: (text) => { copied = text; } });
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] .geld-provider-review__reviewer-summary')?.textContent).toBe('Reviews · Partial · 1 observed approval');
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain('Reviews · Partial · 1 observed approval'));
    expect(copied).toContain('Reviews source unavailable: The reviewer endpoint returned403.');
    expect(copied).toContain('- known-approver: Approved');
    expect(native.reviewers?.[0]?.state).toBe('approved');
    panel.destroy();
  });

  it('keeps unavailable distinct from known empty in the panel and copied digest', async () => {
    let copied = '';
    const unread: ProviderReviewInput = { subject, threads: [], checks: [] };
    const panel = renderProviderReviewPanel(host(), unread, { copyText: (text) => { copied = text; } });
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] [data-geld-review-toggle]')?.getAttribute('aria-label')).toBe('Reviews · Unavailable');
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain('Reviews · Unavailable'));
    expect(copied).not.toContain('0 approvals');
    panel.update(input(), { unavailable: [{ area: 'checks', reason: 'CI unread' }] });
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] [data-geld-review-toggle]')?.getAttribute('aria-label')).toBe('Reviews · 0 approvals');
    panel.destroy();
  });

  it.each([
    { required: 2, left: 1, tally: '1/2 required approvals' },
    { required: 2, left: 0, tally: '2/2 required approvals' },
    { required: 2, left: 3, tally: null },
    { required: 0, left: 0, tally: null },
    { required: 2.5, left: 1, tally: null },
    { required: 2, left: -1, tally: null },
    { required: Number.NaN, left: 0, tally: null },
  ])('retains guarded required/left facts in partial sources: $required/$left', ({ required, left, tally }) => {
    const panel = renderProviderReviewPanel(host(), input(), { unavailable: [{ area: 'reviews', reason: 'Reviewers unread' }], approvalsRequired: required, approvalsLeft: left });
    const section = panel.element.querySelector('[data-geld-review-key="reviewers"]');
    expect(section?.querySelector('[data-geld-review-toggle]')?.getAttribute('aria-label')).toBe(`Reviews · Partial${tally === null ? '' : ` · ${tally}`}`);
    expect(section?.textContent).not.toContain('0 approvals'); expect(section?.textContent).not.toContain('No reviewer standings.');
    panel.destroy();
  });

  it('retains an independently known required-approval fraction even when no author list is readable', () => {
    const panel = renderProviderReviewPanel(host(), { subject, threads: [] }, { approvalsRequired: 2, approvalsLeft: 1, unavailable: [{ area: 'reviews', reason: 'Author lists unavailable' }] });
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] .geld-provider-review__reviewer-summary')?.textContent).toBe('Reviews · Partial · 1/2 required approvals');
    panel.destroy();
  });
});


it('renders an owned dashboard with button-controlled sections and preserves disclosure choices', () => {
  const source = input([thread('a')]);
  const mount = host();
  const description = document.createElement('p');description.textContent = 'A long native description';mount.append(description);
  const panel = renderProviderReviewPanel(mount, source, { comments: [comment('2', 'Human context')] });
  expect(mount.firstElementChild).toBe(panel.element);
  expect(description.parentElement).toBe(mount);
  expect(panel.element.nextElementSibling).toBe(description);
  expect(panel.element.querySelector('details[data-geld-review-key]')).toBeNull();
  expect(panel.element.querySelector('[data-geld-review-metric]')).toBeNull();
  expect(panel.element.querySelector('progress')?.max).toBe(1);
  expect(panel.element.querySelector('progress')?.value).toBe(0);
  expect(panel.element.querySelector('.geld-provider-review__header h2')?.textContent).toBe('Geld');
  const section = panel.element.querySelector<HTMLElement>('[data-geld-review-group="open"]');
  const toggle = section?.querySelector<HTMLButtonElement>(':scope > [data-geld-review-toggle]');
  if (section === null || section === undefined || toggle === null || toggle === undefined) throw new Error('Missing dashboard section');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const controlled = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  expect(controlled?.parentElement).toBe(section);
  expect(controlled?.getAttribute('aria-labelledby')).toBe(toggle.id);
  toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  panel.update({ ...source, closed: true });
  expect(panel.element.querySelector('[data-geld-review-group="open"] > button')?.getAttribute('aria-expanded')).toBe('false');
  expect(panel.element.querySelector('button a, button button')).toBeNull();
  panel.destroy();
});

it('retains focus on the original-conversation control after its keyboard activation rerenders the same review', () => {
  const source = input([thread('a')]);
  let shown = false;
  const toggle = (): void => { shown = !shown;panel.update(source, { originalConversation: { shown, toggle } }); };
  const panel = renderProviderReviewPanel(host(), source, { originalConversation: { shown, toggle } });
  const before = panel.element.querySelector<HTMLButtonElement>('[data-geld-original-conversation]');
  before?.focus();before?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  const after = panel.element.querySelector<HTMLButtonElement>('[data-geld-original-conversation]');
  expect(after).not.toBe(before);expect(after?.getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(after);
  after?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  expect(document.activeElement).toBe(panel.element.querySelector('[data-geld-original-conversation]'));
  expect(panel.element.querySelector('[data-geld-original-conversation]')?.getAttribute('aria-pressed')).toBe('false');
  panel.destroy();
});

it('retains a focused custom disclosure on same-review updates without transferring focus across reviews or from another control', () => {
  const source = input([thread('a')]);
  const panel = renderProviderReviewPanel(host(), source);
  const before = panel.element.querySelector<HTMLButtonElement>('[data-geld-review-key="checks"] > button');
  before?.focus();before?.click();
  panel.update({ ...source, closed: true });
  const after = panel.element.querySelector<HTMLButtonElement>('[data-geld-review-key="checks"] > button');
  expect(after).not.toBe(before);expect(document.activeElement).toBe(after);
  expect(after?.getAttribute('aria-expanded')).toBe('true');
  panel.update({ ...source, subject: { ...source.subject, headSha: 'b'.repeat(40) } });
  expect(document.activeElement).not.toBe(panel.element.querySelector('[data-geld-review-key="checks"] > button'));
  const external = document.createElement('button');document.body.append(external);external.focus();
  panel.update({ ...source, closed: false });expect(document.activeElement).toBe(external);
  panel.destroy();
});

it('binds every batch-history disclosure to its current content and label after creating attention pointers', () => {
  const source = input([thread('a')]);
  const panel = renderProviderReviewPanel(host(), source, { reviewGrouping: 'batch', events: [{ id: 'push-1', url: reviewUrl, author: { id: 'author', login: 'author' }, body: 'Pushed changes', createdAt: '2026-11-01T11:00:00Z', kind: 'push' }] });
  expect(panel.element.querySelector('[data-geld-review-attention] [data-geld-item]')).not.toBeNull();
  for (const section of panel.element.querySelectorAll('[data-geld-review-key]')) {
    const button = section.querySelector<HTMLButtonElement>(':scope > button[data-geld-review-toggle]');
    const content = document.getElementById(button?.getAttribute('aria-controls') ?? '');
    expect(content?.parentElement).toBe(section);
    expect(content?.getAttribute('aria-labelledby')).toBe(button?.id);
    expect(document.getElementById(content?.getAttribute('aria-labelledby') ?? '')).toBe(button);
  }
  panel.destroy();
});


describe('empty provider triage control', () => {
  it('explains why triage is unavailable and cannot start a request', () => {
    const run = vi.fn();
    const panel = renderProviderReviewPanel(host(), input([]), { ai: { enabled: true, state: { kind: 'idle', key: providerReviewKey(subject), pending: new Set(), stale: false }, run, cancel: vi.fn() } });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-ai-run]');
    expect(button?.textContent).toBe('Nothing to triage');
    expect(button?.disabled).toBe(true);
    expect(button?.title).toContain('no open review threads');
    button?.click();
    expect(run).not.toHaveBeenCalled();
    panel.destroy();
  });
});


it('distinguishes severe open bot findings from a completed resolved review', () => {
  const finding = { ...comment('1', '**High Severity**\nValidate the request before trusting this value.'), author: { id: 'native-bot', login: 'project_bot', automated: true } };
  const native = { ...input([thread('a', { comments: [finding] })]), complete: true, bots: [{ id: 'coderabbit', authorId: 'native-bot' }] };
  const panel = renderProviderReviewPanel(host(), native);
  expect(panel.element.querySelector('[data-geld-review-bot]')?.getAttribute('data-geld-bot-health')).toBe('severe');
  expect(panel.element.querySelector('.geld-provider-review__bot-health')?.textContent).toBe('Severe findings');
  panel.update({ ...native, threads: native.threads.map(thread => ({ ...thread, resolved: true })) });
  expect(panel.element.querySelector('[data-geld-review-bot]')?.getAttribute('data-geld-bot-health')).toBe('good');
});

it('lights each bot pill as GitHub does: check, amber dot, red exclamation', () => {
  const light = (body: string, resolved = false): string | null => {
    const finding = { ...comment('1', body), author: { id: 'native-bot', login: 'project_bot', automated: true } };
    const panel = renderProviderReviewPanel(host(), { ...input([thread('a', { comments: [finding], resolved })]), complete: true, bots: [{ id: 'coderabbit', authorId: 'native-bot' }] });
    const chip = panel.element.querySelector('[data-geld-review-key="bots"] .geld-provider-review__status-chip');
    return [...chip?.querySelectorAll('svg') ?? []].at(-1)?.innerHTML ?? null;
  };
  expect(light('**High Severity**\nValidate the request.')).toContain('M12 7v6');
  expect(light('Consider a guard here.')).toContain('r="4"');
  expect(light('**High Severity**\nValidate the request.', true)).toContain('m7 12 3 3 7-7');
});

it('opens the shared settings UI and explains a failed request without acting after teardown', async () => {
  const open = vi.fn(async () => { throw new Error('No popup'); });
  const panel = renderProviderReviewPanel(host(), input(), { onOpenSettings: open });
  const button = panel.element.querySelector<HTMLButtonElement>('[aria-label="Open Geld settings"]');
  button?.click();await vi.waitFor(() => expect(button?.disabled).toBe(false));
  expect(open).toHaveBeenCalledOnce();expect(panel.element.textContent).toContain('Settings could not be opened');
  panel.destroy();button?.click();expect(open).toHaveBeenCalledOnce();
});

it('keeps open threads and their body disclosures across a new head and moves them into an untoggled resolved group', () => {
  const native = input([thread('a')]);
  const panel = renderProviderReviewPanel(host(), native, { renderComment: (_comment, body) => { body.innerHTML = '<details><summary>More</summary>Original detail</details>';return true; } });
  const item = panel.element.querySelector<HTMLElement & { open: boolean }>('.geld-provider-review__item')!;
  item.open = true;
  const detail = panel.element.querySelector<HTMLDetailsElement>('details')!;detail.open = true;detail.dispatchEvent(new Event('toggle'));
  panel.suspend();expect(panel.element.hidden).toBe(true);expect(panel.element.inert).toBe(true);
  panel.update({ ...native, subject: { ...subject, headSha: 'b'.repeat(40) }, threads: native.threads.map(thread => ({ ...thread, resolved: true })) });
  expect(panel.element.hidden).toBe(false);expect(panel.element.inert).toBe(false);
  expect(panel.element.querySelector<HTMLElement & { open: boolean }>('.geld-provider-review__item')?.open).toBe(true);
  expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-group="resolved"]')?.open).toBe(true);
  expect(panel.element.querySelector<HTMLDetailsElement>('details')?.open).toBe(true);
});

it('keeps a user-folded destination group closed when an opened thread becomes resolved', () => {
  const native = input([thread('a'), thread('b', { resolved: true })]);
  const panel = renderProviderReviewPanel(host(), native);
  const resolved = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-group="resolved"]')!;
  resolved.open = true;resolved.open = false;
  panel.element.querySelector<HTMLElement & { open: boolean }>('.geld-provider-review__item')!.open = true;
  panel.update({ ...native, threads: native.threads.map(thread => ({ ...thread, resolved: true })) });
  expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-group="resolved"]')?.open).toBe(false);
});

it('uses native-thread totals for an older grouped publication', () => {
  const native = input([thread('a')]);
  const panel = renderProviderReviewPanel(host(), native, { transformItems: items => items.map(item => ({ ...item, threads: { total: 3, open: 2 } })) });
  expect(panel.element.querySelector('progress')?.max).toBe(3);
  expect(panel.element.querySelector('progress')?.value).toBe(1);
  expect(panel.element.querySelector('[data-geld-review-group="open"] [data-geld-review-toggle]')?.textContent).toContain('3');
});

it('keeps a folded push round folded when another native event joins its boundary', () => {
  const push: ProviderReviewPanelEvent = { id: 'push-1', url: reviewUrl, author: comment('1').author, body: 'Pushed commit', createdAt: '2026-11-01T11:00:00Z', kind: 'push' };
  const native = input([thread('a')]);
  const panel = renderProviderReviewPanel(host(), native, { reviewGrouping: 'batch', events: [push] });
  const round = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-round]')!;round.open = false;
  panel.update(native, { reviewGrouping: 'batch', events: [push, { ...push, id: 'push-2' }] });
  expect(panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-review-round]')?.open).toBe(false);
});

it('suspends old digest clipboard controls until a current snapshot resumes the panel', async () => {
  const write = vi.fn(async () => {});const native = input([thread('a')]);
  const panel = renderProviderReviewPanel(host(), native, { copyText: write });
  panel.suspend();panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
  await Promise.resolve();expect(write).not.toHaveBeenCalled();
  panel.update(native);panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
});

it('gives automated reviewers their own rows and seats their threads in rounds without service branding or duplicates', () => {
  const bot = { id: 'duo', login: 'GitLabDuo', automated: true };
  const first = { ...comment('1', ':wave: Please check'), author: bot };
  const native: ProviderReviewInput = { ...input([thread('a', { comments: [first] })]), reviewers: [
    { author: { id: 'duo', login: 'GitLabDuo' }, state: 'approved' },
    { author: { id: 'human', login: 'reviewer' }, state: 'pending', reviewRequest: 'pending' },
  ] };
  const panel = renderProviderReviewPanel(host(), native, { renderComment: (_comment, host) => { host.innerHTML = '<p>👋 Please check</p>';return true; } });
  const bots = panel.element.querySelector('[data-geld-review-key="bots"]');
  expect(bots?.querySelector('[data-geld-automated-reviewer="duo"] [data-geld-review-toggle]')?.textContent).toContain('Approved');
  expect(bots?.querySelector('[data-geld-item]')).toBeNull();
  const round = panel.element.querySelector('[data-geld-round-group="review"]');
  expect(round?.querySelector('[data-geld-item]')?.textContent).not.toContain(':wave:');
  expect(panel.element.querySelectorAll('[data-geld-source="note_1"]')).toHaveLength(1);
  expect(panel.element.querySelector('[data-geld-review-key="reviewers"]')?.textContent).not.toContain('GitLabDuo');
  expect(panel.element.querySelector('[data-geld-reviewer="human"]')?.textContent).toContain('Review requested');
  expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
});

it('seats human comments in their push round and separates activity types', () => {
  const panel = renderProviderReviewPanel(host(), input(), { comments: [comment('1'), comment('2')], events: [
    { id: 'push', url: `${reviewUrl}#note_3`, author: comment('3').author, body: 'added a commit', createdAt: '2026-11-01T11:00:00Z', kind: 'push' },
    { id: 'assignment', url: `${reviewUrl}#note_4`, author: comment('4').author, body: 'assigned to @alice', createdAt: '2026-11-01T11:01:00Z' },
  ] });
  expect(panel.element.querySelector('[data-geld-round-group="current"] [data-geld-review-key="round:push:comments"]')?.querySelectorAll('[data-geld-comment-row]')).toHaveLength(2);
  expect(panel.element.querySelector('[data-geld-review-key="activity:Commits"] [data-geld-event="push"]')).not.toBeNull();
  expect(panel.element.querySelector('[data-geld-review-key="activity:Assignments"] [data-geld-event="assignment"]')).not.toBeNull();
});

it('refreshes formatted system activity when its native body hydrates without changing API data', () => {
  const event = { id: '9', url: `${reviewUrl}#note_9`, author: comment('9').author, body: '<a>requested review</a>', createdAt: comment('9').createdAt };
  const renderEvent = (_event: ProviderReviewPanelEvent, target: HTMLElement): boolean => {
    const native = document.getElementById('note_9');if (native === null) return false;
    target.textContent = native.textContent;return true;
  };
  const options = { events: [event], renderEvent };
  const panel = renderProviderReviewPanel(host(), input(), options);
  const native = document.createElement('div');native.id = 'note_9';native.textContent = 'requested review from Reviewer';document.body.append(native);
  panel.update(input(), options);
  expect(panel.element.querySelector('[data-geld-event="9"]')?.textContent).toContain('requested review from Reviewer');
  expect(panel.element.querySelector('[data-geld-event="9"]')?.textContent).not.toContain('<a>');
});

it('shows a Deployments row with each environment, its state, site and host page', () => {
  const deployments = [
    { id: '1', name: 'review/mr-7', state: 'active' as const, environmentUrl: 'https://gitlab.com/group/repo/-/environments/1', siteUrl: 'https://review-7.example.dev/', deployedAt: '2026-11-10T17:58:31.506Z' },
    { id: '2', name: 'staging', state: 'waiting' as const, environmentUrl: 'https://gitlab.com/group/repo/-/environments/2' },
  ];
  const panel = renderProviderReviewPanel(host(), input(), { deployments });
  const row = panel.element.querySelector('[data-geld-review-key="deployments"]');
  expect(row?.querySelector('[data-geld-review-toggle]')?.getAttribute('aria-label')).toBe('Deployments · review/mr-7 deployed · staging waiting');
  expect([...row?.querySelectorAll('[data-geld-deployment-state]') ?? []].map(chip => chip.getAttribute('data-geld-deployment-state'))).toEqual(['active', 'waiting']);
  const links = [...row?.querySelectorAll<HTMLAnchorElement>('[data-geld-deployment="1"] a') ?? []].map(link => [link.textContent, link.href]);
  expect(links).toEqual([['Open site', 'https://review-7.example.dev/'], ['Environment', 'https://gitlab.com/group/repo/-/environments/1']]);
  expect(panel.element.querySelector('[data-geld-deployment="2"]')?.textContent).not.toContain('Open site');
  panel.update(input(), {});
  expect(panel.element.querySelector('[data-geld-review-key="deployments"]')).toBeNull();
});


it('groups threads and comments by type into rounds to review, a current round and settled rounds', () => {
  const settledComment = { ...comment('2'), createdAt: '2026-11-01T10:00:00Z' };
  const native = input([thread('a'), thread('b', { resolved: true, comments: [settledComment] })]);
  const events: readonly ProviderReviewPanelEvent[] = [
    { id: 'push-1', url: reviewUrl, author: comment('1').author, body: 'Pushed', createdAt: '2026-11-01T11:00:00Z', kind: 'push' },
    { id: 'push-2', url: reviewUrl, author: comment('1').author, body: 'Pushed', createdAt: '2026-11-01T13:00:00Z', kind: 'push' },
  ];
  const panel = renderProviderReviewPanel(host(), native, { events, comments: [{ ...comment('5', 'Looks better now.'), createdAt: '2026-11-01T13:30:00Z' }] });
  const review = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-round-group="review"]');
  expect(review?.querySelector('[data-geld-review-toggle]')?.textContent).toBe('1 round to review');
  expect(review?.open).toBe(true);
  const rounds = [...(review?.querySelectorAll<HTMLElement>('[data-geld-type-round]') ?? [])];
  expect(rounds.map(round => round.dataset.geldTypeRound)).toEqual(['push-2', 'push-1']);
  expect(rounds[0]?.querySelector('[data-geld-review-toggle]')?.textContent).toBe('Round 3 · 1 comment');
  expect(rounds[1]?.querySelector('[data-geld-review-toggle]')?.textContent).toBe('Round 2 · 0/1 resolved');
  const settled = panel.element.querySelector<HTMLElement & { open: boolean }>('[data-geld-round-group="settled"]');
  expect(settled?.querySelector('[data-geld-review-toggle]')?.textContent).toBe('1 settled round');
  expect(settled?.open).toBe(false);
  expect(settled?.querySelector('[data-geld-type-round="before"] [data-geld-review-toggle]')?.textContent).toBe('Round 1 · 1/1 resolved');
  expect(panel.element.querySelector('[data-geld-review-key="comments"]')).toBeNull();
});

it('heads a latest round with no threads "Current round" when nothing is left to review', () => {
  const native = input([thread('a', { resolved: true })]);
  const events: readonly ProviderReviewPanelEvent[] = [{ id: 'push-1', url: reviewUrl, author: comment('1').author, body: 'Pushed', createdAt: '2026-11-01T13:00:00Z', kind: 'push' }];
  const panel = renderProviderReviewPanel(host(), native, { events });
  const current = panel.element.querySelector('[data-geld-round-group="current"]');
  expect(current?.querySelector('[data-geld-review-toggle]')?.textContent).toBe('Current round');
  expect(current?.textContent).toContain('No conversation since this push.');
  expect(panel.element.querySelector('[data-geld-round-group="settled"] [data-geld-review-toggle]')?.textContent).toBe('1 settled round');
});
