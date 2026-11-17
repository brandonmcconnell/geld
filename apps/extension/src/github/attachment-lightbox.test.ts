// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GalleryImage } from './attachment-gallery';
import { applyAttachmentLightbox, removeAttachmentLightbox } from './attachment-lightbox';
import { blockText } from './review/crawler';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://geld${path}` } } }));

interface Opened {
  readonly items: readonly GalleryImage[];
  readonly index: number;
  closed: boolean;
}

const gallery = vi.hoisted((): { opened: Opened[] } => ({ opened: [] }));

vi.mock('./attachment-gallery', () => ({
  openAttachmentGallery: (items: readonly GalleryImage[], index: number, onClosed: () => void): (() => void) => {
    const opened: Opened = { items, index, closed: false };
    gallery.opened.push(opened);
    return () => {
      opened.closed = true;
      onClosed();
    };
  },
}));

const ATTACHMENT = 'https://github.com/user-attachments/assets/abc-123';

function mount(href = ATTACHMENT, src = ATTACHMENT, body?: HTMLElement): HTMLImageElement {
  const markdown = body ?? document.createElement('div');
  markdown.className = 'markdown-body';
  const link = document.createElement('a');
  link.href = href;
  const image = document.createElement('img');
  image.src = src;
  image.alt = 'Screenshot of the review';
  link.append(image);
  markdown.append(link);
  if (!markdown.isConnected) document.body.append(markdown);
  return image;
}

function click(image: HTMLImageElement, options: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  image.dispatchEvent(event);
  return event;
}

function open(): Opened | undefined {
  return gallery.opened.filter((entry) => !entry.closed).at(-1);
}

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://github.com/owner/repo/issues/42'));
});

afterEach(() => {
  removeAttachmentLightbox();
  document.body.replaceChildren();
  gallery.opened.length = 0;
  vi.unstubAllGlobals();
});

