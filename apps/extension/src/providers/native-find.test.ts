// @vitest-environment happy-dom
import { ProviderNativeFind } from './native-find';
import type { ProviderNativeFindEntry, ProviderNativeFindEnvironment, ProviderNativeFindOptions } from './native-find';

const owners: ProviderNativeFind[] = [];
const marker = 'data-geld-provider-native-find';
const variable = '--geld-provider-native-find-display';

beforeEach(() => {
  document.body.innerHTML = '<div id="native-root" style="display:block"><span id="note_10">Original comment</span><a id="note_11" href="#note_10">Native reply</a></div><div id="outside">Unrelated</div>';
  document.documentElement.dataset.geldProvider = 'gitlab';
  window.history.replaceState({}, '', '/public/review');
});

afterEach(() => {
  for (const owner of owners) owner.destroy();
  owners.length = 0;
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

function root(): HTMLElement { return document.getElementById('native-root')!; }
function entry(changes: Partial<ProviderNativeFindEntry> = {}): ProviderNativeFindEntry {
  return { root: root(), key: 'native:10:11', anchors: ['note_10', 'note_11'], compact: true, shown: false, ...changes };
}
function owner(options: Partial<ProviderNativeFindOptions> = {}, environment: ProviderNativeFindEnvironment = { supported: true }): ProviderNativeFind {
  const value = new ProviderNativeFind(document, { onReveal: vi.fn(), ...options }, environment);
  owners.push(value);
  return value;
}
async function mutations(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 0)); }

it('claims only its hidden value and display variable; restores original style priority and native DOM intact', () => {
  const original = root();
  const child = document.getElementById('note_10');
  original.style.setProperty(variable, 'grid', 'important');
  const click = vi.fn(); original.addEventListener('click', click);
  const find = owner();
  expect(find.sync([entry()])).toEqual([{ key: entry().key, status: 'folded' }]);
  expect(original.getAttribute('hidden')).toBe('until-found');
  expect(original.getAttribute(marker)).toBe('folded');
  expect(original.style.getPropertyValue('display')).toBe('block');
  expect(original.style.getPropertyValue(variable)).toBe('block');
  find.destroy();
  expect(original.hasAttribute('hidden')).toBe(false);
  expect(original.hasAttribute(marker)).toBe(false);
  expect(original.style.getPropertyValue(variable)).toBe('grid');
  expect(original.style.getPropertyPriority(variable)).toBe('important');
  expect(document.getElementById('note_10')).toBe(child);
  original.click(); expect(click).toHaveBeenCalledOnce();
});

it('leaves unsupported engines visibly native and explicitly uncovered without claiming browser find', () => {
  const onReveal = vi.fn(); const find = owner({ onReveal }, { supported: false });
  expect(find.sync([entry()])[0]?.status).toBe('unsupported');
  expect(root().hasAttribute('hidden')).toBe(false);
  expect(root().hasAttribute(marker)).toBe(false);
  expect(root().style.getPropertyValue(variable)).toBe('');
  root().dispatchEvent(new Event('beforematch'));
  expect(onReveal).not.toHaveBeenCalled();
});

it.each(['', 'hidden', 'until-found'])('never claims an existing native hidden attribute (%j)', (hidden) => {
  root().setAttribute('hidden', hidden);
  const find = owner();
  expect(find.sync([entry()])[0]?.status).toBe('native-owned');
  find.destroy();
  expect(root().getAttribute('hidden')).toBe(hidden);
  expect(root().hasAttribute(marker)).toBe(false);
});

it.each(['inert', 'aria-hidden'])('does not reveal a native %s state or a hidden ancestor', (attribute) => {
  root().setAttribute(attribute, attribute === 'aria-hidden' ? 'true' : '');
  const find = owner();
  expect(find.sync([entry()])[0]?.status).toBe('native-owned');
  expect(root().hasAttribute('hidden')).toBe(false);
  root().removeAttribute(attribute);
  document.body.setAttribute('hidden', '');
  expect(find.sync([entry()])[0]?.status).toBe('native-owned');
  find.destroy();document.body.removeAttribute('hidden');
});

