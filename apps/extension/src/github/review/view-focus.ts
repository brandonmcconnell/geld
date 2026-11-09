/**
 * Where keyboard focus lands after a view choice. A settings change tears the
 * page's Geld UI down and builds it again, so the control the reader used is
 * gone by the time its replacement mounts: the choice leaves a request for the
 * control that takes its place (the panel's View control, or the off line's
 * pressed view), kept only for the page it was made on.
 */

export type ViewFocusTarget = 'panel' | 'off-line';

interface Pending {
  readonly target: ViewFocusTarget;
  readonly page: string;
  readonly id: number;
}

let pending: Pending | null = null;
let issued = 0;

/** Ask for focus on `target` once it next mounts here; the returned function withdraws this request (a failed write). */
export function requestViewFocus(target: ViewFocusTarget): () => void {
  issued += 1;
  const request: Pending = { target, page: location.pathname, id: issued };
  pending = request;
  return () => {
    if (pending?.id === request.id) pending = null;
  };
}

/** Drop a request made on another page: the reader left before the control it named came back. */
export function forgetViewFocusElsewhere(): void {
  if (pending !== null && pending.page !== location.pathname) pending = null;
}

/** Whether `target`, mounting now, should take focus; a request is spent once taken. */
export function takeViewFocus(target: ViewFocusTarget): boolean {
  forgetViewFocusElsewhere();
  if (pending?.target !== target) return false;
  pending = null;
  return true;
}
