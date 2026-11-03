// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderReviewComment } from '@geld/review';
import type { ProviderCommentRenderContext } from '../providers/comment-render';
import { renderGitLabComment } from './comment-render';

const comment: ProviderReviewComment = { id: '11', anchor: 'note_11', url: 'https://gitlab.com/group/repo/-/merge_requests/7#note_11', author: { id: '23', login: 'author' }, body: 'Actual source', createdAt: '2026-11-01T12:00:00Z' };
const classes = 'gl-max-h-[70vh] gl-w-fit gl-max-w-full gl-overflow-x-auto gl-overflow-y-auto print:gl-max-h-none';
function markup(expanded = false): string { return `<div class="gl-table-shadow-overlay" data-testid="table-shadow-overlay"><div id="markdown-table-176-scroll" class="${expanded ? classes.replace('gl-max-h-[70vh] ', '') : classes}" data-sticky-header data-print-scale-container><table data-markdown-table-applied="true"><tbody><tr><td>First row</td></tr><tr><td>Last <code>value</code></td></tr></tbody></table></div></div>`; }
function controlMarkup(): string { return '<div class="gl-order-1 gl-mt-2 gl-flex gl-justify-center print:gl-hidden"><button type="button" class="btn gl-button btn-default btn-sm btn-default-tertiary" data-testid="markdown-table-height-toggle" aria-expanded="false" aria-controls="markdown-table-176-scroll"><svg aria-hidden="true"><path d="M0 0"></path></svg><span class="gl-button-text">Show full table</span></button></div>'; }
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
function fixture(expanded = false, content = markup(expanded)) {
  document.body.innerHTML = `<li id="note_11" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a class="author-name-link" data-user-id="23" data-username="author">Author</a></div></div><div class="note-body"><div class="note-text md">${content}</div></div></div></div></li><div id="owned"></div>`;
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
  const evidence = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '7', headSha: 'a'.repeat(40) }, projectId: '1', noteableId: '2', comment, html: markup() + controlMarkup() } as const;
  expect(renderGitLabComment(comment, f.host, document, evidence, f.context)).toBe(true);expect(f.mounts).toHaveLength(0);expect(f.disposes).toHaveLength(0);expect(f.host.querySelector('button,[id],[data-sticky-header],[data-geld-table-height]')).toBeNull();f.dispose();
});
it('refuses an owned ID collision rather than binding a control to a foreign element', () => {
  const f = fixture();f.geometry(f.native);f.geometry(f.owned);const foreign = document.createElement('span');foreign.id = 'geld-test-source-table-0-toggle';document.body.append(foreign);f.mount();expect(f.host.querySelector('button')).toBeNull();f.dispose();
});
it.each(['until-found', 'closed details'])('uses exact generated native intent for a %s source while proving actual owned overflow independently', (hidden) => {
  const f = fixture(false, hidden === 'closed details' ? `<details><summary>Walkthrough</summary>${markup()}${controlMarkup()}</details>` : markup() + controlMarkup());
  const note = document.getElementById('note_11');if (note === null) throw new Error('Missing native source');
  if (hidden === 'until-found') note.setAttribute('hidden', 'until-found');else { const details = f.host.querySelector('details');if (details === null) throw new Error('Missing owned details');details.open = true; }
  f.geometry(f.native, false, 0);f.geometry(f.owned);const native = note.outerHTML;const preference = localStorage.getItem('markdown_table_expanded');f.mount();
  const control = f.host.querySelector<HTMLElement>('[data-geld-table-height]');const button = control?.querySelector('button');expect(control?.dataset.geldTableHeightAuthority).toBe('hidden-native-generated-control');expect(button?.textContent).toBe('Show full table');const owned = f.host.innerHTML;
  button?.click();expect(button?.getAttribute('aria-expanded')).toBe('true');expect(f.owned.classList.contains('gl-max-h-[70vh]')).toBe(false);button?.click();expect(f.host.innerHTML).toBe(owned);expect(note.outerHTML).toBe(native);expect(localStorage.getItem('markdown_table_expanded')).toBe(preference);f.dispose();
});
it.each(['missing', 'wrong target', 'wrong label', 'duplicate', 'replacement'])('rejects hidden native %s controls without treating unavailable geometry as paint evidence', (fault) => {
  const control = fault === 'missing' ? '' : fault === 'wrong target' ? controlMarkup().replace('aria-controls="markdown-table-176-scroll"', 'aria-controls="markdown-table-999-scroll"') : fault === 'wrong label' ? controlMarkup().replace('Show full table', 'Authored command') : fault === 'duplicate' ? controlMarkup() + controlMarkup() : controlMarkup();
  const f = fixture(false, markup() + control);document.getElementById('note_11')?.setAttribute('hidden', 'until-found');f.geometry(f.native, false, 0);f.geometry(f.owned);f.mount();
  if (fault === 'replacement') { const native = f.source.querySelector('button');native?.replaceWith(native.cloneNode(true));resize?.();flush(); }
  expect(f.host.querySelector('[data-geld-table-height]')).toBeNull();expect(f.owned.classList.contains('gl-max-h-[70vh]')).toBe(true);f.dispose();
});
it('does not substitute a valid native control for a presented source whose measured native table does not overflow', () => {
  const f = fixture(false, markup() + controlMarkup());f.geometry(f.native, false);f.geometry(f.owned);f.mount();expect(f.host.querySelector('[data-geld-table-height]')).toBeNull();f.dispose();
});
it('restores the original cap and clears the local choice when geometry authority disappears while expanded', () => {
  const f = fixture();f.geometry(f.native);f.geometry(f.owned);f.mount();const original = f.owned.className;const button = f.host.querySelector('button');button?.click();button?.blur();expect(f.owned.className).not.toBe(original);
  Object.defineProperty(f.native, 'scrollHeight', { configurable: true, value: 490 });resize?.();flush();expect(f.owned.className).toBe(original);expect(f.host.querySelector('[data-geld-table-height]')).toBeNull();expect(f.context.state.size).toBe(0);f.dispose();
});
it('restores the original cap when exact hidden native control authority is removed during expansion', () => {
  const f = fixture(false, markup() + controlMarkup());document.getElementById('note_11')?.setAttribute('hidden', 'until-found');f.geometry(f.native, false, 0);f.geometry(f.owned);f.mount();const original = f.owned.className;f.host.querySelector('button')?.click();expect(f.owned.className).not.toBe(original);f.source.querySelector('button')?.remove();const changedNative = f.source.outerHTML;
  resize?.();flush();expect(f.owned.className).toBe(original);expect(f.host.querySelector('[data-geld-table-height]')).toBeNull();expect(f.context.state.size).toBe(0);expect(f.source.outerHTML).toBe(changedNative);f.dispose();
});
it('temporarily restores the cap when owned content hides, then reproves overflow before restoring its unchanged local choice', () => {
  const f = fixture(false, markup() + controlMarkup());document.getElementById('note_11')?.setAttribute('hidden', 'until-found');f.geometry(f.native, false, 0);f.geometry(f.owned);f.mount();f.host.querySelector('button')?.click();f.host.hidden = true;resize?.();flush();expect(f.owned.classList.contains('gl-max-h-[70vh]')).toBe(true);expect(f.host.querySelector('button')).toBeNull();expect([...f.context.state.values()]).toEqual([true]);
  f.host.hidden = false;resize?.();flush();expect(f.host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');expect(f.owned.classList.contains('gl-max-h-[70vh]')).toBe(false);f.dispose();
});
it('preserves actual-geometry owned bytes when the native placeholder hydrates into its exact control', () => {
  const f = fixture();f.geometry(f.native);f.geometry(f.owned);f.mount();expect(f.host.querySelector<HTMLElement>('[data-geld-table-height]')?.dataset.geldTableHeightAuthority).toBe('actual-native-geometry');const original = f.host.innerHTML;
  f.source.insertAdjacentHTML('beforeend', controlMarkup());const hydrated = f.source.outerHTML;resize?.();flush();expect(f.host.innerHTML).toBe(original);expect(f.source.outerHTML).toBe(hydrated);f.dispose();
});
it('revalidates the native note author and source root before hidden-intent actions rather than trusting a retained body alone', () => {
  const f = fixture(false, markup() + controlMarkup());document.getElementById('note_11')?.setAttribute('hidden', 'until-found');f.geometry(f.native, false, 0);f.geometry(f.owned);f.mount();const button = f.host.querySelector('button');button?.click();expect(button?.getAttribute('aria-expanded')).toBe('true');
  document.querySelector<HTMLElement>('.author-name-link')?.setAttribute('data-user-id', '24');const changedNative = f.source.closest('li')?.outerHTML;button?.click();flush();expect(f.owned.classList.contains('gl-max-h-[70vh]')).toBe(true);expect(f.host.querySelector('button')).toBeNull();expect(f.source.closest('li')?.outerHTML).toBe(changedNative);f.dispose();
});
it('measures an opened owned disclosure without relying on a resize notification, and removes its listener on disposal', () => {
  const f = fixture(false, `<details><summary>Walkthrough</summary>${markup()}${controlMarkup()}</details>`);f.geometry(f.native, false, 0);f.geometry(f.owned);f.mount();expect(f.host.querySelector('button')).toBeNull();const details = f.host.querySelector('details');if (details === null) throw new Error('Missing owned details');
  details.open = true;details.dispatchEvent(new Event('toggle'));expect(frames.size).toBe(1);flush();expect(f.host.querySelector('button')).not.toBeNull();f.dispose();details.open = false;details.dispatchEvent(new Event('toggle'));expect(frames.size).toBe(0);
});
it('owns presentation listeners for an enclosing digest disclosure and native beforematch without writing native state', () => {
  const f = fixture(false, markup() + controlMarkup());const note = document.getElementById('note_11');if (note === null) throw new Error('Missing native root');note.setAttribute('hidden', 'until-found');const section = document.createElement('details');section.innerHTML = '<summary>Comments</summary>';f.host.before(section);section.append(f.host);f.geometry(f.native, false, 0);f.geometry(f.owned);f.mount();expect(f.host.querySelector('button')).toBeNull();
  section.open = true;section.dispatchEvent(new Event('toggle'));flush();expect(f.host.querySelector('button')).not.toBeNull();const source = note.outerHTML;note.dispatchEvent(new Event('beforematch'));expect(frames.size).toBe(1);flush();expect(note.outerHTML).toBe(source);f.dispose();note.dispatchEvent(new Event('beforematch'));section.dispatchEvent(new Event('toggle'));expect(frames.size).toBe(0);
});

it.each(['opacity', 'visibility'])('treats invisible %s as hidden intent rather than measured native paint', (property) => {
  const f = fixture(false, markup() + controlMarkup());if (property === 'opacity') f.source.style.opacity = '0';else f.source.style.visibility = 'collapse';f.geometry(f.native);f.geometry(f.owned);f.mount();expect(f.host.querySelector<HTMLElement>('[data-geld-table-height]')?.dataset.geldTableHeightAuthority).toBe('hidden-native-generated-control');f.dispose();
  const unknown = fixture();if (property === 'opacity') unknown.source.style.opacity = '0';else unknown.source.style.visibility = 'collapse';unknown.geometry(unknown.native);unknown.geometry(unknown.owned);unknown.mount();expect(unknown.host.querySelector('button')).toBeNull();unknown.dispose();
});
