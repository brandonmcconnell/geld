import { element } from './dom';
import type { ProviderPeopleProjection } from './hidden-people';
import type { ProviderConversationRoot } from './types';

const HIDDEN = 'data-geld-provider-person-hidden';
let listId = 0;

export class ProviderHiddenPeopleView {
  private bar: HTMLElement | null = null;
  private readonly listId = `geld-provider-hidden-people-${++listId}`;
  private signature = '';
  private expanded = false;
  private readonly managed = new Map<HTMLElement, { control: HTMLElement; key: string }>();

  constructor(private readonly show: (id: string, shown: boolean) => void, private readonly unhide?: (login: string) => Promise<void>) {}

  update(host: HTMLElement | null, projection: ProviderPeopleProjection, roots: readonly ProviderConversationRoot[]): void {
    const names = new Map(projection.people.map((person) => [person.id, person.login]));
    const active = new Set<HTMLElement>();
    for (const entry of roots) {
      const ids = [...entry.anchors.map((anchor) => projection.hiddenAnchors.get(anchor)), ...(entry.eventIds ?? []).map((id) => projection.hiddenEvents.get(id))];
      if (ids.length === 0 || ids.some((id) => id === undefined) || entry.root.closest('[data-geld-ui]') !== null || entry.root.matches('form,textarea,input,[contenteditable="true"]') || entry.root.querySelector('form,textarea,input,[contenteditable="true"]') !== null) continue;
      const people = [...new Set(ids.filter((id): id is string => id !== undefined))];
      const key = JSON.stringify(people);
      active.add(entry.root);
      let managed = this.managed.get(entry.root);
      if (managed?.key !== key) { managed?.control.remove(); this.managed.delete(entry.root); managed = undefined; }
      if (managed === undefined) {
        const control = element('div', '', 'geld-provider-hidden-person');
        control.setAttribute('role', 'note');
        control.append(element('span', `${people.map((id) => names.get(id) ?? 'Person').join(', ')} hidden by your Geld settings.`));
        const button = element('button', 'Show for this visit');button.type = 'button';
        button.addEventListener('click', () => { if (!control.isConnected || this.managed.get(entry.root)?.control !== control) return; for (const id of people) this.show(id, true); });
        control.append(button);
        managed = { control, key };this.managed.set(entry.root, managed);
      }
      if (!entry.root.hasAttribute(HIDDEN)) entry.root.setAttribute(HIDDEN, '');
      if (managed.control.nextElementSibling !== entry.root) entry.root.before(managed.control);
    }
    for (const [root, managed] of this.managed) if (!active.has(root)) { root.removeAttribute(HIDDEN); managed.control.remove();this.managed.delete(root); }
    const signature = JSON.stringify(projection.people);
    if (host === null || projection.people.length === 0) { this.bar?.remove(); this.bar = null; this.signature = ''; return; }
    if (this.bar?.parentElement === host && signature === this.signature) return;
    const focusedId = this.bar?.contains(document.activeElement) === true ? document.activeElement?.getAttribute('data-geld-person-toggle') : null;
    this.bar?.remove();this.signature = signature;
    const bar = element('div', '', 'geld-provider-hidden-people');
    const toggle = element('button', `Hidden people (${projection.people.length})`);toggle.type = 'button';
    const list = element('div', '', 'geld-provider-hidden-people__list');list.id = this.listId;list.hidden = !this.expanded;
    toggle.setAttribute('aria-controls', this.listId);
    toggle.setAttribute('aria-expanded', String(this.expanded));
    toggle.addEventListener('click', () => { this.expanded = !this.expanded;list.hidden = !this.expanded;toggle.setAttribute('aria-expanded', String(this.expanded)); });
    bar.append(toggle, list);
    for (const person of projection.people) {
      const row = element('div', '', 'geld-provider-hidden-people__row');row.append(element('span', person.login));
      const button = element('button', person.shown ? 'Hide for this visit' : 'Show for this visit');button.type = 'button';button.dataset.geldPersonToggle = person.id;
      button.addEventListener('click', () => { if (this.bar === bar && button.isConnected) this.show(person.id, !person.shown); });row.append(button);
      if (person.exactRules.length > 0 && this.unhide !== undefined) {
        const remove = element('button', 'Stop hiding');remove.type = 'button';
        remove.addEventListener('click', () => {
          if (this.bar !== bar || !remove.isConnected) return;
          remove.disabled = true;
          void this.unhide?.(person.ruleIdentity).catch(() => { remove.textContent = 'Could not save. Try again.'; }).finally(() => { remove.disabled = false; });
        });row.append(remove);
      }
      list.append(row);
    }
    this.bar = bar;
    host.insertBefore(bar, host.querySelector(':scope > .geld-provider-review'));
    if (focusedId !== null) [...bar.querySelectorAll<HTMLButtonElement>('[data-geld-person-toggle]')].find((button) => button.dataset.geldPersonToggle === focusedId)?.focus();
  }

  clear(): void {
    for (const [root, managed] of this.managed) { root.removeAttribute(HIDDEN);managed.control.remove(); }
    this.managed.clear();this.bar?.remove();this.bar = null;this.signature = '';this.expanded = false;
  }
}
