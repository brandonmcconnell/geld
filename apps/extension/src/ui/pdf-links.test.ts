import { describe, expect, it } from 'vitest';
import { framedByGitHub, framingHost, pdfSourceOf, pdfViewerUrl, RAW_ORIGINS, UPLOAD_ORIGINS } from './pdf-links';

const GITHUB = 'https://github.com';

describe('pdfSourceOf', () => {
  it.each([
    ['https://github.com/user-attachments/files/34232579/Comptage.charge.CLA.pdf', UPLOAD_ORIGINS],
    ['https://github.com/owner/repo/files/123/manual.pdf', UPLOAD_ORIGINS],
    ['https://github.com/owner/repo/raw/main/docs/manual.pdf', RAW_ORIGINS],
    ['https://github.com/owner/repo/blob/main/docs/manual.pdf?raw=true', RAW_ORIGINS],
  ])('reads a PDF GitHub would download, asking only for the host that serves it: %s', (href, origins) => {
    const source = pdfSourceOf(href, GITHUB);
    expect(source?.url).toBe(href);
    expect(source?.origins).toEqual(origins);
  });

  it('reads a raw.githubusercontent.com PDF, which anyone may read, with no permission to ask', () => {
    const source = pdfSourceOf('https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf', GITHUB);
    expect(source?.name).toBe('tracemonkey.pdf');
    expect(source?.origins).toEqual([]);
  });

  it('names the file from its path, decoded', () => {
    expect(pdfSourceOf('https://github.com/user-attachments/files/1/Plain%20Language%20Report.pdf', GITHUB)?.name).toBe('Plain Language Report.pdf');
  });

  it.each([
    'https://github.com/owner/repo/blob/main/docs/manual.pdf',
    'https://github.com/user-attachments/files/1/report.zip',
    'https://example.com/paper.pdf',
    'http://github.com/user-attachments/files/1/report.pdf',
    'https://github.com/owner/repo/issues/1',
    'javascript:alert(1)//x.pdf',
  ])('leaves alone what GitHub already shows, what is not a PDF and what is not GitHub\'s: %s', (href) => {
    expect(pdfSourceOf(href, GITHUB)).toBeNull();
  });

  it('works only on github.com, the one host the viewer page is exposed to', () => {
    expect(pdfSourceOf('https://ghe.example.com/user-attachments/files/1/report.pdf', 'https://ghe.example.com')).toBeNull();
    expect(pdfSourceOf('https://raw.githubusercontent.com/owner/repo/main/report.pdf', 'https://ghe.example.com')).toBeNull();
  });

  it('keeps a link\'s page or destination in its address', () => {
    expect(pdfSourceOf('https://github.com/user-attachments/files/1/manual.pdf#page=12', GITHUB)?.url).toBe('https://github.com/user-attachments/files/1/manual.pdf#page=12');
  });

  it('hands the viewer page the PDF in its address', () => {
    const source = pdfSourceOf('https://github.com/user-attachments/files/1/a b.pdf', GITHUB);
    if (source === null) throw new Error('expected a PDF');
    const url = new URL(pdfViewerUrl('chrome-extension://geld/pdf-viewer.html', source));
    expect(url.searchParams.get('src')).toBe(source.url);
  });
});

describe('framedByGitHub', () => {
  it('lets github.com frame the viewer, by its ancestors or else its referrer', () => {
    expect(framedByGitHub(true, ['https://github.com'], '')).toBe(true);
    expect(framedByGitHub(true, undefined, 'https://github.com/')).toBe(true);
    expect(framedByGitHub(true, [], 'https://github.com/owner/repo/issues/1')).toBe(true);
  });

  it('refuses any other framer, a page nesting github.com, an unknown framer and an unframed page', () => {
    expect(framedByGitHub(true, ['https://example.com'], 'https://github.com/')).toBe(false);
    expect(framedByGitHub(true, ['https://github.com', 'https://example.com'], '')).toBe(false);
    expect(framedByGitHub(true, undefined, 'https://example.com/')).toBe(false);
    expect(framedByGitHub(true, undefined, '')).toBe(false);
    expect(framedByGitHub(false, ['https://github.com'], 'https://github.com/')).toBe(false);
  });
});

describe('PDFs on GitLab and Bitbucket', () => {
  it.each([
    ['https://gitlab.com/group/sub/project/-/uploads/0123456789abcdef0123456789abcdef/spec.pdf', 'https://gitlab.com'],
    ['https://gitlab.com/-/project/42/uploads/0123456789abcdef0123456789abcdef/spec.pdf', 'https://gitlab.com'],
    ['https://gitlab.com/group/project/-/raw/main/docs/spec.pdf', 'https://gitlab.com'],
    ['https://bitbucket.org/workspace/repo/raw/main/docs/spec.pdf', 'https://bitbucket.org'],
  ])('reads a PDF the host would download, asking for the host itself: %s', (href, host) => {
    const source = pdfSourceOf(href, host);
    expect(source?.name).toBe('spec.pdf');
    expect(source?.origins).toEqual([`${host}/*`]);
  });

  it.each([
    ['https://gitlab.com/group/project/-/blob/main/docs/spec.pdf', 'https://gitlab.com'],
    ['https://github.com/user-attachments/files/1/spec.pdf', 'https://gitlab.com'],
    ['https://bitbucket.org/workspace/repo/src/main/docs/spec.pdf', 'https://bitbucket.org'],
  ])('leaves alone what the host shows itself and links to another host: %s', (href, host) => {
    expect(pdfSourceOf(href, host)).toBeNull();
  });

  it('lets each host frame the viewer only as itself', () => {
    expect(framingHost(true, ['https://gitlab.com'], '')).toBe('https://gitlab.com');
    expect(framingHost(true, undefined, 'https://bitbucket.org/workspace/repo/pull-requests/1')).toBe('https://bitbucket.org');
    expect(framingHost(true, ['https://gitlab.com', 'https://evil.example'], '')).toBeNull();
    expect(framingHost(true, ['https://example.com'], '')).toBeNull();
    expect(framingHost(false, ['https://gitlab.com'], '')).toBeNull();
  });
});
