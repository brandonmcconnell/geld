// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { descriptionUnshortened, hiddenBlocks, isBlankHeading, outlineOf, railsOf, releaseDescription, shortenDescription } from './description';

/** One animation frame. Registered after the click, it runs after the click's own callback in the same frame. */
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
/** Two animation frames: a heading click shows its section in the second. */
const frames = async (): Promise<void> => {
  await frame();
  await frame();
};

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

describe('isBlankHeading', () => {
  it('reads a heading with only whitespace, invisible characters, comments or its anchor as a divider', () => {
    const blocks = blocksOf(
      '<h2>&nbsp;</h2><h1>\u200b</h1><h2><!-- rule --></h2>' +
        '<div class="markdown-heading"><h2 class="heading-element"> </h2><a class="anchor" href="#"><svg class="octicon octicon-link"></svg></a></div>' +
        '<h2><a class="anchor" href="#x"><svg class="octicon octicon-link"></svg></a></h2>',
    );
    expect(blocks.map(isBlankHeading)).toEqual([true, true, true, true, true]);
  });

  it('keeps a heading with words or a picture, and a paragraph is never a heading', () => {
    expect(blocksOf(`${h(2, 'Summary')}<h2><img src="logo.png" alt=""></h2><p> </p>`).map(isBlankHeading)).toEqual([false, false, false]);
  });
});

describe('hiddenBlocks', () => {
  it('hides everything inside a closed section, nested sections included', () => {
    const outline = outlineOf(blocksOf(`${h(2, 'A')}<p>a</p>${h(3, 'B')}<p>b</p>${h(2, 'C')}<p>c</p>`));
    expect([...hiddenBlocks(outline, (heading) => heading.hasSubheadings)]).toEqual([3, 5]);
    expect([...hiddenBlocks(outline, (heading) => heading.index !== 0)].sort()).toEqual([1, 2, 3]);
  });
});

describe('railsOf', () => {
  it('indents each block under its open sections and ends each rail at the section’s last visible block', () => {
    // 0 h2 A, 1 p, 2 h3 B, 3 p, 4 h3 C, 5 p, 6 h2 D, 7 p
    const outline = outlineOf(blocksOf(`${h(2, 'A')}<p>a</p>${h(3, 'B')}<p>b</p>${h(3, 'C')}<p>c</p>${h(2, 'D')}<p>d</p>`));
    const isOpen = (heading: { readonly index: number }): boolean => heading.index !== 4 && heading.index !== 6;
    const hidden = hiddenBlocks(outline, isOpen);
    const rails = railsOf(8, outline, hidden, isOpen);
    expect(rails.get(0)).toEqual({ depth: 0, rails: [{ level: 0, kind: 'own' }] });
    expect(rails.get(2)).toEqual({ depth: 1, rails: [{ level: 0, kind: 'through' }, { level: 1, kind: 'own' }] });
    expect(rails.get(3)).toEqual({ depth: 2, rails: [{ level: 0, kind: 'through' }, { level: 1, kind: 'end' }] });
    // C is closed, so its heading is the last thing A shows.
    expect(rails.get(4)).toEqual({ depth: 1, rails: [{ level: 0, kind: 'end' }] });
    expect(rails.has(5)).toBe(false);
    // A closed heading at the top level has nothing to draw.
    expect(rails.has(6)).toBe(false);
  });
});

