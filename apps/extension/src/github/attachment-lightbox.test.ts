// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAttachmentLightbox, removeAttachmentLightbox } from './attachment-lightbox';

const { mount, dispose } = vi.hoisted(() => ({ mount: vi.fn(), dispose: vi.fn() }));
vi.mock('./attachment-viewer', () => ({ mountAttachmentViewer: mount }));
const SRC = 'https://github.com/user-attachments/assets/example';

function image(html = `<a href="${SRC}"><img src="${SRC}" alt="Screenshot"></a>`): HTMLImageElement {
  const body = document.createElement('article');
  body.className = 'markdown-body';
  body.innerHTML = html;
  document.body.append(body);
  const result = body.querySelector('img');
  if (!result) throw new Error('Missing test image');
  return result;
}

function click(element: Element, options: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  element.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://github.com/owner/repo/issues/42'));
  mount.mockReset().mockReturnValue(dispose);
  dispose.mockReset();
});
afterEach(() => {
  removeAttachmentLightbox();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('attachment lightbox integration', () => {
  it.each(['/owner/repo', '/owner/repo/blob/main/README.md', '/owner/repo/wiki/Home', '/owner/repo/discussions/42', '/owner/repo/releases/tag/v1', '/owner/repo/issues/42', '/owner/repo/pull/42', '/owner/repo/pull/42/files'])('opens media on %s', async (path) => {
    vi.stubGlobal('location', new URL(`https://github.com${path}`));
    const source = image();
    applyAttachmentLightbox();
    expect(source.hasAttribute('data-geld-lightbox-image')).toBe(true);
    expect(click(source).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(mount.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ src: SRC, original: SRC, kind: 'image' })]);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('preserves native navigation for %o', async (options) => {
    const source = image();
    applyAttachmentLightbox();
    expect(click(source, options).defaultPrevented).toBe(false);
    await vi.dynamicImportSettled();
    expect(mount).not.toHaveBeenCalled();
  });

  it('supports unlinked images and keyboard activation without moving GitHub nodes', async () => {
    const source = image(`<picture><img src="${SRC}" tabindex="3"></picture>`);
    const parent = source.parentNode;
    applyAttachmentLightbox();
    expect(source.getAttribute('role')).toBe('button');
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    source.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(source.parentNode).toBe(parent);
    removeAttachmentLightbox();
    expect(source.getAttribute('role')).toBeNull();
    expect(source.getAttribute('tabindex')).toBe('3');
  });

  it('collects only the selected rendered body into the gallery, in document order', async () => {
    const source = image();
    source.closest('article')?.insertAdjacentHTML('beforeend', '<video src="https://github.com/user-attachments/assets/movie" controls></video><img src="https://example.com/second.webp">');
    image();
    applyAttachmentLightbox();
    click(source);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(mount.mock.calls[0]?.[0]).toHaveLength(3);
    expect(mount.mock.calls[0]?.[1]).toBe(0);
  });

  it('expands video without intercepting native playback controls', async () => {
    const main = document.createElement('main');
    main.innerHTML = '<video controls><source src="https://github.com/user-attachments/assets/movie"></video>';
    document.body.append(main);
    const video = main.querySelector('video');
    if (!video) throw new Error('Missing video');
    applyAttachmentLightbox();
    expect(click(video).defaultPrevented).toBe(false);
    const button = main.querySelector('button');
    if (!button) throw new Error('Missing expand button');
    expect(click(button).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(mount.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ kind: 'video', src: 'https://github.com/user-attachments/assets/movie' })]);
    removeAttachmentLightbox();
    expect(main.querySelector('button')).toBeNull();
    expect(video.controls).toBe(true);
  });

  it('handles replaced READMEs and newly inserted comments without duplicating controls', async () => {
    applyAttachmentLightbox();
    const source = image();
    source.closest('article')?.insertAdjacentHTML('beforeend', '<video src="https://example.com/demo.mp4"></video>');
    await vi.waitFor(() => expect(source.hasAttribute('data-geld-lightbox-image')).toBe(true));
    applyAttachmentLightbox();
    expect(source.hasAttribute('data-geld-lightbox-image')).toBe(true);
    expect(document.querySelectorAll('.geld-media-open')).toHaveLength(1);
  });

  it('disabling restores native behavior and closes an open viewer', async () => {
    const source = image();
    applyAttachmentLightbox();
    click(source);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    applyAttachmentLightbox(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(click(source).defaultPrevented).toBe(false);
    expect(source.hasAttribute('data-geld-lightbox-media')).toBe(false);
    applyAttachmentLightbox(true);
    expect(source.hasAttribute('data-geld-lightbox-media')).toBe(true);
  });

  it('cancels a pending lazy open when disabled or navigated away', async () => {
    const source = image();
    applyAttachmentLightbox();
    click(source);
    removeAttachmentLightbox();
    await vi.dynamicImportSettled();
    expect(mount).not.toHaveBeenCalled();
  });

  it('closes on navigation and restores stale media markers', async () => {
    const source = image();
    applyAttachmentLightbox();
    click(source);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    vi.stubGlobal('location', new URL('https://github.com/owner/repo/wiki/Home'));
    source.remove();
    applyAttachmentLightbox();
    expect(dispose).toHaveBeenCalledOnce();
    expect(source.hasAttribute('data-geld-lightbox-media')).toBe(false);
  });
});
