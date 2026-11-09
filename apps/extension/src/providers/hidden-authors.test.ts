// @vitest-environment happy-dom
import type { ProviderListRow } from './types';
import { PROVIDER_AUTHOR_HIDDEN, ProviderHiddenAuthors } from './hidden-authors';

let hiding: ProviderHiddenAuthors | null = null;
const settings = { enabled: true, hiddenAuthors: ['bot-*'] };
const NOTE = '[data-geld-provider-author-note]';

beforeEach(() => { window.location.href = 'https://gitlab.com/group/project/-/merge_requests'; document.body.replaceChildren(); });
afterEach(() => { hiding?.clear(); hiding = null; document.body.replaceChildren(); });

function list(tag: 'ul' | 'ol' | 'div' | 'tbody' = 'ul'): HTMLElement {
  const root = document.createElement(tag);
  if (tag === 'tbody') {
    const table = document.createElement('table');
    table.append(root);
    document.body.append(table);
  } else document.body.append(root);
  return root;
}

function row(parent: HTMLElement, author: string | null, number: number): ProviderListRow {
  const root = document.createElement(parent.tagName === 'TBODY' ? 'tr' : parent.tagName === 'DIV' ? 'article' : 'li');
  root.id = `native-review-${number}`;
  const title = document.createElement('a');
  title.href = `https://gitlab.com/group/project/-/merge_requests/${number}`;
  title.textContent = `Native review ${number}`;
  const host = document.createElement('span');
  host.textContent = 'Native metadata';
  if (root.tagName === 'TR') {
    const titleCell = document.createElement('td');
    const metadataCell = document.createElement('td');
    metadataCell.colSpan = 2;
    titleCell.append(title);
    metadataCell.append(host);
    root.append(titleCell, metadataCell);
  } else root.append(title, host);
  parent.append(root);
  return { root, host, url: title.href, author };
}

function show(parent: HTMLElement): HTMLButtonElement {
  const button = parent.querySelector<HTMLButtonElement>(`${NOTE} button`);
  if (button === null) throw new Error('Missing Show button');
  return button;
}

it('folds unique matching native rows into one counted per-list note without changing native children or hidden state', () => {
  const parent = list();
  const visible = row(parent, 'alice', 1);
  const first = row(parent, 'bot-a', 2);
  const second = row(parent, 'bot-b', 3);
  const third = row(parent, 'bot-a', 4);
  const rows = [visible, first, second, third];
  const children = rows.map((item) => [...item.root.childNodes]);
  hiding = new ProviderHiddenAuthors('gitlab');
  const hidden = hiding.update([...rows, first], settings, 'visit');
  expect([...hidden]).toEqual([first.root, second.root, third.root]);
  expect(parent.querySelector(NOTE)?.tagName).toBe('LI');
  expect(parent.querySelector('[role="note"]')?.textContent).toBe('3 merge requests by bot-a, bot-b hiddenShow');
  expect(show(parent).type).toBe('button');
  expect(show(parent).getAttribute('aria-label')).toBe('Show 3 merge requests hidden by author filters');
  expect(parent.children[1]).toBe(parent.querySelector(NOTE));
  expect(rows.map((item) => [...item.root.childNodes])).toEqual(children);
  expect(rows.every((item) => item.root.parentElement === parent && !item.root.hidden)).toBe(true);
  expect(visible.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);
});