describe('shortenDescription', () => {
  // Choices are kept per page, so each test is its own pull request.
  let page = 0;
  beforeEach(() => {
    page += 1;
    history.replaceState(null, '', `/owner/repo/pull/${page}`);
  });
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

  it('opens the first section by default, its innermost subsections still closed, and keeps it closed once the reader closes it', async () => {
    const body = mountDescription(`${h(2, 'Changes')}<p>a</p>${h(3, 'Notes')}<p>b</p>${h(2, 'Testing')}<p>c</p>${h(2, 'Screenshots')}<p>d</p>`);
    shortenDescription(true);
    expect(body.children[0]?.getAttribute('data-geld-desc-heading')).toBe('open');
    const folded = [...body.children].map((block) => block.hasAttribute('data-geld-desc-fold'));
    expect(folded).toEqual([false, false, false, true, false, true, false, true]);
    body.querySelector<HTMLElement>('.markdown-heading h2')?.click();
    await frames();
    expect(body.children[1]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    shortenDescription(true);
    expect(body.children[0]?.getAttribute('data-geld-desc-heading')).toBe('closed');
  });

  it('keeps the first section closed when text comes before it, since that text is the description', () => {
    const body = mountDescription(`<p>intro</p>${h(2, 'Changes')}<p>a</p>${h(2, 'Testing')}<p>b</p>`);
    shortenDescription(true);
    expect(body.children[1]?.getAttribute('data-geld-desc-heading')).toBe('closed');
    expect(body.children[2]?.hasAttribute('data-geld-desc-fold')).toBe(true);
  });

  it('still opens the first section when only an empty heading comes before it', () => {
    const body = mountDescription(`${h(2, 'Title')}${h(2, 'Changes')}<p>a</p>${h(2, 'Testing')}<p>b</p>`);
    shortenDescription(true);
    expect(body.children[1]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[2]?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(body.children[4]?.hasAttribute('data-geld-desc-fold')).toBe(true);
  });

  it('hides a heading used as a divider and folds the section around it as if it were not there', () => {
    const body = mountDescription(`${h(2, 'Summary')}<p>a</p><h2>&nbsp;</h2><p>b</p>${h(2, 'Testing')}<p>c</p>`);
    shortenDescription(true);
    const divider = body.children[2];
    expect(divider?.hasAttribute('data-geld-desc-blank')).toBe(true);
    expect(divider?.hasAttribute('data-geld-desc-heading')).toBe(false);
    expect(divider?.querySelector('.geld-desc-toggle')).toBeNull();
    expect(body.querySelectorAll('.geld-desc-toggle')).toHaveLength(2);
    // Summary is the first section and starts open, through to Testing.
    expect(body.children[0]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(body.children[5]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    shortenDescription(false);
    expect(divider?.hasAttribute('data-geld-desc-blank')).toBe(false);
  });

  it('still opens the first section when a divider comes before it', () => {
    const body = mountDescription(`<h2>&nbsp;</h2>${h(2, 'Changes')}<p>a</p>${h(2, 'Testing')}<p>b</p>`);
    shortenDescription(true);
    expect(body.children[1]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[2]?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('opens a section on a click on its heading, independently of the others, and never cuts a description with headings', async () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
    expect(document.querySelector('.geld-desc-more')).toBeNull();
    body.querySelectorAll<HTMLElement>('.markdown-heading h2')[1]?.click();
    // The chevron turns at once, and the section shows only in the second frame, so the first paints the turn alone.
    expect(body.children[2]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    await frame();
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    await frame();
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(body.children[1]?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
    // A pass after the click keeps what the reader chose.
    shortenDescription(true);
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('folds with hidden="until-found", and opens every section around text find-in-page matched', () => {
    const body = mountDescription(`${h(2, 'A')}<p>a</p>${h(3, 'B')}<p>needle</p>`);
    shortenDescription(true);
    const needle = body.children[3];
    expect(needle?.getAttribute('hidden')).toBe('until-found');
    needle?.removeAttribute('hidden');
    needle?.dispatchEvent(new Event('beforematch'));
    expect(body.children[2]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(needle?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(needle?.hasAttribute('hidden')).toBe(false);
  });

  it('marks a fold findable only where the browser can find until-found text, so elsewhere it stays plain hidden', () => {
    const body = mountDescription(`${h(2, 'A')}<p>a</p>${h(2, 'B')}<p>b</p>`);
    shortenDescription(true);
    expect(body.children[3]?.hasAttribute('data-geld-findable')).toBe('onbeforematch' in document.documentElement);
    shortenDescription(false);
    expect(body.children[3]?.hasAttribute('data-geld-findable')).toBe(false);
  });

  it('keeps what the reader opened when shortening is turned off and on again on the same page', async () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    body.querySelectorAll<HTMLElement>('.markdown-heading h2')[1]?.click();
    await frames();
    shortenDescription(false);
    expect(body.children[3]?.hasAttribute('hidden')).toBe(false);
    shortenDescription(true);
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('leaves no listener behind when a copy retires, so the copy that takes over toggles a heading once', async () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    shortenDescription(false);
    vi.resetModules();
    const successor = await import('./description');
    successor.shortenDescription(true);
    body.querySelectorAll<HTMLElement>('.markdown-heading h2')[1]?.click();
    await frames();
    expect(body.children[2]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(false);
    successor.shortenDescription(false);
  });

  it('shows nothing after shortening is turned off while a section was about to open', async () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>`);
    shortenDescription(true);
    body.querySelector<HTMLElement>('.markdown-heading h2')?.click();
    shortenDescription(false);
    await frames();
    expect(body.hasAttribute('data-geld-desc')).toBe(false);
  });

  it('leaves a click on the heading anchor alone', () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    body.querySelectorAll<HTMLElement>('a.anchor')[1]?.click();
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(true);
  });

  it('says a rendered description is unshortened until it is shortened', () => {
    mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    expect(descriptionUnshortened()).toBe(true);
    shortenDescription(true);
    expect(descriptionUnshortened()).toBe(false);
  });

  it('leaves the description folded when released, so a tab switch never shows it whole, and stops handling it', async () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    releaseDescription();
    expect(body.hasAttribute('data-geld-desc')).toBe(true);
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    expect(body.querySelectorAll('.geld-desc-toggle')).toHaveLength(2);
    body.querySelectorAll<HTMLElement>('.markdown-heading h2')[1]?.click();
    await frames();
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    // Shortening again (back on the conversation) wires the same controls once more.
    shortenDescription(true);
    body.querySelectorAll<HTMLElement>('.markdown-heading h2')[1]?.click();
    await frames();
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('lifts the cut for good on Show full description', () => {
    const body = mountDescription('<p>a long wall of text</p>');
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    document.querySelector<HTMLButtonElement>('.geld-desc-more')?.click();
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
    expect(document.querySelector('.geld-desc-more')).toBeNull();
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
  });

  it('replaces a Show full description button GitHub re-rendered from a copy, which lost its listener', () => {
    const body = mountDescription('<p>a long wall of text</p>');
    shortenDescription(true);
    const original = document.querySelector('.geld-desc-more');
    if (original === null) throw new Error('no button');
    original.replaceWith(original.cloneNode(true));
    shortenDescription(true);
    document.querySelector<HTMLButtonElement>('.geld-desc-more')?.click();
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
  });

  it('lifts the cut when a collapsible part of the description is opened, not on a link', () => {
    const body = mountDescription('<p><a href="#x">a link</a></p><details><summary>More</summary><p>b</p></details>');
    shortenDescription(true);
    body.querySelector('a')?.click();
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    const details = body.querySelector('details');
    if (details === null) throw new Error('no details');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
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
