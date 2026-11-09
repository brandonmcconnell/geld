// @vitest-environment happy-dom
import { bitbucketListRows } from './list-surfaces';
import { describeBitbucketPage } from './page';

beforeEach(() => {
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED';
  // Reduced from the anonymous November 1, 2026 installed Chrome PR list capture.
  document.body.innerHTML = '<table><tbody><tr data-qa="pull-request-row"><td colspan="14"><div><div><div role="presentation"><span style="anchor-name: --anchor-native-title"><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></span></div></div><small><span data-testid="user-profile-card-trigger-wrapper">Albert Sundjaja</span> - #27</small></div></td><td colspan="23"><div><div role="presentation"><span><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></span></div></div></td></tr></tbody></table>';
});

it('supports both native responsive title hosts without guessing a username from the display name', () => {
  const rows = bitbucketListRows(document);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.root).toBe(rows[1]?.root);
  expect(rows[0]?.host).not.toBe(rows[1]?.host);
  expect(rows.every((row) => row.url === 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27' && row.author === null)).toBe(true);
  expect(rows[0]?.host.querySelector('a')?.textContent).toBe('BCAT-6005: Support API token');
});

it('rejects foreign links and clones rather than creating chips outside native review rows', () => {
  const row = document.querySelector('tr');
  if (row === null) throw new Error('Missing row');
  row.querySelector('a')?.setAttribute('href', 'https://example.com/a/b/pull-requests/1');
  row.querySelectorAll('a')[1]?.setAttribute('href', '/atlassian/bitbucket-upload-file/issues/27');
  document.body.insertAdjacentHTML('beforeend', '<section data-geld-ui><table><tr data-qa="pull-request-row"><td><span><a data-qa="pull-request-row-link" href="/a/b/pull-requests/1">Clone</a></span></td></tr></table></section>');
  expect(bitbucketListRows(document)).toEqual([]);
});

it('keeps count pointer and focus events outside the native title tooltip while preserving native listeners and attributes', () => {
  const row = bitbucketListRows(document)[0];
  const title = row?.host.querySelector<HTMLAnchorElement>('a[data-qa="pull-request-row-link"]');
  const label = title?.parentElement;
  const tooltip = label?.parentElement;
  if (row === undefined || title === null || title === undefined || label === null || label === undefined || tooltip === null || tooltip === undefined) throw new Error('Missing native title fixture');
  tooltip.setAttribute('aria-describedby', 'native-title-tooltip');
  const pointer = vi.fn();
  const focus = vi.fn();
  const click = vi.fn((event: Event) => event.preventDefault());
  tooltip.addEventListener('mouseover', pointer);
  tooltip.addEventListener('focusin', focus);
  title.addEventListener('click', click);
  const original = tooltip.outerHTML;
  const chip = document.createElement('span');
  chip.className = 'geld-provider-list-counts';
  chip.setAttribute('data-geld-ui', '');
  chip.tabIndex = 0;
  row.host.append(chip);
  chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  chip.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  expect(pointer).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  expect(tooltip.contains(chip)).toBe(false);
  expect(label.contains(chip)).toBe(false);
  expect(chip.previousElementSibling).toBe(tooltip);
  expect(tooltip.parentElement).toBe(row.host);
  expect(tooltip.outerHTML).toBe(original);
  expect(label.firstElementChild).toBe(title);
  title.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  title.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  title.click();
  expect(pointer).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(bitbucketListRows(document)[0]?.host).toBe(row.host);
  chip.remove();
  expect(tooltip.outerHTML).toBe(original);
});

it.each(['wrapper', 'label', 'line', 'sibling', 'interactive'])('leaves unknown %s layouts untouched instead of mounting inside a tooltip trigger', (variant) => {
  const title = document.querySelector('a[data-qa="pull-request-row-link"]');
  const label = title?.parentElement;
  const tooltip = label?.parentElement;
  const line = tooltip?.parentElement;
  if (title === null || label === null || label === undefined || tooltip === null || tooltip === undefined || line === null || line === undefined) throw new Error('Missing native title fixture');
  if (variant === 'wrapper') tooltip.removeAttribute('role');
  if (variant === 'label') label.append(document.createElement('span'));
  if (variant === 'line') line.setAttribute('data-geld-ui', '');
  if (variant === 'sibling') line.append(document.createElement('span'));
  if (variant === 'interactive') line.setAttribute('role', 'button');
  const original = document.body.innerHTML;
  expect(bitbucketListRows(document)).toHaveLength(1);
  expect(document.body.innerHTML).toBe(original);
});

it('accepts the native comment permalink aliases while preserving canonical review identity', () => {
  const base = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  expect(describeBitbucketPage(new URL(`${base}/_/diff#comment-471253038`))).toMatchObject({ kind: 'diff', number: '22', url: base, diffPageUrl: `${base}/diff` });
  expect(describeBitbucketPage(new URL(`${base}/_/overview#comment-471253038`))).toMatchObject({ kind: 'overview', number: '22', url: base });
  expect(describeBitbucketPage(new URL(`${base}/overview`))).toMatchObject({ kind: 'overview', number: '22', url: base, diffPageUrl: `${base}/diff` });
  expect(describeBitbucketPage(new URL(`${base}/overview/#comment-471253038`))).toMatchObject({ kind: 'overview', number: '22', url: base });
  for (const route of ['_/commits', '_/activity', '_/diff/other', '_/overview/other', 'overview/other']) expect(describeBitbucketPage(new URL(`${base}/${route}`))).toBeNull();
});
