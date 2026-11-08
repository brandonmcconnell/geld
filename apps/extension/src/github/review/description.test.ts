// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDescriptionFoldHint, descriptionUnshortened, hiddenBlocks, isBlankHeading, outlineOf, railsOf, releaseDescription, rememberDescriptionFold, shortenDescription, stopEarlyDescriptionFold } from './description';

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

  /** The description's own blocks, without "Show full description", which stands inside the body. */
  const authorBlocks = (body: HTMLElement): Element[] => [...body.children].filter((block) => !block.classList.contains('geld-desc-more'));

  it('closes the innermost sections and leaves the outline open', () => {
    const body = mountDescription(`<p>intro</p>${h(2, 'Summary')}<p>a</p>${h(3, 'Details')}<p>b</p>${h(2, 'Testing')}<p>c</p>`);
    shortenDescription(true);
    const folded = authorBlocks(body).map((block) => block.hasAttribute('data-geld-desc-fold'));
    expect(folded).toEqual([false, false, false, false, true, false, true]);
    expect(body.children[1]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[3]?.getAttribute('data-geld-desc-heading')).toBe('closed');
    expect(body.querySelectorAll('.geld-desc-toggle')).toHaveLength(3);
  });

  it('opens the first section by default, its innermost subsections still closed, and keeps it closed once the reader closes it', async () => {
    const body = mountDescription(`${h(2, 'Changes')}<p>a</p>${h(3, 'Notes')}<p>b</p>${h(2, 'Testing')}<p>c</p>${h(2, 'Screenshots')}<p>d</p>`);
    shortenDescription(true);
    expect(body.children[0]?.getAttribute('data-geld-desc-heading')).toBe('open');
    const folded = authorBlocks(body).map((block) => block.hasAttribute('data-geld-desc-fold'));
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

  it('takes the chevron off a heading whose text was edited away', () => {
    const body = mountDescription(`<p>intro</p><h2>Old</h2><p>a</p>${h(2, 'Testing')}<p>b</p>`);
    shortenDescription(true);
    const heading = body.children[1];
    expect(heading?.querySelector('.geld-desc-toggle')).not.toBeNull();
    for (const node of [...(heading?.childNodes ?? [])]) if (node.nodeType === Node.TEXT_NODE) node.textContent = '\u00a0';
    shortenDescription(true);
    expect(heading?.hasAttribute('data-geld-desc-blank')).toBe(true);
    expect(heading?.hasAttribute('data-geld-desc-heading')).toBe(false);
    expect(heading?.querySelector('.geld-desc-toggle')).toBeNull();
  });

  it('keeps a later section open when an earlier heading is edited away', async () => {
    const body = mountDescription(`<p>intro</p><h2>Old</h2><p>a</p>${h(2, 'Testing')}<p>b</p>`);
    shortenDescription(true);
    body.querySelectorAll<HTMLElement>('h2')[1]?.click();
    await frames();
    expect(body.children[3]?.getAttribute('data-geld-desc-heading')).toBe('open');
    const old = body.children[1];
    for (const node of [...(old?.childNodes ?? [])]) if (node.nodeType === Node.TEXT_NODE) node.textContent = '\u00a0';
    shortenDescription(true);
    expect(body.children[3]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[4]?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('opens the section around text find-in-page matched after a divider', () => {
    const body = mountDescription(`<p>intro</p>${h(2, 'A')}<p>a</p><h2>&nbsp;</h2><p>needle</p>${h(2, 'B')}<p>b</p>`);
    shortenDescription(true);
    const needle = body.children[4];
    expect(needle?.hasAttribute('data-geld-desc-fold')).toBe(true);
    needle?.removeAttribute('hidden');
    needle?.dispatchEvent(new Event('beforematch'));
    expect(body.children[1]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(needle?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  /** A description whose author wrote three levels, then CodeRabbit's summary, a Cursor badge row and more text. */
  function mountWithTools(): { body: HTMLElement; blocks: Element[] } {
    const body = mountDescription(
      `${h(1, 'Plan')}<p>a</p>${h(2, 'Steps')}<p>b</p>${h(3, 'Details')}<p>c</p>` +
        `${h(2, 'Summary by CodeRabbit')}<ul><li>Bug fixes</li></ul>` +
        '<div><a href="https://cursor.com/agents/bc-1"><img alt="Open in Web" src="w.png"></a></div><p>after</p>',
    );
    return { body, blocks: [...body.children] };
  }

  const order = (node: Element | undefined | null): string => (node instanceof HTMLElement ? node.style.getPropertyValue('--geld-desc-order') : '');

  it('gathers what tools appended at the foot under Agent notes, one closed heading per tool with its logo', () => {
    const { body, blocks } = mountWithTools();
    const [, , , , , c, coderabbit, list, badges, after] = blocks;
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-agents')).toBe(true);
    const agents = body.querySelector('.geld-desc-agents');
    expect(agents?.tagName).toBe('H2');
    expect(agents?.textContent).toBe('Agent notes');
    // The section heading over them folds nothing.
    expect(agents?.querySelector('.geld-desc-toggle')).toBeNull();
    const headings = [...body.querySelectorAll('.geld-desc-agent')];
    expect(headings.map((heading) => [heading.tagName, heading.textContent, heading.getAttribute('data-geld-desc-heading')])).toEqual([
      ['H3', 'CodeRabbit', 'closed'],
      ['H3', 'Cursor', 'closed'],
    ]);
    expect(headings.every((heading) => heading.querySelector('.geld-desc-toggle') !== null && heading.querySelector('img.geld-desc-agent__logo') !== null)).toBe(true);
    // Each heading stands just before its tool's content, both at the tool's order, after the author's text.
    expect(headings[0]?.nextElementSibling).toBe(coderabbit);
    expect([headings[0], list].map(order)).toEqual(['3', '3']);
    expect([headings[1], badges].map(order)).toEqual(['4', '4']);
    expect(order(after)).toBe('');
    // The tool's own title is the injected heading's to stand for: hidden, with no chevron of its own.
    expect(coderabbit?.hasAttribute('data-geld-desc-agent-hidden')).toBe(true);
    expect(coderabbit?.querySelector('.geld-desc-toggle')).toBeNull();
    expect(list?.hasAttribute('data-geld-desc-fold')).toBe(true);
    expect(badges?.hasAttribute('data-geld-desc-fold')).toBe(true);
    // The author's sections end before the tools: Details folds its own text and nothing after it.
    expect(c?.hasAttribute('data-geld-desc-fold')).toBe(true);
    expect(after?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(after?.hasAttribute('data-geld-desc-depth')).toBe(false);
  });

  it('hides what tools appended while the digest’s Agent notes row shows it, and keeps the author’s text top level', () => {
    const { body, blocks } = mountWithTools();
    const [, , , , , c, coderabbit, list, badges, after] = blocks;
    shortenDescription(true, { toolsAway: true });
    expect(body.hasAttribute('data-geld-desc-tools')).toBe(true);
    expect([coderabbit, list, badges].map((block) => block?.getAttribute('data-geld-desc-tool'))).toEqual(['coderabbit', 'coderabbit', 'cursor-agent']);
    // No Agent notes heading is drawn, and the tool's own heading heads nothing.
    expect(body.querySelector('.geld-desc-agents, .geld-desc-agent')).toBeNull();
    expect(coderabbit?.querySelector('.geld-desc-toggle')).toBeNull();
    expect(coderabbit?.hasAttribute('data-geld-desc-heading')).toBe(false);
    expect(c?.hasAttribute('data-geld-desc-fold')).toBe(true);
    expect(after?.hasAttribute('data-geld-desc-tool')).toBe(false);
    expect(after?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(after?.hasAttribute('data-geld-desc-depth')).toBe(false);
    // The hidden blocks come after it in the DOM, so the author's last block is marked to end the box.
    expect(after?.hasAttribute('data-geld-desc-last')).toBe(true);
    // Without the digest's row, the same description gets its Agent notes again.
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-tools')).toBe(false);
    expect(body.querySelector('[data-geld-desc-tool]')).toBeNull();
    expect(body.querySelectorAll('.geld-desc-agent')).toHaveLength(2);
    shortenDescription(false);
    expect(body.querySelector('[data-geld-desc-tool], .geld-desc-agents')).toBeNull();
  });

  it('opens a tool’s content under its heading, as a section opens', async () => {
    const { body, blocks } = mountWithTools();
    const list = blocks[7];
    shortenDescription(true);
    body.querySelector<HTMLElement>('.geld-desc-agent')?.click();
    await frames();
    expect(body.querySelector('.geld-desc-agent')?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(list?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(list?.hasAttribute('data-geld-desc-depth')).toBe(true);
    // A pass after the click keeps it open.
    shortenDescription(true);
    expect(list?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('gives a tool that wrote in two places one heading, holding both', () => {
    // As on fleetdm/fleet#57633, whose description renders CodeRabbit's heading twice.
    const body = mountDescription(`<p>mine</p>${h(2, 'Summary by CodeRabbit')}${h(2, 'Summary by CodeRabbit')}<ul><li>Breaking changes</li></ul>`);
    shortenDescription(true);
    expect([...body.querySelectorAll('.geld-desc-agent')].map((heading) => heading.textContent)).toEqual(['CodeRabbit']);
    expect(body.querySelectorAll('[data-geld-desc-agent-hidden]')).toHaveLength(2);
    expect(body.querySelector('ul')?.hasAttribute('data-geld-desc-fold')).toBe(true);
  });

  it('puts the description back as GitHub rendered it when turned off', () => {
    const { body, blocks } = mountWithTools();
    shortenDescription(true);
    shortenDescription(false);
    expect([...body.children]).toEqual(blocks);
    expect(body.querySelector('[data-geld-desc-agent], [data-geld-desc-agent-hidden]')).toBeNull();
    expect(body.hasAttribute('data-geld-desc-agents')).toBe(false);
    expect(blocks.map(order).every((value) => value === '')).toBe(true);
  });

  it('adds nothing for a description without tools', () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>`);
    shortenDescription(true);
    expect(body.querySelector('.geld-desc-agents, .geld-desc-agent')).toBeNull();
    expect(body.hasAttribute('data-geld-desc-agents')).toBe(false);
  });

  /** Lays `blocks` out at the given heights from the body's top, as a real page would; happy-dom lays out nothing. */
  function layOut(body: HTMLElement, heights: ReadonlyMap<Element, number>): void {
    Object.defineProperty(body, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, 0, 600, 0) });
    let top = 0;
    for (const [block, height] of heights) {
      const start = top;
      Object.defineProperty(block, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, start, 600, height) });
      top += height;
    }
  }

  it('trades places on screen between GitHub’s reactions row and the agents’ summaries, and ends the box 16px under them', async () => {
    document.body.innerHTML =
      '<div class="js-comment-container"><div class="js-comment">' +
      `<div class="js-comment-body markdown-body"><p>mine</p>${h(2, 'Summary by CodeRabbit')}<ul><li>Bug fixes</li></ul></div>` +
      '<div class="pr-review-reactions"><button>👍 1</button></div></div></div>';
    const body = document.querySelector<HTMLElement>('.js-comment-body');
    const box = document.querySelector('.js-comment');
    const row = document.querySelector<HTMLElement>('.pr-review-reactions');
    if (body === null || box === null || row === null) throw new Error('no comment');
    shortenDescription(true);
    const band = body.querySelector('.geld-desc-agents');
    if (band === null) throw new Error('no band');
    // The agents start at 100, the row stands at 300 (26 tall) and the box's edge is at 342.
    const place = (element: Element, top: number, height: number): void => {
      Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, top, 600, height) });
      Object.defineProperty(element, 'getClientRects', { configurable: true, value: () => [new DOMRect(0, top, 600, height)] });
    };
    place(band, 100, 24);
    place(row, 300, 26);
    place(box, 0, 342);
    body.querySelector<HTMLElement>('.geld-desc-agent')?.click();
    await frames();
    await frame();
    expect(row.hasAttribute('data-geld-desc-lifted')).toBe(true);
    expect(row.style.getPropertyValue('--geld-desc-lift')).toBe('-200px');
    expect(body.style.getPropertyValue('--geld-desc-drop')).toBe('42px');
    // The last block shown is the agents' last: the box ends the body's own padding below it.
    expect(body.querySelectorAll('[data-geld-desc-last]')).toHaveLength(1);
    expect(body.querySelector('[data-geld-desc-last]')?.tagName).toBe('UL');
    shortenDescription(false);
    expect(row.hasAttribute('data-geld-desc-lifted')).toBe(false);
    expect(row.style.getPropertyValue('--geld-desc-lift')).toBe('');
    expect(body.style.getPropertyValue('--geld-desc-drop')).toBe('');
    expect(body.querySelector('[data-geld-desc-last]')).toBeNull();
  });

  it('draws the rails of the block the cut runs through above Show full description, which that block’s clip would hide', async () => {
    const body = mountDescription(`${h(2, 'Summary')}<p>a</p><ul><li>one</li><li>two</li></ul><p>after</p>${h(2, 'Summary by CodeRabbit')}<ul><li>x</li></ul>`);
    const [heading, a, list, after] = [...body.children];
    if (heading === undefined || a === undefined || !(list instanceof HTMLElement) || after === undefined) throw new Error('no blocks');
    layOut(body, new Map([[heading, 40], [a, 100], [list, 600], [after, 50]]));
    shortenDescription(true);
    // Opening an agent's section measures again and keeps the cut (happy-dom runs no ResizeObserver).
    body.querySelector<HTMLElement>('.geld-desc-agent')?.click();
    await frames();
    await frame();
    expect(list.hasAttribute('data-geld-desc-cut-edge')).toBe(true);
    expect(list.style.getPropertyValue('--geld-desc-rails')).not.toBe('');
    const more = body.querySelector<HTMLElement>(':scope > .geld-desc-more');
    expect(more?.hasAttribute('data-geld-desc-carry')).toBe(true);
    expect(more?.style.getPropertyValue('--geld-desc-rails')).toBe(list.style.getPropertyValue('--geld-desc-rails'));
    expect(more?.style.getPropertyValue('--geld-desc-rail-pos')).toBe(list.style.getPropertyValue('--geld-desc-rail-pos'));
    // From the list's top to the cut (500 - 140), then through the clipped block's fixed 16px margin to the button.
    expect(more?.style.getPropertyValue('--geld-desc-carry-height')).toBe('376px');
    more?.click();
    expect(body.querySelector('[data-geld-desc-carry]')).toBeNull();
  });

  it('cuts only the author’s text at 500px, the agents’ summaries below it untouched, and opening an agent keeps the cut', async () => {
    const body = mountDescription(
      `<p>one</p><p>two</p><p>three</p>${h(2, 'Summary by CodeRabbit')}<ul><li>Bug fixes</li></ul>`,
    );
    const [one, two, three, title, list] = [...body.children];
    if (one === undefined || two === undefined || three === undefined || list === undefined) throw new Error('no blocks');
    layOut(body, new Map([[one, 300], [two, 400], [three, 200]]));
    shortenDescription(true);
    // Opening an agent's section measures the body again, and does not lift the cut.
    body.querySelector<HTMLElement>('.geld-desc-agent')?.click();
    await frames();
    await frame();
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    expect(body.hasAttribute('data-geld-desc-long')).toBe(true);
    expect(one.hasAttribute('data-geld-desc-cut-edge') || one.hasAttribute('data-geld-desc-cut')).toBe(false);
    expect(two.hasAttribute('data-geld-desc-cut-edge')).toBe(true);
    expect(two instanceof HTMLElement ? two.style.getPropertyValue('--geld-desc-cut-height') : '').toBe('200px');
    expect(three.hasAttribute('data-geld-desc-cut')).toBe(true);
    expect(three.getAttribute('hidden')).toBe('until-found');
    expect([title, list].some((block) => block?.hasAttribute('data-geld-desc-cut') === true)).toBe(false);
    expect(list.hasAttribute('data-geld-desc-fold')).toBe(false);
    // Show full description, inside the body, lifts it.
    const more = body.querySelector<HTMLButtonElement>(':scope > .geld-desc-more');
    expect(more).not.toBeNull();
    more?.click();
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
    expect(body.querySelector('[data-geld-desc-cut], [data-geld-desc-cut-edge]')).toBeNull();
    expect(three.hasAttribute('hidden')).toBe(false);
  });

  it('keeps the cut when a `<details>` in an agent’s summary opens', () => {
    const body = mountDescription(
      `<p>mine</p><details open=""><summary>Greptile Summary</summary><p>s</p></details>` +
        '<p><sub>Reviews (1): <a href="https://app.greptile.com/api/retrigger?id=1">Re-trigger Greptile</a></sub></p>',
    );
    shortenDescription(true);
    const details = body.querySelector('details');
    if (details === null) throw new Error('no details');
    expect(details.hasAttribute('data-geld-desc-agent')).toBe(true);
    details.dispatchEvent(new Event('toggle'));
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
  });

  it('keeps an agent’s section closed when nothing of the author’s comes before it', () => {
    // As on MetaMask/snaps-directory#575, whose description is Bugbot's note alone.
    const body = mountDescription(
      '<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title">Note</p><p><strong>Low Risk</strong><br>Metadata only.</p>' +
        '<p><sup>Written by <a href="https://cursor.com/dashboard?tab=bugbot">Cursor Bugbot</a> for commit <tt>3c2c48b</tt>.</sup></p></div>',
    );
    shortenDescription(true);
    const heading = body.querySelector('.geld-desc-agent');
    expect(heading?.textContent).toBe('Cursor Bugbot · Low Risk');
    expect(heading?.getAttribute('data-geld-desc-heading')).toBe('closed');
    expect(body.querySelector('.markdown-alert')?.hasAttribute('data-geld-desc-fold')).toBe(true);
  });

  it('hides a rule (`---`, `<hr>`) as it hides a blank heading, and leaves it out of the outline', () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p><hr>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    const rule = body.querySelector('hr');
    expect(rule?.hasAttribute('data-geld-desc-blank')).toBe(true);
    // The rule is no section's content: One folds its own text only.
    expect(rule?.hasAttribute('data-geld-desc-fold')).toBe(false);
    expect(rule?.hasAttribute('data-geld-desc-depth')).toBe(false);
    shortenDescription(false);
    expect(rule?.hasAttribute('data-geld-desc-blank')).toBe(false);
  });

  it('still opens the first section when a divider comes before it', () => {
    const body = mountDescription(`<h2>&nbsp;</h2>${h(2, 'Changes')}<p>a</p>${h(2, 'Testing')}<p>b</p>`);
    shortenDescription(true);
    expect(body.children[1]?.getAttribute('data-geld-desc-heading')).toBe('open');
    expect(body.children[2]?.hasAttribute('data-geld-desc-fold')).toBe(false);
  });

  it('opens a section on a click on its heading, independently of the others, and lifts the cut for good', async () => {
    const body = mountDescription(`${h(2, 'One')}<p>a</p>${h(2, 'Two')}<p>b</p>`);
    shortenDescription(true);
    // A description with headings is cut too, while it is still too tall once folded (the stylesheet's `-long`).
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    expect(document.querySelector('.geld-desc-more')).not.toBeNull();
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
    expect(document.querySelector('.geld-desc-more')).toBeNull();
    // A pass after the click keeps what the reader chose, and closing the section again does not bring the cut back.
    shortenDescription(true);
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(false);
    body.querySelectorAll<HTMLElement>('.markdown-heading h2')[1]?.click();
    await frames();
    expect(body.children[3]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
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

  it('measures an image GitHub left unwrapped by the picture, not its link’s line, so the cut runs through it at 500px', async () => {
    // GitHub's own rendering of a bare `<img>` between paragraphs: the link stands straight in the body.
    const body = mountDescription(
      '<p><strong>Reviewer note</strong></p>' +
        '<a target="_blank" href="https://github.com/user-attachments/assets/1"><img width="718" height="670" alt="" src="https://github.com/user-attachments/assets/1" style="max-width: 100%; height: auto"></a>' +
        `<p>Adds the field.</p><p>Flow looks like:</p>${h(2, 'Summary by CodeRabbit')}<ul><li>Bug fixes</li></ul>`,
    );
    const [note, link, adds, flow] = [...body.children];
    const image = link?.querySelector('img');
    if (note === undefined || link === undefined || adds === undefined || flow === undefined || image == null) throw new Error('no blocks');
    const place = (element: Element, top: number, height: number): void => {
      Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, top, 600, height) });
    };
    place(body, 0, 0);
    place(note, 0, 24);
    // An inline link's box is its line's text, at the image's foot; the image spans 40 to 710.
    place(link, 690, 20);
    place(image, 40, 670);
    place(adds, 726, 24);
    place(flow, 766, 24);
    shortenDescription(true);
    body.querySelector<HTMLElement>('.geld-desc-agent')?.click();
    await frames();
    await frame();
    expect(note.hasAttribute('data-geld-desc-cut') || note.hasAttribute('data-geld-desc-cut-edge')).toBe(false);
    expect(link.hasAttribute('data-geld-desc-cut')).toBe(false);
    expect(link.hasAttribute('data-geld-desc-cut-edge')).toBe(true);
    expect(link instanceof HTMLElement ? link.style.getPropertyValue('--geld-desc-cut-height') : '').toBe('460px');
    expect(adds.hasAttribute('data-geld-desc-cut')).toBe(true);
    expect(flow.hasAttribute('data-geld-desc-cut')).toBe(true);
  });

  it('leaves a folded picture out of the height, which Chrome still reports under content-visibility: hidden', async () => {
    const body = mountDescription(
      `<p>intro</p>${h(2, 'Screens')}<a href="https://github.com/user-attachments/assets/1"><img width="718" height="670" alt="" src="https://github.com/user-attachments/assets/1"></a>` +
        `<p>Folded too.</p>${h(2, 'Summary by CodeRabbit')}<ul><li>Bug fixes</li></ul>`,
    );
    const [intro, heading, link, folded] = [...body.children];
    const image = link?.querySelector('img');
    if (intro === undefined || heading === undefined || link === undefined || folded === undefined || image == null) throw new Error('no blocks');
    const place = (element: Element, top: number, height: number): void => {
      Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, top, 600, height) });
    };
    place(body, 0, 0);
    place(intro, 0, 24);
    place(heading, 24, 32);
    // The folded link has no height of its own, but its picture answers as if laid out.
    place(link, 56, 0);
    place(image, 56, 670);
    place(folded, 56, 0);
    shortenDescription(true);
    expect(link.getAttribute('hidden')).toBe('until-found');
    body.querySelector<HTMLElement>('.geld-desc-agent')?.click();
    await frames();
    await frame();
    expect(body.hasAttribute('data-geld-desc-long')).toBe(false);
    expect(body.querySelector('[data-geld-desc-cut], [data-geld-desc-cut-edge]')).toBeNull();
  });

  it('keeps at least the fade’s height of a block the cut runs through near its top', async () => {
    const body = mountDescription(
      `<p>one</p><div class="highlight"><pre>code</pre></div>${h(2, 'Summary by CodeRabbit')}<ul><li>Bug fixes</li></ul>`,
    );
    const [one, code] = [...body.children];
    if (one === undefined || !(code instanceof HTMLElement)) throw new Error('no blocks');
    layOut(body, new Map([[one, 490], [code, 300]]));
    shortenDescription(true);
    // Opening an agent's section measures the body.
    body.querySelector<HTMLElement>('.geld-desc-agent')?.click();
    await frames();
    await frame();
    expect(code.hasAttribute('data-geld-desc-cut-edge')).toBe(true);
    expect(code.style.getPropertyValue('--geld-desc-cut-height')).toBe('96px');
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

  it('cuts a long run of text above a heading near the end, and Show full description lifts it without opening the section', () => {
    const body = mountDescription(`<p>one</p><p>two</p><p>three</p>${h(2, 'Notes')}<p>n</p>`);
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    document.querySelector<HTMLButtonElement>('.geld-desc-more')?.click();
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
    expect(body.children[4]?.hasAttribute('data-geld-desc-fold')).toBe(true);
  });

  it('lifts the cut when the browser scrolls inside it to show text below, and keeps that text where it was', () => {
    const body = mountDescription(`<p>one</p><p>two</p><p>needle</p>${h(2, 'Notes')}<p>n</p>`);
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    // The block the cut runs through is the one that scrolls (as `measure` marks it on a real page).
    const edge = body.children[2];
    if (!(edge instanceof HTMLElement)) throw new Error('no block');
    edge.setAttribute('data-geld-desc-cut-edge', '');
    edge.scrollTop = 120;
    edge.dispatchEvent(new Event('scroll'));
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(false);
    expect(edge.hasAttribute('data-geld-desc-cut-edge')).toBe(false);
    expect(scrollBy).toHaveBeenCalledWith({ top: 120, behavior: 'instant' });
    scrollBy.mockRestore();
  });

  it('reads the height again after a section closes, so a description that now fits is not left under the fade', async () => {
    const body = mountDescription(`${h(2, 'A')}<p>a</p>${h(2, 'B')}<p>b</p>`);
    shortenDescription(true);
    expect(body.children[0]?.getAttribute('data-geld-desc-heading')).toBe('open');
    // As the cut body measured while the first section was open; the folded body is short now.
    body.setAttribute('data-geld-desc-long', '');
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 300 });
    body.querySelector<HTMLElement>('.markdown-heading h2')?.click();
    await frames();
    await frame();
    expect(body.children[1]?.hasAttribute('data-geld-desc-fold')).toBe(true);
    expect(body.hasAttribute('data-geld-desc-long')).toBe(false);
  });

  it('lifts the cut when find-in-page opens a folded section', () => {
    const body = mountDescription(`<p>intro</p>${h(2, 'A')}<p>needle</p>`);
    shortenDescription(true);
    expect(body.hasAttribute('data-geld-desc-cap')).toBe(true);
    const needle = body.children[2];
    needle?.removeAttribute('hidden');
    needle?.dispatchEvent(new Event('beforematch'));
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

  it('puts one control at the end of the body and removes everything when turned off', () => {
    const body = mountDescription('<p>only text</p>');
    shortenDescription(true);
    shortenDescription(true);
    expect(document.querySelectorAll('.geld-desc-more')).toHaveLength(1);
    expect(body.lastElementChild?.textContent).toBe('Show full description');
    shortenDescription(false);
    expect(document.querySelector('.geld-desc-more, .geld-desc-toggle, [data-geld-desc-cap], [data-geld-desc-fold]')).toBeNull();
  });
});

describe('the description folded from the first frame', () => {
  afterEach(() => {
    stopEarlyDescriptionFold();
    shortenDescription(false);
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  const heading = (level: number, text: string): string => `<h${level}>${text}</h${level}>`;
  const arrive = (): HTMLElement => {
    document.body.innerHTML = `<div class="js-comment-container"><div class="js-comment-body markdown-body"><p>intro</p>${heading(2, 'Summary')}<p>a</p>${heading(3, 'Details')}<p>b</p></div></div>`;
    const body = document.querySelector('.js-comment-body');
    if (!(body instanceof HTMLElement)) throw new Error('no body');
    return body;
  };
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('folds the description in the callback that sees it arrive, where it folded last time', async () => {
    history.replaceState(null, '', '/acme/widgets/pull/901');
    rememberDescriptionFold('acme/widgets', { toolsAway: false });
    applyDescriptionFoldHint('/acme/widgets/pull/901');
    const body = arrive();
    await settle();
    expect(descriptionUnshortened()).toBe(false);
    expect(body.querySelector('[data-geld-desc-fold]')).not.toBeNull();
  });

  it('finds the hint whatever the letter case of the repository in the URL', async () => {
    history.replaceState(null, '', '/casey/gadgets/pull/903');
    rememberDescriptionFold('Casey/Gadgets', { toolsAway: false });
    applyDescriptionFoldHint('/casey/GADGETS/pull/903');
    arrive();
    await settle();
    expect(descriptionUnshortened()).toBe(false);
  });

  it('leaves it whole in a repository where it did not fold, or on a tab other than the conversation', async () => {
    history.replaceState(null, '', '/acme/widgets/pull/902');
    rememberDescriptionFold('acme/widgets', false);
    applyDescriptionFoldHint('/acme/widgets/pull/902');
    arrive();
    await settle();
    expect(descriptionUnshortened()).toBe(true);
    rememberDescriptionFold('acme/widgets', { toolsAway: false });
    applyDescriptionFoldHint('/acme/widgets/pull/902/changes');
    arrive();
    await settle();
    expect(descriptionUnshortened()).toBe(true);
  });
});
