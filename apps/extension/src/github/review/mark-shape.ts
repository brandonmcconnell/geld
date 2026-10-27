/**
 * Whether a service's mark is drawn as a circle. GitHub squares every App's
 * and OAuth App's avatar (`data-square`), but many of those images are a
 * disc on transparent corners (Chromatic's), and a square frame around a
 * disc shows at the corners. Nothing on the page says which, so the picture
 * is read: it is drawn on a canvas (the avatar host answers CORS with `*`)
 * and the pixels a tenth of the way in along each diagonal are sampled -
 * outside an inscribed circle, inside a square or a rounded square of any
 * usual radius. All four transparent means a disc. Answers are kept per URL
 * for the page's life; until one is in, the mark wears its square frame.
 */
export type MarkShape = 'round' | 'square';

const ATTR_SHAPE = 'data-shape';
const shapes = new Map<string, MarkShape>();
const pending = new Map<string, Promise<MarkShape>>();

/** The shape already read for this picture, or null when it has not been (or could not be). */
export function knownMarkShape(src: string): MarkShape | null {
  return shapes.get(src) ?? null;
}

function sampleShape(src: string): Promise<MarkShape> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => resolve('square');
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width < 8 || height < 8) return resolve('square');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return resolve('square');
      try {
        context.drawImage(image, 0, 0);
        const inset = (size: number): number => Math.round(size / 10);
        const x = inset(width);
        const y = inset(height);
        const corners = [
          [x, y],
          [width - 1 - x, y],
          [x, height - 1 - y],
          [width - 1 - x, height - 1 - y],
        ] as const;
        const clear = corners.every(([px, py]) => (context.getImageData(px, py, 1, 1).data[3] ?? 255) < 32);
        resolve(clear ? 'round' : 'square');
      } catch {
        // A tainted canvas (no CORS on this host) cannot be read: the square frame stays.
        resolve('square');
      }
    };
    image.src = src;
  });
}

/**
 * Gives `img` the shape of its picture: `data-shape="round"` when it is a
 * disc (or when the page already drew it round), nothing otherwise. The
 * first time a picture is seen the answer comes later, and is then written
 * on every mark in the document showing that picture, so a panel rebuilt in
 * the meantime is caught up without another pass.
 */
export function shapeMark(img: HTMLElement, src: string, roundOnPage: boolean): void {
  if (roundOnPage || shapes.get(src) === 'round') {
    img.setAttribute(ATTR_SHAPE, 'round');
    return;
  }
  if (shapes.has(src) || pending.has(src)) return;
  const probe = sampleShape(src);
  pending.set(src, probe);
  void probe.then((shape) => {
    pending.delete(src);
    shapes.set(src, shape);
    if (shape !== 'round') return;
    for (const mark of document.querySelectorAll<HTMLElement>(`img.geld-review__bot-icon, img.geld-review__avatar`)) {
      if (mark.getAttribute('src') === src) mark.setAttribute(ATTR_SHAPE, 'round');
    }
  });
}