it('restores filtered rows on Show, preserves native handlers, and focuses the native review link for keyboard recovery', () => {
  const parent = list();
  const rows = [row(parent, 'bot-a', 1), row(parent, 'bot-b', 2)];
  const first = rows[0];
  if (first === undefined) throw new Error('Missing native row');
  const nativeHandler = vi.fn();
  first.root.querySelector('a')?.addEventListener('click', nativeHandler);
  const changed = vi.fn();
  hiding = new ProviderHiddenAuthors('gitlab', changed);
  hiding.update(rows, settings, 'visit');
  const button = show(parent);
  button.focus();
  button.click();
  expect(rows.every((item) => !item.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN))).toBe(true);
  expect(parent.querySelector(NOTE)).toBeNull();
  expect(changed).toHaveBeenCalledExactlyOnceWith(rows.map((item) => item.root));
  expect(document.activeElement).toBe(first.root.querySelector('a'));
  first.root.querySelector('a')?.click();
  expect(nativeHandler).toHaveBeenCalledOnce();
  const streamed = row(parent, 'bot-streamed', 3);
  expect(hiding.update([...rows, streamed], settings, 'visit').size).toBe(0);
  expect(parent.querySelector(NOTE)).toBeNull();
  expect(streamed.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);
});

it('keeps recovery local to each native list and restores absent rows without losing an existing Show choice', () => {
  const first = list('ol');
  const second = list('div');
  const a = row(first, 'bot-a', 1);
  const b = row(second, 'bot-b', 2);
  hiding = new ProviderHiddenAuthors('gitlab');
  hiding.update([a, b], settings, 'visit');
  show(first).click();
  expect(hiding.update([a, b], settings, 'visit')).toEqual(new Set([b.root]));
  expect(second.querySelector(NOTE)?.tagName).toBe('DIV');
  expect(hiding.update([], settings, 'visit').size).toBe(0);
  expect(second.querySelector(NOTE)).toBeNull();
  expect(b.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);
  expect(hiding.update([a, b], settings, 'visit')).toEqual(new Set([b.root]));
});

it('resets visit-local recovery when filters change, the visit changes, or the extension is disabled', () => {
  const parent = list();
  const rows = [row(parent, 'bot-a', 1)];
  hiding = new ProviderHiddenAuthors('gitlab');
  hiding.update(rows, settings, 'first');
  show(parent).click();
  expect(hiding.update(rows, settings, 'first').size).toBe(0);
  const changed = { ...settings, hiddenAuthors: ['bot-a'] };
  expect(hiding.update(rows, changed, 'first').size).toBe(1);
  show(parent).click();
  expect(hiding.update(rows, changed, 'second').size).toBe(1);
  expect(hiding.update(rows, { ...changed, enabled: false }, 'second').size).toBe(0);
  expect(parent.querySelector(NOTE)).toBeNull();
  expect(hiding.update(rows, changed, 'second').size).toBe(1);
});

it('leaves unknown author identities, native hidden rows and owned clones untouched', () => {
  const parent = list();
  const unknown = row(parent, null, 1);
  const nativeHidden = row(parent, 'bot-a', 2);
  nativeHidden.root.hidden = true;
  const owned = row(parent, 'bot-b', 3);
  owned.root.setAttribute('data-geld-ui', '');
  hiding = new ProviderHiddenAuthors('bitbucket');
  expect(hiding.update([unknown, nativeHidden, owned], { enabled: true, hiddenAuthors: ['*'] }, 'visit').size).toBe(0);
  expect(parent.querySelector(NOTE)).toBeNull();
  expect(unknown.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);
  hiding.clear();
  expect(nativeHidden.root.hidden).toBe(true);
});

it('uses a valid owned table row with the actual native column span while keeping native rows in place', () => {
  const parent = list('tbody');
  const native = row(parent, 'bot-a', 1);
  hiding = new ProviderHiddenAuthors('bitbucket');
  hiding.update([native], settings, 'visit');
  const notice = parent.querySelector(NOTE);
  expect(notice?.tagName).toBe('TR');
  expect(notice?.querySelector<HTMLTableCellElement>('td')?.colSpan).toBe(3);
  expect(notice?.querySelector('[role="note"]')?.textContent).toBe('1 pull request by bot-a hiddenShow');
  expect(notice?.hasAttribute('data-geld-ui')).toBe(true);
  expect(native.root.parentElement).toBe(parent);
  show(parent).click();
  expect(parent.children).toHaveLength(1);
  expect(parent.firstElementChild).toBe(native.root);
});

