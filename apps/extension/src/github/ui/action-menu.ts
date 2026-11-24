import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_CHECK } from './icons';
import { buttonInView, menuPlacement, scrollToShow } from './menu-placement';

/** One line of a menu: a link when it has an `href`, else a button. `checked` makes it one choice of a single-choice list. */
export interface ActionMenuItem {
  readonly label: string;
  /** Octicon markup, drawn before the words. A choice draws its check there instead. */
  readonly icon?: string;
  readonly href?: string;
  readonly checked?: boolean;
  readonly run?: () => void;
}

export interface ActionMenuOptions {
  readonly label: string;
  /** The box the button scrolls in: the menu follows the button while it shows there and closes once it is scrolled out. */
  readonly scroller?: HTMLElement;
  readonly onClose?: () => void;
}

interface OpenMenu {
  readonly element: HTMLElement;
  readonly button: HTMLElement;
  readonly keys: AbortController;
  readonly onClose: (() => void) | undefined;
}

const EDGE = 8;

let open: OpenMenu | null = null;

/** Whether the open menu hangs from a button inside `root`: what holds a redraw that would take the button away. */
export function actionMenuOpenIn(root: ParentNode): boolean {
  return open !== null && root.contains(open.button);
}

export function actionMenuOpenFor(button: HTMLElement): boolean {
  return open !== null && open.button === button;
}

export function closeActionMenu(): void {
  if (open === null) return;
  const { element, button, keys, onClose } = open;
  open = null;
  keys.abort();
  element.remove();
  button.setAttribute('aria-expanded', 'false');
  onClose?.();
}

/**
 * GitHub's ActionList menu under a button, at the body's level: the digest is a size container and its lists scroll
 * inside themselves, so a menu placed inside either is clipped or placed against the wrong box.
 */
export function openActionMenu(button: HTMLElement, items: readonly ActionMenuItem[], options: ActionMenuOptions): void {
  closeActionMenu();
  if (items.length === 0 || !button.isConnected) return;
  const element = createElement('div', { class: 'geld-desc-menu', [OWN_UI_ATTRIBUTE]: '', role: 'menu', 'aria-label': options.label, tabindex: '-1' });
  const nodes: HTMLElement[] = [];
  const focusBack = (): void => {
    if (button.isConnected) button.focus({ preventScroll: true });
  };
  for (const item of items) {
    const choice = item.checked !== undefined;
    const visual = createElement('span', { class: 'geld-desc-menu__visual', 'aria-hidden': 'true' }, [svgFromString(choice ? ICON_CHECK : (item.icon ?? ICON_CHECK))]);
    if ((choice && item.checked !== true) || (!choice && item.icon === undefined)) visual.style.visibility = 'hidden';
    const attributes = {
      class: 'geld-desc-menu__item',
      role: choice ? 'menuitemradio' : 'menuitem',
      ...(choice ? { 'aria-checked': String(item.checked === true) } : {}),
    };
    const content = [visual, createElement('span', { class: 'geld-desc-menu__label' }, [item.label])];
    const node = item.href !== undefined ? createElement('a', { ...attributes, href: item.href }, content) : createElement('button', { ...attributes, type: 'button' }, content);
    node.addEventListener('click', () => {
      closeActionMenu();
      focusBack();
      item.run?.();
    });
    nodes.push(node);
    element.append(node);
  }
  const keys = new AbortController();
  open = { element, button, keys, onClose: options.onClose };
  button.setAttribute('aria-expanded', 'true');
  document.body.append(element);
  const place = (): void => {
    if (!button.isConnected) {
      closeActionMenu();
      return;
    }
    const rect = button.getBoundingClientRect();
    const frame = options.scroller?.getBoundingClientRect();
    const shown = frame === undefined || (rect.bottom > frame.top && rect.top < frame.bottom);
    if (!shown || !buttonInView(rect, document.documentElement.clientHeight)) {
      closeActionMenu();
      return;
    }
    const left = Math.max(EDGE, Math.min(rect.right - element.offsetWidth, document.documentElement.clientWidth - element.offsetWidth - EDGE));
    element.style.left = `${Math.round(left)}px`;
    element.style.maxHeight = '';
    const { top, maxHeight } = menuPlacement(rect, element.offsetHeight, document.documentElement.clientHeight);
    element.style.top = `${Math.round(top)}px`;
    element.style.maxHeight = `${Math.floor(maxHeight)}px`;
  };
  place();
  if (open === null) return;
  const focusItem = (item: HTMLElement | undefined): void => {
    if (item === undefined) return;
    item.focus({ preventScroll: true });
    element.scrollTop = scrollToShow(element.scrollTop, element.clientHeight, item.offsetTop, item.offsetHeight);
  };
  focusItem(nodes.find((node) => node.getAttribute('aria-checked') === 'true') ?? nodes[0]);
  const { signal } = keys;
  element.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeActionMenu();
        focusBack();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const at = nodes.findIndex((node) => node === document.activeElement);
        focusItem(nodes[(at + (event.key === 'ArrowDown' ? 1 : nodes.length - 1)) % nodes.length]);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusItem(event.key === 'Home' ? nodes[0] : nodes[nodes.length - 1]);
      }
    },
    { signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target;
      if (target instanceof Node && (element.contains(target) || button.contains(target))) return;
      closeActionMenu();
    },
    { capture: true, signal },
  );
  element.addEventListener(
    'focusout',
    (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (element.contains(next) || button.contains(next))) return;
      closeActionMenu();
    },
    { signal },
  );
  window.addEventListener('scroll', place, { passive: true, signal });
  window.addEventListener('resize', place, { signal });
  options.scroller?.addEventListener('scroll', place, { passive: true, signal });
}
