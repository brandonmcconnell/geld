// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openAttachmentGallery } from './attachment-gallery';
import type { GalleryImage } from './attachment-gallery';

function item(id: string, src: string, title: string): GalleryImage {
  const link = document.createElement('a');
  link.href = src;
  const image = document.createElement('img');
  image.src = src;
  image.alt = title;
  link.append(image);
  document.body.append(link);
  return { id, image, link, title };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 20));
}

// happy-dom rejects a cancelled animation's `finished` promise unhandled, which browsers do not report; Ramka only uses `onfinish`.
const animate = Element.prototype.animate;
beforeAll(() => {
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>): Animation {
    const animation = animate.apply(this, args);
    animation.finished.catch(() => undefined);
    return animation;
  };
});
afterAll(() => {
  Element.prototype.animate = animate;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('attachment gallery', () => {
  it('shows the clicked image in Geld\'s card with its title, place and original link', async () => {
    const items = [item('a', 'https://github.com/user-attachments/assets/a', 'First'), item('b', 'https://github.com/user-attachments/assets/b', 'Second')];
    const dispose = openAttachmentGallery(items, 1, () => undefined);
    await settle();
    const card = document.querySelector('.geld-lightbox--gallery');
    expect(card?.closest('[data-geld-ui]')).not.toBeNull();
    expect(card?.querySelector('.geld-lightbox__title')?.textContent).toBe('Second');
    expect(card?.querySelector('.geld-lightbox__counter')?.textContent).toBe('2 of 2');
    expect(card?.querySelector('.geld-lightbox__original')?.getAttribute('href')).toBe('https://github.com/user-attachments/assets/b');
    expect(card?.querySelectorAll('.geld-lightbox__image')).toHaveLength(2);
    expect(card?.querySelector('[data-ramka-next]')).not.toBeNull();
    dispose();
    expect(document.querySelector('.geld-lightbox-host')).toBeNull();
  });

  it('moves the title, place and original link with the image shown', async () => {
    const items = [item('a', 'https://github.com/user-attachments/assets/a', 'First'), item('b', 'https://github.com/user-attachments/assets/b', 'Second')];
    const dispose = openAttachmentGallery(items, 0, () => undefined);
    await settle();
    const card = (): Element | null => document.querySelector('.geld-lightbox--gallery');
    expect(card()?.querySelector('.geld-lightbox__title')?.textContent).toBe('First');
    expect(card()?.querySelector('[data-ramka-previous]')?.hasAttribute('data-disabled')).toBe(true);
    card()?.querySelector<HTMLButtonElement>('[data-ramka-next]')?.click();
    await settle();
    expect(card()?.querySelector('.geld-lightbox__title')?.textContent).toBe('Second');
    expect(card()?.querySelector('.geld-lightbox__counter')?.textContent).toBe('2 of 2');
    expect(card()?.querySelector('.geld-lightbox__original')?.getAttribute('href')).toBe('https://github.com/user-attachments/assets/b');
    expect(card()?.querySelector('[data-ramka-next]')?.hasAttribute('data-disabled')).toBe(true);
    card()?.querySelector<HTMLButtonElement>('[data-ramka-previous]')?.click();
    await settle();
    expect(card()?.querySelector('.geld-lightbox__title')?.textContent).toBe('First');
    expect(card()?.querySelector('.geld-lightbox__counter')?.textContent).toBe('1 of 2');
    dispose();
  });

  it('zooms in and out from the footer and resets to fit', async () => {
    const dispose = openAttachmentGallery([item('a', 'https://github.com/user-attachments/assets/a', 'Only')], 0, () => undefined);
    await settle();
    const reset = (): HTMLButtonElement | null => document.querySelector('.geld-lightbox__reset');
    const zoom = (): string | null | undefined => document.querySelector('.geld-lightbox__zoom')?.getAttribute('aria-label');
    expect(reset()?.textContent).toBe('Fit');
    const press = async (selector: string, label: string): Promise<void> => {
      document.querySelector<HTMLButtonElement>(selector)?.click();
      await vi.waitFor(() => expect(reset()?.textContent).toBe(label), { timeout: 2000 });
      await settle();
    };
    await press('[data-ramka-zoom-in]', '150%');
    expect(zoom()).toBe('Image zoom 150%');
    await press('[data-ramka-zoom-in]', '225%');
    await press('[data-ramka-zoom-out]', '150%');
    await press('.geld-lightbox__reset', 'Fit');
    dispose();
  });

  it('zooms on a plain scroll, and stays open through it', async () => {
    const dispose = openAttachmentGallery([item('a', 'https://github.com/user-attachments/assets/a', 'Only')], 0, () => undefined);
    await settle();
    const surface = document.querySelector('[data-ramka-zoom]');
    for (let i = 0; i < 10; i++) {
      surface?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await vi.waitFor(() => expect(document.querySelector('.geld-lightbox__reset')?.textContent).not.toBe('Fit'), { timeout: 2000 });
    expect(document.querySelector('.geld-lightbox--gallery')).not.toBeNull();
    dispose();
  });

  it('opens inside a modal dialog holding the image, so the modal never covers it', async () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    const only = item('a', 'https://github.com/user-attachments/assets/a', 'In a dialog');
    dialog.append(only.link);
    const showPopover = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: showPopover, configurable: true });
    const dispose = openAttachmentGallery([only], 0, () => undefined);
    await settle();
    const host = document.querySelector<HTMLElement>('.geld-lightbox-host');
    expect(host?.parentElement).toBe(dialog);
    expect(host?.popover).toBe('manual');
    expect(showPopover).toHaveBeenCalledOnce();
    Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
    dispose();
    expect(dialog.querySelector('.geld-lightbox-host')).toBeNull();
  });

  it('has no counter or arrows for a single image, and offers a retry when it fails to load', async () => {
    const dispose = openAttachmentGallery([item('a', 'https://github.com/user-attachments/assets/a', 'Only')], 0, () => undefined);
    await settle();
    expect(document.querySelector('.geld-lightbox__counter')).toBeNull();
    expect(document.querySelector('[data-ramka-next]')).toBeNull();
    document.querySelector('.geld-lightbox__image')?.dispatchEvent(new Event('error'));
    await settle();
    expect(document.querySelector('.geld-lightbox__status')?.textContent).toContain('could not be loaded');
    dispose();
  });

  it('reports closing and hands focus back to the link when the reader closes it', async () => {
    const items = [item('a', 'https://github.com/user-attachments/assets/a', 'First')];
    const onClosed = vi.fn();
    openAttachmentGallery(items, 0, onClosed);
    await settle();
    document.querySelector<HTMLButtonElement>('.geld-lightbox__close')?.click();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce(), { timeout: 2000 });
    expect(document.querySelector('.geld-lightbox-host')).toBeNull();
    expect(document.activeElement).toBe(items[0]?.link);
  });
});
