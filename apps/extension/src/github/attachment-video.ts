import videojs from 'video.js/core.es.js';
import playerCss from 'video.js/dist/video-js.css?inline';
import { createElement } from './dom';

// Only initialize the player inside Geld's dialog, even if the page uses Video.js markup.
Object.assign(videojs.options, { autoSetup: false });

export function attachmentVideoUrl(video: HTMLVideoElement): string | null {
  const src = video.currentSrc || video.src || video.querySelector<HTMLSourceElement>('source[src]')?.src;
  return src && /^https?:\/\//i.test(src) ? src : null;
}

export function createAttachmentVideo(source: HTMLVideoElement, url: string) {
  const video = createElement('video', {
    class: 'video-js vjs-big-play-centered', src: url, controls: '', playsinline: '', preload: 'metadata',
  });
  if (source.poster) video.poster = source.poster;
  for (const track of source.querySelectorAll('track')) video.append(track.cloneNode(true));

  const position = source.currentTime;
  const resume = !source.paused && !source.ended;
  if (resume) source.pause();

  const stage = createElement('div', {
    class: 'geld-lightbox__stage geld-lightbox__stage--large geld-lightbox__stage--video',
  }, [video, createElement('style', {}, [
    typeof CSSScopeRule === 'undefined' ? playerCss : `@scope (.geld-lightbox__stage--video) { ${playerCss} }`,
  ])]);
  let player: ReturnType<typeof videojs> | undefined;

  return {
    stage,
    mount: () => {
      const mounted = videojs(video, {
        controls: true,
        muted: source.muted,
        loop: source.loop,
        experimentalSvgIcons: true,
        responsive: true,
        enableSmoothSeeking: true,
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        controlBar: {
          skipButtons: { backward: 10, forward: 10 },
          remainingTimeDisplay: false,
          currentTimeDisplay: true,
          timeDivider: true,
          durationDisplay: true,
        },
        userActions: { hotkeys: true },
        notSupportedMessage: 'This video could not be loaded. Open the original or return to the inline video.',
      });
      player = mounted;
      mounted.volume(source.volume);
      mounted.playbackRate(source.playbackRate);
      video.addEventListener('loadedmetadata', () => {
        if (position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(position, video.duration);
      }, { once: true });
      if (resume) void mounted.play()?.catch(() => {});
    },
    dispose: () => {
      if (Number.isFinite(video.duration) && source.isConnected && attachmentVideoUrl(source) === url) {
        source.currentTime = video.currentTime;
      }
      player?.dispose();
    },
  };
}
