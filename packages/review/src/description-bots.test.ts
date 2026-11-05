import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { descriptionBotSegments, plainWords } from './description-bots';

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/descriptions/${name}.md`, import.meta.url), 'utf8');
}

describe('descriptionBotSegments', () => {
  it('finds each bot’s block in real descriptions', () => {
    expect(descriptionBotSegments(fixture('coderabbit'))).toEqual([{ bot: 'coderabbit', after: '' }]);
    expect(descriptionBotSegments(fixture('bugbot'))).toEqual([{ bot: 'bugbot', after: '' }]);
    expect(descriptionBotSegments(fixture('greptile'))).toEqual([{ bot: 'greptile', after: '' }]);
  });

  it('keeps the order the blocks stand in, and the author’s words between them', () => {
    const markdown = [
      'Fixes the widget.',
      '<!-- greptile_comment -->',
      '<details open><summary>Greptile Summary</summary>Fine.</details>',
      '<!-- /greptile_comment -->',
      '',
      '## Rollout',
      'Ship behind the [flag](https://example.com/flags) first.',
      '<!-- CURSOR_SUMMARY -->',
      '> [!NOTE]',
      '> **Low Risk**',
      '<!-- /CURSOR_SUMMARY -->',
    ].join('\n');
    expect(descriptionBotSegments(markdown)).toEqual([
      { bot: 'greptile', after: 'rollout ship behind the flag first' },
      { bot: 'bugbot', after: '' },
    ]);
  });

  it('reads the author’s words after a block as they render, entities decoded', () => {
    const markdown = '<!-- CURSOR_SUMMARY -->\n> [!NOTE]\n<!-- /CURSOR_SUMMARY -->\n## R&amp;D rollout &#8212; phase&nbsp;2\nTom &amp; Jerry&#39;s plan, &bogus; kept.';
    expect(descriptionBotSegments(markdown)).toEqual([{ bot: 'bugbot', after: 'r d rollout phase 2 tom jerry s plan bogus kept' }]);
  });

  it('runs a block with no end marker to the next one', () => {
    const markdown = '<!-- CURSOR_SUMMARY -->\n> [!NOTE]\n\nMore words\n<!-- greptile_comment -->\nsummary';
    expect(descriptionBotSegments(markdown)).toEqual([
      { bot: 'bugbot', after: '' },
      { bot: 'greptile', after: '' },
    ]);
  });

  it('finds nothing in a description no bot wrote into', () => {
    expect(descriptionBotSegments('## Summary\n\nA human wrote this. <!-- a note to self -->')).toEqual([]);
  });
});

describe('plainWords', () => {
  it('reads rendered text and Markdown as the same words', () => {
    expect(plainWords('Ship behind the flag — first!')).toBe('ship behind the flag first');
  });
});
