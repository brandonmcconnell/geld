// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { DescriptionMenuContext } from './description-menu';
import { blockRequest, descriptionActions, removeDescriptionMenu, reportContentUrl, syncDescriptionMenu, unblockRequest } from './description-menu';

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

  it('offers unblock, and the organization’s blocks, for someone already blocked', () => {
    expect(descriptionActions({ ...base, mayBlockFromOrg: true, blocked: { org: true, personal: true } })).toEqual(['copy-link', 'copy-markdown', 'report', 'unblock', 'org-blocks']);
  });

  it('never offers to block an App or an author whose blocks are unknown', () => {
    expect(descriptionActions({ ...base, author: 'dependabot[bot]' })).toEqual(['copy-link', 'copy-markdown', 'report']);
    expect(descriptionActions({ ...base, blocksKnown: false })).toEqual(['copy-link', 'copy-markdown', 'report']);
  });
});

describe('requests', () => {
  it('links the report form as GitHub’s comment menus do', () => {
    expect(reportContentUrl('https://github.com', 'https://github.com/o/r/pull/7', 'spammer')).toBe('https://github.com/contact/report-content?content_url=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7&report=spammer+(user)');
  });

  it('sends a personal block as GitHub’s dialog does', () => {
    const request = blockRequest('personal', 'spammer', 'mintlify', 'PR_kw123', 'https://github.com/o/r/pull/7', 'nonce');
    expect(request.url).toBe('/settings/blocked_users');
    expect(request.init.method).toBe('POST');
    expect(String(request.init.body)).toBe('content_id=PR_kw123&login=spammer&return_to=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F7');
    expect(request.init.headers).toEqual({ 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', 'X-Fetch-Nonce': 'nonce' });
  });

  it('sends an organization block until unblocked, with no content id when the page names none', () => {
    const request = blockRequest('org', 'spammer', 'mintlify', null, 'https://github.com/o/r/pull/7', '');
    expect(request.url).toBe('/organizations/mintlify/settings/blocked_users');
    expect(String(request.init.body)).toBe('duration=0&login=spammer');
    expect(request.init.headers).toEqual({ 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' });
  });

  it('unblocks with a DELETE of the person’s entry', () => {
    const request = unblockRequest('spammer', '');
    expect(request.url).toBe('/settings/blocked_users/spammer');
    expect(request.init.method).toBe('DELETE');
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
    expect(labels).toEqual(['Copy link', 'Copy Markdown', 'Report content', 'Block user']);
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true');
  });

  it('goes when the page is no longer one it dresses', () => {
    const meta = page();
    syncDescriptionMenu(base);
    syncDescriptionMenu(null);
    expect(meta.querySelector('[data-geld-desc-menu]')).toBeNull();
  });
});
