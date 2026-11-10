import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/markdown';
describe('review markdown', () => {
  it('renders GFM tables, task lists and emphasis without executing supplied HTML', () => {
    const html = renderToStaticMarkup(
      createElement(
        Markdown,
        null,
        '**Review**\n\n- [x] tested\n\n| File | State |\n| --- | --- |\n| a.ts | ready |\n\n<details><summary>Evidence</summary>Safe content</details>\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))',
      ),
    );
    expect(html).toContain('<strong>Review</strong>');
    expect(html).toContain('<table');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });
});
