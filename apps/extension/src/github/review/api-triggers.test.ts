// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { GeldPrMeta } from '@geld/review';
import { reactionsOf } from './crawler';
import { NO_REPO_BOTS, requestableBots, triggerFor } from './panel-model';

const META: GeldPrMeta = {
  v: 1,
  generatedAt: '2026-11-03T08:00:00.000Z',
  headSha: 'a'.repeat(40),
  producer: { kind: 'crawler', version: '0.1.0', ai: false },
  items: [],
  bots: [],
  reviewers: [],
  fold: { comments: [], events: [] },
};

describe('starting a bot through the Geld workflow', () => {
  it('posts /geld run where the reader turned the bot on and the workflow has its key, the bot’s own trigger elsewhere', () => {
    const hint = { ...NO_REPO_BOTS, apiTriggers: new Map([['greptile', '/geld run greptile']]) };
    expect(triggerFor('greptile', hint)).toBe('/geld run greptile');
    expect(triggerFor('bugbot', hint)).toBe('bugbot run');
    expect(triggerFor('greptile', NO_REPO_BOTS)).toBe('@greptileai');
    const offered = requestableBots(META, document, [], hint);
    expect(offered.find((bot) => bot.id === 'greptile')?.trigger).toBe('/geld run greptile');
    expect(offered.find((bot) => bot.id === 'bugbot')?.trigger).toBe('bugbot run');
  });

  it('reads what each reaction was from GitHub’s tooltips', () => {
    document.body.innerHTML = `
      <div id="issuecomment-7">
        <div class="js-reactions-container">
          <button><tool-tip>github-actions[bot] reacted with rocket emoji</tool-tip></button>
          <button><tool-tip>alice, bob and 2 more reacted with thumbs up emoji</tool-tip></button>
        </div>
      </div>`;
    const node = document.getElementById('issuecomment-7');
    if (node === null) throw new Error('fixture missing');
    expect(reactionsOf(node)).toEqual([
      { login: 'github-actions[bot]', emoji: 'rocket' },
      { login: 'alice', emoji: 'thumbs up' },
      { login: 'bob', emoji: 'thumbs up' },
    ]);
  });
});