it('updates streamed counts, deduplicates author casing and bounds long author lists like GitHub', () => {
  const parent = list();
  const rows = ['bot-a', 'BOT-A', 'bot-b', 'bot-c', 'bot-d', 'bot-e'].map((author, index) => row(parent, author, index + 1));
  hiding = new ProviderHiddenAuthors('gitlab');
  hiding.update(rows, settings, 'visit');
  const notice = parent.querySelector(NOTE);
  expect(notice?.textContent).toBe('6 merge requests by bot-a, bot-b, bot-c and 2 more hiddenShow');
  rows[0]?.root.remove();
  hiding.update(rows.slice(1), settings, 'visit');
  expect(parent.querySelector(NOTE)).toBe(notice);
  expect(notice?.textContent).toContain('5 merge requests');
  hiding.update(rows.slice(1).map((item) => ({ ...item, author: 'alice' })), settings, 'visit');
  expect(parent.querySelector(NOTE)).toBeNull();
  expect(parent.querySelector(`[${PROVIDER_AUTHOR_HIDDEN}]`)).toBeNull();
});

it('rejects old notice callbacks after context changes and cleans detached rows and notes on clear', () => {
  const parent = list();
  const native = row(parent, 'bot-a', 1);
  const changed = vi.fn();
  hiding = new ProviderHiddenAuthors('gitlab', changed);
  hiding.update([native], settings, 'old');
  const old = show(parent);
  hiding.update([native], settings, 'new');
  old.click();
  expect(changed).not.toHaveBeenCalled();
  expect(native.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(true);
  parent.remove();
  hiding.clear();
  expect(native.root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)).toBe(false);
  expect(parent.querySelector(NOTE)).toBeNull();
  expect(hiding.update([native], settings, 'new').size).toBe(0);
});

it('counts visible responsive native cells once per notice/context and refreshes the same notice across viewport changes', () => {
  const parent = list('tbody');
  // Reduced observed Bitbucket dual-title cell structure; CSS toggles are a responsive protocol fixture.
  const root = document.createElement('tr');root.innerHTML = '<td class="desktop" colspan="14"><a href="https://bitbucket.org/a/b/pull-requests/27">Native desktop title</a></td><td class="mobile" colspan="23"><a href="https://bitbucket.org/a/b/pull-requests/27">Native mobile title</a></td>';parent.append(root);
  const host = root.querySelector<HTMLElement>('td');if (host === null) throw new Error('Missing cell');
  const style = document.createElement('style');style.textContent = '.mobile{display:none}.desktop{display:table-cell}';document.head.append(style);
  const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);const computed = vi.spyOn(window, 'getComputedStyle');
  const entry = { root, host, author: 'bot-a', url: 'https://bitbucket.org/a/b/pull-requests/27' };
  hiding = new ProviderHiddenAuthors('bitbucket');hiding.update([entry], settings, 'visit');
  const notice = parent.querySelector(`${NOTE} td`);expect(notice?.getAttribute('colspan')).toBe('14');expect(computed).toHaveBeenCalledTimes(2);
  for (let index = 0; index < 200; index += 1) hiding.update([entry], settings, 'visit');
  expect(computed).toHaveBeenCalledTimes(2);
  style.textContent = '.mobile{display:table-cell}.desktop{display:none}';width.mockReturnValue(500);window.dispatchEvent(new Event('resize'));
  expect(parent.querySelector(`${NOTE} td`)).toBe(notice);expect(notice?.getAttribute('colspan')).toBe('23');expect(computed).toHaveBeenCalledTimes(4);
  hiding.update([entry], settings, 'visit');expect(computed).toHaveBeenCalledTimes(4);
  hiding.clear();width.mockReturnValue(400);window.dispatchEvent(new Event('resize'));expect(computed).toHaveBeenCalledTimes(4);
  style.remove();vi.restoreAllMocks();
});
