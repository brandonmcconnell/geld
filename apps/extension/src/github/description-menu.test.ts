// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLOCK_CHOICES } from './block-dialog';
import type { DescriptionMenuContext } from './description-menu';

const fetched = vi.hoisted(() => ({ response: new Response('{}', { status: 200 }) }));
vi.mock('./page-fetch', () => ({ pageFetch: async () => fetched.response }));
import { blockRequest, buttonInView, descriptionActions, menuPlacement, scrollToShow, removeDescriptionMenu, reportContentUrl, syncDescriptionMenu, unblockRequest } from './description-menu';

const base: DescriptionMenuContext = { viewer: 'brandon', author: 'spammer', owner: 'mintlify', blocksKnown: true, blocked: null, mayBlockFromOrg: false };

describe('descriptionActions', () => {
  it('offers only copying signed out', () => {
    expect(descriptionActions({ ...base, viewer: '' })).toEqual(['copy-link', 'copy-markdown']);
  });

  it('offers nothing about the author on the reader’s own pull request', () => {
    expect(descriptionActions({ ...base, author: 'Brandon' })).toEqual(['copy-link', 'copy-markdown']);
  });

  it('offers report and a personal block for someone else’s pull request', () => {
    expect(descriptionActions(base)).toEqual(['copy-link', 'copy-markdown', 'report', 'block']);
  });

  it('offers the organization block only to someone who may read its Blocked users', () => {
    expect(descriptionActions({ ...base, mayBlockFromOrg: true })).toEqual(['copy-link', 'copy-markdown', 'report', 'block', 'block-org']);
  });

  it('offers both unblocks for someone already blocked', () => {
    expect(descriptionActions({ ...base, mayBlockFromOrg: true, blocked: { org: true, personal: true } })).toEqual(['copy-link', 'copy-markdown', 'report', 'unblock', 'unblock-org']);
  });

  it('never offers to block an App, nor a personal block before the reader’s list is read', () => {
    expect(descriptionActions({ ...base, author: 'dependabot[bot]', mayBlockFromOrg: true })).toEqual(['copy-link', 'copy-markdown', 'report']);
    expect(descriptionActions({ ...base, blocksKnown: false })).toEqual(['copy-link', 'copy-markdown', 'report']);
    expect(descriptionActions({ ...base, blocksKnown: false, mayBlockFromOrg: true })).toEqual(['copy-link', 'copy-markdown', 'report', 'block-org']);
  });
});

describe('menuPlacement', () => {
  it('opens under the button when the menu fits there', () => {
    expect(menuPlacement({ top: 100, bottom: 128 }, 200, 1000)).toEqual({ top: 132, maxHeight: 860 });
  });

  it('opens above the button when only above has the room', () => {
    expect(menuPlacement({ top: 700, bottom: 728 }, 200, 800)).toEqual({ top: 496, maxHeight: 688 });
  });

  it('stays below, capped to the room, when below has more of it', () => {
    expect(menuPlacement({ top: 100, bottom: 128 }, 900, 800)).toEqual({ top: 132, maxHeight: 660 });
  });

  it('caps an upward menu to the room above', () => {
    expect(menuPlacement({ top: 300, bottom: 328 }, 900, 400)).toEqual({ top: 8, maxHeight: 288 });
  });
});

describe('buttonInView', () => {
  it('holds while any of the button shows and fails once it has scrolled out', () => {
    expect(buttonInView({ top: -10, bottom: 18 }, 800)).toBe(true);
    expect(buttonInView({ top: -128, bottom: -100 }, 800)).toBe(false);
    expect(buttonInView({ top: 810, bottom: 838 }, 800)).toBe(false);
  });
});

describe('scrollToShow', () => {
  it('leaves an item in view where it is', () => {
    expect(scrollToShow(0, 100, 40, 33)).toBe(0);
  });

  it('scrolls down just enough for an item below the view', () => {
    expect(scrollToShow(0, 100, 140, 33)).toBe(73);
  });

  it('scrolls up to an item above the view', () => {
    expect(scrollToShow(120, 100, 8, 33)).toBe(8);
  });
});

