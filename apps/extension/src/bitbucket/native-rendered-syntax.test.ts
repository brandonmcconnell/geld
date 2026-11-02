// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { bitbucketNativeRenderedOn } from './native-rendered-syntax';
import { readBitbucketDiff } from './diff';
import type { ProviderDiffSyntax, ProviderDiffView } from '../providers/types';

const projection = (mode: 'on' | 'off'): string => readFileSync(new NodeURL(`./fixtures/native-syntax-${mode}.html`, import.meta.url), 'utf8');
const registry = new Map<string, Set<AbstractRange>>();
const trusted = new WeakSet<Event>();
let create: typeof import('./diff-syntax').createBitbucketDiffSyntax;
let Preference: typeof import('./native-syntax-preference').BitbucketNativeSyntaxPreference;
let syntax: ProviderDiffSyntax | null;
let preference: InstanceType<typeof Preference> | null;
let frames: Map<number, FrameRequestCallback>;

function fixture(mode: 'on' | 'off' = 'on'): ProviderDiffView {
  document.body.innerHTML = '<section role="tabpanel" id="pull-request-tabs-1-tab"><button type="button" aria-live="polite">Global diff settings</button>' + projection(mode) + '</section>';
  return view();
}
function view(): ProviderDiffView {
  const found = readBitbucketDiff(document);if (found === null) throw new Error('Missing original native unit projection');return found;
}
function apply(): void { syntax ??= create({ unitOnly: { trusted: (event) => trusted.has(event) } });syntax.apply(view()); }
function count(): number { return [...registry].filter(([key]) => key.startsWith('geld-bitbucket-shell-')).reduce((sum, [, ranges]) => sum + ranges.size, 0); }
function input(node: Element, type: string, accepted = true): void { const e = new Event(type, { bubbles: true, cancelable: true });if (accepted) trusted.add(e);node.dispatchEvent(e); }
function open(checked: boolean, accepted = true) {
  const opener = document.querySelector('button[aria-live="polite"]');if (opener === null) throw new Error('Missing native opener unit protocol');input(opener, 'click', accepted);
  const dialog = document.createElement('section');dialog.setAttribute('role', 'dialog');dialog.innerHTML = '<form><label for="diff-settings-syntax-highlighting-toggle">Syntax highlighting</label><input type="checkbox" id="diff-settings-syntax-highlighting-toggle" name="enableSyntaxHighlighting" value="enableSyntaxHighlighting"><input name="other"><button type="button">Cancel</button><button type="submit">Save</button></form>';
  const field = dialog.querySelector<HTMLInputElement>('input');const cancel = dialog.querySelector('button');const form = dialog.querySelector('form');if (field === null || cancel === null || form === null) throw new Error('Missing native form unit protocol');field.checked = checked;document.body.append(dialog);apply();
  for (let i = 0; i < 2; i += 1) { const next = [...frames.values()];frames.clear();for (const callback of next) callback(0); }
  return { dialog, field, cancel, form, close: () => { input(cancel, 'click');dialog.remove();apply(); } };
}

beforeEach(async () => {
  vi.resetModules();({ createBitbucketDiffSyntax: create } = await import('./diff-syntax'));({ BitbucketNativeSyntaxPreference: Preference } = await import('./native-syntax-preference'));
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff#chg-bitbucket-pipelines.yml';
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\' data-target-workspace-uuid="unit-workspace">';
  registry.clear();frames = new Map();syntax = null;preference = null;
  // Retained source projection with explicit unit layout/trust; no live initial-On qualification.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 80, 30));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { const id = frames.size + 1;frames.set(id, callback);return id; });vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal('CSS', { highlights: registry });vi.stubGlobal('Highlight', class extends Set<AbstractRange> {});vi.stubGlobal('StaticRange', class { constructor(init: StaticRangeInit) { Object.assign(this, init); } });
});
afterEach(() => { syntax?.clear();preference?.clear();vi.restoreAllMocks();vi.unstubAllGlobals();document.head.replaceChildren();document.body.replaceChildren(); });

