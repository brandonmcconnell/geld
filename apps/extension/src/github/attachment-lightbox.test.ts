// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAttachmentLightbox, removeAttachmentLightbox } from './attachment-lightbox';
import { blockText } from './review/crawler';

const ATTACHMENT = 'https://github.com/user-attachments/assets/abc-123';

function mount(href = ATTACHMENT, src = ATTACHMENT): HTMLImageElement {
  const body = document.createElement('div');
  body.className = 'markdown-body';
  const link = document.createElement('a');
  link.href = href;
  const image = document.createElement('img');
  image.src = src;
  image.alt = 'Screenshot of the review';
  link.append(image);
  body.append(link);
  document.body.append(body);
  return image;
}

function click(image: HTMLImageElement, options: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  image.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://github.com/owner/repo/issues/42'));
});

afterEach(() => {
  removeAttachmentLightbox();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('attachment lightbox', () => {
  it('closes and restores native links when disabled, and can be enabled again', () => {
    const image = mount();
    applyAttachmentLightbox(true);
    click(image);
    expect(document.querySelector('dialog')?.open).toBe(true);
    applyAttachmentLightbox(false);
    expect(document.querySelector('dialog')).toBeNull();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
    expect(click(image).defaultPrevented).toBe(false);
    applyAttachmentLightbox(true);
    expect(click(image).defaultPrevented).toBe(true);
    expect(document.querySelector('dialog')?.open).toBe(true);
  });

  it.each(['/owner/repo/issues/42', '/owner/repo/pull/42', '/owner/repo/pull/42/files'])('opens an attachment on %s and preserves its original link', (path) => {
    vi.stubGlobal('location', new URL(`https://github.com${path}`));
    const image = mount();
    applyAttachmentLightbox();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(true);
    expect(click(image).defaultPrevented).toBe(true);
    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector('[data-geld-brand]')).toBeNull();
    const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Screenshot of the review');
    expect(dialog?.querySelector('header')?.contains(dialog.querySelector('button[aria-label="Close"]'))).toBe(true);
    expect(dialog?.querySelector('img')?.src).toBe(ATTACHMENT);
    expect(dialog?.querySelector('img')?.alt).toBe(image.alt);
    expect(dialog?.querySelector('a')?.href).toBe(ATTACHMENT);
    expect(dialog?.querySelector('a')?.target).toBe('_blank');
    expect(document.activeElement).toBe(dialog?.querySelector('button'));
  });

  it.each(['image', 'Image', ''])('titles an upload whose alt text is %j as "Image"', (alt) => {
    vi.stubGlobal('location', new URL('https://github.com/owner/repo/issues/42'));
    const image = mount();
    image.alt = alt;
    applyAttachmentLightbox();
    click(image);
    const dialog = document.querySelector('dialog');
    expect(document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Image');
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('preserves native navigation for %o', (options) => {
    const image = mount();
    applyAttachmentLightbox();
    expect(click(image, options).defaultPrevented).toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it.each([
    'https://user-images.githubusercontent.com/123/screenshot.png',
    'https://private-user-images.githubusercontent.com/123/screenshot.png?jwt=example',
    'https://github.com/owner/repo/assets/123/abc',
    'https://github.com/owner/repo/files/123/screenshot.png',
    'https://github.com/owner/repo/blob/main/screenshot.png?raw=true',
  ])('supports older uploads and repository images: %s', (href) => {
    const image = mount(href);
    applyAttachmentLightbox();
    expect(click(image).defaultPrevented).toBe(true);
    expect(document.querySelector('dialog a')?.getAttribute('href')).toBe(href);
  });

  it('leaves linked badges, unrelated links, and images outside markdown alone', () => {
    const badge = mount('https://example.com/build', 'https://img.shields.io/badge/build-passing-green');
    const unrelated = mount('https://example.com', ATTACHMENT);
    const outside = mount();
    outside.closest('div')?.classList.remove('markdown-body');
    const unsafe = mount('javascript:alert(1)');
    applyAttachmentLightbox();
    for (const image of [badge, unrelated, outside, unsafe]) {
      expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
      expect(click(image).defaultPrevented).toBe(false);
    }
    expect(document.querySelector('dialog')).toBeNull();
  });

  it.each([
    'https://raw.githubusercontent.com/owner/repo/commit/pr-screenshots/preview.png',
    'https://raw.githubusercontent.com/owner/repo/refs/heads/main/preview.svg?sanitize=true',
    'https://media.githubusercontent.com/media/owner/repo/main/preview.jpg',
    'https://github.com/owner/repo/raw/refs/heads/main/preview.webp',
  ])('opens repository-hosted PR screenshots: %s', (href) => {
    vi.stubGlobal('location', new URL('https://github.com/owner/repo/pull/42'));
    const image = mount(href, href);
    applyAttachmentLightbox();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(true);
    expect(click(image, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
    expect(click(image).defaultPrevented).toBe(true);
    expect(document.querySelector('dialog')?.open).toBe(true);
    expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(href);
    expect(document.querySelector('dialog a')?.getAttribute('href')).toBe(href);
  });

  it('does not intercept links to non-image repository files', () => {
    const image = mount('https://raw.githubusercontent.com/owner/repo/main/README.md');
    applyAttachmentLightbox();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
    expect(click(image).defaultPrevented).toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('handles comments arriving later and repeated enhancement without duplicate dialogs', () => {
    applyAttachmentLightbox();
    const image = mount();
    applyAttachmentLightbox();
    applyAttachmentLightbox();
    click(image);
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(true);
  });

  it('opens when the attachment link is activated from the keyboard', () => {
    const image = mount();
    applyAttachmentLightbox();
    image.closest('a')?.click();
    expect(document.querySelector('dialog')?.open).toBe(true);
  });

  it.each(['close', 'cancel', 'backdrop'])('dismisses with %s', (action) => {
    const image = mount();
    applyAttachmentLightbox();
    click(image);
    const dialog = document.querySelector('dialog');
    if (action === 'close') dialog?.querySelector('button')?.click();
    if (action === 'cancel') dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
    if (action === 'backdrop') dialog?.click();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('keeps image clicks inside the lightbox open and offers a fallback when loading fails', () => {
    const image = mount();
    applyAttachmentLightbox();
    click(image);
    const preview = document.querySelector('dialog img');
    preview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('dialog')?.open).toBe(true);
    preview?.dispatchEvent(new Event('error'));
    expect(preview?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('could not be loaded');
    expect(document.querySelector('dialog a')?.getAttribute('href')).toBe(ATTACHMENT);
  });

  it('removes the loading message when the image loads', () => {
    const image = mount();
    applyAttachmentLightbox();
    click(image);
    document.querySelector('dialog img')?.dispatchEvent(new Event('load'));
    expect(document.querySelector('[role="status"]')?.hasAttribute('hidden')).toBe(true);
  });

  it('cleans up on navigation and teardown', () => {
    const image = mount();
    applyAttachmentLightbox();
    click(image);
    vi.stubGlobal('location', new URL('https://github.com/owner/repo/pull/43'));
    applyAttachmentLightbox();
    expect(document.querySelector('dialog')).toBeNull();
    click(image);
    removeAttachmentLightbox();
    expect(document.querySelector('dialog')).toBeNull();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
    expect(click(image).defaultPrevented).toBe(false);
    vi.stubGlobal('location', new URL('https://github.com/owner/repo'));
    applyAttachmentLightbox();
    expect(click(image).defaultPrevented).toBe(false);
  });
});

describe('attachment video player', () => {
  function mountVideo(): HTMLVideoElement {
    const markdown = document.createElement('div');
    markdown.className = 'markdown-body';
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'screen-recording.mp4';
    const video = document.createElement('video');
    video.controls = true;
    video.src = ATTACHMENT;
    details.append(summary, video);
    markdown.append(details);
    document.body.append(markdown);
    return video;
  }

  it('adds one player button beside the inline video and returns focus on close', () => {
    const inline = mountVideo();
    applyAttachmentLightbox();
    applyAttachmentLightbox();
    expect(document.querySelectorAll('.geld-lightbox-trigger')).toHaveLength(1);
    const trigger = inline.nextElementSibling;
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Missing video trigger');
    expect(inline.controls).toBe(true);
    trigger.click();
    const dialog = document.querySelector('dialog');
    const video = dialog?.querySelector('video');
    expect(dialog?.open).toBe(true);
    expect(video?.src).toBe(ATTACHMENT);
    expect(dialog?.querySelector('.vjs-control-bar')).not.toBeNull();
    expect(dialog?.querySelector('h1')?.textContent).toBe('screen-recording.mp4');
    expect(dialog?.querySelector('a')?.href).toBe(ATTACHMENT);
    dialog?.querySelector('button[aria-label="Close"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video?.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('restores the playback position and disposes the player when disabled', () => {
    const inline = mountVideo();
    inline.currentTime = 20;
    applyAttachmentLightbox();
    document.querySelector<HTMLButtonElement>('.geld-lightbox-trigger')?.click();
    const video = document.querySelector<HTMLVideoElement>('dialog video');
    if (video === null) throw new Error('Missing player');
    Object.defineProperty(video, 'duration', { value: 25 });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(20);
    video.currentTime = 15;
    applyAttachmentLightbox(false);
    expect(inline.currentTime).toBe(15);
    expect(document.querySelector('dialog')).toBeNull();
    expect(inline.nextElementSibling).toBeNull();
  });

  it('keeps the player button out of the comment text Geld reads', () => {
    const inline = mountVideo();
    applyAttachmentLightbox();
    const body = inline.closest('.markdown-body');
    if (body === null) throw new Error('Missing comment body');
    expect(blockText(body)).toBe('screen-recording.mp4');
  });

  it('removes the player button when the inline video is replaced', () => {
    const inline = mountVideo();
    applyAttachmentLightbox();
    inline.remove();
    const replacement = mountVideo();
    applyAttachmentLightbox();
    expect(document.querySelectorAll('.geld-lightbox-trigger')).toHaveLength(1);
    expect(replacement.nextElementSibling?.textContent).toBe('Open in player');
  });
});
