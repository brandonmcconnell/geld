// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { botSectionsOf } from './description-bots';
import { outlineOf, shortenDescription } from './description';
import bugbotHtml from './__fixtures__/description-bots/bugbot.html?raw';
import coderabbitHtml from './__fixtures__/description-bots/coderabbit.html?raw';
import greptileHtml from './__fixtures__/description-bots/greptile.html?raw';
import bugbotMd from '../../../../../packages/review/src/__fixtures__/descriptions/bugbot.md?raw';
import coderabbitMd from '../../../../../packages/review/src/__fixtures__/descriptions/coderabbit.md?raw';
import greptileMd from '../../../../../packages/review/src/__fixtures__/descriptions/greptile.md?raw';

type Fixture = 'bugbot' | 'coderabbit' | 'greptile';

/** A description's rendered body from a public pull request (Nov 2026), and the Markdown GitHub's "Copy Markdown" holds. */
const RENDERED: Record<Fixture, string> = { bugbot: bugbotHtml, coderabbit: coderabbitHtml, greptile: greptileHtml };
const MARKDOWN: Record<Fixture, string> = { bugbot: bugbotMd, coderabbit: coderabbitMd, greptile: greptileMd };
const rendered = (name: Fixture): string => RENDERED[name];
const markdown = (name: Fixture): string => MARKDOWN[name];

function blocksOf(html: string): Element[] {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return [...holder.children];
}

describe('botSectionsOf', () => {
  it('finds Greptile’s open details, footer and note as one block after the author’s line, named by its score', () => {
    const blocks = blocksOf(rendered('greptile'));
    const expected = [{ bot: 'greptile', start: 1, end: 6, title: 'Greptile · 4/5' }];
    expect(botSectionsOf(blocks, markdown('greptile'))).toEqual(expected);
    expect(botSectionsOf(blocks, null)).toEqual(expected);
  });

  it('finds Bugbot’s note and names its risk', () => {
    const blocks = blocksOf(rendered('bugbot'));
    expect(botSectionsOf(blocks, markdown('bugbot'))).toEqual([{ bot: 'bugbot', start: 0, end: 1, title: 'Cursor Bugbot · Low Risk' }]);
  });

  it('finds CodeRabbit’s summary under its own heading, both copies of it', () => {
    const blocks = blocksOf(rendered('coderabbit'));
    expect(botSectionsOf(blocks, markdown('coderabbit'))).toEqual([{ bot: 'coderabbit', start: 6, end: 9, title: null }]);
  });

  it('ends a block where the author’s words resume', () => {
    const blocks = blocksOf('<p>Fixes it.</p><details open><summary>Greptile Summary</summary>Fine.</details><h2>Rollout</h2><p>Ship behind the flag first.</p>');
    const md = 'Fixes it.\n<!-- greptile_comment -->\n<details open><summary>Greptile Summary</summary>Fine.</details>\n<!-- /greptile_comment -->\n## Rollout\nShip behind the flag first.';
    expect(botSectionsOf(blocks, md)).toEqual([{ bot: 'greptile', start: 1, end: 2, title: 'Greptile' }]);
  });

  it('takes the rule older Bugbot notes stood under, and nothing after the note', () => {
    const blocks = blocksOf('<p>Body.</p><hr><div class="markdown-alert markdown-alert-note"><p><strong>Medium Risk</strong></p><p><sup>Written by <a href="https://cursor.com/dashboard?tab=bugbot">Cursor Bugbot</a></sup></p></div><p>Author’s P.S.</p>');
    expect(botSectionsOf(blocks, null)).toEqual([{ bot: 'bugbot', start: 1, end: 3, title: 'Cursor Bugbot · Medium Risk' }]);
  });

  it('believes the Markdown when it names no bot', () => {
    const blocks = blocksOf('<h2>Summary by CodeRabbit</h2><p>Quoting what the bot said.</p>');
    expect(botSectionsOf(blocks, '## Summary by CodeRabbit\nQuoting what the bot said.')).toEqual([]);
  });
});

describe('outlineOf with bots’ blocks', () => {
  it('ends the author’s section at a bot’s block and makes the block a section above every level', () => {
    const blocks = blocksOf(rendered('coderabbit'));
    expect(outlineOf(blocks, botSectionsOf(blocks, null))).toEqual([
      { index: 1, level: 1, end: 6, hasSubheadings: true },
      { index: 4, level: 2, end: 6, hasSubheadings: false },
      { index: 6, level: 0, end: 9, hasSubheadings: false, bot: true },
    ]);
  });
});

describe('shortenDescription with bots’ blocks', () => {
  afterEach(() => {
    shortenDescription(false);
    document.body.innerHTML = '';
  });

  function mount(name: Fixture): HTMLElement {
    const copy = `<clipboard-copy data-dd-action-name="pr.description.copy_markdown" value="${markdown(name).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></clipboard-copy>`;
    document.body.innerHTML = `<div class="js-comment-container"><div class="timeline-comment">${copy}<div class="js-comment-body markdown-body">${rendered(name)}</div></div></div>`;
    const body = document.querySelector('.js-comment-body');
    if (!(body instanceof HTMLElement)) throw new Error('no body');
    return body;
  }

  it('folds Greptile’s block under a heading of Geld’s, once, and leaves the author’s line', () => {
    const body = mount('greptile');
    shortenDescription(true);
    shortenDescription(true);
    const heads = body.querySelectorAll('[data-geld-desc-bot]');
    expect(heads.length).toBe(1);
    expect(heads[0]?.textContent).toBe('Greptile · 4/5');
    expect(heads[0]?.getAttribute('data-geld-desc-heading')).toBe('closed');
    const folded = [...body.children].map((block) => block.hasAttribute('data-geld-desc-fold'));
    expect(folded).toEqual([false, false, true, true, true, true, true]);
  });

  it('keeps the author’s sections as they were and CodeRabbit’s closed', () => {
    const body = mount('coderabbit');
    shortenDescription(true);
    expect(body.querySelector('[data-geld-desc-bot]')).toBeNull();
    const states = [...body.children].map((block) => block.getAttribute('data-geld-desc-heading'));
    expect(states).toEqual([null, 'open', null, null, 'closed', null, 'closed', null, null]);
  });

  it('takes Geld’s headings away when shortening is turned off', () => {
    const body = mount('bugbot');
    shortenDescription(true);
    expect(body.querySelector('[data-geld-desc-bot]')).not.toBeNull();
    shortenDescription(false);
    expect(body.querySelector('[data-geld-desc-bot]')).toBeNull();
    expect(body.querySelector('[hidden]')).toBeNull();
  });
});
