import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { attachmentVideoUrl, createAttachmentVideo } from './attachment-video';
import { createPdfViewer } from './attachment-pdf';
import { pdfSourceOf } from './pdf-links';
import { openAttachmentGallery } from './attachment-gallery';
import type { GalleryImage } from './attachment-gallery';
import { ICON_LINK_EXTERNAL, ICON_X } from './ui/icons';

const IMAGE_ATTRIBUTE = 'data-geld-lightbox-image';
const LINK_ATTRIBUTE = 'data-geld-lightbox-link';
const IMAGE_PATH = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
let activePath: string | null = null;
let closeDialog: (() => void) | null = null;
const videoButtons = new Map<HTMLVideoElement, HTMLButtonElement>();
const imageIds = new WeakMap<HTMLImageElement, string>();
let nextImageId = 0;

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
  if (url.hostname === 'raw.githubusercontent.com' || url.hostname === 'media.githubusercontent.com') return IMAGE_PATH.test(url.pathname) ? link : null;
  // GitHub proxies an external image through camo and links it to itself, so only that self-link counts.
  if (url.hostname === 'camo.githubusercontent.com') return url.href === image.src ? link : null;
  if (url.origin !== window.location.origin) return null;
  if (/^\/(?:user-attachments|[^/]+\/[^/]+)\/assets\//.test(url.pathname)) return link;
  // A `files` upload can be any file (a PDF, a zip), so it counts only when it names an image.
  return /^\/(?:user-attachments\/files|[^/]+\/[^/]+\/(?:files|blob|raw))\//.test(url.pathname) && IMAGE_PATH.test(url.pathname) ? link : null;
}

/** GitHub names every upload "image" (older uploads "Image"), which says nothing a dialog title should. */
function titleFor(image: HTMLImageElement): string {
  const alt = image.alt.trim();
  return alt === '' || /^image$/i.test(alt) ? 'Image' : alt;
}

interface DialogViewer {
  readonly stage: HTMLElement;
  readonly mount?: () => void;
  readonly dispose: () => void;
}

function showDialog(viewer: DialogViewer, title: string, href: string, trigger: HTMLElement, linkText = 'Open original'): void {
  closeDialog?.();
  const titleId = `geld-lightbox-title-${Date.now()}`;
  const dialog = createElement('dialog', {
    class: 'geld-lightbox',
    [OWN_UI_ATTRIBUTE]: '',
    'aria-labelledby': titleId,
  });
  const close = createElement('button', {
    type: 'button', class: 'geld-lightbox__close', 'aria-label': 'Close', title: 'Close (Esc)',
  }, [svgFromString(ICON_X)]);
  const original = createElement('a', {
    class: 'btn btn-sm geld-lightbox__original', href, target: '_blank', rel: 'noopener noreferrer',
  }, [linkText, svgFromString(ICON_LINK_EXTERNAL)]);
  dialog.append(
    createElement('header', { class: 'geld-lightbox__header' }, [
      createElement('h1', { class: 'geld-lightbox__title', id: titleId }, [title]),
      original,
      close,
    ]),
    createElement('div', { class: 'geld-lightbox__body' }, [viewer.stage]),
  );
  const dismiss = (): void => {
    if (closeDialog !== dismiss) return;
    closeDialog = null;
    viewer.dispose();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  };
  close.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('close', dismiss, { once: true });
  document.body.append(dialog);
  closeDialog = dismiss;
  dialog.showModal();
  viewer.mount?.();
  close.focus();
}

function galleryImage(image: HTMLImageElement): GalleryImage | null {
  const link = attachmentLink(image);
  if (link === null) return null;
  let id = imageIds.get(image);
  if (id === undefined) {
    id = `geld-lightbox-image-${++nextImageId}`;
    imageIds.set(image, id);
  }
  return { id, image, link, title: titleFor(image) };
}

/** Each rendered body is its own gallery, so one comment's screenshots never mix with another's. */
function openGallery(image: HTMLImageElement): void {
  const body = image.closest('.markdown-body');
  const items = [...(body?.querySelectorAll('img') ?? [])].flatMap((candidate) => {
    const item = candidate instanceof HTMLImageElement ? galleryImage(candidate) : null;
    return item === null ? [] : [item];
  });
  const index = items.findIndex((item) => item.image === image);
  if (index < 0) return;
  closeDialog?.();
  const dismiss = openAttachmentGallery(items, index, () => {
    if (closeDialog === dismiss) closeDialog = null;
  });
  closeDialog = dismiss;
}

function onClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const pdfLink = target.closest('.markdown-body a[href]');
  const pdf = !import.meta.env.FIREFOX && pdfLink instanceof HTMLAnchorElement && !pdfLink.hasAttribute('download') ? pdfSourceOf(pdfLink.href, window.location.origin) : null;
  if (pdfLink instanceof HTMLAnchorElement && pdf !== null) {
    showDialog(createPdfViewer(pdf, () => closeDialog?.()), pdf.name, pdf.url, pdfLink, 'Download');
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const image = target.closest('img') ?? target.closest('a')?.querySelector('img');
  if (!(image instanceof HTMLImageElement)) return;
  const link = attachmentLink(image);
  if (link === null) return;
  openGallery(image);
  event.preventDefault();
  event.stopImmediatePropagation();
}

function enhanceVideos(): void {
  const videos = new Set(document.querySelectorAll<HTMLVideoElement>('.markdown-body video'));
  for (const [video, button] of videoButtons) {
    if (!videos.has(video) || attachmentVideoUrl(video) === null || video.nextElementSibling !== button) {
      button.remove();
      videoButtons.delete(video);
    }
  }
  for (const video of videos) {
    if (videoButtons.has(video) || attachmentVideoUrl(video) === null) continue;
    const button = createElement('button', {
      type: 'button', class: 'btn btn-sm geld-lightbox-trigger', 'aria-haspopup': 'dialog', [OWN_UI_ATTRIBUTE]: '',
    }, ['Open in player']);
    button.addEventListener('click', () => {
      const url = attachmentVideoUrl(video);
      if (url === null) return;
      const summary = video.parentElement?.matches('details')
        ? video.parentElement.querySelector(':scope > summary')?.textContent?.trim()
        : undefined;
      const title = video.getAttribute('aria-label')?.trim() || summary || 'Video';
      showDialog(createAttachmentVideo(video, url), title, url, button);
    });
    video.after(button);
    videoButtons.set(video, button);
  }
}

export function applyAttachmentLightbox(enabled = true): void {
  if (!enabled) {
    removeAttachmentLightbox();
    return;
  }
  if (activePath !== window.location.pathname) closeDialog?.();
  activePath = window.location.pathname;
  document.addEventListener('click', onClick, true);
  enhanceVideos();
  const links = new Set<HTMLAnchorElement>();
  for (const image of document.querySelectorAll('.markdown-body img')) {
    if (image instanceof HTMLImageElement) {
      const link = attachmentLink(image);
      if ((link !== null) !== image.hasAttribute(IMAGE_ATTRIBUTE)) image.toggleAttribute(IMAGE_ATTRIBUTE, link !== null);
      if (link !== null) links.add(link);
    }
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(`a[${LINK_ATTRIBUTE}]`)) {
    if (!links.has(link)) releaseLink(link);
  }
  for (const link of links) {
    if (link.hasAttribute(LINK_ATTRIBUTE) || link.hasAttribute('aria-haspopup')) continue;
    link.setAttribute(LINK_ATTRIBUTE, '');
    link.setAttribute('aria-haspopup', 'dialog');
  }
}

/** Only the `aria-haspopup` Geld added comes off: a link GitHub gave one keeps it. */
function releaseLink(link: HTMLAnchorElement): void {
  link.removeAttribute(LINK_ATTRIBUTE);
  link.removeAttribute('aria-haspopup');
}

export function removeAttachmentLightbox(): void {
  document.removeEventListener('click', onClick, true);
  closeDialog?.();
  for (const button of videoButtons.values()) button.remove();
  videoButtons.clear();
  activePath = null;
  for (const image of document.querySelectorAll(`[${IMAGE_ATTRIBUTE}]`)) image.removeAttribute(IMAGE_ATTRIBUTE);
  for (const link of document.querySelectorAll<HTMLAnchorElement>(`a[${LINK_ATTRIBUTE}]`)) releaseLink(link);
}
