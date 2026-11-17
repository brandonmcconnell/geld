import { repositoryKey } from '@geld/core';
import { openAttachmentGallery } from '../ui/attachment-gallery';
import type { GalleryImage } from '../ui/attachment-gallery';
import type { ProviderAdapter, ProviderReviewPage } from './types';
import { isProviderReviewPage } from './types';
import { providerVideoPreview, providerVideoSource, providerVideoUrl } from './attachment-video';
import { createAttachmentVideo } from '../ui/attachment-video';
import { showLightboxDialog } from '../ui/lightbox-dialog';
import './attachment-lightbox.css';

export function attachmentLinkFor(image: HTMLImageElement, page: ProviderReviewPage, accepts: (url: URL) => boolean): HTMLAnchorElement | null {
  const link = image.closest('a');
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return null;
  try {
    const url = new URL(link.href, page.url);
    const source = new URL(image.currentSrc || image.src, page.url);
    if (url.protocol !== 'https:' || url.origin !== page.repository.origin || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
      || source.href !== url.href || !accepts(url)) return null;
    return link;
  } catch { return null; }
}

export class ProviderAttachmentLightbox {
  private page: ProviderReviewPage | null = null;
  private videoCurrent: (() => boolean) | null = null;
  private readonly marked = new Set<HTMLImageElement>();
  /** The rendered body each marked image stands in: one body is one gallery, as on GitHub. */
  private readonly bodies = new Map<HTMLImageElement, HTMLElement>();
  private closeGallery: (() => void) | null = null;
  private nextId = 0;
  private readonly ids = new WeakMap<HTMLImageElement, string>();
  private readonly videos = new Map<HTMLVideoElement, HTMLButtonElement>();
  constructor(private readonly adapter: ProviderAdapter) {}

