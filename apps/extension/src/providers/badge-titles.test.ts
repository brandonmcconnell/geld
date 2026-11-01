// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { firstSentence } from '@geld/review';
import { blockText } from '../github/review/crawler';

describe('native badge title parity with GitHub rendered-body extraction', () => {
  it.each([
    { level: '2', markdown: 'Using a branch name as `rev` makes the `pyproject.toml` entry point at a mutable ref.', html: 'Using a branch name as <code>rev</code> makes the <code>pyproject.toml</code> entry point at a mutable ref.' },
    { level: '1', markdown: '**Missing transitive dependency for git-sourced plugin**', html: '<strong>Missing transitive dependency for git-sourced plugin</strong>' },
  ])('keeps the same concern for the observed P$level note without touching native DOM', ({ level, markdown, html }) => {
    const badge = `<a href="#"><img alt="P${level}" src="https://greptile-static-assets.s3.amazonaws.com/badges/p${level}.svg?v=9" height="20" align="top"></a>`;
    const native = document.createElement('div');native.innerHTML = `<p>${badge} ${html}</p>`;
    const source = native.innerHTML;const image = native.querySelector('img');
    expect(firstSentence(`${badge} ${markdown}`)).toBe(firstSentence(blockText(native)));
    expect(firstSentence(`${badge} ${markdown}`)).toBe(markdown);
    expect(native.innerHTML).toBe(source);expect(native.querySelector('img')).toBe(image);
  });
});
