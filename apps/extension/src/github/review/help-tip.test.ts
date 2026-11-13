// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { helpTip } from './help-tip';

function mount(): { readonly menu: HTMLDetailsElement; readonly button: HTMLButtonElement; readonly link: HTMLButtonElement; readonly outside: HTMLButtonElement } {
  const menu = document.createElement('details');
  menu.open = true;
  const link = document.createElement('button');
  link.textContent = 'Request it';
  const outside = document.createElement('button');
  outside.textContent = 'Run';
  menu.append(helpTip({ prefix: 'geld-review', label: 'Don\u2019t see your preferred bot?', content: ['Don\u2019t see your preferred bot? ', link] }), outside);
  document.body.append(menu);
  // The panel's own menus close on an Escape that reaches the document (`installMenuDismissal`).
  document.addEventListener('keydown', closeMenus);
  const button = menu.querySelector<HTMLButtonElement>('.geld-review__help');
  if (button === null) throw new Error('no help icon');
  return { menu, button, link, outside };
}

function closeMenus(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  for (const open of document.querySelectorAll<HTMLDetailsElement>('details[open]')) open.removeAttribute('open');
}

function escape(from: Element): void {
  from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

const isOpen = (button: HTMLButtonElement): boolean => button.getAttribute('aria-expanded') === 'true';

afterEach(() => {
  document.removeEventListener('keydown', closeMenus);
  document.body.replaceChildren();
});

describe('helpTip', () => {
  it('opens on focus and stays open while focus moves into the tip', () => {
    const { button, link } = mount();
    button.focus();
    expect(isOpen(button)).toBe(true);
    link.focus();
    expect(isOpen(button)).toBe(true);
  });

  it('closes on Escape from its link and gives focus back to the icon without opening again', () => {
    const { menu, button, link } = mount();
    button.focus();
    link.focus();
    escape(link);
    expect(isOpen(button)).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(menu.open).toBe(true);
  });

  it('closes on Escape when opened by hovering with focus elsewhere, leaving the menu open until the next Escape', () => {
    const { menu, button, outside } = mount();
    outside.focus();
    button.dispatchEvent(new PointerEvent('pointerenter'));
    expect(isOpen(button)).toBe(true);
    escape(outside);
    expect(isOpen(button)).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(menu.open).toBe(true);
    escape(outside);
    expect(menu.open).toBe(false);
  });

  it('stays open after a click once the pointer leaves, and a second click closes it', () => {
    const { button } = mount();
    button.dispatchEvent(new PointerEvent('pointerenter'));
    button.click();
    button.dispatchEvent(new PointerEvent('pointerleave'));
    expect(isOpen(button)).toBe(true);
    button.click();
    expect(isOpen(button)).toBe(false);
  });
});
