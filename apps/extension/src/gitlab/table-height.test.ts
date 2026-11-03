// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderReviewComment } from '@geld/review';
import type { ProviderCommentRenderContext } from '../providers/comment-render';
import { renderGitLabComment } from './comment-render';

const comment: ProviderReviewComment = { id: '11', anchor: 'note_11', url: 'https://gitlab.com/group/repo/-/merge_requests/7#note_11', author: { id: '23', login: 'author' }, body: 'Actual source', createdAt: '2026-11-01T12:00:00Z' };
const classes = 'gl-max-h-[70vh] gl-w-fit gl-max-w-full gl-overflow-x-auto gl-overflow-y-auto print:gl-max-h-none';
function markup(expanded = false): string { return `<div class="gl-table-shadow-overlay" data-testid="table-shadow-overlay"><div id="markdown-table-176-scroll" class="${expanded ? classes.replace('gl-max-h-[70vh] ', '') : classes}" data-sticky-header data-print-scale-container><table data-markdown-table-applied="true"><tbody><tr><td>First row</td></tr><tr><td>Last <code>value</code></td></tr></tbody></table></div></div>`; }
let frames = new Map<number, FrameRequestCallback>();let nextFrame = 0;
let resize: (() => void) | undefined;let disconnected = 0;
beforeEach(() => {
  frames = new Map();nextFrame = 0;disconnected = 0;window.location.href = comment.url;Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
  document.head.innerHTML = '<style>.gl-overflow-y-auto{overflow-y:auto}.gl-max-h-\\[70vh\\]{max-height:490px}</style>';
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++nextFrame, callback);return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe(): void {} disconnect(): void { disconnected += 1; } });
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();document.head.replaceChildren(); });
function flush(): void { for (const [id, callback] of [...frames]) { frames.delete(id);callback(0); } }
function fixture(expanded = false) {
  document.body.innerHTML = `<li id="note_11" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a class="author-name-link" data-user-id="23" data-username="author">Author</a></div></div><div class="note-body"><div class="note-text md">${markup(expanded)}</div></div></div></div></li><div id="owned"></div>`;
  const source = document.querySelector<HTMLElement>('.note-text');const host = document.getElementById('owned');if (source === null || host === null) throw new Error('Missing source fixture');
  const mounts: Array<() => void> = [];const disposes: Array<() => void> = [];let active = true;
  const context: ProviderCommentRenderContext = { idNamespace: 'geld-test-source', state: new Map(), current: () => active && host.isConnected, onMount: (callback) => mounts.push(callback), onDispose: (callback) => disposes.push(callback) };
  expect(renderGitLabComment(comment, host, document, undefined, context)).toBe(true);
  const native = source.querySelector<HTMLElement>('[data-sticky-header]');const owned = host.querySelector<HTMLElement>('[class~="gl-overflow-y-auto"]');if (native === null || owned === null) throw new Error('Missing scroll target');
  const geometry = (element: HTMLElement, overflow = true, height = 800): void => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 490));Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => !source.contains(element) && !element.classList.contains('gl-max-h-[70vh]') ? height : 490 });Object.defineProperty(element, 'scrollHeight', { configurable: true, value: overflow ? height : 490 });
    const table = element.querySelector('table');if (table === null) throw new Error('Missing table');vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, height));Object.defineProperty(table, 'offsetHeight', { configurable: true, value: height });
  };
  return { source, host, native, owned, context, mounts, disposes, geometry, mount: () => { for (const callback of mounts) callback();flush(); }, dispose: () => { active = false;for (const callback of disposes) callback(); }, sourceMarkup: source.outerHTML };
}
it('offers expansion only after both actual scroll containers overflow and restores exact owned HTML without native writes', () => {
  const f = fixture();f.geometry(f.native);f.geometry(f.owned);expect(f.mounts.length).toBe(1);expect(getComputedStyle(f.native).maxHeight).toBe('490px');expect(getComputedStyle(f.native).overflowY).toBe('auto');const storage = vi.spyOn(Storage.prototype, 'setItem');const event = vi.spyOn(window, 'dispatchEvent');f.mount();const button = f.host.querySelector('button');expect(button?.textContent).toBe('Show full table');const before = f.host.innerHTML;
  expect(button?.getAttribute('aria-controls')).toBe(f.owned.id);expect(document.querySelectorAll(`[id="${f.owned.id}"]`)).toHaveLength(1);button?.click();expect(button?.getAttribute('aria-expanded')).toBe('true');expect(f.owned.classList.contains('gl-max-h-[70vh]')).toBe(false);expect(document.activeElement).toBe(button);expect(f.host.textContent).toContain('Last value');button?.click();expect(f.host.innerHTML).toBe(before);expect(f.source.outerHTML).toBe(f.sourceMarkup);expect(storage).not.toHaveBeenCalled();expect(event).not.toHaveBeenCalled();f.dispose();expect(disconnected).toBe(1);expect(frames.size).toBe(0);expect(f.host.querySelector('button,[id]')).toBeNull();
});
it.each(['native', 'owned', 'both'])('does not offer a control for absent actual %s overflow despite correct classes', (which) => { const f = fixture();f.geometry(f.native, which === 'owned');f.geometry(f.owned, which === 'native');f.mount();expect(f.host.querySelector('button')).toBeNull();f.dispose(); });
it('requires the strict70vh threshold and presentation, then responds to actual size observation', () => {
  const f = fixture();f.geometry(f.native, true, 490);f.geometry(f.owned, true, 490);f.mount();expect(f.host.querySelector('button')).toBeNull();f.dispose();const next = fixture();next.geometry(next.native);next.geometry(next.owned);next.host.hidden = true;next.mount();expect(next.host.querySelector('button')).toBeNull();next.host.hidden = false;resize?.();flush();expect(next.host.querySelector('button')).not.toBeNull();next.dispose();
});
it('leaves already-expanded native startup uncapped without inventing a local control', () => { const f = fixture(true);f.geometry(f.native);f.geometry(f.owned);f.mount();expect(f.host.querySelector('button')).toBeNull();expect(f.owned.className).not.toContain('70vh');expect(f.source.outerHTML).toBe(f.sourceMarkup);f.dispose(); });
it('retires pending work when native table identity changes or its owner is disposed', () => {
  const f = fixture();f.geometry(f.native);f.geometry(f.owned);f.mount();const button = f.host.querySelector('button');expect(button).not.toBeNull();f.native.replaceWith(f.native.cloneNode(true));button?.click();flush();expect(f.host.querySelector('button')).toBeNull();f.dispose();const next = fixture();next.geometry(next.native);next.geometry(next.owned);for (const callback of next.mounts) callback();next.dispose();flush();expect(next.host.querySelector('button')).toBeNull();expect(frames.size).toBe(0);
});
it('refuses duplicate native target IDs without modifying source content', () => { const f = fixture();f.native.after(f.native.cloneNode(true));f.geometry(f.native);f.geometry(f.owned);f.mount();expect(f.host.querySelector('button')).toBeNull();f.dispose(); });

