/**
 * Times in the panel's own words. GitHub writes them through its
 * `<relative-time>` element ("yesterday", "2 days ago", then a date); a line
 * the panel builds itself uses the same element, so the wording and the live
 * updating are GitHub's, with the text below as what shows until the
 * element upgrades (and where it never does).
 */

import { createElement } from '../dom';
import { absoluteTimeText, relativeTimeText } from '../../review/time';

export { absoluteTimeText, earliestMoment, relativeTimeText } from '../../review/time';

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
