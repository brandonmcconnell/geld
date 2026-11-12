import { browser } from 'wxt/browser';
import { createElement } from './dom';
import { PDF_CLOSE_MESSAGE, pdfViewerUrl } from './pdf-links';
import type { PdfSource } from './pdf-links';

/** The PDF is read and shown by an extension page in a frame: only the extension may read GitHub's file storage. */
export function createPdfViewer(source: PdfSource, close: () => void): { readonly stage: HTMLElement; readonly dispose: () => void } {
  const frame = createElement('iframe', {
    class: 'geld-lightbox__pdf', title: source.name, src: pdfViewerUrl(browser.runtime.getURL('/pdf-viewer.html'), source),
  });
  const stage = createElement('div', { class: 'geld-lightbox__stage geld-lightbox__stage--large geld-lightbox__stage--pdf' }, [frame]);
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    const data: unknown = event.data;
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === PDF_CLOSE_MESSAGE) close();
  };
  window.addEventListener('message', onMessage);
  return { stage, dispose: () => window.removeEventListener('message', onMessage) };
}
