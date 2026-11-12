import { browser } from 'wxt/browser';
import { PDF_CLOSE_MESSAGE, pdfSourceOf } from '../../src/github/pdf-links';
import type { PdfSource } from '../../src/github/pdf-links';

const GITHUB = 'https://github.com';
const root = document.getElementById('pdf');
let objectUrl: string | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function message(lines: readonly string[], action?: HTMLElement): void {
  const box = element('div', 'pdf__message');
  for (const line of lines) box.append(element('p', '', line));
  if (action) box.append(action);
  root?.replaceChildren(box);
}

function downloadLink(source: PdfSource): HTMLAnchorElement {
  const link = element('a', 'pdf__link', 'Download it instead');
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

/** GitHub answers a lapsed session with its sign-in page, which must not be shown as a broken PDF. */
async function isPdf(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  return new TextDecoder().decode(head).includes('%PDF-');
}

async function show(source: PdfSource): Promise<void> {
  root?.replaceChildren(element('p', 'pdf__status', 'Loading PDF…'));
  let blob: Blob;
  try {
    const response = await fetch(source.url, { credentials: source.origins.length === 0 ? 'omit' : 'include' });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    blob = await response.blob();
  } catch {
    message(['This PDF could not be loaded.'], downloadLink(source));
    return;
  }
  if (!(await isPdf(blob))) {
    message(['GitHub did not send a PDF. You may need to sign in again.'], downloadLink(source));
    return;
  }
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const frame = element('iframe', 'pdf__frame');
  frame.title = source.name;
  frame.src = objectUrl + new URL(source.url).hash;
  root?.replaceChildren(frame);
}

async function start(): Promise<void> {
  const source = pdfSourceOf(new URLSearchParams(window.location.search).get('src') ?? '', GITHUB);
  if (source === null) {
    message(['This is not a PDF Geld can show.']);
    return;
  }
  document.title = source.name;
  const origins = [...source.origins];
  if (origins.length === 0 || await browser.permissions.contains({ origins })) {
    await show(source);
    return;
  }
  const allow = element('button', 'pdf__button', 'Allow');
  allow.type = 'button';
  allow.addEventListener('click', () => {
    void browser.permissions.request({ origins }).then((granted) => {
      if (granted) void show(source);
      else message(['Geld can only show this PDF with that permission.'], downloadLink(source));
    }, () => message(['Geld could not ask for that permission here.'], downloadLink(source)));
  });
  message([
    'GitHub keeps uploaded files on objects.githubusercontent.com.',
    'Allow Geld to read files there to show PDFs here. It asks once.',
  ], allow);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.parent.postMessage({ type: PDF_CLOSE_MESSAGE }, GITHUB);
});
window.addEventListener('pagehide', () => {
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
});
void start();