it('treats synthetic beforematch only as a unit protocol and remembers reader reveal across 200 reapplies', async () => {
  const onReveal = vi.fn(); const find = owner({ onReveal });
  find.sync([entry()]);
  root().dispatchEvent(new Event('beforematch', { bubbles: true }));
  expect(root().hasAttribute('hidden')).toBe(false);
  expect(root().hasAttribute(marker)).toBe(false);
  expect(onReveal).toHaveBeenCalledWith(entry(), 'beforematch', null);
  await mutations();
  for (let index = 0; index < 200; index += 1) expect(find.sync([entry()])[0]?.status).toBe('shown');
  expect(onReveal).toHaveBeenCalledOnce();
  find.allowCompact(entry().key);
  expect(find.sync([entry()])[0]?.status).toBe('folded');
});

it('honors browser/native removal of its hidden flag without immediately hiding the original again', async () => {
  const onReveal = vi.fn(); const find = owner({ onReveal });find.sync([entry()]);
  root().removeAttribute('hidden');await mutations();
  expect(onReveal).toHaveBeenCalledWith(entry(), 'native-unhide', null);
  expect(find.sync([entry()])[0]?.status).toBe('shown');
});

it('preserves a framework replacement hidden value and does not overwrite a replaced custom variable', async () => {
  const find = owner();find.sync([entry()]);
  root().setAttribute('hidden', '');
  root().style.setProperty(variable, 'grid', 'important');
  await mutations();find.destroy();
  expect(root().getAttribute('hidden')).toBe('');
  expect(root().style.getPropertyValue(variable)).toBe('grid');
  expect(root().style.getPropertyPriority(variable)).toBe('important');
  expect(root().hasAttribute(marker)).toBe(false);
});

it('does not overwrite a framework inline display change while releasing its own hidden state', async () => {
  const find = owner();find.sync([entry()]);
  root().style.setProperty('display', 'none', 'important');await mutations();
  expect(root().hasAttribute('hidden')).toBe(false);
  expect(root().hasAttribute(marker)).toBe(false);
  expect(root().style.getPropertyValue('display')).toBe('none');
  expect(root().style.getPropertyPriority('display')).toBe('important');
  expect(find.sync([entry()])[0]?.status).toBe('unmeasured');
});

it('relinquishes captured display when a native class changes to measured display:none and retains framework hiding', async () => {
  const style = document.createElement('style');style.textContent = '.native-framework-hidden { display: none !important; }';document.head.append(style);
  try {
    root().style.removeProperty('display');
    expect(window.getComputedStyle(root()).display).toBe('block');
    const find = owner();find.sync([entry()]);
    expect(root().getAttribute('hidden')).toBe('until-found');
    root().classList.add('native-framework-hidden');await mutations();
    expect(root().classList.contains('native-framework-hidden')).toBe(true);
    expect(root().hasAttribute('hidden')).toBe(false);
    expect(root().hasAttribute(marker)).toBe(false);
    expect(root().style.getPropertyValue(variable)).toBe('');
    expect(window.getComputedStyle(root()).display).toBe('none');
    expect(find.sync([entry()])[0]?.status).toBe('unmeasured');
    expect(root().hasAttribute(marker)).toBe(false);
  } finally { style.remove(); }
});

it('preserves new native hidden attributes alongside a changed native class', async () => {
  const find = owner();find.sync([entry()]);root().classList.add('framework-closed');root().setAttribute('hidden', '');
  await mutations();find.destroy();
  expect(root().classList.contains('framework-closed')).toBe(true);
  expect(root().getAttribute('hidden')).toBe('');
  expect(root().hasAttribute(marker)).toBe(false);
  expect(root().style.getPropertyValue(variable)).toBe('');
});

it('protects an existing or newly inserted native composer', async () => {
  const textarea = document.createElement('textarea');root().append(textarea);
  const find = owner();expect(find.sync([entry()])[0]?.status).toBe('editing');
  textarea.remove();find.sync([entry()]);
  const editor = document.createElement('div');editor.setAttribute('contenteditable', 'true');root().append(editor);
  await mutations();expect(root().hasAttribute('hidden')).toBe(false);
  expect(find.sync([entry()])[0]?.status).toBe('editing');
});

