/** A PDF on GitHub that GitHub hands over as a download rather than showing. */
export interface PdfSource {
  readonly url: string;
  readonly name: string;
  /** Hosts the viewer must be allowed to read from: uploads are served from a storage host that answers no cross-origin read. */
  readonly origins: readonly string[];
}

export const PDF_STORAGE_ORIGINS: readonly string[] = ['https://objects.githubusercontent.com/*', 'https://raw.githubusercontent.com/*'];

const PDF_PATH = /\.pdf$/i;

function fileName(url: URL): string {
  const last = url.pathname.split('/').filter((part) => part !== '').at(-1) ?? 'document.pdf';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * The PDF a link leads to, when GitHub would download it: an upload (`user-attachments/files`, an older
 * `owner/repo/files`) or a repository file asked for raw. `blob/…/x.pdf` is left alone, since GitHub shows it.
 */
export function pdfSourceOf(href: string, pageOrigin: string): PdfSource | null {
  let url: URL;
  try {
    url = new URL(href, pageOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PDF_PATH.test(url.pathname)) return null;
  const source = (origins: readonly string[]): PdfSource => ({ url: url.href, name: fileName(url), origins });
  if (url.hostname === 'raw.githubusercontent.com') return source([]);
  if (url.origin !== pageOrigin || url.hostname !== 'github.com') return null;
  if (/^\/(?:user-attachments\/files|[^/]+\/[^/]+\/files)\/\d+\//.test(url.pathname)) return source(PDF_STORAGE_ORIGINS);
  if (/^\/[^/]+\/[^/]+\/raw\//.test(url.pathname)) return source(PDF_STORAGE_ORIGINS);
  if (/^\/[^/]+\/[^/]+\/blob\//.test(url.pathname) && url.searchParams.get('raw') === 'true') return source(PDF_STORAGE_ORIGINS);
  return null;
}

export function pdfViewerUrl(base: string, source: PdfSource): string {
  const url = new URL(base);
  url.searchParams.set('src', source.url);
  return url.href;
}

export const PDF_CLOSE_MESSAGE = 'geld:pdf-close';
