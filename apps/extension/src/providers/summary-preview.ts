import { providerHoverPlacement } from './hover';
import './summary-preview.css';

interface SummaryPreview {
  readonly label: string;
  readonly url: string;
  readonly fallback: string;
  body(): HTMLElement | null;
  current(): boolean;
  open(event: MouseEvent): void;
}

const ELEMENTS = new Set(['a', 'abbr', 'b', 'bdi', 'blockquote', 'br', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul']);
const DROP = new Set(['audio', 'button', 'canvas', 'embed', 'form', 'iframe', 'input', 'link', 'math', 'meta', 'object', 'script', 'select', 'style', 'svg', 'textarea', 'video']);

export function copyProviderSummaryBody(source: HTMLElement | null, fallback: string, doc: Document): HTMLElement {
  const body = doc.createElement('div');
  body.className = 'geld-provider-review__body geld-provider-summary-preview__body';
  let nodes = 1200, characters = 12000;
  const copy = (node: Node, depth: number): Node | null => {
    if (--nodes < 0 || characters <= 0 || depth > 48) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').slice(0, characters);characters -= text.length;
      return doc.createTextNode(text);
    }
    if (!(node instanceof Element) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || DROP.has(node.localName)
      || node.hasAttribute('contenteditable') || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return null;
    if (node.localName === 'img') return copy(doc.createTextNode(node.getAttribute('alt') ?? ''), depth + 1);
    const tag = node.localName === 'details' ? 'div' : node.localName === 'summary' ? 'strong' : node.localName;
    const element = ELEMENTS.has(tag) ? doc.createElement(tag) : doc.createDocumentFragment();
    if (element instanceof HTMLElement) {
      element.className = [...node.classList].filter(name => !name.startsWith('js-')).join(' ');
      for (const name of ['title', 'lang', 'dir']) {
        const value = node.getAttribute(name);if (value !== null) element.setAttribute(name, value);
      }
      if (tag === 'a') {
        try {
          const value = node.getAttribute('href');
          const url = value === null ? null : new URL(value, doc.URL);
          if (url !== null && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
            element.setAttribute('href', url.href);element.setAttribute('target', '_blank');element.setAttribute('rel', 'noopener noreferrer');
          }
        } catch { /* A malformed link remains readable text. */ }
      }
    }
    for (const child of node.childNodes) {
      if (nodes <= 0 || characters <= 0) break;
      const value = copy(child, depth + 1);if (value !== null) element.appendChild(value);
    }
    return element;
  };
  if (source !== null) {
    const value = copy(source, 0);if (value !== null) body.append(value);
    for (const property of ['--ak-renderer-base-font-size', '--ak-renderer-editor-font-normal-text', '--geld-bitbucket-body-line-height']) {
      body.style.setProperty(property, source.style.getPropertyValue(property));
    }
    body.toggleAttribute('data-geld-bitbucket-typography', source.hasAttribute('data-geld-bitbucket-typography'));
  }
  if (!body.textContent?.trim()) { body.textContent = fallback.slice(0, 12000);body.style.whiteSpace = 'pre-wrap'; }
  return body;
}

let nextId = 0;

export class ProviderSummaryPreviews {
  private readonly doc: Document;
  private readonly id = `geld-provider-summary-preview-${++nextId}`;
  private readonly bindings = new Map<HTMLButtonElement, SummaryPreview>();
  private active: { readonly button: HTMLButtonElement; readonly spec: SummaryPreview; readonly card: HTMLElement; pinned: boolean } | null = null;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private dismissed: HTMLButtonElement | null = null;
  private listening = false;

  constructor(private readonly root: HTMLElement) { this.doc = root.ownerDocument; }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.root.addEventListener('mouseover', this.over);this.root.addEventListener('mouseout', this.out);
    this.root.addEventListener('focusin', this.focus);this.root.addEventListener('focusout', this.blur);
    this.root.addEventListener('click', this.click);this.doc.addEventListener('keydown', this.key, true);
    this.doc.addEventListener('pointerdown', this.outside);
    this.doc.addEventListener('scroll', this.position, { capture: true, passive: true });
    this.doc.addEventListener('visibilitychange', this.visibility);
    this.doc.defaultView?.addEventListener('resize', this.position);
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) this.doc.defaultView?.addEventListener(event, this.navigation);
  }

  bind(button: HTMLButtonElement, spec: SummaryPreview): void {
    this.listen();
    this.bindings.set(button, spec);button.dataset.geldSummaryPreview = '';
    button.setAttribute('aria-haspopup', 'dialog');button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', `Preview ${spec.label}`);
  }

  clear(): void {
    this.close();this.dismissed = null;
    for (const button of this.bindings.keys()) {
      button.removeAttribute('aria-controls');button.removeAttribute('aria-expanded');button.removeAttribute('aria-haspopup');
    }
    this.bindings.clear();
    if (!this.listening) return;
    this.listening = false;
    this.root.removeEventListener('mouseover', this.over);this.root.removeEventListener('mouseout', this.out);
    this.root.removeEventListener('focusin', this.focus);this.root.removeEventListener('focusout', this.blur);
    this.root.removeEventListener('click', this.click);this.doc.removeEventListener('keydown', this.key, true);
    this.doc.removeEventListener('pointerdown', this.outside);this.doc.removeEventListener('scroll', this.position, true);
    this.doc.removeEventListener('visibilitychange', this.visibility);this.doc.defaultView?.removeEventListener('resize', this.position);
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) this.doc.defaultView?.removeEventListener(event, this.navigation);
  }

  destroy(): void { this.clear(); }

  private button(target: EventTarget | null): HTMLButtonElement | null {
    const button = target instanceof Element ? target.closest('button') : null;
    return button !== null && this.bindings.has(button) ? button : null;
  }

  private valid(button: HTMLButtonElement, spec: SummaryPreview): boolean {
    if (!button.isConnected || !this.root.contains(button) || this.root.closest('[hidden], [inert], [aria-hidden="true"]') !== null || this.doc.hidden || button.disabled) return false;
    try { return spec.current(); } catch { return false; }
  }

  private cancelTimers(): void {
    if (this.enterTimer !== null) clearTimeout(this.enterTimer);
    if (this.leaveTimer !== null) clearTimeout(this.leaveTimer);
    this.enterTimer = null;this.leaveTimer = null;
  }

  private close(): void {
    this.cancelTimers();this.observer?.disconnect();this.observer = null;
    const active = this.active;this.active = null;
    active?.button.setAttribute('aria-expanded', 'false');active?.button.removeAttribute('aria-controls');active?.card.remove();
  }

  private show(button: HTMLButtonElement, pinned = false): void {
    this.cancelTimers();
    const spec = this.bindings.get(button);
    if (spec === undefined || !this.valid(button, spec)) { this.close();return; }
    if (this.active?.button === button) { this.active.pinned ||= pinned;return; }
    this.close();
    const card = this.doc.createElement('section');card.id = this.id;card.className = 'geld-provider-summary-preview';card.dataset.geldUi = '';
    card.setAttribute('role', 'dialog');card.setAttribute('aria-label', spec.label);card.tabIndex = -1;
    const header = this.doc.createElement('header');const title = this.doc.createElement('strong');title.textContent = spec.label;
    const close = this.doc.createElement('button');close.type = 'button';close.textContent = 'Close';close.setAttribute('aria-label', 'Close review preview');
    close.addEventListener('click', () => this.dismiss());header.append(title, close);
    const original = this.doc.createElement('a');original.href = spec.url;original.textContent = 'View full review';
    original.addEventListener('click', event => {
      if (!this.valid(button, spec)) { event.preventDefault();this.close();return; }
      spec.open(event);
    });
    const source = spec.body();
    card.append(header, copyProviderSummaryBody(source, spec.fallback, this.doc), original);
    this.root.append(card);this.active = { button, spec, card, pinned };
    button.setAttribute('aria-controls', this.id);button.setAttribute('aria-expanded', 'true');this.position();
    this.observer = new MutationObserver(() => {
      if (this.active !== null && (!card.isConnected || spec.body() !== source || !this.valid(button, spec))) this.close();
    });
    this.observer.observe(this.root, { childList: true, subtree: true, attributes: true });
  }

  private dismiss(): void {
    const button = this.active?.button;
    this.dismissed = button ?? null;this.close();
    if (button?.isConnected) button.focus({ preventScroll: true });
  }

  private readonly position = (): void => {
    const active = this.active, view = this.doc.defaultView;
    if (active === null || view === null) return;
    if (!this.valid(active.button, active.spec)) { this.close();return; }
    const anchor = active.button.getBoundingClientRect();
    const width = this.doc.documentElement.clientWidth || view.innerWidth, height = this.doc.documentElement.clientHeight || view.innerHeight;
    if (anchor.bottom < 0 || anchor.top > height) { this.close();return; }
    active.card.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const size = active.card.getBoundingClientRect();
    const placement = providerHoverPlacement(anchor, { width: size.width || Math.min(440, width - 16), height: size.height }, { width, height }, { left: 0, right: width });
    active.card.style.left = `${placement.left}px`;active.card.style.top = `${placement.top}px`;active.card.style.maxHeight = `${placement.maxHeight}px`;
  };

  private readonly over = (event: MouseEvent): void => {
    if (this.active?.card.contains(event.target instanceof Node ? event.target : null)) { this.cancelTimers();return; }
    const button = this.button(event.target);
    if (button === null || button === this.dismissed || button.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) return;
    if (this.active?.pinned && this.active.card.contains(this.doc.activeElement)) return;
    this.cancelTimers();this.enterTimer = setTimeout(() => this.show(button), 150);
  };

  private readonly out = (event: MouseEvent): void => {
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (this.dismissed !== null && this.dismissed.contains(event.target instanceof Node ? event.target : null) && !this.dismissed.contains(next)) this.dismissed = null;
    if (this.button(event.relatedTarget) !== null || this.active?.card.contains(next)) return;
    this.cancelTimers();const active = this.active;
    if (active === null || active.pinned || active.button.contains(this.doc.activeElement) || active.card.contains(this.doc.activeElement)) return;
    this.leaveTimer = setTimeout(() => { if (this.active === active) this.close(); }, 250);
  };

  private readonly focus = (event: FocusEvent): void => {
    const button = this.button(event.target);if (button !== null && button !== this.dismissed) this.show(button);
  };

  private readonly blur = (event: FocusEvent): void => {
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (event.target === this.dismissed) this.dismissed = null;
    if (this.button(event.relatedTarget) !== null || this.active?.card.contains(next)) return;
    this.close();
  };

  private readonly click = (event: MouseEvent): void => {
    const button = this.button(event.target);if (button === null) return;
    event.preventDefault();this.dismissed = null;this.show(button, true);this.active?.card.focus({ preventScroll: true });
  };

  private readonly key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.active !== null) { event.preventDefault();event.stopPropagation();this.dismiss(); }
    else if (event.key === 'ArrowDown') {
      const button = this.button(event.target);if (button === null) return;
      event.preventDefault();this.dismissed = null;this.show(button, true);this.active?.card.focus({ preventScroll: true });
    }
  };

  private readonly outside = (event: PointerEvent): void => {
    if (this.button(event.target) === null && !this.active?.card.contains(event.target instanceof Node ? event.target : null)) this.close();
  };
  private readonly visibility = (): void => { if (this.doc.hidden) this.close(); };
  private readonly navigation = (): void => this.close();
}
