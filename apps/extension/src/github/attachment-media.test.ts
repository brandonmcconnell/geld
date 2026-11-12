// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectAttachmentMedia, fitAttachmentMedia, mediaUrl, readAttachmentMedia } from './attachment-media';

beforeEach(() => vi.stubGlobal('location', new URL('https://github.com/owner/repo')));
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

function source(html: string): HTMLImageElement {
  document.body.innerHTML = `<main><article class="markdown-body">${html}</article></main>`;
  const element = document.querySelector('img');
  if (!element) throw new Error('Missing test image');
  return element;
}

describe('GitHub media discovery', () => {
  it('recognizes the WhiteSur README raw source and original blob URL', () => {
    const image = source('<a href="/vinceliuice/WhiteSur-gtk-theme/blob/pictures/pictures/macbook.png"><img src="https://github.com/vinceliuice/WhiteSur-gtk-theme/raw/pictures/pictures/macbook.png" width="1000" height="600"></a>');
    expect(readAttachmentMedia(image)).toMatchObject({ kind: 'image', width: 1000, height: 600,
      src: 'https://github.com/vinceliuice/WhiteSur-gtk-theme/raw/pictures/pictures/macbook.png',
      original: 'https://github.com/vinceliuice/WhiteSur-gtk-theme/blob/pictures/pictures/macbook.png' });
  });

  it.each([
    'https://raw.githubusercontent.com/owner/repo/main/demo.png',
    'https://media.githubusercontent.com/media/owner/repo/main/demo.jpg',
    'https://private-user-images.githubusercontent.com/123/demo.png?jwt=keep-this-token',
    'https://user-images.githubusercontent.com/123/demo.gif',
    'https://example.com/no-file-extension?id=123',
  ])('accepts media sources without a host allowlist: %s', (src) => {
    const image = source(`<img src="${src}">`);
    expect(readAttachmentMedia(image)?.src).toBe(src);
  });

  it('previews proxied images and keeps their canonical original', () => {
    const image = source('<a href="https://example.com/project"><img src="https://camo.githubusercontent.com/hash/encoded" data-canonical-src="https://example.com/screenshot.png"></a>');
    expect(readAttachmentMedia(image)).toMatchObject({ src: 'https://camo.githubusercontent.com/hash/encoded', original: 'https://example.com/screenshot.png' });
  });

  it('uses the selected srcset source, preserving signed URLs', () => {
    const image = source('<picture><img src="https://example.com/small.png" width="300" height="200"></picture>');
    Object.defineProperty(image, 'currentSrc', { value: 'https://example.com/large.png?signature=keep' });
    expect(readAttachmentMedia(image)?.src).toBe('https://example.com/large.png?signature=keep');
  });

  it('collects mixed media once, including video posters and attachment links', () => {
    document.body.innerHTML = '<main class="markdown-body"><a href="https://example.com/demo.webm"><img src="https://example.com/poster.png"></a><video poster="https://example.com/poster2.png"><source src="https://example.com/demo.mp4"></video><a href="https://example.com/other.mov">Recording</a></main>';
    const items = collectAttachmentMedia(document);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.kind)).toEqual(['video', 'video', 'video']);
    expect(items[0]).toMatchObject({ src: 'https://example.com/demo.webm', poster: 'https://example.com/poster.png' });
    expect(items[1]).toMatchObject({ src: 'https://example.com/demo.mp4', poster: 'https://example.com/poster2.png' });
  });

  it('skips GitHub chrome, hidden content, explicit downloads, and the viewer itself', () => {
    document.body.innerHTML = '<main><img src="https://avatars.githubusercontent.com/u/7604295?v=4"><span data-component="Avatar"><img src="https://example.com/person.png"></span><img class="avatar" src="https://example.com/avatar.png"><img class="emoji" src="https://example.com/emoji.png"><div hidden><img src="https://example.com/hidden.png"></div><div data-geld-ui><img src="https://example.com/own.png"></div><a download href="https://example.com/download.png"><img src="https://example.com/download.png"></a></main>';
    expect(collectAttachmentMedia(document)).toEqual([]);
  });

  it('recognizes image file previews outside Markdown without a conversation URL', () => {
    const image = source('<img src="https://example.com/demo.png">');
    image.closest('article')?.classList.remove('markdown-body');
    expect(readAttachmentMedia(image)).not.toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:image/svg+xml,example', 'file:///secret', ''])('rejects unsafe source schemes: %s', (url) => {
    expect(mediaUrl(url)).toBeNull();
  });

  it('recognizes attachment previews in dialogs outside the main content tree', () => {
    document.body.innerHTML = '<div role="dialog"><img src="https://example.com/preview.png"><video src="https://example.com/recording.mp4"></video></div>';
    expect(collectAttachmentMedia(document).map((item) => item.kind)).toEqual(['image', 'video']);
  });

  it('fits without upscaling, with room for gallery controls on small screens', () => {
    expect(fitAttachmentMedia(100, 60, 1600, 1200, false)).toEqual({ width: 100, height: 60 });
    const fit = fitAttachmentMedia(1920, 1080, 390, 844, true);
    expect(fit.width).toBeLessThanOrEqual(358);
    expect(fit.height).toBeLessThanOrEqual(584);
    expect(fit.width / fit.height).toBeCloseTo(1920 / 1080);
  });
});
