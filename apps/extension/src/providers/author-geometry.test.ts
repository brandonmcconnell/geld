// @vitest-environment happy-dom
import { readNativeAuthorAvatarGeometry } from './author-geometry';

const observers: NativeResizeObserver[] = [];

class NativeResizeObserver implements ResizeObserver {
  readonly images = new Set<Element>();
  readonly observe = vi.fn((target: Element) => { this.images.add(target); });
  readonly unobserve = vi.fn((target: Element) => { this.images.delete(target); });
  readonly disconnect = vi.fn(() => { this.images.clear(); });
  constructor(private readonly callback: ResizeObserverCallback) { observers.push(this); }
  emit(target: Element, width: number, height: number): void {
    const box = [{ inlineSize: width, blockSize: height }];
    this.callback([{ target, borderBoxSize: box, contentBoxSize: box, devicePixelContentBoxSize: box, contentRect: new DOMRect(0, 0, width, height) }], this);
  }
}

beforeEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', NativeResizeObserver);
  document.body.innerHTML = '<img src="https://example.com/native-avatar.png" class="native-avatar">';
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
});

function image(): HTMLImageElement {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  return image;
}

it('reuses geometry across 200 passes and refreshes once per native class, style, source, or viewport change', () => {
  const avatar = image();
  avatar.style.width = '28px'; avatar.style.height = '28px';
  const rect = vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const styles = vi.spyOn(window, 'getComputedStyle');
  for (let index = 0; index < 200; index += 1) expect(readNativeAuthorAvatarGeometry(avatar)?.width).toBe(28);
  expect(rect).toHaveBeenCalledOnce(); expect(styles).toHaveBeenCalledOnce();
  expect(observers).toHaveLength(1); expect(observers[0]?.observe).toHaveBeenCalledOnce();
  avatar.classList.add('native-new-class');
  readNativeAuthorAvatarGeometry(avatar); readNativeAuthorAvatarGeometry(avatar);
  expect(rect).toHaveBeenCalledTimes(2);
  avatar.style.height = '30px';
  readNativeAuthorAvatarGeometry(avatar); readNativeAuthorAvatarGeometry(avatar);
  expect(rect).toHaveBeenCalledTimes(3);
  avatar.src = 'https://example.com/replaced-avatar.png';
  expect(readNativeAuthorAvatarGeometry(avatar)?.src).toBe(avatar.src);
  readNativeAuthorAvatarGeometry(avatar);
  expect(rect).toHaveBeenCalledTimes(4);
  window.dispatchEvent(new Event('resize'));
  for (let index = 0; index < 200; index += 1) readNativeAuthorAvatarGeometry(avatar);
  expect(rect).toHaveBeenCalledTimes(5); expect(styles).toHaveBeenCalledTimes(5);
  avatar.src = 'http://example.com/unsafe-avatar.png';
  expect(readNativeAuthorAvatarGeometry(avatar)).toBeNull();
  expect(rect).toHaveBeenCalledTimes(5);
});

it('refreshes from actual resize notifications while retaining verified same-source dimensions when compacted', () => {
  const avatar = image();
  const rect = vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 30, 30));
  expect(readNativeAuthorAvatarGeometry(avatar)?.width).toBe(30);
  const observer = observers[0];
  if (observer === undefined) throw new Error('Missing resize observer');
  observer.emit(avatar, 30, 30);
  readNativeAuthorAvatarGeometry(avatar);
  expect(rect).toHaveBeenCalledOnce();
  observer.emit(avatar, 24, 24);
  rect.mockReturnValue(new DOMRect(0, 0, 24, 24));
  expect(readNativeAuthorAvatarGeometry(avatar)?.width).toBe(24);
  expect(rect).toHaveBeenCalledTimes(2);
  observer.emit(avatar, 0, 0);
  rect.mockReturnValue(new DOMRect());
  expect(readNativeAuthorAvatarGeometry(avatar)?.width).toBe(24);
  expect(rect).toHaveBeenCalledTimes(2);
  avatar.src = 'https://example.com/different-person.png';
  expect(readNativeAuthorAvatarGeometry(avatar)).toBeNull();
  avatar.src = 'https://example.com/native-avatar.png';
  expect(readNativeAuthorAvatarGeometry(avatar)).toBeNull();
});

it('caches an initially unmeasured avatar without guessing dimensions, then reads it when native layout becomes measurable', () => {
  const avatar = image();
  const rect = vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  for (let index = 0; index < 200; index += 1) expect(readNativeAuthorAvatarGeometry(avatar)).toBeNull();
  expect(rect).toHaveBeenCalledOnce();
  observers[0]?.emit(avatar, 32, 32);
  rect.mockReturnValue(new DOMRect(0, 0, 32, 32));
  expect(readNativeAuthorAvatarGeometry(avatar)?.width).toBe(32);
  expect(rect).toHaveBeenCalledTimes(2);
});

it('unobserves disconnected native targets and does not give their replacement a cached measurement', async () => {
  const avatar = image();
  vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 30, 30));
  readNativeAuthorAvatarGeometry(avatar);
  const replacement = avatar.cloneNode(true);
  avatar.replaceWith(replacement);
  await vi.waitFor(() => expect(observers[0]?.unobserve).toHaveBeenCalledWith(avatar));
  expect(readNativeAuthorAvatarGeometry(image())).toBeNull();
  expect(readNativeAuthorAvatarGeometry(avatar)).toBeNull();
});

it('uses one observer and listener set per document and disconnects them on pagehide', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const avatar = image();
  const rect = vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 30, 30));
  readNativeAuthorAvatarGeometry(avatar); readNativeAuthorAvatarGeometry(avatar);
  const another = document.createElement('img'); another.src = avatar.src; document.body.append(another);
  readNativeAuthorAvatarGeometry(another);
  expect(observers).toHaveLength(1);
  expect(add.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1);
  expect(add.mock.calls.filter(([name]) => name === 'pagehide')).toHaveLength(1);
  window.dispatchEvent(new Event('pagehide'));
  expect(observers[0]?.disconnect).toHaveBeenCalledOnce();
  expect(remove.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1);
  readNativeAuthorAvatarGeometry(avatar);
  expect(observers).toHaveLength(2);
  expect(rect).toHaveBeenCalledTimes(2);
});
