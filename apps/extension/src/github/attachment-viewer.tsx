import { createRoot } from 'react-dom/client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import * as Lightbox from '@ramka/react/lightbox';
import { useLightboxTriggerContext } from '@ramka/react';
import { fitAttachmentMedia } from './attachment-media';
import { createAttachmentVideo } from './attachment-video';
import type { AttachmentMedia } from './attachment-media';
import { OWN_UI_ATTRIBUTE } from './dom';
import { brandMark } from './review/brand';
import { ICON_CHEVRON_RIGHT, ICON_LINK_EXTERNAL, ICON_X } from './ui/icons';

interface TriggerBridgeProps {
  readonly item: AttachmentMedia;
  readonly 'aria-controls'?: string;
  readonly 'aria-expanded'?: boolean;
}

// Register GitHub's existing nodes with Ramka without moving them into React's tree.
const TriggerBridge = forwardRef<HTMLElement, TriggerBridgeProps>(function TriggerBridge(props, ref) {
  const { item } = props;
  const trigger = item.element.closest('a') ?? (item.video?.nextElementSibling instanceof HTMLButtonElement ? item.video.nextElementSibling : item.element);
  const context = useLightboxTriggerContext();
  useImperativeHandle(ref, () => trigger, [trigger]);
  const imageRef = context?.imageRef;
  const morphRef = context?.morphRef;
  useLayoutEffect(() => {
    imageRef?.(item.image);
    morphRef?.(item.image ?? item.video ?? item.element);
    return () => { imageRef?.(null); morphRef?.(null); };
  }, [item.element, item.image, item.video, imageRef, morphRef]);
  useLayoutEffect(() => {
    const attributes = ['aria-haspopup', 'aria-controls', 'aria-expanded'];
    const previous = attributes.map((name) => [name, trigger.getAttribute(name)] satisfies [string, string | null]);
    trigger.setAttribute('aria-haspopup', 'dialog');
    if (props['aria-controls']) trigger.setAttribute('aria-controls', props['aria-controls']);
    if (props['aria-expanded'] !== undefined) trigger.setAttribute('aria-expanded', String(props['aria-expanded']));
    return () => {
      for (const [name, value] of previous) {
        if (value === null) trigger.removeAttribute(name);
        else trigger.setAttribute(name, value);
      }
    };
  }, [trigger, props['aria-controls'], props['aria-expanded']]);
  return null;
});

function Brand() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(brandMark('geld-lightbox__brand'));
  }, []);
  return <span ref={ref} aria-label="Geld" />;
}

function Icon({ markup }: { readonly markup: string }) {
  return <span className="geld-lightbox__icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}

function isScrimEvent(event: Event): boolean {
  // Navigation can replace a clicked SVG during flushSync, so use the original path.
  return !event.composedPath().some((node) => node instanceof Element
    && node.matches('.geld-lightbox__media, header, footer, button, a, .geld-lightbox__thumbnails'));
}

function pauseVideos(host: HTMLElement): void {
  for (const video of host.querySelectorAll('video')) video.pause();
}

function VideoContent({ item, playing, onSize, onReady, onError }: {
  readonly item: AttachmentMedia;
  readonly playing: boolean;
  readonly onSize: (id: string, width: number, height: number) => void;
  readonly onReady: () => void;
  readonly onError: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSize, onReady, onError });
  callbacks.current = { onSize, onReady, onError };
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const source = item.video ?? document.createElement('video');
    if (!item.video) { source.src = item.src; source.poster = item.poster; }
    const viewer = createAttachmentVideo(source, item.src);
    viewer.stage.style.width = '100%';
    viewer.stage.style.height = '100%';
    viewer.stage.style.position = 'relative';
    host.append(viewer.stage);
    viewer.mount();
    const video = viewer.stage.querySelector('video');
    const metadata = (): void => {
      if (video) callbacks.current.onSize(item.id, video.videoWidth, video.videoHeight);
    };
    const ready = (): void => callbacks.current.onReady();
    const error = (): void => callbacks.current.onError();
    video?.addEventListener('loadedmetadata', metadata);
    video?.addEventListener('loadeddata', ready);
    video?.addEventListener('error', error);
    return () => {
      video?.removeEventListener('loadedmetadata', metadata);
      video?.removeEventListener('loadeddata', ready);
      video?.removeEventListener('error', error);
      viewer.dispose();
      viewer.stage.remove();
    };
  }, [item.id, item.src, item.video, item.poster]);
  useEffect(() => {
    const video = ref.current?.querySelector('video');
    if (!video) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
    return () => video.pause();
  }, [playing]);
  return <div ref={ref} className="geld-lightbox__video" data-ramka-no-pull="" style={{ width: '100%', height: '100%' }}
    onPointerDown={(event) => {
      if (event.target instanceof Element && event.target.closest('.vjs-control-bar, .vjs-big-play-button, .vjs-menu')) event.stopPropagation();
    }} />;
}

