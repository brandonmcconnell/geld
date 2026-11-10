import type { ProviderReviewComment } from '@geld/review';
import type { ProviderCommentRenderContext } from '../providers/comment-render';

const SCROLL = ['gl-w-fit', 'gl-max-w-full', 'gl-overflow-x-auto', 'gl-overflow-y-auto', 'print:gl-max-h-none'];
const CAP = 'gl-max-h-[70vh]';
const EXPAND = 'M11.78 11.16a.75.75 0 00-1.06 0l-1.97 1.97V2.87l1.97 1.97a.75.75 0 101.06-1.06L8.53.53 8 0l-.53.53-3.25 3.25a.75.75 0 001.06 1.06l1.97-1.97v10.26l-1.97-1.97a.75.75 0 00-1.06 1.06l3.25 3.25L8 16l.53-.53 3.25-3.25a.75.75 0 000-1.06z';
const COLLAPSE = 'M11.78 3.16a.75.75 0 00-1.06 0L8.75 5.13V.75a.75.75 0 00-1.5 0v4.38L5.28 3.16a.75.75 0 00-1.06 1.06l3.25 3.25L8 8l-.53.53-3.25 3.25a.75.75 0 001.06 1.061l1.97-1.97v4.379a.75.75 0 001.5 0v-4.379l1.97 1.97a.75.75 0 101.06-1.06L8.53 8.53 8 8l.53-.53 3.25-3.25a.75.75 0 000-1.061z';
const WRAPPERS = ['gl-order-1 gl-mt-2 gl-flex gl-justify-center print:gl-hidden', 'gl-mt-2 gl-flex gl-justify-center print:gl-hidden'];
const objects = new WeakMap<Element, number>();
let nextObject = 0;

interface NativeTable { readonly scroll: HTMLElement; readonly table: HTMLTableElement; readonly shadow: HTMLElement; readonly expanded: boolean }
export interface OwnedHeightTable { readonly native: HTMLElement; readonly owned: HTMLElement }

function scrollTable(scroll: Element, source: HTMLElement): NativeTable | null {
  const id = scroll.id;
  const shadow = scroll.parentElement;
  const table = scroll.firstElementChild;
  const expanded = !scroll.classList.contains(CAP);
  if (!(scroll instanceof HTMLElement) || !/^markdown-table-[1-9]\d*-scroll$/.test(id)
    || source.ownerDocument.querySelectorAll(`[id="${id}"]`).length !== 1 || !source.contains(scroll)
    || scroll.getAttribute('class') !== [...(expanded ? [] : [CAP]), ...SCROLL].join(' ')
    || scroll.getAttribute('data-sticky-header') !== '' || scroll.getAttribute('data-print-scale-container') !== ''
    || [...scroll.attributes].some((attribute) => !['id', 'class', 'data-sticky-header', 'data-print-scale-container'].includes(attribute.name))
    || scroll.children.length !== 1 || !(table instanceof HTMLTableElement) || table.getAttribute('data-markdown-table-applied') !== 'true'
    || table.closest('.note-text') !== source || table.querySelector('table') !== null
    || !(shadow instanceof HTMLElement) || shadow.className !== 'gl-table-shadow-overlay'
    || shadow.getAttribute('data-testid') !== 'table-shadow-overlay' || shadow.children.length !== 1) return null;
  return { scroll, table, shadow, expanded };
}

