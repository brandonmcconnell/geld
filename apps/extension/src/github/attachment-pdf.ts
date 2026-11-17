import { browser } from 'wxt/browser';
import { createElement, svgFromString } from './dom';
import { PDF_CLOSE_MESSAGE, PDF_DOWNLOAD_MESSAGE, PDF_READY_MESSAGE, pdfViewerUrl } from './pdf-links';
import type { PdfSource } from './pdf-links';
import { ICON_DOWNLOAD } from './ui/icons';

function messageType(data: unknown): unknown {
  return typeof data === 'object' && data !== null && 'type' in data ? data.type : undefined;
}

/** The PDF is read and shown by an extension page in a frame: only the extension may read GitHub's file storage. */
export function createPdfViewer(source: PdfSource, close: () => void): {
  readonly stage: HTMLElement;
  readonly action: HTMLElement;
  readonly dispose: () => void;
} {
  const src = pdfViewerUrl(browser.runtime.getURL('/pdf-viewer.html'), source);
  // `new URL(…).origin` is "null" for an extension URL wherever the scheme counts as non-special.
  const extensionOrigin = browser.runtime.getURL('/').replace(/\/$/, '');
  const frame = createElement('iframe', { class: 'geld-lightbox__pdf', title: source.name, src });
  const stage = createElement('div', { class: 'geld-lightbox__stage geld-lightbox__stage--large geld-lightbox__stage--pdf' }, [frame]);
  // Until the page has the PDF the link downloads it itself: GitHub serves both kinds as a download, so the tab stays.
  const download = createElement('a', {
    class: 'btn btn-sm geld-lightbox__original', href: source.url, download: source.name,
  }, ['Download', svgFromString(ICON_DOWNLOAD)]);
  let ready = false;
  download.addEventListener('click', (event) => {
    if (!ready || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    frame.contentWindow?.postMessage({ type: PDF_DOWNLOAD_MESSAGE }, extensionOrigin);
  });
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    const type = messageType(event.data);
    if (type === PDF_CLOSE_MESSAGE) close();
    else if (type === PDF_READY_MESSAGE) ready = true;
  };
  window.addEventListener('message', onMessage);
  return { stage, action: download, dispose: () => window.removeEventListener('message', onMessage) };
}
