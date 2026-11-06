import { createElement, svgFromString } from './dom';
import { ICON_DASH, ICON_PLUS } from './ui/icons';

interface Point {
  readonly x: number;
  readonly y: number;
}

const ZOOM_STEP = 1.5;

export function createAttachmentViewer(source: HTMLImageElement): {
  readonly stage: HTMLElement;
  readonly controls: HTMLElement;
  readonly dispose: () => void;
} {
  const status = createElement('p', { class: 'geld-lightbox__status', role: 'status' }, ['Loading image…']);
  const image = createElement('img', {
    class: 'geld-lightbox__image', alt: source.alt, decoding: 'async', draggable: 'false',
  });
  const stage = createElement('div', { class: 'geld-lightbox__stage' }, [image, status]);
  const zoomOut = createElement('button', {
    type: 'button', class: 'btn btn-sm BtnGroup-item geld-lightbox__tool', 'aria-label': 'Zoom out', title: 'Zoom out (−)', disabled: '',
  }, [svgFromString(ICON_DASH)]);
  const reset = createElement('button', {
    type: 'button', class: 'btn btn-sm BtnGroup-item geld-lightbox__reset', 'aria-label': 'Reset zoom', title: 'Fit image (0)', disabled: '',
  }, ['Fit']);
  const zoomIn = createElement('button', {
    type: 'button', class: 'btn btn-sm BtnGroup-item geld-lightbox__tool', 'aria-label': 'Zoom in', title: 'Zoom in (+)', disabled: '',
  }, [svgFromString(ICON_PLUS)]);
  const controls = createElement('div', { class: 'BtnGroup geld-lightbox__zoom', role: 'group', 'aria-label': 'Image zoom' }, [zoomOut, reset, zoomIn]);
  let width = 0;
  let height = 0;
  let scale = 1;
  let pan: Point = { x: 0, y: 0 };
  let start: Point | null = null;
  let suppressClick = false;
  const pointers = new Map<number, Point>();

  const maxScale = (): number => Math.max(4, Math.min(16, image.naturalWidth / width));
  const render = (): void => {
    const limitX = width * (scale - 1) / 2;
    const limitY = height * (scale - 1) / 2;
    pan = { x: Math.max(-limitX, Math.min(limitX, pan.x)), y: Math.max(-limitY, Math.min(limitY, pan.y)) };
    image.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    stage.toggleAttribute('data-zoomed', scale > 1);
    reset.textContent = scale === 1 ? 'Fit' : `${Math.round(scale * 100)}%`;
    controls.setAttribute('aria-label', `Image zoom ${Math.round(scale * 100)}%`);
    zoomOut.disabled = width === 0 || scale === 1;
    reset.disabled = width === 0;
    zoomIn.disabled = width === 0 || scale >= maxScale();
  };
  const zoom = (next: number, at?: Point): void => {
    if (width === 0) return;
    const rect = stage.getBoundingClientRect();
    const anchor = at === undefined ? { x: 0, y: 0 } : { x: at.x - rect.left - width / 2, y: at.y - rect.top - height / 2 };
    const value = Math.max(1, Math.min(maxScale(), next));
    const ratio = value / scale;
    pan = { x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio };
    scale = value;
    render();
  };
  const fit = (): void => {
    const naturalWidth = source.naturalWidth || image.naturalWidth;
    const naturalHeight = source.naturalHeight || image.naturalHeight;
    if (!naturalWidth || !naturalHeight) return;
    const availableWidth = window.innerWidth <= 600 ? window.innerWidth - 32 : Math.min(1120, window.innerWidth * 0.8);
    // 200px leaves room for the dialog's header and footer and its margin from the viewport.
    const availableHeight = Math.min(760, window.innerHeight * 0.72, window.innerHeight - 200);
    const ratio = Math.min(1, Math.max(1, availableWidth) / naturalWidth, Math.max(1, availableHeight) / naturalHeight);
    width = naturalWidth * ratio;
    height = naturalHeight * ratio;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    scale = 1;
    pan = { x: 0, y: 0 };
    render();
  };
  image.addEventListener('load', () => {
    image.hidden = false;
    status.hidden = true;
    if (width === 0) fit();
    else render();
  });
  image.addEventListener('error', () => {
    image.hidden = true;
    status.hidden = false;
    status.textContent = 'This image could not be loaded. Open the original to view it.';
  });
  image.addEventListener('dragstart', (event) => event.preventDefault());
  stage.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (event.target === image || event.target === stage) zoom(scale === 1 ? 2 : 1, { x: event.clientX, y: event.clientY });
  });
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    zoom(scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.0025), { x: event.clientX, y: event.clientY });
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || width === 0) return;
    if (pointers.size === 0) {
      suppressClick = false;
      start = { x: event.clientX, y: event.clientY };
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture?.(event.pointerId);
    stage.toggleAttribute('data-dragging', scale > 1);
  });
  stage.addEventListener('pointermove', (event) => {
    const before = pointers.get(event.pointerId);
    if (before === undefined) return;
    const previous = Array.from(pointers.values());
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    const current = Array.from(pointers.values());
    if (previous[0] !== undefined && previous[1] !== undefined && current[0] !== undefined && current[1] !== undefined) {
      const midpoint = { x: (previous[0].x + previous[1].x) / 2, y: (previous[0].y + previous[1].y) / 2 };
      const distance = Math.hypot(previous[0].x - previous[1].x, previous[0].y - previous[1].y);
      if (distance > 0) zoom(scale * Math.hypot(current[0].x - current[1].x, current[0].y - current[1].y) / distance, midpoint);
      pan = { x: pan.x + (current[0].x + current[1].x) / 2 - midpoint.x, y: pan.y + (current[0].y + current[1].y) / 2 - midpoint.y };
      suppressClick = true;
    } else if (scale > 1) {
      pan = { x: pan.x + point.x - before.x, y: pan.y + point.y - before.y };
    }
    if (start !== null && Math.hypot(point.x - start.x, point.y - start.y) > 4) suppressClick = true;
    render();
  });
  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    stage.toggleAttribute('data-dragging', pointers.size > 0 && scale > 1);
    if (pointers.size === 0) start = null;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', (event) => {
    suppressClick = true;
    release(event);
  });
  stage.addEventListener('lostpointercapture', release);
  zoomOut.addEventListener('click', () => zoom(scale / ZOOM_STEP));
  reset.addEventListener('click', () => zoom(1));
  zoomIn.addEventListener('click', () => zoom(scale * ZOOM_STEP));
  const onKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || width === 0) return;
    if (event.key === '+' || event.key === '=') zoom(scale * ZOOM_STEP);
    else if (event.key === '-') zoom(scale / ZOOM_STEP);
    else if (event.key === '0') zoom(1);
    else if (scale > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      pan = { x: pan.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: pan.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) };
      render();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  controls.addEventListener('keydown', onKey);
  stage.addEventListener('keydown', onKey);
  // The dialog owns focus, including its close button and original link, while the image owns the gestures.
  const onDialogKey = (event: KeyboardEvent): void => {
    if (!event.defaultPrevented && stage.closest('dialog')?.contains(event.target instanceof Node ? event.target : null)) onKey(event);
  };
  document.addEventListener('keydown', onDialogKey);
  window.addEventListener('resize', fit);
  fit();
  status.hidden = width > 0;
  image.hidden = width === 0;
  image.src = source.currentSrc || source.src;
  return {
    stage, controls,
    dispose: () => {
      document.removeEventListener('keydown', onDialogKey);
      window.removeEventListener('resize', fit);
      pointers.clear();
    },
  };
}
