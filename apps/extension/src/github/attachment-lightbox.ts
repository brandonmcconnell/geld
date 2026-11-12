import { collectAttachmentMedia, MEDIA_ATTRIBUTE, mediaSurface, readAttachmentMedia } from './attachment-media';
import type { AttachmentMedia } from './attachment-media';
import { createElement, isOwnElement, OWN_UI_ATTRIBUTE } from './dom';

interface Enhancement {
  readonly restore: () => void;
  readonly button: HTMLButtonElement | null;
}

const enhancements = new Map<HTMLElement, Enhancement>();
let enabled = false;
let activePath: string | null = null;
let disposeViewer: (() => void) | null = null;
let request = 0;
let observer: MutationObserver | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function observeMedia(): void {
  if (observer) return;
  observer = new MutationObserver((records) => {
    const changed = records.some((record) => !isOwnElement(record.target) && (record.type === 'attributes'
      || [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element && !isOwnElement(node)
        && (node.matches('img, video, a[href]') || node.querySelector('img, video, a[href]')))));
    if (!changed || refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (enabled) applyAttachmentLightbox();
    }, 50);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'href', 'poster', 'hidden'] });
}

function dismiss(): void {
  request++;
  disposeViewer?.();
  disposeViewer = null;
}

async function show(item: AttachmentMedia): Promise<void> {
  dismiss();
  const current = request;
  const group = mediaSurface(item.element);
  const items = group ? collectAttachmentMedia(group) : [item];
  const index = items.findIndex((candidate) => candidate.element === item.element);
  if (index < 0) return;
  const { mountAttachmentViewer } = await import('./attachment-viewer');
  if (!enabled || request !== current || !item.element.isConnected) return;
  disposeViewer = mountAttachmentViewer(items, index, () => {
    disposeViewer = null;
  });
}

function clickedMedia(target: Element): AttachmentMedia | null {
  const button = target.closest('[data-geld-lightbox-open]');
  if (button) {
    for (const [element, enhancement] of enhancements) if (enhancement.button === button) return readAttachmentMedia(element);
    return null;
  }
  const element = target.closest(`img, [${MEDIA_ATTRIBUTE}]`) ?? target.closest('a')?.querySelector('img');
  if (!(element instanceof HTMLElement) || element instanceof HTMLVideoElement) return null;
  return readAttachmentMedia(element);
}

function onClick(event: MouseEvent): void {
  if (!enabled || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
  const item = clickedMedia(event.target);
  if (!item) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void show(item);
}

function onKey(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || (event.key !== 'Enter' && event.key !== ' ')) return;
  if (!(event.target instanceof HTMLElement) || event.target.closest('a, button, video')) return;
  const item = clickedMedia(event.target);
  if (!item) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void show(item);
}

function enhance(item: AttachmentMedia): Enhancement {
  const element = item.element;
  const attributes = ['tabindex', 'role', 'aria-haspopup', MEDIA_ATTRIBUTE, 'data-geld-lightbox-image'];
  const previous = attributes.map((name) => [name, element.getAttribute(name)] satisfies [string, string | null]);
  element.setAttribute(MEDIA_ATTRIBUTE, item.kind);
  let button: HTMLButtonElement | null = null;
  if (element instanceof HTMLVideoElement) {
    button = createElement('button', {
      type: 'button', class: 'geld-media-open', [OWN_UI_ATTRIBUTE]: '', 'data-geld-lightbox-open': '',
      'aria-label': 'Open video in lightbox', 'aria-haspopup': 'dialog',
    }, ['Expand video']);
    element.after(button);
  } else {
    if (item.image) element.setAttribute('data-geld-lightbox-image', '');
    if (!element.closest('a, button')) {
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
    }
    element.setAttribute('aria-haspopup', 'dialog');
  }
  return {
    button,
    restore: () => {
      button?.remove();
      for (const [name, value] of previous) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
    },
  };
}

export function applyAttachmentLightbox(setting = true): void {
  if (!setting) {
    removeAttachmentLightbox();
    return;
  }
  if (activePath !== window.location.pathname) dismiss();
  enabled = true;
  activePath = window.location.pathname;
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  observeMedia();
  const items = collectAttachmentMedia(document);
  const current = new Set(items.map((item) => item.element));
  for (const [element, enhancement] of enhancements) {
    if (!current.has(element) || (enhancement.button && !enhancement.button.isConnected)) {
      enhancement.restore();
      enhancements.delete(element);
    }
  }
  for (const item of items) if (!enhancements.has(item.element)) enhancements.set(item.element, enhance(item));
}

export function removeAttachmentLightbox(): void {
  enabled = false;
  observer?.disconnect();
  observer = null;
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKey, true);
  dismiss();
  activePath = null;
  for (const enhancement of enhancements.values()) enhancement.restore();
  enhancements.clear();
}