function MediaContent({ item, playing, onSize }: {
  readonly item: AttachmentMedia;
  readonly playing: boolean;
  readonly onSize: (id: string, width: number, height: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(item.kind === 'image' && Boolean(item.image?.complete && item.image.naturalWidth));
  const [attempt, setAttempt] = useState(0);
  const onError = (): void => { setFailed(true); setLoaded(true); };
  return <>
    {item.kind === 'image' ? <img
      key={attempt} className="geld-lightbox__image" src={item.src} alt={item.alt}
      width={item.width} height={item.height} decoding="async" draggable={false}
      hidden={failed} onError={onError}
      onLoad={(event) => { setLoaded(true); onSize(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }}
    /> : <VideoContent key={attempt} item={item} playing={playing} onSize={onSize} onReady={() => setLoaded(true)} onError={onError} />}
    {!loaded && !failed && <span className="geld-lightbox__loading" role="status">Loading {item.kind}…</span>}
    {failed && <div className="geld-lightbox__status" role="status">
      <p>This {item.kind} could not be loaded.</p>
      <button type="button" className="geld-lightbox__ghost" onClick={() => { setFailed(false); setLoaded(false); setAttempt(attempt + 1); }}>Try again</button>
      <a className="geld-lightbox__ghost" href={item.original} target="_blank" rel="noopener noreferrer">Open original</a>
    </div>}
  </>;
}

function MediaSlide({ item, index, total, playing, active, fit, zoomRef, onZoom, onSize }: {
  readonly item: AttachmentMedia;
  readonly index: number;
  readonly total: number;
  readonly playing: boolean;
  readonly active: boolean;
  readonly fit: { readonly width: number; readonly height: number };
  readonly zoomRef: Ref<Lightbox.LightboxZoomRef>;
  readonly onZoom: (zoom: number) => void;
  readonly onSize: (id: string, width: number, height: number) => void;
}) {
  return <Lightbox.Slide className="geld-lightbox__slide">
    <Lightbox.Item index={index} caption={item.alt} aria-label={`${index + 1} of ${total}`} aria-roledescription="slide">
      <Lightbox.Zoom ref={zoomRef} className="geld-lightbox__zoom-surface" scrollToZoom={item.kind === 'image'}
        zoomStep={1.25} wheelSensitivity={500} maxZoom={Math.max(4, Math.min(16, item.width / fit.width))}
        onZoomChange={(zoom) => { if (active) onZoom(zoom); }}>
        <Lightbox.Media width={item.width} height={item.height} className="geld-lightbox__media" style={{ width: fit.width }}>
          <MediaContent item={item} playing={active && playing} onSize={onSize} />
        </Lightbox.Media>
      </Lightbox.Zoom>
    </Lightbox.Item>
  </Lightbox.Slide>;
}

function Gallery({ items: initialItems, initialIndex, host, onClosed }: {
  readonly items: readonly AttachmentMedia[];
  readonly initialIndex: number;
  readonly host: HTMLElement;
  readonly onClosed: () => void;
}) {
  const [handle] = useState(() => Lightbox.createHandle());
  const [items, setItems] = useState(initialItems);
  const [index, setIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [fullscreen, setFullscreen] = useState(false);
  const zooms = useRef(new Map<string, Lightbox.LightboxZoomRef>());
  const content = useRef<HTMLDivElement>(null);
  const scrimPress = useRef(false);
  const active = items[index] ?? items[initialIndex];
  const gallery = items.length > 1;
  const onSize = useCallback((id: string, width: number, height: number): void => {
    if (!width || !height) return;
    setItems((current) => current.some((item) => item.id === id && (item.width !== width || item.height !== height))
      ? current.map((item) => item.id === id ? { ...item, width, height } : item) : current);
  }, []);
  useEffect(() => {
    const update = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const onFullscreen = (): void => setFullscreen(document.fullscreenElement === host);
    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => { window.removeEventListener('resize', update); document.removeEventListener('fullscreenchange', onFullscreen); };
  }, [host]);
  useEffect(() => {
    const item = initialItems[initialIndex];
    if (item) {
      item.video?.pause();
      handle.open(initialIndex, { triggerId: item.id });
    }
  }, [handle, initialIndex, initialItems]);
  if (!active) return null;
  const fit = fitAttachmentMedia(active.width, active.height, viewport.width, viewport.height, gallery);
  const style: CSSProperties & { '--geld-media-width': string; '--geld-media-height': string } = {
    '--geld-media-width': `${fit.width}px`, '--geld-media-height': `${fit.height}px`,
  };
  return <Lightbox.Root handle={handle} count={items.length} defaultValue={initialIndex}
    dir={getComputedStyle(active.element).direction === 'rtl' ? 'rtl' : 'ltr'} viewTransition="snappy"
    onValueChange={(value) => { pauseVideos(host); setIndex(value); setZoom(1); }}
    onBeforeClose={() => { pauseVideos(host); setPlaying(false); }}
    onOpenChange={(open) => { if (!open) { pauseVideos(host); setPlaying(false); } }}
    onOpenChangeComplete={(open) => { if (open) setPlaying(true); else onClosed(); }}>
    {items.map((item, i) => <Lightbox.Trigger key={item.id} id={item.id} index={i}
      {...(item.kind === 'video' ? { crossfade: 'close' } : {})}
      render={<TriggerBridge item={item} />} />)}
    <Lightbox.Portal container={host} className="geld-lightbox__portal">
      <Lightbox.Backdrop className="geld-lightbox__backdrop" />
      <Lightbox.Content ref={content} className="geld-lightbox" aria-label="Media viewer" aria-describedby="geld-lightbox-help" style={style}
        onPointerDownCapture={(event) => { scrimPress.current = isScrimEvent(event.nativeEvent); }}
        onClick={(event) => {
          if (scrimPress.current && !event.defaultPrevented && event.target !== event.currentTarget && isScrimEvent(event.nativeEvent)) handle.close();
          scrimPress.current = false;
        }}>
        <p id="geld-lightbox-help" className="geld-sr-only">Arrow keys change media or pan while zoomed. Plus and minus zoom. Zero fits the image. Escape closes. Pinch to zoom, swipe to browse, or pull down to close.</p>
        <Lightbox.Slides className="geld-lightbox__slides" aria-label="GitHub media" aria-roledescription="carousel" preload={1}>
          {items.map((item, i) => <MediaSlide key={item.id} item={item} index={i} total={items.length}
            playing={playing} active={i === index} onZoom={setZoom} onSize={onSize}
            fit={fitAttachmentMedia(item.width, item.height, viewport.width, viewport.height, gallery)}
            zoomRef={(value) => { if (value) zooms.current.set(item.id, value); else zooms.current.delete(item.id); }} />)}
        </Lightbox.Slides>
        <header className="geld-lightbox__header">
          <div className="geld-lightbox__identity"><Brand />{gallery && <Lightbox.Counter className="geld-lightbox__counter" />}</div>
          <div className="geld-lightbox__tools">
            {document.fullscreenEnabled && <button type="button" className="geld-lightbox__ghost" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={() => { if (fullscreen) void document.exitFullscreen().catch(() => undefined); else void host.requestFullscreen().catch(() => undefined); }}>
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>}
            <Lightbox.Close className="geld-lightbox__tool" aria-label="Close media" title="Close (Escape)"><Icon markup={ICON_X} /></Lightbox.Close>
          </div>
        </header>
        {gallery && <>
          <Lightbox.Previous className="geld-lightbox__tool geld-lightbox__previous" aria-label="Previous media"><Icon markup={ICON_CHEVRON_RIGHT} /></Lightbox.Previous>
          <Lightbox.Next className="geld-lightbox__tool geld-lightbox__next" aria-label="Next media"><Icon markup={ICON_CHEVRON_RIGHT} /></Lightbox.Next>
        </>}
        <footer className="geld-lightbox__footer">
          <div className="geld-lightbox__zoom" role="group" aria-label="Media zoom">
            <Lightbox.ZoomOut className="geld-lightbox__tool" aria-label="Zoom out" title="Zoom out (-)">−</Lightbox.ZoomOut>
            <button type="button" className="geld-lightbox__ghost geld-lightbox__reset" aria-label="Reset zoom" title="Fit (0)" onClick={() => zooms.current.get(active.id)?.reset()}>{zoom <= 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
            <Lightbox.ZoomIn className="geld-lightbox__tool" aria-label="Zoom in" title="Zoom in (+)">+</Lightbox.ZoomIn>
          </div>
          <a className="geld-lightbox__ghost geld-lightbox__original" href={active.original} target="_blank" rel="noopener noreferrer">Open original <Icon markup={ICON_LINK_EXTERNAL} /></a>
        </footer>
        <Lightbox.Caption className="geld-lightbox__caption" />
        {zoom > 1 && <div className="geld-lightbox__pan" role="group" aria-label="Pan media">
          {[
            { key: 'ArrowLeft', label: 'Pan left', glyph: '←' },
            { key: 'ArrowUp', label: 'Pan up', glyph: '↑' },
            { key: 'ArrowDown', label: 'Pan down', glyph: '↓' },
            { key: 'ArrowRight', label: 'Pan right', glyph: '→' },
          ].map(({ key, label, glyph }) => <button key={key} type="button" className="geld-lightbox__tool" aria-label={label}
            onClick={() => content.current?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))}>{glyph}</button>)}
        </div>}
        {gallery && <Lightbox.ThumbnailStrip className="geld-lightbox__thumbnails" style={{ position: 'absolute' }}>
          <Lightbox.ThumbnailStripTrack className="geld-lightbox__thumbnail-track" aria-label="Media thumbnails">
            {items.map((item, i) => <Lightbox.Thumbnail key={item.id} index={i} className="geld-lightbox__thumbnail" aria-label={`${i + 1}: ${item.alt || (item.kind === 'video' ? 'Video' : 'Image')}`}>
              {item.kind === 'image' || item.poster ? <img src={item.poster || item.image?.currentSrc || item.src} alt="" loading="lazy" draggable={false} /> : <span aria-hidden="true">▶</span>}
              {item.kind === 'video' && item.poster && <span className="geld-lightbox__play" aria-hidden="true">▶</span>}
            </Lightbox.Thumbnail>)}
          </Lightbox.ThumbnailStripTrack>
        </Lightbox.ThumbnailStrip>}
      </Lightbox.Content>
    </Lightbox.Portal>
  </Lightbox.Root>;
}

export function mountAttachmentViewer(items: readonly AttachmentMedia[], index: number, onClosed: () => void): () => void {
  const previous = document.activeElement;
  const host = document.createElement('div');
  host.setAttribute(OWN_UI_ATTRIBUTE, '');
  host.className = 'geld-lightbox-host';
  document.body.append(host);
  const root = createRoot(host);
  let disposed = false;
  const dispose = (notify: boolean): void => {
    if (disposed) return;
    disposed = true;
    pauseVideos(host);
    if (document.fullscreenElement === host) void document.exitFullscreen().catch(() => undefined);
    root.unmount();
    host.remove();
    if (!notify && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    if (notify) onClosed();
  };
  root.render(<Gallery items={items} initialIndex={index} host={host} onClosed={() => queueMicrotask(() => dispose(true))} />);
  return () => dispose(false);
}
