import './native-find.css';

export interface ProviderNativeFindEntry {
  readonly root: HTMLElement;
  /** Stable source-root identity, retained when the provider replaces its DOM node. */
  readonly key: string;
  readonly anchors: readonly string[];
  readonly compact: boolean;
  readonly shown: boolean;
}

export type ProviderNativeFindReason = 'beforematch' | 'fragment' | 'source-link' | 'native-unhide';
export type ProviderNativeFindStatus = 'folded' | 'shown' | 'unsupported' | 'native-owned' | 'editing' | 'unmeasured' | 'invalid';

export interface ProviderNativeFindOptions {
  readonly onReveal: (entry: ProviderNativeFindEntry, reason: ProviderNativeFindReason, anchor: string | null) => void;
}

/** Unit-test dependencies; production callers should use real browser capability and computed display. */
export interface ProviderNativeFindEnvironment {
  readonly supported?: boolean;
  readonly display?: (root: HTMLElement) => string;
}

const OWNED = 'data-geld-provider-native-find';
const DISPLAY = '--geld-provider-native-find-display';
const EDITOR = 'textarea,[contenteditable="true"],[role="textbox"]';
const BOX = ['height', 'min-height', 'block-size', 'min-block-size', 'margin', 'padding', 'border',
  ...['top', 'right', 'bottom', 'left', 'block-start', 'block-end', 'inline-start', 'inline-end']
    .flatMap((side) => [`margin-${side}`, `padding-${side}`, `border-${side}-width`, `border-${side}-style`])];

interface Fold {
  entry: ProviderNativeFindEntry;
  readonly display: string;
  readonly variable: string;
  readonly priority: string;
  readonly inlineDisplay: string;
  readonly inlinePriority: string;
  readonly className: string;
  readonly beforeMatch: (event: Event) => void;
}

export function supportsProviderNativeFind(doc: Document): boolean {
  const probe = doc.createElement('div');
  probe.setAttribute('hidden', 'until-found');
  const hidden: unknown = Reflect.get(probe, 'hidden');
  return hidden === 'until-found' && 'onbeforematch' in probe;
}

/**
 * Fold only verified original roots; never move native nodes, focus or scroll them.
 * Browser beforematch is supported separately from our synthetic unit protocol.
 * Unsupported/native-hidden/editing roots stay untouched and return an explicit uncovered status.
 */
export class ProviderNativeFind {
  private readonly supported: boolean;
  private readonly folded = new Map<HTMLElement, Fold>();
  private readonly revealed = new Set<string>();
  private readonly displays = new WeakMap<HTMLElement, string>();
  private readonly anchors = new Map<string, ProviderNativeFindEntry>();
  private readonly observer: MutationObserver | null;
  private observedFragment: string | null = null;
  private processedFragment: string | null = null;
  private destroyed = false;