it('retains an explicitly expanded local choice only across the same native table/source render', () => {
  const f = fixture();f.geometry(f.native);f.geometry(f.owned);f.mount();f.host.querySelector('button')?.click();expect(f.context.state.size).toBe(1);
  for (const callback of f.disposes.splice(0)) callback();f.mounts.splice(0);
  expect(renderGitLabComment(comment, f.host, document, undefined, f.context)).toBe(true);
  const owned = f.host.querySelector<HTMLElement>('[class~="gl-overflow-y-auto"]');if (owned === null) throw new Error('Missing copied scroll target');f.geometry(owned);f.mount();expect(f.host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');expect(owned.className).not.toContain('70vh');f.dispose();
});
it('never grants controls to API HTML imitating the complete native table structure', () => {
  const f = fixture();document.getElementById('note_11')?.remove();f.mounts.splice(0);f.disposes.splice(0);
  const evidence = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '7', headSha: 'a'.repeat(40) }, projectId: '1', noteableId: '2', comment, html: markup() } as const;
  expect(renderGitLabComment(comment, f.host, document, evidence, f.context)).toBe(true);expect(f.mounts).toHaveLength(0);expect(f.disposes).toHaveLength(0);expect(f.host.querySelector('button,[id],[data-sticky-header],[data-geld-table-height]')).toBeNull();f.dispose();
});
it('refuses an owned ID collision rather than binding a control to a foreign element', () => {
  const f = fixture();f.geometry(f.native);f.geometry(f.owned);const foreign = document.createElement('span');foreign.id = 'geld-test-source-table-0-toggle';document.body.append(foreign);f.mount();expect(f.host.querySelector('button')).toBeNull();f.dispose();
});
