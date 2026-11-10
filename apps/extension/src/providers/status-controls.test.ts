// @vitest-environment happy-dom
import { ProviderStatusControls } from './status-controls';
import { readGitLabStatus } from '../gitlab/status';
import { describeGitLabPage } from '../gitlab/page';
import { readBitbucketStatus } from '../bitbucket/status';
import { describeBitbucketPage } from '../bitbucket/page';
import type { ProviderStatusAction } from './types';

vi.mock('wxt/utils/storage', () => ({ storage: {
  getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }),
} }));

let controls: ProviderStatusControls;
beforeEach(() => { controls = new ProviderStatusControls(); });
afterEach(() => { controls.clear();document.head.innerHTML = '';document.body.innerHTML = '';vi.restoreAllMocks(); });

function fixture(provider: 'gitlab' | 'bitbucket', state = 'Open'): () => ProviderStatusAction | null {
  if (provider === 'gitlab') {
    window.location.href = 'https://gitlab.com/group/project/-/merge_requests/7';
    document.body.innerHTML = `<div id="js-vue-mr-discussions" data-current-user-data='{"id":10}'></div>
      <div class="merge-request-sticky-header"><div class="detail-page-description"><span class="gl-badge" aria-label="${state}">${state}</span></div>
      <div data-testid="merge-request-actions"><button id="new-actions-header-dropdown" aria-label="Merge request actions">More</button></div></div>`;
    const page = describeGitLabPage(new URL(document.URL), document);
    if (page === null || !('number' in page)) throw new Error('Missing GitLab page');
    return () => readGitLabStatus(document, page);
  }
  window.location.href = 'https://bitbucket.org/workspace/project/pull-requests/7';
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":true,"uuid":"test-user"}\'>';
  document.body.innerHTML = `<div data-testid="pr-header"><a href="/workspace/project/src">project</a>
    <div data-qa="pr-branches-and-state-styles"><span class="native-status"><span>${state}</span></span><a>main</a></div><span>#7 • Created</span>
    <div data-qa="pr-header-actions-drop-down-menu-styles"><button aria-label="More actions">More</button></div></div>`;
  const page = describeBitbucketPage(new URL(document.URL));
  if (page === null) throw new Error('Missing Bitbucket page');
  return () => readBitbucketStatus(document, page);
}

function requiredAction(read: () => ProviderStatusAction | null): ProviderStatusAction {
  const value = read();if (value === null) throw new Error('Missing native status action');return value;
}

function owned(): HTMLButtonElement {
  const value = document.querySelector<HTMLButtonElement>('.geld-provider-status');
  if (value === null) throw new Error('Missing owned status button');return value;
}

describe.each(['gitlab', 'bitbucket'] as const)('%s native status relays', provider => {
  it('keeps the native label discoverable while its owned replacement is mounted, without update churn', async () => {
    const read = fixture(provider);
    const original = requiredAction(read);
    const clicked = vi.fn(() => original.control.setAttribute('aria-expanded', 'true'));
    original.control.addEventListener('click', clicked);
    controls.update(original);
    const button = owned();
    for (let i = 0; i < 5; i++) controls.update(read());
    expect(owned()).toBe(button);
    expect(requiredAction(read).label).toBe(original.label);
    expect(document.querySelectorAll('.geld-provider-status')).toHaveLength(1);
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'));
    expect(clicked).toHaveBeenCalledOnce();
    controls.clear();
    expect(original.label.style.display).toBe('');
    expect(original.label.hasAttribute('data-geld-status-replaced')).toBe(false);
    expect(requiredAction(read).label).toBe(original.label);
  });

  it('does not offer transitions for merged requests or anonymous visitors', () => {
    expect(fixture(provider, 'Merged')()).toBeNull();
    const read = fixture(provider);
    if (provider === 'gitlab') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', 'null');
    else document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":false}');
    expect(read()).toBeNull();
  });

  it.each(['disabled', 'aria-disabled', 'hidden', 'css-hidden', 'duplicate', 'navigation', 'actor', 'replaced'])('refuses a retained menu relay after %s changes', async condition => {
    const read = fixture(provider);
    const original = requiredAction(read);
    const clicked = vi.fn();original.control.addEventListener('click', clicked);
    controls.update(original);
    if (condition === 'disabled') original.control.disabled = true;
    if (condition === 'aria-disabled') original.control.setAttribute('aria-disabled', 'true');
    if (condition === 'hidden') original.label.hidden = true;
    if (condition === 'css-hidden') original.label.parentElement?.style.setProperty('display', 'none');
    if (condition === 'duplicate') original.control.after(original.control.cloneNode(true));
    if (condition === 'navigation') window.history.replaceState(null, '', provider === 'gitlab' ? '/group/project/-/merge_requests/8' : '/workspace/project/pull-requests/8');
    if (condition === 'actor') {
      if (provider === 'gitlab') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":11}');
      else document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":true,"uuid":"someone-else"}');
    }
    if (condition === 'replaced') original.control.replaceWith(original.control.cloneNode(true));
    expect(await original.activate()).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });
});

it('uses the newest same-owner descriptor and preserves external style changes on teardown', async () => {
  const original = requiredAction(fixture('gitlab'));
  original.label.style.setProperty('display', 'inline-flex');
  const oldActivate = vi.fn(async () => true);
  const newActivate = vi.fn(async () => true);
  controls.update({ ...original, activate: oldActivate });
  const button = owned();
  controls.update({ ...original, activate: newActivate });
  button.click();
  await vi.waitFor(() => expect(newActivate).toHaveBeenCalledOnce());
  expect(oldActivate).not.toHaveBeenCalled();
  original.label.style.setProperty('display', 'block');
  controls.clear();
  expect(original.label.style.display).toBe('block');
});

it('restores the original native inline display and hides only its own status replacement', () => {
  const original = requiredAction(fixture('gitlab', 'Closed'));
  original.label.style.setProperty('display', 'inline-flex', 'important');
  controls.update(original);controls.clear();
  expect(original.label.style.getPropertyValue('display')).toBe('inline-flex');
  expect(original.label.style.getPropertyPriority('display')).toBe('important');
  expect(document.querySelector('.geld-provider-status')).toBeNull();
});

it('does not invent a reopen transition for Bitbucket Declined', () => {
  expect(fixture('bitbucket', 'Declined')()).toBeNull();
});
