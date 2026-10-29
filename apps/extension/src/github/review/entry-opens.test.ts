// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { botLineKey, entryOpens } from './panel';
import type { BotVerdictRecord } from '@geld/review';
import type { BotLine, ReviewEntry } from './panel';

function entry(overrides: Partial<ReviewEntry>): ReviewEntry {
  return { anchor: 'pullrequestreview-1', author: 'sheremet-va', avatarSrc: null, state: 'changes_requested', preview: '', time: 'yesterday', hasBody: false, done: false, replies: 0, myReaction: null, ...overrides };
}

const THREADS = [{ anchor: 'discussion_r1', done: false }];

describe('what a review line opens to', () => {
  it('opens on words of its own, and a wordless verdict opens to its threads', () => {
    expect(entryOpens(entry({ hasBody: true, preview: 'Looks close.' }))).toBe(true);
    expect(entryOpens(entry({ threads: THREADS }))).toBe(true);
    expect(entryOpens(entry({ state: 'approved', threads: THREADS }))).toBe(true);
  });

  it('leaves a bare verdict, a pending request and a line the sidebar alone vouches for closed', () => {
    expect(entryOpens(entry({}))).toBe(false);
    expect(entryOpens(entry({ state: 'awaiting', anchor: 'awaiting:sheremet-va', threads: THREADS }))).toBe(false);
    expect(entryOpens(entry({ anchor: 'sidebar:sheremet-va', threads: THREADS }))).toBe(false);
  });
});

describe("a bot line's key", () => {
  it("is its summary's anchor, or the bot's own when it posted threads and no summary", () => {
    const bot: BotVerdictRecord = { id: 'bugbot', login: 'cursor[bot]', verdict: 'findings', reviewedSha: 'a'.repeat(40) };
    const line = (anchor: string | null): BotLine => ({ bot, anchor, author: 'cursor[bot]', avatarSrc: null, preview: '', time: '', threads: [] });
    expect(botLineKey(line('issuecomment-9'))).toBe('issuecomment-9');
    expect(botLineKey(line(null))).toBe('bot:bugbot');
  });
});
