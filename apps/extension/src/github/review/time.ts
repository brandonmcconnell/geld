/**
 * Times in the panel's own words. GitHub writes them through its
 * `<relative-time>` element ("yesterday", "2 days ago", then a date); a line
 * the panel builds itself uses the same element, so the wording and the live
 * updating are GitHub's, with the text below as what shows until the
 * element upgrades (and where it never does).
 */

import { createElement } from '../dom';

type AgeUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

/**
 * How long ago `then` was, rounded to one unit as GitHub's `relative-time` element rounds it (v5,
 * `roundToSingleUnit`): 21 hours is "yesterday", 6 days "last week". Mirrored so the words the panel writes itself
 * agree with the element's: a commit row renders its time as a date, and its "1 commit" row read "today" folded and
 * "yesterday" open, where the element worded it.
 */
function roundedAge(then: number, now: number): readonly [number, AgeUnit] {
  const ms = Math.max(0, now - then);
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const month = Math.floor(day / 30);
  let years = Math.floor(month / 12);
  let months = month - years * 12;
  let weeks = 0;
  let days = day - month * 30;
  let hours = hr - day * 24;
  let minutes = min - hr * 60;
  let seconds = sec - min * 60;
  if (ms - sec * 1000 >= 900) seconds += 1;
  if (seconds >= 55) minutes += Math.round(seconds / 60);
  if (minutes || hours || days || weeks || months || years) seconds = 0;
  if (minutes >= 55) hours += Math.round(minutes / 60);
  if (hours || days || weeks || months || years) minutes = 0;
  if (days && hours >= 12) days += Math.round(hours / 24);
  if (!days && hours >= 21) days += Math.round(hours / 24);
  if (days || weeks || months || years) hours = 0;
  const relativeTo = new Date(now);
  if (days >= 27 || years + months + days) {
    const monthEnd = new Date(relativeTo);
    monthEnd.setDate(1);
    monthEnd.setMonth(relativeTo.getMonth() - months + 1);
    monthEnd.setDate(0);
    const correction = Math.max(0, relativeTo.getDate() - monthEnd.getDate());
    const shifted = new Date(relativeTo);
    shifted.setFullYear(relativeTo.getFullYear() - years);
    shifted.setDate(relativeTo.getDate() - correction);
    shifted.setMonth(relativeTo.getMonth() - months);
    shifted.setDate(relativeTo.getDate() - correction - days);
    const yearDiff = shifted.getFullYear() - relativeTo.getFullYear();
    const monthDiff = shifted.getMonth() - relativeTo.getMonth();
    const daysDiff = Math.abs(Math.round((Number(shifted) - Number(relativeTo)) / 86_400_000)) + correction;
    const monthsDiff = Math.abs(yearDiff * 12 + monthDiff);
    if (daysDiff < 27) {
      if (days >= 6) {
        weeks += Math.round(days / 7);
        days = 0;
      } else {
        days = daysDiff;
      }
      months = years = 0;
    } else if (monthsDiff <= 11) {
      months = monthsDiff;
      years = 0;
    } else {
      months = 0;
      years = -yearDiff;
    }
    if (months || years) days = 0;
  }
  if (years) months = 0;
  if (weeks >= 4) months += Math.round(weeks / 4);
  if (months || years) weeks = 0;
  if (days && weeks && !months && !years) {
    weeks += Math.round(days / 7);
    days = 0;
  }
  const units: readonly (readonly [number, AgeUnit])[] = [[years, 'year'], [months, 'month'], [weeks, 'week'], [days, 'day'], [hours, 'hour'], [minutes, 'minute'], [seconds, 'second']];
  return units.find(([value]) => value !== 0) ?? [0, 'second'];
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** GitHub's relative wording ("yesterday", "3 hours ago"), as its `relative-time` with `tense="past"` writes it, for a time the page does not word itself. */
export function relativeTimeText(datetime: string, now = Date.now()): string {
  const then = Date.parse(datetime);
  if (Number.isNaN(then)) return '';
  const [value, unit] = roundedAge(then, now);
  return RELATIVE.format(-value, unit);
}

/**
 * The exact moment behind a relative time, for a `title`: "Oct 7, 2026,
 * 4:21 AM" in the reader's locale. GitHub's own `relative-time` shows this
 * on hover; the panel's text times (and its own elements) carry it too.
 */
export function absoluteTimeText(datetime: string): string {
  const then = Date.parse(datetime);
  if (Number.isNaN(then)) return '';
  return new Date(then).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A `<relative-time>` for `datetime`, worded by GitHub's element once it upgrades, by `relativeTimeText` until then. */
export function relativeTimeElement(datetime: string, className: string): HTMLElement {
  const wrapper = createElement('span', { class: className });
  const time = document.createElement('relative-time');
  time.setAttribute('datetime', datetime);
  time.setAttribute('tense', 'past');
  time.textContent = relativeTimeText(datetime);
  // GitHub's element may not set a hover title on its own; the exact moment is useful, so give it one (and the
  // wrapper too, which GitHub never touches).
  const title = absoluteTimeText(datetime);
  if (title !== '') {
    time.setAttribute('title', title);
    wrapper.setAttribute('title', title);
  }
  wrapper.append(time);
  return wrapper;
}
