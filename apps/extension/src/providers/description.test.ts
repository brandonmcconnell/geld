// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderDescription } from './description';

let view: ProviderDescription;
let body: HTMLElement;
beforeEach(() => {
  body = document.createElement('div');document.body.append(body);view = new ProviderDescription();
});
afterEach(() => { view.clear();document.body.replaceChildren();vi.restoreAllMocks(); });
function toggle(label: string): HTMLButtonElement {
  const button = [...body.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === label);
  if (button === undefined) throw new Error(`Missing ${label}`);
  return button;
}

it('opens the heading-first section and preserves leading prose while folding later sections', () => {
  body.innerHTML = '<h2>Summary</h2><p>Visible summary</p><h2>Testing</h2><p>Test results</p>';
  const nodes = [...body.children];view.update(body, 'mr1');
  expect(nodes[1]?.hasAttribute('hidden')).toBe(false);expect(nodes[3]?.getAttribute('hidden')).toBe('until-found');
  toggle('Expand Testing').click();expect(nodes[3]?.hasAttribute('hidden')).toBe(false);
  view.clear();expect([...body.children]).toEqual(nodes);expect(body.querySelector('button')).toBeNull();
  body.innerHTML = '<p>Leading prose</p><h2>Testing</h2><p>Tests</p>';view.update(body, 'mr2');
  expect(body.firstElementChild?.hasAttribute('hidden')).toBe(false);expect(body.lastElementChild?.getAttribute('hidden')).toBe('until-found');
});

it('opens nested heading containers and remembers choices through native body replacement', () => {
  const html = '<h2>Details</h2><h3>Tests</h3><p>Results</p><h2>Notes</h2><p>Other notes</p>';
  body.innerHTML = html;view.update(body, 'mr1');
  expect(body.children[1]?.hasAttribute('hidden')).toBe(false);expect(body.children[2]?.getAttribute('hidden')).toBe('until-found');
  toggle('Expand Tests').click();body.innerHTML = html;view.update(body, 'mr1');
  expect(body.children[2]?.hasAttribute('hidden')).toBe(false);toggle('Collapse Tests');
  view.update(body, 'mr2');expect(body.children[2]?.getAttribute('hidden')).toBe('until-found');
});

it('restores existing hidden state and does not invent controls for blank or empty headings', () => {
  body.innerHTML = '<h2>Summary</h2><p>Intro</p><h2>Details</h2><p hidden>Native hidden</p><h2>\u200b</h2><h2>Empty</h2>';
  const native = body.querySelector('p[hidden]');view.update(body, 'mr');
  expect(body.querySelectorAll('button')).toHaveLength(2);
  view.clear();expect(native?.getAttribute('hidden')).toBe('');
});

it('reveals matching text through all folded ancestors for native find and reference navigation', () => {
  body.innerHTML = '<p>Intro</p><h2>Details</h2><h3>Tests</h3><p>Search result</p>';
  view.update(body, 'mr');toggle('Collapse Details').click();
  const result = body.lastElementChild!;expect(result.getAttribute('hidden')).toBe('until-found');
  result.dispatchEvent(new Event('beforematch', { bubbles: true }));
  expect(result.hasAttribute('hidden')).toBe(false);toggle('Collapse Details');toggle('Collapse Tests');
  toggle('Collapse Tests').click();view.reveal(result);expect(result.hasAttribute('hidden')).toBe(false);
});

it('caps long rendered content at 500px and preserves the explicit full-description choice', async () => {
  body.innerHTML = '<p>Long rendered prose</p>';Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 });
  view.update(body, 'mr');
  await vi.waitFor(() => expect(body.hasAttribute('data-geld-provider-description-capped')).toBe(true));
  const more = document.querySelector<HTMLButtonElement>('.geld-provider-description-toggle')!;
  expect(more.textContent).toBe('Show full description');more.click();
  expect(body.hasAttribute('data-geld-provider-description-capped')).toBe(false);expect(more.getAttribute('aria-expanded')).toBe('true');
  view.update(null, 'mr');view.update(body, 'mr');
  await vi.waitFor(() => expect(document.querySelector('.geld-provider-description-toggle')).not.toBeNull());
  expect(body.hasAttribute('data-geld-provider-description-capped')).toBe(false);
  view.clear();expect(document.querySelector('.geld-provider-description-toggle')).toBeNull();
});