describe('initial file-local native rendered Syntax On', () => {
  it('recognizes the actual210 On CodeGrid and rejects its restored Off projection without promoting a global preference', () => {
    const on = fixture();expect(bitbucketNativeRenderedOn(on, on.entries[0]!)).toBe(true);
    preference = new Preference(document, vi.fn());expect(preference.read()).toBe('unknown');expect(preference.allowsInitialRenderedOn()).toBe(true);expect(preference.read()).toBe('unknown');
    const off = fixture('off');expect(bitbucketNativeRenderedOn(off, off.entries[0]!)).toBe(false);expect(preference.read()).toBe('unknown');
  });

  it('paints only current original native On Text, preserving nodes, characters, IDs, links and foreign highlights', () => {
    fixture();const html = document.body.innerHTML;const nodes = [...document.querySelectorAll('*')];const texts: Text[] = [];const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n instanceof Text) texts.push(n);const values = texts.map((n) => n.data);
    const foreign = new Set<AbstractRange>();registry.set('native-find', foreign);registry.set('geld-shell-string', foreign);const click = vi.spyOn(HTMLElement.prototype, 'click');const focus = vi.spyOn(HTMLElement.prototype, 'focus');const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    apply();expect(count()).toBe(47);const ranges = [...registry].filter(([key]) => key.startsWith('geld-bitbucket-shell-')).flatMap(([, values]) => [...values]);
    for (const range of ranges) { expect(texts).toContain(range.startContainer);expect(range.endContainer).toBe(range.startContainer);expect(range.startContainer.textContent?.slice(range.startOffset, range.endOffset)).not.toContain('\n'); }
    apply();expect([...registry].filter(([key]) => key.startsWith('geld-bitbucket-shell-')).flatMap(([, values]) => [...values])).toEqual(ranges);expect(document.body.innerHTML).toBe(html);expect([...document.querySelectorAll('*')]).toEqual(nodes);expect(texts.map((n) => n.data)).toEqual(values);expect(registry.get('native-find')).toBe(foreign);expect(registry.get('geld-shell-string')).toBe(foreign);expect(click).not.toHaveBeenCalled();expect(focus).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });

  it('empty and plain hydration leave initial unknown eligible for a later genuine On file, without count/head acquisition', () => {
    fixture('off');const initial = view();const root = initial.entries[0]!.root;root.remove();const empty = { ...initial, entries: [] };syntax = create();syntax.apply(empty);expect(count()).toBe(0);
    fixture('off');apply();expect(count()).toBe(0);fixture('on');apply();expect(count()).toBe(47);
  });

  it('a native On sibling cannot enable a plain pipeline file', () => {
    fixture('off');const target = view();const template = document.createElement('template');template.innerHTML = projection('on');const other = template.content.querySelector('[id="chg-bitbucket-pipelines.yml"]')?.parentElement;
    if (other === null || other === undefined) throw new Error('Missing sibling unit projection');other.querySelector('[id]')?.setAttribute('id', 'chg-README.md');const heading = other.querySelector('h2');if (heading !== null) heading.textContent = 'README.md';target.container.append(other);apply();expect(count()).toBe(0);
  });

  it('native blank inline code may have zero width without losing its positively rendered file witness', () => {
    fixture();for (const code of document.querySelectorAll<HTMLElement>('.code-diff')) if (code.textContent === '\n' || code.textContent === '') code.getBoundingClientRect = () => new DOMRect(10, 10, 0, 20);
    apply();expect(count()).toBe(47);
  });

  it('a different adapter cannot borrow the Bitbucket file-local witness', () => {
    const v = fixture();expect(bitbucketNativeRenderedOn({ ...v, kind: 'gitlab-rapid' }, v.entries[0]!)).toBe(false);
  });

  it('unknown without a positive file clears every owned namespace even when the painter cache is empty', () => {
    fixture('off');apply();const foreign = new Set<AbstractRange>([document.createRange()]);registry.set('native-find', foreign);registry.set('geld-bitbucket-shell-plain', new Set([document.createRange()]));expect(count()).toBe(1);apply();expect(count()).toBe(0);expect(registry.get('native-find')).toBe(foreign);
  });

  it.each(['present', 'transient', 'role-transient'] as const)('an unqualified native dialog closes initial fallback even without a Settings click: %s', async (mode) => {
    fixture();apply();expect(count()).toBe(47);const dialog = document.createElement('section');if (mode !== 'role-transient') dialog.setAttribute('role', 'dialog');dialog.innerHTML = '<form><input id="diff-settings-syntax-highlighting-toggle"></form>';document.body.append(dialog);
    if (mode === 'transient') dialog.remove();if (mode === 'role-transient') { dialog.setAttribute('role', 'dialog');dialog.removeAttribute('role'); }
    await Promise.resolve();apply();expect(count()).toBe(0);dialog.remove();apply();expect(count()).toBe(0);syntax?.clear();syntax = create();apply();expect(count()).toBe(0);
  });

  it('initial observation of an already mounted malformed form stays closed after its removal', () => {
    fixture();const dialog = document.createElement('section');dialog.setAttribute('role', 'dialog');document.body.append(dialog);apply();expect(count()).toBe(0);dialog.remove();apply();expect(count()).toBe(0);
  });

  it('a malformed native Settings field outside a dialog cannot supply or bypass initial eligibility', async () => {
    fixture();apply();expect(count()).toBe(47);const form = document.createElement('form');form.innerHTML = '<input id="diff-settings-syntax-highlighting-toggle">';document.body.append(form);form.remove();await Promise.resolve();apply();expect(count()).toBe(0);syntax?.clear();syntax = create();apply();expect(count()).toBe(0);
  });

  it.each(['dialog', 'role-toggle', 'id-toggle', 'detached-field'] as const)('drains transient native history before synchronous reapply without waiting for observer delivery: %s', (mode) => {
    fixture();apply();expect(count()).toBe(47);const foreign = new Set<AbstractRange>([document.createRange()]);registry.set('native-find', foreign);
    const host = document.createElement('section');document.body.append(host);
    if (mode === 'dialog') { host.setAttribute('role', 'dialog');host.remove(); }
    if (mode === 'role-toggle') { host.setAttribute('role', 'dialog');host.removeAttribute('role'); }
    if (mode === 'id-toggle' || mode === 'detached-field') {
      const field = document.createElement('input');host.append(field);field.id = 'diff-settings-syntax-highlighting-toggle';
      if (mode === 'id-toggle') field.removeAttribute('id');
      else { field.removeAttribute('id');field.remove();host.remove(); }
    }
    apply();expect(count()).toBe(0);expect(registry.get('native-find')).toBe(foreign);syntax?.clear();syntax = create();apply();expect(count()).toBe(0);
  });

  it('pending harmless role/class changes and original source hydration do not fabricate an invalidation', () => {
    fixture('off');apply();expect(count()).toBe(0);fixture('on');const code = document.querySelector('.code-diff');if (code === null) throw new Error('Missing original code');code.setAttribute('role', 'presentation');code.setAttribute('role', 'gridcell');code.classList.remove('syntax-highlighted');code.classList.add('syntax-highlighted');
    const status = document.createElement('div');status.setAttribute('role', 'status');status.id = 'native-loading-count';document.body.append(status);status.remove();apply();expect(count()).toBe(47);
  });

  it('direct initial eligibility reads drain detached Settings history before any bridge reapply', () => {
    fixture();preference = new Preference(document, vi.fn());expect(preference.read()).toBe('unknown');expect(preference.allowsInitialRenderedOn()).toBe(true);
    const field = document.createElement('input');field.id = 'diff-settings-syntax-highlighting-toggle';document.body.append(field);field.remove();expect(preference.allowsInitialRenderedOn()).toBe(false);expect(preference.read()).toBe('unknown');
  });

  it('clears cached ranges when rendering becomes unknown and re-reads fresh same-route context', () => {
    fixture();apply();const old = [...registry.get('geld-bitbucket-shell-keyword') ?? []];expect(old.length).toBeGreaterThan(0);
    const code = document.querySelector('.code-diff');if (code === null) throw new Error('Missing CodeGrid');code.classList.remove('syntax-highlighted');apply();expect(count()).toBe(0);
    code.classList.add('syntax-highlighted');apply();expect(count()).toBe(47);expect([...registry.get('geld-bitbucket-shell-keyword') ?? []][0]).not.toBe(old[0]);
    fixture('on');apply();expect(count()).toBe(47);expect([...registry.get('geld-bitbucket-shell-keyword') ?? []][0]?.startContainer.isConnected).toBe(true);
  });

  it.each(['hidden', 'inert', 'authored', 'comment', 'node-comment', 'owned', 'editor', 'dialog', 'duplicate-file', 'duplicate-grid', 'mixed', 'number', 'aria', 'role', 'attribute', 'content', 'span', 'tokenless', 'group', 'extra-LF'] as const)('refuses copied or unknown native source: %s', (fault) => {
    fixture();const v = view();const entry = v.entries[0]!;const grid = entry.root.querySelector('[role="grid"]');const row = entry.root.querySelector('[data-qa="code-line"]');const code = entry.root.querySelector('.code-diff');if (grid === null || row === null || code === null) throw new Error('Missing native source');
    if (fault === 'hidden') entry.root.style.display = 'none';if (fault === 'inert') entry.root.setAttribute('inert', '');if (fault === 'authored') entry.root.classList.add('ak-renderer-document');if (fault === 'owned') entry.root.setAttribute('data-geld-ui', '');if (fault === 'editor') entry.root.setAttribute('contenteditable', 'true');if (fault === 'dialog') entry.root.setAttribute('role', 'dialog');if (fault === 'duplicate-file') entry.root.after(entry.root.cloneNode(true));if (fault === 'duplicate-grid') grid.after(grid.cloneNode(true));if (fault === 'mixed') code.classList.remove('__rbb_syntax_highlight');if (fault === 'number') row.querySelector('[data-key="code-line-number"]')?.setAttribute('data-old-line-number', 'zero');if (fault === 'aria') code.setAttribute('aria-label', 'Copied source');if (fault === 'role') code.setAttribute('role', 'cell');if (fault === 'attribute') code.firstElementChild?.setAttribute('data-custom', '');if (fault === 'content') code.firstElementChild?.append(document.createElement('button'));if (fault === 'span') code.firstElementChild?.replaceWith(document.createElement('div'));if (fault === 'tokenless') for (const n of grid.querySelectorAll('.token')) n.replaceWith(document.createTextNode(n.textContent ?? ''));if (fault === 'group') code.closest('[role="rowgroup"]')?.removeAttribute('role');if (fault === 'extra-LF') code.firstElementChild?.append('\n');
    if (fault === 'comment') entry.root.setAttribute('data-testid', 'comment-content');if (fault === 'node-comment') code.firstElementChild?.append(document.createComment('Unknown renderer content'));
    expect(bitbucketNativeRenderedOn(v, entry)).toBe(false);syntax = create();syntax.apply(v);expect(count()).toBe(0);
  });

  it('reordered or duplicate original native coordinates cannot qualify copied On markup', () => {
    fixture();const v = view();const entry = v.entries[0]!;const rows = entry.root.querySelectorAll('[data-key="code-line"][role="row"]');const first = rows[0];const second = rows[1];if (first === undefined || second === undefined) throw new Error('Missing rows');second.before(first);expect(bitbucketNativeRenderedOn(v, entry)).toBe(true);second.after(first);expect(bitbucketNativeRenderedOn(v, entry)).toBe(false);
  });

  it.each(['input', 'change', 'submit', 'unknown-close', 'form-remount', 'field-remount', 'untrusted-open'] as const)('native interaction permanently closes local fallback across observer recreation: %s', (fault) => {
    fixture();apply();expect(count()).toBe(47);const value = open(true, fault !== 'untrusted-open');expect(count()).toBe(0);
    if (['input', 'change', 'submit'].includes(fault)) input(value.form, fault);if (fault === 'form-remount') value.form.replaceWith(value.form.cloneNode(true));if (fault === 'field-remount') value.field.replaceWith(value.field.cloneNode(true));value.dialog.remove();apply();expect(count()).toBe(0);
    syntax?.clear();syntax = create();apply();expect(count()).toBe(0);
  });

  it('explicit Off beats stale On markers and master disable cannot rearm the local fallback', () => {
    fixture();apply();expect(count()).toBe(47);open(false).close();expect(count()).toBe(0);syntax?.clear();syntax = create();apply();expect(count()).toBe(0);
  });

  it('the existing genuine pristine Cancel On path still qualifies after local fallback was invalidated', () => {
    fixture();apply();const dirty = open(true);input(dirty.field, 'change');dirty.dialog.remove();apply();expect(count()).toBe(0);open(true).close();expect(count()).toBe(47);
  });

  it.each(['route', 'actor', 'bootstrap', 'workspace', 'clear'] as const)('scope transition cannot reuse the old connected On source: %s', (fault) => {
    fixture();apply();expect(count()).toBe(47);const bootstrap = document.getElementById('bb-bootstrap');if (bootstrap === null) throw new Error('Missing actor');
    if (fault === 'route') window.history.replaceState(null, '', '/atlassian/bitbucket-upload-file/pull-requests/28/diff');if (fault === 'actor') bootstrap.setAttribute('data-current-user', '{"isAuthenticated":false,"different":true}');if (fault === 'bootstrap') bootstrap.replaceWith(bootstrap.cloneNode(true));if (fault === 'workspace') bootstrap.setAttribute('data-target-workspace-uuid', 'different');if (fault === 'clear') syntax?.clear();apply();expect(count()).toBe(0);syntax?.clear();syntax = create();apply();expect(count()).toBe(0);
  });
});