it('reveals only exact known source anchors, including the second anchor and an initial encoded fragment', () => {
  window.history.replaceState({}, '', '/public/review#note_%31%31');
  const onReveal = vi.fn();const find = owner({ onReveal });
  expect(find.sync([entry()])[0]?.status).toBe('shown');
  expect(onReveal).toHaveBeenCalledWith(entry(), 'fragment', 'note_11');
  find.allowCompact(entry().key);window.history.replaceState({}, '', '/public/review#outside');
  find.sync([entry()]);window.dispatchEvent(new Event('hashchange'));
  expect(root().getAttribute('hidden')).toBe('until-found');
  expect(find.reveal('note_1')).toBe(false);
  window.history.replaceState({}, '', '/public/review#%malformed');window.dispatchEvent(new Event('hashchange'));
  expect(root().getAttribute('hidden')).toBe('until-found');
  window.history.replaceState({}, '', '/public/review#note_10');window.dispatchEvent(new Event('hashchange'));
  expect(onReveal).toHaveBeenLastCalledWith(entry(), 'fragment', 'note_10');
});

it('keeps an explicitly hidden initial fragment folded across reapply, then reveals again after leaving and returning', () => {
  window.history.replaceState({}, '', '/public/review#note_10');
  const onReveal = vi.fn();const find = owner({ onReveal });
  expect(find.sync([entry()])[0]?.status).toBe('shown');
  find.allowCompact(entry().key);
  for (let index = 0; index < 200; index += 1) expect(find.sync([entry()])[0]?.status).toBe('folded');
  window.dispatchEvent(new Event('hashchange'));
  expect(root().getAttribute('hidden')).toBe('until-found');expect(onReveal).toHaveBeenCalledOnce();
  window.history.replaceState({}, '', '/public/review#outside');window.dispatchEvent(new Event('hashchange'));
  window.history.replaceState({}, '', '/public/review#note_10');window.dispatchEvent(new Event('hashchange'));
  expect(root().hasAttribute('hidden')).toBe(false);expect(onReveal).toHaveBeenCalledTimes(2);
});

it('keeps an explicitly hidden source-link reveal folded when its current fragment is unchanged', () => {
  const onReveal = vi.fn();const find = owner({ onReveal });find.sync([entry()]);
  expect(find.reveal('note_11', 'source-link')).toBe(true);
  window.history.replaceState({}, '', '/public/review#note_11');
  find.allowCompact(entry().key);
  expect(find.sync([entry()])[0]?.status).toBe('folded');
  expect(onReveal).toHaveBeenCalledOnce();
  window.history.replaceState({}, '', '/public/review#note_10');window.dispatchEvent(new Event('hashchange'));
  expect(root().hasAttribute('hidden')).toBe(false);expect(onReveal).toHaveBeenLastCalledWith(entry(), 'fragment', 'note_10');
});

it('does not consume a fragment before its async source root is mounted or while the native root is hidden/editing', () => {
  window.history.replaceState({}, '', '/public/review#note_10');
  const onReveal = vi.fn();const find = owner({ onReveal });find.sync([]);expect(onReveal).not.toHaveBeenCalled();
  root().setAttribute('hidden', '');expect(find.sync([entry()])[0]?.status).toBe('native-owned');expect(onReveal).not.toHaveBeenCalled();
  root().removeAttribute('hidden');const textarea = document.createElement('textarea');root().append(textarea);
  expect(find.sync([entry()])[0]?.status).toBe('editing');expect(onReveal).not.toHaveBeenCalled();
  textarea.remove();expect(find.sync([entry()])[0]?.status).toBe('shown');expect(onReveal).toHaveBeenCalledWith(entry(), 'fragment', 'note_10');
});

it('honors real changed-hash event metadata for a quick leave/return even if the final hash matches the processed one', () => {
  window.history.replaceState({}, '', '/public/review#note_10');
  const onReveal = vi.fn();const find = owner({ onReveal });find.sync([entry()]);find.allowCompact(entry().key);find.sync([entry()]);
  const url = document.location.href;
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: url.replace('#note_10', '#outside'), newURL: url }));
  expect(root().hasAttribute('hidden')).toBe(false);expect(onReveal).toHaveBeenCalledTimes(2);
});

it('keeps a reader-revealed identity visible when its native DOM root is replaced', () => {
  const find = owner();find.sync([entry()]);expect(find.reveal('note_10')).toBe(true);
  root().replaceWith(root().cloneNode(true));
  expect(find.sync([entry()])[0]?.status).toBe('shown');
  expect(root().hasAttribute('hidden')).toBe(false);
});

