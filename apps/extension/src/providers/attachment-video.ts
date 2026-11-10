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

export function createProviderAttachmentVideo(source: HTMLVideoElement, url: string, current: () => boolean): {
  readonly stage: HTMLElement;
  readonly controls: HTMLElement;
  readonly mount: () => void;
  readonly dispose: () => void;
} {
  const video = createElement('video', { class: 'geld-provider-lightbox__video', controls: '', playsinline: '', preload: 'metadata' });
  video.muted = source.muted; video.volume = source.volume; video.playbackRate = source.playbackRate;
  const stage = createElement('div', { class: 'geld-provider-lightbox__stage geld-provider-lightbox__stage--large geld-provider-lightbox__stage--video' }, [video]);
  const status = createElement('p', { class: 'geld-provider-lightbox__status', role: 'status', hidden: '' });
  stage.append(status);
  const back = createElement('button', { type: 'button', 'aria-label': 'Back 10 seconds', disabled: '' }, ['−10s']);
  const ahead = createElement('button', { type: 'button', 'aria-label': 'Forward 10 seconds', disabled: '' }, ['+10s']);
  const speed = createElement('select', { 'aria-label': 'Playback speed' });
  for (const rate of [...new Set([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, source.playbackRate])].sort((a, b) => a - b)) {
    const option = createElement('option', { value: String(rate) }, [`${rate}×`]);option.selected = rate === source.playbackRate;speed.append(option);
  }
  const controls = createElement('div', { class: 'geld-provider-lightbox__playback', role: 'group', 'aria-label': 'Video playback' }, [back, ahead, speed]);
  let disposed = false, mounted = false, ready = false;
  let position = 0;
  const seek = (to: number): void => { if (ready && !disposed && current()) video.currentTime = Math.max(0, Math.min(video.duration, to)); };
  back.addEventListener('click', () => seek(video.currentTime - 10));
  ahead.addEventListener('click', () => seek(video.currentTime + 10));
  speed.addEventListener('change', () => { if (!disposed && current()) video.playbackRate = Number(speed.value); });
  video.addEventListener('loadedmetadata', () => {
    if (disposed || !current() || !Number.isFinite(video.duration)) return;
    ready = true;back.disabled = false;ahead.disabled = false;seek(position);
  });
  video.addEventListener('error', () => {
    if (disposed) return;
    ready = false;back.disabled = true;ahead.disabled = true;
    video.hidden = true;
    status.hidden = false;status.textContent = 'This video could not be loaded. Open the original or return to the inline video.';
  });
  return {
    stage, controls,
    mount() {
      if (mounted || disposed || !current()) return;
      mounted = true;position = source.currentTime;
      const resume = !source.paused && !source.ended;
      if (resume) source.pause();
      video.src = url;
      if (resume) void video.play().catch(() => {});
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mounted && ready && current() && source.isConnected) {
        source.currentTime = Number.isFinite(source.duration) ? Math.min(video.currentTime, source.duration) : video.currentTime;
        source.muted = video.muted;source.volume = video.volume;source.playbackRate = video.playbackRate;
      }
      if (mounted) { video.pause();video.removeAttribute('src');video.load(); }
    },
  };
}