  update(page: ProviderReviewPage | null, enabled: boolean): void {
    if (!enabled || page === null || this.adapter.attachmentLink === undefined) { this.clear(); return; }
    if (this.videoCurrent !== null && !this.videoCurrent()) this.close();
    if (this.page?.url !== page.url || this.page.version !== page.version) this.clear();
    this.page = page;
    document.addEventListener('click', this.click, true);
    const candidates = new Set<HTMLImageElement>();
    this.bodies.clear();
    const body = this.adapter.descriptionHost?.(document);
    const roots = [...(body === null || body === undefined ? [] : [body]), ...(this.adapter.personRoots?.(document) ?? []).map((entry) => entry.root),
      ...document.querySelectorAll<HTMLElement>('.geld-provider-review__source .geld-provider-review__body, .geld-provider-review [data-geld-agent-note]')];
    for (const root of roots) for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
      if (image.closest('pre,code,form,button,[contenteditable],dialog,[role="dialog"]') !== null) continue;
      if (this.adapter.attachmentLink(image, page) !== null) { candidates.add(image);if (!this.bodies.has(image)) this.bodies.set(image, root); }
    }
    for (const image of this.marked) if (!candidates.has(image)) { image.removeAttribute('data-geld-provider-lightbox');this.marked.delete(image); }
    for (const image of candidates) { image.setAttribute('data-geld-provider-lightbox', '');this.marked.add(image); }
    const videos = new Set<HTMLVideoElement>();
    for (const root of roots) for (const video of root.querySelectorAll<HTMLVideoElement>('video')) {
      if (!this.validVideo(video, page)) continue;
      videos.add(video);
      let button = this.videos.get(video);
      if (button === undefined) {
        button = providerVideoPreview(video, page.provider, page.url) ?? undefined;
        if (button !== undefined) this.videos.set(video, button);
      }
      if (button !== undefined && video.nextElementSibling !== button) video.after(button);
    }
    for (const [video, button] of this.videos) if (!videos.has(video)) { button.remove();this.videos.delete(video); }
  }

  clear(): void {
    document.removeEventListener('click', this.click, true);
    this.close();this.page = null;
    for (const image of this.marked) image.removeAttribute('data-geld-provider-lightbox');
    this.marked.clear();this.bodies.clear();
    for (const button of this.videos.values()) button.remove();this.videos.clear();
  }

  private validVideo(video: HTMLVideoElement, page: ProviderReviewPage): boolean {
    if (!video.isConnected || video.closest('[data-geld-ui], pre, code, form, button, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]') !== null
      || providerVideoUrl(video, page.provider, page.url) === null) return false;
    const description = this.adapter.descriptionHost?.(document);
    return description?.contains(video) === true || (this.adapter.personRoots?.(document) ?? []).some(entry => entry.root.contains(video));
  }

  private close(): void {
    const gallery = this.closeGallery;
    this.closeGallery = null;
    this.videoCurrent = null;
    gallery?.();
  }

  private readonly click = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || this.page === null || !(event.target instanceof Element)) return;
    const current = this.adapter.describe(new URL(window.location.href), document);
    if (current === null || !isProviderReviewPage(current) || current.url !== this.page.url || current.version !== this.page.version || repositoryKey(current.repository) !== repositoryKey(this.page.repository)) return;
    const control = event.target.closest<HTMLElement>('[data-geld-video-open]');
    const video = control === null ? null : providerVideoSource(control);
    if (video !== null && control !== null && this.validVideo(video, current)) {
      const url = providerVideoUrl(video, current.provider, current.url);
      if (url !== null) { this.showVideo(video, url, control, current);event.preventDefault();event.stopImmediatePropagation(); }
      return;
    }
    const image = event.target.closest('img') ?? event.target.closest('a')?.querySelector('img');
    if (!(image instanceof HTMLImageElement) || !this.marked.has(image) || !image.isConnected) return;
    const link = this.adapter.attachmentLink?.(image, current);
    if (link === null || link === undefined) return;
    this.show(image, link);
    event.preventDefault();event.stopImmediatePropagation();
  };

  /** GitHub's gallery (`ui/attachment-gallery.tsx`): every image of the same rendered body, in the provider's colours and buttons. */
  private show(image: HTMLImageElement, link: HTMLAnchorElement): void {
    this.close();
    const page = this.page;
    const body = this.bodies.get(image);
    if (page === null || body === undefined) return;
    const items: GalleryImage[] = [];
    for (const candidate of body.querySelectorAll<HTMLImageElement>('img')) {
      if (!this.marked.has(candidate)) continue;
      const candidateLink = candidate === image ? link : this.adapter.attachmentLink?.(candidate, page) ?? null;
      if (candidateLink === null) continue;
      let id = this.ids.get(candidate);
      if (id === undefined) { id = `geld-provider-lightbox-${++this.nextId}`;this.ids.set(candidate, id); }
      const alt = candidate.alt.trim();
      items.push({ id, image: candidate, link: candidateLink, title: alt === '' || /^image$/i.test(alt) ? 'Image' : alt });
    }
    const index = items.findIndex((item) => item.image === image);
    if (index < 0) return;
    const dismiss = openAttachmentGallery(items, index, () => { if (this.closeGallery === dismiss) this.closeGallery = null; },
      { host: 'geld-primer-bridge', button: 'geld-provider-toggle', group: 'geld-lightbox__group', groupItem: '' });
    this.closeGallery = dismiss;
  }

  /** GitHub's video player (`ui/attachment-video.ts`, video.js) in GitHub's card, in the provider's buttons and colours. */
  private showVideo(source: HTMLVideoElement, url: string, trigger: HTMLElement, page: ProviderReviewPage): void {
    this.close();
    const current = (): boolean => {
      const active = this.adapter.describe(new URL(window.location.href), document);
      return active !== null && isProviderReviewPage(active) && active.url === page.url && active.version === page.version
        && repositoryKey(active.repository) === repositoryKey(page.repository) && this.validVideo(source, active)
        && providerVideoUrl(source, active.provider, active.url) === url;
    };
    const summary = source.parentElement?.matches('details') ? source.parentElement.querySelector(':scope > summary')?.textContent?.trim() : undefined;
    const title = source.getAttribute('aria-label')?.trim() || summary || 'Video';
    const dismiss = showLightboxDialog(createAttachmentVideo(source, url), title, url, trigger, { dialog: 'geld-primer-bridge', button: 'geld-provider-toggle' });
    this.closeGallery = dismiss;
    this.videoCurrent = current;
  }
}
