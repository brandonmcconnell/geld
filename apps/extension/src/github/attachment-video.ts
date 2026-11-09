import { createElement } from './dom';

export function attachmentVideoUrl(video: HTMLVideoElement): string | null {
  const src = video.currentSrc || video.src || video.querySelector<HTMLSourceElement>('source[src]')?.src;
  return src && /^https?:\/\//i.test(src) ? src : null;
}

export function createAttachmentVideo(source: HTMLVideoElement, url: string) {
  const video = createElement('video', {
    class: 'geld-lightbox__video', controls: '', playsinline: '', preload: 'metadata', 'aria-label': 'Attachment video',
  });
  if (source.poster) video.poster = source.poster;
  video.muted = source.muted;
  video.volume = source.volume;

  const position = source.currentTime;
  const resume = !source.paused && !source.ended;
  if (resume) source.pause();

  const status = createElement('p', { class: 'geld-lightbox__status', role: 'status', hidden: '' }, [
    'This video could not be loaded. Close the player to return to the inline video.',
  ]);
  const stage = createElement('div', { class: 'geld-lightbox__stage geld-lightbox__stage--large geld-lightbox__stage--video' }, [video, status]);

  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const speed = createElement('select', {
    class: 'form-select select-sm', 'aria-label': 'Playback speed',
  }, speeds.map((rate) => createElement('option', { value: String(rate) }, [`${rate}×`])));
  speed.value = String(video.playbackRate);
  speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); });
  video.addEventListener('ratechange', () => { speed.value = String(video.playbackRate); });

  const back = createElement('button', {
    type: 'button', class: 'btn btn-sm', 'aria-label': 'Back 10 seconds', disabled: '',
  }, ['−10s']);
  const forward = createElement('button', {
    type: 'button', class: 'btn btn-sm', 'aria-label': 'Forward 10 seconds', disabled: '',
  }, ['+10s']);
  back.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
  forward.addEventListener('click', () => { video.currentTime = Math.min(video.duration, video.currentTime + 10); });

  const controls = createElement('div', {
    class: 'geld-lightbox__video-tools', role: 'group', 'aria-label': 'Video controls',
  }, [back, forward, speed]);

  video.addEventListener('loadedmetadata', () => {
    if (position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(position, video.duration);
    back.disabled = forward.disabled = !Number.isFinite(video.duration);
  });
  video.addEventListener('error', () => {
    video.hidden = true;
    status.hidden = false;
    back.disabled = forward.disabled = speed.disabled = true;
  });

  video.src = url;
  if (resume) void video.play().catch(() => {});

  return {
    stage, controls,
    dispose: () => {
      if (Number.isFinite(video.duration) && source.isConnected && attachmentVideoUrl(source) === url) {
        source.currentTime = video.currentTime;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
