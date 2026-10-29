/** Where GitHub loads a comment's own menus lazily, with an `include-fragment` of their own. */
const MENU = '.dropdown-menu, details-menu, action-menu, [popover]';

/**
 * A deferred thread's own fragment, the one standing for its comments: the first `include-fragment` in it that is
 * neither in a menu nor in one of its comments. A thread whose first comment shows holds that comment's lazy ⋯ menu
 * and edit form too, and filling one of those with the thread's markup put the whole thread inside the menu.
 */
export function threadFragmentOf(thread: Element): Element | null {
  for (const fragment of thread.querySelectorAll('include-fragment')) {
    if (fragment.closest(MENU) !== null) continue;
    const comment = fragment.closest('.js-comment');
    if (comment !== null && comment !== thread && thread.contains(comment)) continue;
    return fragment;
  }
  return null;
}
