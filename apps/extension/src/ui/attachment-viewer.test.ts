// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createAttachmentViewer } from './attachment-viewer';

let viewer: ReturnType<typeof createAttachmentViewer> | undefined;
afterEach(() => { viewer?.dispose();document.body.replaceChildren();vi.restoreAllMocks(); });

it('fits large image previews to the mounted canvas and anchors zoom in its letterboxed area', () => {
  const source = document.createElement('img');source.src = 'https://gitlab.com/group/project/-/raw/main/image.png';
  Object.defineProperties(source, { naturalWidth: { value: 1200 }, naturalHeight: { value: 400 } });
  viewer = createAttachmentViewer(source, { prefix: 'geld-provider-lightbox', large: true });
  document.body.append(viewer.stage, viewer.controls);
  Object.defineProperties(viewer.stage, { clientWidth: { value: 1000 }, clientHeight: { value: 500 } });
  vi.spyOn(viewer.stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 1000, 500));
  const image = viewer.stage.querySelector('img')!;
  Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 400 } });
  image.dispatchEvent(new Event('load'));
  expect(viewer.stage.style.width).toBe('');expect(image.style.width).toBe('800px');
  image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 800, clientY: 350 }));
  expect(image.style.transform).toBe('translate(-200px, 0px) scale(2)');
  window.dispatchEvent(new Event('resize'));
  expect(image.style.transform).toBe('translate(-200px, 0px) scale(2)');
});

it('limits initial enlargement of small images and leaves the canvas usable on an image failure', () => {
  const source = document.createElement('img');source.src = 'https://gitlab.com/group/project/-/raw/main/small.png';
  Object.defineProperties(source, { naturalWidth: { value: 30 }, naturalHeight: { value: 20 } });
  viewer = createAttachmentViewer(source, { prefix: 'geld-provider-lightbox', large: true });
  document.body.append(viewer.stage, viewer.controls);
  Object.defineProperties(viewer.stage, { clientWidth: { value: 1000 }, clientHeight: { value: 500 } });
  const image = viewer.stage.querySelector('img')!;image.dispatchEvent(new Event('load'));
  expect(image.style.width).toBe('60px');expect(image.style.height).toBe('40px');
  image.dispatchEvent(new Event('error'));
  expect(image.hidden).toBe(true);expect(viewer.stage.querySelector<HTMLElement>('[role="status"]')?.hidden).toBe(false);
  expect(viewer.controls.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.disabled).toBe(true);
});
