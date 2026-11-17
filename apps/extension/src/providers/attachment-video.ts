import { createElement } from '../github/dom';

type Provider = 'gitlab' | 'bitbucket';
const sources = new WeakMap<HTMLElement, HTMLVideoElement>();

export function providerVideoUrl(video: HTMLVideoElement, provider: Provider, reviewUrl: string): string | null {
  const value = video.currentSrc || video.src || video.querySelector<HTMLSourceElement>('source[src]')?.src;
  if (!value) return null;
  try {
    const review = new URL(reviewUrl), url = new URL(value, video.ownerDocument.URL);
    if (url.protocol !== 'https:' || url.origin !== review.origin || url.username || url.password || url.hash
      || !/\.(?:mp4|m4v|webm|ogv|ogg|mov)$/i.test(url.pathname)) return null;
    if (provider === 'gitlab') {
      const marker = review.pathname.indexOf('/-/merge_requests/');
      if (marker < 1) return null;
      const root = review.pathname.slice(0, marker);
      return (/^\/-\/project\/[1-9]\d*\/uploads\/[a-f0-9]{32,64}\//i.test(url.pathname)
        || url.pathname.startsWith(`${root}/`) && /\/(?:uploads\/[a-f0-9]{32,64}\/|raw\/)/i.test(url.pathname)) ? url.href : null;
    }
    const match = /^\/([^/]+\/[^/]+)\/pull-requests\/[1-9]\d*(?:\/|$)/.exec(review.pathname);
    if (match === null) return null;
    const root = `/${match[1]}/`;
    return url.pathname.startsWith(root) && /^(?:raw\/|downloads\/|pull-requests\/[1-9]\d*\/attachments\/)/.test(url.pathname.slice(root.length)) ? url.href : null;
  } catch { return null; }
}

export function providerVideoPreview(video: HTMLVideoElement, provider: Provider, reviewUrl: string): HTMLButtonElement | null {
  if (!video.isConnected || providerVideoUrl(video, provider, reviewUrl) === null) return null;
  const button = createElement('button', { type: 'button', class: 'geld-provider-toggle geld-provider-video-open', 'data-geld-ui': '', 'data-geld-video-open': '' }, ['Open video']);
  button.setAttribute('aria-label', 'Open video in a larger player');
  sources.set(button, video);
  return button;
}

export function providerVideoSource(control: HTMLElement): HTMLVideoElement | null { return sources.get(control) ?? null; }
