import { createRoot } from 'react-dom/client';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import * as Lightbox from '@ramka/react/lightbox';
import { useLightboxTriggerContext } from '@ramka/react';
import { OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { ICON_CHEVRON_RIGHT, ICON_DASH, ICON_LINK_EXTERNAL, ICON_PLUS, ICON_X } from './ui/icons';

export interface GalleryImage {
  readonly id: string;
  readonly image: HTMLImageElement;
  readonly link: HTMLAnchorElement;
  readonly title: string;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

function Glyph({ markup, className }: { readonly markup: string; readonly className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(svgFromString(markup));
  }, [markup]);
  return <span ref={ref} className={className ?? 'geld-lightbox__glyph'} aria-hidden="true" />;
}

// GitHub's link stays where it is: Ramka is handed the node to morph from, never a React copy of it.
const TriggerBridge = forwardRef<HTMLElement, { readonly item: GalleryImage }>(function TriggerBridge({ item }, ref) {
  const context = useLightboxTriggerContext();
  useImperativeHandle(ref, () => item.link, [item.link]);
  const imageRef = context?.imageRef;
  const morphRef = context?.morphRef;
  useLayoutEffect(() => {
    imageRef?.(item.image);
    morphRef?.(item.image);
    return () => {
      imageRef?.(null);
      morphRef?.(null);
    };
  }, [item.image, imageRef, morphRef]);
  return null;
});

function naturalSize(image: HTMLImageElement): Size {
  return { width: image.naturalWidth || image.width || 1280, height: image.naturalHeight || image.height || 720 };
}

function Slide({ item, index, total, size, onSize, zoomRef, onZoom }: {
  readonly item: GalleryImage;
  readonly index: number;
  readonly total: number;
  readonly size: Size;
  readonly onSize: (id: string, size: Size) => void;
  readonly zoomRef: (zoom: Lightbox.LightboxZoomRef | null) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const src = item.image.currentSrc || item.image.src;
  return <Lightbox.Slide className="geld-lightbox__slide">
    <Lightbox.Item index={index} aria-roledescription="slide" aria-label={`${index + 1} of ${total}`}>
      {failed
        ? <div className="geld-lightbox__status" role="status">
          <p>This image could not be loaded.</p>
          <button type="button" className="btn btn-sm" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>Try again</button>
        </div>
        : <Lightbox.Zoom ref={zoomRef} className="geld-lightbox__zoom-surface" zoomStep={1.5} scrollToZoom wheelSensitivity={500}
          maxZoom={Math.max(4, Math.min(16, size.width / 320))} onZoomChange={onZoom}>
          <Lightbox.Media width={size.width} height={size.height} className="geld-lightbox__media" style={{ maxWidth: size.width * 2 }}>
            <img key={attempt} className="geld-lightbox__image" src={src} alt={item.image.alt}
              width={size.width} height={size.height} decoding="async" draggable={false}
              onError={() => setFailed(true)}
              onLoad={(event) => onSize(item.id, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
          </Lightbox.Media>
        </Lightbox.Zoom>}
    </Lightbox.Item>
  </Lightbox.Slide>;
}

function Gallery({ items, initialIndex, host, onClosed }: {
  readonly items: readonly GalleryImage[];
  readonly initialIndex: number;
  readonly host: HTMLElement;
  readonly onClosed: () => void;
}) {
  const [handle] = useState(() => Lightbox.createHandle());
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(() => new Map(items.map((item) => [item.id, naturalSize(item.image)])));
  const zooms = useRef(new Map<string, Lightbox.LightboxZoomRef>());
  const active = items[index] ?? items[initialIndex];
  const gallery = items.length > 1;
  useEffect(() => {
    const item = items[initialIndex];
    if (item) handle.open(initialIndex, { triggerId: item.id });
  }, [handle, initialIndex, items]);
  if (!active) return null;
  const onSize = (id: string, size: Size): void => {
    if (!size.width || !size.height) return;
    setSizes((current) => {
      const known = current.get(id);
      if (known?.width === size.width && known.height === size.height) return current;
      return new Map(current).set(id, size);
    });
  };
  const titleId = `geld-lightbox-title-${active.id}`;
  return <Lightbox.Root handle={handle} count={items.length} defaultValue={initialIndex}
    dir={getComputedStyle(active.image).direction === 'rtl' ? 'rtl' : 'ltr'} viewTransition="snappy"
    onValueChange={(value) => { setIndex(value); setZoom(1); }}
    onOpenChangeComplete={(open) => { if (!open) onClosed(); }}>
    {items.map((item, i) => <Lightbox.Trigger key={item.id} id={item.id} index={i} handle={handle} render={<TriggerBridge item={item} />} />)}
    <Lightbox.Portal container={host}>
      <Lightbox.Backdrop className="geld-lightbox__backdrop" />
      {/* A trackpad scroll at 1x counts as Ramka's pull to dismiss, which shrank the card and closed it under the reader. */}
      <Lightbox.Content className="geld-lightbox geld-lightbox--gallery" aria-labelledby={titleId} pullToClose={false}>
        <header className="geld-lightbox__header">
          <h1 className="geld-lightbox__title" id={titleId}>{active.title}</h1>
          {gallery && <Lightbox.Counter className="geld-lightbox__counter">{({ current, total }) => `${current} of ${total}`}</Lightbox.Counter>}
          <Lightbox.Close className="geld-lightbox__close" aria-label="Close" title="Close (Esc)"><Glyph markup={ICON_X} /></Lightbox.Close>
        </header>
        <Lightbox.Stage className="geld-lightbox__body">
          <Lightbox.Slides className="geld-lightbox__slides" aria-label="Images" aria-roledescription="carousel" preload={1}>
            {items.map((item, i) => <Slide key={item.id} item={item} index={i} total={items.length}
              size={sizes.get(item.id) ?? naturalSize(item.image)} onSize={onSize}
              onZoom={(value) => { if (i === index) setZoom(value); }}
              zoomRef={(value) => { if (value) zooms.current.set(item.id, value); else zooms.current.delete(item.id); }} />)}
          </Lightbox.Slides>
          {gallery && <>
            <Lightbox.Previous className="geld-lightbox__nav geld-lightbox__nav--previous" aria-label="Previous image" title="Previous image (←)"><Glyph markup={ICON_CHEVRON_RIGHT} /></Lightbox.Previous>
            <Lightbox.Next className="geld-lightbox__nav geld-lightbox__nav--next" aria-label="Next image" title="Next image (→)"><Glyph markup={ICON_CHEVRON_RIGHT} /></Lightbox.Next>
          </>}
        </Lightbox.Stage>
        <footer className="geld-lightbox__footer">
          <div className="BtnGroup geld-lightbox__zoom" role="group" aria-label={`Image zoom ${Math.round(zoom * 100)}%`}>
            <Lightbox.ZoomOut className="btn btn-sm BtnGroup-item geld-lightbox__tool" aria-label="Zoom out" title="Zoom out (−)"><Glyph markup={ICON_DASH} /></Lightbox.ZoomOut>
            <button type="button" className="btn btn-sm BtnGroup-item geld-lightbox__reset" aria-label="Reset zoom" title="Fit image (0)"
              onClick={() => zooms.current.get(active.id)?.reset()}>{zoom <= 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
            <Lightbox.ZoomIn className="btn btn-sm BtnGroup-item geld-lightbox__tool" aria-label="Zoom in" title="Zoom in (+)"><Glyph markup={ICON_PLUS} /></Lightbox.ZoomIn>
          </div>
          <a className="btn btn-sm geld-lightbox__original" href={active.link.href} target="_blank" rel="noopener noreferrer">
            Open original<Glyph markup={ICON_LINK_EXTERNAL} />
          </a>
        </footer>
      </Lightbox.Content>
    </Lightbox.Portal>
  </Lightbox.Root>;
}

/** Opens the images as one gallery at `index`; the returned function closes it without waiting for its exit. */
export function openAttachmentGallery(items: readonly GalleryImage[], index: number, onClosed: () => void): () => void {
  const trigger = items[index]?.link;
  const host = document.createElement('div');
  host.setAttribute(OWN_UI_ATTRIBUTE, '');
  host.className = 'geld-lightbox-host';
  // A modal dialog (note history) leaves everything outside it inert, so the gallery opens inside it, in the top layer.
  (items[index]?.image.closest('dialog[open]') ?? document.body).append(host);
  if (typeof host.showPopover === 'function') {
    host.popover = 'manual';
    host.showPopover();
  }
  const root = createRoot(host);
  let disposed = false;
  const dispose = (closedByReader: boolean): void => {
    if (disposed) return;
    disposed = true;
    root.unmount();
    host.remove();
    if (closedByReader && trigger?.isConnected) trigger.focus({ preventScroll: true });
    onClosed();
  };
  root.render(<Gallery items={items} initialIndex={index} host={host} onClosed={() => queueMicrotask(() => dispose(true))} />);
  return () => dispose(false);
}
