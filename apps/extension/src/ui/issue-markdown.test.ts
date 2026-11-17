// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderIssueMarkdown } from './issue-markdown';

function html(markdown: string): string {
  const host = document.createElement('div');
  host.append(renderIssueMarkdown(markdown));
  return host.innerHTML;
}

describe('renderIssueMarkdown', () => {
  it('renders GitHub-flavoured Markdown with line breaks kept', () => {
    const out = html('It would help to see **test counts**.\nSecond line\n\n- **Geld:** 0.1.3');
    expect(out).toContain('<strong>test counts</strong>');
    expect(out).toContain('<br>');
    expect(out).toContain('<li><strong>Geld:</strong> 0.1.3</li>');
  });

  it('keeps the HTML GitHub allows and renders fenced code inside it', () => {
    const out = html('<details><summary>Diagnostics</summary>\n\n```text\nline <one>\n```\n\n</details>\n\n<sub>Sent from Geld.</sub>');
    expect(out).toContain('<summary>Diagnostics</summary>');
    expect(out).toContain('line &lt;one&gt;');
    expect(out).toContain('<sub>Sent from Geld.</sub>');
  });

  it('loads nothing from the draft: an image shows as its words and address', () => {
    const out = html('![shot](https://example.com/private/a.png)');
    expect(out).not.toContain('<img');
    expect(out).toContain('Image: shot (https://example.com/private/a.png)');
  });

  it('opens links in a new tab', () => {
    expect(html('[docs](https://geld.sh)')).toContain('<a href="https://geld.sh" target="_blank" rel="noreferrer">docs</a>');
  });
});
