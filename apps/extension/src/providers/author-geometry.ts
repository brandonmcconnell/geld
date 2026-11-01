export interface NativeAuthorAvatarGeometry {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

interface GeometryState {
  readonly images: Set<HTMLImageElement>;
  observer: ResizeObserver | null;
  removals: MutationObserver | null;
  viewportVersion: number;
}

interface Measurement extends NativeAuthorAvatarGeometry {
  readonly state: GeometryState;
  readonly className: string;
  readonly style: string;
  readonly viewport: number;
  dirty: boolean;
}

const MAX_OBSERVED_IMAGES = 1024;
const documents = new WeakMap<Document, GeometryState>();
const measurements = new WeakMap<HTMLImageElement, Measurement>();

function forget(image: HTMLImageElement): void {
  const previous = measurements.get(image);
  const state = previous?.state ?? documents.get(image.ownerDocument);
  state?.observer?.unobserve(image);
  state?.images.delete(image);
  measurements.delete(image);
}

function verified(measurement: NativeAuthorAvatarGeometry): NativeAuthorAvatarGeometry | null {
  return measurement.width > 0 && measurement.width <= 128 && measurement.height > 0 && measurement.height <= 128
    ? { src: measurement.src, width: measurement.width, height: measurement.height } : null;
}

function stateFor(doc: Document): GeometryState {
  const previous = documents.get(doc);
  if (previous !== undefined) return previous;
  const state: GeometryState = { images: new Set(), observer: null, removals: null, viewportVersion: 0 };
  documents.set(doc, state);
  const view = doc.defaultView;
  if (view === null) return state;
  if (typeof view.ResizeObserver === 'function') state.observer = new view.ResizeObserver((entries) => {
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLImageElement)) continue;
      const image = entry.target;
      if (!image.isConnected) { state.observer?.unobserve(image); state.images.delete(image); measurements.delete(image); continue; }
      const measurement = measurements.get(image);
      const size = entry.borderBoxSize[0];
      const width = size?.inlineSize ?? entry.contentRect.width;
      const height = size?.blockSize ?? entry.contentRect.height;
      if (measurement !== undefined && width > 0 && height > 0 && (width !== measurement.width || height !== measurement.height)) measurement.dirty = true;
    }
  });
  state.removals = new view.MutationObserver((records) => {
    if (!records.some((record) => record.removedNodes.length > 0)) return;
    for (const image of state.images) {
      if (image.isConnected) continue;
      state.observer?.unobserve(image);
      state.images.delete(image);
      measurements.delete(image);
    }
  });
  state.removals.observe(doc, { childList: true, subtree: true });
  const resized = (): void => { state.viewportVersion += 1; };
  const dispose = (): void => {
    state.observer?.disconnect();
    state.removals?.disconnect();
    for (const image of state.images) measurements.delete(image);
    state.images.clear();
    view.removeEventListener('resize', resized);
    view.visualViewport?.removeEventListener('resize', resized);
    documents.delete(doc);
  };
  view.addEventListener('resize', resized);
  view.visualViewport?.addEventListener('resize', resized);
  view.addEventListener('pagehide', dispose, { once: true });
  return state;
}

function track(state: GeometryState, image: HTMLImageElement): void {
  if (state.images.has(image)) return;
  if (state.images.size >= MAX_OBSERVED_IMAGES) {
    const oldest = state.images.values().next().value;
    if (oldest !== undefined) { state.observer?.unobserve(oldest); state.images.delete(oldest); }
  }
  state.images.add(image);
  state.observer?.observe(image, { box: 'border-box' });
}

export function readNativeAuthorAvatarGeometry(image: HTMLImageElement): NativeAuthorAvatarGeometry | null {
  const doc = image.ownerDocument;
  const source = image.getAttribute('src');
  if (!image.isConnected || !source) { forget(image); return null; }
  let src: URL;
  try { src = new URL(source, doc.URL); } catch { forget(image); return null; }
  if (src.protocol !== 'https:' || src.username !== '' || src.password !== '') { forget(image); return null; }
  const cached = measurements.get(image);
  if (cached !== undefined && cached.src !== src.href) forget(image);
  const state = stateFor(doc);
  track(state, image);
  const view = doc.defaultView;
  const className = image.className;
  const style = image.getAttribute('style') ?? '';
  const viewport = state.viewportVersion;
  const previous = measurements.get(image);
  if (previous !== undefined && previous.state === state && previous.src === src.href && previous.className === className && previous.style === style && previous.viewport === viewport && !previous.dirty) return verified(previous);
  const rect = image.getBoundingClientRect();
  const styles = rect.width > 0 && rect.height > 0 ? null : view?.getComputedStyle(image);
  const pixels = (value: string | undefined): number => value !== undefined && /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : 0;
  const width = rect.width || pixels(styles?.width);
  const height = rect.height || pixels(styles?.height);
  const fallback = previous === undefined ? null : verified(previous);
  const size = width === 0 || height === 0 ? fallback ?? { width: 0, height: 0 } : { width, height };
  const measurement: Measurement = { src: src.href, width: size.width, height: size.height, state, className, style, viewport, dirty: false };
  measurements.set(image, measurement);
  return verified(measurement);
}
