// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
