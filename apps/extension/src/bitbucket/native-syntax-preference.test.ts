// @vitest-environment happy-dom
import { BitbucketNativeSyntaxPreference } from './native-syntax-preference';
import type { BitbucketSyntaxCapability } from './workflow-syntax';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const sessions: BitbucketNativeSyntaxPreference[] = [];
const trusted = new WeakSet<Event>();

function input(node: Element, type = 'click', accepted = true): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  if (accepted) trusted.add(event);
  node.dispatchEvent(event);return event;
}

function frame(count = 2): void {
  for (let index = 0; index < count; index += 1) {
    const pending = [...frames.values()];frames.clear();for (const callback of pending) callback(0);
  }
}

function fixture(runtime = false) {
  const changed = vi.fn<(state: BitbucketSyntaxCapability) => void>();
  const preference = new BitbucketNativeSyntaxPreference(document, changed, runtime ? {} : { unitOnly: { trusted: (event) => trusted.has(event) } });
  sessions.push(preference);
  const opener = document.querySelector<HTMLButtonElement>('[data-testid="settingsButton"]');
  if (opener === null) throw new Error('Missing native opener protocol');
  const open = (checked: boolean, accepted = true, readyFrames = 2) => {
    input(opener, 'click', accepted);
    const dialog = document.createElement('section');dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<form><label for="diff-settings-syntax-highlighting-toggle">Syntax highlighting</label><input type="checkbox" id="diff-settings-syntax-highlighting-toggle" name="enableSyntaxHighlighting" value="enableSyntaxHighlighting"><label>Other preference<input name="other" type="checkbox"></label><button type="button">Cancel</button><button type="submit">Save</button></form>';
    const field = dialog.querySelector<HTMLInputElement>('input');const cancel = dialog.querySelector<HTMLButtonElement>('button');const form = dialog.querySelector('form');
    if (field === null || cancel === null || form === null) throw new Error('Missing native form protocol');
    field.checked = checked;document.body.append(dialog);preference.read();frame(readyFrames);
    return { dialog, form, field, cancel, close: (accepted = true) => { input(cancel, 'click', accepted);dialog.remove();return preference.read(); } };
  };
  preference.read();return { preference, changed, opener, open };
}

