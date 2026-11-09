// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATTR_WHO, HOVER_DELAY_MS, hideHoverCard, LEAVE_GRACE_MS, setWhoProvider } from './hovercard';

function pill(login: string): { readonly pill: HTMLElement; readonly icon: HTMLElement; readonly name: HTMLElement } {
  const icon = document.createElement('img');
  const name = document.createElement('span');
  name.textContent = login;
  const host = document.createElement('a');
  host.setAttribute(ATTR_WHO, login);
  host.append(icon, name);
  return { pill: host, icon, name };
}

function move(from: Element, to: Element): void {
  from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
  to.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: from }));
}

function shownName(): string | null {
  return document.querySelector('.geld-review-hovercard__name')?.textContent ?? null;
}

describe('bot pill hover cards', () => {
  afterEach(() => {
    hideHoverCard();
    setWhoProvider(null);
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("shows the next pill's card when the pointer crosses to its picture or words while the last card closes", () => {
    vi.useFakeTimers();
    setWhoProvider((login) => ({ avatarSrc: null, name: login, login, bot: true, detail: '', href: null }));
    const row = document.createElement('div');
    const a = pill('greptile-apps[bot]');
    const b = pill('coderabbitai[bot]');
    row.append(a.pill, b.pill);
    document.body.append(row);
    move(document.body, a.name);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(shownName()).toBe('greptile-apps[bot]');
    // Through the gap between the pills, then onto the next pill's picture, landing inside the last card's grace.
    move(a.name, row);
    vi.advanceTimersByTime(100);
    move(row, b.icon);
    vi.advanceTimersByTime(LEAVE_GRACE_MS - 100);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(shownName()).toBe('coderabbitai[bot]');
  });
});