describe('requests', () => {
  it('links the report form as GitHub’s comment menus do', () => {
    expect(reportContentUrl('https://github.com', 'https://github.com/o/r/pull/7', 'spammer')).toBe('https://github.com/contact/report-content?content_url=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7&report=spammer+(user)');
  });

  it('sends a personal block as GitHub’s dialog does', () => {
    const request = blockRequest('personal', 'spammer', 'mintlify', 'PR_kw123', 'https://github.com/o/r/pull/7', DEFAULT_BLOCK_CHOICES, 'nonce');
    expect(request.url).toBe('/settings/blocked_users');
    expect(request.init.method).toBe('POST');
    expect(String(request.init.body)).toBe('content_id=PR_kw123&login=spammer&return_to=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7');
    expect(request.init.headers).toEqual({ 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', 'X-Fetch-Nonce': 'nonce' });
  });

  it('sends a personal block’s note and closing of their content when chosen', () => {
    const request = blockRequest('personal', 'spammer', 'mintlify', 'PR_kw123', 'https://github.com/o/r/pull/7', { ...DEFAULT_BLOCK_CHOICES, note: 'spam run', closeContent: true }, '');
    expect(String(request.init.body)).toBe('content_id=PR_kw123&login=spammer&return_to=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7&note=spam+run&close_content=1');
  });

  it('sends an organization block with GitHub’s defaults: until unblocked, notified, comments shown', () => {
    const request = blockRequest('org', 'spammer', 'mintlify', null, 'https://github.com/o/r/pull/7', DEFAULT_BLOCK_CHOICES, '');
    expect(request.url).toBe('/organizations/mintlify/settings/blocked_users');
    expect(String(request.init.body)).toBe('duration=0&login=spammer&send_notification=on');
    expect(request.init.headers).toEqual({ 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' });
  });

  it('sends every organization option in GitHub’s order', () => {
    const request = blockRequest('org', 'spammer', 'mintlify', 'PR_kw123', '', { duration: 'SEVEN_DAYS', note: 'n', closeContent: true, notify: false, hideReason: 'SPAM' }, '');
    expect(String(request.init.body)).toBe('duration=7&content_id=PR_kw123&login=spammer&hide_comments=on&hidden_reason=SPAM&note=n&close_content=1');
  });

  it('unblocks with a DELETE of the person’s entry, in the reader’s list or the organization’s', () => {
    const personal = unblockRequest('personal', 'spammer', 'mintlify', '');
    expect(personal.url).toBe('/settings/blocked_users/spammer');
    expect(personal.init.method).toBe('DELETE');
    expect(unblockRequest('org', 'spammer', 'mintlify', '').url).toBe('/organizations/mintlify/settings/blocked_users/spammer');
  });
});

describe('syncDescriptionMenu', () => {
  afterEach(() => {
    removeDescriptionMenu();
    document.body.innerHTML = '';
  });

  const page = (): HTMLElement => {
    document.body.innerHTML = '<section aria-label="Description"><div class="body__x"><div class="editMetadata__y"><button aria-label="Edit description">✎</button></div><div class="markdown-body"><p>Hi</p></div></div></section>';
    const meta = document.querySelector<HTMLElement>('[class*="editMetadata"]');
    if (meta === null) throw new Error('no meta');
    return meta;
  };

  it('stands after the Edit pencil once and opens to the author’s actions', () => {
    const meta = page();
    syncDescriptionMenu(base);
    syncDescriptionMenu(base);
    const buttons = meta.querySelectorAll('button[aria-haspopup="menu"]');
    expect(buttons).toHaveLength(1);
    expect(meta.lastElementChild?.contains(buttons[0] ?? null)).toBe(true);
    buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const labels = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent);
    expect(labels).toEqual(['Copy link', 'Copy Markdown', 'Report content', 'Block user for you']);
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves the clipboard alone when GitHub does not send the Markdown', async () => {
    history.replaceState(null, '', '/o/r/pull/7');
    fetched.response = new Response('oops', { status: 502 });
    const writeText = vi.fn(async () => undefined);
    // A browser's write rejects when the text it was handed rejects.
    const write = vi.fn(async () => Promise.reject(new Error('text rejected')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, write } });
    const alert = vi.fn();
    Object.defineProperty(window, 'alert', { configurable: true, value: alert });
    page();
    syncDescriptionMenu(base);
    document.querySelector('[data-geld-desc-menu] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const copy = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Copy Markdown');
    copy?.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
  });

  it('closes an open menu when GitHub draws the description row anew', () => {
    page();
    syncDescriptionMenu(base);
    document.querySelector('[data-geld-desc-menu] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.geld-desc-menu')).not.toBeNull();
    // Only the section is drawn anew, as GitHub does: the menu stays in the body until the pass closes it.
    const fresh = document.createElement('section');
    fresh.setAttribute('aria-label', 'Description');
    fresh.innerHTML = '<div class="body__x"><div class="editMetadata__y"><button aria-label="Edit description">✎</button></div></div>';
    document.querySelector('section[aria-label="Description"]')?.replaceWith(fresh);
    expect(document.querySelector('.geld-desc-menu')).not.toBeNull();
    syncDescriptionMenu({ ...base, author: 'someone-else' });
    expect(document.querySelector('.geld-desc-menu')).toBeNull();
    expect(document.querySelectorAll('[data-geld-desc-menu]')).toHaveLength(1);
  });

  it('says so when the link cannot be copied', async () => {
    const alert = vi.fn();
    Object.defineProperty(window, 'alert', { configurable: true, value: alert });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    page();
    syncDescriptionMenu(base);
    document.querySelector('[data-geld-desc-menu] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Copy link')?.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
  });

  it('goes when the page is no longer one it dresses', () => {
    const meta = page();
    syncDescriptionMenu(base);
    syncDescriptionMenu(null);
    expect(meta.querySelector('[data-geld-desc-menu]')).toBeNull();
  });
});
