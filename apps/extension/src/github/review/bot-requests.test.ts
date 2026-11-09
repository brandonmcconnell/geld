import { describe, expect, it } from 'vitest';
import type { BotComment, BotVerdictRecord, RawCheckRun } from '@geld/review';
import type { BotRequestClick, BotRequestInput } from './bot-requests';
import { ACK_GRACE_MS } from '@geld/review';
import { awaitingReaction, botRequestStates, nextRequestDeadline, REQUEST_ACK_MS, REQUEST_ACK_SLOW_MS, withBotRequests } from './bot-requests';

const T0 = Date.parse('2026-11-04T10:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();

function input(overrides: Partial<BotRequestInput>): BotRequestInput {
  return { clicks: new Map(), comments: [], checks: [], bots: [], extraLogins: [], now: T0, ...overrides };
}

const click = (at: number, posted: boolean | null = true, before: readonly string[] = []): ReadonlyMap<string, BotRequestClick> => new Map([['greptile', { at, posted, before: new Set(before) }]]);
const trigger = (at: number, body: string, reactedBy?: readonly string[], anchor = 'issuecomment-1'): BotComment => ({ author: 'brandonmcconnell', body, anchor, createdAt: iso(at), ...(reactedBy === undefined ? {} : { reactedBy }) });
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

  it('never lends a retry the reaction of the request before it, nor hides that the retry did not post', () => {
    const earlier = trigger(T0 - 60_000, '@greptileai', ['greptile-apps[bot]'], 'issuecomment-9');
    expect(botRequestStates(input({ clicks: click(T0, null, ['issuecomment-9']), comments: [earlier], now: T0 + 1_000 })).get('greptile')).toEqual({ kind: 'starting', until: T0 + REQUEST_ACK_MS });
    expect(botRequestStates(input({ clicks: click(T0, false, ['issuecomment-9']), comments: [earlier], now: T0 + 1_000 })).get('greptile')).toEqual({ kind: 'unanswered', reason: 'not-posted' });
  });

  it('gives a trigger typed into GitHub after a stale click a window of its own', () => {
    const typed = trigger(T0 + 10 * 60_000, '@greptileai', undefined, 'issuecomment-7');
    expect(botRequestStates(input({ clicks: click(T0, false), comments: [typed], now: T0 + 10 * 60_000 + 1_000 })).get('greptile')).toEqual({ kind: 'starting', until: T0 + 10 * 60_000 + REQUEST_ACK_MS });
  });

  it('lets the bot\u2019s own answer win over a workflow \u{1F44E} that covered another bot', () => {
    const run: BotComment = { ...trigger(T0, '/geld run greptile bugbot'), reactions: [{ login: 'github-actions[bot]', emoji: 'thumbs down' }] };
    const answer: BotComment = { author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5', anchor: 'issuecomment-2', createdAt: iso(T0 + 90_000) };
    expect(botRequestStates(input({ comments: [run, answer], now: T0 + 100_000 })).has('greptile')).toBe(false);
  });

  it('leaves a settled review alone after an old /geld run refusal, outside the visit that asked', () => {
    const run: BotComment = { ...trigger(T0, '/geld run greptile'), reactions: [{ login: 'github-actions[bot]', emoji: 'thumbs down' }] };
    expect(botRequestStates(input({ comments: [run], bots: [record('greptile', 'greptile-apps[bot]', 'clean')], now: T0 + 10 * 60_000 })).has('greptile')).toBe(false);
    expect(botRequestStates(input({ comments: [run], bots: [record('greptile', 'greptile-apps[bot]', 'clean')], now: T0 + 5_000 })).get('greptile')).toEqual({ kind: 'unanswered', reason: 'silent' });
  });

  it('does not read a mention of a trigger in prose as a request', () => {
    const prose = trigger(T0, 'The previous bugbot run found nothing, so this looks fine to me.');
    expect(botRequestStates(input({ comments: [prose], now: T0 + 1_000 })).size).toBe(0);
  });

  it('does not read a bot quoting its own command as a request', () => {
    const own: BotComment = { author: 'greptile-apps[bot]', body: 'Comment @greptileai to re-run', anchor: 'issuecomment-3', createdAt: iso(T0) };
    expect(botRequestStates(input({ comments: [own], now: T0 + 1_000 })).size).toBe(0);
  });
});

describe('awaitingReaction', () => {
  it('lists the triggers a reacting bot has not reacted to yet, with when its grace ends', () => {
    const waiting = trigger(T0, '@greptileai', undefined, 'issuecomment-1');
    const reacted = trigger(T0, '@greptileai', ['greptile-apps[bot]'], 'issuecomment-2');
    expect(awaitingReaction([waiting, reacted], [])).toEqual([{ anchor: 'issuecomment-1', at: T0, until: T0 + ACK_GRACE_MS }]);
  });

  it('leaves out bots that start silently and requests the Geld workflow answers', () => {
    expect(awaitingReaction([trigger(T0, 'bugbot run'), trigger(T0, '/geld run greptile', undefined, 'issuecomment-3')], [])).toEqual([]);
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
