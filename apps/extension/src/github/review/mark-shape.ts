/**
 * What a service's mark is drawn as. GitHub squares every App's and OAuth
 * App's avatar (`data-square`), but the pictures are not all squares: some are
 * a disc on transparent corners (Codecov's, Lighthouse's), some a glyph on a
 * transparent ground that never reaches the edges (Codex's, Amazon Q's), and
 * some a free shape that touches the edges with clear corners between (Capy's
 * head and ears). The faint ring and the muted fill a square tile wears showed
 * as a square frame around them. Nothing on the page says which, so the
 * picture is read: it is drawn on a canvas (the avatar host answers CORS with
 * `*`) and the middle of each edge is sampled. An edge that is not covered
 * means a cutout. With all four covered, the share covered inside the
 * inscribed circle and outside it decides: a disc fills the one and leaves
 * the other clear, a tile covers its corners, and anything else is a cutout.
 * Whether any pixel is transparent says nothing: a solid tile with
 * anti-aliased or rounded corners (Claude's, cubic's) has some and is still a
 * tile. Eight sample points let Capy's head read round at one size and a tile
 * at another.
 *
 * A cutout is read twice more, for where it overlaps other marks and needs a
 * tile of its own: a solid blob over most of the square whose edge is nearly
 * all one colour has that colour as its `ground` (a picture that falls just
 * short of a tile, filled out to one where it overlaps, so no white shows
 * round it), and any other picture gets the `inset` that keeps its
 * art a tenth of the size clear of the tile's edge. Answers are kept per URL
 * for the page's life, never longer: an App's avatar URL stays the same when
 * its picture changes. Until one is in, the mark wears its square frame.
 */
export type MarkShape = 'round' | 'square' | 'cutout';

/** A cutout's ink when it is near black or near white, the cases that vanish on a ground of the same tone. */
export type MarkInk = 'dark' | 'light';

interface MarkReading {
  readonly shape: MarkShape;
  readonly ink: MarkInk | null;
  /** The colour a cutout's own edge is drawn in (`rgb(r g b)`), when nearly all of it is one. */
  readonly ground: string | null;
  /** The share of the tile's size to pad a cutout's art in by on a tile, 0 when it is clear of the edge already. */
  readonly inset: number;
}

const ATTR_SHAPE = 'data-shape';
const ATTR_INK = 'data-ink';
const ATTR_GROUND = 'data-ground';
const VAR_GROUND = '--geld-mark-ground';
const VAR_INSET = '--geld-mark-inset';
const COVERED_ALPHA = 128;
const VISIBLE_ALPHA = 32;
const DARK_INK = 0.25;
const LIGHT_INK = 0.85;
const INSET_TARGET = 0.1;
const EDGE_BAND = 0.06;
const GROUND_AREA = 0.5;
const GROUND_FILL = 0.7;
const GROUND_SHARE = 0.85;
const GROUND_DISTANCE = 32;
const DISC_INSIDE = 0.98;
const DISC_OUTSIDE = 0.02;
const TILE_CORNERS = 0.6;
const SQUARE: MarkReading = { shape: 'square', ink: null, ground: null, inset: 0 };
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
  if (edges.some((value) => value < COVERED_ALPHA)) return cutoutOf(data, width, height);
  const { inside, outside } = discCoverage(data, width, height);
  if (inside >= DISC_INSIDE && outside <= DISC_OUTSIDE) return { ...SQUARE, shape: 'round' };
  return outside >= TILE_CORNERS ? SQUARE : cutoutOf(data, width, height);
}

/** How much of the inscribed disc (within 0.9 of its radius) and of the corners outside it the picture covers. */
function discCoverage(data: Uint8ClampedArray, width: number, height: number): { inside: number; outside: number } {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const radius = Math.min(width, height) / 2;
  let inside = 0;
  let insideCovered = 0;
  let outside = 0;
  let outsideCovered = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - cx, y - cy) / radius;
      const covered = (data[(y * width + x) * 4 + 3] ?? 0) >= COVERED_ALPHA;
      if (distance < 0.9) {
        inside += 1;
        if (covered) insideCovered += 1;
      } else if (distance > 1) {
        outside += 1;
        if (covered) outsideCovered += 1;
      }
    }
  }
  return { inside: inside === 0 ? 0 : insideCovered / inside, outside: outside === 0 ? 0 : outsideCovered / outside };
}