beforeEach(() => {
  window.location.href = 'https://bitbucket.org/workspace/repo/pull-requests/7/diff#chg-bitbucket-pipelines.yml';
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\' data-target-workspace-uuid="02b941e3-cfaa-40f9-9a58-cec53e20bdc3">';
  document.body.innerHTML = '<section role="tabpanel" id="pull-request-tabs-1-tab"><button type="button" data-testid="settingsButton" aria-label="Open modal window: diff display settings">Settings</button><div role="region" aria-label="Diff">Original source</div></section>';
  // Explicit unit-only layout/trust protocol. Runtime supplies neither forged events nor dimensions.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 80, 30));
  frames = new Map();nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { const id = ++nextFrame;frames.set(id, callback);return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
});
afterEach(() => { for (const preference of sessions.splice(0)) preference.clear();document.body.replaceChildren();document.head.replaceChildren();vi.restoreAllMocks();vi.useRealTimers(); });

describe('Bitbucket passive pristine native syntax preference', () => {
  it('starts unknown even with plain/native-token-looking source, without opening, focusing, writing or fetching', () => {
    document.querySelector('[role="region"]')?.insertAdjacentHTML('beforeend', '<span class="token keyword">if</span>');
    const click = vi.spyOn(HTMLElement.prototype, 'click');const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    try { const f = fixture();expect(f.preference.read()).toBe('unknown');expect(click).not.toHaveBeenCalled();expect(focus).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });

  it.each([false, true])('adopts only an untouched initial checkbox %s after trusted Cancel actually removes the same dialog', (checked) => {
    const f = fixture();const before = document.body.innerHTML;const value = f.open(checked);
    expect(f.preference.read()).toBe('unknown');const html = value.dialog.outerHTML;
    expect(value.close()).toBe(checked ? 'enabled' : 'disabled');expect(value.field.checked).toBe(checked);expect(value.dialog.outerHTML).toBe(html);
    expect(document.body.innerHTML).toBe(before);expect(f.changed).toHaveBeenLastCalledWith(checked ? 'enabled' : 'disabled');
  });

  it('requires consecutive readiness frames and does not promote a premature Cancel', () => {
    const f = fixture();const value = f.open(true, true, 0);
    for (let count = 0; count < 4; count += 1) expect(f.preference.read()).toBe('unknown');
    frame(1);expect(value.close()).toBe('unknown');expect(f.open(true).close()).toBe('enabled');
  });

  it('runtime refuses synthetic events rather than treating protocol trust as browser acceptance', () => {
    const f = fixture(true);const value = f.open(true);expect(value.close()).toBe('unknown');
  });

  it('recognizes the current observed semantic opener while excluding its tabindex-minus-one responsive copy', () => {
    const f = fixture();f.opener.removeAttribute('data-testid');f.opener.removeAttribute('aria-label');f.opener.setAttribute('aria-live', 'polite');f.opener.textContent = 'Global diff settings';
    const copy = f.opener.cloneNode(true);if (!(copy instanceof HTMLButtonElement)) throw new Error('Missing cloned protocol button');copy.tabIndex = -1;f.opener.before(copy);
    expect(f.open(false).close()).toBe('disabled');copy.tabIndex = 0;expect(f.open(true).close()).toBe('unknown');
  });

  it.each(['label', 'hook', 'text'] as const)('invalidates an intervening native opener %s change even if it is restored before Cancel', async (change) => {
    const f = fixture();const value = f.open(true);
    if (change === 'label') f.opener.setAttribute('aria-label', 'Different native action');
    if (change === 'hook') f.opener.removeAttribute('data-testid');
    if (change === 'text') value.form.querySelector('label')?.firstChild?.replaceWith(document.createTextNode('Different preference'));
    await Promise.resolve();
    if (change === 'label') f.opener.setAttribute('aria-label', 'Open modal window: diff display settings');
    if (change === 'hook') f.opener.setAttribute('data-testid', 'settingsButton');
    if (change === 'text') value.form.querySelector('label')?.firstChild?.replaceWith(document.createTextNode('Syntax highlighting'));
    expect(value.close()).toBe('unknown');
  });

  it('does not adopt an already open checked form when observation begins', () => {
    const f = fixture();const value = f.open(true);f.preference.clear();f.preference.read();expect(value.close()).toBe('unknown');
  });

  it.each(['input', 'change', 'submit'] as const)('a %s invalidates immediately without preventing the native event or adopting a checked draft', (type) => {
    const f = fixture();const value = f.open(false);value.field.checked = true;
    const event = input(type === 'submit' ? value.form : value.field, type);
    expect(event.defaultPrevented).toBe(false);expect(f.changed).toHaveBeenLastCalledWith('unknown');expect(value.close()).toBe('unknown');
  });

  it('invalidates for unrelated preference edits and permits only a fresh untouched later opening', () => {
    const f = fixture();let value = f.open(true);const other = value.form.querySelector<HTMLInputElement>('input[name="other"]');
    if (other === null) throw new Error('Missing other field');input(other, 'input');expect(value.close()).toBe('unknown');
    value = f.open(true);expect(value.close()).toBe('enabled');
    value = f.open(false);expect(value.close()).toBe('disabled');
  });

  it.each(['removed', 'hidden', 'field-remount', 'form-remount', 'property-change', 'duplicate-dialog', 'duplicate-field', 'opener-remount'] as const)('invalidates a candidate after %s', (change) => {
    const f = fixture();const value = f.open(true);
    if (change === 'removed') value.dialog.remove();
    if (change === 'hidden') value.dialog.hidden = true;
    if (change === 'field-remount') value.field.replaceWith(value.field.cloneNode(true));
    if (change === 'form-remount') value.form.replaceWith(value.form.cloneNode(true));
    if (change === 'property-change') value.field.checked = false;
    if (change === 'duplicate-dialog') value.dialog.after(value.dialog.cloneNode(true));
    if (change === 'duplicate-field') value.field.after(value.field.cloneNode(true));
    if (change === 'opener-remount') f.opener.replaceWith(f.opener.cloneNode(true));
    expect(f.preference.read()).toBe('unknown');value.close();expect(f.preference.read()).toBe('unknown');
  });

  it.each(['name', 'value', 'type', 'disabled', 'readonly', 'label', 'inert'] as const)('never certifies an unknown or blocked initial field: %s', (change) => {
    const f = fixture();const value = f.open(true);f.preference.clear();value.dialog.remove();f.preference.read();
    input(f.opener);document.body.append(value.dialog);
    if (change === 'label') value.form.querySelector('label')!.textContent = 'Another setting';
    else if (change === 'inert') value.form.setAttribute('inert', '');
    else value.field.setAttribute(change, ['disabled', 'readonly'].includes(change) ? '' : 'another');
    f.preference.read();frame();expect(value.close()).toBe('unknown');
  });

  it.each(['route', 'actor', 'bootstrap-remount', 'workspace'] as const)('invalidates a qualified preference after %s changes', (change) => {
    const f = fixture();expect(f.open(true).close()).toBe('enabled');
    const meta = document.querySelector('#bb-bootstrap');if (meta === null) throw new Error('Missing bootstrap');
    if (change === 'route') window.history.replaceState(null, '', '/workspace/repo/pull-requests/8/diff');
    if (change === 'actor') meta.setAttribute('data-current-user', '{"isAuthenticated":true}');
    if (change === 'bootstrap-remount') meta.replaceWith(meta.cloneNode(true));
    if (change === 'workspace') meta.setAttribute('data-target-workspace-uuid', 'another-workspace');
    expect(f.preference.read()).toBe('unknown');
  });

  it('retains a global observation across native source context expansion and code remounts in the same route/actor', () => {
    const f = fixture();expect(f.open(true).close()).toBe('enabled');
    const code = document.querySelector('[role="region"]');code?.replaceChildren(document.createTextNode('New genuine visible context'));
    code?.replaceWith(code.cloneNode(true));expect(f.preference.read()).toBe('enabled');
  });

  it('rejects untrusted Cancel, unknown closure and Save even when the draft remains unchanged', () => {
    const f = fixture();let value = f.open(true);expect(value.close(false)).toBe('unknown');
    value = f.open(true);value.dialog.remove();expect(f.preference.read()).toBe('unknown');
    value = f.open(true);input(value.form.querySelector('button[type="submit"]')!);value.dialog.remove();expect(f.preference.read()).toBe('unknown');
  });

  it('does not close or adopt a preexisting hidden native dialog or an ambiguous opener', () => {
    const f = fixture();document.body.insertAdjacentHTML('beforeend', '<section role="dialog" hidden></section>');
    expect(f.open(true).close()).toBe('unknown');document.querySelector('[role="dialog"]')?.remove();
    f.opener.after(f.opener.cloneNode(true));expect(f.open(true).close()).toBe('unknown');
  });

  it('allows native modal background aria-hidden while waiting, and waits for its restoration after actual Cancel', () => {
    const f = fixture();const value = f.open(true);const tab = f.opener.parentElement;if (tab === null) throw new Error('Missing tab');
    tab.setAttribute('aria-hidden', 'true');expect(f.preference.read()).toBe('unknown');
    input(value.cancel);value.dialog.remove();expect(f.preference.read()).toBe('unknown');
    tab.removeAttribute('aria-hidden');frame();expect(f.preference.read()).toBe('enabled');
  });

  it('rejects Cancel→dialog remount, intervening Escape and source route races before promotion', () => {
    const f = fixture();let value = f.open(true);input(value.cancel);value.dialog.replaceWith(value.dialog.cloneNode(true));expect(f.preference.read()).toBe('unknown');
    document.querySelector('[role="dialog"]')?.remove();value = f.open(true);input(value.cancel);value.cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));value.dialog.remove();expect(f.preference.read()).toBe('unknown');
    value = f.open(true);input(value.cancel);window.history.replaceState(null, '', '/workspace/repo/pull-requests/8/diff');value.dialog.remove();expect(f.preference.read()).toBe('unknown');
  });

  it('clears on a fast leave-return navigation event even when the final URL matches', () => {
    const f = fixture();expect(f.open(true).close()).toBe('enabled');
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: `${window.location.href}other`, newURL: window.location.href }));expect(f.changed).toHaveBeenLastCalledWith('unknown');expect(f.preference.read()).toBe('unknown');
  });

  it('bounds readiness waits and releases pending frames, timers and event listeners on clear', async () => {
    vi.useFakeTimers();const f = fixture();input(f.opener);expect(frames.size).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);expect(frames.size).toBe(0);expect(f.preference.read()).toBe('unknown');
    input(f.opener);expect(frames.size).toBe(1);f.preference.clear();expect(frames.size).toBe(0);
    const count = f.changed.mock.calls.length;input(f.opener);document.body.insertAdjacentHTML('beforeend', '<section role="dialog"></section>');await Promise.resolve();expect(f.changed).toHaveBeenCalledTimes(count);
  });
});
