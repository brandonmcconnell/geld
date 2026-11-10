// @vitest-environment happy-dom
import { renderProviderActionControls } from './action-controls';
import type { ProviderActionControls } from './action-controls';
import type { ProviderReviewAction } from './types';

let controls: ProviderActionControls | undefined;
afterEach(() => { controls?.destroy();controls = undefined;document.body.innerHTML = '';vi.restoreAllMocks(); });

function action(kind: ProviderReviewAction['kind'], extra: Partial<ProviderReviewAction> = {}): ProviderReviewAction {
  return { kind, available: true, activate: async () => true, ...extra };
}

function mount(actions: readonly ProviderReviewAction[]) {
  const activate = vi.fn(async () => true);
  controls = renderProviderActionControls(document, 'Bitbucket', actions, activate);
  document.body.append(controls.element);
  return { root: controls.element, activate };
}

function button(root: HTMLElement, selector: string): HTMLButtonElement {
  const result = root.querySelector<HTMLButtonElement>(selector);
  if (result === null) throw new Error(`Missing ${selector}`);
  return result;
}

it('ordinary Bitbucket verdict clicks offer a native comment handoff before any submission intent', async () => {
  const approve = action('approve', { requiresConfirmation: true, instant: async () => true });
  const comment = action('comment');
  const { root, activate } = mount([approve, comment]);
  button(root, '[data-geld-review-action="approve"]').click();
  expect(activate).not.toHaveBeenCalled();
  const panel = root.querySelector<HTMLElement>('[role="dialog"]');
  expect(panel?.textContent).toContain('write it in Bitbucket, then return here to approve');
  button(root, '[role="dialog"] button').click();
  expect(activate).toHaveBeenCalledExactlyOnceWith(comment, false, 'comment');
  await vi.waitFor(() => expect(root.querySelector('[role="dialog"]')).toBeNull());
  button(root, '[data-geld-review-action="approve"]').click();
  button(root, '[role="dialog"] button:last-child').click();
  expect(activate).toHaveBeenLastCalledWith(approve, false, undefined);
});

it.each(['MacIntel', 'Linux x86_64'])('only the matching instant modifier submits without opening choices on %s', async platform => {
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
  const approve = action('approve', { requiresConfirmation: true, instant: async () => true });
  const { root, activate } = mount([approve]);
  const trigger = button(root, '[data-geld-review-action="approve"]');
  const mac = platform === 'MacIntel';
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: !mac, ctrlKey: mac }));
  expect(activate).not.toHaveBeenCalled();
  expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: mac, ctrlKey: !mac }));
  expect(activate).toHaveBeenCalledExactlyOnceWith(approve, true, undefined);
  await vi.waitFor(() => expect(root.querySelector('[role="dialog"]')).toBeNull());
});

it('does not manufacture an instant capability when the native adapter only supports opening a review', () => {
  const approve = action('approve');
  const { root, activate } = mount([approve]);
  const trigger = button(root, '[data-geld-review-action="approve"]');
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true }));
  expect(activate).toHaveBeenCalledExactlyOnceWith(approve, false, undefined);
  expect(trigger.title).toBe('Approve');
});

it('offers comment and review as separate native destinations without creating a second comment button', async () => {
  const comment = action('comment', { commentKinds: ['comment', 'review'] });
  const { root, activate } = mount([comment, action('open-review')]);
  expect(root.querySelectorAll('[data-geld-review-action="comment"]')).toHaveLength(1);
  button(root, '[data-geld-review-action="comment"]').click();
  expect([...root.querySelectorAll('[role="dialog"] button')].map(item => item.textContent)).toEqual(['Comment', 'Review']);
  button(root, '[role="dialog"] button:last-child').click();
  expect(activate).toHaveBeenCalledExactlyOnceWith(comment, false, 'review');
  await vi.waitFor(() => expect(root.querySelector('[role="dialog"]')).toBeNull());
});

it('routes a review-only GitLab writer to review rather than a nonexistent main comment form', () => {
  const review = action('comment', { commentKinds: ['review'] });
  const { root, activate } = mount([review]);
  button(root, '[aria-label="Review"]').click();
  expect(activate).toHaveBeenCalledExactlyOnceWith(review, false, 'review');
});

it('restores keyboard focus on Escape and removes popup listeners on teardown', () => {
  const { root, activate } = mount([action('approve', { requiresConfirmation: true })]);
  const trigger = button(root, '[data-geld-review-action="approve"]');
  trigger.click();
  expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  controls?.destroy();trigger.click();
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  expect(activate).not.toHaveBeenCalled();
});

it('prevents duplicate intent while awaiting the native handoff and reports its failure without claiming approval', async () => {
  let finish: ((value: boolean) => void) | undefined;
  const activate = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  controls = renderProviderActionControls(document, 'GitLab', [action('approve')], activate);
  document.body.append(controls.element);
  const trigger = button(controls.element, '[data-geld-review-action="approve"]');
  trigger.click();trigger.click();
  expect(activate).toHaveBeenCalledOnce();
  expect(trigger.disabled).toBe(true);
  finish?.(false);
  await vi.waitFor(() => expect(trigger.disabled).toBe(false));
  expect(controls.element.querySelector('[role="status"]')?.textContent).toBe('The review controls changed. Try again.');
});