it.each(['editing', 'table', 'native-hidden'] as const)('rechecks a revealed identity remounted as %s before offering a hideable shown state', (state) => {
  const find = owner();find.sync([entry()]);expect(find.reveal('note_10')).toBe(true);
  const replacement = root().cloneNode(true) as HTMLElement;
  if (state === 'editing') replacement.append(document.createElement('textarea'));
  else if (state === 'table') replacement.style.display = 'table';
  else replacement.setAttribute('hidden', '');
  root().replaceWith(replacement);
  const before = replacement.outerHTML;
  const expected = state === 'editing' ? 'editing' : state === 'table' ? 'unmeasured' : 'native-owned';
  expect(find.sync([entry()])[0]?.status).toBe(expected);
  expect(find.sync([entry({ shown: true })])[0]?.status).toBe(expected);
  expect(replacement.outerHTML).toBe(before);
  expect(replacement.hasAttribute(marker)).toBe(false);
});

it('does not offer a hideable shown state for a remembered reader choice on an unsupported engine', () => {
  const find = owner({}, { supported: false });
  const before = root().outerHTML;
  expect(find.sync([entry({ shown: true })])[0]?.status).toBe('unsupported');
  root().replaceWith(root().cloneNode(true));
  expect(find.sync([entry({ shown: true })])[0]?.status).toBe('unsupported');
  expect(root().outerHTML).toBe(before);
});

it('restores removed entries and explicit shown entries without synthesizing a user reveal', () => {
  const onReveal = vi.fn();const find = owner({ onReveal });find.sync([entry()]);
  find.sync([]);expect(root().hasAttribute('hidden')).toBe(false);
  find.sync([entry()]);expect(find.sync([entry({ shown: true })])[0]?.status).toBe('shown');
  expect(root().hasAttribute('hidden')).toBe(false);expect(onReveal).not.toHaveBeenCalled();
});

it('rejects unverified, duplicated, disconnected, or owned source identities', () => {
  const find = owner();
  expect(find.sync([entry({ anchors: ['outside'] })])[0]?.status).toBe('invalid');
  expect(find.sync([entry({ anchors: [] })])[0]?.status).toBe('invalid');
  const wrapper = document.createElement('section');root().before(wrapper);wrapper.append(root());
  expect(find.sync([entry(), entry({ root: wrapper, key: 'conflicting' })]).map((value) => value.status)).toEqual(['invalid', 'invalid']);
  root().setAttribute('data-geld-ui', '');expect(find.sync([entry()])[0]?.status).toBe('invalid');root().removeAttribute('data-geld-ui');
  const target = root();target.remove();expect(find.sync([entry({ root: target })])[0]?.status).toBe('invalid');
});

it('samples computed display once across 200 stable passes and does not perform geometry reads', async () => {
  const styles = vi.spyOn(window, 'getComputedStyle');const rect = vi.spyOn(root(), 'getBoundingClientRect');
  const find = owner();
  for (let index = 0; index < 200; index += 1) find.sync([entry()]);
  await mutations();
  for (let index = 0; index < 200; index += 1) find.sync([entry()]);
  expect(styles).toHaveBeenCalledOnce();expect(rect).not.toHaveBeenCalled();
  find.reveal('note_10');expect(root().style.getPropertyValue(variable)).toBe('');
});

it('caches unsupported display without per-pass layout and refreshes it after native style changes', async () => {
  root().style.display = 'contents';const display = vi.fn((element: HTMLElement) => element.style.display);
  const find = owner({}, { supported: true, display });
  for (let index = 0; index < 200; index += 1) expect(find.sync([entry()])[0]?.status).toBe('unmeasured');
  expect(display).toHaveBeenCalledOnce();
  root().style.display = 'block';await mutations();expect(find.sync([entry()])[0]?.status).toBe('folded');expect(display).toHaveBeenCalledTimes(2);
});

it.each(['height', 'padding-top', 'margin-block-start', 'border-bottom-width'])('does not claim important native %s or alter the old compact protocol before integration', (property) => {
  root().setAttribute('data-geld-provider-compact-hidden', '');root().style.setProperty(property, '120px', 'important');
  const find = owner();expect(find.sync([entry()])[0]?.status).toBe('native-owned');find.destroy();
  expect(root().hasAttribute('data-geld-provider-compact-hidden')).toBe(true);expect(root().style.getPropertyValue(property)).toBe('120px');expect(root().hasAttribute('hidden')).toBe(false);
});
