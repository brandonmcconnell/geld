/** A PDF on GitHub that GitHub hands over as a download rather than showing. */
export interface PdfSource {
  readonly url: string;
  readonly name: string;
  /** Hosts the viewer must be allowed to read from: uploads are served from a storage host that answers no cross-origin read. */
  readonly origins: readonly string[];
}

export const PDF_STORAGE_ORIGINS: readonly string[] = ['https://objects.githubusercontent.com/*', 'https://raw.githubusercontent.com/*'];

const PDF_PATH = /\.pdf$/i;
const GITHUB = 'https://github.com';

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
  // The viewer page is exposed to github.com alone, so nothing is taken over on another host.
  if (pageOrigin !== GITHUB || url.protocol !== 'https:' || !PDF_PATH.test(url.pathname)) return null;
  const source = (origins: readonly string[]): PdfSource => ({ url: url.href, name: fileName(url), origins });
  if (url.hostname === 'raw.githubusercontent.com') return source([]);
  if (url.origin !== GITHUB) return null;
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
/** The page has the PDF in memory, so the dialog's Download can save that copy rather than fetch it again. */
export const PDF_READY_MESSAGE = 'geld:pdf-ready';
export const PDF_DOWNLOAD_MESSAGE = 'geld:pdf-download';

/**
 * Whether the viewer page is framed by github.com, checked before it reads anything with the reader's session:
 * every ancestor where the browser lists them, else the referrer. The manifest's limit is a second guard only.
 */
export function framedByGitHub(framed: boolean, ancestors: readonly string[] | undefined, referrer: string): boolean {
  if (!framed) return false;
  if (ancestors !== undefined && ancestors.length > 0) return ancestors.every((origin) => origin === GITHUB);
  try {
    return referrer !== '' && new URL(referrer).origin === GITHUB;
  } catch {
    return false;
  }
}
