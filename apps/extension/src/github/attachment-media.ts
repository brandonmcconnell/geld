import { isOwnElement } from './dom';

export const MEDIA_ATTRIBUTE = 'data-geld-lightbox-media';
const IMAGE_PATH = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const VIDEO_PATH = /\.(?:m4v|mov|mp4|ogv|webm)$/i;
const SURFACE = '.markdown-body, .js-comment-body, .blob-wrapper, .render-wrapper, .js-file-content, .image-diff, [data-testid="readme"], [data-testid="markdown-body"], main, [role="main"], article, dialog, [role="dialog"]';
const identities = new WeakMap<HTMLElement, string>();
let nextId = 0;

export interface AttachmentMedia {
  readonly id: string;
  readonly element: HTMLElement;
  readonly image: HTMLImageElement | null;
  readonly video: HTMLVideoElement | null;
  readonly kind: 'image' | 'video';
  readonly src: string;
  readonly original: string;
  readonly poster: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export function mediaUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function isMediaLink(url: URL): boolean {
  return IMAGE_PATH.test(url.pathname) || VIDEO_PATH.test(url.pathname)
    || /(?:^|\.)githubusercontent\.com$/.test(url.hostname)
    || (url.origin === window.location.origin && /\/(?:user-attachments|assets|files)\//.test(url.pathname));
}

export function mediaSurface(element: HTMLElement): HTMLElement | null {
  return element.closest(SURFACE);
}

export function readAttachmentMedia(element: HTMLElement): AttachmentMedia | null {
  if (isOwnElement(element) || element.closest('.avatar, .avatar-user, [data-component="Avatar"], .emoji, .octicon, [role="menu"], [hidden]') !== null) return null;
  if (mediaSurface(element) === null) return null;
  const image = element instanceof HTMLImageElement ? element : null;
  const video = element instanceof HTMLVideoElement ? element : null;
  const anchor = element instanceof HTMLAnchorElement ? element : element.closest('a');
  if (anchor?.hasAttribute('download')) return null;
  const link = mediaUrl(anchor?.getAttribute('href') ?? null);
  if (!image && !video && (!link || (!IMAGE_PATH.test(link.pathname) && !VIDEO_PATH.test(link.pathname)))) return null;
  if (element instanceof HTMLAnchorElement && (element.querySelector('img, video') || !element.closest('.markdown-body, .js-comment-body, .video-container, [data-testid="markdown-body"]'))) return null;
  const canonical = mediaUrl(image?.getAttribute('data-canonical-src') ?? null);
  const source = mediaUrl(image?.currentSrc || image?.src || video?.currentSrc || video?.src || video?.querySelector('source')?.src || link?.href || null);
  if (!source || source.hostname === 'avatars.githubusercontent.com' || /^\/avatars?\//.test(source.pathname)) return null;
  const kind = video || (link && VIDEO_PATH.test(link.pathname)) ? 'video' : 'image';
  const preview = new URL(kind === 'video' && image && link ? link.href : source.href);
  if (!image && !video && preview.origin === window.location.origin) preview.pathname = preview.pathname.replace('/blob/', '/raw/');
  const src = preview.href;
  const original = link && isMediaLink(link) ? link.href : canonical?.href ?? src;
  const knownWidth = image?.naturalWidth || video?.videoWidth || image?.width || video?.width;
  const knownHeight = image?.naturalHeight || video?.videoHeight || image?.height || video?.height;
  const rect = (image || video) && (!knownWidth || !knownHeight) ? element.getBoundingClientRect() : null;
  const width = knownWidth || rect?.width || 1280;
  const height = knownHeight || rect?.height || width * 9 / 16;
  let id = identities.get(element);
  if (!id) {
    id = `geld-media-${++nextId}`;
    identities.set(element, id);
  }
  return {
    id, element, image, video, kind, src, original,
    poster: kind === 'video' ? mediaUrl(video?.getAttribute('poster') || video?.poster || image?.currentSrc || image?.src || null)?.href ?? '' : '',
    alt: image?.alt || element.getAttribute('aria-label') || element.title || '',
    width, height,
  };
}

export function collectAttachmentMedia(root: ParentNode): AttachmentMedia[] {
  const items: AttachmentMedia[] = [];
  for (const element of root.querySelectorAll('img, video, a[href]')) {
    if (!(element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLAnchorElement)) continue;
    const item = readAttachmentMedia(element);
    if (item) items.push(item);
  }
  return items;
}

export function fitAttachmentMedia(width: number, height: number, viewportWidth: number, viewportHeight: number, gallery: boolean): { width: number; height: number } {
  const ratio = Math.min(1, Math.max(1, Math.min(1120, viewportWidth <= 600 ? viewportWidth - 32 : viewportWidth * 0.8)) / width,
    Math.max(1, Math.min(760, viewportHeight * 0.72, viewportHeight - (gallery ? 260 : 168))) / height);
  return { width: width * ratio, height: height * ratio };
}
