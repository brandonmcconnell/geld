/** Chrome/Firefox cap extension action popups at 600 CSS px. */
const BROWSER_POPUP_MAX_HEIGHT = 600;
const MIN_USABLE_POPUP_HEIGHT = 240;

/**
 * Let the popup grow naturally until it would occupy more than three quarters
 * of the available display. Browser popup limits still win on tall displays.
 */
export function popupMaxHeight(availableHeight: number): number {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return BROWSER_POPUP_MAX_HEIGHT;
  return Math.min(BROWSER_POPUP_MAX_HEIGHT, Math.max(MIN_USABLE_POPUP_HEIGHT, Math.floor(availableHeight * 0.75)));
}
