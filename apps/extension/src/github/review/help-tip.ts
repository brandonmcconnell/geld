import { createElement, svgFromString } from '../dom';
import { ICON_QUESTION } from '../ui/icons';

export interface HelpTipOptions {
  /** The class prefix of the panel the tip stands in. */
  readonly prefix: string;
  /** The icon's accessible name. */
  readonly label: string;
  /** What the tip says, links included. */
  readonly content: ReadonlyArray<Node | string>;
  /** `menuitem` inside a `role="menu"` list. */
  readonly role?: 'menuitem';
}

const GAP_PX = 6;
const EDGE_PX = 8;
const HIDE_DELAY_MS = 150;

let tipCount = 0;

/**
 * A question icon whose tip shows on hover or focus and stays put once clicked, so its link can be reached by
 * pointer, keyboard and touch alike. The tip is a popover, in the top layer: the agents' menu scrolls inside itself and
 * the panel is a size container, so a tip positioned within either would be clipped or placed against the wrong box.
 */
export function helpTip(options: HelpTipOptions): HTMLElement {
  const { prefix } = options;
  const id = `geld-help-tip-${++tipCount}`;
  const button = createElement('button', { type: 'button', class: `${prefix}__help`, 'aria-label': options.label, 'aria-expanded': 'false', 'aria-controls': id, ...(options.role === undefined ? {} : { role: options.role }) }, [
    createElement('span', { class: `${prefix}__help-glyph`, 'aria-hidden': 'true' }, [svgFromString(ICON_QUESTION)]),
  ]);
  const tip = createElement('div', { id, class: `${prefix}__help-tip`, popover: 'manual' }, [...options.content]);
  const canPop = typeof tip.showPopover === 'function';
  if (!canPop) tip.hidden = true;

  let hovering = false;
  let focused = false;
  let pinned = false;
  let shown = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let detach: (() => void) | null = null;

  const place = (): void => {
    const anchor = button.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const above = anchor.top - GAP_PX - box.height;
    const top = above >= EDGE_PX ? above : anchor.bottom + GAP_PX;
    const left = Math.min(Math.max(EDGE_PX, anchor.left - EDGE_PX), window.innerWidth - box.width - EDGE_PX);
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  };

  const show = (): void => {
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = null;
    if (shown) return;
    shown = true;
    if (canPop) tip.showPopover();
    else tip.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    const onMove = (): void => place();
    const onDown = (event: Event): void => {
      if (event.target instanceof Node && (button.contains(event.target) || tip.contains(event.target))) return;
      pinned = false;
      hide();
    };
    // A menu that closes (Run, Cancel, a click outside, Escape) takes its tip with it.
    const menu = button.closest('details');
    const onToggle = (): void => {
      if (menu?.open !== true) close();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('mousedown', onDown, true);
    menu?.addEventListener('toggle', onToggle);
    detach = () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('mousedown', onDown, true);
      menu?.removeEventListener('toggle', onToggle);
    };
  };

  const hide = (): void => {
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = null;
    if (!shown) return;
    shown = false;
    detach?.();
    detach = null;
    if (canPop && tip.matches(':popover-open')) tip.hidePopover();
    if (!canPop) tip.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  const settle = (): void => {
    if (hovering || focused || pinned) show();
    else if (shown && hideTimer === null) hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  };

  const close = (): void => {
    hovering = false;
    focused = false;
    pinned = false;
    hide();
  };

  const inside = (node: EventTarget | null): boolean => node instanceof Node && (button.contains(node) || tip.contains(node));

  const wire = (target: HTMLElement): void => {
    target.addEventListener('pointerenter', () => {
      hovering = true;
      settle();
    });
    target.addEventListener('pointerleave', (event) => {
      if (inside(event.relatedTarget)) return;
      hovering = false;
      settle();
    });
    target.addEventListener('focusin', () => {
      focused = true;
      settle();
    });
    target.addEventListener('focusout', (event) => {
      if (inside(event.relatedTarget)) return;
      focused = false;
      settle();
    });
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !shown) return;
      // The tip closes first; the menu around it closes on the next Escape.
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus({ preventScroll: true });
    });
  };
  wire(button);
  wire(tip);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    pinned = !pinned;
    if (pinned) show();
    else {
      hovering = false;
      hide();
    }
  });
  tip.addEventListener('click', (event) => event.stopPropagation());
  // Following a link in the tip closes it before the link's own handler runs.
  tip.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('a, button') !== null) close();
    },
    true,
  );

  return createElement('span', { class: `${prefix}__help-wrap`, ...(options.role === undefined ? {} : { role: 'none' }) }, [button, tip]);
}
