import { describeBitbucketPage } from './page';
import type { BitbucketSyntaxCapability } from './workflow-syntax';
import { BitbucketPassiveCookieNotice } from './passive-cookie-notice';

interface Actor {
  readonly bootstrap: Element;
  readonly user: string;
  readonly workspace: string;
}
interface Scope extends Actor { readonly url: string }
interface InitialRendering extends Scope { closed: boolean }
// Observer recreation cannot rearm stale native-On markup after this document was invalidated.
const initialRenderings = new WeakMap<Document, InitialRendering>();
interface Candidate {
  readonly dialog: HTMLElement;
  readonly form: HTMLFormElement;
  readonly field: HTMLInputElement;
  readonly cancel: HTMLButtonElement;
  readonly checked: boolean;
  frames: number;
  cancelled: boolean;
}
export interface NativeSyntaxPreferenceEnvironment {
  readonly unitOnly?: { trusted(event: Event): boolean };
}

const UNTRUSTED = '[data-geld-ui],[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"]';
const BLOCKED = '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],[aria-readonly="true"],fieldset[disabled]';
const SETTINGS_FIELD = 'input[id="diff-settings-syntax-highlighting-toggle"]';
const SETTINGS_SURFACE = `dialog,[role="dialog"],${SETTINGS_FIELD}`;

function native(node: Element): boolean { return node.isConnected && node.closest(UNTRUSTED) === null; }
function visible(node: HTMLElement): boolean {
  if (!native(node) || node.closest('[hidden],[inert],[aria-hidden="true"]') !== null) return false;
  for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(current);
    if (style === undefined || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
  }
  const bounds = node.getBoundingClientRect();return bounds.width > 0 && bounds.height > 0;
}
function enabled(node: HTMLButtonElement | HTMLInputElement): boolean {
  return native(node) && !node.disabled && !node.hasAttribute('readonly') && node.closest(BLOCKED) === null;
}

export class BitbucketNativeSyntaxPreference {
  private scope: Scope | null = null;
  private capability: BitbucketSyntaxCapability = 'unknown';
  private opener: HTMLButtonElement | null = null;
  private openerParent: Element | null = null;
  private openerTab: Element | null = null;
  private candidate: Candidate | null = null;
  private observer: MutationObserver | null = null;
  private frame: number | null = null;
  private deadline: number | null = null;
  private readonly cookies: BitbucketPassiveCookieNotice;

  constructor(private readonly doc: Document, private readonly changed: (value: BitbucketSyntaxCapability) => void, private readonly environment: NativeSyntaxPreferenceEnvironment = {}) { this.cookies = new BitbucketPassiveCookieNotice(doc); }

  private actor(): Actor | null {
    const sources = [...this.doc.head.querySelectorAll('meta#bb-bootstrap[data-current-user][data-target-workspace-uuid]')].filter(native);
    const bootstrap = sources.length === 1 ? sources[0] : undefined;
    const user = bootstrap?.getAttribute('data-current-user');const workspace = bootstrap?.getAttribute('data-target-workspace-uuid');
    if (bootstrap === undefined || user === undefined || user === null || user.length > 16_384 || !workspace) return null;
    try {
      const value: unknown = JSON.parse(user);
      return typeof value === 'object' && value !== null && !Array.isArray(value) && 'isAuthenticated' in value && typeof value.isAuthenticated === 'boolean'
        ? { bootstrap, user, workspace } : null;
    } catch { return null; }
  }

  private current(): boolean {
    const actor = this.actor();const scope = this.scope;
    return scope !== null && this.doc.URL === scope.url && actor !== null && actor.bootstrap === scope.bootstrap && actor.user === scope.user && actor.workspace === scope.workspace;
  }

