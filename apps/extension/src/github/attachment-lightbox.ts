import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { createAttachmentViewer } from './attachment-viewer';
import { brandMark } from './review/brand';
import { ICON_LINK_EXTERNAL, ICON_X } from './ui/icons';

const IMAGE_ATTRIBUTE = 'data-geld-lightbox-image';
let activePath: string | null = null;
let openDialog: HTMLDialogElement | null = null;

function isConversation(): boolean {
  return /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/|$)/.test(window.location.pathname);
}

function attachmentLink(image: HTMLImageElement): HTMLAnchorElement | null {
  if (image.closest('.markdown-body') === null) return null;
  const link = image.closest('a');
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname === 'user-images.githubusercontent.com' || url.hostname === 'private-user-images.githubusercontent.com') return link;
  if (url.origin !== window.location.origin) return null;
  return /^\/(?:user-attachments\/(?:assets|files)\/|[^/]+\/[^/]+\/(?:assets|files)\/)/.test(url.pathname)
    || /^\/[^/]+\/[^/]+\/blob\/.+\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname) ? link : null;
}

function dismiss(): void {
  const dialog = openDialog;
  if (dialog === null) return;
  openDialog = null;
  if (dialog.open) dialog.close();
  dialog.remove();
}

function show(image: HTMLImageElement, link: HTMLAnchorElement): void {
  dismiss();
  const previousFocus = document.activeElement;
  const dialog = createElement('dialog', {
    class: 'geld-lightbox',
    [OWN_UI_ATTRIBUTE]: '',
    'aria-label': 'Image attachment',
  });
  const close = createElement('button', {
    type: 'button', class: 'geld-lightbox__close', 'aria-label': 'Close image', title: 'Close (Esc)',
  }, [svgFromString(ICON_X)]);
  const original = createElement('a', {
    class: 'geld-lightbox__original', href: link.href, target: '_blank', rel: 'noopener noreferrer',
  }, ['Open original', svgFromString(ICON_LINK_EXTERNAL)]);
  const viewer = createAttachmentViewer(image);
  dialog.append(
    createElement('header', { class: 'geld-lightbox__header' }, [
      brandMark('geld-lightbox__brand'), close,
    ]),
    viewer.stage,
    createElement('footer', { class: 'geld-lightbox__footer' }, [viewer.controls, original]),
  );
  close.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('close', () => {
    viewer.dispose();
    if (openDialog === dialog) openDialog = null;
    dialog.remove();
    if (link.isConnected) link.focus({ preventScroll: true });
    else if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  }, { once: true });
  document.body.append(dialog);
  openDialog = dialog;
  dialog.showModal();
  close.focus();
}

function onClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !isConversation()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const image = target.closest('img') ?? target.closest('a')?.querySelector('img');
  if (!(image instanceof HTMLImageElement)) return;
  const link = attachmentLink(image);
  if (link === null) return;
  show(image, link);
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function applyAttachmentLightbox(enabled = true): void {
  if (!enabled || !isConversation()) {
    removeAttachmentLightbox();
    return;
  }
  if (activePath !== window.location.pathname) dismiss();
  activePath = window.location.pathname;
  document.addEventListener('click', onClick, true);
  for (const image of document.querySelectorAll('.markdown-body img')) {
    if (image instanceof HTMLImageElement) {
      const eligible = attachmentLink(image) !== null;
      if (eligible !== image.hasAttribute(IMAGE_ATTRIBUTE)) image.toggleAttribute(IMAGE_ATTRIBUTE, eligible);
    }
  }
}

export function removeAttachmentLightbox(): void {
  document.removeEventListener('click', onClick, true);
  dismiss();
  activePath = null;
  for (const image of document.querySelectorAll(`[${IMAGE_ATTRIBUTE}]`)) image.removeAttribute(IMAGE_ATTRIBUTE);
}
