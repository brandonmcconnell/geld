import { describe, expect, it } from 'vitest';
import { PDF_STORAGE_ORIGINS, pdfSourceOf, pdfViewerUrl } from './pdf-links';

const GITHUB = 'https://github.com';

describe('pdfSourceOf', () => {
  it.each([
    'https://github.com/user-attachments/files/34232579/Comptage.charge.CLA.pdf',
    'https://github.com/owner/repo/files/123/manual.pdf',
    'https://github.com/owner/repo/raw/main/docs/manual.pdf',
    'https://github.com/owner/repo/blob/main/docs/manual.pdf?raw=true',
  ])('reads a PDF GitHub would download, which needs its storage hosts: %s', (href) => {
    const source = pdfSourceOf(href, GITHUB);
    expect(source?.url).toBe(href);
    expect(source?.origins).toEqual(PDF_STORAGE_ORIGINS);
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
