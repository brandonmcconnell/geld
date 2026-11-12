// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectAttachmentMedia } from './attachment-media';
import { mountAttachmentViewer } from './attachment-viewer';

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', new URL('https://github.com/owner/repo'));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  document.body.innerHTML = '<main class="markdown-body"><a href="https://example.com/first.png"><img src="https://example.com/first.png" alt="First" width="800" height="600"></a><video controls src="https://example.com/second.mp4" width="1280" height="720" aria-label="Demo recording"></video></main>';
});
afterEach(async () => {
  await act(async () => dispose?.());
  dispose = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Ramka media viewer', () => {
  it('keeps gallery navigation open and restores original nodes on disposal', async () => {
    const items = collectAttachmentMedia(document);
    const original = items[0]?.element;
    const parent = original?.parentNode;
    await act(async () => { dispose = mountAttachmentViewer(items, 0, vi.fn()); });
    expect(document.querySelector('[data-ramka-content]')?.getAttribute('aria-label')).toBe('Media viewer');
    expect(document.querySelectorAll('[data-ramka-slide]')).toHaveLength(2);
    expect(document.querySelector('[data-ramka-zoom]')).not.toBeNull();
    expect(document.querySelector('[data-ramka-thumbnail-strip]')).not.toBeNull();
    expect(document.querySelector('.geld-lightbox__original')?.getAttribute('href')).toBe('https://example.com/first.png');
    expect(original?.parentNode).toBe(parent);
    const nextIcon = document.querySelector('[data-ramka-next] svg');
    expect(nextIcon).not.toBeNull();
    await act(async () => {
      nextIcon?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      nextIcon?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    expect(document.querySelector('.geld-lightbox-host')).not.toBeNull();
    expect(document.querySelector('[data-ramka-counter]')?.textContent).toBe('2 / 2');
    await act(async () => dispose?.());
    expect(document.querySelector('.geld-lightbox-host')).toBeNull();
    expect(original?.isConnected).toBe(true);
  });
});