export function nativeTableHeightWrapper(wrapper: Element, source: HTMLElement): boolean {
  if (wrapper.localName !== 'div' || wrapper.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    || wrapper.attributes.length !== 1 || !WRAPPERS.includes(wrapper.getAttribute('class') ?? '')) return false;
  const contents = [...wrapper.childNodes].filter((child) => child.nodeType !== Node.TEXT_NODE || child.textContent?.trim());
  const button = contents[0];
  if (contents.length !== 1 || !(button instanceof Element) || button.localName !== 'button'
    || button.namespaceURI !== 'http://www.w3.org/1999/xhtml' || button.getAttribute('type') !== 'button'
    || button.className !== 'btn gl-button btn-default btn-sm btn-default-tertiary'
    || button.getAttribute('data-testid') !== 'markdown-table-height-toggle'
    || [...button.attributes].some((attribute) => !['type', 'class', 'data-testid', 'aria-expanded', 'aria-controls'].includes(attribute.name))) return false;
  const controls = button.getAttribute('aria-controls');
  if (controls === null || !/^markdown-table-[1-9]\d*-scroll$/.test(controls)
    || source.querySelectorAll(`button[aria-controls="${controls}"]`).length !== 1) return false;
  const target = source.querySelector(`[id="${controls}"]`);
  const native = target === null ? null : scrollTable(target, source);
  if (native === null || native.shadow.parentElement !== wrapper.parentElement || wrapper.previousElementSibling !== native.shadow
    || button.getAttribute('aria-expanded') !== String(native.expanded)) return false;
  const icon = button.children[0];
  const label = button.children[1];
  const decoration = icon === undefined ? [] : [icon, ...icon.querySelectorAll('*')];
  if (button.children.length !== 2 || icon?.localName !== 'svg' || icon.namespaceURI !== 'http://www.w3.org/2000/svg'
    || icon.getAttribute('aria-hidden') !== 'true' || icon.textContent?.trim()
    || decoration.some((node) => node.namespaceURI !== 'http://www.w3.org/2000/svg' || !['svg', 'g', 'path', 'use'].includes(node.localName)
      || [...node.attributes].some((attribute) => attribute.name.startsWith('on') || ['tabindex', 'contenteditable'].includes(attribute.name)))
    || label?.localName !== 'span' || label.className !== 'gl-button-text' || label.attributes.length !== 1
    || label.textContent?.trim() !== (native.expanded ? 'Collapse table' : 'Show full table')
    || [...label.childNodes].some((child) => child.nodeType !== Node.TEXT_NODE && child.nodeType !== Node.COMMENT_NODE)) return false;
  return [...button.childNodes].every((child) => child === icon || child === label || child.nodeType === Node.COMMENT_NODE
    || child.nodeType === Node.TEXT_NODE && !child.textContent?.trim());
}

function eligible(scroll: HTMLElement, source: HTMLElement): NativeTable | null {
  const native = scrollTable(scroll, source);
  if (native === null) return null;
  const controls = [...source.querySelectorAll('button[aria-controls]')].filter((button) => button.getAttribute('aria-controls') === scroll.id);
  if (controls.length > 1 || controls.some((button) => button.parentElement === null || !nativeTableHeightWrapper(button.parentElement, source))) return null;
  const next = native.shadow.nextElementSibling;
  if (next !== null && (next.matches('[class~="gl-justify-center"]') || next.querySelector('[data-testid="markdown-table-height-toggle"]') !== null)
    && !nativeTableHeightWrapper(next, source)) return null;
  return native;
}