function cutoutOf(data: Uint8ClampedArray, width: number, height: number): MarkReading {
  const band = Math.max(1, Math.round(Math.min(width, height) * EDGE_BAND));
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  const edge: number[] = [];
  let solid = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3] ?? 0;
      if (alpha >= VISIBLE_ALPHA) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (alpha < COVERED_ALPHA) continue;
      solid += 1;
      if (Math.min(x, y, width - 1 - x, height - 1 - y) >= band) continue;
      edge.push(index);
      count(red, data[index]);
      count(green, data[index + 1]);
      count(blue, data[index + 2]);
    }
  }
  const ink = inkOf(data);
  if (maxX < 0) return { shape: 'cutout', ink, ground: null, inset: 0 };
  const box = (maxX - minX + 1) * (maxY - minY + 1);
  // Only a solid blob over most of the tile has a ground: a glyph's strokes reaching the edge are not one.
  const blob = box >= width * height * GROUND_AREA && solid >= box * GROUND_FILL;
  const ground = blob ? groundOf(data, edge, [red, green, blue]) : null;
  if (ground !== null) return { shape: 'cutout', ink, ground, inset: 0 };
  const margin = Math.min(minX / width, (width - 1 - maxX) / width, minY / height, (height - 1 - maxY) / height);
  // Padding p of the tile leaves art with margin m at p + m(1 - 2p) from the edge; solved for the target.
  const inset = margin >= INSET_TARGET ? 0 : Math.round(((INSET_TARGET - margin) / (1 - 2 * margin)) * 1000) / 1000;
  return { shape: 'cutout', ink, ground: null, inset };
}

function groundOf(data: Uint8ClampedArray, edge: readonly number[], histograms: readonly [Uint32Array, Uint32Array, Uint32Array]): string | null {
  if (edge.length === 0) return null;
  const red = medianOf(histograms[0], edge.length);
  const green = medianOf(histograms[1], edge.length);
  const blue = medianOf(histograms[2], edge.length);
  let near = 0;
  for (const index of edge) {
    const distance = ((data[index] ?? 0) - red) ** 2 + ((data[index + 1] ?? 0) - green) ** 2 + ((data[index + 2] ?? 0) - blue) ** 2;
    if (distance <= GROUND_DISTANCE ** 2) near += 1;
  }
  return near >= edge.length * GROUND_SHARE ? `rgb(${red} ${green} ${blue})` : null;
}

function count(histogram: Uint32Array, value: number | undefined): void {
  const bin = value ?? 0;
  histogram[bin] = (histogram[bin] ?? 0) + 1;
}

function medianOf(histogram: Uint32Array, count: number): number {
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value] ?? 0;
    if (seen * 2 >= count) return value;
  }
  return histogram.length - 1;
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

function wear(img: HTMLElement, reading: MarkReading): void {
  if (reading.shape === 'square') return;
  img.setAttribute(ATTR_SHAPE, reading.shape);
  if (reading.ink !== null) img.setAttribute(ATTR_INK, reading.ink);
  if (reading.ground !== null) {
    img.setAttribute(ATTR_GROUND, '');
    img.style.setProperty(VAR_GROUND, reading.ground);
  }
  if (reading.inset > 0) img.style.setProperty(VAR_INSET, String(reading.inset));
}

/**
 * Gives `img` the shape of its picture: `data-shape="round"` for a disc (or
 * when the page already drew it round), `data-shape="cutout"` (with
 * `data-ink` for near-black or near-white ink, `data-ground` and
 * `--geld-mark-ground` for one whose edge is one colour, `--geld-mark-inset`
 * for one whose art comes near the edge) for a glyph on a transparent
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
      if (mark instanceof HTMLElement && mark.getAttribute('src') === src && !mark.hasAttribute(ATTR_SHAPE)) wear(mark, reading);
    }
  });
}
