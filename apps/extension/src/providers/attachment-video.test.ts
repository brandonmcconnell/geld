// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProviderAttachmentVideo, providerVideoPreview, providerVideoSource, providerVideoUrl } from './attachment-video';

const review = 'https://gitlab.com/group/project/-/merge_requests/1';
const url = 'https://gitlab.com/-/project/123/uploads/0acc0b3514c56d8c6949d7c6aaa9c092/video.mp4';
let source: HTMLVideoElement;
let viewer: ReturnType<typeof createProviderAttachmentVideo> | undefined;
beforeEach(() => {
  source = document.createElement('video');source.src = url;source.currentTime = 38;source.volume = 0.4;source.muted = true;source.playbackRate = 1.25;
  document.body.append(source);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { viewer?.dispose();viewer = undefined;document.body.replaceChildren();vi.restoreAllMocks(); });

it('qualifies only native media URLs and binds preview controls to their real source nodes', () => {
  expect(providerVideoUrl(source, 'gitlab', review)).toBe(url);
  const control = providerVideoPreview(source, 'gitlab', review)!;
  expect(providerVideoSource(control)).toBe(source);
  const clone = control.cloneNode(true);
  if (!(clone instanceof HTMLElement)) throw new Error('Missing cloned control');
  expect(providerVideoSource(clone)).toBeNull();
  for (const value of ['https://example.com/video.mp4', 'javascript:alert(1)', 'blob:https://gitlab.com/test', 'https://gitlab.com/other/page.mp4', url.replace('/video.mp4', '/video.mp4#fragment')]) {
    source.src = value;expect(providerVideoUrl(source, 'gitlab', review)).toBeNull();
  }
  source.src = 'https://bitbucket.org/team/project/downloads/recording.webm';
  expect(providerVideoUrl(source, 'bitbucket', 'https://bitbucket.org/team/project/pull-requests/1')).toBe(source.src);
  expect(providerVideoUrl(source, 'bitbucket', 'https://bitbucket.org/other/project/pull-requests/1')).toBeNull();
  source.remove();expect(providerVideoPreview(source, 'bitbucket', 'https://bitbucket.org/team/project/pull-requests/1')).toBeNull();
});

it('keeps paused videos paused, provides native controls and hands playback position and speed back on close', () => {
  viewer = createProviderAttachmentVideo(source, url, () => source.src === url);
  document.body.append(viewer.stage, viewer.controls);viewer.mount();
  const video = viewer.stage.querySelector('video')!;
  expect(video.controls).toBe(true);expect(video.hasAttribute('autoplay')).toBe(false);
  expect(video.play).not.toHaveBeenCalled();expect(source.pause).not.toHaveBeenCalled();
  expect(video.volume).toBe(0.4);expect(video.muted).toBe(true);expect(video.playbackRate).toBe(1.25);
  Object.defineProperty(video, 'duration', { value: 100 });video.dispatchEvent(new Event('loadedmetadata'));
  expect(video.currentTime).toBe(38);
  viewer.controls.querySelector<HTMLButtonElement>('[aria-label="Forward 10 seconds"]')!.click();expect(video.currentTime).toBe(48);
  const speed = viewer.controls.querySelector('select')!;speed.value = '1.5';speed.dispatchEvent(new Event('change'));
  viewer.dispose();expect(source.currentTime).toBe(48);expect(source.playbackRate).toBe(1.5);expect(video.getAttribute('src')).toBeNull();
});

it('continues an already playing video but never writes stale state back after its native source changes', () => {
  Object.defineProperties(source, { paused: { value: false }, ended: { value: false } });
  viewer = createProviderAttachmentVideo(source, url, () => source.src === url);
  document.body.append(viewer.stage);viewer.mount();
  const video = viewer.stage.querySelector('video')!;
  expect(source.pause).toHaveBeenCalled();expect(video.play).toHaveBeenCalled();
  Object.defineProperty(video, 'duration', { value: 100 });video.dispatchEvent(new Event('loadedmetadata'));video.currentTime = 60;
  source.src = url.replace('video.mp4', 'changed.mp4');viewer.dispose();expect(source.currentTime).toBe(38);
});

it('clamps seeking and offers an original-source fallback when playback fails', () => {
  viewer = createProviderAttachmentVideo(source, url, () => true);document.body.append(viewer.stage, viewer.controls);viewer.mount();
  const video = viewer.stage.querySelector('video')!;Object.defineProperty(video, 'duration', { value: 42 });video.dispatchEvent(new Event('loadedmetadata'));
  viewer.controls.querySelector<HTMLButtonElement>('[aria-label="Forward 10 seconds"]')!.click();expect(video.currentTime).toBe(42);
  video.currentTime = 3;viewer.controls.querySelector<HTMLButtonElement>('[aria-label="Back 10 seconds"]')!.click();expect(video.currentTime).toBe(0);
  video.dispatchEvent(new Event('error'));
  expect(video.hidden).toBe(true);
  expect(viewer.stage.querySelector<HTMLElement>('[role="status"]')?.hidden).toBe(false);
  expect(viewer.controls.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
});
