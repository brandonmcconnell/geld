import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** Tags that fetch something when rendered, or could carry markup that does, beyond what a preview needs. */
const FORBID_TAGS = ['style', 'form', 'button', 'textarea', 'select', 'picture', 'source', 'video', 'audio', 'track', 'svg', 'math', 'object', 'embed', 'link', 'meta'];
/** Attributes that fetch something or style the page: `style` can hold a CSS `url()`. */
const FORBID_ATTR = ['style', 'srcset', 'poster', 'background'];

/**
 * The issue body as GitHub will render it, near enough: GitHub-flavoured
 * Markdown with line breaks kept, as in issues, and the raw HTML GitHub allows
 * (`<details>`, `<sub>`) through a sanitizer, so nothing in a draft can run in
 * the extension's page. Rendered here rather than by GitHub's Markdown API so
 * the draft stays on this device until the reader sends it, and for the same
 * reason nothing in it is fetched: an image shows as its words and address.
 */
export function renderIssueMarkdown(markdown: string, imageClass = 'feedback__image'): DocumentFragment {
  const html = marked.parse(markdown, { gfm: true, breaks: true, async: false });
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS, FORBID_ATTR });
  for (const image of fragment.querySelectorAll('img')) {
    const alt = image.getAttribute('alt')?.trim() ?? '';
    const source = image.getAttribute('src')?.trim() ?? '';
    const stand = document.createElement('span');
    stand.className = imageClass;
    stand.textContent = `Image${alt === '' ? '' : `: ${alt}`}${source === '' ? '' : ` (${source})`}`;
    stand.title = 'Images are not loaded in the preview';
    image.replaceWith(stand);
  }
  for (const link of fragment.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
  }
  return fragment;
}
