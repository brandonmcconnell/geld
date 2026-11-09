import { describe, expect, it } from 'vitest';
import { relativeTimeText } from './time';

const NOW = Date.parse('2026-11-07T03:32:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('relativeTimeText', () => {
  it('words a time as GitHub’s relative-time element does', () => {
    // geld#439's commit, 22 hours before: the element says "yesterday", and folded the row said "today".
    expect(relativeTimeText('2026-11-06T05:19:29Z', NOW)).toBe('yesterday');
    expect(relativeTimeText(ago(3 * HOUR), NOW)).toBe('3 hours ago');
    expect(relativeTimeText(ago(20 * HOUR), NOW)).toBe('20 hours ago');
    expect(relativeTimeText(ago(17 * 60_000), NOW)).toBe('17 minutes ago');
    expect(relativeTimeText(ago(54 * 60_000), NOW)).toBe('54 minutes ago');
    expect(relativeTimeText(ago(56 * 60_000), NOW)).toBe('1 hour ago');
    expect(relativeTimeText(ago(30_000), NOW)).toBe('30 seconds ago');
    expect(relativeTimeText(ago(0), NOW)).toBe('now');
    expect(relativeTimeText(ago(3 * DAY), NOW)).toBe('3 days ago');
    expect(relativeTimeText(ago(6 * DAY), NOW)).toBe('last week');
    expect(relativeTimeText(ago(16 * DAY), NOW)).toBe('2 weeks ago');
    expect(relativeTimeText(ago(30 * DAY), NOW)).toBe('last month');
    expect(relativeTimeText(ago(45 * DAY), NOW)).toBe('2 months ago');
    expect(relativeTimeText(ago(400 * DAY), NOW)).toBe('last year');
  });

  it('says nothing for a time it cannot read', () => {
    expect(relativeTimeText('not a date', NOW)).toBe('');
  });
});
