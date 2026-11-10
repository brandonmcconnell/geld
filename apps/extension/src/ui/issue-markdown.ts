import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * The issue body as GitHub will render it, near enough: GitHub-flavoured
 * Markdown with line breaks kept, as in issues, and the raw HTML GitHub allows
 * (`<details>`, `<sub>`) through a sanitizer, so nothing in a draft can run in
 * the extension's page. Rendered here rather than by GitHub's Markdown API so
 * the draft stays on this device until the reader sends it.
 */
export function renderIssueMarkdown(markdown: string): DocumentFragment {
  const html = marked.parse(markdown, { gfm: true, breaks: true, async: false });
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'] });
  for (const link of fragment.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
  }
  return fragment;
}
