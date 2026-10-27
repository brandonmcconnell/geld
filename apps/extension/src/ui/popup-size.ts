/** Chrome/Firefox cap extension action popups at 600 CSS px. */
const BROWSER_POPUP_MAX_HEIGHT = 600;
const MIN_USABLE_POPUP_HEIGHT = 240;

/** The share of the display the popup may take before it scrolls. */
const DISPLAY_SHARE = 0.9;

/**
 * Let the popup grow naturally until it would occupy more than nine tenths
 * of the available display, then scroll. Browser popup limits still win on
 * tall displays.
 */
export function popupMaxHeight(availableHeight: number): number {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return BROWSER_POPUP_MAX_HEIGHT;
  return Math.min(BROWSER_POPUP_MAX_HEIGHT, Math.max(MIN_USABLE_POPUP_HEIGHT, Math.floor(availableHeight * DISPLAY_SHARE)));
}

/** A one-pixel tolerance avoids toggling for subpixel layout rounding. */
export function popupNeedsScroll(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1;
}
