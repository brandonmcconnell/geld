// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { copyProviderSummaryBody, ProviderSummaryPreviews } from './summary-preview';

let root: HTMLElement;
let previews: ProviderSummaryPreviews;
beforeEach(() => {
  vi.useFakeTimers();window.location.href = 'https://gitlab.com/group/project/-/merge_requests/1';
  root = document.createElement('section');document.body.append(root);previews = new ProviderSummaryPreviews(root);
});
afterEach(() => { previews.destroy();document.body.replaceChildren();vi.restoreAllMocks();vi.useRealTimers(); });

function bind(label: string, current = () => true): HTMLButtonElement {
  const button = document.createElement('button');button.type = 'button';button.textContent = label;root.append(button);
  const source = document.createElement('div');source.innerHTML = `<strong>${label} summary</strong>`;
  previews.bind(button, { label, url: `${window.location.href}#note_1`, fallback: 'Summary', body: () => source, current, open: event => event.preventDefault() });
  return button;
}

it('subscribes only for actual preview bindings and releases every subscription on clear', () => {
  previews.destroy();
  const windowAdd = vi.spyOn(window, 'addEventListener'), windowRemove = vi.spyOn(window, 'removeEventListener');
  const documentAdd = vi.spyOn(document, 'addEventListener'), documentRemove = vi.spyOn(document, 'removeEventListener');
  previews = new ProviderSummaryPreviews(root);
  expect(windowAdd).not.toHaveBeenCalled();expect(documentAdd).not.toHaveBeenCalled();
  bind('First review');
  const windowCount = windowAdd.mock.calls.length, documentCount = documentAdd.mock.calls.length;
  expect(windowCount).toBeGreaterThan(0);expect(documentCount).toBeGreaterThan(0);
  bind('Second review');expect(windowAdd).toHaveBeenCalledTimes(windowCount);expect(documentAdd).toHaveBeenCalledTimes(documentCount);
  previews.clear();expect(windowRemove).toHaveBeenCalledTimes(windowCount);expect(documentRemove).toHaveBeenCalledTimes(documentCount);
  previews.clear();expect(windowRemove).toHaveBeenCalledTimes(windowCount);expect(documentRemove).toHaveBeenCalledTimes(documentCount);
  bind('Next review');expect(windowAdd).toHaveBeenCalledTimes(windowCount * 2);expect(documentAdd).toHaveBeenCalledTimes(documentCount * 2);
  previews.destroy();expect(windowRemove).toHaveBeenCalledTimes(windowCount * 2);expect(documentRemove).toHaveBeenCalledTimes(documentCount * 2);
});

it('copies bounded readable markup without IDs, live controls, media requests or source mutation', () => {
  const source = document.createElement('div');
  source.innerHTML = '<p id="native-id" onclick="bad()">Review <strong>summary</strong><a href="https://example.com/report">report</a><a href="javascript:bad()">unsafe</a></p><details open><summary>Details</summary><p>Findings</p></details><button>Rerun</button><video src="https://gitlab.com/video.mp4"></video><img src="https://gitlab.com/image.png" alt="Preview image"><script>bad()</script>';
  const original = source.innerHTML;
  const copy = copyProviderSummaryBody(source, 'Fallback', document);
  expect(copy.querySelector('strong')?.textContent).toBe('summary');
  expect(copy.querySelector('[id],[onclick],button,video,img,script,details,summary')).toBeNull();
  expect(copy.textContent).toContain('DetailsFindings');expect(copy.textContent).toContain('Preview image');
  expect(copy.textContent).not.toContain('Rerun');
  expect(copy.querySelector('a[href]')?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(copy.querySelectorAll('a[href]')).toHaveLength(1);expect(source.innerHTML).toBe(original);
  source.textContent = 'x'.repeat(20000);expect(copyProviderSummaryBody(source, '', document).textContent).toHaveLength(12000);
});

it('hands off adjacent hover cards without an old leave timer closing the next card', () => {
  const first = bind('First review'), second = bind('Second review');
  first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  vi.advanceTimersByTime(149);expect(root.querySelector('[role="dialog"]')).toBeNull();
  vi.advanceTimersByTime(1);expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('First review');
  first.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  vi.advanceTimersByTime(100);
  second.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: first }));
  vi.advanceTimersByTime(150);
  expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Second review');
  vi.advanceTimersByTime(500);expect(second.getAttribute('aria-expanded')).toBe('true');
  expect(first.getAttribute('aria-expanded')).toBe('false');
});

it('allows the pointer to cross the gap into a card and dismisses it after leaving', () => {
  const button = bind('Review');button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));vi.advanceTimersByTime(150);
  const card = root.querySelector<HTMLElement>('[role="dialog"]')!;
  button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));vi.advanceTimersByTime(100);
  card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));vi.advanceTimersByTime(500);
  expect(card.isConnected).toBe(true);
  card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));vi.advanceTimersByTime(250);
  expect(card.isConnected).toBe(false);
});

it('dismisses pointer-only previews with Escape before the host consumes the key', () => {
  const button = bind('Review');button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));vi.advanceTimersByTime(150);
  const shortcut = vi.fn();document.addEventListener('keydown', shortcut);
  try {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(root.querySelector('[role="dialog"]')).toBeNull();expect(shortcut).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  } finally { document.removeEventListener('keydown', shortcut); }
});

it('supports focus, ArrowDown, click and Escape without reopening a dismissed card', () => {
  const button = bind('Review');button.focus();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const card = root.querySelector<HTMLElement>('[role="dialog"]')!;expect(document.activeElement).toBe(card);
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(button);expect(root.querySelector('[role="dialog"]')).toBeNull();
  vi.advanceTimersByTime(500);expect(root.querySelector('[role="dialog"]')).toBeNull();
  button.click();expect(document.activeElement).toBe(root.querySelector('[role="dialog"]'));
  root.querySelector<HTMLButtonElement>('[aria-label="Close review preview"]')!.click();
  expect(document.activeElement).toBe(button);expect(button.getAttribute('aria-expanded')).toBe('false');
});

it('retires changed sources, delayed intents and navigation without retaining a live card', async () => {
  let current = true;const button = bind('Review', () => current);button.focus();
  current = false;root.append(document.createElement('span'));await Promise.resolve();
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  current = true;button.click();expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  window.dispatchEvent(new Event('popstate'));expect(root.querySelector('[role="dialog"]')).toBeNull();
  button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));previews.clear();vi.advanceTimersByTime(500);
  expect(root.querySelector('[role="dialog"]')).toBeNull();expect(button.hasAttribute('aria-controls')).toBe(false);
});

it('preserves keyboard focus when the pointer crosses another chip and notices an externally removed card', async () => {
  const first = bind('First review'), second = bind('Second review');first.click();
  const card = root.querySelector<HTMLElement>('[role="dialog"]')!;
  second.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));vi.advanceTimersByTime(500);
  expect(root.querySelector('[role="dialog"]')).toBe(card);expect(document.activeElement).toBe(card);
  card.remove();await Promise.resolve();expect(first.getAttribute('aria-expanded')).toBe('false');
});
