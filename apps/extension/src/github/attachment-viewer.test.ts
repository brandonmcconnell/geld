// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAttachmentViewer } from './attachment-viewer';

let viewer: ReturnType<typeof createAttachmentViewer>;
let image: HTMLImageElement;
let dialog: HTMLDialogElement;
let notifyResize: (() => void) | undefined;

class TestResizeObserver {
  constructor(private readonly onResize: () => void) {}
  observe(): void { notifyResize = this.onResize; }
  disconnect(): void { notifyResize = undefined; }
}

function sizeStage(width: number, height: number): void {
  Object.defineProperties(viewer.stage, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  notifyResize?.();
}

function button(label: string): HTMLButtonElement {
  const found = viewer.controls.querySelector(`[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error('Missing zoom control');
  return found;
}

function pointer(type: string, x: number, y: number, pointerId = 1): void {
  viewer.stage.dispatchEvent(new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true, button: 0 }));
}

function wheel(deltaY: number): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY, cancelable: true });
  // happy-dom's WheelEvent omits the MouseEvent coordinates inherited in browsers.
  Object.defineProperties(event, { clientX: { value: 580 }, clientY: { value: 370 } });
  return event;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  const source = document.createElement('img');
  source.src = 'https://github.com/user-attachments/assets/example';
  source.alt = 'Screenshot';
  viewer = createAttachmentViewer(source);
  dialog = document.createElement('dialog');
  dialog.append(viewer.stage, viewer.controls);
  document.body.append(dialog);
  const found = viewer.stage.querySelector('img');
  if (!(found instanceof HTMLImageElement)) throw new Error('Missing preview');
  image = found;
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1600 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 900 });
  vi.spyOn(viewer.stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 960, 540));
  sizeStage(960, 540);
  image.dispatchEvent(new Event('load'));
});

afterEach(() => {
  viewer.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('attachment image viewer', () => {
  it('fits from the displayed attachment as soon as the modal is measured', () => {
    viewer.dispose();
    const source = document.createElement('img');
    source.src = 'https://github.com/user-attachments/assets/example';
    Object.defineProperties(source, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } });
    viewer = createAttachmentViewer(source);
    const preview = viewer.stage.querySelector('img');
    sizeStage(960, 540);
    expect(preview?.style.width).toBe('768px');
    expect(preview?.style.height).toBe('432px');
    expect(viewer.stage.querySelector('[role="status"]')?.hasAttribute('hidden')).toBe(true);
    expect(preview?.hidden).toBe(false);
    button('Zoom in').click();
    expect(button('Reset zoom').textContent).toBe('150%');
    preview?.dispatchEvent(new Event('load'));
    expect(preview?.style.height).toBe('432px');
    expect(button('Reset zoom').textContent).toBe('150%');
  });

  it('keeps an uncached preview hidden until its dimensions are known', () => {
    viewer.dispose();
    const source = document.createElement('img');
    source.src = 'https://github.com/user-attachments/assets/loading';
    viewer = createAttachmentViewer(source);
    const preview = viewer.stage.querySelector('img');
    sizeStage(960, 540);
    expect(preview?.hidden).toBe(true);
    expect(viewer.stage.querySelector('[role="status"]')?.hasAttribute('hidden')).toBe(false);
    if (!(preview instanceof HTMLImageElement)) throw new Error('Missing preview');
    Object.defineProperties(preview, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } });
    preview.dispatchEvent(new Event('load'));
    expect(preview.hidden).toBe(false);
    expect(preview.style.width).toBe('768px');
    expect(preview.style.height).toBe('432px');
    expect(viewer.stage.querySelector('[role="status"]')?.hasAttribute('hidden')).toBe(true);
  });

  it('fits large images with room around them and enables zoom after loading', () => {
    expect(image.style.width).toBe('768px');
    expect(image.style.height).toBe('432px');
    expect(button('Zoom in').disabled).toBe(false);
    expect(button('Zoom out').disabled).toBe(true);
    expect(button('Reset zoom').textContent).toBe('Fit');
  });

  it('zooms with buttons and resets both scale and pan', () => {
    button('Zoom in').click();
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1.5)');
    expect(button('Reset zoom').textContent).toBe('150%');
    expect(viewer.stage.hasAttribute('data-zoomed')).toBe(true);
    pointer('pointerdown', 500, 300);
    pointer('pointermove', 580, 350);
    pointer('pointerup', 580, 350);
    expect(image.style.transform).toBe('translate(80px, 50px) scale(1.5)');
    button('Reset zoom').click();
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(viewer.stage.hasAttribute('data-zoomed')).toBe(false);
  });

  it('keeps the clicked point stationary while zooming', () => {
    image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 860, clientY: 370 }));
    expect(image.style.transform).toBe('translate(-280px, 0px) scale(2)');
    expect(dialog.isConnected).toBe(true);
  });

  it('zooms with the wheel, keeps the pointer anchored, and clamps at fit', () => {
    const event = wheel(-50);
    viewer.stage.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(viewer.stage.hasAttribute('data-zoomed')).toBe(true);
    viewer.stage.dispatchEvent(wheel(10000));
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('clamps dragging to the image edges and suppresses the click after a drag', () => {
    button('Zoom in').click();
    pointer('pointerdown', 500, 300);
    pointer('pointermove', 10000, -10000);
    pointer('pointerup', 10000, -10000);
    expect(image.style.transform).toBe('translate(96px, -54px) scale(1.5)');
    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(button('Reset zoom').textContent).toBe('150%');
    expect(viewer.stage.hasAttribute('data-dragging')).toBe(false);
  });

  it('supports pinching to zoom and cancelling the gesture', () => {
    pointer('pointerdown', 480, 370, 1);
    pointer('pointerdown', 680, 370, 2);
    pointer('pointermove', 880, 370, 2);
    expect(button('Reset zoom').textContent).toBe('200%');
    pointer('pointercancel', 880, 370, 2);
    pointer('pointerup', 480, 370, 1);
    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(button('Reset zoom').textContent).toBe('200%');
    expect(viewer.stage.hasAttribute('data-dragging')).toBe(false);
  });

  it('supports keyboard zoom, panning, and fit from anywhere in the dialog', () => {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(image.style.transform).toBe('translate(40px, 0px) scale(1.5)');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('limits maximum zoom and keeps zoom-out available', () => {
    for (let i = 0; i < 12; i += 1) button('Zoom in').click();
    expect(button('Reset zoom').textContent).toBe('400%');
    expect(button('Zoom in').disabled).toBe(true);
    button('Zoom out').click();
    expect(button('Zoom in').disabled).toBe(false);
  });

  it('refits on resize without stretching the image and cleans up its listeners', () => {
    button('Zoom in').click();
    sizeStage(400, 540);
    expect(image.style.width).toBe('320px');
    expect(image.style.height).toBe('180px');
    expect(button('Reset zoom').textContent).toBe('Fit');
    viewer.dispose();
    sizeStage(960, 540);
    expect(image.style.width).toBe('320px');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    expect(button('Reset zoom').textContent).toBe('Fit');
  });

  it('enlarges small images up to twice their original size', () => {
    viewer.dispose();
    const source = document.createElement('img');
    source.src = 'https://github.com/user-attachments/assets/small';
    Object.defineProperties(source, { naturalWidth: { value: 320 }, naturalHeight: { value: 32 } });
    viewer = createAttachmentViewer(source);
    sizeStage(960, 540);
    const preview = viewer.stage.querySelector('img');
    expect(preview?.style.width).toBe('640px');
    expect(preview?.style.height).toBe('64px');
  });

  it('lets a wide image expand into the letterboxed area on zoom', () => {
    sizeStage(960, 600);
    button('Zoom in').click();
    pointer('pointerdown', 500, 300);
    pointer('pointermove', 500, 600);
    expect(image.style.transform).toBe('translate(0px, 24px) scale(1.5)');
  });

  it('shows the error message and disables zoom when the image fails', () => {
    image.dispatchEvent(new Event('error'));
    expect(image.hidden).toBe(true);
    expect(viewer.stage.querySelector('[role="status"]')?.hasAttribute('hidden')).toBe(false);
    sizeStage(1200, 700);
    expect(image.hidden).toBe(true);
    expect(button('Zoom in').disabled).toBe(true);
    expect(button('Reset zoom').disabled).toBe(true);
  });
});
