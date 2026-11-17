// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { providerVideoPreview, providerVideoSource, providerVideoUrl } from './attachment-video';

const review = 'https://gitlab.com/group/project/-/merge_requests/1';
const url = 'https://gitlab.com/-/project/123/uploads/0acc0b3514c56d8c6949d7c6aaa9c092/video.mp4';
let source: HTMLVideoElement;
beforeEach(() => {
  source = document.createElement('video');source.src = url;source.currentTime = 38;source.volume = 0.4;source.muted = true;source.playbackRate = 1.25;
  document.body.append(source);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { document.body.replaceChildren();vi.restoreAllMocks(); });

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