  constructor(private readonly doc: Document, private readonly options: ProviderNativeFindOptions, private readonly environment: ProviderNativeFindEnvironment = {}) {
    this.supported = environment.supported ?? supportsProviderNativeFind(doc);
    const Observer = doc.defaultView?.MutationObserver;
    this.observer = Observer === undefined ? null : new Observer((records) => this.nativeChanges(records));
    this.observer?.observe(doc, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', OWNED, 'style', 'class', 'inert', 'aria-hidden'] });
    doc.defaultView?.addEventListener('hashchange', this.hashChanged);
  }

  sync(entries: readonly ProviderNativeFindEntry[]): readonly { readonly key: string; readonly status: ProviderNativeFindStatus }[] {
    if (this.destroyed) return entries.map((entry) => ({ key: entry.key, status: 'invalid' }));
    const active = new Set(entries.map((entry) => entry.root));
    for (const [root, fold] of this.folded) if (!active.has(root)) this.restore(root, fold);
    this.anchors.clear();
    const conflicts = new Set<string>();
    for (const entry of entries) for (const anchor of entry.anchors) {
      const previous = this.anchors.get(anchor);
      if (previous !== undefined && previous.root !== entry.root) conflicts.add(anchor);
      this.anchors.set(anchor, entry);
    }
    const outcomes = entries.map((entry): { readonly key: string; readonly status: ProviderNativeFindStatus } => {
      const { root } = entry;
      const fold = this.folded.get(root);
      const valid = entry.key.trim() !== '' && root.ownerDocument === this.doc && root.isConnected
        && root.closest('[data-geld-ui]') === null && entry.anchors.length > 0
        && entry.anchors.every((anchor) => {
          const target = this.doc.getElementById(anchor);
          return !conflicts.has(anchor) && anchor !== '' && !/[\s\u0000]/.test(anchor) && target !== null && (target === root || root.contains(target));
        });
      let status: ProviderNativeFindStatus;
      if (!valid) status = 'invalid';
      else if (!entry.compact) status = 'shown';
      else if (!this.supported) status = 'unsupported';
      else if (root.matches(EDITOR) || root.querySelector(EDITOR) !== null) status = 'editing';
      else if (root.hasAttribute('inert') || root.getAttribute('aria-hidden') === 'true'
        || root.parentElement?.closest('[hidden],[inert],[aria-hidden="true"]') != null
        || BOX.some((property) => root.style.getPropertyPriority(property) === 'important')
        || (fold === undefined ? root.hasAttribute('hidden') || root.hasAttribute(OWNED) : !this.owns(root, fold))) status = 'native-owned';
      else {
        let display = fold?.display ?? this.displays.get(root);
        if (display === undefined) {
          display = this.environment.display?.(root) ?? this.doc.defaultView?.getComputedStyle(root).display ?? '';
          this.displays.set(root, display);
        }
        // Inline/contents/table layout is not claimed without real browser find evidence for that box type.
        if (!/^(block|flex|grid|flow-root|list-item)$/.test(display)) status = 'unmeasured';
        else if (entry.shown || this.revealed.has(entry.key)) status = 'shown';
        else {
          if (fold === undefined) this.claim(entry, display);
          else fold.entry = entry;
          status = 'folded';
        }
      }
      if (status !== 'folded' && fold !== undefined) this.restore(root, fold);
      if (!valid) for (const anchor of entry.anchors) if (this.anchors.get(anchor) === entry) this.anchors.delete(anchor);
      return { key: entry.key, status };
    });
    this.fragment();
    return outcomes.map((outcome) => this.revealed.has(outcome.key) && outcome.status === 'folded' ? { ...outcome, status: 'shown' } : outcome);
  }

  /** Call only for an explicit reader choice to hide this original again, never on an ordinary reapply. */
  allowCompact(key: string): void {
    this.revealed.delete(key);
    const hash = this.doc.location.hash;
    let anchor: string;
    try { anchor = decodeURIComponent(hash.slice(1)); } catch { return; }
    if (this.anchors.get(anchor)?.key === key) {
      this.observedFragment = hash;
      this.processedFragment = hash;
    }
  }

  reveal(anchor: string, reason: ProviderNativeFindReason = 'source-link'): boolean {
    const entry = this.anchors.get(anchor);
    if (entry === undefined) return false;
    const fold = this.folded.get(entry.root);
    if (fold === undefined || !this.owns(entry.root, fold)) return false;
    this.show(entry.root, fold, reason, anchor);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();
    this.doc.defaultView?.removeEventListener('hashchange', this.hashChanged);
    for (const [root, fold] of this.folded) this.restore(root, fold);
    this.anchors.clear();
    this.revealed.clear();
  }

  private owns(root: HTMLElement, fold: Fold): boolean {
    return root.getAttribute('hidden') === 'until-found' && root.getAttribute(OWNED) === 'folded'
      && root.style.getPropertyValue(DISPLAY) === fold.display && root.style.getPropertyPriority(DISPLAY) === ''
      && root.style.getPropertyValue('display') === fold.inlineDisplay && root.style.getPropertyPriority('display') === fold.inlinePriority
      && root.className === fold.className;
  }

  private claim(entry: ProviderNativeFindEntry, display: string): void {
    const { root } = entry;
    const fold: Fold = { entry, display, variable: root.style.getPropertyValue(DISPLAY), priority: root.style.getPropertyPriority(DISPLAY),
      inlineDisplay: root.style.getPropertyValue('display'), inlinePriority: root.style.getPropertyPriority('display'),
      className: root.className,
      beforeMatch: (event) => { if (event.target === root && this.owns(root, fold)) this.show(root, fold, 'beforematch', null); },
    };
    this.folded.set(root, fold);
    root.style.setProperty(DISPLAY, display);
    root.setAttribute(OWNED, 'folded');
    root.setAttribute('hidden', 'until-found');
    root.addEventListener('beforematch', fold.beforeMatch);
  }

  private restore(root: HTMLElement, fold: Fold): void {
    this.folded.delete(root);
    this.displays.delete(root);
    root.removeEventListener('beforematch', fold.beforeMatch);
    if (root.getAttribute('hidden') === 'until-found') root.removeAttribute('hidden');
    if (root.getAttribute(OWNED) === 'folded') root.removeAttribute(OWNED);
    if (root.style.getPropertyValue(DISPLAY) === fold.display && root.style.getPropertyPriority(DISPLAY) === '') {
      if (fold.variable === '') root.style.removeProperty(DISPLAY);
      else root.style.setProperty(DISPLAY, fold.variable, fold.priority);
    }
  }

  private show(root: HTMLElement, fold: Fold, reason: ProviderNativeFindReason, anchor: string | null): void {
    this.revealed.add(fold.entry.key);
    this.restore(root, fold);
    this.options.onReveal(fold.entry, reason, anchor);
  }

  private readonly fragment = (): void => {
    const hash = this.doc.location.hash;
    if (hash !== this.observedFragment) {
      this.observedFragment = hash;
      this.processedFragment = null;
    }
    if (hash === this.processedFragment) return;
    let anchor: string;
    try { anchor = decodeURIComponent(hash.slice(1)); } catch { return; }
    // An unknown/not-yet-mounted or currently native-hidden source must remain pending.
    if (anchor !== '' && this.reveal(anchor, 'fragment')) this.processedFragment = hash;
  };

  private readonly hashChanged = (event: Event): void => {
    // Preserve real leave/return navigation even when both events arrive after the final URL settles.
    if ('oldURL' in event && 'newURL' in event && typeof event.oldURL === 'string' && typeof event.newURL === 'string') {
      try { if (new URL(event.oldURL).hash !== new URL(event.newURL).hash) this.processedFragment = null; } catch { /* Generic synthetic protocol events need only the current actual hash. */ }
    }
    this.fragment();
  };

  private nativeChanges(records: readonly MutationRecord[]): void {
    const affected = new Set<HTMLElement>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target === null || target.closest('[data-geld-ui]') !== null) continue;
      for (const entry of this.anchors.values()) {
        if (entry.root === target || target.contains(entry.root)) this.displays.delete(entry.root);
      }
      for (const root of this.folded.keys()) {
        if (target === root || root.contains(target) || target.contains(root)
          || [...record.removedNodes].some((node) => node === root || node.contains(root))) affected.add(root);
      }
    }
    for (const root of affected) {
      const fold = this.folded.get(root);
      if (fold === undefined) continue;
      if (!root.isConnected) { this.restore(root, fold);continue; }
      if (root.getAttribute('hidden') === null) { this.show(root, fold, 'native-unhide', null);continue; }
      if (!this.owns(root, fold) || root.matches(EDITOR) || root.querySelector(EDITOR) !== null
        || root.closest('[inert],[aria-hidden="true"]') !== null || root.parentElement?.closest('[hidden]') != null) this.restore(root, fold);
    }
  }
}
