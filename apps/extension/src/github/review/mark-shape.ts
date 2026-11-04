/**
 * What a service's mark is drawn as. GitHub squares every App's and OAuth
 * App's avatar (`data-square`), but the pictures are not all squares: some are
 * a disc on transparent corners (Chromatic's, Capy's) and some are a glyph on
 * a transparent ground that never reaches the edges (Codex's, Amazon Q's).
 * The faint ring and the muted fill a square tile wears showed as a square
 * frame around both. Nothing on the page says which, so the picture is read:
 * it is drawn on a canvas (the avatar host answers CORS with `*`) and the
 * middle of each edge and the pixels a tenth of the way in along each
 * diagonal are sampled. An edge that is not covered means a cutout; covered
 * edges with clear diagonals mean a disc; anything else is a tile. Whether
 * any pixel is transparent says nothing: a solid tile with anti-aliased or
 * rounded corners (Claude's, cubic's) has some and is still a tile. Answers
 * are kept per URL for the page's life; until one is in, the mark wears its
 * square frame.
 */
export type MarkShape = 'round' | 'square' | 'cutout';

/** A cutout's ink when it is near black or near white, the cases that vanish on a ground of the same tone. */
export type MarkInk = 'dark' | 'light';

interface MarkReading {
  readonly shape: MarkShape;
  readonly ink: MarkInk | null;
}

const ATTR_SHAPE = 'data-shape';
const ATTR_INK = 'data-ink';
const COVERED_ALPHA = 128;
const DARK_INK = 0.25;
const LIGHT_INK = 0.85;
const SQUARE: MarkReading = { shape: 'square', ink: null };
const readings = new Map<string, MarkReading>();
const pending = new Map<string, Promise<MarkReading>>();

/** The shape already read for this picture, or null when it has not been (or could not be). */
export function knownMarkShape(src: string): MarkShape | null {
  return readings.get(src)?.shape ?? null;
}

/** Reads a picture's pixels (RGBA, row-major) as a mark: exported for tests. */
export function readMark(data: Uint8ClampedArray, width: number, height: number): MarkReading {
  if (width < 8 || height < 8 || data.length < width * height * 4) return SQUARE;
  const alpha = (x: number, y: number): number => data[(y * width + x) * 4 + 3] ?? 255;
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  const edges = [alpha(midX, 1), alpha(midX, height - 2), alpha(1, midY), alpha(width - 2, midY)];
  if (edges.some((value) => value < COVERED_ALPHA)) return { shape: 'cutout', ink: inkOf(data) };
  const x = Math.round(width / 10);
  const y = Math.round(height / 10);
  const diagonals = [alpha(x, y), alpha(width - 1 - x, y), alpha(x, height - 1 - y), alpha(width - 1 - x, height - 1 - y)];
  return diagonals.every((value) => value < 32) ? { shape: 'round', ink: null } : SQUARE;
}

function inkOf(data: Uint8ClampedArray): MarkInk | null {
  let sum = 0;
  let count = 0;
  for (let index = 0; index + 3 < data.length; index += 4) {
    if ((data[index + 3] ?? 0) < COVERED_ALPHA) continue;
    sum += (0.2126 * (data[index] ?? 0) + 0.7152 * (data[index + 1] ?? 0) + 0.0722 * (data[index + 2] ?? 0)) / 255;
    count += 1;
  }
  if (count === 0) return null;
  const luminance = sum / count;
  return luminance < DARK_INK ? 'dark' : luminance > LIGHT_INK ? 'light' : null;
}

function sampleMark(src: string): Promise<MarkReading> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => resolve(SQUARE);
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null || width === 0 || height === 0) return resolve(SQUARE);
      try {
        context.drawImage(image, 0, 0);
        resolve(readMark(context.getImageData(0, 0, width, height).data, width, height));
      } catch {
        // A tainted canvas (no CORS on this host) cannot be read: the square frame stays.
        resolve(SQUARE);
      }
    };
    image.src = src;
  });
}

function wear(img: Element, reading: MarkReading): void {
  if (reading.shape === 'square') return;
  img.setAttribute(ATTR_SHAPE, reading.shape);
  if (reading.ink !== null) img.setAttribute(ATTR_INK, reading.ink);
}

/**
 * Gives `img` the shape of its picture: `data-shape="round"` for a disc (or
 * when the page already drew it round), `data-shape="cutout"` (with
 * `data-ink` for near-black or near-white ink) for a glyph on a transparent
 * ground, nothing for a tile. The first time a picture is seen the answer
 * comes later, and is then written on every mark in the document showing
 * that picture, so a panel rebuilt in the meantime is caught up without
 * another pass.
 */
export function shapeMark(img: HTMLElement, src: string, roundOnPage: boolean): void {
  if (roundOnPage) {
    img.setAttribute(ATTR_SHAPE, 'round');
    return;
  }
  const known = readings.get(src);
  if (known !== undefined) {
    wear(img, known);
    return;
  }
  if (pending.has(src)) return;
  const probe = sampleMark(src);
  pending.set(src, probe);
  void probe.then((reading) => {
    pending.delete(src);
    readings.set(src, reading);
    if (reading.shape === 'square') return;
    for (const mark of document.querySelectorAll('img.geld-review__bot-icon, img.geld-review__avatar, img.geld-review-hovercard__avatar')) {
      if (mark.getAttribute('src') === src && !mark.hasAttribute(ATTR_SHAPE)) wear(mark, reading);
    }
  });
}
