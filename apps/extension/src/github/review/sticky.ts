/**
 * The bottom edge GitHub's sticky pull request header will have once the page
 * is scrolled to `scrollY`, or 0 when it will not be showing. The React header
 * (`use-sticky-header-module__stickyHeader`) is `display: none` until a 1px
 * sentinel (`StickyPullRequestHeader-module__stickyHeaderActivationThreshold`)
 * leaves the viewport above, then a fixed bar; its height is read with the
 * display forced for one synchronous layout, which never paints. The classic
 * header (`.gh-header-sticky`) sticks at its own document position and shows
 * its content with `is-stuck`, measured the same way.
 */
export function stickyHeaderBottomAt(scrollY: number): number {
  const react = document.querySelector<HTMLElement>('[class*="use-sticky-header-module__stickyHeader"], [class*="stickyHeader"][class*="PageHeader"]');
  const sentinel = document.querySelector<HTMLElement>('[class*="stickyHeaderActivationThreshold"]');
  if (react !== null && sentinel !== null) {
    const activation = sentinel.getBoundingClientRect().bottom + window.scrollY;
    if (scrollY < activation) return 0;
    return measureHidden(react, () => react.offsetHeight, 'display', 'flex');
  }
  const classic = document.querySelector<HTMLElement>('.gh-header-sticky, .js-sticky');
  if (classic !== null) {
    const activation = classic.getBoundingClientRect().top + window.scrollY;
    if (scrollY < activation) return 0;
    if (classic.classList.contains('is-stuck')) return classic.offsetHeight;
    classic.classList.add('is-stuck');
    const height = classic.offsetHeight;
    classic.classList.remove('is-stuck');
    return height;
  }
  // No sticky header known: whatever is pinned at the top now.
  for (const header of document.querySelectorAll<HTMLElement>('[data-testid="sticky-header"], [class*="StickyHeader"]')) {
    const rect = header.getBoundingClientRect();
    const position = getComputedStyle(header).position;
    if ((position === 'sticky' || position === 'fixed') && rect.top <= 1 && rect.height > 0 && rect.height <= 160) return rect.bottom;
  }
  return 0;
}

/** Read a measurement of `element` with one inline style forced for the read; the style is restored in the same task, so nothing paints. */
function measureHidden(element: HTMLElement, read: () => number, property: 'display', value: string): number {
  if (element.offsetHeight > 0) return read();
  const previous = element.style.getPropertyValue(property);
  element.style.setProperty(property, value);
  const measured = read();
  if (previous === '') element.style.removeProperty(property);
  else element.style.setProperty(property, previous);
  return measured;
}
