import { repositoryKey } from '@geld/core';
import { createAttachmentViewer } from '../ui/attachment-viewer';
import { createElement } from '../github/dom';
import type { ProviderAdapter, ProviderReviewPage } from './types';
import { isProviderReviewPage } from './types';
import { createProviderAttachmentVideo, providerVideoPreview, providerVideoSource, providerVideoUrl } from './attachment-video';
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
  private dialog: HTMLDialogElement | null = null;
  private dispose: (() => void) | null = null;
  private videoCurrent: (() => boolean) | null = null;
  private readonly marked = new Set<HTMLImageElement>();
  private readonly videos = new Map<HTMLVideoElement, HTMLButtonElement>();
  constructor(private readonly adapter: ProviderAdapter) {}

  update(page: ProviderReviewPage | null, enabled: boolean): void {
    if (!enabled || page === null || this.adapter.attachmentLink === undefined) { this.clear(); return; }
    if (this.videoCurrent !== null && !this.videoCurrent()) this.close();
    if (this.page?.url !== page.url || this.page.version !== page.version) this.clear();
    this.page = page;
    document.addEventListener('click', this.click, true);
    const candidates = new Set<HTMLImageElement>();
    const body = this.adapter.descriptionHost?.(document);
    const roots = [...(body === null || body === undefined ? [] : [body]), ...(this.adapter.personRoots?.(document) ?? []).map((entry) => entry.root),
      ...document.querySelectorAll<HTMLElement>('.geld-provider-review__source .geld-provider-review__body, .geld-provider-review [data-geld-agent-note]')];
    for (const root of roots) for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
      if (image.closest('pre,code,form,button,[contenteditable],dialog,[role="dialog"]') !== null) continue;
      if (this.adapter.attachmentLink(image, page) !== null) candidates.add(image);
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
    this.marked.clear();
    for (const button of this.videos.values()) button.remove();this.videos.clear();
  }

  private validVideo(video: HTMLVideoElement, page: ProviderReviewPage): boolean {
    if (!video.isConnected || video.closest('[data-geld-ui], pre, code, form, button, [contenteditable]:not([contenteditable="false"]), dialog, [role="dialog"]') !== null
      || providerVideoUrl(video, page.provider, page.url) === null) return false;
    const description = this.adapter.descriptionHost?.(document);
    return description?.contains(video) === true || (this.adapter.personRoots?.(document) ?? []).some(entry => entry.root.contains(video));
  }

  private close(): void {
    const dialog = this.dialog;
    this.dialog = null;
    this.videoCurrent = null;
    this.dispose?.();this.dispose = null;
    if (dialog?.open) dialog.close();
    dialog?.remove();
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

  private show(image: HTMLImageElement, link: HTMLAnchorElement): void {
    this.close();
    const previousFocus = document.activeElement;
    const dialog = createElement('dialog', { class: 'geld-provider-lightbox', 'data-geld-ui': '', 'aria-label': image.alt.trim() || 'Image' });
    const close = createElement('button', { type: 'button', 'aria-label': 'Close image', title: 'Close (Esc)' }, ['Close']);
    const original = createElement('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer' }, ['Open original']);
    const viewer = createAttachmentViewer(image, { prefix: 'geld-provider-lightbox', large: true });
    dialog.append(createElement('header', {}, [createElement('h2', {}, [image.alt.trim() || 'Image']), close]),
      createElement('div', { class: 'geld-provider-lightbox__body' }, [viewer.stage]), createElement('footer', {}, [viewer.controls, original]));
    this.dispose = viewer.dispose;
    close.addEventListener('click', () => this.close());
    dialog.addEventListener('cancel', (event) => { event.preventDefault();this.close(); });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.dialog !== dialog) return;
      event.preventDefault();event.stopPropagation();this.close();
    }, { capture: true });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) this.close(); });
    dialog.addEventListener('close', () => {
      viewer.dispose();dialog.remove();
      if (this.dialog === dialog) { this.dialog = null;this.dispose = null; }
      if (link.isConnected) link.focus({ preventScroll: true });
      else if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    }, { once: true });
    document.body.append(dialog);this.dialog = dialog;
    dialog.showModal();close.focus();
  }

  private showVideo(source: HTMLVideoElement, url: string, trigger: HTMLElement, page: ProviderReviewPage): void {
    this.close();
    const dialog = createElement('dialog', { class: 'geld-provider-lightbox', 'data-geld-ui': '', 'aria-label': 'Video' });
    const close = createElement('button', { type: 'button', 'aria-label': 'Close video', title: 'Close (Esc)' }, ['Close']);
    const original = createElement('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, ['Open original']);
    const current = (): boolean => {
      const active = this.adapter.describe(new URL(window.location.href), document);
      return active !== null && isProviderReviewPage(active) && active.url === page.url && active.version === page.version
        && repositoryKey(active.repository) === repositoryKey(page.repository) && this.validVideo(source, active)
        && providerVideoUrl(source, active.provider, active.url) === url;
    };
    const viewer = createProviderAttachmentVideo(source, url, current);
    dialog.append(createElement('header', {}, [createElement('h2', {}, [source.getAttribute('aria-label') || 'Video']), close]),
      createElement('div', { class: 'geld-provider-lightbox__body' }, [viewer.stage]), createElement('footer', {}, [viewer.controls, original]));
    this.dispose = viewer.dispose;
    close.addEventListener('click', () => this.close());
    dialog.addEventListener('cancel', event => { event.preventDefault();this.close(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.dialog !== dialog) return;
      event.preventDefault();event.stopPropagation();this.close();
    }, { capture: true });
    dialog.addEventListener('click', event => { if (event.target === dialog) this.close(); });
    dialog.addEventListener('close', () => {
      viewer.dispose();dialog.remove();
      if (this.dialog === dialog) { this.dialog = null;this.dispose = null;this.videoCurrent = null; }
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    }, { once: true });
    document.body.append(dialog);this.dialog = dialog;this.videoCurrent = current;dialog.showModal();viewer.mount();close.focus();
  }
}
