// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { hiddenBlocks, outlineOf, shortenDescription } from './description';

function blocksOf(html: string): Element[] {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return [...holder.children];
}

/** GitHub's current heading markup wraps each heading with its anchor. */
const h = (level: number, text: string): string =>
  `<div class="markdown-heading"><h${level} class="heading-element">${text}</h${level}><a id="${text.toLowerCase()}" class="anchor" href="#${text.toLowerCase()}"></a></div>`;

describe('outlineOf', () => {
  it('gives each heading the blocks up to the next heading of its level or higher', () => {
    const blocks = blocksOf(`<p>intro</p>${h(2, 'Summary')}<p>a</p>${h(3, 'Details')}<p>b</p><ul><li>c</li></ul>${h(2, 'Testing')}<p>d</p>`);
    expect(outlineOf(blocks)).toEqual([
      { index: 1, level: 2, end: 6, hasSubheadings: true },
      { index: 3, level: 3, end: 6, hasSubheadings: false },
      { index: 6, level: 2, end: 8, hasSubheadings: false },
    ]);
  });

  it('reads bare headings as well as wrapped ones, and skips a heading with nothing under it', () => {
    const blocks = blocksOf('<h2>Empty</h2><h2>Notes</h2><p>a</p>');
    expect(outlineOf(blocks)).toEqual([{ index: 1, level: 2, end: 3, hasSubheadings: false }]);
  });

  it('finds nothing to fold in a description without headings', () => {
    expect(outlineOf(blocksOf('<p>one</p><p>two</p>'))).toEqual([]);
  });
});

describe('hiddenBlocks', () => {
  it('hides everything inside a closed section, nested sections included', () => {
    const outline = outlineOf(blocksOf(`${h(2, 'A')}<p>a</p>${h(3, 'B')}<p>b</p>${h(2, 'C')}<p>c</p>`));
    expect([...hiddenBlocks(outline, (heading) => heading.hasSubheadings)]).toEqual([3, 5]);
    expect([...hiddenBlocks(outline, (heading) => heading.index !== 0)].sort()).toEqual([1, 2, 3]);
  });
});

describe('shortenDescription', () => {
  afterEach(() => {
    shortenDescription(false);
    document.body.innerHTML = '';
  });

  function mountDescription(inner: string): HTMLElement {
    document.body.innerHTML = `<div class="js-comment-container"><div class="js-comment-body markdown-body">${inner}</div></div>`;
    const body = document.querySelector('.js-comment-body');
    if (!(body instanceof HTMLElement)) throw new Error('no body');
    return body;
  }

  it('closes the innermost sections and leaves the outline open', () => {
    const body = mountDescription(`<p>intro</p>${h(2, 'Summary')}<p>a</p>${h(3, 'Details')}<p>b</p>${h(2, 'Testing')}<p>c</p>`);
    shortenDescription(true);
    const folded = [...body.children].map((block) => block.hasAttribute('data-geld-desc-fold'));
    expect(folded).toEqual([false, false, false, false, true, false, true]);
    expect(body.children[1]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[3]?.getAttribute('data-geld-desc-heading')).toBe('closed');
    expect(body.querySelectorAll('.geld-desc-toggle')).toHaveLength(3);
  });

  it('opens a section on a click on its heading, independently of the others, and lifts the cut', () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    body.querySelector<HTMLElement>('.markdown-heading h2')?.click();
    expect(body.children[1]?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
    // A pass after the click keeps what the reader chose.
    shortenDescription(true);
    expect(body.children[1]?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('leaves a click on the heading anchor alone', () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>`);
    shortenDescription(true);
    body.querySelector<HTMLElement>('a.anchor')?.click();
    expect(body.children[1]?.hasAttribute('data-geld-desc-fold')).toBe(true);
  });

  it('puts one control after the body and removes everything when turned off', () => {
    const body = mountDescription('<p>only text</p>');
    shortenDescription(true);
    shortenDescription(true);
    expect(document.querySelectorAll('.geld-desc-more')).toHaveLength(1);
    expect(body.nextElementSibling?.textContent).toBe('Show full description');
    shortenDescription(false);
    expect(document.querySelector('.geld-desc-more, .geld-desc-toggle, [data-geld-desc-cap], [data-geld-desc-fold]')).toBeNull();
  });
});