describe('attachment lightbox', () => {
  it('closes and restores native links when disabled, and can be enabled again', () => {
    const image = mount();
    applyAttachmentLightbox(true);
    click(image);
    expect(open()).toBeDefined();
    applyAttachmentLightbox(false);
    expect(open()).toBeUndefined();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
    expect(image.closest('a')?.hasAttribute('aria-haspopup')).toBe(false);
    expect(click(image).defaultPrevented).toBe(false);
    applyAttachmentLightbox(true);
    expect(click(image).defaultPrevented).toBe(true);
    expect(open()).toBeDefined();
  });

  it.each([
    '/owner/repo/issues/42', '/owner/repo/pull/42', '/owner/repo/pull/42/files', '/owner/repo',
    '/owner/repo/blob/main/README.md', '/owner/repo/discussions/7', '/orgs/owner/discussions/7',
    '/owner/repo/wiki/Home', '/owner/repo/releases',
  ])('opens an attachment on %s and preserves its original link', (path) => {
    vi.stubGlobal('location', new URL(`https://github.com${path}`));
    const image = mount();
    applyAttachmentLightbox();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(true);
    expect(image.closest('a')?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(click(image).defaultPrevented).toBe(true);
    const item = open()?.items[open()?.index ?? -1];
    expect(item?.image).toBe(image);
    expect(item?.title).toBe('Screenshot of the review');
    expect(item?.link.href).toBe(ATTACHMENT);
  });

  it('opens every image of the clicked body as one gallery, and never another body\'s', () => {
    const body = document.createElement('div');
    const first = mount(ATTACHMENT, ATTACHMENT, body);
    mount('https://example.com/build', 'https://img.shields.io/badge/build-passing-green', body);
    const second = mount('https://github.com/user-attachments/assets/def-456', 'https://github.com/user-attachments/assets/def-456', body);
    mount('https://github.com/user-attachments/assets/other', 'https://github.com/user-attachments/assets/other');
    applyAttachmentLightbox();
    click(second);
    expect(open()?.items.map((item) => item.image)).toEqual([first, second]);
    expect(open()?.index).toBe(1);
    expect(new Set(open()?.items.map((item) => item.id)).size).toBe(2);
  });

  it.each(['image', 'Image', ''])('titles an upload whose alt text is %j as "Image"', (alt) => {
    const image = mount();
    image.alt = alt;
    applyAttachmentLightbox();
    click(image);
    expect(open()?.items[0]?.title).toBe('Image');
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('preserves native navigation for %o', (options) => {
    const image = mount();
    applyAttachmentLightbox();
    expect(click(image, options).defaultPrevented).toBe(false);
    expect(open()).toBeUndefined();
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
    expect(open()?.items[0]?.link.getAttribute('href')).toBe(href);
  });

  it('leaves linked badges, unrelated links, and images outside markdown alone', () => {
    const badge = mount('https://example.com/build', 'https://img.shields.io/badge/build-passing-green');
    const unrelated = mount('https://example.com', ATTACHMENT);
    const outside = mount();
    outside.closest('div')?.classList.remove('markdown-body');
    const unsafe = mount('javascript:alert(1)');
    const pdf = mount('https://github.com/owner/repo/files/123/manual.pdf', 'https://img.shields.io/badge/manual-pdf-blue');
    const upload = mount('https://github.com/user-attachments/files/123/report.zip', 'https://img.shields.io/badge/report-zip-blue');
    applyAttachmentLightbox();
    for (const image of [badge, unrelated, outside, unsafe, upload]) {
      expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
      expect(image.closest('a')?.hasAttribute('aria-haspopup')).toBe(false);
      expect(click(image).defaultPrevented).toBe(false);
    }
    expect(open()).toBeUndefined();
    expect(pdf.hasAttribute('data-geld-lightbox-image')).toBe(false);
    click(pdf);
    expect(document.querySelector('dialog iframe')).not.toBeNull();
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
    expect(open()).toBeUndefined();
    expect(click(image).defaultPrevented).toBe(true);
    expect(open()?.items[0]?.image.getAttribute('src')).toBe(href);
    expect(open()?.items[0]?.link.getAttribute('href')).toBe(href);
  });

  it('opens external images GitHub proxies through camo and links to themselves', () => {
    const camo = 'https://camo.githubusercontent.com/f052ee90/68747470733a2f2f6173736574732e74656d626f2e696f2f612e706e67';
    const image = mount(camo, camo);
    const elsewhere = mount('https://example.com/build', camo);
    const other = mount(`${camo.slice(0, -2)}00`, camo);
    applyAttachmentLightbox();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(true);
    for (const kept of [elsewhere, other]) {
      expect(kept.hasAttribute('data-geld-lightbox-image')).toBe(false);
      expect(click(kept).defaultPrevented).toBe(false);
    }
    expect(click(image).defaultPrevented).toBe(true);
    expect(open()?.items[0]?.link.getAttribute('href')).toBe(camo);
  });

  it('does not intercept links to non-image repository files', () => {
    const image = mount('https://raw.githubusercontent.com/owner/repo/main/README.md');
    applyAttachmentLightbox();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
    expect(click(image).defaultPrevented).toBe(false);
    expect(open()).toBeUndefined();
  });

  it('handles comments arriving later and repeated enhancement without duplicate galleries', () => {
    applyAttachmentLightbox();
    const image = mount();
    applyAttachmentLightbox();
    applyAttachmentLightbox();
    click(image);
    click(image);
    expect(gallery.opened.filter((entry) => !entry.closed)).toHaveLength(1);
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(true);
  });

  it('opens when the attachment link is activated from the keyboard', () => {
    const image = mount();
    applyAttachmentLightbox();
    image.closest('a')?.click();
    expect(open()).toBeDefined();
  });

  it('opens a PDF GitHub would download in the PDF viewer, and leaves GitHub\'s own PDF pages alone', () => {
    const body = document.createElement('div');
    body.className = 'markdown-body';
    const upload = document.createElement('a');
    upload.href = 'https://github.com/user-attachments/files/1/report.pdf';
    upload.textContent = 'report.pdf';
    const blob = document.createElement('a');
    blob.href = 'https://github.com/owner/repo/blob/main/report.pdf';
    body.append(upload, blob);
    document.body.append(body);
    applyAttachmentLightbox();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    upload.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const dialog = document.querySelector('dialog');
    expect(dialog?.querySelector('.geld-lightbox__title')?.textContent).toBe('report.pdf');
    expect(dialog?.querySelector('.geld-lightbox__original')?.textContent).toBe('Download');
    const download = dialog?.querySelector<HTMLAnchorElement>('.geld-lightbox__original');
    expect(download?.getAttribute('href')).toBe(upload.href);
    expect(download?.hasAttribute('target')).toBe(false);
    expect(download?.getAttribute('download')).toBe('report.pdf');
    expect(download?.querySelector('.octicon-download')).not.toBeNull();
    const frame = dialog?.querySelector('iframe');
    const before = new MouseEvent('click', { bubbles: true, cancelable: true });
    download?.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    if (!frame) throw new Error('expected the PDF frame');
    // happy-dom loads no frame, so the frame's window is a stand-in that records what the dialog sends it.
    const post = vi.fn();
    const framed = new EventTarget();
    Object.defineProperty(framed, 'postMessage', { value: post });
    Object.defineProperty(frame, 'contentWindow', { value: framed, configurable: true });
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'geld:pdf-ready' }, source: null }));
    const stray = new MouseEvent('click', { bubbles: true, cancelable: true });
    download?.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(false);
    const ready = new MessageEvent('message', { data: { type: 'geld:pdf-ready' } });
    Object.defineProperty(ready, 'source', { value: framed });
    window.dispatchEvent(ready);
    const after = new MouseEvent('click', { bubbles: true, cancelable: true });
    download?.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: 'geld:pdf-download' }, 'chrome-extension://geld');
    expect(new URL(frame?.getAttribute('src') ?? '').searchParams.get('src')).toBe(upload.href);
    const closing = new MessageEvent('message', { data: { type: 'geld:pdf-close' } });
    Object.defineProperty(closing, 'source', { value: framed });
    window.dispatchEvent(closing);
    expect(document.querySelector('dialog')).toBeNull();
    const native = new MouseEvent('click', { bubbles: true, cancelable: true });
    blob.dispatchEvent(native);
    expect(native.defaultPrevented).toBe(false);
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    upload.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
  });

  it('cleans up on navigation and teardown', () => {
    const image = mount();
    applyAttachmentLightbox();
    click(image);
    vi.stubGlobal('location', new URL('https://github.com/owner/repo/pull/43'));
    applyAttachmentLightbox();
    expect(open()).toBeUndefined();
    click(image);
    removeAttachmentLightbox();
    expect(open()).toBeUndefined();
    expect(image.hasAttribute('data-geld-lightbox-image')).toBe(false);
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
