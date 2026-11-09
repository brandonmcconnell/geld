// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseHovercard } from './refs';

// wxt-dev/wxt's hovercards, fetched in Nov 2026: one per state an issue or pull request can be in.
const hovercard = (name: string): Document => new DOMParser().parseFromString(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'hovercards', `${name}.html`), 'utf8'), 'text/html');

describe('parseHovercard', () => {
  it('reads every state from the badge’s glyph, which its class alone does not say', () => {
    expect(parseHovercard(hovercard('open'), '/wxt-dev/wxt/pull/2523')).toEqual({ title: 'Drop, Replace, Inline, DIY, or Minimize Dependencies', state: 'issue-open' });
    expect(parseHovercard(hovercard('completed'), '/wxt-dev/wxt/pull/2704')?.state).toBe('issue-closed');
    expect(parseHovercard(hovercard('notplanned'), '/wxt-dev/wxt/pull/2634')?.state).toBe('issue-not-planned');
    expect(parseHovercard(hovercard('merged'), '/wxt-dev/wxt/pull/2721')?.state).toBe('merged');
    expect(parseHovercard(hovercard('closedpr'), '/wxt-dev/wxt/pull/2722')?.state).toBe('closed');
    expect(parseHovercard(hovercard('draft'), '/wxt-dev/wxt/pull/2695')?.state).toBe('draft');
  });
});