  private dialogs(): HTMLElement[] { return [...this.doc.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(native); }

  private knownOpener(button: HTMLButtonElement): boolean {
    return button.getAttribute('data-testid') === 'settingsButton' && button.getAttribute('aria-label') === 'Open modal window: diff display settings'
      || button.getAttribute('aria-live') === 'polite' && button.textContent?.trim() === 'Global diff settings' && !button.hasAttribute('aria-label') && !button.hasAttribute('aria-labelledby');
  }

  private settingsOpener(): HTMLButtonElement | null {
    const buttons = [...this.doc.querySelectorAll<HTMLButtonElement>('button[data-testid="settingsButton"],button[aria-live="polite"]')]
      .filter((button) => this.knownOpener(button) && button.type === 'button' && button.tabIndex >= 0 && enabled(button) && visible(button) && button.closest('[role="dialog"]') === null
        && button.closest('[role="tabpanel"]')?.id === 'pull-request-tabs-1-tab');
    return buttons.length === 1 ? buttons[0] ?? null : null;
  }

  private sameOpener(): boolean {
    const button = this.opener;
    return button !== null && native(button) && !button.disabled && !button.hasAttribute('readonly') && button.type === 'button'
      && this.knownOpener(button)
      && button.parentElement === this.openerParent && button.closest('[role="tabpanel"]') === this.openerTab && this.openerTab?.id === 'pull-request-tabs-1-tab';
  }

  private readCandidate(dialog: HTMLElement): Candidate | null {
    const fields = [...dialog.querySelectorAll<HTMLInputElement>('input[id="diff-settings-syntax-highlighting-toggle"]')].filter(native);
    const field = fields.length === 1 ? fields[0] : undefined;
    const form = field?.closest('form');
    if (field === undefined || form === null || form === undefined || !dialog.contains(form) || dialog.querySelectorAll('form').length !== 1
      || field.type !== 'checkbox' || field.name !== 'enableSyntaxHighlighting' || field.value !== 'enableSyntaxHighlighting' || !enabled(field) || field.readOnly
      || ![...field.labels ?? []].some((label) => form.contains(label) && label.textContent?.trim() === 'Syntax highlighting' && visible(label))) return null;
    const cancels = [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.type === 'button' && button.textContent?.trim() === 'Cancel'
      && form.contains(button) && enabled(button) && visible(button));
    const cancel = cancels.length === 1 ? cancels[0] : undefined;
    return cancel === undefined ? null : { dialog, form, field, cancel, checked: field.checked, frames: 0, cancelled: false };
  }

  private sameCandidate(candidate: Candidate): boolean {
    if (!visible(candidate.dialog)) return false;
    const current = this.readCandidate(candidate.dialog);
    return current !== null && current.form === candidate.form && current.field === candidate.field && current.cancel === candidate.cancel && current.checked === candidate.checked;
  }

  private cancelWork(): void {
    const view = this.doc.defaultView;
    if (this.frame !== null) view?.cancelAnimationFrame(this.frame);
    if (this.deadline !== null) view?.clearTimeout(this.deadline);
    this.frame = null;this.deadline = null;
  }

  private invalidate(): void {
    const initial = initialRenderings.get(this.doc);if (initial !== undefined) initial.closed = true;
    this.cancelWork();this.opener = null;this.openerParent = null;this.openerTab = null;this.candidate = null;this.capability = 'unknown';this.changed('unknown');
  }

  private boundWait(): void {
    const view = this.doc.defaultView;
    if (view === null) { this.invalidate();return; }
    if (this.deadline !== null) view.clearTimeout(this.deadline);
    this.deadline = view.setTimeout(() => this.invalidate(), 3000);
  }

  private requestFrame(): void {
    const view = this.doc.defaultView;
    if (this.frame !== null || view === null) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = null;this.check();
      const candidate = this.candidate;
      if (candidate !== null && !candidate.cancelled && this.sameCandidate(candidate)) {
        candidate.frames += 1;
        if (candidate.frames >= 2 && this.deadline !== null) { view.clearTimeout(this.deadline);this.deadline = null; }
      }
      if (this.opener !== null && (candidate === null || candidate.frames < 2 || candidate.cancelled)) this.requestFrame();
    });
  }

  private check(): void {
    if (!this.current()) { this.clear();return; }
    const dialogs = this.dialogs();const candidate = this.candidate;
    const initial = initialRenderings.get(this.doc);
    if (initial !== undefined && !initial.closed && (this.cookies.unknownCurrent() || dialogs.some((dialog) => !this.cookies.current(dialog)) || [...this.doc.querySelectorAll(SETTINGS_FIELD)].some(native))) { initial.closed = true;this.changed('unknown'); }
    if (this.opener === null && this.capability === 'unknown') return;
    if (candidate !== null) {
      if (!candidate.dialog.isConnected) {
        if (candidate.cancelled && candidate.frames >= 2 && dialogs.length === 0 && this.sameOpener()) {
          if (this.opener !== this.settingsOpener()) return;
          this.cancelWork();this.opener = null;this.openerParent = null;this.openerTab = null;this.candidate = null;this.capability = candidate.checked ? 'enabled' : 'disabled';this.changed(this.capability);
        } else this.invalidate();
      } else if (dialogs.length !== 1 || dialogs[0] !== candidate.dialog || !this.sameCandidate(candidate) || !this.sameOpener()) this.invalidate();
      return;
    }
    if (this.opener === null) { if (dialogs.length > 0 && this.capability !== 'unknown') this.invalidate();return; }
    if (!this.sameOpener() || dialogs.length > 1) { this.invalidate();return; }
    const dialog = dialogs[0];
    if (dialog !== undefined) {
      this.candidate = this.readCandidate(dialog);
      if (dialog.querySelectorAll('input[id="diff-settings-syntax-highlighting-toggle"]').length > 1 || dialog.querySelectorAll('form').length > 1) this.invalidate();
    }
  }

  private readonly mutations = (records: readonly MutationRecord[]): void => {
    const view = this.doc.defaultView;const initial = initialRenderings.get(this.doc);
    if (initial === undefined || initial.closed) { this.check();return; }
    const cookies = this.cookies.history(records);
    if (view !== null && (cookies.invalid || records.some((record) => {
      if (!(record.target instanceof view.Element) || record.target.closest(UNTRUSTED) !== null) return false;
      if (record.type === 'attributes') return record.attributeName === 'role' && (record.oldValue === 'dialog' || record.target.getAttribute('role') === 'dialog') && !cookies.neutral.has(record.target)
        || record.attributeName === 'id' && (record.oldValue === 'diff-settings-syntax-highlighting-toggle' || record.target.matches(SETTINGS_FIELD));
      return [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof view.Element && node.closest(UNTRUSTED) === null
        && [node, ...node.querySelectorAll(SETTINGS_SURFACE)].some((surface) => surface.matches(SETTINGS_SURFACE) && !cookies.neutral.has(surface)));
    }))) {
      initial.closed = true;if (this.capability === 'unknown') this.changed('unknown');
    }
    this.check();
  };

  private checkObserved(): void {
    const records = this.observer?.takeRecords();
    if (records !== undefined && records.length > 0) this.mutations(records);
    else this.check();
  }

  private readonly listen = (event: Event): void => {
    if (!this.current()) { this.clear();return; }
    const view = this.doc.defaultView;
    if (view === null || !(event.target instanceof view.Element)) return;
    const target = event.target;const candidate = this.candidate;
    if (event.type === 'input' || event.type === 'change' || event.type === 'submit') {
      const dialog = target.closest('[role="dialog"]');
      if (candidate?.dialog.contains(target) || dialog !== null && native(dialog) && (this.opener !== null || dialog.querySelector('input[id="diff-settings-syntax-highlighting-toggle"]') !== null)) this.invalidate();
      return;
    }
    if (event.type === 'keydown') {
      if (candidate !== null && (candidate.cancelled || event instanceof view.KeyboardEvent && event.key === 'Escape')) this.invalidate();
      return;
    }
    const trusted = this.environment.unitOnly?.trusted(event) ?? event.isTrusted;
    const button = target.closest('button');
    if (button !== null && button === this.settingsOpener()) {
      const closed = this.dialogs().length === 0;
      this.invalidate();
      if (trusted && closed) { this.opener = button;this.openerParent = button.parentElement;this.openerTab = button.closest('[role="tabpanel"]');this.boundWait();this.requestFrame(); }
      return;
    }
    if (candidate !== null && button === candidate.cancel) {
      if (!trusted || candidate.frames < 2 || candidate.cancelled || !this.sameCandidate(candidate)) { this.invalidate();return; }
      candidate.cancelled = true;this.boundWait();this.requestFrame();return;
    }
    if (this.opener !== null && (candidate === null || candidate.cancelled || button?.type === 'submit')) this.invalidate();
  };

  private readonly navigation = (event: Event): void => { if (event.type !== 'visibilitychange' || this.doc.hidden || !this.current()) this.clear(); };

  read(): BitbucketSyntaxCapability {
    const page = describeBitbucketPage(new URL(this.doc.URL));const actor = this.actor();
    if (page?.kind !== 'diff' || actor === null || this.doc.hidden) { this.clear();return 'unknown'; }
    if (!this.current()) {
      this.clear();this.scope = { ...actor, url: this.doc.URL };
      if (!initialRenderings.has(this.doc)) initialRenderings.set(this.doc, { ...this.scope, closed: false });
      const view = this.doc.defaultView;
      if (view === null) { this.clear();return 'unknown'; }
      for (const event of ['click', 'input', 'change', 'submit', 'keydown']) this.doc.addEventListener(event, this.listen, true);
      this.doc.addEventListener('visibilitychange', this.navigation);
      for (const event of ['popstate', 'hashchange', 'wxt:locationchange', 'pagehide']) view.addEventListener(event, this.navigation);
      this.observer = new view.MutationObserver(this.mutations);
      this.observer.observe(this.doc.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'id', 'role', 'name', 'value', 'type', 'checked', 'disabled', 'readonly', 'hidden', 'inert', 'tabindex', 'aria-live', 'aria-label', 'aria-labelledby', 'aria-hidden', 'aria-disabled', 'aria-readonly', 'data-testid', 'data-current-user', 'data-target-workspace-uuid'] });
    }
    this.checkObserved();return this.capability;
  }

  allowsInitialRenderedOn(): boolean {
    const initial = initialRenderings.get(this.doc);
    this.checkObserved();
    return this.capability === 'unknown' && this.current() && !this.doc.hidden && initial !== undefined && !initial.closed
      && this.doc.URL === initial.url && this.scope?.bootstrap === initial.bootstrap && this.scope.user === initial.user && this.scope.workspace === initial.workspace && this.dialogs().every((dialog) => this.cookies.current(dialog));
  }

  clear(): void {
    this.scope = null;this.invalidate();this.observer?.disconnect();this.observer = null;
    for (const event of ['click', 'input', 'change', 'submit', 'keydown']) this.doc.removeEventListener(event, this.listen, true);
    this.doc.removeEventListener('visibilitychange', this.navigation);
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange', 'pagehide']) this.doc.defaultView?.removeEventListener(event, this.navigation);
  }
}
