const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** Whether any of the button is in the window: a menu whose button scrolled out of it closes rather than float off-screen. */
export function buttonInView(button: { readonly top: number; readonly bottom: number }, viewport: number): boolean {
  return button.bottom >= 0 && button.top <= viewport;
}

/** Where the menu opens: under its button as GitHub's do, above it when only above has the room, and never past the window. */
export function menuPlacement(button: { readonly top: number; readonly bottom: number }, height: number, viewport: number): { readonly top: number; readonly maxHeight: number } {
  const below = Math.max(0, viewport - button.bottom - MENU_GAP - VIEWPORT_MARGIN);
  const above = Math.max(0, button.top - MENU_GAP - VIEWPORT_MARGIN);
  if (height <= below || below >= above) return { top: button.bottom + MENU_GAP, maxHeight: below };
  const shown = Math.min(height, above);
  return { top: button.top - MENU_GAP - shown, maxHeight: above };
}

/** The menu's scroll offset that shows an item, moving as little as possible: focus never scrolls a capped menu by itself, since `preventScroll` keeps the page still. */
export function scrollToShow(scrollTop: number, viewHeight: number, itemTop: number, itemHeight: number): number {
  if (itemTop < scrollTop) return itemTop;
  if (itemTop + itemHeight > scrollTop + viewHeight) return itemTop + itemHeight - viewHeight;
  return scrollTop;
}