function presented(element: HTMLElement): boolean {
  if (!element.isConnected || element.getBoundingClientRect().width <= 0 || element.getBoundingClientRect().height <= 0) return false;
  for (let parent: HTMLElement | null = element; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (parent.hidden || parent.inert || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none'
      || style.visibility === 'hidden' || style.contentVisibility === 'hidden' || parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}

function clipped(scroll: HTMLElement, table: HTMLTableElement, height: number): boolean {
  const style = getComputedStyle(scroll);
  const cap = style.maxHeight.endsWith('vh') ? Number.parseFloat(style.maxHeight) * height / 100 : Number.parseFloat(style.maxHeight);
  return presented(scroll) && presented(table) && height > 0 && table.offsetHeight > height * 70 / 100
    && scroll.clientHeight > 0 && scroll.scrollHeight - scroll.clientHeight > 1
    && ['auto', 'scroll'].includes(style.overflowY) && Number.isFinite(cap) && Math.abs(cap - height * 70 / 100) <= 1;
}

export function mountGitLabTableHeights(source: HTMLElement, comment: ProviderReviewComment, host: HTMLElement, targets: readonly OwnedHeightTable[], context: ProviderCommentRenderContext): void {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (win === null) return;
  const route = doc.URL.split('#')[0];
  const prepared = targets.flatMap((target, index) => {
    const native = eligible(target.native, source);
    const table = target.owned.firstElementChild;
    if (native === null || native.expanded || !(table instanceof HTMLTableElement)) return [];
    let object = objects.get(native.table);
    if (object === undefined) { object = ++nextObject;objects.set(native.table, object); }
    const key = JSON.stringify([comment, object, native.scroll.id, native.table.outerHTML]);
    return [{ target, native, table, key, index, markup: native.table.outerHTML }];
  });
  const keys = new Set(prepared.map((value) => value.key));
  for (const key of context.state.keys()) if (!keys.has(key)) context.state.delete(key);
  for (const entry of prepared) {
    let disposed = false;
    let frame: number | null = null;
    let demonstrated = false;
    let restoreExpanded = context.state.get(entry.key) === true;
    let expanded = false;
    const originalClass = entry.target.owned.className;
    const originalId = entry.target.owned.getAttribute('id');
    const targetId = `${context.idNamespace}-table-${entry.index}`;
    const controls = doc.createElement('div');controls.className = 'gl-mt-2 gl-flex gl-justify-center print:gl-hidden';controls.dataset.geldTableHeight = '';
    const button = doc.createElement('button');button.type = 'button';button.className = 'btn gl-button btn-default btn-sm btn-default-tertiary';
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');icon.setAttribute('viewBox', '0 0 16 16');icon.setAttribute('width', '16');icon.setAttribute('height', '16');icon.setAttribute('aria-hidden', 'true');icon.setAttribute('focusable', 'false');icon.setAttribute('class', 'gl-button-icon gl-icon s16 gl-fill-current');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');path.setAttribute('fill-rule', 'evenodd');path.setAttribute('clip-rule', 'evenodd');icon.append(path);
    const label = doc.createElement('span');label.className = 'gl-button-text';button.append(icon, label);
    button.id = `${targetId}-toggle`;button.dataset.geldCommentControl = '';button.setAttribute('aria-controls', targetId);controls.append(button);
    const current = (): boolean => !disposed && context.current() && doc.URL.split('#')[0] === route && source.isConnected && source.contains(entry.native.scroll)
      && eligible(entry.native.scroll, source)?.table === entry.native.table && entry.native.table.outerHTML === entry.markup
      && entry.target.owned.isConnected && host.contains(entry.target.owned) && entry.table.parentElement === entry.target.owned
      && (entry.target.owned.id === '' || entry.target.owned.id === targetId);
    const paint = (): void => {
      entry.target.owned.className = expanded ? originalClass.split(' ').filter((name) => name !== CAP).join(' ') : originalClass;
      label.textContent = expanded ? 'Collapse table' : 'Show full table';path.setAttribute('d', expanded ? COLLAPSE : EXPAND);button.setAttribute('aria-expanded', String(expanded));
    };
    const retire = (): void => {
      if (disposed) return;
      disposed = true;if (frame !== null) win.cancelAnimationFrame(frame);frame = null;
      observer?.disconnect();win.removeEventListener('resize', schedule);button.removeEventListener('click', activate);controls.remove();
      entry.target.owned.className = originalClass;
      if (originalId === null) entry.target.owned.removeAttribute('id');else entry.target.owned.id = originalId;
    };
    const measure = (): void => {
      frame = null;
      if (!current()) { retire();return; }
      const nativeClipped = clipped(entry.native.scroll, entry.native.table, win.innerHeight);
      const ownedClipped = expanded ? demonstrated && presented(entry.target.owned) && entry.table.offsetHeight > win.innerHeight * 70 / 100 : clipped(entry.target.owned, entry.table, win.innerHeight);
      if (!nativeClipped || !ownedClipped) {
        if (!demonstrated && presented(entry.native.scroll) && presented(entry.target.owned)) { restoreExpanded = false;context.state.delete(entry.key); }
        if (doc.activeElement !== button) {
          controls.remove();
          if (originalId === null) entry.target.owned.removeAttribute('id');else entry.target.owned.id = originalId;
        }
        return;
      }
      demonstrated = true;
      if (restoreExpanded) { expanded = true;restoreExpanded = false; }
      if (doc.querySelectorAll(`[id="${targetId}"]`).length > (entry.target.owned.id === targetId ? 1 : 0)
        || doc.querySelectorAll(`[id="${button.id}"]`).length > (button.isConnected ? 1 : 0)) { retire();return; }
      entry.target.owned.id = targetId;
      if (!controls.isConnected) entry.target.owned.parentElement?.after(controls);
      paint();
    };
    function schedule(): void { if (!disposed && frame === null) frame = win!.requestAnimationFrame(measure); }
    function activate(): void {
      if (!current() || !demonstrated || !clipped(entry.native.scroll, entry.native.table, win!.innerHeight)
        || (!expanded && !clipped(entry.target.owned, entry.table, win!.innerHeight))) { schedule();return; }
      expanded = !expanded;context.state.set(entry.key, expanded);paint();button.focus({ preventScroll: true });
      if (!expanded) button.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
      if (expanded) demonstrated = true;
    }
    const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null;
    context.onDispose(retire);
    context.onMount(() => {
      if (!current()) { retire();return; }
      observer?.observe(entry.table);observer?.observe(entry.native.table);win.addEventListener('resize', schedule);button.addEventListener('click', activate);schedule();
    });
  }
}
