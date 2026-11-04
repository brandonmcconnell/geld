import { describe, expect, it } from 'vitest';
import type { BotComment, BotVerdictRecord, RawCheckRun } from '@geld/review';
import type { BotRequestClick, BotRequestInput } from './bot-requests';
import { botRequestStates, nextRequestDeadline, REQUEST_ACK_MS, REQUEST_ACK_SLOW_MS, withBotRequests } from './bot-requests';

const T0 = Date.parse('2026-11-04T10:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();

function input(overrides: Partial<BotRequestInput>): BotRequestInput {
  return { clicks: new Map(), comments: [], checks: [], bots: [], extraLogins: [], now: T0, ...overrides };
}

const click = (at: number, posted: boolean | null = true): ReadonlyMap<string, BotRequestClick> => new Map([['greptile', { at, posted }]]);
const trigger = (at: number, body: string, reactedBy?: readonly string[]): BotComment => ({ author: 'brandonmcconnell', body, anchor: 'issuecomment-1', createdAt: iso(at), ...(reactedBy === undefined ? {} : { reactedBy }) });
const record = (id: string, login: string, verdict: BotVerdictRecord['verdict']): BotVerdictRecord => ({ id, login, verdict, reviewedSha: 'abc' });

describe('botRequestStates', () => {
  it('spins from the click, before the trigger comment is on the page', () => {
    const states = botRequestStates(input({ clicks: click(T0, null), now: T0 + 1_000 }));
    expect(states.get('greptile')).toEqual({ kind: 'starting', until: T0 + REQUEST_ACK_MS });
  });

  it('reads a bot that reacts as unanswered once its window passes with no sign', () => {
    const states = botRequestStates(input({ clicks: click(T0), comments: [trigger(T0 + 500, '@greptileai')], now: T0 + REQUEST_ACK_MS + 1 }));
    expect(states.get('greptile')).toEqual({ kind: 'unanswered', reason: 'silent' });
  });

  it('clears the request once the bot reacts to the trigger', () => {
    const states = botRequestStates(input({ clicks: click(T0), comments: [trigger(T0 + 500, '@greptileai', ['greptile-apps[bot]'])], now: T0 + 5_000 }));
    expect(states.has('greptile')).toBe(false);
  });

  it('picks up an answer that comes after the window', () => {
    const answer: BotComment = { author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5', anchor: 'issuecomment-2', createdAt: iso(T0 + 45_000) };
    const states = botRequestStates(input({ clicks: click(T0), comments: [trigger(T0 + 500, '@greptileai'), answer], now: T0 + 50_000 }));
    expect(states.has('greptile')).toBe(false);
  });

  it('says a trigger that never posted was not posted', () => {
    const states = botRequestStates(input({ clicks: click(T0, false), now: T0 + 1_000 }));
    expect(states.get('greptile')).toEqual({ kind: 'unanswered', reason: 'not-posted' });
  });

  it('gives a bot that never reacts the longer window, timed from its trigger comment', () => {
    const comments = [trigger(T0, 'bugbot run')];
    expect(botRequestStates(input({ comments, bots: [record('bugbot', 'cursor[bot]', 'running')], now: T0 + 30_000 })).get('bugbot')).toEqual({ kind: 'starting', until: T0 + REQUEST_ACK_SLOW_MS });
    expect(botRequestStates(input({ comments, bots: [record('bugbot', 'cursor[bot]', 'running')], now: T0 + REQUEST_ACK_SLOW_MS + 1 })).get('bugbot')).toEqual({ kind: 'unanswered', reason: 'silent' });
  });

  it('leaves an old request alone once the verdicts have settled it, outside the visit that asked', () => {
    const states = botRequestStates(input({ comments: [trigger(T0, 'bugbot run')], bots: [record('bugbot', 'cursor[bot]', 'clean')], now: T0 + 10 * 60_000 }));
    expect(states.has('bugbot')).toBe(false);
  });

  it('reads a check run under way as the bot taking the request', () => {
    const check: RawCheckRun = { name: 'Cursor Bugbot', status: 'in_progress', conclusion: null, sha: 'abc' };
    const states = botRequestStates(input({ comments: [trigger(T0, 'bugbot run')], checks: [check], bots: [record('bugbot', 'cursor[bot]', 'running')], now: T0 + 90_000 }));
    expect(states.has('bugbot')).toBe(false);
  });

  it('reads the Geld workflow\u2019s answer to a /geld run command, not the bot\u2019s', () => {
    const run = (reactions: BotComment['reactions']): BotComment => ({ ...trigger(T0, '/geld run greptile'), ...(reactions === undefined ? {} : { reactions }) });
    expect(botRequestStates(input({ comments: [run(undefined)], bots: [record('greptile', 'greptile-apps[bot]', 'running')], now: T0 + 30_000 })).get('greptile')).toEqual({ kind: 'starting', until: T0 + REQUEST_ACK_SLOW_MS });
    expect(botRequestStates(input({ comments: [run([{ login: 'github-actions[bot]', emoji: 'rocket' }])], now: T0 + 30_000 })).has('greptile')).toBe(false);
    expect(botRequestStates(input({ comments: [run([{ login: 'github-actions[bot]', emoji: 'thumbs down' }])], now: T0 + 5_000 })).get('greptile')).toEqual({ kind: 'unanswered', reason: 'silent' });
  });

  it('does not read a bot quoting its own command as a request', () => {
    const own: BotComment = { author: 'greptile-apps[bot]', body: 'Comment @greptileai to re-run', anchor: 'issuecomment-3', createdAt: iso(T0) };
    expect(botRequestStates(input({ comments: [own], now: T0 + 1_000 })).size).toBe(0);
  });
});

describe('withBotRequests', () => {
  it('runs a bot that is starting, adding one that never ran here', () => {
    const bots = withBotRequests([record('greptile', 'greptile-apps[bot]', 'clean')], new Map([['greptile', { kind: 'starting', until: T0 }], ['bugbot', { kind: 'starting', until: T0 }]]), 'abc');
    expect(bots.map((bot) => [bot.id, bot.verdict])).toEqual([
      ['greptile', 'running'],
      ['bugbot', 'running'],
    ]);
  });

  it('turns a run that only the request vouched for into no word, and keeps a settled verdict', () => {
    const states = new Map([['greptile', { kind: 'unanswered', reason: 'silent' }], ['bugbot', { kind: 'unanswered', reason: 'silent' }]] as const);
    const bots = withBotRequests([record('greptile', 'greptile-apps[bot]', 'running'), record('bugbot', 'cursor[bot]', 'clean')], states, 'abc');
    expect(bots.map((bot) => bot.verdict)).toEqual(['unknown', 'clean']);
  });
});

describe('nextRequestDeadline', () => {
  it('is the earliest end of a starting window', () => {
    expect(nextRequestDeadline(new Map([['a', { kind: 'starting', until: 9 }], ['b', { kind: 'starting', until: 5 }], ['c', { kind: 'unanswered', reason: 'silent' }]] as const))).toBe(5);
    expect(nextRequestDeadline(new Map())).toBeNull();
  });
});
