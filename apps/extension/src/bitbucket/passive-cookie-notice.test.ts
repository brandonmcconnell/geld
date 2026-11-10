// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { BitbucketPassiveCookieNotice } from './passive-cookie-notice';

const source = readFileSync(new NodeURL('./fixtures/passive-cookie-notice.html', import.meta.url), 'utf8');
let observer: MutationObserver;
function fixture() {
  document.body.innerHTML = source;const dialog = document.querySelector<HTMLElement>('[role="dialog"]');const slot = document.querySelector<HTMLElement>('[data-layout-slot]');const root = document.getElementById('unsafe-design-system-page-layout-root');
  if (dialog === null || slot === null || root === null || dialog.parentElement === null) throw new Error('Missing retained cookie owner projection');
  const notice = new BitbucketPassiveCookieNotice(document);return { dialog, slot, root, parent: dialog.parentElement, notice };
}
function observe(): void { observer = new MutationObserver(() => {});observer.observe(document.documentElement, { childList: true, attributes: true, attributeOldValue: true, characterData: true, subtree: true }); }
afterEach(() => { observer?.disconnect();document.body.replaceChildren(); });

describe('passive native cookie notice initial-history witness', () => {
  it('recognizes the retained full notice with both legal duplicate IDs without mutating any native node', () => {
    const f = fixture();const before = document.body.innerHTML;expect(f.dialog.querySelectorAll('[id="cookiesTrackingNoticeLink"]')).toHaveLength(2);expect(f.notice.current(f.dialog)).toBe(true);expect(document.body.innerHTML).toBe(before);
  });
  it('the observed owner CSS decoration permits a bounded numeric px value without treating it as state', () => {
    const f = fixture();const style = f.slot.querySelector('style');if (style === null) throw new Error('Missing native layout decoration');style.textContent = '#unsafe-design-system-page-layout-root { --n_bnrM: 132.5px; }';expect(f.notice.current(f.dialog)).toBe(true);
  });
  it.each(['other-selector', 'other-property', 'extra-declaration', 'URL', 'unbounded', 'negative', 'expression'] as const)('unknown owner stylesheet remains refused: %s', (fault) => {
    const f = fixture();const style = f.slot.querySelector('style');if (style === null) throw new Error('Missing native decoration');const text = style.textContent ?? '';
    if (fault === 'other-selector') style.textContent = text.replace('unsafe-design-system-page-layout-root', 'other');if (fault === 'other-property') style.textContent = text.replace('--n_bnrM', '--other');if (fault === 'extra-declaration') style.textContent = text.replace(' }', '; color:red }');if (fault === 'URL') style.textContent = text.replace('105px', 'url(https://example.com)');if (fault === 'unbounded') style.textContent = text.replace('105px', '9999px');if (fault === 'negative') style.textContent = text.replace('105px', '-1px');if (fault === 'expression') style.textContent = text.replace('105px', 'calc(100px + 5px)');expect(f.notice.current(f.dialog)).toBe(false);
  });
  it('duplicate notices and an unqualified initial role-less notice are unknown rather than partially adopted', () => {
    const f = fixture();f.slot.after(f.slot.cloneNode(true));expect(f.notice.current(f.dialog)).toBe(false);expect(f.notice.unknownCurrent()).toBe(true);f.slot.nextElementSibling?.remove();f.dialog.removeAttribute('role');expect(f.notice.unknownCurrent()).toBe(true);
  });
  it.each(['label', 'owner', 'legal', 'button', 'field', 'form', 'extra-control', 'aria-control', 'nested-dialog', 'authored', 'owned', 'partial', 'remounted-button'] as const)('does not recognize incomplete/copied/changed notice: %s', (fault) => {
    const f = fixture();if (fault === 'remounted-button') expect(f.notice.current(f.dialog)).toBe(true);
    if (fault === 'aria-control') { const control = document.createElement('div');control.setAttribute('role', 'button');f.dialog.append(control); }
    if (fault === 'label') f.dialog.setAttribute('aria-labelledby', 'Settings');if (fault === 'owner') document.body.append(f.dialog);if (fault === 'legal') f.dialog.querySelector('a')?.setAttribute('href', 'https://example.com');if (fault === 'button') f.dialog.querySelector('button')?.setAttribute('type', 'submit');if (fault === 'field') f.dialog.append(document.createElement('input'));if (fault === 'form') f.dialog.append(document.createElement('form'));if (fault === 'extra-control') f.dialog.append(document.createElement('button'));if (fault === 'nested-dialog') { const child = document.createElement('div');child.setAttribute('role', 'dialog');f.dialog.append(child); }if (fault === 'authored') f.root.classList.add('ak-renderer-document');if (fault === 'owned') f.root.setAttribute('data-geld-ui', '');if (fault === 'partial') f.dialog.querySelector('button')?.remove();if (fault === 'remounted-button') { const b = f.dialog.querySelector('button');b?.replaceWith(b.cloneNode(true)); }
    expect(f.notice.current(f.dialog)).toBe(false);
  });
  it.each(['dialog', 'parent', 'slot'] as const)('recognizes same-turn fully formed insertion/removal with exact native owner record: %s', (part) => {
    const f = fixture();const removed = part === 'dialog' ? f.dialog : part === 'parent' ? f.parent : f.slot;const owner = removed.parentElement;if (owner === null) throw new Error('Missing original owner');removed.remove();observe();owner.append(removed);removed.remove();const result = f.notice.history(observer.takeRecords());expect(result.invalid).toBe(false);expect(result.neutral.has(f.dialog)).toBe(true);
  });
  it('recognizes an already verified original notice removal without requiring connected detached ancestry', () => {
    const f = fixture();expect(f.notice.current(f.dialog)).toBe(true);observe();f.dialog.remove();const result = f.notice.history(observer.takeRecords());expect(result.invalid).toBe(false);expect(result.neutral.has(f.dialog)).toBe(true);
  });
  it('an unseen fully formed notice cannot hide transient controls before same-turn removal', () => {
    const f = fixture();f.dialog.remove();observe();f.parent.append(f.dialog);const input = document.createElement('input');f.dialog.append(input);input.remove();f.dialog.remove();expect(f.notice.history(observer.takeRecords()).invalid).toBe(true);
  });
  it.each(['settings-field', 'unknown-field', 'form', 'button', 'editor', 'dialog', 'text', 'label', 'role'] as const)('retains invalidating transient history inside the cookie even when restored: %s', (fault) => {
    const f = fixture();expect(f.notice.current(f.dialog)).toBe(true);observe();
    if (fault === 'label') { f.dialog.setAttribute('aria-labelledby', 'unknown');f.dialog.setAttribute('aria-labelledby', 'cookiesTrackingNoticeLink'); }
    else if (fault === 'role') { f.dialog.setAttribute('role', 'alertdialog');f.dialog.setAttribute('role', 'dialog'); }
    else if (fault === 'text') { const button = f.dialog.querySelector('button span');if (button === null) throw new Error('Missing original button');const original = button.textContent;button.textContent = 'Different';button.textContent = original; }
    else { const n = document.createElement(fault === 'form' ? 'form' : fault === 'button' ? 'button' : fault === 'dialog' ? 'div' : fault === 'editor' ? 'div' : 'input');if (fault === 'settings-field') n.id = 'diff-settings-syntax-highlighting-toggle';if (fault === 'dialog') n.setAttribute('role', 'dialog');if (fault === 'editor') n.setAttribute('contenteditable', 'true');f.dialog.append(n);n.remove(); }
    expect(f.notice.history(observer.takeRecords()).invalid).toBe(true);
  });
  it('does not grant an incomplete banner grace if it hydrates before pending history is read', () => {
    const f = fixture();const body = [...f.dialog.childNodes];f.dialog.replaceChildren();observe();f.dialog.append(...body);expect(f.notice.history(observer.takeRecords()).invalid).toBe(true);
  });
  it('permits known role removal only when its original full safe body remains intact', () => {
    const f = fixture();expect(f.notice.current(f.dialog)).toBe(true);observe();f.dialog.removeAttribute('role');f.dialog.remove();const r = f.notice.history(observer.takeRecords());expect(r.invalid).toBe(false);expect(r.neutral.has(f.dialog)).toBe(true);
  });
  it('does not treat an unrelated native owner or lost original layout lifetime as cookie history', () => {
    const f = fixture();expect(f.notice.current(f.dialog)).toBe(true);observe();f.root.remove();document.body.append(f.root);expect(f.notice.history(observer.takeRecords()).invalid).toBe(true);
  });
  it('harmless original class/style updates and source hydration outside the cookie stay neutral', () => {
    const f = fixture();expect(f.notice.current(f.dialog)).toBe(true);observe();f.dialog.classList.add('native-closing');f.dialog.style.opacity = '0';const nativeSource = document.createElement('div');f.root.append(nativeSource);nativeSource.textContent = 'Source hydration';nativeSource.remove();const r = f.notice.history(observer.takeRecords());expect(r.invalid).toBe(false);expect(r.neutral.has(f.dialog)).toBe(true);
  });
});
