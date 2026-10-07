/**
 * Times in the panel's own words. GitHub writes them through its
 * `<relative-time>` element ("yesterday", "2 days ago", then a date); a line
 * the panel builds itself uses the same element, so the wording and the live
 * updating are GitHub's, with the text below as what shows until the
 * element upgrades (and where it never does).
 */

import { createElement } from '../dom';

/** GitHub's relative wording, near enough, for a time the page does not render itself. */
export function relativeTimeText(datetime: string): string {
  const then = Date.parse(datetime);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'last month';
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(then).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
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
